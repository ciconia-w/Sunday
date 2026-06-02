import { readFile } from "node:fs/promises";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";
import { getBuiltBundlePath } from "./paths.mjs";

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

async function run() {
    await withQtVerifyRuntime(
        {
            staticPort: 4193,
            sidecarPort: 8802,
            profilePrefix: "personal-agent-qt-loading-before-first-text-",
        },
        async ({ staticPort, runHost }) => {
            const builtBundle = await readFile(getBuiltBundlePath(), "utf8");
            const frontUrl = buildFrontUrl(staticPort);
            const collector = await collectSession("http://127.0.0.1:8802");
            const hostLog = await runHost(frontUrl, "26000", 32000);
            const events = normalizeEvents(await collector.waitForDone());

            const firstTextEvent = events.find(
                (event) => event.event === 4 && event.parsedMessage.type === "text",
            );

            const hasWaitingLoadingMarker =
                builtBundle.includes("waiting-loading-indicator") &&
                builtBundle.includes("isOnlyEmptyTextItem");
            const hasAvatarLoadingMarker = builtBundle.includes("avatar__orbit--active");
            const hasStreamingStartTiming = hostLog.includes("[Sunday Timing] sunday-send-start");
            const hasFirstTextTiming = hostLog.includes("[Sunday Timing] sunday-first-text");

            const verdict =
                !!firstTextEvent &&
                hasWaitingLoadingMarker &&
                hasAvatarLoadingMarker &&
                hasStreamingStartTiming &&
                hasFirstTextTiming
                    ? "host-qt-loading-before-first-text-confirmed"
                    : "host-qt-loading-before-first-text-incomplete";

            console.log(
                JSON.stringify(
                    {
                        frontUrl,
                        firstTextEvent,
                        hasWaitingLoadingMarker,
                        hasAvatarLoadingMarker,
                        hasStreamingStartTiming,
                        hasFirstTextTiming,
                        hostLog,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "host-qt-loading-before-first-text-confirmed" ? 0 : 1);
        },
    );
}

await run();
