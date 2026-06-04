import { spawn } from "node:child_process";
import { stopListener, waitForHttp } from "./qt-verify-runtime.mjs";
import { getSidecarDir } from "./paths.mjs";

export async function withSidecarRuntime(options, run) {
    const sidecarPort = options.sidecarPort;
    const sidecarDir = getSidecarDir();

    await stopListener(sidecarPort);

    const sidecar = spawn("node", ["./src/dev-server.mjs"], {
        cwd: sidecarDir,
        env: {
            ...process.env,
            PERSONAL_AGENT_PROVIDER: "deepseek",
            PERSONAL_AGENT_MODEL: process.env.PERSONAL_AGENT_MODEL || "deepseek-v4-pro",
            PERSONAL_AGENT_SIDECAR_PORT: String(sidecarPort),
            ...(options.env ?? {}),
        },
        stdio: "ignore",
    });

    try {
        await waitForHttp(`http://127.0.0.1:${sidecarPort}/state`);
        return await run({ sidecarPort });
    } finally {
        if (!sidecar.killed) {
            sidecar.kill("SIGTERM");
        }
    }
}
