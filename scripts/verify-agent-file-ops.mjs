import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const dir = await mkdtemp(join(tmpdir(), "personal-agent-agent-file-"));
const targetFile = join(dir, "agent-created.txt");
const sessionId = `agent-file-${Date.now()}`;
const conversationId = `agent-file-conv-${Date.now()}`;
const initialContent = "agent-file-stage-one";
const updatedContent = "agent-file-stage-two";
const instruction = [
    "Use the available tools to complete the exact file lifecycle below.",
    `Path: ${targetFile}`,
    "Use the write tool to create the file with exactly this content:",
    initialContent,
    "Then use the edit tool to replace the entire file content with exactly this content:",
    updatedContent,
    "Then use the read tool to verify the file now contains exactly that updated content.",
    "Finally, use the bash tool to delete the file with rm.",
    "Do not use bash for the create, update, or read steps.",
    "After the delete step succeeds, reply with exactly: agent-file-lifecycle-complete",
].join("\n");

const payload = {
    session_id: sessionId,
    conversation_id: conversationId,
    assistant: "uos-ai-generic",
    model: "deepseek/deepseek-v4-pro",
    model_name: "deepseek-v4-pro",
    user: "user",
    params: {},
    message: {
        id: `msg-${Date.now()}`,
        previous: "",
        content: [{ type: "text", data: { content: instruction } }],
        extension: {},
    },
};

try {
    await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
        const postToRuntime = async (path, body) => {
            const response = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body ?? {}),
            });
            return response.json();
        };

        const collectSession = async (runtimeSessionId) => {
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
                        if (evt.sessionId !== runtimeSessionId) continue;
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

            return {
                events,
                waitForDone: async () => {
                    const deadline = Date.now() + 90000;
                    while (!done && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 250));
                    }
                    controller.abort();
                    await readLoop;
                    return events;
                },
            };
        };

        const collector = await collectSession(sessionId);
        const sendResult = await postToRuntime("/session/send", {
            params: JSON.stringify(payload),
        });
        const events = await collector.waitForDone();

        const parsedMessages = events
            .filter((evt) => evt.event === 4)
            .map((evt) => {
                try {
                    return JSON.parse(evt.message);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const toolMessages = parsedMessages.filter((message) => message.type === "tool");
        const toolNames = toolMessages.map((message) => message.data?.name ?? "");
        const textContent = parsedMessages
            .filter((message) => message.type === "text")
            .map((message) => message.data?.content ?? "")
            .join("");

        const successfulTools = toolMessages
            .filter((message) => Number(message.data?.status) === 1)
            .map((message) => ({
                name: message.data?.name ?? "",
                resultText: Array.isArray(message.data?.result?.content)
                    ? message.data.result.content
                          .filter((item) => item?.type === "text")
                          .map((item) => item?.text ?? "")
                          .join("\n")
                    : "",
            }));

        let fileExistsAfterRun = true;
        try {
            await access(targetFile);
        } catch {
            fileExistsAfterRun = false;
        }

        const usedWriteTool = successfulTools.some((tool) => tool.name === "write");
        const usedEditTool = successfulTools.some((tool) => tool.name === "edit");
        const usedReadTool = successfulTools.some(
            (tool) => tool.name === "read" && tool.resultText.includes(updatedContent),
        );
        const usedDeleteTool = successfulTools.some((tool) => tool.name === "bash");

        const verdict =
            sendResult?.ok === true &&
            events.some((evt) => evt.event === 2) &&
            usedWriteTool &&
            usedEditTool &&
            usedReadTool &&
            usedDeleteTool &&
            fileExistsAfterRun === false &&
            /agent-file-lifecycle-complete/i.test(textContent)
                ? "agent-file-lifecycle-confirmed"
                : "agent-file-ops-incomplete";

        await postToRuntime("/conversation/delete", {
            ids: [conversationId],
        }).catch(() => undefined);

        console.log(
            JSON.stringify(
                {
                    dir,
                    targetFile,
                    sendResult,
                    toolNames,
                    successfulTools,
                    usedWriteTool,
                    usedEditTool,
                    usedReadTool,
                    usedDeleteTool,
                    fileExistsAfterRun,
                    textContent,
                    verdict,
                },
                null,
                2,
            ),
        );

        if (verdict !== "agent-file-lifecycle-confirmed") {
            process.exit(1);
        }
    });
} finally {
    await rm(dir, { recursive: true, force: true });
}
