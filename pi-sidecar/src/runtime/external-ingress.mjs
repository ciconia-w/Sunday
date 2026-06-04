import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SUPPORTED_REPLY_TRANSPORTS = [
    "webhook",
    "lark-bot-webhook",
    "dingtalk-bot-webhook",
    "slack-webhook",
    "discord-webhook",
    "teams-webhook",
];
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

function normalizeRetryDelays(value, fallback) {
    if (typeof value !== "string" || !value.trim()) {
        return fallback;
    }

    const normalized = value
        .split(",")
        .map((item) => normalizeNonNegativeInteger(item, -1))
        .filter((item) => item >= 0);

    return normalized.length > 0 ? normalized : fallback;
}

function normalizePositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeReplyTransport(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
        return "";
    }

    if (normalized === "feishu-bot-webhook") {
        return "lark-bot-webhook";
    }

    if (normalized === "slack-incoming-webhook") {
        return "slack-webhook";
    }

    if (normalized === "discord-incoming-webhook") {
        return "discord-webhook";
    }

    if (normalized === "dingtalk-webhook" || normalized === "dingtalk-custom-bot-webhook") {
        return "dingtalk-bot-webhook";
    }

    if (normalized === "msteams-webhook"
        || normalized === "microsoft-teams-webhook"
        || normalized === "teams-incoming-webhook") {
        return "teams-webhook";
    }

    return normalized;
}

export function normalizeBackgroundReplayMode(value) {
    return value === "service" || value === "standalone-service" ? value : "in-process";
}

export function backgroundReplayModeUsesDedicatedService(value) {
    const normalized = normalizeBackgroundReplayMode(value);
    return normalized === "service" || normalized === "standalone-service";
}

