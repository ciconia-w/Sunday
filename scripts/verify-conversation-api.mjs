import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

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

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
    const baseUrl = `http://127.0.0.1:${sidecarPort}`;
    const sendRes = await post(baseUrl, "/session/send", {
        params: JSON.stringify(payload),
    });

    const renderRes = await post(baseUrl, "/conversation/set-render", {
        conversationId: payload.conversation_id,
        messageId: assistantId,
        renderJson: JSON.stringify([{ type: "text", data: { content: "history-check-reply" } }]),
    });

    const saveRes = await post(baseUrl, "/conversation/save", {
        id: payload.conversation_id,
    });

    const indexes = await post(baseUrl, "/conversation/indexes", {});
    const conversation = await post(baseUrl, "/conversation/get", { id: payload.conversation_id });

    await post(baseUrl, "/conversation/delete", {
        ids: [payload.conversation_id],
    }).catch(() => undefined);

    const verdict =
        sendRes?.ok === true &&
        renderRes?.result === true &&
        saveRes?.result === true &&
        (indexes.result || []).some((item) => item.id === payload.conversation_id) &&
        conversation?.result?.messages?.[assistantId]
            ? "conversation-api-confirmed"
            : "conversation-api-incomplete";

    console.log(
        JSON.stringify(
            {
                sidecarPort,
                sendRes,
                renderRes,
                saveRes,
                indexHit: (indexes.result || []).find((item) => item.id === payload.conversation_id) || null,
                conversation: conversation.result,
                verdict,
            },
            null,
            2,
        ),
    );

    process.exit(verdict === "conversation-api-confirmed" ? 0 : 1);
});
