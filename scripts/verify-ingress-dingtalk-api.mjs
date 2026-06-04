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

async function withDingTalkCollector(run) {
    const calls = [];
    let deliveryMode = "ok";
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

            const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
            calls.push({
                path: requestUrl.pathname,
                query: Object.fromEntries(requestUrl.searchParams.entries()),
                body: parsed,
                deliveryMode,
            });
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            if (deliveryMode === "app-error") {
                res.end(JSON.stringify({ errcode: 310000, errmsg: "keyword not in whitelist" }));
                return;
            }
            res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
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
            webhookUrl: `http://127.0.0.1:${port}/reply-dingtalk`,
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

function sanitizeRoute(route) {
    if (!route || typeof route !== "object") {
        return route;
    }

    return {
        ...route,
        replyTarget: route.replyTarget
            ? {
                ...route.replyTarget,
                secret: route.replyTarget.secret ? "<redacted>" : "",
            }
            : route.replyTarget,
    };
}

const now = Date.now();
const source = "im-dingtalk-demo";
const channelId = `dingtalk-room-${now}`;
const threadId = `dingtalk-thread-${now}`;
const failingThreadId = `dingtalk-thread-failure-${now}`;
const firstExternalMessageId = `dingtalk-first-${now}`;
const secondExternalMessageId = `dingtalk-second-${now}`;
const failingExternalMessageId = `dingtalk-failure-${now}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-dingtalk-verify-"));
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");

try {
    let firstIngressResult = null;
    let secondIngressResult = null;
    let routeSummary = null;
    let routeStore = null;
    let firstCall = null;
    let secondCall = null;
    let failingIngressResult = null;
    let failingReplayEntry = null;
    let failingCall = null;

    await withDingTalkCollector(async ({ webhookUrl, waitForCallCount, setDeliveryMode }) => {
        await withSidecarRuntime(
            {
                sidecarPort: 8814,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "0",
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
                        text: "Reply with exactly: ingress-dingtalk-first-ok",
                        externalMessageId: firstExternalMessageId,
                        replyTransport: "dingtalk-custom-bot-webhook",
                        replyWebhookUrl: webhookUrl,
                        replyWebhookSecret: "ding-secret-demo",
                    });

                    collector.watchedSessionIds.add(firstIngressResult.sessionId);
                    const firstCycle = await waitForSessionFinish(collector.events, firstIngressResult.sessionId, 1);
                    if (!firstCycle.ok) {
                        throw new Error(`dingtalk ingress verifier first cycle did not finish: ${firstCycle.reason}`);
                    }

                    [firstCall] = await waitForCallCount(1);
                    routeSummary = await post(baseUrl, "/ingress/get-reply-routes", {});

                    secondIngressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-dingtalk-followup-ok",
                        externalMessageId: secondExternalMessageId,
                    });

                    collector.watchedSessionIds.add(secondIngressResult.sessionId);
                    const secondCycle = await waitForSessionFinish(collector.events, secondIngressResult.sessionId, 1);
                    if (!secondCycle.ok) {
                        throw new Error(`dingtalk ingress verifier follow-up cycle did not finish: ${secondCycle.reason}`);
                    }

                    [, secondCall] = await waitForCallCount(2);

                    setDeliveryMode("app-error");
                    failingIngressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId: failingThreadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-dingtalk-failure-ok",
                        externalMessageId: failingExternalMessageId,
                        replyTransport: "dingtalk-bot-webhook",
                        replyWebhookUrl: webhookUrl,
                        replyWebhookSecret: "ding-secret-demo",
                    });

                    collector.watchedSessionIds.add(failingIngressResult.sessionId);
                    const failingCycle = await waitForSessionFinish(collector.events, failingIngressResult.sessionId, 1);
                    if (!failingCycle.ok) {
                        throw new Error(`dingtalk ingress verifier failure cycle did not finish: ${failingCycle.reason}`);
                    }

                    [, , failingCall] = await waitForCallCount(4);
                    const operatorState = await post(baseUrl, "/service-config/get-ingress-operator-state", {
                        includeResolved: true,
                    });
                    failingReplayEntry = operatorState?.result?.replayQueue?.entries?.find(
                        (entry) => entry.routeKey === `${source}:${channelId}:${failingThreadId}`,
                    ) ?? null;
                    routeStore = JSON.parse(await readFile(routeStorePath, "utf8"));
                } finally {
                    await collector.close();
                }
            },
        );
    });

    const storedRoute = routeSummary?.result?.find((entry) => entry.routeKey === `${source}:${channelId}:${threadId}`) ?? null;
    const persistedRoute = routeStore?.routes?.find((entry) => entry.routeKey === `${source}:${channelId}:${threadId}`) ?? null;

    const checks = {
        firstIngressAccepted: firstIngressResult?.ok === true,
        secondIngressAccepted: secondIngressResult?.ok === true,
        failingIngressAccepted: failingIngressResult?.ok === true,
        firstReplyUsesDingtalkBody: firstCall?.body?.msgtype === "text"
            && firstCall?.body?.text?.content === "ingress-dingtalk-first-ok",
        secondReplyUsesStoredRoute: secondCall?.body?.text?.content === "ingress-dingtalk-followup-ok",
        failingReplyUsesDingtalkBody: failingCall?.body?.msgtype === "text"
            && failingCall?.body?.text?.content === "ingress-dingtalk-failure-ok",
        firstReplyIncludesSignedQuery: typeof firstCall?.query?.timestamp === "string"
            && Boolean(firstCall?.query?.timestamp)
            && typeof firstCall?.query?.sign === "string"
            && Boolean(firstCall?.query?.sign),
        secondReplyIncludesStoredSignature: typeof secondCall?.query?.timestamp === "string"
            && Boolean(secondCall?.query?.timestamp)
            && typeof secondCall?.query?.sign === "string"
            && Boolean(secondCall?.query?.sign),
        providerDoesNotUseDiscordShape: !("content" in (firstCall?.body ?? {})),
        routeSummaryNormalizesDingtalkTransport: storedRoute?.replyTarget?.transport === "dingtalk-bot-webhook",
        persistedRouteNormalizesDingtalkTransport: persistedRoute?.replyTarget?.transport === "dingtalk-bot-webhook",
        persistedRouteStoresWebhookUrl: typeof persistedRoute?.replyTarget?.url === "string"
            && persistedRoute.replyTarget.url.includes("/reply-dingtalk"),
        persistedRouteStoresSecret: typeof persistedRoute?.replyTarget?.secret === "string"
            && persistedRoute.replyTarget.secret.length > 0,
        failingReplayEntryCapturesProviderCode: failingReplayEntry?.latestReceipt?.ok === false
            && failingReplayEntry?.latestReceipt?.providerCode === "310000",
        failingReplayEntryCapturesProviderMessage: typeof failingReplayEntry?.latestReceipt?.providerMessage === "string"
            && failingReplayEntry.latestReceipt.providerMessage.includes("keyword not in whitelist"),
        failingReplayEntryCapturesResponsePreview: typeof failingReplayEntry?.latestReceipt?.responseBodyPreview === "string"
            && failingReplayEntry.latestReceipt.responseBodyPreview.includes("errcode"),
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-dingtalk-api-confirmed"
        : "ingress-dingtalk-api-incomplete";

    console.log(JSON.stringify({
        firstIngressResult,
        secondIngressResult,
        failingIngressResult,
        firstCall,
        secondCall,
        failingCall,
        storedRoute: sanitizeRoute(storedRoute),
        persistedRoute: sanitizeRoute(persistedRoute),
        failingReplayEntry,
        checks,
        verdict,
    }, null, 2));

    process.exit(verdict === "ingress-dingtalk-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
