import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_REPLAY_HISTORY_EVENTS = 12;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

function normalizeStringRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key, item]) => typeof key === "string" && key.trim() && typeof item === "string")
            .map(([key, item]) => [key.trim(), item]),
    );
}

function normalizeProviderCode(value) {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }

    return "";
}

const DELIVERY_RECEIPT_TAXONOMY = Object.freeze([
    {
        id: "success",
        label: "Success",
        automaticReplayEligible: false,
        governanceAction: "none",
        description: "已成功送达，无需进一步治理。",
    },
    {
        id: "transport-network",
        label: "Transport / Network",
        automaticReplayEligible: true,
        governanceAction: "retry",
        description: "网络或连接层错误，适合继续自动重试。",
    },
    {
        id: "http-rate-limit",
        label: "HTTP Rate Limit",
        automaticReplayEligible: true,
        governanceAction: "retry-later",
        description: "上游返回限流状态，适合等待窗口后自动重试。",
    },
    {
        id: "http-server",
        label: "HTTP Server Error",
        automaticReplayEligible: true,
        governanceAction: "retry",
        description: "上游 5xx 或超时类错误，适合继续自动重试。",
    },
    {
        id: "http-auth",
        label: "HTTP Auth Failure",
        automaticReplayEligible: false,
        governanceAction: "check-credentials",
        description: "HTTP 鉴权失败，应该先检查 webhook 凭证或权限。",
    },
    {
        id: "http-client",
        label: "HTTP Client Error",
        automaticReplayEligible: false,
        governanceAction: "fix-request",
        description: "请求本身不合法，应该先修正请求或 endpoint。",
    },
    {
        id: "provider-rate-limit",
        label: "Provider Rate Limit",
        automaticReplayEligible: true,
        governanceAction: "retry-later",
        description: "provider 应用层限流，适合延后自动重试。",
    },
    {
        id: "provider-auth",
        label: "Provider Auth Failure",
        automaticReplayEligible: false,
        governanceAction: "check-credentials",
        description: "provider 应用层鉴权失败，应该先检查 secret、sign 或 token。",
    },
    {
        id: "provider-policy",
        label: "Provider Policy Rejection",
        automaticReplayEligible: false,
        governanceAction: "update-provider-policy",
        description: "provider 策略或内容规则拦截，应该先调整机器人策略或内容。",
    },
    {
        id: "provider-invalid-request",
        label: "Provider Invalid Request",
        automaticReplayEligible: false,
        governanceAction: "fix-request",
        description: "provider 认为请求参数或结构不合法，应该先修正请求。",
    },
    {
        id: "provider-unknown",
        label: "Provider Unknown Failure",
        automaticReplayEligible: false,
        governanceAction: "inspect-provider",
        description: "provider 返回了未归类的应用层失败，应该先人工检查。",
    },
    {
        id: "unknown-failure",
        label: "Unknown Failure",
        automaticReplayEligible: false,
        governanceAction: "inspect-provider",
        description: "当前无法稳定归类，默认交给 operator 判断。",
    },
]);

const DELIVERY_RECEIPT_TAXONOMY_BY_ID = new Map(
    DELIVERY_RECEIPT_TAXONOMY.map((entry) => [entry.id, entry]),
);

function createFutureIso(ms) {
    return new Date(Date.now() + Math.max(0, ms)).toISOString();
}

function normalizeLowerJoinedText(parts) {
    return (Array.isArray(parts) ? parts : [])
        .filter((item) => typeof item === "string" && item.trim())
        .join(" ")
        .toLowerCase();
}

function textIncludesAny(text, candidates) {
    return (Array.isArray(candidates) ? candidates : []).some((candidate) =>
        typeof candidate === "string" && candidate && text.includes(candidate),
    );
}

function normalizeReceiptCategory(value) {
    const normalized = normalizeString(value).trim();
    return DELIVERY_RECEIPT_TAXONOMY_BY_ID.has(normalized) ? normalized : "unknown-failure";
}

