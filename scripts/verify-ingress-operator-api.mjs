import { createHmac } from "node:crypto";
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

function verifyLarkSignature(body, secret) {
    const timestamp = String(body?.timestamp ?? "");
    const sign = String(body?.sign ?? "");
    if (!timestamp || !sign || !secret) {
        return false;
    }

    const expected = createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
    return expected === sign;
}

async function withOperatorCollector(run) {
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

            const status = deliveryMode === "success" ? 204 : 500;
            calls.push({
                path: req.url ?? "/",
                body: parsed,
                status,
            });
            res.writeHead(status);
            res.end();
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
            webhookUrl: `http://127.0.0.1:${port}/reply-queue`,
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
const source = "im-operator-demo";
const channelId = `operator-channel-${now}`;
const threadId = `operator-thread-${now}`;
const externalMessageId = `operator-external-${now}`;
const larkSecret = "demo-lark-secret";
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-operator-verify-"));
const replayQueuePath = join(runtimeDir, "external-ingress-replay-queue.json");
const deadLetterPath = join(runtimeDir, "external-ingress-dead-letters.json");
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");

try {
    let ingressResult = null;
    let replayEntryId = "";
    let routeSummary = null;
    let replaySummaryBefore = null;
    let replaySummaryAfter = null;
    let replayResolveResult = null;
    let persistedReplayQueue = null;
    let persistedDeadLetters = null;
    let openQueueAfterResolve = null;
    let resolvedQueueAfterResolve = null;
    let replayActionResult = null;
    let finalWebhookCall = null;

    await withOperatorCollector(async ({ webhookUrl, calls, setDeliveryMode, waitForCallCount }) => {
        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "20,40",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "0",
                },
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
                        text: "Reply with exactly: ingress-operator-ok",
                        externalMessageId,
                        replyTransport: "feishu-bot-webhook",
                        replyWebhookUrl: webhookUrl,
                        replyWebhookSecret: larkSecret,
                    });

                    collector.watchedSessionIds.add(ingressResult.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`Ingress operator verifier session did not finish: ${cycle.reason}`);
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
        persistedDeadLetters = JSON.parse(await readFile(deadLetterPath, "utf8"));
        setDeliveryMode("success");

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "20,40",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "0",
                },
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const replayQueueBeforeReplay = await post(baseUrl, "/ingress/get-replay-queue", { includeResolved: true });
                const queueEntryBeforeReplay =
                    (replayQueueBeforeReplay?.result?.entries ?? []).find((entry) => entry?.id === replayEntryId) ?? null;

                if (!queueEntryBeforeReplay) {
                    throw new Error("Replay queue entry did not survive sidecar restart");
                }

                replayActionResult = await post(baseUrl, "/ingress/replay-queue/replay", { id: replayEntryId });
                await waitForCallCount(4);
                finalWebhookCall = calls[calls.length - 1] ?? null;

                const replayQueueAfterReplay = await post(baseUrl, "/ingress/get-replay-queue", { includeResolved: true });
                replaySummaryAfter =
                    (replayQueueAfterReplay?.result?.entries ?? []).find((entry) => entry?.id === replayEntryId) ?? null;

                replayResolveResult = await post(baseUrl, "/ingress/replay-queue/resolve", {
                    id: replayEntryId,
                    resolution: "resolved",
                });
                openQueueAfterResolve = await post(baseUrl, "/ingress/get-replay-queue", {});
                resolvedQueueAfterResolve = await post(baseUrl, "/ingress/get-replay-queue", { includeResolved: true });
            },
        );
    });

    const persistedReplayEntry =
        (Array.isArray(persistedReplayQueue?.entries) ? persistedReplayQueue.entries : []).find((entry) => entry?.id === replayEntryId) ?? null;
    const persistedDeadLetterEntry =
        (Array.isArray(persistedDeadLetters?.entries) ? persistedDeadLetters.entries : []).find(
            (entry) => entry?.replayQueueEntryId === replayEntryId,
        ) ?? null;
    const resolvedEntryAfterResolve =
        (resolvedQueueAfterResolve?.result?.entries ?? []).find((entry) => entry?.id === replayEntryId) ?? null;

    const checks = {
        ingressAccepted: ingressResult?.ok === true,
        replyRouteWasStored: routeSummary?.replyTarget?.transport === "lark-bot-webhook"
            && routeSummary?.replyTarget?.hasSecret === true,
        replayQueueEntryCreated: replaySummaryBefore?.status === "pending"
            && replaySummaryBefore?.attemptCount === 3
            && replaySummaryBefore?.replyTarget?.hasSecret === true
            && !("secret" in (replaySummaryBefore?.replyTarget ?? {})),
        replayQueuePersistedSensitiveTarget: persistedReplayEntry?.replyTarget?.secret === larkSecret,
        deadLetterReferencesReplayQueue: persistedDeadLetterEntry?.replayQueueEntryId === replayEntryId
            && persistedDeadLetterEntry?.attemptCount === 3,
        replaySurvivedRestart: replayActionResult?.ok === true && replayActionResult?.result?.ok === true,
        replaySucceeded: replaySummaryAfter?.status === "delivered"
            && replaySummaryAfter?.replayCount === 1
            && replaySummaryAfter?.latestError === "",
        replayUsedSignedLarkPayload: finalWebhookCall?.status === 204
            && finalWebhookCall?.body?.msg_type === "text"
            && finalWebhookCall?.body?.content?.text?.includes("ingress-operator-ok")
            && verifyLarkSignature(finalWebhookCall?.body, larkSecret),
        resolveHidesEntryFromOpenQueue: (openQueueAfterResolve?.result?.entries ?? []).every((entry) => entry?.id !== replayEntryId),
        resolveKeepsHistoricalEntry: resolvedEntryAfterResolve?.status === "resolved"
            && replayResolveResult?.result?.status === "resolved",
        routeStoreWasPersisted: JSON.parse(await readFile(routeStorePath, "utf8"))?.routes?.some(
            (entry) => entry?.routeKey === ingressResult?.routeKey && entry?.replyTarget?.secret === larkSecret,
        ) === true,
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-operator-api-confirmed"
        : "ingress-operator-api-incomplete";

    console.log(
        JSON.stringify(
            {
                checks,
                verdict,
                replayEntryId,
                routeSummary,
                replaySummaryBefore,
                replaySummaryAfter,
                replayResolveResult,
            },
            null,
            2,
        ),
    );
    process.exit(verdict === "ingress-operator-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
