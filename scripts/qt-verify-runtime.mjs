import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { getSidecarDir, getWebDistDir, resolveHostBinary } from "./paths.mjs";

export async function waitForHttp(url, timeoutMs = 10000) {
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

export async function stopListener(port) {
    await new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
            socket.destroy();
            spawn(
                "bash",
                ["-lc", `lsof -iTCP:${port} -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true`],
                { stdio: "ignore" },
            ).on("exit", () => resolve(undefined));
        });
        socket.on("error", () => resolve(undefined));
    });
}

export async function withQtVerifyRuntime(options, run) {
    const staticPort = options.staticPort;
    const sidecarPort = options.sidecarPort;
    const webDistDir = getWebDistDir();
    const sidecarDir = getSidecarDir();
    const hostBin = await resolveHostBinary("personal-agent-host");

    if (!hostBin) {
        throw new Error(
            "Unable to locate personal-agent-host. Set PERSONAL_AGENT_HOST_BIN or PERSONAL_AGENT_HOST_BUILD_DIR, or build into .build/host-qt.",
        );
    }

    await stopListener(staticPort);
    await stopListener(sidecarPort);

    const staticServer = spawn(
        "python3",
        ["-m", "http.server", String(staticPort), "--directory", webDistDir],
        { stdio: "ignore" },
    );

    const captureSidecarOutput = options.captureSidecarOutput === true;
    const sidecar = spawn("node", ["./src/dev-server.mjs"], {
        cwd: sidecarDir,
        env: {
            ...process.env,
            PERSONAL_AGENT_PROVIDER: "deepseek",
            PERSONAL_AGENT_MODEL: process.env.PERSONAL_AGENT_MODEL || "deepseek-v4-pro",
            PERSONAL_AGENT_SIDECAR_PORT: String(sidecarPort),
        },
        stdio: captureSidecarOutput ? ["ignore", "pipe", "pipe"] : "ignore",
    });
    let sidecarOutput = "";
    if (captureSidecarOutput) {
        sidecar.stdout?.on("data", (chunk) => {
            sidecarOutput += chunk.toString();
        });
        sidecar.stderr?.on("data", (chunk) => {
            sidecarOutput += chunk.toString();
        });
    }

    const profileDir = await mkdtemp(join(tmpdir(), options.profilePrefix ?? "personal-agent-qt-verify-"));

    try {
        await waitForHttp(`http://127.0.0.1:${staticPort}`);
        await waitForHttp(`http://127.0.0.1:${sidecarPort}/state`);

        return await run({
            staticPort,
            sidecarPort,
            profileDir,
            getSidecarOutput: () => sidecarOutput,
            runHost: (frontUrl, smokeExitMs = "15000", timeoutMs = 20000) =>
                runQtHost({
                    frontUrl,
                    sidecarPort,
                    profileDir,
                    smokeExitMs,
                    timeoutMs,
                    hostBin,
                }),
        });
    } finally {
        sidecar.kill("SIGTERM");
        staticServer.kill("SIGTERM");
        await rm(profileDir, { recursive: true, force: true });
    }
}

async function runQtHost({ frontUrl, sidecarPort, profileDir, smokeExitMs, timeoutMs, hostBin }) {
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
                    PERSONAL_AGENT_SMOKE_EXIT_MS: smokeExitMs,
                    XDG_CONFIG_HOME: join(profileDir, "config"),
                    XDG_CACHE_HOME: join(profileDir, "cache"),
                    XDG_DATA_HOME: join(profileDir, "data"),
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
        }, timeoutMs);

        child.on("exit", () => {
            clearTimeout(timer);
            resolve(output);
        });
    });
}
