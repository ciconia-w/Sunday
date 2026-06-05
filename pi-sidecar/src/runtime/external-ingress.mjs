import { randomUUID } from "node:crypto";
import { executeReplyDelivery, normalizeReplyTransport, normalizeRetryDelays, SUPPORTED_REPLY_TRANSPORTS } from "./ingress-reply-delivery.mjs";
import {
    IngressReplayStore,
    createDefaultBackgroundReplayControl,
    deliveryReceiptAllowsAutomaticReplay,
    getDeliveryReceiptTaxonomy,
    normalizeReplayProcessing,
    normalizeReplayQueueEntryRecord as normalizeReplayQueueEntryRecordFromStore,
    summarizeReplayQueueEntry as summarizeReplayQueueEntryFromStore,
} from "./ingress-replay-store.mjs";
const MAX_REPLAY_HISTORY_EVENTS = 12;

function normalizeRouteValue(value, fallback) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || fallback;
}

function encodeRouteSegment(value) {
    return encodeURIComponent(value)
        .replace(/%/g, "_")
        .replace(/_20/g, "-");
}

function normalizeHeaderMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key, item]) => typeof key === "string" && key.trim() && typeof item === "string" && item.trim())
            .map(([key, item]) => [key.trim(), item.trim()]),
    );
}

function normalizeNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}


export function normalizeBackgroundReplayMode(value) {
    return value === "service" || value === "standalone-service" ? value : "in-process";
}

export function backgroundReplayModeUsesDedicatedService(value) {
    const normalized = normalizeBackgroundReplayMode(value);
    return normalized === "service" || normalized === "standalone-service";
}

function normalizeBackgroundReplayStrategy(value) {
    return value === "exponential" ? "exponential" : "fixed";
}

function buildBackgroundReplayPolicy() {
    const strategy = normalizeBackgroundReplayStrategy(
        String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_STRATEGY ?? "fixed").trim(),
    );
    const fallbackDelaysMs = [30000, 120000, 300000];
    const configuredDelaysMs = normalizeRetryDelays(
        process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS,
        fallbackDelaysMs,
    );

    if (strategy === "fixed") {
        return {
            strategy,
            delaysMs: configuredDelaysMs,
            maxAutomaticAttempts: configuredDelaysMs.length,
            initialDelayMs: configuredDelaysMs[0] ?? 0,
            maxDelayMs: configuredDelaysMs[configuredDelaysMs.length - 1] ?? 0,
            multiplier: 1,
        };
    }

    const initialDelayMs = normalizeNonNegativeInteger(
        process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_INITIAL_DELAY_MS,
        configuredDelaysMs[0] ?? fallbackDelaysMs[0],
    );
    const maxDelayMs = Math.max(
        initialDelayMs,
        normalizeNonNegativeInteger(
            process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_DELAY_MS,
            configuredDelaysMs[configuredDelaysMs.length - 1] ?? fallbackDelaysMs[fallbackDelaysMs.length - 1],
        ),
    );
    const multiplier = normalizePositiveNumber(
        process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_BACKOFF_MULTIPLIER,
        2,
    );
    const maxAutomaticAttempts = Math.max(
        1,
        normalizeNonNegativeInteger(
            process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_ATTEMPTS,
            configuredDelaysMs.length || fallbackDelaysMs.length,
        ),
    );
    const delaysMs = Array.from({ length: maxAutomaticAttempts }, (_, index) =>
        Math.min(maxDelayMs, Math.round(initialDelayMs * (multiplier ** index))),
    );

    return {
        strategy,
        delaysMs,
        maxAutomaticAttempts,
        initialDelayMs,
        maxDelayMs,
        multiplier,
    };
}

function normalizeReplyTarget(body) {
    const replyTransport = normalizeReplyTransport(body?.replyTransport);
    const replyWebhookUrl = typeof body?.replyWebhookUrl === "string" ? body.replyWebhookUrl.trim() : "";

    if (!replyWebhookUrl) {
        if (replyTransport) {
            throw new Error(`replyWebhookUrl is required for replyTransport=${replyTransport}`);
        }
        return null;
    }

    if (replyTransport && !SUPPORTED_REPLY_TRANSPORTS.includes(replyTransport)) {
        throw new Error(`Unsupported replyTransport: ${replyTransport}`);
    }

    let parsedUrl = null;
    try {
        parsedUrl = new URL(replyWebhookUrl);
    } catch {
        throw new Error("Invalid replyWebhookUrl");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("replyWebhookUrl must use http or https");
    }

    const transport = replyTransport || "webhook";
    const secret = typeof body?.replyWebhookSecret === "string" && body.replyWebhookSecret.trim()
        ? body.replyWebhookSecret.trim()
        : "";

    return {
        transport,
        url: parsedUrl.toString(),
        headers: normalizeHeaderMap(body?.replyWebhookHeaders),
        secret: ["lark-bot-webhook", "dingtalk-bot-webhook"].includes(transport) ? secret : "",
    };
}

function collectRenderText(renderItems) {
    return (Array.isArray(renderItems) ? renderItems : [])
        .filter((item) => item?.type === "text")
        .map((item) => item?.data?.content ?? "")
        .join("")
        .trim();
}

function sanitizeReplyTarget(replyTarget) {
    if (!replyTarget || typeof replyTarget !== "object") {
        return {};
    }

    return {
        transport: replyTarget.transport ?? "",
        url: replyTarget.url ?? "",
        hasSecret: Boolean(replyTarget.secret),
        headerKeys: Object.keys(replyTarget.headers ?? {}),
    };
}