function getReceiptTaxonomyEntry(category) {
    return DELIVERY_RECEIPT_TAXONOMY_BY_ID.get(normalizeReceiptCategory(category))
        ?? DELIVERY_RECEIPT_TAXONOMY_BY_ID.get("unknown-failure");
}

function classifyDeliveryReceipt(fields) {
    const ok = fields?.ok === true;
    const statusCode = normalizeNonNegativeInteger(fields?.statusCode, 0);
    const combinedText = normalizeLowerJoinedText([
        normalizeString(fields?.error),
        normalizeProviderCode(fields?.providerCode),
        normalizeString(fields?.providerMessage),
        normalizeString(fields?.responseBodyPreview),
        normalizeString(fields?.statusText),
    ]);

    let receiptCategory = "unknown-failure";

    if (ok) {
        receiptCategory = "success";
    } else if (textIncludesAny(combinedText, [
        "fetch failed",
        "network",
        "socket",
        "timed out",
        "timeout",
        "econnrefused",
        "enotfound",
        "eai_again",
        "connection reset",
        "aborted",
        "connect",
    ])) {
        receiptCategory = "transport-network";
    } else if (textIncludesAny(combinedText, [
        "rate limit",
        "too many requests",
        "quota",
        "throttle",
        "frequency limit",
        "限流",
        "频率",
    ])) {
        receiptCategory = fields?.providerCode ? "provider-rate-limit" : "http-rate-limit";
    } else if (textIncludesAny(combinedText, [
        "signature",
        "invalid signature",
        "sign not match",
        "secret",
        "token",
        "unauthorized",
        "permission denied",
        "access denied",
        "forbidden",
        "credential",
        "鉴权",
        "签名",
        "权限",
    ])) {
        receiptCategory = fields?.providerCode ? "provider-auth" : "http-auth";
    } else if (textIncludesAny(combinedText, [
        "keyword not in whitelist",
        "whitelist",
        "white list",
        "content not allowed",
        "sensitive",
        "policy",
        "关键词",
        "白名单",
        "审核",
    ])) {
        receiptCategory = "provider-policy";
    } else if (textIncludesAny(combinedText, [
        "invalid param",
        "invalid request",
        "bad request",
        "missing",
        "malformed",
        "unsupported",
        "illegal",
        "not found",
        "参数",
        "格式",
        "请求体",
        "payload",
    ])) {
        receiptCategory = fields?.providerCode ? "provider-invalid-request" : "http-client";
    } else if (fields?.providerCode) {
        receiptCategory = "provider-unknown";
    } else if (statusCode === 429) {
        receiptCategory = "http-rate-limit";
    } else if (statusCode === 401 || statusCode === 403) {
        receiptCategory = "http-auth";
    } else if (statusCode >= 500) {
        receiptCategory = "http-server";
    } else if (statusCode >= 400) {
        receiptCategory = "http-client";
    }

    const taxonomyEntry = getReceiptTaxonomyEntry(receiptCategory);
    return {
        receiptCategory: taxonomyEntry.id,
        receiptCategoryLabel: taxonomyEntry.label,
        automaticReplayEligible: taxonomyEntry.automaticReplayEligible,
        governanceAction: taxonomyEntry.governanceAction,
        governanceHint: taxonomyEntry.description,
    };
}

export function getDeliveryReceiptTaxonomy() {
    return DELIVERY_RECEIPT_TAXONOMY.map((entry) => ({ ...entry }));
}

async function readJson(path, fallback) {
    try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
    } catch {
        return typeof fallback === "function" ? fallback() : fallback;
    }
}

async function writeJsonAtomic(path, payload) {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2));
    await rename(tempPath, path);
}

export function createDefaultBackgroundReplayControl() {
    return {
        paused: false,
        pauseReason: "",
        pausedAt: "",
        updatedAt: "",
    };
}

