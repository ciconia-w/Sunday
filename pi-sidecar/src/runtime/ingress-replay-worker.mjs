import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
    backgroundReplayModeUsesDedicatedService,
    getBackgroundReplayServiceStatusPath,
    normalizeBackgroundReplayMode,
} from "./external-ingress.mjs";

function normalizeNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body ?? {}),
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Ingress replay service request failed: HTTP ${response.status}`);
    }

    return payload?.result ?? null;
}

function collectDueReplayEntries(queue) {
    const entries = Array.isArray(queue?.entries) ? queue.entries : [];
    const now = Date.now();

    return entries
        .filter((entry) => String(entry?.status ?? "") === "pending")
        .filter((entry) => typeof entry?.nextAttemptAt === "string" && entry.nextAttemptAt.trim())
        .filter((entry) => Date.parse(entry.nextAttemptAt) <= now)
        .sort((left, right) => String(left?.nextAttemptAt ?? "").localeCompare(String(right?.nextAttemptAt ?? "")));
}

const runtimeDir = resolve(process.env.PERSONAL_AGENT_RUNTIME_DIR || resolve(process.cwd(), ".pi-sidecar"));
const baseUrl = typeof process.env.PERSONAL_AGENT_INGRESS_REPLAY_SERVICE_BASE_URL === "string"
    ? process.env.PERSONAL_AGENT_INGRESS_REPLAY_SERVICE_BASE_URL.trim()
    : "";
const backgroundReplayEnabled = String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED ?? "1") !== "0";
const backgroundReplayMode = normalizeBackgroundReplayMode(
    String(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE ?? "in-process").trim(),
);
const pollMs = Math.max(
    50,
    normalizeNonNegativeInteger(process.env.PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS, 5000),
);
const statusPath = getBackgroundReplayServiceStatusPath(runtimeDir);

if (!backgroundReplayEnabled || !backgroundReplayModeUsesDedicatedService(backgroundReplayMode)) {
    process.exit(0);
}

if (!baseUrl) {
    throw new Error("PERSONAL_AGENT_INGRESS_REPLAY_SERVICE_BASE_URL is required in service mode.");
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
    manager: backgroundReplayMode === "service" ? "sidecar" : "external",
    managedBySidecar: backgroundReplayMode === "service",
};

async function persistStatus(partial = {}) {
    Object.assign(state, partial, {
        lastHeartbeatAt: new Date().toISOString(),
    });
    await mkdir(dirname(statusPath), { recursive: true });
    await writeFile(statusPath, JSON.stringify(state, null, 2));
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
        const replayQueue = await postJson(baseUrl, "/ingress/get-replay-queue", {
            includeResolved: false,
        });
        const dueEntries = collectDueReplayEntries(replayQueue);

        for (const entry of dueEntries) {
            await postJson(baseUrl, "/ingress/replay-queue/replay", {
                id: entry.id ?? "",
                automatic: true,
            });
        }

        await persistStatus({
            running: true,
            lastRunAt: cycleStartedAt,
            lastError: "",
        });
    } catch (error) {
        await persistStatus({
            running: true,
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
