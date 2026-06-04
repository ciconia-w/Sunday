import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSidecarDir } from "./paths.mjs";
import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return {
        status: response.status,
        body: await response.json(),
    };
}

async function createEventCollector(baseUrl) {
    const watchedSessionIds = new Set();
    const events = [];
    const decoder = new TextDecoder();
    const controller = new AbortController();
    let buffer = "";
    let stopReading = false;

    const eventResponse = await fetch(`${baseUrl}/events`, {
        signal: controller.signal,
    });
    const reader = eventResponse.body.getReader();
    const readLoop = (async () => {
        try {
            while (!stopReading) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                let chunkEndIndex = -1;
                while ((chunkEndIndex = buffer.indexOf("\n\n")) >= 0) {
                    const chunk = buffer.slice(0, chunkEndIndex);
                    buffer = buffer.slice(chunkEndIndex + 2);
                    const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
                    if (!dataLine) {
                        continue;
                    }

                    const parsed = JSON.parse(dataLine.slice(6));
                    if (watchedSessionIds.size > 0 && !watchedSessionIds.has(parsed.sessionId)) {
                        continue;
                    }

                    events.push(parsed);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stopReading && error?.name !== "AbortError" && !/terminated/i.test(message)) {
                throw error;
            }
        }
    })();

    return {
        events,
        watchedSessionIds,
        async close() {
            stopReading = true;
            controller.abort();
            await reader.cancel().catch(() => undefined);
            await readLoop.catch(() => undefined);
        },
    };
}

async function waitForSessionFinish(events, sessionId, expectedFinishCount, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const sessionEvents = events.filter((evt) => evt.sessionId === sessionId);
        const finishCount = sessionEvents.filter((evt) => evt.event === 2).length;
        const errorEvent = sessionEvents.find((evt) => evt.event === 3);

        if (errorEvent) {
            return {
                ok: false,
                reason: "session-error",
                sessionEvents,
            };
        }

        if (finishCount >= expectedFinishCount) {
            return {
                ok: true,
                sessionEvents,
            };
        }

        await wait(250);
    }

    return {
        ok: false,
        reason: "timeout",
        sessionEvents: events.filter((evt) => evt.sessionId === sessionId),
    };
}

async function waitForOperatorState(baseUrl, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;

    while (Date.now() < deadline) {
        latest = await post(baseUrl, "/service-config/get-ingress-operator-state", { includeResolved: true });
        if (predicate(latest?.body?.result)) {
            return latest;
        }
        await wait(250);
    }

    return latest;
}

async function waitForSuccessfulCall(getCalls, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const call = [...getCalls()].reverse().find((item) => item.status === 200);
        if (call) {
            return call;
        }
        await wait(250);
    }
    return [...getCalls()].reverse().find((item) => item.status === 200) ?? null;
}

async function withSlackCollector(run) {
    const calls = [];
    let deliveryMode = "fail";
    const server = createServer((req, res) => {
        if (req.method !== "POST") {
            res.writeHead(405);
            res.end();
            return;
        }

        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
        });
        req.on("end", () => {
            let parsed = {};
            try {
                parsed = raw ? JSON.parse(raw) : {};
            } catch {
                res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: false, error: "invalid json" }));
                return;
            }

            const status = deliveryMode === "success" ? 200 : 500;
            calls.push({
                path: req.url ?? "/",
                body: parsed,
                status,
            });
            res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
            res.end(status === 200 ? "ok" : "error");
        });
    });

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;

    try {
        return await run({
            webhookUrl: `http://127.0.0.1:${port}/reply-slack`,
            getCalls: () => [...calls],
            setDeliveryMode(mode) {
                deliveryMode = mode;
            },
        });
    } finally {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }
}

function startStandaloneReplayWorker({ runtimeDir, sidecarPort }) {
    return spawn("node", ["./src/runtime/ingress-replay-worker.mjs"], {
        cwd: getSidecarDir(),
        env: {
            ...process.env,
            PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "1",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE: "standalone-service",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_STRATEGY: "exponential",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_INITIAL_DELAY_MS: "200",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_DELAY_MS: "400",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_ATTEMPTS: "3",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS: "20",
            PERSONAL_AGENT_INGRESS_REPLAY_SERVICE_BASE_URL: `http://127.0.0.1:${sidecarPort}`,
        },
        stdio: "ignore",
    });
}

const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-standalone-replay-service-verify-"));
const statusPath = join(runtimeDir, "external-ingress-replay-service-status.json");
const now = Date.now();
const source = "im-standalone-replay-demo";
const channelId = `standalone-replay-channel-${now}`;
const threadId = `standalone-replay-thread-${now}`;

