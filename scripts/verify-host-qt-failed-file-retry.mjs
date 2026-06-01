import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "personal-agent-file-retry-"));
const failureFilePath = join(tempDir, "force-parse-error-demo.txt");
await writeFile(failureFilePath, "retry me", "utf8");

function buildFrontUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoInjectFile", failureFilePath);
    url.searchParams.set("autoRetryFailedFile", "1");
    url.hash = "/";
    return url.toString();
}

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4183,
                sidecarPort: 8792,
                profilePrefix: "personal-agent-qt-file-retry-",
            },
            async ({ staticPort, runHost }) => {
                const frontUrl = buildFrontUrl(staticPort);
                const hostLog = await runHost(frontUrl, "15000", 22000);
                const sawInitialFailure =
                    hostLog.includes("[RootWindow] auto file parse status:") &&
                    hostLog.includes(`${failureFilePath} error`);
                const sawRetryRequested = hostLog.includes("[RootWindow] auto file retry requested:");
                const sawRetryActionClick = hostLog.includes(
                    "[RootWindow] auto attachment action clicked: retry-failed-files",
                );
                const sawRetryCompletion =
                    hostLog.includes("[RootWindow] auto file retry status:") &&
                    hostLog.includes(`${failureFilePath} completed`);
                const sawRetryProgress =
                    hostLog.includes("[RootWindow] auto file retry status:") &&
                    hostLog.includes("parsing");

                const verdict =
                    sawInitialFailure &&
                    sawRetryRequested &&
                    sawRetryActionClick &&
                    (sawRetryCompletion || sawRetryProgress)
                        ? "host-qt-failed-file-retry-confirmed"
                        : "host-qt-failed-file-retry-incomplete";

                console.log(
                    JSON.stringify(
                        {
                            failureFilePath,
                            sawInitialFailure,
                            sawRetryRequested,
                            sawRetryActionClick,
                            sawRetryProgress,
                            sawRetryCompletion,
                            hostLog,
                            verdict,
                        },
                        null,
                        2,
                    ),
                );

                process.exit(verdict === "host-qt-failed-file-retry-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

await run();
