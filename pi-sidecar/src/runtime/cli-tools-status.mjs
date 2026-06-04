import { execFile } from "node:child_process";
import { getBrowserControlStatus } from "./browser-control.mjs";

const CLI_TOOL_DEFINITIONS = [
    { id: "gh-cli", name: "gh cli", description: "GitHub CLI，管理仓库、PR、Issue。" },
    { id: "opencli", name: "opencli", description: "网页到命令行的桥接工具。" },
    { id: "lark-cli", name: "lark cli", description: "飞书 CLI，文档、消息、表格。" },
];

function runShell(command) {
    return new Promise((resolve) => {
        execFile(
            "/bin/bash",
            ["-lc", command],
            { timeout: 15000, maxBuffer: 1024 * 1024 * 4 },
            (error, stdout, stderr) => {
                resolve({
                    ok: !error,
                    stdout: String(stdout || ""),
                    stderr: String(stderr || ""),
                    error: error ? String(error.message || error) : "",
                });
            },
        );
    });
}

function parseJson(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

async function commandExists(commandName) {
    const result = await runShell(`command -v ${commandName} >/dev/null 2>&1 && echo yes || echo no`);
    return result.stdout.trim() === "yes";
}

async function getGithubCliState() {
    const base = CLI_TOOL_DEFINITIONS[0];
    if (!(await commandExists("gh"))) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
        };
    }

    const result = await runShell("gh auth status --json hosts 2>/dev/null || echo '{}'");
    const parsed = parseJson(result.stdout);
    const hosts = parsed?.hosts && typeof parsed.hosts === "object" ? Object.values(parsed.hosts).flat() : [];
    const activeHost = hosts.find((host) => host?.active === true && host?.state === "success");

    if (activeHost) {
        return {
            ...base,
            enabled: true,
            statusToken: "authorized",
            statusText: `已授权，${activeHost.login || "GitHub"}`,
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
    };
}

async function getOpenCliState() {
    const base = CLI_TOOL_DEFINITIONS[1];
    if (!(await commandExists("opencli"))) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
        };
    }

    const status = await getBrowserControlStatus();

    if (status.daemonRunning && status.extensionConnected) {
        return {
            ...base,
            enabled: true,
            statusToken: "available",
            statusText: "可用，浏览器已连接",
        };
    }

    if (status.daemonRunning) {
        return {
            ...base,
            enabled: false,
            statusToken: "extension_disconnected",
            statusText: "守护进程已运行，插件未连接",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "daemon_stopped",
        statusText: "守护进程未运行",
    };
}

async function getLarkCliState() {
    const base = CLI_TOOL_DEFINITIONS[2];
    if (!(await commandExists("lark-cli"))) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
        };
    }

    const result = await runShell("lark-cli auth status 2>/dev/null || echo '{}'");
    const parsed = parseJson(result.stdout);
    const tokenStatus = String(parsed?.tokenStatus || "").trim();
    const userName = String(parsed?.userName || "飞书").trim();

    if (tokenStatus === "ok") {
        return {
            ...base,
            enabled: true,
            statusToken: "authorized",
            statusText: `已授权，${userName}`,
        };
    }

    if (tokenStatus === "expired" || tokenStatus === "needs_refresh") {
        return {
            ...base,
            enabled: false,
            statusToken: "expired",
            statusText: `授权已过期，${userName}`,
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
    };
}

export async function getCliToolsState() {
    return Promise.all([
        getGithubCliState(),
        getOpenCliState(),
        getLarkCliState(),
    ]);
}
