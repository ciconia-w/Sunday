import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

async function get(baseUrl, path) {
    const response = await fetch(`${baseUrl}${path}`);
    return response.json();
}

async function collectSession(baseUrl, runtimeSessionId) {
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
}

function buildSeedPrompt(seedPath) {
    return [
        "Use tools now.",
        `Read this exact file: ${seedPath}`,
        "Then reply with exactly: recent-conversation-ready",
    ].join("\n");
}

function buildWelcomeUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoOpenRecentConversation", "1");
    url.hash = "/";
    return url.toString();
}

async function run() {
    await withQtVerifyRuntime(
        {
            staticPort: 4189,
            sidecarPort: 8798,
            profilePrefix: "personal-agent-qt-recent-conversation-",
        },
        async ({ staticPort, sidecarPort, runHost }) => {
            const sidecarBaseUrl = `http://127.0.0.1:${sidecarPort}`;
            const seedPath = "/etc/hostname";
            const sessionId = `recent-conversation-session-${Date.now()}`;
            const conversationId = `recent-conversation-conv-${Date.now()}`;
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
                    content: [{ type: "text", data: { content: buildSeedPrompt(seedPath) } }],
                    extension: {},
                },
            };
            const collector = await collectSession(sidecarBaseUrl, sessionId);
            const seedSendResult = await post(sidecarBaseUrl, "/session/send", {
                params: JSON.stringify(payload),
            });

            if (!seedSendResult?.ok) {
                throw new Error(`Failed to seed recent conversation: ${JSON.stringify(seedSendResult)}`);
            }

            await collector.waitForDone();

            const beforeIndexes = await post(sidecarBaseUrl, "/conversation/indexes", {});
            const beforeConversations = beforeIndexes?.result ?? [];
            const targetConversation =
                beforeConversations.find((item) => item.id === conversationId) ??
                beforeConversations.find((item) => item.assistant === "uos-ai-generic");
            if (!targetConversation?.id) {
                throw new Error("Failed to locate seeded Sunday conversation.");
            }

            const frontUrl = buildWelcomeUrl(staticPort);
            const hostLog = await runHost(frontUrl, "12000", 18000);

            const sawRecentCardClick = hostLog.includes("[RootWindow] auto recent conversation clicked:");
            const sawRecentSummary =
                hostLog.includes("[RootWindow] auto recent conversation summary:") ||
                hostLog.includes("data-recent-conversation-summary") ||
                hostLog.includes("tool-command-finished") ||
                hostLog.includes("tool-file-action-ok") ||
                hostLog.includes(seedPath);
            const sawConversationTarget =
                hostLog.includes(targetConversation.id) ||
                hostLog.includes("data-rootwindow-auto-recent-conversation");
            const sawSwitchConversation =
                sawRecentCardClick &&
                sawConversationTarget &&
                !hostLog.includes("TypeError") &&
                !hostLog.includes("ReferenceError");

            const verdict =
                sawRecentCardClick &&
                sawRecentSummary &&
                sawSwitchConversation
                    ? "host-qt-recent-conversation-continue-confirmed"
                    : "host-qt-recent-conversation-continue-incomplete";

            await post(sidecarBaseUrl, "/conversation/delete", {
                ids: [targetConversation.id],
            }).catch(() => undefined);

            console.log(
                JSON.stringify(
                    {
                        frontUrl,
                        targetConversationId: targetConversation.id,
                        sawRecentCardClick,
                        sawRecentSummary,
                        sawSwitchConversation,
                        hostLog,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "host-qt-recent-conversation-continue-confirmed" ? 0 : 1);
        },
    );
}

await run();
