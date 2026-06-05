import { resolve } from "node:path";
import {
    IngressReplayStore,
    appendReplayHistory,
    deliveryReceiptAllowsAutomaticReplay,
    normalizeNonNegativeInteger,
    normalizeReplayProcessing,
    normalizeReplayQueueEntryRecord,
} from "./ingress-replay-store.mjs";
import { executeReplyDelivery, normalizeRetryDelays } from "./ingress-reply-delivery.mjs";
import {
    backgroundReplayModeUsesDedicatedService,
    normalizeBackgroundReplayMode,
} from "./external-ingress.mjs";

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBackgroundReplayStrategy(value) {
    return value === "exponential" ? "exponential" : "fixed";
}

function createFutureIso(ms) {
    return new Date(Date.now() + Math.max(0, ms)).toISOString();
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

function getNextAutomaticReplayDelayMs(delaysMs, index) {
    const normalizedIndex = Math.max(0, index);
    return normalizedIndex < delaysMs.length ? delaysMs[normalizedIndex] : -1;
}

function collectDueReplayEntries(entries) {
    const now = Date.now();

    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => String(entry?.status ?? "") === "pending")
        .filter((entry) => typeof entry?.nextAttemptAt === "string" && entry.nextAttemptAt.trim())
        .filter((entry) => Date.parse(entry.nextAttemptAt) <= now)
        .sort((left, right) => String(left?.nextAttemptAt ?? "").localeCompare(String(right?.nextAttemptAt ?? "")));
}

const runtimeDir = resolve(process.env.PERSONAL_AGENT_RUNTIME_DIR || resolve(process.cwd(), ".pi-sidecar"));
const backgroundReplayEnabled = String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED ?? "1") !== "0";
const backgroundReplayMode = normalizeBackgroundReplayMode(
    String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE ?? "in-process").trim(),
);
const pollMs = Math.max(
    50,
    normalizeNonNegativeInteger(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS, 5000),
);
const backgroundReplayPolicy = buildBackgroundReplayPolicy();
const replyRetryDelaysMs = normalizeRetryDelays(
    process.env.PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS,
    [1000, 3000],
);
const replayStore = new IngressReplayStore(runtimeDir);
const workerKind = backgroundReplayMode === "service" ? "service-worker" : "standalone-worker";
const workerOwnerId = `${workerKind}:${process.pid}`;

if (!backgroundReplayEnabled || !backgroundReplayModeUsesDedicatedService(backgroundReplayMode)) {
    process.exit(0);
}

let stopping = false;
const state = {
    enabled: true,
    running: false,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: "",
    lastRunAt: "",
    lastError: "",
    paused: false,
    pausedAt: "",
    manager: backgroundReplayMode === "service" ? "sidecar" : "external",
    managedBySidecar: backgroundReplayMode === "service",
};

async function persistStatus(partial = {}) {
    Object.assign(state, partial, {
        lastHeartbeatAt: new Date().toISOString(),
    });
    await replayStore.writeBackgroundReplayServiceStatus(state);
}

async function processReplayEntry(entry) {
    const claimedEntry = await replayStore.claimReplayQueueEntry(entry.id, {
        ownerId: workerOwnerId,
        ownerKind: workerKind,
        mode: "automatic",
        ttlMs: Math.max(pollMs * 4, 5000),
    });
    if (!claimedEntry) {
        return null;
    }

    const delivery = await executeReplyDelivery(claimedEntry.replyTarget ?? {}, claimedEntry.payload ?? {}, {
        retryDelaysMs: replyRetryDelaysMs,
        actor: workerKind,
        mode: "automatic",
    });

    return replayStore.mutateReplayQueue(entry.id, async (currentEntry) => {
        const processing = normalizeReplayProcessing(currentEntry.processing);
        if (processing?.ownerId !== workerOwnerId) {
            throw new Error(`Replay queue entry processing ownership changed: ${entry.id}`);
        }

        const nextEntry = normalizeReplayQueueEntryRecord(currentEntry);
        const now = new Date().toISOString();
        nextEntry.processing = null;
        nextEntry.attemptCount = normalizeNonNegativeInteger(nextEntry.attemptCount, 0) + delivery.attemptCount;
        nextEntry.updatedAt = now;
        nextEntry.lastAttemptAt = now;
        nextEntry.latestReceipt = delivery.latestReceipt ?? nextEntry.latestReceipt ?? null;
        nextEntry.automaticReplayCount = normalizeNonNegativeInteger(nextEntry.automaticReplayCount, 0) + 1;

        if (delivery.ok) {
            nextEntry.status = "delivered";
            nextEntry.latestError = "";
            nextEntry.deliveredAt = now;
            nextEntry.nextAttemptAt = "";
            nextEntry.history = appendReplayHistory(nextEntry, {
                kind: "replay-succeeded",
                mode: "automatic",
                at: now,
                attemptCount: delivery.attemptCount,
                totalAttemptCount: nextEntry.attemptCount,
                status: nextEntry.status,
                error: "",
            });
            return nextEntry;
        }

        nextEntry.latestError = delivery.errors[delivery.errors.length - 1]?.error ?? "Reply delivery failed";
        nextEntry.errors = [...(Array.isArray(nextEntry.errors) ? nextEntry.errors : []), ...delivery.errors];

        const automaticReplayEligible = deliveryReceiptAllowsAutomaticReplay(nextEntry.latestReceipt);
        const nextDelayMs = getNextAutomaticReplayDelayMs(
            backgroundReplayPolicy.delaysMs,
            normalizeNonNegativeInteger(nextEntry.automaticReplayCount, 0),
        );

        if (automaticReplayEligible && nextDelayMs >= 0) {
            nextEntry.status = "pending";
            nextEntry.nextAttemptAt = createFutureIso(nextDelayMs);
        } else {
            nextEntry.status = "awaiting-operator";
            nextEntry.nextAttemptAt = "";
        }

        nextEntry.history = appendReplayHistory(nextEntry, {
            kind: "replay-failed",
            mode: "automatic",
            at: now,
            attemptCount: delivery.attemptCount,
            totalAttemptCount: nextEntry.attemptCount,
            status: nextEntry.status,
            error: nextEntry.latestError,
        });
        return nextEntry;
    });
}

process.on("SIGTERM", () => {
    stopping = true;
});

process.on("SIGINT", () => {
    stopping = true;
});

await persistStatus({
    running: true,
});

while (!stopping) {
    const cycleStartedAt = new Date().toISOString();
    try {
        const control = await replayStore.loadBackgroundReplayControl();
        if (control.paused === true) {
            await persistStatus({
                running: true,
                paused: true,
                pausedAt: typeof control.pausedAt === "string" ? control.pausedAt : "",
                lastRunAt: cycleStartedAt,
                lastError: "",
            });
            if (!stopping) {
                await wait(pollMs);
            }
            continue;
        }

        const replayEntries = await replayStore.listReplayQueueEntries();
        const dueEntries = collectDueReplayEntries(replayEntries);
        for (const entry of dueEntries) {
            await processReplayEntry(entry);
        }

        await persistStatus({
            running: true,
            paused: false,
            pausedAt: "",
            lastRunAt: cycleStartedAt,
            lastError: "",
        });
    } catch (error) {
        await persistStatus({
            running: true,
            paused: false,
            pausedAt: "",
            lastRunAt: cycleStartedAt,
            lastError: error instanceof Error ? error.message : String(error),
        });
    }

    if (!stopping) {
        await wait(pollMs);
    }
}

await persistStatus({
    running: false,
});