export function getBackgroundReplayServiceStatusPath(runtimeDir) {
    return resolve(runtimeDir, "external-ingress-replay-service-status.json");
}

function createReplayHistoryEvent(event) {
    return {
        kind: normalizeString(event?.kind, "unknown"),
        mode: normalizeString(event?.mode, "unknown"),
        at: normalizeString(event?.at),
        attemptCount: normalizeNonNegativeInteger(event?.attemptCount, 0),
        totalAttemptCount: normalizeNonNegativeInteger(event?.totalAttemptCount, 0),
        status: normalizeString(event?.status),
        error: normalizeString(event?.error),
    };
}

function buildLegacyReplayHistory(entry) {
    const events = [];
    const totalAttemptCount = normalizeNonNegativeInteger(entry?.attemptCount, 0);
    const latestError = normalizeString(entry?.latestError);
    const createdAt = normalizeString(entry?.createdAt);
    const deliveredAt = normalizeString(entry?.deliveredAt);
    const resolvedAt = normalizeString(entry?.resolvedAt);
    const status = normalizeString(entry?.status);

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

export function normalizeReplayHistory(history, fallbackEntry = null) {
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

export function appendReplayHistory(entry, event) {
    const existingHistory = Array.isArray(entry?.history)
        ? entry.history.map((item) => createReplayHistoryEvent(item))
        : normalizeReplayHistory(undefined, entry);

    return normalizeReplayHistory([
        ...existingHistory,
        createReplayHistoryEvent(event),
    ]);
}

export function sanitizeReplyTarget(replyTarget) {
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

function normalizeStoredReplyTarget(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        transport: normalizeString(value.transport),
        url: normalizeString(value.url),
        headers: normalizeStringRecord(value.headers),
        secret: normalizeString(value.secret),
    };
}

export function normalizeReplyRouteRecord(entry) {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    const routeKey = normalizeString(entry.routeKey).trim();
    if (!routeKey) {
        return null;
    }

    return {
        routeKey,
        source: normalizeString(entry.source),
        channelId: normalizeString(entry.channelId),
        threadId: normalizeString(entry.threadId),
        conversationId: normalizeString(entry.conversationId),
        sessionId: normalizeString(entry.sessionId),
        replyTarget: normalizeStoredReplyTarget(entry.replyTarget),
        updatedAt: normalizeString(entry.updatedAt),
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

export function normalizeDeliveryReceipt(value) {
    if (!value || typeof value !== "object") {
        return null;
    }

    const classification = classifyDeliveryReceipt(value);
    return {
        actor: normalizeString(value.actor),
        mode: normalizeString(value.mode),
        transport: normalizeString(value.transport),
        ok: value.ok === true,
        statusCode: normalizeNonNegativeInteger(value.statusCode, 0),
        statusText: normalizeString(value.statusText),
        at: normalizeString(value.at),
        error: normalizeString(value.error),
        providerCode: normalizeProviderCode(value.providerCode),
        providerMessage: normalizeString(value.providerMessage),
        responseBodyPreview: normalizeString(value.responseBodyPreview),
        providerPayloadPreview: normalizeString(value.providerPayloadPreview),
        receiptCategory: normalizeReceiptCategory(value.receiptCategory || classification.receiptCategory),
        receiptCategoryLabel: normalizeString(value.receiptCategoryLabel || classification.receiptCategoryLabel),
        automaticReplayEligible: value.automaticReplayEligible === true || (
            value.automaticReplayEligible !== false && classification.automaticReplayEligible === true
        ),
        governanceAction: normalizeString(value.governanceAction || classification.governanceAction),
        governanceHint: normalizeString(value.governanceHint || classification.governanceHint),
    };
}

export function createDeliveryReceipt({
    actor,
    mode,
    transport,
    ok,
    statusCode,
    statusText,
    at,
    error,
    providerCode,
    providerMessage,
    responseBodyPreview,
    providerPayload,
}) {
    const providerPayloadPreview = (() => {
        if (!providerPayload || typeof providerPayload !== "object") {
            return "";
        }

        try {
            return JSON.stringify(providerPayload).slice(0, 240);
        } catch {
            return "";
        }
    })();

    const classification = classifyDeliveryReceipt({
        ok,
        statusCode,
        statusText,
        error,
        providerCode,
        providerMessage,
        responseBodyPreview,
    });

    return normalizeDeliveryReceipt({
        actor,
        mode,
        transport,
        ok,
        statusCode,
        statusText,
        at,
        error,
        providerCode,
        providerMessage,
        responseBodyPreview: normalizeString(responseBodyPreview).slice(0, 240),
        providerPayloadPreview,
        receiptCategory: classification.receiptCategory,
        receiptCategoryLabel: classification.receiptCategoryLabel,
        automaticReplayEligible: classification.automaticReplayEligible,
        governanceAction: classification.governanceAction,
        governanceHint: classification.governanceHint,
    });
}

export function deliveryReceiptAllowsAutomaticReplay(receipt) {
    return normalizeDeliveryReceipt(receipt)?.automaticReplayEligible === true;
}

export function normalizeReplayProcessing(value) {
    if (!value || typeof value !== "object") {
        return null;
    }

    const ownerId = normalizeString(value.ownerId);
    if (!ownerId) {
        return null;
    }

    return {
        ownerId,
        ownerKind: normalizeString(value.ownerKind),
        mode: normalizeString(value.mode),
        claimedAt: normalizeString(value.claimedAt),
        expiresAt: normalizeString(value.expiresAt),
    };
}

export function createReplayProcessingClaim({ ownerId, ownerKind, mode, ttlMs }) {
    const claimedAt = new Date().toISOString();
    return {
        ownerId: normalizeString(ownerId),
        ownerKind: normalizeString(ownerKind),
        mode: normalizeString(mode),
        claimedAt,
        expiresAt: createFutureIso(ttlMs),
    };
}

function isReplayProcessingActive(processing) {
    const normalized = normalizeReplayProcessing(processing);
    if (!normalized?.expiresAt) {
        return false;
    }

    const expiresAtMs = Date.parse(normalized.expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

export function normalizeReplayQueueEntryRecord(entry) {
    const normalizedEntry = (entry && typeof entry === "object") ? { ...entry } : {};
    normalizedEntry.history = normalizeReplayHistory(normalizedEntry.history, normalizedEntry);
    normalizedEntry.processing = normalizeReplayProcessing(normalizedEntry.processing);
    normalizedEntry.latestReceipt = normalizeDeliveryReceipt(normalizedEntry.latestReceipt);
    return normalizedEntry;
}

export function summarizeReplayQueueEntry(entry) {
    if (!entry || typeof entry !== "object") {
        return {};
    }

    const processing = normalizeReplayProcessing(entry.processing);
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
        latestReceipt: normalizeDeliveryReceipt(entry.latestReceipt),
        processing: processing && isReplayProcessingActive(processing) ? processing : null,
    };
}

export class IngressReplayStore {
    constructor(runtimeDir) {
        this.runtimeDir = runtimeDir;
        this.lockPath = resolve(runtimeDir, "external-ingress-replay-store.lock");
        this.routeStorePath = resolve(runtimeDir, "external-ingress-routes.json");
        this.replayQueuePath = resolve(runtimeDir, "external-ingress-replay-queue.json");
        this.backgroundReplayControlPath = resolve(runtimeDir, "external-ingress-operator-control.json");
        this.deadLetterPath = resolve(runtimeDir, "external-ingress-dead-letters.json");
        this.backgroundReplayServiceStatusPath = getBackgroundReplayServiceStatusPath(runtimeDir);
    }

    async withLock(fn, options = {}) {
        const timeoutMs = normalizeNonNegativeInteger(options.timeoutMs, 5000);
        const pollMs = Math.max(10, normalizeNonNegativeInteger(options.pollMs, 25));
        const deadline = Date.now() + timeoutMs;

        while (true) {
            try {
                await mkdir(this.lockPath);
                break;
            } catch (error) {
                if (error?.code !== "EEXIST") {
                    throw error;
                }

                if (Date.now() >= deadline) {
                    throw new Error("Timed out acquiring ingress replay store lock");
                }

                await wait(pollMs);
            }
        }

        try {
            return await fn();
        } finally {
            await rm(this.lockPath, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    async loadReplayQueueEntries() {
        const parsed = await readJson(this.replayQueuePath, { entries: [] });
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        return entries
            .filter((entry) => typeof entry?.id === "string" && entry.id.trim())
            .map((entry) => normalizeReplayQueueEntryRecord(entry));
    }

    async loadReplyRouteEntries() {
        const parsed = await readJson(this.routeStorePath, { routes: [] });
        const routes = Array.isArray(parsed?.routes) ? parsed.routes : [];
        return routes
            .map((entry) => normalizeReplyRouteRecord(entry))
            .filter(Boolean);
    }

    async saveReplayQueueEntries(entries) {
        const normalizedEntries = (Array.isArray(entries) ? entries : [])
            .map((entry) => normalizeReplayQueueEntryRecord(entry))
            .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
        await writeJsonAtomic(this.replayQueuePath, { entries: normalizedEntries });
    }

    async saveReplyRouteEntries(entries) {
        const normalizedEntries = (Array.isArray(entries) ? entries : [])
            .map((entry) => normalizeReplyRouteRecord(entry))
            .filter(Boolean)
            .sort((left, right) => String(left.routeKey ?? "").localeCompare(String(right.routeKey ?? "")));
        await writeJsonAtomic(this.routeStorePath, { routes: normalizedEntries });
    }

    async getReplayQueueMap() {
        const entries = await this.loadReplayQueueEntries();
        return new Map(entries.map((entry) => [entry.id, entry]));
    }

    async getReplyRouteMap() {
        const entries = await this.loadReplyRouteEntries();
        return new Map(entries.map((entry) => [entry.routeKey, entry]));
    }

    async listReplayQueueEntries() {
        return this.loadReplayQueueEntries();
    }

    async getReplayQueueEntry(id) {
        const normalizedId = normalizeString(id).trim();
        if (!normalizedId) {
            return null;
        }

        const replayQueueMap = await this.getReplayQueueMap();
        return replayQueueMap.get(normalizedId) ?? null;
    }

    async appendReplayQueueEntry(entry) {
        return this.withLock(async () => {
            const replayQueueMap = await this.getReplayQueueMap();
            const normalizedEntry = normalizeReplayQueueEntryRecord(entry);
            replayQueueMap.set(normalizedEntry.id, normalizedEntry);
            await this.saveReplayQueueEntries([...replayQueueMap.values()]);
            return normalizedEntry;
        });
    }

    async upsertReplyRoute(entry) {
        return this.withLock(async () => {
            const routeMap = await this.getReplyRouteMap();
            const normalizedEntry = normalizeReplyRouteRecord(entry);
            if (!normalizedEntry) {
                throw new Error("Reply route record is invalid");
            }
            routeMap.set(normalizedEntry.routeKey, normalizedEntry);
            await this.saveReplyRouteEntries([...routeMap.values()]);
            return normalizedEntry;
        });
    }

    async mutateReplayQueue(id, mutator) {
        return this.withLock(async () => {
            const replayQueueMap = await this.getReplayQueueMap();
            const normalizedId = normalizeString(id).trim();
            const entry = replayQueueMap.get(normalizedId);
            if (!entry) {
                throw new Error(`Replay queue entry not found: ${normalizedId}`);
            }

            const nextEntry = normalizeReplayQueueEntryRecord(await mutator({ ...entry }));
            replayQueueMap.set(nextEntry.id, nextEntry);
            await this.saveReplayQueueEntries([...replayQueueMap.values()]);
            return nextEntry;
        });
    }

    async claimReplayQueueEntry(id, claim) {
        return this.withLock(async () => {
            const replayQueueMap = await this.getReplayQueueMap();
            const normalizedId = normalizeString(id).trim();
            const entry = replayQueueMap.get(normalizedId);
            if (!entry) {
                throw new Error(`Replay queue entry not found: ${normalizedId}`);
            }

            const currentProcessing = normalizeReplayProcessing(entry.processing);
            if (currentProcessing && isReplayProcessingActive(currentProcessing) && currentProcessing.ownerId !== claim.ownerId) {
                return null;
            }

            const nextEntry = normalizeReplayQueueEntryRecord({
                ...entry,
                processing: createReplayProcessingClaim(claim),
                updatedAt: new Date().toISOString(),
            });
            replayQueueMap.set(nextEntry.id, nextEntry);
            await this.saveReplayQueueEntries([...replayQueueMap.values()]);
            return nextEntry;
        });
    }

    async appendDeadLetter(entry) {
        return this.withLock(async () => {
            const parsed = await readJson(this.deadLetterPath, { entries: [] });
            const existingEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
            existingEntries.push(entry);
            await writeJsonAtomic(this.deadLetterPath, { entries: existingEntries });
            return entry;
        });
    }

    async loadBackgroundReplayControl() {
        const parsed = await readJson(this.backgroundReplayControlPath, createDefaultBackgroundReplayControl);
        return {
            paused: parsed?.paused === true,
            pauseReason: normalizeString(parsed?.pauseReason),
            pausedAt: normalizeString(parsed?.pausedAt),
            updatedAt: normalizeString(parsed?.updatedAt),
        };
    }

    async saveBackgroundReplayControl(control) {
        const normalizedControl = {
            paused: control?.paused === true,
            pauseReason: normalizeString(control?.pauseReason),
            pausedAt: normalizeString(control?.pausedAt),
            updatedAt: normalizeString(control?.updatedAt),
        };
        await this.withLock(async () => {
            await writeJsonAtomic(this.backgroundReplayControlPath, normalizedControl);
        });
        return normalizedControl;
    }

    async readBackgroundReplayServiceStatus() {
        const parsed = await readJson(this.backgroundReplayServiceStatusPath, {});
        return {
            enabled: parsed?.enabled === true,
            running: parsed?.running === true,
            pid: normalizeNonNegativeInteger(parsed?.pid, 0),
            restartCount: normalizeNonNegativeInteger(parsed?.restartCount, 0),
            startedAt: normalizeString(parsed?.startedAt),
            lastHeartbeatAt: normalizeString(parsed?.lastHeartbeatAt),
            lastRunAt: normalizeString(parsed?.lastRunAt),
            lastError: normalizeString(parsed?.lastError),
            manager: normalizeString(parsed?.manager, "none"),
            managedBySidecar: parsed?.managedBySidecar === true,
        };
    }

    async writeBackgroundReplayServiceStatus(status) {
        const normalizedStatus = {
            enabled: status?.enabled === true,
            running: status?.running === true,
            pid: normalizeNonNegativeInteger(status?.pid, 0),
            restartCount: normalizeNonNegativeInteger(status?.restartCount, 0),
            startedAt: normalizeString(status?.startedAt),
            lastHeartbeatAt: normalizeString(status?.lastHeartbeatAt),
            lastRunAt: normalizeString(status?.lastRunAt),
            lastError: normalizeString(status?.lastError),
            manager: normalizeString(status?.manager, "none"),
            managedBySidecar: status?.managedBySidecar === true,
            paused: status?.paused === true,
            pausedAt: normalizeString(status?.pausedAt),
            updatedAt: normalizeString(status?.updatedAt),
        };
        await writeJsonAtomic(this.backgroundReplayServiceStatusPath, normalizedStatus);
        return normalizedStatus;
    }
}