try {
    let initialOperatorState = null;
    let operatorStateAfterDelivery = null;
    let ingressResult = null;
    let serviceStatusFile = null;
    let replayEntry = null;
    let finalWebhookCall = null;
    let observedSidecarPid = 0;

    await withSlackCollector(async ({ webhookUrl, getCalls, setDeliveryMode }) => {
        await withSidecarRuntime(
            {
                sidecarPort: 8815,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "5,10",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "1",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE: "standalone-service",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_STRATEGY: "exponential",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_INITIAL_DELAY_MS: "200",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_DELAY_MS: "400",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_ATTEMPTS: "3",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS: "20",
                },
            },
            async ({ sidecarPort, sidecarPid }) => {
                observedSidecarPid = sidecarPid;
                const worker = startStandaloneReplayWorker({ runtimeDir, sidecarPort });
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    const readyOperatorState = await waitForOperatorState(
                        baseUrl,
                        (state) =>
                            state?.backgroundReplay?.mode === "standalone-service"
                            && state?.backgroundReplay?.deliveryPolicy?.strategy === "exponential"
                            && state?.backgroundReplay?.serviceStatus?.running === true
                            && Number(state?.backgroundReplay?.serviceStatus?.pid ?? 0) > 0
                            && Number(state?.backgroundReplay?.serviceStatus?.pid ?? 0) !== sidecarPid
                            && state?.backgroundReplay?.serviceStatus?.managedBySidecar === false,
                    );
                    initialOperatorState = readyOperatorState?.body?.result ?? null;

                    ingressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-standalone-service-ok",
                        externalMessageId: `standalone-replay-external-${now}`,
                        replyTransport: "slack-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(ingressResult.body?.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.body?.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`standalone replay service verifier session did not finish: ${cycle.reason}`);
                    }

                    const pendingState = await waitForOperatorState(
                        baseUrl,
                        (state) => state?.replayQueue?.entries?.some((entry) =>
                            entry.routeKey === `${source}:${channelId}:${threadId}` && entry.status === "pending"),
                    );
                    replayEntry = pendingState?.body?.result?.replayQueue?.entries?.find((entry) =>
                        entry.routeKey === `${source}:${channelId}:${threadId}`);

                    setDeliveryMode("success");
                    finalWebhookCall = await waitForSuccessfulCall(getCalls, 20000);

                    const deliveredState = await waitForOperatorState(
                        baseUrl,
                        (state) => state?.replayQueue?.entries?.some((entry) =>
                            entry.routeKey === `${source}:${channelId}:${threadId}` && entry.status === "delivered"),
                        20000,
                    );
                    operatorStateAfterDelivery = deliveredState?.body?.result ?? null;
                    serviceStatusFile = JSON.parse(await readFile(statusPath, "utf8"));
                } finally {
                    await collector.close();
                    if (!worker.killed) {
                        worker.kill("SIGTERM");
                    }
                }
            },
        );
    });

    const deliveredEntry = operatorStateAfterDelivery?.replayQueue?.entries?.find((entry) =>
        entry.routeKey === `${source}:${channelId}:${threadId}`) ?? null;
    const serviceStatus = operatorStateAfterDelivery?.backgroundReplay?.serviceStatus ?? null;
    const checks = {
        ingressAccepted: ingressResult?.status === 200 && ingressResult?.body?.ok === true,
        operatorStateUsesStandaloneMode: initialOperatorState?.backgroundReplay?.mode === "standalone-service",
        operatorStateUsesExponentialStrategy: initialOperatorState?.backgroundReplay?.deliveryPolicy?.strategy === "exponential"
            && Number(initialOperatorState?.backgroundReplay?.deliveryPolicy?.multiplier ?? 0) >= 2,
        operatorStateUsesSharedQueueOwnership: initialOperatorState?.backgroundReplay?.ownership?.replayQueuePersistence === "shared-runtime-store"
            && initialOperatorState?.backgroundReplay?.ownership?.automaticReplayExecutor === "standalone-worker-direct"
            && initialOperatorState?.backgroundReplay?.ownership?.serviceUsesSidecarOperatorApi === false,
        serviceManagedExternally: initialOperatorState?.backgroundReplay?.serviceStatus?.managedBySidecar === false
            && initialOperatorState?.backgroundReplay?.serviceStatus?.manager === "external",
        servicePidDiffersFromSidecar: Number(initialOperatorState?.backgroundReplay?.serviceStatus?.pid ?? 0) > 0
            && Number(initialOperatorState?.backgroundReplay?.serviceStatus?.pid ?? 0) !== observedSidecarPid,
        replayEntryCreated: replayEntry?.status === "pending",
        replayDelivered: deliveredEntry?.status === "delivered",
        replayUsedAutomaticPath: Number(deliveredEntry?.automaticReplayCount ?? 0) >= 1,
        replayEntryLatestReceiptTracksStandaloneWorker: deliveredEntry?.latestReceipt?.ok === true
            && deliveredEntry?.latestReceipt?.actor === "standalone-worker"
            && deliveredEntry?.latestReceipt?.mode === "automatic",
        replayEntryProcessingCleared: deliveredEntry?.processing == null,
        serviceRunning: serviceStatus?.running === true,
        statusFileTracksExternalManager: serviceStatusFile?.managedBySidecar === false
            && serviceStatusFile?.manager === "external",
        statusFileTracksHeartbeat: typeof serviceStatusFile?.lastHeartbeatAt === "string" && Boolean(serviceStatusFile.lastHeartbeatAt),
        statusFileTracksRun: typeof serviceStatusFile?.lastRunAt === "string" && Boolean(serviceStatusFile.lastRunAt),
        finalWebhookCallUsesSlackShape: finalWebhookCall?.body?.text === "ingress-standalone-service-ok",
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-standalone-replay-service-api-confirmed"
        : "ingress-standalone-replay-service-api-incomplete";

    console.log(JSON.stringify({
        ingressResult,
        initialOperatorState,
        replayEntry,
        operatorStateAfterDelivery,
        serviceStatusFile,
        finalWebhookCall,
        checks,
        verdict,
    }, null, 2));

    process.exit(verdict === "ingress-standalone-replay-service-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
