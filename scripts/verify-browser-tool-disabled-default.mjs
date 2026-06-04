import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

const previousConfig = existsSync(browserControlConfigPath)
    ? readFileSync(browserControlConfigPath, "utf8")
    : null;

if (existsSync(browserControlConfigPath)) {
    unlinkSync(browserControlConfigPath);
}

try {
    await withSidecarRuntime(
        {
            sidecarPort: 8806,
        },
        async ({ sidecarPort }) => {
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const sessionId = `browser-tool-disabled-${Date.now()}`;
        const conversationId = `browser-tool-disabled-conv-${Date.now()}`;

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
                                content: "Use the browser_state tool, then reply with exactly: browser-disabled-ok",
                            },
                        },
                    ],
                    extension: {},
                },
            }),
        });

        const events = await collectPromise;
        const toolEvents = events.filter((event) => {
            try {
                const parsed = event.message ? JSON.parse(event.message) : {};
                return parsed.type === "tool" && String(parsed.data?.name || "").startsWith("browser_");
            } catch {
                return false;
            }
        });
        const finalText = events
            .map((event) => {
                try {
                    const parsed = event.message ? JSON.parse(event.message) : {};
                    return parsed.type === "text" ? parsed.data?.content || "" : "";
                } catch {
                    return "";
                }
            })
            .join("");

        const verdict =
            sendResult?.ok &&
            toolEvents.length === 0 &&
            finalText.includes("browser-disabled-ok")
                ? "browser-tool-disabled-default-confirmed"
                : "browser-tool-disabled-default-incomplete";

        console.log(
            JSON.stringify(
                {
                    sidecarPort,
                    sendResult,
                    toolEvents,
                    finalText,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "browser-tool-disabled-default-confirmed" ? 0 : 1);
        },
    );
} finally {
    if (previousConfig === null) {
        if (existsSync(browserControlConfigPath)) {
            unlinkSync(browserControlConfigPath);
        }
    } else {
        writeFileSync(browserControlConfigPath, previousConfig, "utf8");
    }
}