export function getBackgroundReplayServiceStatusPath(runtimeDir) {
    return resolve(runtimeDir, "external-ingress-replay-service-status.json");
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

function summarizeReplyPayload(payload) {
    const assistantText = typeof payload?.assistantText === "string" ? payload.assistantText.trim() : "";
    const errorText = typeof payload?.error === "string" ? payload.error.trim() : "";

    return {
        ok: payload?.ok === true,
        assistantTextPreview: assistantText ? assistantText.slice(0, 160) : "",
        errorPreview: errorText ? errorText.slice(0, 160) : "",
    };
}

function summarizeReplayQueueEntry(entry) {
    if (!entry || typeof entry !== "object") {
        return {};
    }

    return {
        id: entry.id ?? "",
        status: entry.status ?? "",
        transport: entry.transport ?? "",
        routeKey: entry.routeKey ?? "",
        conversationId: entry.conversationId ?? "",
        sessionId: entry.sessionId ?? "",
        requestExternalMessageId: entry.requestExternalMessageId ?? "",
        replyTarget: sanitizeReplyTarget(entry.replyTarget),
        payloadSummary: summarizeReplyPayload(entry.payload),
        attemptCount: normalizeNonNegativeInteger(entry.attemptCount, 0),
        replayCount: normalizeNonNegativeInteger(entry.replayCount, 0),
        automaticReplayCount: normalizeNonNegativeInteger(entry.automaticReplayCount, 0),
        latestError: entry.latestError ?? "",
        createdAt: entry.createdAt ?? "",
        updatedAt: entry.updatedAt ?? "",
        deliveredAt: entry.deliveredAt ?? "",
        resolvedAt: entry.resolvedAt ?? "",
        nextAttemptAt: entry.nextAttemptAt ?? "",
        lastAttemptAt: entry.lastAttemptAt ?? "",
        history: normalizeReplayHistory(entry.history, entry),
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

function normalizeReplayQueueEntryRecord(entry) {
    const normalizedEntry = (entry && typeof entry === "object") ? { ...entry } : {};
    normalizedEntry.history = normalizeReplayHistory(normalizedEntry.history, normalizedEntry);
    return normalizedEntry;
}

function createDefaultBackgroundReplayControl() {
    return {
        paused: false,
        pauseReason: "",
        pausedAt: "",
        updatedAt: "",
    };
}

function formatPlainTextReply(payload) {
    if (payload?.ok === true) {
        return typeof payload?.assistantText === "string" && payload.assistantText.trim()
            ? payload.assistantText.trim()
            : "Sunday 已完成处理，但没有生成文本回复。";
    }

    const errorText = typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : "unknown error";
    return `Sunday 处理失败：${errorText}`;
}

function buildSupportedReplyTransports() {
    return [...SUPPORTED_REPLY_TRANSPORTS];
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFutureIso(ms) {
    return new Date(Date.now() + Math.max(0, ms)).toISOString();
}

export class ExternalIngress {
    constructor(options) {
        this.options = options;
        this.routeStorePath = resolve(options.runtimeDir, "external-ingress-routes.json");
        this.deadLetterPath = resolve(options.runtimeDir, "external-ingress-dead-letters.json");
        this.replayQueuePath = resolve(options.runtimeDir, "external-ingress-replay-queue.json");
        this.backgroundReplayControlPath = resolve(options.runtimeDir, "external-ingress-operator-control.json");
        this.backgroundReplayServiceStatusPath = getBackgroundReplayServiceStatusPath(options.runtimeDir);
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
        this.processingReplayEntryIds = new Set();
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
        try {
            const raw = await readFile(this.routeStorePath, "utf8");
            const parsed = JSON.parse(raw);
            const records = Array.isArray(parsed?.routes) ? parsed.routes : [];

            this.routeTargets = new Map(
                records
                    .filter((record) => typeof record?.routeKey === "string" && record.routeKey.trim())
                    .map((record) => [record.routeKey.trim(), record]),
            );
        } catch {
            this.routeTargets = new Map();
        }
    }

    async saveRouteTargets() {
        await mkdir(dirname(this.routeStorePath), { recursive: true });
        const routes = [...this.routeTargets.values()].sort((left, right) =>
            String(left.routeKey ?? "").localeCompare(String(right.routeKey ?? "")),
        );
        await writeFile(this.routeStorePath, JSON.stringify({ routes }, null, 2));
    }

    async loadReplayQueue() {
        try {
            const raw = await readFile(this.replayQueuePath, "utf8");
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

            this.replayQueue = new Map(
                entries
                    .filter((entry) => typeof entry?.id === "string" && entry.id.trim())
                    .map((entry) => {
                        const normalizedEntry = normalizeReplayQueueEntryRecord(entry);
                        return [normalizedEntry.id.trim(), normalizedEntry];
                    }),
            );
        } catch {
            this.replayQueue = new Map();
        }
    }

    async loadBackgroundReplayControl() {
        try {
            const raw = await readFile(this.backgroundReplayControlPath, "utf8");
            const parsed = JSON.parse(raw);
            this.backgroundReplayControl = {
                paused: parsed?.paused === true,
                pauseReason: typeof parsed?.pauseReason === "string" ? parsed.pauseReason : "",
                pausedAt: typeof parsed?.pausedAt === "string" ? parsed.pausedAt : "",
                updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "",
            };
        } catch {
            this.backgroundReplayControl = createDefaultBackgroundReplayControl();
        }
    }

    async saveReplayQueue() {
        await mkdir(dirname(this.replayQueuePath), { recursive: true });
        const entries = [...this.replayQueue.values()].sort((left, right) =>
            String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
        );
        await writeFile(this.replayQueuePath, JSON.stringify({ entries }, null, 2));
    }

    async saveBackgroundReplayControl() {
        await mkdir(dirname(this.backgroundReplayControlPath), { recursive: true });
        await writeFile(
            this.backgroundReplayControlPath,
            JSON.stringify(this.backgroundReplayControl, null, 2),
        );
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

        this.routeTargets.set(route.routeKey, {
            routeKey: route.routeKey,
            source: route.source,
            channelId: route.channelId,
            threadId: route.threadId,
            conversationId: route.conversationId,
            sessionId: route.sessionId,
            replyTarget,
            updatedAt: new Date().toISOString(),
        });
        await this.saveRouteTargets();
    }

    async appendDeadLetter(entry) {
        let existingEntries = [];
        try {
            const raw = await readFile(this.deadLetterPath, "utf8");
            const parsed = JSON.parse(raw);
            existingEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        } catch {
            existingEntries = [];
        }

        await mkdir(dirname(this.deadLetterPath), { recursive: true });
        existingEntries.push(entry);
        await writeFile(this.deadLetterPath, JSON.stringify({ entries: existingEntries }, null, 2));
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
        const includeResolved = options.includeResolved === true;
        const entries = [...this.replayQueue.values()]
            .filter((entry) => includeResolved || !["resolved", "discarded"].includes(String(entry.status ?? "")))
            .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
            .map((entry) => summarizeReplayQueueEntry(entry));

        const counts = {
            total: entries.length,
            pending: entries.filter((entry) => entry.status === "pending").length,
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

        let fileStatus = {};
        try {
            const raw = await readFile(this.backgroundReplayServiceStatusPath, "utf8");
            const parsed = JSON.parse(raw);
            fileStatus = {
                running: parsed?.running === true,
                pid: normalizeNonNegativeInteger(parsed?.pid, 0),
                startedAt: typeof parsed?.startedAt === "string" ? parsed.startedAt : "",
                lastHeartbeatAt: typeof parsed?.lastHeartbeatAt === "string" ? parsed.lastHeartbeatAt : "",
                lastRunAt: typeof parsed?.lastRunAt === "string" ? parsed.lastRunAt : "",
                lastError: typeof parsed?.lastError === "string" ? parsed.lastError : "",
                manager: typeof parsed?.manager === "string" ? parsed.manager : "",
                managedBySidecar: parsed?.managedBySidecar === true,
            };
        } catch {
            fileStatus = {};
        }

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

        let runtimeNote = "background replay 已关闭。";
        if (this.backgroundReplayEnabled && backgroundReplayControl.paused) {
            runtimeNote = "当前 automatic replay 已被 operator 暂停；手动重试和 resolve 仍可继续使用。";
        } else if (this.backgroundReplayEnabled && this.backgroundReplayMode === "service") {
            runtimeNote = backgroundReplayServiceStatus.running
                ? "当前 background replay 由 sidecar 管理的 dedicated replay service 驱动；sidecar 继续保有 route / replay queue 与 operator API。"
                : "当前 background replay 已切到 sidecar-managed dedicated replay service 模式，但 worker 暂未进入稳定运行态。";
        } else if (this.backgroundReplayEnabled && this.backgroundReplayMode === "standalone-service") {
            runtimeNote = backgroundReplayServiceStatus.running
                ? "当前 background replay 由独立 replay service 驱动；sidecar 只保有 route / replay queue 与 operator API。"
                : "当前 background replay 已切到 standalone replay service 模式，但外部 worker 暂未进入稳定运行态。";
        } else if (this.backgroundReplayEnabled) {
            runtimeNote = "当前 background replay worker 仍运行在 sidecar 进程内；更强的 delivery reliability 仍需要 dedicated replay service。";
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
            },
            runtimeNote,
        };
    }

    async createReplayQueueEntry(replyTarget, payload, errors) {
        const now = new Date().toISOString();
        const nextAttemptAt =
            this.backgroundReplayEnabled && this.backgroundReplayDelaysMs.length > 0
                ? createFutureIso(this.backgroundReplayDelaysMs[0])
                : "";
        const entry = {
            id: randomUUID(),
            status: "pending",
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

        this.replayQueue.set(entry.id, entry);
        await this.saveReplayQueue();
        return entry;
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

    async executeReplyDelivery(replyTarget, payload) {
        const errors = [];
        const maxAttempts = this.replyRetryDelaysMs.length + 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const result = await this.postReply(replyTarget, payload);
                return {
                    ok: true,
                    result,
                    errors,
                    attemptCount: attempt,
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                errors.push({
                    attempt,
                    error: errorMessage,
                    at: new Date().toISOString(),
                });

                if (attempt < maxAttempts) {
                    await wait(this.replyRetryDelaysMs[attempt - 1] ?? 0);
                    continue;
                }
            }
        }

        return {
            ok: false,
            errors,
            attemptCount: errors.length,
        };
    }

    createLarkBotSignature(secret) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const stringToSign = `${timestamp}\n${secret}`;
        const sign = createHmac("sha256", stringToSign).digest("base64");

        return {
            timestamp,
            sign,
        };
    }

    createDingtalkBotSignature(secret) {
        const timestamp = String(Date.now());
        const stringToSign = `${timestamp}\n${secret}`;
        const sign = encodeURIComponent(
            createHmac("sha256", secret).update(stringToSign).digest("base64"),
        );

        return {
            timestamp,
            sign,
        };
    }

    buildLarkBotReplyBody(replyTarget, payload) {
        const body = {
            msg_type: "text",
            content: {
                text: formatPlainTextReply(payload),
            },
        };

        if (replyTarget.secret) {
            const signature = this.createLarkBotSignature(replyTarget.secret);
            body.timestamp = signature.timestamp;
            body.sign = signature.sign;
        }

        return body;
    }

    buildSlackReplyBody(payload) {
        return {
            text: formatPlainTextReply(payload),
        };
    }

    buildDingtalkReplyBody(payload) {
        return {
            msgtype: "text",
            text: {
                content: formatPlainTextReply(payload),
            },
        };
    }

    buildDiscordReplyBody(payload) {
        return {
            content: formatPlainTextReply(payload),
        };
    }

    buildTeamsReplyBody(payload) {
        return {
            text: formatPlainTextReply(payload),
        };
    }

    async postGenericWebhookReply(replyTarget, payload) {
        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Reply webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
        };
    }

    async postLarkBotWebhookReply(replyTarget, payload) {
        const body = this.buildLarkBotReplyBody(replyTarget, payload);
        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Lark bot webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
            providerPayload: body,
        };
    }

    async postSlackWebhookReply(replyTarget, payload) {
        const body = this.buildSlackReplyBody(payload);
        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Slack webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
            providerPayload: body,
        };
    }

    async postDingtalkBotWebhookReply(replyTarget, payload) {
        const body = this.buildDingtalkReplyBody(payload);
        const targetUrl = new URL(replyTarget.url);

        if (replyTarget.secret) {
            const signature = this.createDingtalkBotSignature(replyTarget.secret);
            targetUrl.searchParams.set("timestamp", signature.timestamp);
            targetUrl.searchParams.set("sign", signature.sign);
        }

        const response = await fetch(targetUrl.toString(), {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`DingTalk bot webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
            providerPayload: body,
        };
    }

    async postDiscordWebhookReply(replyTarget, payload) {
        const body = this.buildDiscordReplyBody(payload);
        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Discord webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
            providerPayload: body,
        };
    }

    async postTeamsWebhookReply(replyTarget, payload) {
        const body = this.buildTeamsReplyBody(payload);
        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Teams webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
            providerPayload: body,
        };
    }

    async deliverReply(replyTarget, payload) {
        const delivery = await this.executeReplyDelivery(replyTarget, payload);
        if (delivery.ok) {
            return {
                ...delivery.result,
                attemptCount: delivery.attemptCount,
            };
        }

        const replayQueueEntry = await this.createReplayQueueEntry(replyTarget, payload, delivery.errors);
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
        await this.appendDeadLetter(deadLetterEntry);

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

    tryBeginReplayProcessing(id) {
        if (this.processingReplayEntryIds.has(id)) {
            return false;
        }

        this.processingReplayEntryIds.add(id);
        return true;
    }

    finishReplayProcessing(id) {
        this.processingReplayEntryIds.delete(id);
    }

    async replayQueuedReply(id, options = {}) {
        await this.ensureReady();
        const normalizedId = typeof id === "string" ? id.trim() : "";
        if (!normalizedId) {
            throw new Error("Replay queue entry id is required");
        }

        const entry = this.replayQueue.get(normalizedId);
        if (!entry) {
            throw new Error(`Replay queue entry not found: ${normalizedId}`);
        }

        if (["resolved", "discarded"].includes(String(entry.status ?? ""))) {
            throw new Error(`Replay queue entry is already ${entry.status}`);
        }

        if (!this.tryBeginReplayProcessing(normalizedId)) {
            throw new Error(`Replay queue entry is already being processed: ${normalizedId}`);
        }

        try {
            const automatic = options.automatic === true;
            if (automatic && this.isBackgroundReplayPaused()) {
                return {
                    ok: false,
                    automatic: true,
                    skipped: true,
                    reason: "paused",
                    error: "Background replay is paused",
                    entry: summarizeReplayQueueEntry(entry),
                };
            }
            const delivery = await this.executeReplyDelivery(entry.replyTarget ?? {}, entry.payload ?? {});
            const now = new Date().toISOString();
            entry.attemptCount = normalizeNonNegativeInteger(entry.attemptCount, 0) + delivery.attemptCount;
            entry.updatedAt = now;
            entry.lastAttemptAt = now;

            if (automatic) {
                entry.automaticReplayCount = normalizeNonNegativeInteger(entry.automaticReplayCount, 0) + 1;
            } else {
                entry.replayCount = normalizeNonNegativeInteger(entry.replayCount, 0) + 1;
            }

            if (delivery.ok) {
                entry.status = "delivered";
                entry.latestError = "";
                entry.deliveredAt = now;
                entry.nextAttemptAt = "";
                entry.history = appendReplayHistory(entry, {
                    kind: "replay-succeeded",
                    mode: automatic ? "automatic" : "manual",
                    at: now,
                    attemptCount: delivery.attemptCount,
                    totalAttemptCount: entry.attemptCount,
                    status: entry.status,
                    error: "",
                });
            } else {
                entry.latestError = delivery.errors[delivery.errors.length - 1]?.error ?? "Reply delivery failed";
                entry.errors = [...(Array.isArray(entry.errors) ? entry.errors : []), ...delivery.errors];

                const currentAutomaticReplayCount = normalizeNonNegativeInteger(entry.automaticReplayCount, 0);
                const nextDelayIndex = automatic ? currentAutomaticReplayCount : currentAutomaticReplayCount;
                const nextDelayMs = this.getNextAutomaticReplayDelayMsForIndex(nextDelayIndex);

                if (nextDelayMs >= 0) {
                    entry.status = "pending";
                    entry.nextAttemptAt = createFutureIso(nextDelayMs);
                } else {
                    entry.status = "awaiting-operator";
                    entry.nextAttemptAt = "";
                }

                entry.history = appendReplayHistory(entry, {
                    kind: "replay-failed",
                    mode: automatic ? "automatic" : "manual",
                    at: now,
                    attemptCount: delivery.attemptCount,
                    totalAttemptCount: entry.attemptCount,
                    status: entry.status,
                    error: entry.latestError,
                });
            }

            this.replayQueue.set(entry.id, entry);
            await this.saveReplayQueue();

            return {
                ok: delivery.ok,
                automatic,
                attemptCount: delivery.attemptCount,
                error: delivery.ok ? "" : entry.latestError,
                entry: summarizeReplayQueueEntry(entry),
            };
        } finally {
            this.finishReplayProcessing(normalizedId);
        }
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

        const entry = this.replayQueue.get(normalizedId);
        if (!entry) {
            throw new Error(`Replay queue entry not found: ${normalizedId}`);
        }

        const now = new Date().toISOString();
        entry.status = normalizedResolution;
        entry.resolvedAt = now;
        entry.updatedAt = now;
        entry.history = appendReplayHistory(entry, {
            kind: normalizedResolution,
            mode: "operator",
            at: now,
            totalAttemptCount: normalizeNonNegativeInteger(entry.attemptCount, 0),
            status: normalizedResolution,
            error: "",
        });
        this.replayQueue.set(entry.id, entry);
        await this.saveReplayQueue();

        return summarizeReplayQueueEntry(entry);
    }

    async runDueBackgroundReplays() {
        if (!this.backgroundReplayEnabled || this.backgroundReplayLoopRunning) {
            return;
        }

        this.backgroundReplayLoopRunning = true;
        try {
            await this.ensureReady();
            if (this.isBackgroundReplayPaused()) {
                return;
            }
            const now = Date.now();
            const dueEntries = [...this.replayQueue.values()]
                .filter((entry) => String(entry.status ?? "") === "pending")
                .filter((entry) => typeof entry.nextAttemptAt === "string" && entry.nextAttemptAt.trim())
                .filter((entry) => Date.parse(entry.nextAttemptAt) <= now)
                .sort((left, right) => String(left.nextAttemptAt ?? "").localeCompare(String(right.nextAttemptAt ?? "")));

            for (const entry of dueEntries) {
                try {
                    await this.replayQueuedReply(entry.id, { automatic: true });
                } catch (error) {
                    console.error("[external-ingress] background replay failed:", error);
                }
            }
        } finally {
            this.backgroundReplayLoopRunning = false;
        }
    }

    async postReply(replyTarget, payload) {
        if (replyTarget.transport === "webhook") {
            return this.postGenericWebhookReply(replyTarget, payload);
        }

        if (replyTarget.transport === "lark-bot-webhook") {
            return this.postLarkBotWebhookReply(replyTarget, payload);
        }

        if (replyTarget.transport === "slack-webhook") {
            return this.postSlackWebhookReply(replyTarget, payload);
        }

        if (replyTarget.transport === "dingtalk-bot-webhook") {
            return this.postDingtalkBotWebhookReply(replyTarget, payload);
        }

        if (replyTarget.transport === "discord-webhook") {
            return this.postDiscordWebhookReply(replyTarget, payload);
        }

        if (replyTarget.transport === "teams-webhook") {
            return this.postTeamsWebhookReply(replyTarget, payload);
        }

        throw new Error(`Unsupported reply transport: ${replyTarget.transport}`);
    }
}