function normalizeReplayHistoryKind(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || "unknown";
}

function normalizeReplayHistoryMode(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || "unknown";
}

function createReplayHistoryEvent(event) {
    return {
        kind: normalizeReplayHistoryKind(event?.kind),
        mode: normalizeReplayHistoryMode(event?.mode),
        at: typeof event?.at === "string" ? event.at : "",
        attemptCount: normalizeNonNegativeInteger(event?.attemptCount, 0),
        totalAttemptCount: normalizeNonNegativeInteger(event?.totalAttemptCount, 0),
        status: typeof event?.status === "string" ? event.status : "",
        error: typeof event?.error === "string" ? event.error : "",
    };
}

function buildLegacyReplayHistory(entry) {
    const events = [];
    const totalAttemptCount = normalizeNonNegativeInteger(entry?.attemptCount, 0);
    const latestError = typeof entry?.latestError === "string" ? entry.latestError : "";
    const createdAt = typeof entry?.createdAt === "string" ? entry.createdAt : "";
    const deliveredAt = typeof entry?.deliveredAt === "string" ? entry.deliveredAt : "";
    const resolvedAt = typeof entry?.resolvedAt === "string" ? entry.resolvedAt : "";
    const status = typeof entry?.status === "string" ? entry.status : "";

    if (createdAt && latestError) {
        events.push(createReplayHistoryEvent({
            kind: "delivery-failed",
            mode: "initial",
            at: createdAt,
            attemptCount: totalAttemptCount,
            totalAttemptCount,
            status,
            error: latestError,
        }));
    }

    if (deliveredAt) {
        events.push(createReplayHistoryEvent({
            kind: "delivered",
            mode: "unknown",
            at: deliveredAt,
            totalAttemptCount,
            status: "delivered",
            error: "",
        }));
    }

    if (resolvedAt && ["resolved", "discarded"].includes(status)) {
        events.push(createReplayHistoryEvent({
            kind: status,
            mode: "operator",
            at: resolvedAt,
            totalAttemptCount,
            status,
            error: "",
        }));
    }

    return events.slice(-MAX_REPLAY_HISTORY_EVENTS);
}

function normalizeReplayHistory(history, fallbackEntry = null) {
    const normalizedEvents = Array.isArray(history)
        ? history
            .map((event) => createReplayHistoryEvent(event))
            .filter((event) => event.at || event.kind !== "unknown")
        : [];

    if (normalizedEvents.length > 0) {
        return normalizedEvents.slice(-MAX_REPLAY_HISTORY_EVENTS);
    }

    return buildLegacyReplayHistory(fallbackEntry);
}

function appendReplayHistory(entry, event) {
    const existingHistory = Array.isArray(entry?.history)
        ? entry.history.map((item) => createReplayHistoryEvent(item))
        : normalizeReplayHistory(undefined, entry);

    return normalizeReplayHistory([
        ...existingHistory,
        createReplayHistoryEvent(event),
    ]);
}

function buildSupportedReplyTransports() {
    return [...SUPPORTED_REPLY_TRANSPORTS];
}

function buildReceiptTaxonomyState() {
    const categories = getDeliveryReceiptTaxonomy();
    return {
        categories,
        automaticReplayCategories: categories
            .filter((entry) => entry.automaticReplayEligible === true)
            .map((entry) => entry.id),
        operatorManagedCategories: categories
            .filter((entry) => entry.automaticReplayEligible !== true && entry.id !== "success")
            .map((entry) => entry.id),
    };
}

function createFutureIso(ms) {
    return new Date(Date.now() + Math.max(0, ms)).toISOString();
}

