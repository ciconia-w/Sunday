async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const externalMessageId = `ext-msg-${Date.now()}`;
const channelId = `demo-channel-${Date.now()}`;

const eventResponse = await fetch("http://127.0.0.1:8787/events");
const reader = eventResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let done = false;
const events = [];

const expectedConversationId = `ext-conv-im-demo-${channelId}`;

const readLoop = (async () => {
    while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) continue;
            const evt = JSON.parse(dataLine.slice(6));
            if (evt.sessionId !== `ext-sess-${externalMessageId}`) continue;
            events.push(evt);
            if (evt.event === 2 || evt.event === 3) {
                done = true;
                break;
            }
        }
    }
})();

const ingressResult = await post("/ingress/message", {
    source: "im-demo",
    channelId,
    userId: "demo-user",
    assistantId: "uos-ai-generic",
    text: "Reply with exactly: ingress-ok",
    externalMessageId,
});

const deadline = Date.now() + 45000;
while (!done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
}
await reader.cancel();
await readLoop;

const textParts = events
    .filter((evt) => evt.event === 4)
    .map((evt) => {
        try {
            return JSON.parse(evt.message);
        } catch {
            return null;
        }
    })
    .filter(Boolean)
    .filter((msg) => msg.type === "text")
    .map((msg) => msg.data?.content ?? "");

const combinedText = textParts.join("");

const verdict =
    ingressResult?.ok === true &&
    ingressResult.conversationId === expectedConversationId &&
    events.some((evt) => evt.event === 2) &&
    /ingress-ok/i.test(combinedText)
        ? "ingress-api-confirmed"
        : "ingress-api-incomplete";

console.log(
    JSON.stringify(
        {
            ingressResult,
            combinedText,
            eventCount: events.length,
            verdict,
        },
        null,
        2,
    ),
);
