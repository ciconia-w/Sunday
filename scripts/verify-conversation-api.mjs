const now = Date.now();

const payload = {
    session_id: `sess-${now}`,
    conversation_id: `conv-${now}`,
    assistant: "uos-ai-generic",
    model: "openai/gpt-5.4-mini",
    model_name: "gpt-5.4-mini",
    user: "user",
    params: {},
    message: {
        id: `msg-${now}`,
        previous: "",
        content: [{ type: "text", data: { content: "history-check-message" } }],
        extension: {},
    },
};

const assistantId = `assistant-${now}`;

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const sendRes = await post("/session/send", {
    params: JSON.stringify(payload),
});

const renderRes = await post("/conversation/set-render", {
    conversationId: payload.conversation_id,
    messageId: assistantId,
    renderJson: JSON.stringify([{ type: "text", data: { content: "history-check-reply" } }]),
});

const saveRes = await post("/conversation/save", {
    id: payload.conversation_id,
});

const indexes = await post("/conversation/indexes", {});
const conversation = await post("/conversation/get", { id: payload.conversation_id });

await post("/conversation/delete", {
    ids: [payload.conversation_id],
}).catch(() => undefined);

console.log(
    JSON.stringify(
        {
            sendRes,
            renderRes,
            saveRes,
            indexHit: (indexes.result || []).find((item) => item.id === payload.conversation_id) || null,
            conversation: conversation.result,
            verdict:
                sendRes?.ok === true &&
                renderRes?.result === true &&
                saveRes?.result === true &&
                (indexes.result || []).some((item) => item.id === payload.conversation_id) &&
                conversation?.result?.messages?.[assistantId]
                    ? "conversation-api-confirmed"
                    : "conversation-api-incomplete",
        },
        null,
        2,
    ),
);
