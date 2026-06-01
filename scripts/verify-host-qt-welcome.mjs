import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { getBuiltBundlePath, getSidecarDir, getWebDistDir, resolveHostBinary } from "./paths.mjs";

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

async function run() {
    const staticPort = 4174;
    const sidecarPort = 8787;
    const webDistDir = getWebDistDir();
    const sidecarDir = getSidecarDir();
    const builtBundlePath = getBuiltBundlePath();
    const hostBin = await resolveHostBinary("personal-agent-host");

    if (!hostBin) {
        throw new Error(
            "Unable to locate personal-agent-host. Set PERSONAL_AGENT_HOST_BIN or PERSONAL_AGENT_HOST_BUILD_DIR, or build into .build/host-qt.",
        );
    }

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
        },
        stdio: "ignore",
    });

    try {
        await waitForHttp(`http://127.0.0.1:${staticPort}`);
        await waitForHttp(`http://127.0.0.1:${sidecarPort}/state`);

        const frontUrl = `http://127.0.0.1:${staticPort}/?disableResizeObservers=1#/`;
        const hostLog = await new Promise((resolve) => {
            const child = spawn(hostBin, [], {
                env: {
                    ...process.env,
                    QT_QPA_PLATFORM: "offscreen",
                    QTWEBENGINE_DISABLE_SANDBOX: "1",
                    QTWEBENGINE_CHROMIUM_FLAGS: "--no-sandbox --disable-gpu",
                    PERSONAL_AGENT_AUTOSTART_SIDECAR: "0",
                    PERSONAL_AGENT_FRONT_URL: frontUrl,
                    PERSONAL_AGENT_SIDECAR_URL: `http://127.0.0.1:${sidecarPort}`,
                    PERSONAL_AGENT_SMOKE_EXIT_MS: "8000",
                },
            });

            let output = "";
            child.stdout.on("data", (chunk) => {
                output += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                output += chunk.toString();
            });

            const timer = setTimeout(() => {
                child.kill("SIGTERM");
            }, 12000);

            child.on("exit", () => {
                clearTimeout(timer);
                resolve(output);
            });
        });

        const builtBundle = await readFile(builtBundlePath, "utf8");

        const verdict =
            hostLog.includes("[host-qt web] loadFinished true") &&
            builtBundle.includes("data-welcome-recent-work") &&
            builtBundle.includes("data-welcome-open-conversation") &&
            !builtBundle.includes("runtime-status-badge") &&
            !builtBundle.includes("chat-view__session-model-strip")
                ? "host-qt-welcome-confirmed"
                : "host-qt-welcome-incomplete";

        console.log(
            JSON.stringify(
                {
                    frontUrl,
                    verdict,
                    hostLog,
                    hasRecentWorkPanel: builtBundle.includes("data-welcome-recent-work"),
                    hasRecentWorkAction: builtBundle.includes("data-welcome-open-conversation"),
                    removedRuntimeHud: !builtBundle.includes("runtime-status-badge"),
                    removedSessionModelStrip: !builtBundle.includes("chat-view__session-model-strip"),
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "host-qt-welcome-confirmed" ? 0 : 1);
    } finally {
        sidecar.kill("SIGTERM");
        staticServer.kill("SIGTERM");
    }
}

await run();
