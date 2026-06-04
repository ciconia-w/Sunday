import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function waitForCallCount(getCalls, expectedCount, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const calls = getCalls();
        if (calls.length >= expectedCount) {
            return calls.slice(0, expectedCount);
        }
        await wait(250);
    }
    return getCalls();
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

const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-dedicated-replay-service-verify-"));
const statusPath = join(runtimeDir, "external-ingress-replay-service-status.json");
const now = Date.now();
const source = "im-replay-service-demo";
const channelId = `replay-service-channel-${now}`;
const threadId = `replay-service-thread-${now}`;

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
                sidecarPort: 8813,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "5,10",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "1",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE: "service",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS: "60,120",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS: "20",
                },
            },
            async ({ sidecarPort, sidecarPid }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                observedSidecarPid = sidecarPid;
                const collector = await createEventCollector(baseUrl);

                try {
                    const readyOperatorState = await waitForOperatorState(
                        baseUrl,
                        (state) =>
                            state?.backgroundReplay?.mode === "service"
                            && state?.backgroundReplay?.serviceStatus?.running === true
                            && Number(state?.backgroundReplay?.serviceStatus?.pid ?? 0) > 0
                            && Number(state?.backgroundReplay?.serviceStatus?.pid ?? 0) !== sidecarPid,
                    );
                    initialOperatorState = readyOperatorState?.body?.result ?? null;

                    ingressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-replay-service-ok",
                        externalMessageId: `replay-service-external-${now}`,
                        replyTransport: "slack-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(ingressResult.body.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.body.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`dedicated replay service verifier session did not finish: ${cycle.reason}`);
                    }

                    await waitForCallCount(getCalls, 3);
                    setDeliveryMode("success");

                    const deliveredState = await waitForOperatorState(
                        baseUrl,
                        (state) => {
                            const match = (state?.replayQueue?.entries ?? []).find(
                                (entry) => entry.routeKey === `${source}:${channelId}:${threadId}`,
                            );
                            return match?.status === "delivered" && Number(match?.automaticReplayCount ?? 0) >= 1;
                        },
                        15000,
                    );

                    operatorStateAfterDelivery = deliveredState?.body?.result ?? null;
                    replayEntry = (operatorStateAfterDelivery?.replayQueue?.entries ?? []).find(
                        (entry) => entry.routeKey === `${source}:${channelId}:${threadId}`,
                    ) ?? null;
                    finalWebhookCall = await waitForSuccessfulCall(getCalls);
                    serviceStatusFile = JSON.parse(await readFile(statusPath, "utf8"));
                } finally {
                    await collector.close();
                }
            },
        );
    });

    const serviceStatus = operatorStateAfterDelivery?.backgroundReplay?.serviceStatus ?? null;
    const checks = {
        ingressAccepted: ingressResult?.body?.ok === true,
        operatorStateUsesServiceMode: initialOperatorState?.backgroundReplay?.mode === "service",
        serviceReportedAsDedicated: initialOperatorState?.backgroundReplay?.hasDedicatedReplayService === true,
        operatorStateUsesFixedStrategy: initialOperatorState?.backgroundReplay?.deliveryPolicy?.strategy === "fixed",
        operatorStateUsesSharedRouteOwnership: initialOperatorState?.backgroundReplay?.ownership?.routePersistence === "shared-runtime-store"
            && initialOperatorState?.backgroundReplay?.ownership?.routeMutationAuthority === "sidecar-direct",
        operatorStateUsesSharedQueueOwnership: initialOperatorState?.backgroundReplay?.ownership?.replayQueuePersistence === "shared-runtime-store"
            && initialOperatorState?.backgroundReplay?.ownership?.automaticReplayExecutor === "service-worker-direct"
            && initialOperatorState?.backgroundReplay?.ownership?.serviceUsesSidecarOperatorApi === false,
        serviceManagedBySidecar: initialOperatorState?.backgroundReplay?.serviceStatus?.managedBySidecar === true
            && initialOperatorState?.backgroundReplay?.serviceStatus?.manager === "sidecar",
        servicePidDiffersFromSidecar: Number(initialOperatorState?.backgroundReplay?.serviceStatus?.pid ?? 0) > 0
            && Number(initialOperatorState?.backgroundReplay?.serviceStatus?.pid ?? 0) !== observedSidecarPid,
        serviceRunning: serviceStatus?.running === true,
        replayEntryDelivered: replayEntry?.status === "delivered",
        replayEntryWasAutoRetried: Number(replayEntry?.automaticReplayCount ?? 0) >= 1,
        replayEntryLatestReceiptTracksServiceWorker: replayEntry?.latestReceipt?.ok === true
            && replayEntry?.latestReceipt?.actor === "service-worker"
            && replayEntry?.latestReceipt?.mode === "automatic",
        replayEntryProcessingCleared: replayEntry?.processing == null,
        finalWebhookCallSucceeded: finalWebhookCall?.status === 200,
        finalWebhookCallContainsSlackText: finalWebhookCall?.body?.text === "ingress-replay-service-ok",
        statusFileTracksSidecarManager: serviceStatusFile?.managedBySidecar === true
            && serviceStatusFile?.manager === "sidecar",
        statusFileTracksHeartbeat: typeof serviceStatusFile?.lastHeartbeatAt === "string" && Boolean(serviceStatusFile.lastHeartbeatAt),
        statusFileTracksRun: typeof serviceStatusFile?.lastRunAt === "string" && Boolean(serviceStatusFile.lastRunAt),
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-dedicated-replay-service-api-confirmed"
        : "ingress-dedicated-replay-service-api-incomplete";

    console.log(JSON.stringify({
        initialOperatorState,
        operatorStateAfterDelivery,
        replayEntry,
        finalWebhookCall,
        serviceStatusFile,
        checks,
        verdict,
    }, null, 2));

    process.exit(verdict === "ingress-dedicated-replay-service-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
