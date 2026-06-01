import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
    const postToRuntime = async (path, body) => {
        const response = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
        });
        return response.json();
    };

    const initialState = await fetch(`http://127.0.0.1:${sidecarPort}/state`).then((response) => response.json());
    const targetModelId = "deepseek-v4-flash";

    const switchResult = await postToRuntime("/assistant/set-current-model", {
        assistantId: "uos-ai-generic",
        modelId: targetModelId,
    });

    const updatedState = await fetch(`http://127.0.0.1:${sidecarPort}/state`).then((response) => response.json());

    const sessionId = `model-sess-${Date.now()}`;
    const conversationId = `model-conv-${Date.now()}`;
    const payload = {
        session_id: sessionId,
        conversation_id: conversationId,
        assistant: "uos-ai-generic",
        model: `deepseek/${targetModelId}`,
        model_name: targetModelId,
        user: "user",
        params: {},
        message: {
            id: `msg-${Date.now()}`,
            previous: "",
            content: [{ type: "text", data: { content: "Reply with exactly: model-switch-ok" } }],
            extension: {},
        },
    };

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${sidecarPort}/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    const events = [];

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
                if (evt.sessionId !== sessionId) continue;
                events.push(evt);
                if (evt.event === 2 || evt.event === 3) {
                    done = true;
                    controller.abort();
                    break;
                }
            }
        }
    })().catch((error) => {
        if (!String(error).includes("AbortError")) throw error;
    });

    const sendResult = await postToRuntime("/session/send", {
        params: JSON.stringify(payload),
    });

    const deadline = Date.now() + 45000;
    while (!done && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    controller.abort();
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
        Array.isArray(initialState.modelsByAssistant?.["uos-ai-generic"]) &&
        initialState.modelsByAssistant["uos-ai-generic"].some((model) => model.id === "deepseek/deepseek-v4-flash") &&
        switchResult?.result === true &&
        updatedState.currentModelId === "deepseek/deepseek-v4-flash" &&
        sendResult?.ok === true &&
        events.some((evt) => evt.event === 2) &&
        /model-switch-ok/i.test(combinedText)
            ? "model-config-confirmed"
            : "model-config-incomplete";

    await postToRuntime("/conversation/delete", {
        ids: [conversationId],
    }).catch(() => undefined);

    console.log(
        JSON.stringify(
            {
                initialCurrentModelId: initialState.currentModelId,
                availableModels: initialState.modelsByAssistant?.["uos-ai-generic"] ?? [],
                switchResult,
                updatedCurrentModelId: updatedState.currentModelId,
                sendResult,
                combinedText,
                verdict,
            },
            null,
            2,
        ),
    );

    if (verdict !== "model-config-confirmed") {
        process.exit(1);
    }
});
