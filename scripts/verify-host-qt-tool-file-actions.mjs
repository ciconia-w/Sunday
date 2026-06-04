import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "personal-agent-tool-file-actions-"));
const targetFile = join(tempDir, "tool-file-action-demo.txt");
await writeFile(targetFile, "tool file action", "utf8");

function buildFrontUrl(port) {
    const prompt = [
        "Use tools now.",
        `Read this exact file: ${targetFile}`,
        "Then reply with exactly: tool-file-action-ok",
    ].join("\n");

    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoSend", prompt);
    url.searchParams.set("autoOpenToolFile", "1");
    url.searchParams.set("autoCopyToolPath", "1");
    url.hash = "/";
    return url.toString();
}

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

function normalizeEvents(events) {
    return events.map((event) => {
        let parsedMessage = {};
        try {
            parsedMessage = event.message ? JSON.parse(event.message) : {};
        } catch {
            parsedMessage = {};
        }
        return { ...event, parsedMessage };
    });
}

async function collectSession(baseUrl) {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/events`, { signal: controller.signal });
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
}

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4185,
                sidecarPort: 8794,
                profilePrefix: "personal-agent-qt-tool-file-actions-",
            },
            async ({ staticPort, sidecarPort, runHost }) => {
                const frontUrl = buildFrontUrl(staticPort);
                const sidecarBaseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await collectSession(sidecarBaseUrl);
                const hostLog = await runHost(frontUrl, "26000", 36000);
                const events = normalizeEvents(await collector.waitForDone());
                const sawOpenFileClick = hostLog.includes("[RootWindow] auto tool action clicked: open-file");
                const sawHostOpenFile = hostLog.includes("[host-qt system] openFile") && hostLog.includes(targetFile);
                const sawCopyPathClick = hostLog.includes("[RootWindow] auto tool action clicked: copy-path");
                const streamedText = events
                    .filter((event) => event.event === 4 && event.parsedMessage.type === "text")
                    .map((event) => event.parsedMessage.data?.content || "")
                    .join("");
                const sawAssistantReply = /tool-file-action-ok/i.test(streamedText);

                const verdict =
                    sawOpenFileClick &&
                    sawHostOpenFile &&
                    sawCopyPathClick &&
                    sawAssistantReply
                        ? "host-qt-tool-file-actions-confirmed"
                        : "host-qt-tool-file-actions-incomplete";

                const conversationIds = events
                    .map((event) => event.parsedMessage.conversation_id || "")
                    .filter(Boolean);
                if (conversationIds.length > 0) {
                    await post(sidecarBaseUrl, "/conversation/delete", {
                        ids: [...new Set(conversationIds)],
                    }).catch(() => undefined);
                }

                console.log(
                    JSON.stringify(
                        {
                            targetFile,
                            sawOpenFileClick,
                            sawHostOpenFile,
                            sawCopyPathClick,
                            sawAssistantReply,
                            streamedText,
                            events,
                            hostLog,
                            verdict,
                        },
                        null,
                        2,
                    ),
                );

                process.exit(verdict === "host-qt-tool-file-actions-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

await run();
