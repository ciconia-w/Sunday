import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

function buildFrontUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set(
        "autoSend",
        "请严格输出20行纯文本。每一行都单独成行，格式固定为：第N行：stream-test。不要解释，不要合并。",
    );
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
    await withQtVerifyRuntime(
        {
            staticPort: 4188,
            sidecarPort: 8797,
            profilePrefix: "personal-agent-qt-streaming-",
        },
        async ({ staticPort, runHost }) => {
            const frontUrl = buildFrontUrl(staticPort);
            const collector = await collectSession("http://127.0.0.1:8797");
            const hostLog = await runHost(frontUrl, "26000", 32000);
            const events = normalizeEvents(await collector.waitForDone());

            const textEvents = events.filter(
                (event) => event.event === 4 && event.parsedMessage.type === "text",
            );

            const verdict =
                events.some((event) => event.event === 1) &&
                events.some((event) => event.event === 2) &&
                textEvents.length >= 40
                    ? "host-qt-streaming-confirmed"
                    : "host-qt-streaming-incomplete";

            console.log(
                JSON.stringify(
                    {
                        frontUrl,
                        textEventCount: textEvents.length,
                        sampleTextEvents: textEvents.slice(0, 12),
                        hostLog,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "host-qt-streaming-confirmed" ? 0 : 1);
        },
    );
}

await run();
