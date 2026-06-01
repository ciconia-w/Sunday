import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const tempDir = await mkdtemp(join(tmpdir(), "personal-agent-file-flow-"));
const filePath = join(tempDir, "demo.txt");
await writeFile(filePath, "hello file flow", "utf8");

function buildFrontUrl(port) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("autoInjectFile", filePath);
    url.searchParams.set("autoDeleteFile", "1");
    url.hash = "/";
    return url.toString();
}

async function run() {
    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4176,
                sidecarPort: 8790,
                profilePrefix: "personal-agent-qt-file-flow-",
            },
            async ({ staticPort, runHost }) => {
        const frontUrl = buildFrontUrl(staticPort);
        const hostLog = await runHost(frontUrl, "12000", 18000);

        const verdict =
            hostLog.includes("[RootWindow] auto file requested:") &&
            hostLog.includes("[RootWindow] auto file added:") &&
            hostLog.includes("[RootWindow] auto file parse status:") &&
            hostLog.includes("[RootWindow] auto file deleted:")
                ? "host-qt-file-flow-confirmed"
                : "host-qt-file-flow-incomplete";

        const conversationIds = Array.from(
            hostLog.matchAll(/"conversation_id":"([^"]+)"/g),
            (match) => match[1],
        );
        if (conversationIds.length > 0) {
            await post("/conversation/delete", {
                ids: [...new Set(conversationIds)],
            }).catch(() => undefined);
        }

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

        process.exit(verdict === "host-qt-file-flow-confirmed" ? 0 : 1);
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

await run();
