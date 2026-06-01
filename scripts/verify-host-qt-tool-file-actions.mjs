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

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4185,
                sidecarPort: 8794,
                profilePrefix: "personal-agent-qt-tool-file-actions-",
            },
            async ({ staticPort, runHost }) => {
                const frontUrl = buildFrontUrl(staticPort);
                const hostLog = await runHost(frontUrl, "18000", 24000);
                const sawOpenFileClick = hostLog.includes("[RootWindow] auto tool action clicked: open-file");
                const sawHostOpenFile = hostLog.includes("[host-qt system] openFile") && hostLog.includes(targetFile);
                const sawCopyPathClick = hostLog.includes("[RootWindow] auto tool action clicked: copy-path");

                const verdict =
                    hostLog.includes('"name":"read"') &&
                    sawOpenFileClick &&
                    sawHostOpenFile &&
                    sawCopyPathClick
                        ? "host-qt-tool-file-actions-confirmed"
                        : "host-qt-tool-file-actions-incomplete";

                console.log(
                    JSON.stringify(
                        {
                            targetFile,
                            sawOpenFileClick,
                            sawHostOpenFile,
                            sawCopyPathClick,
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
