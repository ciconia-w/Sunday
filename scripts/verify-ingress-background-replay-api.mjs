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
    return response.json();
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

    async function waitForCallCount(expectedCount, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (calls.length >= expectedCount) {
                return calls.slice(0, expectedCount);
            }
            await wait(250);
        }
        return [...calls];
    }

    try {
        return await run({
            webhookUrl: `http://127.0.0.1:${port}/reply-slack`,
            calls,
            setDeliveryMode(mode) {
                deliveryMode = mode;
            },
            waitForCallCount,
        });
    } finally {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }
}

async function waitForReplayQueueEntry(baseUrl, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;

    while (Date.now() < deadline) {
        latest = await post(baseUrl, "/ingress/get-replay-queue", { includeResolved: true });
        const entries = latest?.result?.entries ?? [];
        const match = entries.find(predicate);
        if (match) {
            return {
                response: latest,
                entry: match,
            };
        }
        await wait(250);
    }

    return {
        response: latest,
        entry: null,
    };
}

const now = Date.now();
const source = "im-slack-demo";
const channelId = `slack-channel-${now}`;
const threadId = `slack-thread-${now}`;
const externalMessageId = `slack-external-${now}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-background-replay-verify-"));
const replayQueuePath = join(runtimeDir, "external-ingress-replay-queue.json");
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");

try {
    let ingressResult = null;
    let replayEntryId = "";
    let replaySummaryBefore = null;
    let replaySummaryAfter = null;
    let routeSummary = null;
    let persistedReplayQueue = null;
    let workerSummary = null;
    let finalWebhookCall = null;
    let callCountBeforeRestart = 0;
    let replayQueueAfterRestart = null;

    await withSlackCollector(async ({ webhookUrl, calls, setDeliveryMode, waitForCallCount }) => {
        const runtimeEnv = {
            PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
            PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "5,10",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "1",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS: "60,120",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS: "20",
        };

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: runtimeEnv,
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    ingressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-slack-worker-ok",
                        externalMessageId,
                        replyTransport: "slack-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(ingressResult.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`Ingress background replay verifier session did not finish: ${cycle.reason}`);
                    }

                    await waitForCallCount(3);

                    const routesResponse = await post(baseUrl, "/ingress/get-reply-routes", {});
                    routeSummary = (routesResponse?.result ?? []).find((entry) => entry?.routeKey === ingressResult.routeKey) ?? null;

                    const pendingEntry = await waitForReplayQueueEntry(
                        baseUrl,
                        (entry) => entry?.requestExternalMessageId === externalMessageId && entry?.status === "pending",
                    );
                    replaySummaryBefore = pendingEntry.entry;
                    replayEntryId = pendingEntry.entry?.id ?? "";
                } finally {
                    await collector.close();
                }
            },
        );

        persistedReplayQueue = JSON.parse(await readFile(replayQueuePath, "utf8"));
        callCountBeforeRestart = calls.length;
        setDeliveryMode("success");

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: runtimeEnv,
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const deliveredEntry = await waitForReplayQueueEntry(
                    baseUrl,
                    (entry) => entry?.id === replayEntryId && entry?.status === "delivered",
                    10000,
                );
                replaySummaryAfter = deliveredEntry.entry;
                workerSummary = deliveredEntry.response?.result?.worker ?? null;
                replayQueueAfterRestart = deliveredEntry.response?.result ?? null;

                await waitForCallCount(callCountBeforeRestart + 1);
                finalWebhookCall = calls[callCountBeforeRestart] ?? null;
            },
        );
    });

    const persistedReplayEntry =
        (Array.isArray(persistedReplayQueue?.entries) ? persistedReplayQueue.entries : []).find((entry) => entry?.id === replayEntryId) ?? null;
    const routeStore = JSON.parse(await readFile(routeStorePath, "utf8"));

    const checks = {
        ingressAccepted: ingressResult?.ok === true,
        slackRouteWasStored: routeSummary?.replyTarget?.transport === "slack-webhook"
            && routeSummary?.replyTarget?.hasSecret === false,
        replayQueueEntryCreated: replaySummaryBefore?.status === "pending"
            && replaySummaryBefore?.attemptCount >= 3
            && replaySummaryBefore?.automaticReplayCount >= 1
            && Boolean(replaySummaryBefore?.nextAttemptAt),
        replayQueuePersisted: persistedReplayEntry?.transport === "slack-webhook"
            && Boolean(persistedReplayEntry?.replyTarget?.url),
        backgroundWorkerMetadataExposed: workerSummary?.enabled === true
            && Array.isArray(workerSummary?.delaysMs)
            && workerSummary?.delaysMs?.[0] === 60,
        backgroundReplaySucceededAfterRestart: replaySummaryAfter?.status === "delivered"
            && replaySummaryAfter?.automaticReplayCount >= 2
            && replaySummaryAfter?.replayCount === 0
            && replaySummaryAfter?.latestError === "",
        slackPayloadWasDelivered: finalWebhookCall?.status === 200
            && finalWebhookCall?.body?.text === "ingress-slack-worker-ok",
        routeStoreWasPersisted: Array.isArray(routeStore?.routes)
            && routeStore.routes.some((entry) => entry?.routeKey === ingressResult?.routeKey && entry?.replyTarget?.transport === "slack-webhook"),
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-background-replay-api-confirmed"
        : "ingress-background-replay-api-incomplete";

    console.log(
        JSON.stringify(
            {
                checks,
                verdict,
                replayEntryId,
                routeSummary,
                replaySummaryBefore,
                replaySummaryAfter,
                workerSummary,
                replayQueueAfterRestart,
            },
            null,
            2,
        ),
    );
    process.exit(verdict === "ingress-background-replay-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
