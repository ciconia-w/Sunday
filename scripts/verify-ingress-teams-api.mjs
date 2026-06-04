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

async function withTeamsCollector(run) {
    const calls = [];
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
                res.end(JSON.stringify({ error: "invalid json" }));
                return;
            }

            calls.push({
                path: req.url ?? "/",
                body: parsed,
            });
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true }));
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
            webhookUrl: `http://127.0.0.1:${port}/reply-teams`,
            calls,
            waitForCallCount,
        });
    } finally {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }
}

const now = Date.now();
const source = "im-teams-demo";
const channelId = `teams-room-${now}`;
const threadId = `teams-thread-${now}`;
const firstExternalMessageId = `teams-first-${now}`;
const secondExternalMessageId = `teams-second-${now}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-teams-verify-"));
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");

try {
    let firstIngressResult = null;
    let secondIngressResult = null;
    let routeSummary = null;
    let routeStore = null;
    let firstCall = null;
    let secondCall = null;
    let collectorWebhookUrl = "";

    await withTeamsCollector(async ({ webhookUrl, waitForCallCount }) => {
        collectorWebhookUrl = webhookUrl;
        await withSidecarRuntime(
            {
                sidecarPort: 8815,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "0",
                },
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    firstIngressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-teams-first-ok",
                        externalMessageId: firstExternalMessageId,
                        replyTransport: "teams-incoming-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(firstIngressResult.sessionId);
                    const firstCycle = await waitForSessionFinish(collector.events, firstIngressResult.sessionId, 1);
                    if (!firstCycle.ok) {
                        throw new Error(`teams ingress verifier first cycle did not finish: ${firstCycle.reason}`);
                    }

                    [firstCall] = await waitForCallCount(1);
                    routeSummary = await post(baseUrl, "/ingress/get-reply-routes", {});

                    secondIngressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-teams-followup-ok",
                        externalMessageId: secondExternalMessageId,
                    });

                    collector.watchedSessionIds.add(secondIngressResult.sessionId);
                    const secondCycle = await waitForSessionFinish(collector.events, secondIngressResult.sessionId, 1);
                    if (!secondCycle.ok) {
                        throw new Error(`teams ingress verifier follow-up cycle did not finish: ${secondCycle.reason}`);
                    }

                    [, secondCall] = await waitForCallCount(2);
                    routeStore = JSON.parse(await readFile(routeStorePath, "utf8"));
                } finally {
                    await collector.close();
                }
            },
        );
    });

    const route = routeSummary?.result?.[0] ?? {};
    const storedRoute = routeStore?.routes?.[0] ?? {};

    const checks = {
        firstReplyUsesTeamsTextShape: firstCall?.body?.text === "ingress-teams-first-ok",
        followupReplyUsesStoredRoute: secondCall?.body?.text === "ingress-teams-followup-ok",
        routeSummaryTransportMatches: route?.replyTarget?.transport === "teams-webhook",
        routeSummaryPersistsUrl: route?.replyTarget?.url === collectorWebhookUrl,
        storedRouteTransportMatches: storedRoute?.replyTarget?.transport === "teams-webhook",
        storedRouteUrlMatches: storedRoute?.replyTarget?.url === collectorWebhookUrl,
        conversationStableAcrossFollowup: firstIngressResult?.conversationId === secondIngressResult?.conversationId,
        sessionStableAcrossFollowup: firstIngressResult?.sessionId === secondIngressResult?.sessionId,
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-teams-api-confirmed"
        : "ingress-teams-api-incomplete";

    console.log(JSON.stringify({
        firstIngressResult,
        secondIngressResult,
        routeSummary,
        storedRoute,
        firstCall,
        secondCall,
        checks,
        verdict,
    }, null, 2));

    process.exit(verdict === "ingress-teams-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
}
