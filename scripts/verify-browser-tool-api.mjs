import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const browserControlConfigPath = join(repoRoot, ".run", "browser-control.json");

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

async function collectUntilDone(baseUrl, sessionId) {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
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
                    controller.abort();
                    return events;
                }
            }
        }
    } catch (error) {
        if (!String(error).includes("AbortError")) throw error;
    }
    return events;
}

await withSidecarRuntime(
    {
        sidecarPort: 8805,
    },
    async ({ sidecarPort }) => {
        writeFileSync(browserControlConfigPath, JSON.stringify({ enabled: true }) + "\n", "utf8");
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const sessionId = `browser-tool-session-${Date.now()}`;
        const conversationId = `browser-tool-conv-${Date.now()}`;

        const collectPromise = collectUntilDone(baseUrl, sessionId);
        const sendResult = await post(baseUrl, "/session/send", {
            params: JSON.stringify({
                session_id: sessionId,
                conversation_id: conversationId,
                assistant: "uos-ai-generic",
                model: "deepseek/deepseek-v4-flash",
                model_name: "deepseek-v4-flash",
                user: "user",
                params: {},
                message: {
                    id: `msg-${Date.now()}`,
                    previous: "",
                    content: [
                        {
                            type: "text",
                            data: {
                                content: "Use the browser tool to get the current page state, then reply with exactly: browser-tool-ok",
                            },
                        },
                    ],
                    extension: {},
                },
            }),
        });

        const events = await collectPromise;
        const toolEvents = events
            .map((event) => {
                try {
                    const parsed = event.message ? JSON.parse(event.message) : {};
                    return parsed.type === "tool" && parsed.data?.name === "browser_state"
                        ? { event, parsed }
                        : null;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        const textEvents = events.filter((event) => {
            try {
                const parsed = event.message ? JSON.parse(event.message) : {};
                return parsed.type === "text";
            } catch {
                return false;
            }
        });
        const finalText = textEvents
            .map((event) => {
                try {
                    const parsed = event.message ? JSON.parse(event.message) : {};
                    return parsed.data?.content || "";
                } catch {
                    return "";
                }
            })
            .join("");
        const successfulToolEvents = toolEvents.filter((item) => item?.parsed?.data?.status === 1);
        const failedToolEvents = toolEvents.filter((item) => item?.parsed?.data?.status === 2);
        const verdict =
            sendResult?.ok &&
            successfulToolEvents.length > 0 &&
            failedToolEvents.length === 0 &&
            finalText.includes("browser-tool-ok")
                ? "browser-tool-api-confirmed"
                : "browser-tool-api-incomplete";

        console.log(
            JSON.stringify(
                {
                    sidecarPort,
                    sendResult,
                    toolEvents: toolEvents.map((item) => item?.event),
                    successfulToolEvents: successfulToolEvents.map((item) => item?.event),
                    failedToolEvents: failedToolEvents.map((item) => item?.event),
                    finalText,
                    textEvents: textEvents.slice(-10),
                    verdict,
                },
                null,
                2,
            ),
        );

        try {
            unlinkSync(browserControlConfigPath);
        } catch {}

        process.exit(verdict === "browser-tool-api-confirmed" ? 0 : 1);
    },
);
