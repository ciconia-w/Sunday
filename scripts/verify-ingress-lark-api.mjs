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

function verifyLarkSignature(body, secret) {
    const timestamp = String(body?.timestamp ?? "");
    const sign = String(body?.sign ?? "");
    if (!timestamp || !sign || !secret) {
        return false;
    }

    const expected = createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
    return expected === sign;
}

async function withLarkCollector(run) {
    const calls = [];
    const perPathCount = new Map();
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

            const path = req.url ?? "/";
            const nextCount = (perPathCount.get(path) ?? 0) + 1;
            perPathCount.set(path, nextCount);

            let status = 404;
            if (path === "/reply-success") {
                status = nextCount === 1 ? 500 : 204;
            } else if (path === "/reply-dead-letter") {
                status = 500;
            }

            calls.push({
                path,
                body: parsed,
                attempt: nextCount,
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

    async function waitForPathCallCount(path, expectedCount, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const matchingCalls = calls.filter((call) => call.path === path);
            if (matchingCalls.length >= expectedCount) {
                return matchingCalls;
            }
            await wait(250);
        }
        return calls.filter((call) => call.path === path);
    }

    try {
        return await run({
            successWebhookUrl: `http://127.0.0.1:${port}/reply-success`,
            deadLetterWebhookUrl: `http://127.0.0.1:${port}/reply-dead-letter`,
            calls,
            waitForPathCallCount,
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
const successSource = "im-lark-demo";
const successChannelId = `lark-success-channel-${now}`;
const successThreadId = `lark-success-thread-${now}`;
const successFirstExternalMessageId = `lark-success-first-${now}`;
const successSecondExternalMessageId = `lark-success-followup-${now}`;
const deadLetterChannelId = `lark-dead-letter-channel-${now}`;
const deadLetterThreadId = `lark-dead-letter-thread-${now}`;
const deadLetterExternalMessageId = `lark-dead-letter-${now}`;
const larkSecret = "demo-lark-secret";
const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-lark-verify-"));
const routeStorePath = join(runtimeDir, "external-ingress-routes.json");
const deadLetterPath = join(runtimeDir, "external-ingress-dead-letters.json");

try {
    await withLarkCollector(async ({ successWebhookUrl, deadLetterWebhookUrl, calls, waitForPathCallCount }) => {
        let ingressResult = null;
        let firstCycle = null;
        let firstCycleText = "";
        let firstConversation = null;
        let firstAssistantMessageId = "";
        let routeStore = null;

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
                        source: successSource,
                        channelId: successChannelId,
                        threadId: successThreadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-lark-ok",
                        externalMessageId: successFirstExternalMessageId,
                        replyTransport: "lark-bot-webhook",
                        replyWebhookUrl: successWebhookUrl,
                        replyWebhookSecret: larkSecret,
                    });

                    collector.watchedSessionIds.add(ingressResult.sessionId);
                    firstCycle = await waitForSessionFinish(collector.events, ingressResult.sessionId, 1);
                    firstCycleText = extractCombinedText(firstCycle.sessionEvents);
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

        const successAttemptsAfterFirst = await waitForPathCallCount("/reply-success", 2);

        let followupResult = null;
        let secondCycle = null;
        let secondCycleText = "";
        let conversationAfterFollowup = null;
        let indexes = null;

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
                    followupResult = await post(baseUrl, "/ingress/message", {
                        source: successSource,
                        channelId: successChannelId,
                        threadId: successThreadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-lark-followup-ok",
                        externalMessageId: successSecondExternalMessageId,
                    });

                    collector.watchedSessionIds.add(followupResult.sessionId);
                    secondCycle = await waitForSessionFinish(collector.events, followupResult.sessionId, 1);
                    secondCycleText = extractCombinedText(secondCycle.sessionEvents);
                    conversationAfterFollowup = await waitForConversation(
                        baseUrl,
                        ingressResult.conversationId,
                        (conversation) =>
                            Boolean(conversation?.messages?.[successSecondExternalMessageId])
                            && Object.values(conversation?.messages ?? {}).filter((message) => message?.role === 2).length >= 2,
                    );
                    indexes = await post(baseUrl, "/conversation/indexes", {});
                } finally {
                    await collector.close();
                }
            },
        );

        const successAttemptsAfterFollowup = await waitForPathCallCount("/reply-success", 3);

        let deadLetterIngressResult = null;
        let deadLetterCycle = null;
        let deadLetterCycleText = "";

        await withSidecarRuntime(
            {
                sidecarPort: 8787,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "20,40",
                },
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    deadLetterIngressResult = await post(baseUrl, "/ingress/message", {
                        source: successSource,
                        channelId: deadLetterChannelId,
                        threadId: deadLetterThreadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-lark-dead-letter-ok",
                        externalMessageId: deadLetterExternalMessageId,
                        replyTransport: "feishu-bot-webhook",
                        replyWebhookUrl: deadLetterWebhookUrl,
                        replyWebhookSecret: larkSecret,
                    });

                    collector.watchedSessionIds.add(deadLetterIngressResult.sessionId);
                    deadLetterCycle = await waitForSessionFinish(collector.events, deadLetterIngressResult.sessionId, 1);
                    deadLetterCycleText = extractCombinedText(deadLetterCycle.sessionEvents);
                } finally {
                    await collector.close();
                }
            },
        );

        const deadLetterAttempts = await waitForPathCallCount("/reply-dead-letter", 3);
        const deadLetterStore = JSON.parse(await readFile(deadLetterPath, "utf8"));

        const storedRoute = (routeStore?.routes ?? []).find((record) => record?.routeKey === ingressResult?.routeKey) ?? null;
        const secondUserMessage = conversationAfterFollowup?.messages?.[successSecondExternalMessageId] ?? null;
        const assistantMessages = Object.entries(conversationAfterFollowup?.messages ?? {}).filter(
            ([, message]) => message?.role === 2,
        );
        const deadLetterEntry = (deadLetterStore?.entries ?? []).find(
            (entry) => entry?.requestExternalMessageId === deadLetterExternalMessageId,
        ) ?? null;

        const firstSuccessAttempt = successAttemptsAfterFirst[0] ?? null;
        const secondSuccessAttempt = successAttemptsAfterFirst[1] ?? null;
        const followupSuccessAttempt = successAttemptsAfterFollowup[2] ?? null;

        const verdict =
            ingressResult?.ok === true &&
            firstCycle?.ok === true &&
            /ingress-lark-ok/i.test(firstCycleText) &&
            storedRoute?.replyTarget?.transport === "lark-bot-webhook" &&
            storedRoute?.replyTarget?.url === successWebhookUrl &&
            storedRoute?.replyTarget?.secret === larkSecret &&
            successAttemptsAfterFirst.length >= 2 &&
            firstSuccessAttempt?.status === 500 &&
            secondSuccessAttempt?.status === 204 &&
            secondSuccessAttempt?.body?.msg_type === "text" &&
            /ingress-lark-ok/i.test(secondSuccessAttempt?.body?.content?.text ?? "") &&
            verifyLarkSignature(secondSuccessAttempt?.body, larkSecret) &&
            followupResult?.ok === true &&
            followupResult?.conversationId === ingressResult?.conversationId &&
            followupResult?.sessionId === ingressResult?.sessionId &&
            followupResult?.previousMessageId === firstAssistantMessageId &&
            secondCycle?.ok === true &&
            /ingress-lark-followup-ok/i.test(secondCycleText) &&
            followupSuccessAttempt?.status === 204 &&
            /ingress-lark-followup-ok/i.test(followupSuccessAttempt?.body?.content?.text ?? "") &&
            verifyLarkSignature(followupSuccessAttempt?.body, larkSecret) &&
            assistantMessages.length >= 2 &&
            secondUserMessage?.previous === firstAssistantMessageId &&
            (indexes?.result ?? []).some((item) => item.id === ingressResult.conversationId) &&
            deadLetterIngressResult?.ok === true &&
            deadLetterCycle?.ok === true &&
            /ingress-lark-dead-letter-ok/i.test(deadLetterCycleText) &&
            deadLetterAttempts.length >= 3 &&
            deadLetterAttempts.every((attempt) => attempt.status === 500) &&
            deadLetterAttempts.every((attempt) => verifyLarkSignature(attempt.body, larkSecret)) &&
            deadLetterEntry?.transport === "lark-bot-webhook" &&
            deadLetterEntry?.attemptCount === 3 &&
            deadLetterEntry?.replyTarget?.hasSecret === true &&
            deadLetterEntry?.errors?.length === 3
                ? "ingress-lark-api-confirmed"
                : "ingress-lark-api-incomplete";

        console.log(
            JSON.stringify(
                {
                    runtimeDir,
                    routeStorePath,
                    deadLetterPath,
                    ingressResult,
                    followupResult,
                    deadLetterIngressResult,
                    firstAssistantMessageId,
                    firstCycle,
                    firstCycleText,
                    secondCycle,
                    secondCycleText,
                    deadLetterCycle,
                    deadLetterCycleText,
                    successAttemptsAfterFirst,
                    successAttemptsAfterFollowup,
                    deadLetterAttempts,
                    storedRoute,
                    deadLetterEntry,
                    assistantMessageCount: assistantMessages.length,
                    conversationAfterFollowup,
                    allCallCount: calls.length,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "ingress-lark-api-confirmed" ? 0 : 1);
    });
} finally {
    await rm(runtimeDir, { recursive: true, force: true });
}
