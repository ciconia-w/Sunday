import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

function buildFrontUrl(port) {
    const prompt = [
        "Use bash now and only use bash.",
        "Run this exact command and do not summarize it yourself:",
        "yes full-output-line | head -n 2000",
        "After it completes, reply with exactly: full-output-finished",
    ].join("\n");

    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoSend", prompt);
    url.searchParams.set("autoOpenFullOutput", "1");
    url.hash = "/";
    return url.toString();
}

function extractLoggedOutputPath(hostLog) {
    const match = hostLog.match(/\[RootWindow\] auto tool action clicked:\s+open-full-output\s+([^\n]+)/);
    return match?.[1]?.trim() ?? "";
}

function extractFullOutputPath(hostLog) {
    const match = hostLog.match(/"fullOutputPath":"([^"]+)"/);
    return match?.[1] ?? "";
}

async function run() {
        await withQtVerifyRuntime(
            {
                staticPort: 4187,
                sidecarPort: 8796,
                profilePrefix: "personal-agent-qt-open-full-output-",
                captureSidecarOutput: true,
            },
        async ({ staticPort, runHost, getSidecarOutput }) => {
            const frontUrl = buildFrontUrl(staticPort);
            const hostLog = await runHost(frontUrl, "22000", 30000);
            const sidecarLog = getSidecarOutput();

            const loggedOutputPath = extractLoggedOutputPath(hostLog);
            const fullOutputPath = extractFullOutputPath(hostLog) || extractFullOutputPath(sidecarLog);
            const sidecarDebugLines = sidecarLog
                .split("\n")
                .filter((line) => line.includes("tool_execution_") || line.includes("fullOutputPath"));
            const hostToolLines = hostLog
                .split("\n")
                .filter((line) => line.includes("Session event: 4") || line.includes("auto tool action clicked"));

            const verdict =
                hostLog.includes("[RootWindow] auto tool action clicked: open-full-output") &&
                fullOutputPath.length > 0 &&
                loggedOutputPath === fullOutputPath
                    ? "host-qt-open-full-output-confirmed"
                    : "host-qt-open-full-output-incomplete";

            console.log(
                JSON.stringify(
                        {
                            frontUrl,
                            loggedOutputPath,
                            fullOutputPath,
                            hostToolLines,
                            sidecarDebugLines,
                            verdict,
                        },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "host-qt-open-full-output-confirmed" ? 0 : 1);
        },
    );
}

await run();
