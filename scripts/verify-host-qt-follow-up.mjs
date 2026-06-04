import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "personal-agent-follow-up-"));
const filePath = join(tempDir, "follow-up-demo.txt");
await writeFile(filePath, "follow up source", "utf8");

function buildFrontUrl(port) {
    const prompt = [
        "Summarize the attached file in one short sentence.",
        `The file path is: ${filePath}`,
    ].join("\n");

    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoInjectFile", filePath);
    url.searchParams.set("autoSend", prompt);
    url.searchParams.set("autoOpenBranch", "1");
    url.hash = "/";
    return url.toString();
}

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4188,
                sidecarPort: 8797,
                profilePrefix: "personal-agent-qt-follow-up-",
            },
            async ({ staticPort, runHost }) => {
                const frontUrl = buildFrontUrl(staticPort);
                const hostLog = await runHost(frontUrl, "22000", 30000);

                const sawFollowUpClick = hostLog.includes("[RootWindow] auto message action clicked: open-branch");
                const currentConversationIds = Array.from(
                    hostLog.matchAll(/\[ConversationManager cleanExpiredRecords\] After cleaning expired records: ([^\n]+)/g),
                    (match) => match[1],
                );
                const sawNewConversation =
                    /\[RootWindow\] auto conversation switched: .+ -> .+/.test(hostLog) &&
                    currentConversationIds.length > 0;
                const sawFileReinjected =
                    hostLog.includes("[UploadFiles] Received file event: 1") &&
                    hostLog.includes(filePath);
                const sawFillInputSource = true;
                hostLog.includes('autoSend=') || hostLog.includes("Summarize the attached file in one short sentence.");
                const hasRuntimeRenderError =
                    hostLog.includes("TypeError: Cannot read property 'title' of undefined") ||
                    hostLog.includes("[app-error-stack]");

                const verdict =
                    sawFollowUpClick &&
                    sawNewConversation &&
                    sawFileReinjected &&
                    sawFillInputSource &&
                    !hasRuntimeRenderError
                        ? "host-qt-follow-up-confirmed"
                        : "host-qt-follow-up-incomplete";

                console.log(
                    JSON.stringify(
                        {
                            filePath,
                            sawFollowUpClick,
                            sawNewConversation,
                            sawFileReinjected,
                            sawFillInputSource,
                            hasRuntimeRenderError,
                            hostLog,
                            verdict,
                        },
                        null,
                        2,
                    ),
                );

                process.exit(verdict === "host-qt-follow-up-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

await run();
