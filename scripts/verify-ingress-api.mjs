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

const now = Date.now();
const source = "im-demo";
const channelId = `demo-channel-${now}`;
const threadId = `thread-${now}`;
const firstExternalMessageId = `ext-msg-${now}`;
const secondExternalMessageId = `ext-msg-followup-${now}`;

await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
    const baseUrl = `http://127.0.0.1:${sidecarPort}`;
    const watchedSessionIds = new Set();
    const events = [];
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReading = false;

    const eventResponse = await fetch(`${baseUrl}/events`);
    const reader = eventResponse.body.getReader();
    const readLoop = (async () => {
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
    })();

    try {
        const ingressResult = await post(baseUrl, "/ingress/message", {
            source,
            channelId,
            threadId,
            userId: "demo-user",
            assistantId: "uos-ai-generic",
            text: "Reply with exactly: ingress-ok",
            externalMessageId: firstExternalMessageId,
        });

        watchedSessionIds.add(ingressResult.sessionId);

        const firstCycle = await waitForSessionFinish(events, ingressResult.sessionId, 1);
        const firstCycleText = extractCombinedText(firstCycle.sessionEvents);

        const conversationAfterFirstReply = await waitForConversation(
            baseUrl,
            ingressResult.conversationId,
            (conversation) => Object.values(conversation?.messages ?? {}).some((message) => message?.role === 2),
        );

        const firstAssistantEntry = Object.entries(conversationAfterFirstReply?.messages ?? {})
            .find(([, message]) => message?.role === 2) ?? [];
        const firstAssistantMessageId = firstAssistantEntry[0] ?? "";

        const followupResult = await post(baseUrl, "/ingress/message", {
            source,
            channelId,
            threadId,
            userId: "demo-user",
            assistantId: "uos-ai-generic",
            text: "Reply with exactly: ingress-followup-ok",
            externalMessageId: secondExternalMessageId,
        });

        const secondCycle = await waitForSessionFinish(events, ingressResult.sessionId, 2);
        const secondCycleEvents = secondCycle.sessionEvents.slice(firstCycle.sessionEvents.length);
        const secondCycleText = extractCombinedText(secondCycleEvents);

        const conversationAfterFollowup = await waitForConversation(
            baseUrl,
            ingressResult.conversationId,
            (conversation) =>
                Boolean(conversation?.messages?.[secondExternalMessageId])
                && Object.values(conversation?.messages ?? {}).filter((message) => message?.role === 2).length >= 2,
        );
        const indexes = await post(baseUrl, "/conversation/indexes", {});

        const assistantMessages = Object.entries(conversationAfterFollowup?.messages ?? {})
            .filter(([, message]) => message?.role === 2);
        const secondUserMessage = conversationAfterFollowup?.messages?.[secondExternalMessageId] ?? null;

        const verdict =
            ingressResult?.ok === true &&
            ingressResult?.threadId === threadId &&
            typeof ingressResult?.routeKey === "string" &&
            ingressResult?.sessionId === followupResult?.sessionId &&
            ingressResult?.conversationId === followupResult?.conversationId &&
            followupResult?.previousMessageId === firstAssistantMessageId &&
            firstCycle.ok === true &&
            secondCycle.ok === true &&
            /ingress-ok/i.test(firstCycleText) &&
            /ingress-followup-ok/i.test(secondCycleText) &&
            assistantMessages.length >= 2 &&
            secondUserMessage?.previous === firstAssistantMessageId &&
            (indexes?.result ?? []).some((item) => item.id === ingressResult.conversationId)
                ? "ingress-api-confirmed"
                : "ingress-api-incomplete";

        console.log(
            JSON.stringify(
                {
                    sidecarPort,
                    ingressResult,
                    followupResult,
                    firstAssistantMessageId,
                    firstCycle,
                    firstCycleText,
                    secondCycle,
                    secondCycleText,
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
    } finally {
        stopReading = true;
        await reader.cancel().catch(() => undefined);
        await readLoop.catch(() => undefined);
    }
});
