import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "personal-agent-clear-all-"));
const filePath = join(tempDir, "clear-all-demo.txt");
await writeFile(filePath, "clear all me", "utf8");

function buildFrontUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoInjectFile", filePath);
    url.searchParams.set("autoClearAllFiles", "1");
    url.hash = "/";
    return url.toString();
}

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4184,
                sidecarPort: 8793,
                profilePrefix: "personal-agent-qt-clear-all-",
            },
            async ({ staticPort, runHost }) => {
                const frontUrl = buildFrontUrl(staticPort);
                const hostLog = await runHost(frontUrl, "14000", 20000);

                const verdict =
                    hostLog.includes("[RootWindow] auto file requested:") &&
                    hostLog.includes("[RootWindow] auto file added:") &&
                    hostLog.includes("[RootWindow] auto attachment action clicked: clear-all") &&
                    hostLog.includes("[RootWindow] auto file cleared:")
                        ? "host-qt-clear-all-confirmed"
                        : "host-qt-clear-all-incomplete";

                console.log(
                    JSON.stringify(
                        {
                            filePath,
                            hostLog,
                            verdict,
                        },
                        null,
                        2,
                    ),
                );

                process.exit(verdict === "host-qt-clear-all-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

await run();
