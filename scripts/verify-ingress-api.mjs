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

function extractCombinedText(events) {
    return events
        .filter((evt) => evt.event === 4)
        .map((evt) => {
            try {
                return JSON.parse(evt.message);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .filter((message) => message.type === "text")
        .map((message) => message.data?.content ?? "")
        .join("");
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

async function waitForConversation(baseUrl, conversationId, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;

    while (Date.now() < deadline) {
        latest = await post(baseUrl, "/conversation/get", { id: conversationId });
        if (predicate(latest?.result)) {
            return latest?.result ?? null;
        }
        await wait(250);
    }

    return latest?.result ?? null;
}

async function withWebhookCollector(run) {
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
            try {
                calls.push(raw ? JSON.parse(raw) : {});
                res.writeHead(204);
                res.end();
            } catch (error) {
                res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        });
    });

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const webhookUrl =
        address && typeof address === "object"
            ? `http://127.0.0.1:${address.port}/reply`
            : "http://127.0.0.1:0/reply";

    async function waitForCallCount(expectedCount, predicate = () => true, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const matchingCalls = calls.filter(predicate);
            if (matchingCalls.length >= expectedCount) {
                return matchingCalls[expectedCount - 1] ?? null;
            }
            await wait(250);
        }
        return null;
    }

    try {
        return await run({
            webhookUrl,
            calls,
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

const now = Date.now();
const source = "im-demo";
const channelId = `demo-channel-${now}`;
const threadId = `thread-${now}`;
const firstExternalMessageId = `ext-msg-${now}`;
const secondExternalMessageId = `ext-msg-followup-${now}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-verify-"));
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");

try {
    await withWebhookCollector(async ({ webhookUrl, calls, waitForCallCount }) => {
        let firstCycle = null;
        let firstCycleText = "";
        let ingressResult = null;
        let firstConversation = null;
        let firstAssistantMessageId = "";
        let firstWebhookPayload = null;
        let routeStore = null;

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
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
                        text: "Reply with exactly: ingress-ok",
                        externalMessageId: firstExternalMessageId,
                        replyWebhookUrl: webhookUrl,
                        replyWebhookHeaders: {
                            "x-sunday-ingress-test": "phase-1",
                        },
                    });

                    collector.watchedSessionIds.add(ingressResult.sessionId);
                    firstCycle = await waitForSessionFinish(collector.events, ingressResult.sessionId, 1);
                    firstCycleText = extractCombinedText(firstCycle.sessionEvents);
                    firstWebhookPayload = await waitForCallCount(
                        1,
                        (payload) => payload?.requestExternalMessageId === firstExternalMessageId,
                    );
                    firstConversation = await waitForConversation(
                        baseUrl,
                        ingressResult.conversationId,
                        (conversation) => Object.values(conversation?.messages ?? {}).some((message) => message?.role === 2),
                    );
                    const firstAssistantEntry =
                        Object.entries(firstConversation?.messages ?? {}).find(([, message]) => message?.role === 2) ?? [];
                    firstAssistantMessageId = firstAssistantEntry[0] ?? "";
                    routeStore = JSON.parse(await readFile(routeStorePath, "utf8"));
                } finally {
                    await collector.close();
                }
            },
        );

        let followupResult = null;
        let secondCycle = null;
        let secondCycleText = "";
        let secondWebhookPayload = null;
        let conversationAfterFollowup = null;
        let indexes = null;

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "0",
                },
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    followupResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-followup-ok",
                        externalMessageId: secondExternalMessageId,
                    });

                    collector.watchedSessionIds.add(followupResult.sessionId);
                    secondCycle = await waitForSessionFinish(collector.events, followupResult.sessionId, 1);
                    secondCycleText = extractCombinedText(secondCycle.sessionEvents);
                    secondWebhookPayload = await waitForCallCount(
                        1,
                        (payload) => payload?.requestExternalMessageId === secondExternalMessageId,
                    );
                    conversationAfterFollowup = await waitForConversation(
                        baseUrl,
                        ingressResult.conversationId,
                        (conversation) =>
                            Boolean(conversation?.messages?.[secondExternalMessageId])
                            && Object.values(conversation?.messages ?? {}).filter((message) => message?.role === 2).length >= 2,
                    );
                    indexes = await post(baseUrl, "/conversation/indexes", {});
                } finally {
                    await collector.close();
                }
            },
        );

        const assistantMessages = Object.entries(conversationAfterFollowup?.messages ?? {}).filter(
            ([, message]) => message?.role === 2,
        );
        const secondUserMessage = conversationAfterFollowup?.messages?.[secondExternalMessageId] ?? null;
        const storedRoute = (routeStore?.routes ?? []).find((record) => record?.routeKey === ingressResult?.routeKey) ?? null;

        const verdict =
            ingressResult?.ok === true &&
            ingressResult?.threadId === threadId &&
            typeof ingressResult?.routeKey === "string" &&
            firstCycle?.ok === true &&
            /ingress-ok/i.test(firstCycleText) &&
            firstWebhookPayload?.ok === true &&
            firstWebhookPayload?.conversationId === ingressResult?.conversationId &&
            firstWebhookPayload?.sessionId === ingressResult?.sessionId &&
            firstWebhookPayload?.requestExternalMessageId === firstExternalMessageId &&
            /ingress-ok/i.test(firstWebhookPayload?.assistantText ?? "") &&
            storedRoute?.replyTarget?.transport === "webhook" &&
            storedRoute?.replyTarget?.url === webhookUrl &&
            followupResult?.ok === true &&
            ingressResult?.sessionId === followupResult?.sessionId &&
            ingressResult?.conversationId === followupResult?.conversationId &&
            followupResult?.previousMessageId === firstAssistantMessageId &&
            secondCycle?.ok === true &&
            /ingress-followup-ok/i.test(secondCycleText) &&
            secondWebhookPayload?.ok === true &&
            secondWebhookPayload?.conversationId === ingressResult?.conversationId &&
            secondWebhookPayload?.sessionId === ingressResult?.sessionId &&
            secondWebhookPayload?.requestExternalMessageId === secondExternalMessageId &&
            /ingress-followup-ok/i.test(secondWebhookPayload?.assistantText ?? "") &&
            assistantMessages.length >= 2 &&
            secondUserMessage?.previous === firstAssistantMessageId &&
            (indexes?.result ?? []).some((item) => item.id === ingressResult.conversationId)
                ? "ingress-api-confirmed"
                : "ingress-api-incomplete";

        console.log(
            JSON.stringify(
                {
                    runtimeDir,
                    routeStorePath,
                    ingressResult,
                    followupResult,
                    firstAssistantMessageId,
                    firstCycle,
                    firstCycleText,
                    secondCycle,
                    secondCycleText,
                    firstWebhookPayload,
                    secondWebhookPayload,
                    webhookCallCount: calls.length,
                    storedRoute,
                    assistantMessageCount: assistantMessages.length,
                    conversationAfterFollowup,
                    indexHit: (indexes?.result ?? []).find((item) => item.id === ingressResult.conversationId) ?? null,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "ingress-api-confirmed" ? 0 : 1);
    });
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
