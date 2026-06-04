import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

function buildFrontUrl(port) {
    const prompt = [
        "Use bash now and do not use any tool other than bash.",
        "Run exactly this command: printf 'tool-command-ok'",
        "After it completes, reply with exactly: tool-command-finished",
    ].join("\n");

    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoSend", prompt);
    url.searchParams.set("autoCopyToolCommand", "1");
    url.hash = "/";
    return url.toString();
}

function extractLoggedCommand(hostLog) {
    const match = hostLog.match(/\[RootWindow\] auto tool action clicked:\s+copy-command\s+([^\n]+)/);
    return match?.[1]?.trim() ?? "";
}

async function run() {
    await withQtVerifyRuntime(
        {
            staticPort: 4186,
            sidecarPort: 8795,
            profilePrefix: "personal-agent-qt-tool-command-action-",
        },
        async ({ staticPort, runHost }) => {
            const frontUrl = buildFrontUrl(staticPort);
            const hostLog = await runHost(frontUrl, "18000", 24000);

            const loggedCommand = extractLoggedCommand(hostLog);
            const sawCopyCommandClick = hostLog.includes("[RootWindow] auto tool action clicked: copy-command");
            const sawAssistantReply = hostLog.includes("[Sunday Timing] sunday-first-text");
            const expectedCommand = "printf 'tool-command-ok'";

            const verdict =
                sawCopyCommandClick &&
                sawAssistantReply &&
                loggedCommand === expectedCommand
                    ? "host-qt-tool-command-action-confirmed"
                    : "host-qt-tool-command-action-incomplete";

            console.log(
                JSON.stringify(
                    {
                        frontUrl,
                        loggedCommand,
                        expectedCommand,
                        sawCopyCommandClick,
                        sawAssistantReply,
                        hostLog,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "host-qt-tool-command-action-confirmed" ? 0 : 1);
        },
    );
}

await run();
