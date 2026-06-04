import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

function buildFrontUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoSend", "Reply with exactly: qt-live-ok");
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
            staticPort: 4174,
            sidecarPort: 8787,
            profilePrefix: "personal-agent-qt-live-",
        },
        async ({ staticPort, sidecarPort, runHost }) => {
        const frontUrl = buildFrontUrl(staticPort);
        const sidecarBaseUrl = `http://127.0.0.1:${sidecarPort}`;
        const collector = await collectSession(sidecarBaseUrl);
        const hostLog = await runHost(frontUrl, "25000", 35000);
        const events = normalizeEvents(await collector.waitForDone());
        const conversationIds = events
            .map((event) => event.parsedMessage.conversation_id || "")
            .filter(Boolean);
        const textPayload = events
            .filter((event) => event.event === 4 && event.parsedMessage.type === "text")
            .map((event) => event.parsedMessage.data?.content || "")
            .join("");

        const verdict =
            hostLog.includes("[host-qt web] loadFinished true") &&
            events.some((event) => event.event === 1) &&
            events.some((event) => event.event === 2) &&
            /qt-live-ok/i.test(textPayload)
                ? "host-qt-live-confirmed"
                : "host-qt-live-incomplete";
        if (conversationIds.length > 0) {
            await post(sidecarBaseUrl, "/conversation/delete", {
                ids: [...new Set(conversationIds)],
            }).catch(() => undefined);
        }

        console.log(
            JSON.stringify(
                {
                    frontUrl,
                    events,
                    hostLog,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "host-qt-live-confirmed" ? 0 : 1);
        },
    );
}

await run();
