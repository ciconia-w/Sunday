import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

function buildFrontUrl(port, prompt) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoSend", prompt);
    url.hash = "/";
    return url.toString();
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
    const dir = await mkdtemp(join(tmpdir(), "personal-agent-qt-tool-"));
    const targetFile = join(dir, "qt-tool.txt");
    const prompt = [
        "Use tools now.",
        `Create this exact file: ${targetFile}`,
        "Write exactly this content into it: qt-tool-file-ok",
        "Then read the file back and reply with exactly: qt-tool-ok",
    ].join("\n");

    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4175,
                sidecarPort: 8789,
                profilePrefix: "personal-agent-qt-tool-flow-",
            },
            async ({ staticPort, sidecarPort, runHost }) => {
        const frontUrl = buildFrontUrl(staticPort, prompt);
        const sidecarBaseUrl = `http://127.0.0.1:${sidecarPort}`;
        const collector = await collectSession(sidecarBaseUrl);
        const hostLog = await runHost(frontUrl, "25000", 30000);
        const events = normalizeEvents(await collector.waitForDone());

        let fileContent = "";
        try {
            fileContent = await readFile(targetFile, "utf8");
        } catch {
            fileContent = "";
        }

        const streamedText = events
            .filter((event) => event.event === 4 && event.parsedMessage.type === "text")
            .map((event) => event.parsedMessage.data?.content || "")
            .join("");
        const toolEvents = events.filter(
            (event) => event.event === 4 && event.parsedMessage.type === "tool",
        );

        const verdict =
            hostLog.includes("[host-qt web] loadFinished true") &&
            events.some((event) => event.event === 1) &&
            events.some((event) => event.event === 2) &&
            toolEvents.length > 0 &&
            toolEvents.some((event) =>
                ["bash", "write", "read"].includes(event.parsedMessage.data?.name || ""),
            ) &&
            fileContent.trim() === "qt-tool-file-ok" &&
            /qt-tool-ok/i.test(streamedText)
                ? "host-qt-tool-flow-confirmed"
                : "host-qt-tool-flow-incomplete";

        const conversationIds = events
            .map((event) => event.parsedMessage.conversation_id || "")
            .filter(Boolean);
        if (conversationIds.length > 0) {
            await post("/conversation/delete", {
                ids: [...new Set(conversationIds)],
            }).catch(() => undefined);
        }

        console.log(
            JSON.stringify(
                    {
                        frontUrl,
                        targetFile,
                        fileContent,
                        streamedText,
                        events,
                        hostLog,
                        verdict,
                    },
                null,
                2,
            ),
        );

        process.exit(verdict === "host-qt-tool-flow-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

await run();