export class ExternalIngress {
    constructor(options) {
        this.options = options;
        this.replayStore = new IngressReplayStore(options.runtimeDir);
        this.replyRetryDelaysMs = normalizeRetryDelays(
            process.env.PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS,
            [1000, 3000],
        );
        this.backgroundReplayEnabled = String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED ?? "1") !== "0";
        this.backgroundReplayMode = normalizeBackgroundReplayMode(
            String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE ?? "in-process").trim(),
        );
        this.backgroundReplayPolicy = buildBackgroundReplayPolicy();
        this.backgroundReplayDelaysMs = [...this.backgroundReplayPolicy.delaysMs];
        this.backgroundReplayPollMs = normalizeNonNegativeInteger(
            process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS,
            5000,
        );
        this.routeTargets = new Map();
        this.replayQueue = new Map();
        this.backgroundReplayControl = createDefaultBackgroundReplayControl();
        this.sessionQueues = new Map();
        this.activeSessionJobs = new Map();
        this.backgroundReplayServiceSupervisorStateProvider = null;
        this.backgroundReplayLoopRunning = false;
        this.backgroundReplayTimer = null;
        this.readyPromise = null;
        this.startBackgroundReplayLoop();
    }

    async ensureReady() {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = Promise.all([
            this.loadRouteTargets(),
            this.loadReplayQueue(),
            this.loadBackgroundReplayControl(),
        ]).then(() => undefined);
        return this.readyPromise;
    }

    async loadRouteTargets() {
        const records = await this.replayStore.loadReplyRouteEntries();
        this.routeTargets = new Map(records.map((record) => [record.routeKey.trim(), record]));
    }

    async saveRouteTargets() {
        await this.replayStore.saveReplyRouteEntries([...this.routeTargets.values()]);
    }

    async loadReplayQueue() {
        const entries = await this.replayStore.loadReplayQueueEntries();
        this.replayQueue = new Map(entries.map((entry) => [entry.id.trim(), entry]));
    }

    async loadBackgroundReplayControl() {
        this.backgroundReplayControl = await this.replayStore.loadBackgroundReplayControl();
    }

    async saveReplayQueue() {
        await this.replayStore.saveReplayQueueEntries([...this.replayQueue.values()]);
    }

    async saveBackgroundReplayControl() {
        this.backgroundReplayControl = await this.replayStore.saveBackgroundReplayControl(this.backgroundReplayControl);
    }

    startBackgroundReplayLoop() {
        if (!this.backgroundReplayEnabled || this.usesDedicatedBackgroundReplayService() || this.backgroundReplayTimer) {
            return;
        }

        this.backgroundReplayTimer = setInterval(() => {
            this.runDueBackgroundReplays().catch((error) => {
                console.error("[external-ingress] background replay loop failed:", error);
            });
        }, Math.max(50, this.backgroundReplayPollMs));

        if (typeof this.backgroundReplayTimer.unref === "function") {
            this.backgroundReplayTimer.unref();
        }
    }

    usesDedicatedBackgroundReplayService() {
        return this.backgroundReplayEnabled && backgroundReplayModeUsesDedicatedService(this.backgroundReplayMode);
    }

    usesSidecarManagedBackgroundReplayService() {
        return this.backgroundReplayEnabled && this.backgroundReplayMode === "service";
    }

    isBackgroundReplayPaused() {
        return this.backgroundReplayControl?.paused === true;
    }

    getBackgroundReplayControlState() {
        return {
            paused: this.backgroundReplayControl?.paused === true,
            pauseReason: typeof this.backgroundReplayControl?.pauseReason === "string"
                ? this.backgroundReplayControl.pauseReason
                : "",
            pausedAt: typeof this.backgroundReplayControl?.pausedAt === "string"
                ? this.backgroundReplayControl.pausedAt
                : "",
            updatedAt: typeof this.backgroundReplayControl?.updatedAt === "string"
                ? this.backgroundReplayControl.updatedAt
                : "",
        };
    }

    async pauseBackgroundReplay(reason = "") {
        await this.ensureReady();
        if (!this.backgroundReplayEnabled) {
            throw new Error("Background replay is disabled");
        }

        const now = new Date().toISOString();
        const normalizedReason = typeof reason === "string" ? reason.trim() : "";
        const previousState = this.getBackgroundReplayControlState();
        this.backgroundReplayControl = {
            paused: true,
            pauseReason: normalizedReason,
            pausedAt: previousState.pausedAt || now,
            updatedAt: now,
        };
        await this.saveBackgroundReplayControl();
        return this.getBackgroundReplayControlState();
    }

    async resumeBackgroundReplay() {
        await this.ensureReady();
        if (!this.backgroundReplayEnabled) {
            throw new Error("Background replay is disabled");
        }

        this.backgroundReplayControl = {
            paused: false,
            pauseReason: "",
            pausedAt: "",
            updatedAt: new Date().toISOString(),
        };
        await this.saveBackgroundReplayControl();

        if (!this.usesDedicatedBackgroundReplayService()) {
            this.runDueBackgroundReplays().catch((error) => {
                console.error("[external-ingress] immediate background replay resume failed:", error);
            });
        }

        return this.getBackgroundReplayControlState();
    }

    usesStandaloneBackgroundReplayService() {
        return this.backgroundReplayEnabled && this.backgroundReplayMode === "standalone-service";
    }

    setBackgroundReplayServiceSupervisorStateProvider(provider) {
        this.backgroundReplayServiceSupervisorStateProvider = typeof provider === "function" ? provider : null;
    }

    getStoredReplyTarget(routeKey) {
        const stored = this.routeTargets.get(routeKey);
        return stored?.replyTarget ?? null;
    }

    enqueueSessionJob(job) {
        const queue = this.sessionQueues.get(job.sessionId) ?? [];
        queue.push(job);
        this.sessionQueues.set(job.sessionId, queue);
    }

    activateNextSessionJob(sessionId) {
        const current = this.activeSessionJobs.get(sessionId);
        if (current) {
            return current;
        }

        const queue = this.sessionQueues.get(sessionId) ?? [];
        const next = queue.shift() ?? null;
        if (queue.length > 0) {
            this.sessionQueues.set(sessionId, queue);
        } else {
            this.sessionQueues.delete(sessionId);
        }

        if (next) {
            this.activeSessionJobs.set(sessionId, next);
        }

        return next;
    }

    completeActiveSessionJob(sessionId) {
        const current = this.activeSessionJobs.get(sessionId) ?? this.activateNextSessionJob(sessionId);
        this.activeSessionJobs.delete(sessionId);
        return current ?? null;
    }

    async rememberReplyTarget(route, replyTarget) {
        if (!replyTarget) {
            return;
        }

        const storedRoute = await this.replayStore.upsertReplyRoute({
            routeKey: route.routeKey,
            source: route.source,
            channelId: route.channelId,
            threadId: route.threadId,
            conversationId: route.conversationId,
            sessionId: route.sessionId,
            replyTarget,
            updatedAt: new Date().toISOString(),
        });
        this.routeTargets.set(storedRoute.routeKey, storedRoute);
    }

    async listReplyRoutes() {
        await this.ensureReady();
        return [...this.routeTargets.values()]
            .sort((left, right) => String(left.routeKey ?? "").localeCompare(String(right.routeKey ?? "")))
            .map((entry) => ({
                routeKey: entry.routeKey ?? "",
                source: entry.source ?? "",
                channelId: entry.channelId ?? "",
                threadId: entry.threadId ?? "",
                conversationId: entry.conversationId ?? "",
                sessionId: entry.sessionId ?? "",
                replyTarget: sanitizeReplyTarget(entry.replyTarget),
                updatedAt: entry.updatedAt ?? "",
            }));
    }

    async getReplayQueue(options = {}) {
        await this.ensureReady();
        await this.loadReplayQueue();
        await this.loadBackgroundReplayControl();
        const includeResolved = options.includeResolved === true;
        const entries = [...this.replayQueue.values()]
            .filter((entry) => includeResolved || !["resolved", "discarded"].includes(String(entry.status ?? "")))
            .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
            .map((entry) => summarizeReplayQueueEntryFromStore(entry));
        const receiptCategoryCounts = Object.fromEntries(
            entries.reduce((map, entry) => {
                const category = typeof entry.latestReceipt?.receiptCategory === "string" && entry.latestReceipt.receiptCategory.trim()
                    ? entry.latestReceipt.receiptCategory.trim()
                    : "unknown-failure";
                map.set(category, (map.get(category) ?? 0) + 1);
                return map;
            }, new Map()),
        );

        const counts = {
            total: entries.length,
            pending: entries.filter((entry) => entry.status === "pending").length,
            processing: entries.filter((entry) => Boolean(entry.processing?.ownerId)).length,
            delivered: entries.filter((entry) => entry.status === "delivered").length,
            awaitingOperator: entries.filter((entry) => entry.status === "awaiting-operator").length,
            resolved: entries.filter((entry) => entry.status === "resolved").length,
            discarded: entries.filter((entry) => entry.status === "discarded").length,
        };

        return {
            worker: {
                enabled: this.backgroundReplayEnabled,
                pollMs: this.backgroundReplayPollMs,
                delaysMs: [...this.backgroundReplayDelaysMs],
                strategy: this.backgroundReplayPolicy.strategy,
                maxAutomaticAttempts: this.backgroundReplayPolicy.maxAutomaticAttempts,
                paused: this.isBackgroundReplayPaused(),
                pauseReason: this.getBackgroundReplayControlState().pauseReason,
                pausedAt: this.getBackgroundReplayControlState().pausedAt,
            },
            counts,
            receiptCategoryCounts,
            entries,
        };
    }

    async getBackgroundReplayServiceStatus() {
        const enabled = this.usesDedicatedBackgroundReplayService();
        const baseStatus = {
            enabled,
            running: false,
            pid: 0,
            restartCount: 0,
            startedAt: "",
            lastHeartbeatAt: "",
            lastRunAt: "",
            lastError: "",
            manager: this.backgroundReplayMode === "service"
                ? "sidecar"
                : this.backgroundReplayMode === "standalone-service"
                    ? "external"
                    : "none",
            managedBySidecar: this.backgroundReplayMode === "service",
        };

        const fileStatus = await this.replayStore.readBackgroundReplayServiceStatus();

        const supervisorStatus = this.backgroundReplayServiceSupervisorStateProvider
            ? (this.backgroundReplayServiceSupervisorStateProvider() ?? {})
            : {};
        const supervisorManagedBySidecar = supervisorStatus?.managedBySidecar === true;
        const mergedPid = supervisorManagedBySidecar
            ? normalizeNonNegativeInteger(supervisorStatus?.pid, 0)
            : normalizeNonNegativeInteger(fileStatus?.pid, 0);
        const mergedManager = supervisorManagedBySidecar
            ? "sidecar"
            : (typeof fileStatus?.manager === "string" && fileStatus.manager.trim()
                ? fileStatus.manager
                : baseStatus.manager);

        const merged = {
            ...baseStatus,
            ...fileStatus,
            ...supervisorStatus,
            enabled,
            pid: mergedPid,
            restartCount: supervisorManagedBySidecar
                ? normalizeNonNegativeInteger(supervisorStatus?.restartCount, 0)
                : 0,
            startedAt: typeof (fileStatus?.startedAt ?? supervisorStatus?.startedAt) === "string"
                ? (fileStatus?.startedAt ?? supervisorStatus?.startedAt)
                : "",
            lastHeartbeatAt: typeof (fileStatus?.lastHeartbeatAt ?? supervisorStatus?.lastHeartbeatAt) === "string"
                ? (fileStatus?.lastHeartbeatAt ?? supervisorStatus?.lastHeartbeatAt)
                : "",
            lastRunAt: typeof (fileStatus?.lastRunAt ?? supervisorStatus?.lastRunAt) === "string"
                ? (fileStatus?.lastRunAt ?? supervisorStatus?.lastRunAt)
                : "",
            lastError: supervisorManagedBySidecar
                ? (typeof (supervisorStatus?.lastError ?? fileStatus?.lastError) === "string"
                    ? (supervisorStatus?.lastError ?? fileStatus?.lastError)
                    : "")
                : (typeof fileStatus?.lastError === "string" ? fileStatus.lastError : ""),
            manager: mergedManager,
            managedBySidecar: supervisorManagedBySidecar,
        };

        if (!enabled) {
            return merged;
        }

        const lastHeartbeatAtMs = Date.parse(merged.lastHeartbeatAt);
        const heartbeatFresh = Number.isFinite(lastHeartbeatAtMs)
            && (Date.now() - lastHeartbeatAtMs) <= Math.max(this.backgroundReplayPollMs * 4, 5000);

        return {
            ...merged,
            running: Boolean(merged.pid) && heartbeatFresh,
        };
    }

    async getOperatorState(options = {}) {
        const routes = await this.listReplyRoutes();
        const replayQueue = await this.getReplayQueue(options);
        const backgroundReplayServiceStatus = await this.getBackgroundReplayServiceStatus();
        const backgroundReplayControl = this.getBackgroundReplayControlState();
        const receiptTaxonomy = buildReceiptTaxonomyState();
        const ownership = {
            routePersistence: "shared-runtime-store",
            routeMutationAuthority: "sidecar-direct",
            replayQueuePersistence: "shared-runtime-store",
            automaticReplayExecutor: this.usesDedicatedBackgroundReplayService()
                ? (this.backgroundReplayMode === "service" ? "service-worker-direct" : "standalone-worker-direct")
                : "sidecar-direct",
            serviceUsesSidecarOperatorApi: false,
        };

        let runtimeNote = "background replay 已关闭。";
        if (this.backgroundReplayEnabled && backgroundReplayControl.paused) {
            runtimeNote = "当前 automatic replay 已被 operator 暂停；手动重试和 resolve 仍可继续使用。";
        } else if (this.backgroundReplayEnabled && this.backgroundReplayMode === "service") {
            runtimeNote = backgroundReplayServiceStatus.running
                ? "当前 background replay 由 sidecar 管理的 dedicated replay service 驱动；worker 已直接读取 shared replay queue，不再通过 sidecar operator API 轮询待重放项。"
                : "当前 background replay 已切到 sidecar-managed dedicated replay service 模式，但 worker 暂未进入稳定运行态。";
        } else if (this.backgroundReplayEnabled && this.backgroundReplayMode === "standalone-service") {
            runtimeNote = backgroundReplayServiceStatus.running
                ? "当前 background replay 由独立 replay service 驱动；queue ownership 已下沉到 shared runtime store，worker 直接执行自动重放。"
                : "当前 background replay 已切到 standalone replay service 模式，但外部 worker 暂未进入稳定运行态。";
        } else if (this.backgroundReplayEnabled) {
            runtimeNote = "当前 background replay worker 仍运行在 sidecar 进程内，但 replay queue 已统一下沉到 shared runtime store。";
        }

        return {
            routes,
            replayQueue,
            supportedReplyTransports: buildSupportedReplyTransports(),
            replyRetryPolicy: {
                maxAttempts: this.replyRetryDelaysMs.length + 1,
                delaysMs: [...this.replyRetryDelaysMs],
            },
            backgroundReplay: {
                enabled: this.backgroundReplayEnabled,
                pollMs: this.backgroundReplayPollMs,
                delaysMs: [...this.backgroundReplayDelaysMs],
                mode: this.backgroundReplayMode,
                hasDedicatedReplayService: backgroundReplayModeUsesDedicatedService(this.backgroundReplayMode),
                deliveryPolicy: {
                    strategy: this.backgroundReplayPolicy.strategy,
                    delaysMs: [...this.backgroundReplayDelaysMs],
                    maxAutomaticAttempts: this.backgroundReplayPolicy.maxAutomaticAttempts,
                    initialDelayMs: this.backgroundReplayPolicy.initialDelayMs,
                    maxDelayMs: this.backgroundReplayPolicy.maxDelayMs,
                    multiplier: this.backgroundReplayPolicy.multiplier,
                },
                serviceStatus: backgroundReplayServiceStatus,
                control: backgroundReplayControl,
                ownership,
            },
            receiptTaxonomy,
            runtimeNote,
        };
    }

    async createReplayQueueEntry(replyTarget, payload, errors, latestReceipt = null) {
        const now = new Date().toISOString();
        const automaticReplayEligible = deliveryReceiptAllowsAutomaticReplay(latestReceipt);
        const nextAttemptAt =
            this.backgroundReplayEnabled && automaticReplayEligible && this.backgroundReplayDelaysMs.length > 0
                ? createFutureIso(this.backgroundReplayDelaysMs[0])
                : "";
        const entry = {
            id: randomUUID(),
            status: automaticReplayEligible ? "pending" : "awaiting-operator",
            transport: replyTarget.transport ?? "",
            routeKey: payload?.routeKey ?? "",
            conversationId: payload?.conversationId ?? "",
            sessionId: payload?.sessionId ?? "",
            requestExternalMessageId: payload?.requestExternalMessageId ?? "",
            replyTarget,
            payload,
            attemptCount: errors.length,
            replayCount: 0,
            automaticReplayCount: 0,
            latestError: errors[errors.length - 1]?.error ?? "Reply delivery failed",
            errors,
            createdAt: now,
            updatedAt: now,
            deliveredAt: "",
            resolvedAt: "",
            nextAttemptAt,
            lastAttemptAt: "",
            history: [],
            latestReceipt,
            processing: null,
        };
        entry.history = appendReplayHistory(entry, {
            kind: "delivery-failed",
            mode: "initial",
            at: now,
            attemptCount: errors.length,
            totalAttemptCount: entry.attemptCount,
            status: entry.status,
            error: entry.latestError,
        });

        const storedEntry = await this.replayStore.appendReplayQueueEntry(entry);
        this.replayQueue.set(storedEntry.id, storedEntry);
        return storedEntry;
    }

    getRouteIdentity(body) {
        const source = normalizeRouteValue(body?.source, "external");
        const channelId = normalizeRouteValue(body?.channelId, "default");
        const threadId = normalizeRouteValue(body?.threadId, channelId);
        const routeSegments = [source, channelId, threadId].map((item) => encodeRouteSegment(item));
        const routeToken = routeSegments.join("-");
        const routeKey = `${source}:${channelId}:${threadId}`;

        return {
            source,
            channelId,
            threadId,
            routeKey,
            routeToken,
            conversationId: body?.conversationId ?? `ext-conv-${routeToken}`,
            sessionId: body?.sessionId ?? `ext-sess-${routeToken}`,
        };
    }

    async normalizeTextMessage(body) {
        await this.ensureReady();
        const externalMessageId = body.externalMessageId ?? randomUUID();
        const route = this.getRouteIdentity(body);
        const explicitReplyTarget = normalizeReplyTarget(body);
        const replyTarget = explicitReplyTarget ?? this.getStoredReplyTarget(route.routeKey);
        const conversationTailId =
            typeof body.previousMessageId === "string" && body.previousMessageId.trim()
                ? body.previousMessageId.trim()
                : await this.options.conversationRepository.getConversationTailMessageId(route.conversationId);
        const assistantId = body.assistantId ?? "uos-ai-generic";
        const modelId = body.modelId ?? this.options.defaultModelId;
        const text = typeof body.text === "string" ? body.text.trim() : "";

        return {
            route,
            replyTarget,
            session_id: route.sessionId,
            conversation_id: route.conversationId,
            assistant: assistantId,
            model: `${this.options.provider}/${modelId}`,
            model_name: modelId,
            user: body.userId ?? "external-user",
            params: {
                source: route.source,
                channel_id: route.channelId,
                thread_id: route.threadId,
                route_key: route.routeKey,
                external_message_id: externalMessageId,
            },
            message: {
                id: externalMessageId,
                previous: conversationTailId,
                content: [
                    {
                        type: "text",
                        data: {
                            content: text,
                        },
                    },
                ],
                extension: {
                    source: route.source,
                    channelId: route.channelId,
                    threadId: route.threadId,
                    routeKey: route.routeKey,
                    userId: body.userId ?? "",
                },
            },
        };
    }

    async acceptMessage(body) {
        const payload = await this.normalizeTextMessage(body);
        const { route, replyTarget } = payload;

        if (!payload.message.content[0]?.data?.content) {
            return {
                ok: false,
                error: "Empty external message",
            };
        }

        await this.rememberReplyTarget(route, replyTarget);
        await this.options.conversationRepository.trackOutgoingPayload(payload);
        await this.options.conversationRepository.saveConversation(payload.conversation_id);
        this.enqueueSessionJob({
            sessionId: payload.session_id,
            conversationId: payload.conversation_id,
            source: route.source,
            channelId: route.channelId,
            threadId: route.threadId,
            routeKey: route.routeKey,
            userId: body.userId ?? "external-user",
            externalMessageId: payload.message.id,
            previousMessageId: payload.message.previous ?? "",
            replyTarget,
        });
        await this.options.sessionBridge.sendMessage(JSON.stringify(payload));

        return {
            ok: true,
            conversationId: payload.conversation_id,
            sessionId: payload.session_id,
            externalMessageId: payload.message.id,
            previousMessageId: payload.message.previous,
            routeKey: route.routeKey,
            threadId: route.threadId,
        };
    }

    handleSessionStarted(sessionId) {
        this.activateNextSessionJob(sessionId);
    }

    async handleSessionFinished(sessionId, message) {
        const job = this.completeActiveSessionJob(sessionId);
        if (!job?.replyTarget) {
            return {
                ok: true,
                skipped: true,
                reason: "no-reply-target",
            };
        }

        const parsed = typeof message === "string" ? JSON.parse(message) : message ?? {};
        const renderItems = Array.isArray(parsed?.renderItems) ? parsed.renderItems : [];
        const assistantText = collectRenderText(renderItems);

        return this.deliverReply(job.replyTarget, {
            ok: true,
            transport: job.replyTarget.transport,
            source: job.source,
            channelId: job.channelId,
            threadId: job.threadId,
            routeKey: job.routeKey,
            conversationId: parsed?.conversation_id ?? job.conversationId,
            sessionId,
            requestExternalMessageId: job.externalMessageId,
            previousMessageId: job.previousMessageId,
            userId: job.userId,
            assistantMessageId: typeof parsed?.id === "string" ? parsed.id : "",
            assistantText,
            renderItems,
            createdAt: new Date().toISOString(),
        });
    }

    async handleSessionError(sessionId, message) {
        const job = this.completeActiveSessionJob(sessionId);
        if (!job?.replyTarget) {
            return {
                ok: true,
                skipped: true,
                reason: "no-reply-target",
            };
        }

        const parsed = typeof message === "string" ? JSON.parse(message) : message ?? {};

        return this.deliverReply(job.replyTarget, {
            ok: false,
            transport: job.replyTarget.transport,
            source: job.source,
            channelId: job.channelId,
            threadId: job.threadId,
            routeKey: job.routeKey,
            conversationId: job.conversationId,
            sessionId,
            requestExternalMessageId: job.externalMessageId,
            previousMessageId: job.previousMessageId,
            userId: job.userId,
            error: typeof parsed?.error_message === "string" ? parsed.error_message : "External ingress session failed",
            errorCode: parsed?.error ?? -1,
            createdAt: new Date().toISOString(),
        });
    }

    async deliverReply(replyTarget, payload) {
        const delivery = await executeReplyDelivery(replyTarget, payload, {
            retryDelaysMs: this.replyRetryDelaysMs,
            actor: "sidecar",
            mode: "initial",
        });
        if (delivery.ok) {
            return {
                ...delivery.result,
                attemptCount: delivery.attemptCount,
            };
        }

        const replayQueueEntry = await this.createReplayQueueEntry(
            replyTarget,
            payload,
            delivery.errors,
            delivery.latestReceipt ?? null,
        );
        const deadLetterEntry = {
            id: randomUUID(),
            transport: replyTarget.transport ?? "",
            routeKey: payload?.routeKey ?? "",
            conversationId: payload?.conversationId ?? "",
            sessionId: payload?.sessionId ?? "",
            requestExternalMessageId: payload?.requestExternalMessageId ?? "",
            replyTarget: sanitizeReplyTarget(replyTarget),
            payload,
            attemptCount: delivery.errors.length,
            replayQueueEntryId: replayQueueEntry.id,
            errors: delivery.errors,
            createdAt: new Date().toISOString(),
        };
        await this.replayStore.appendDeadLetter(deadLetterEntry);

        return {
            ok: false,
            transport: replyTarget.transport ?? "",
            attemptCount: delivery.errors.length,
            error: delivery.errors[delivery.errors.length - 1]?.error ?? "Reply delivery failed",
            deadLetterId: deadLetterEntry.id,
            replayQueueEntryId: replayQueueEntry.id,
        };
    }

    getNextAutomaticReplayDelayMsForIndex(index) {
        if (!this.backgroundReplayEnabled) {
            return -1;
        }

        const normalizedIndex = Math.max(0, index);
        return normalizedIndex < this.backgroundReplayDelaysMs.length
            ? this.backgroundReplayDelaysMs[normalizedIndex]
            : -1;
    }

    getReplayProcessorDescriptor(options = {}) {
        const processorOwnerId = typeof options.processorOwnerId === "string" && options.processorOwnerId.trim()
            ? options.processorOwnerId.trim()
            : "sidecar";
        const processorKind = typeof options.processorKind === "string" && options.processorKind.trim()
            ? options.processorKind.trim()
            : "sidecar";
        const mode = options.automatic === true ? "automatic" : "manual";

        return {
            processorOwnerId,
            processorKind,
            mode,
        };
    }

    async replayQueuedReply(id, options = {}) {
        await this.ensureReady();
        const normalizedId = typeof id === "string" ? id.trim() : "";
        if (!normalizedId) {
            throw new Error("Replay queue entry id is required");
        }

        const entry = await this.replayStore.getReplayQueueEntry(normalizedId);
        if (!entry) {
            throw new Error(`Replay queue entry not found: ${normalizedId}`);
        }

        if (["resolved", "discarded"].includes(String(entry.status ?? ""))) {
            throw new Error(`Replay queue entry is already ${entry.status}`);
        }

        const automatic = options.automatic === true;
        if (automatic) {
            await this.loadBackgroundReplayControl();
        }
        if (automatic && this.isBackgroundReplayPaused()) {
            return {
                ok: false,
                automatic: true,
                skipped: true,
                reason: "paused",
                error: "Background replay is paused",
                entry: summarizeReplayQueueEntryFromStore(entry),
            };
        }

        const processor = this.getReplayProcessorDescriptor(options);
        const claimedEntry = await this.replayStore.claimReplayQueueEntry(normalizedId, {
            ownerId: processor.processorOwnerId,
            ownerKind: processor.processorKind,
            mode: processor.mode,
            ttlMs: Math.max(this.backgroundReplayPollMs * 4, 5000),
        });
        if (!claimedEntry) {
            throw new Error(`Replay queue entry is already being processed: ${normalizedId}`);
        }

        const delivery = await executeReplyDelivery(claimedEntry.replyTarget ?? {}, claimedEntry.payload ?? {}, {
            retryDelaysMs: this.replyRetryDelaysMs,
            actor: processor.processorKind,
            mode: automatic ? "automatic" : "manual",
        });

        const updatedEntry = await this.replayStore.mutateReplayQueue(normalizedId, async (currentEntry) => {
            const processing = normalizeReplayProcessing(currentEntry.processing);
            if (processing?.ownerId !== processor.processorOwnerId) {
                throw new Error(`Replay queue entry processing ownership changed: ${normalizedId}`);
            }

            const nextEntry = normalizeReplayQueueEntryRecordFromStore(currentEntry);
            const now = new Date().toISOString();
            nextEntry.processing = null;
            nextEntry.attemptCount = normalizeNonNegativeInteger(nextEntry.attemptCount, 0) + delivery.attemptCount;
            nextEntry.updatedAt = now;
            nextEntry.lastAttemptAt = now;
            nextEntry.latestReceipt = delivery.latestReceipt ?? nextEntry.latestReceipt ?? null;

            if (automatic) {
                nextEntry.automaticReplayCount = normalizeNonNegativeInteger(nextEntry.automaticReplayCount, 0) + 1;
            } else {
                nextEntry.replayCount = normalizeNonNegativeInteger(nextEntry.replayCount, 0) + 1;
            }

            if (delivery.ok) {
                nextEntry.status = "delivered";
                nextEntry.latestError = "";
                nextEntry.deliveredAt = now;
                nextEntry.nextAttemptAt = "";
                nextEntry.history = appendReplayHistory(nextEntry, {
                    kind: "replay-succeeded",
                    mode: automatic ? "automatic" : "manual",
                    at: now,
                    attemptCount: delivery.attemptCount,
                    totalAttemptCount: nextEntry.attemptCount,
                    status: nextEntry.status,
                    error: "",
                });
            } else {
                nextEntry.latestError = delivery.errors[delivery.errors.length - 1]?.error ?? "Reply delivery failed";
                nextEntry.errors = [...(Array.isArray(nextEntry.errors) ? nextEntry.errors : []), ...delivery.errors];

                const currentAutomaticReplayCount = normalizeNonNegativeInteger(nextEntry.automaticReplayCount, 0);
                const nextDelayIndex = automatic ? currentAutomaticReplayCount : currentAutomaticReplayCount;
                const nextDelayMs = this.getNextAutomaticReplayDelayMsForIndex(nextDelayIndex);
                const automaticReplayEligible = deliveryReceiptAllowsAutomaticReplay(nextEntry.latestReceipt);

                if (automaticReplayEligible && nextDelayMs >= 0) {
                    nextEntry.status = "pending";
                    nextEntry.nextAttemptAt = createFutureIso(nextDelayMs);
                } else {
                    nextEntry.status = "awaiting-operator";
                    nextEntry.nextAttemptAt = "";
                }

                nextEntry.history = appendReplayHistory(nextEntry, {
                    kind: "replay-failed",
                    mode: automatic ? "automatic" : "manual",
                    at: now,
                    attemptCount: delivery.attemptCount,
                    totalAttemptCount: nextEntry.attemptCount,
                    status: nextEntry.status,
                    error: nextEntry.latestError,
                });
            }

            return nextEntry;
        });

        this.replayQueue.set(updatedEntry.id, updatedEntry);

        return {
            ok: delivery.ok,
            automatic,
            attemptCount: delivery.attemptCount,
            error: delivery.ok ? "" : updatedEntry.latestError,
            entry: summarizeReplayQueueEntryFromStore(updatedEntry),
        };
    }

    async resolveReplayQueueEntry(id, resolution) {
        await this.ensureReady();
        const normalizedId = typeof id === "string" ? id.trim() : "";
        if (!normalizedId) {
            throw new Error("Replay queue entry id is required");
        }

        const normalizedResolution = typeof resolution === "string" && resolution.trim()
            ? resolution.trim()
            : "resolved";
        if (!["resolved", "discarded"].includes(normalizedResolution)) {
            throw new Error(`Unsupported replay queue resolution: ${normalizedResolution}`);
        }

        const entry = await this.replayStore.getReplayQueueEntry(normalizedId);
        if (!entry) {
            throw new Error(`Replay queue entry not found: ${normalizedId}`);
        }
        const processing = normalizeReplayProcessing(entry.processing);
        if (processing?.ownerId) {
            throw new Error(`Replay queue entry is currently being processed by ${processing.ownerKind || processing.ownerId}`);
        }

        const updatedEntry = await this.replayStore.mutateReplayQueue(normalizedId, async (currentEntry) => {
            const nextEntry = normalizeReplayQueueEntryRecordFromStore(currentEntry);
            const now = new Date().toISOString();
            nextEntry.status = normalizedResolution;
            nextEntry.resolvedAt = now;
            nextEntry.updatedAt = now;
            nextEntry.history = appendReplayHistory(nextEntry, {
                kind: normalizedResolution,
                mode: "operator",
                at: now,
                totalAttemptCount: normalizeNonNegativeInteger(nextEntry.attemptCount, 0),
                status: normalizedResolution,
                error: "",
            });
            return nextEntry;
        });
        this.replayQueue.set(updatedEntry.id, updatedEntry);

        return summarizeReplayQueueEntryFromStore(updatedEntry);
    }

    async runDueBackgroundReplays() {
        if (!this.backgroundReplayEnabled || this.backgroundReplayLoopRunning) {
            return;
        }

        this.backgroundReplayLoopRunning = true;
        try {
            await this.ensureReady();
            await this.loadBackgroundReplayControl();
            if (this.isBackgroundReplayPaused()) {
                return;
            }
            await this.loadReplayQueue();
            const now = Date.now();
            const dueEntries = [...this.replayQueue.values()]
                .filter((entry) => String(entry.status ?? "") === "pending")
                .filter((entry) => typeof entry.nextAttemptAt === "string" && entry.nextAttemptAt.trim())
                .filter((entry) => Date.parse(entry.nextAttemptAt) <= now)
                .sort((left, right) => String(left.nextAttemptAt ?? "").localeCompare(String(right.nextAttemptAt ?? "")));

            for (const entry of dueEntries) {
                try {
                    await this.replayQueuedReply(entry.id, {
                        automatic: true,
                        processorOwnerId: `sidecar-worker:${process.pid}`,
                        processorKind: "sidecar-worker",
                    });
                } catch (error) {
                    console.error("[external-ingress] background replay failed:", error);
                }
            }
        } finally {
            this.backgroundReplayLoopRunning = false;
        }
    }
}
