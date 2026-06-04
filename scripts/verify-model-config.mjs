import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function waitForSessionFinish(events, sessionId, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const sessionEvents = events.filter((evt) => evt.sessionId === sessionId);
        const finishEvent = sessionEvents.find((evt) => evt.event === 2);
        const errorEvent = sessionEvents.find((evt) => evt.event === 3);

        if (errorEvent) {
            return {
                ok: false,
                reason: "session-error",
                sessionEvents,
            };
        }

        if (finishEvent) {
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
    const availableModels = Array.isArray(initialState.modelsByAssistant?.["uos-ai-generic"])
        ? initialState.modelsByAssistant["uos-ai-generic"]
        : [];
    const initialCurrentModelId = typeof initialState.currentModelId === "string" ? initialState.currentModelId.trim() : "";
    const normalizedInitialModelId = initialCurrentModelId.startsWith("deepseek/")
        ? initialCurrentModelId.slice("deepseek/".length)
        : initialCurrentModelId;
    const preferredSwitchOrder = ["deepseek-v4-pro", "deepseek-v4-flash"];
    const targetModelId =
        preferredSwitchOrder.find((modelId) =>
            modelId !== normalizedInitialModelId
            && availableModels.some((model) => model.id === `deepseek/${modelId}`),
        )
        || preferredSwitchOrder.find((modelId) => availableModels.some((model) => model.id === `deepseek/${modelId}`))
        || "deepseek-v4-pro";

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

    const collector = await createEventCollector(`http://127.0.0.1:${sidecarPort}`);
    collector.watchedSessionIds.add(sessionId);

    const sendResult = await postToRuntime("/session/send", {
        params: JSON.stringify(payload),
    });
    const cycle = await waitForSessionFinish(collector.events, sessionId);
    await collector.close();

    const textParts = collector.events
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
        initialState.modelsByAssistant["uos-ai-generic"].some((model) => model.id === `deepseek/${targetModelId}`) &&
        switchResult?.result === true &&
        updatedState.currentModelId === `deepseek/${targetModelId}` &&
        sendResult?.ok === true &&
        cycle.ok === true &&
        /model-switch-ok/i.test(combinedText)
            ? "model-config-confirmed"
            : "model-config-incomplete";

    await postToRuntime("/conversation/delete", {
        ids: [conversationId],
    }).catch(() => undefined);

    console.log(
        JSON.stringify(
            {
                initialCurrentModelId,
                availableModels,
                targetModelId,
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
