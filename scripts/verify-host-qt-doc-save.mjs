import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { getSidecarDir, getWebDistDir, resolveHostBinary } from "./paths.mjs";

const staticPort = 4175;
const sidecarPort = 8788;

const now = Date.now();
const conversationId = `workspace-conv-${now}`;
const articleId = `article-${now}`;
const initialContent = "# Workspace Doc\n\noriginal";
const appendContent = "\n\nqt-save-ok";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

async function waitForHttp(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch {
            // retry
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${url}`);
}

async function stopListener(port) {
    await new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
            socket.destroy();
            spawn("bash", ["-lc", `lsof -iTCP:${port} -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true`], {
                stdio: "ignore",
            }).on("exit", () => resolve(undefined));
        });
        socket.on("error", () => resolve(undefined));
    });
}

async function prepareWorkspaceArticle() {
    await post("/conversation/get-workspace-article", {
        conversationId,
        articleId,
    });
    await post("/conversation/update-workspace-article", {
        conversationId,
        articleId,
        newContent: initialContent,
    });
}

function buildFrontUrl() {
    const url = new URL(`http://127.0.0.1:${staticPort}/`);
    url.searchParams.set("assistant", "uos-ai-writing");
    url.searchParams.set("autoOpenRecentDoc", "1");
    url.searchParams.set("autoAppendArticleId", articleId);
    url.searchParams.set("autoAppendToArticle", appendContent);
    url.hash = "/";
    return url.toString();
}

async function runHost(frontUrl) {
    const hostBin = await resolveHostBinary("personal-agent-host");
    if (!hostBin) {
        throw new Error(
            "Unable to locate personal-agent-host. Set PERSONAL_AGENT_HOST_BIN or PERSONAL_AGENT_HOST_BUILD_DIR, or build into .build/host-qt.",
        );
    }
    return await new Promise((resolve) => {
        const child = spawn(
            hostBin,
            [],
            {
                env: {
                    ...process.env,
                    QT_QPA_PLATFORM: "offscreen",
                    QTWEBENGINE_DISABLE_SANDBOX: "1",
                    QTWEBENGINE_CHROMIUM_FLAGS: "--no-sandbox --disable-gpu",
                    PERSONAL_AGENT_AUTOSTART_SIDECAR: "0",
                    PERSONAL_AGENT_FRONT_URL: frontUrl,
                    PERSONAL_AGENT_SIDECAR_URL: `http://127.0.0.1:${sidecarPort}`,
                    PERSONAL_AGENT_SMOKE_EXIT_MS: "15000",
                },
            },
        );

        let output = "";
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });

        const timer = setTimeout(() => {
            child.kill("SIGTERM");
        }, 20000);

        child.on("exit", () => {
            clearTimeout(timer);
            resolve(output);
        });
    });
}

await stopListener(staticPort);
await stopListener(sidecarPort);

const webDistDir = getWebDistDir();
const sidecarDir = getSidecarDir();

const staticServer = spawn(
    "python3",
    ["-m", "http.server", String(staticPort), "--directory", webDistDir],
    { stdio: "ignore" },
);

const sidecar = spawn("node", ["./src/dev-server.mjs"], {
    cwd: sidecarDir,
    env: {
        ...process.env,
        PERSONAL_AGENT_PROVIDER: "deepseek",
        PERSONAL_AGENT_MODEL: process.env.PERSONAL_AGENT_MODEL || "deepseek-v4-pro",
        PERSONAL_AGENT_SIDECAR_PORT: String(sidecarPort),
    },
    stdio: "ignore",
});

const profileDir = await mkdtemp(join(tmpdir(), "personal-agent-verify-doc-save-"));
process.env.XDG_CONFIG_HOME = join(profileDir, "config");
process.env.XDG_CACHE_HOME = join(profileDir, "cache");
process.env.XDG_DATA_HOME = join(profileDir, "data");

let frontUrl = "";
let hostLog = "";
let articleAfter = null;
let verdict = "host-qt-doc-save-incomplete";

try {
    await waitForHttp(`http://127.0.0.1:${staticPort}`);
    await waitForHttp(`http://127.0.0.1:${sidecarPort}/state`);

    await prepareWorkspaceArticle();
    frontUrl = buildFrontUrl();
    hostLog = await runHost(frontUrl);

    articleAfter = await post("/conversation/get-workspace-article", {
        conversationId,
        articleId,
    });

    const savedContent = articleAfter?.result?.content ?? "";
    verdict =
        hostLog.includes("[WritingAssistant] Opening recent doc:") &&
        hostLog.includes("[MarkdownEditor] mounted") &&
        hostLog.includes("[MarkdownEditor] auto-edit applied") &&
        hostLog.includes("[MarkdownEditor] Auto-saved:") &&
        savedContent.includes("qt-save-ok")
            ? "host-qt-doc-save-confirmed"
            : "host-qt-doc-save-incomplete";
} finally {
    sidecar.kill("SIGTERM");
    staticServer.kill("SIGTERM");
    await rm(profileDir, { recursive: true, force: true });
}

console.log(
    JSON.stringify(
        {
            conversationId,
            articleId,
            frontUrl,
            hostLog,
            articleAfter: articleAfter.result,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "host-qt-doc-save-confirmed" ? 0 : 1);
