import { execFile } from "node:child_process";
import { getBrowserControlStatus } from "./browser-control.mjs";

const CLI_TOOL_DEFINITIONS = [
    { id: "gh-cli", name: "gh cli", description: "GitHub CLI，管理仓库、PR、Issue。" },
    { id: "opencli", name: "opencli", description: "网页到命令行的桥接工具。" },
    { id: "lark-cli", name: "lark cli", description: "飞书 CLI，文档、消息、表格。" },
];

function buildDetailText(version, installPath, extraLines = []) {
    const lines = [];

    if (version) {
        lines.push(`版本 ${version}`);
    }

    if (installPath) {
        lines.push(installPath);
    }

    for (const line of extraLines) {
        const trimmed = String(line || "").trim();
        if (trimmed) {
            lines.push(trimmed);
        }
    }

    return lines.join("\n");
}

function extractVersion(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return "";
    }

    const versionMatch = trimmed.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
    if (versionMatch) {
        return versionMatch[0];
    }

    return trimmed.split(/\s+/)[0] || "";
}

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

async function getCommandPath(commandName) {
    const result = await runShell(`command -v ${commandName} 2>/dev/null || true`);
    return result.stdout.trim();
}

async function getCommandVersion(command) {
    const result = await runShell(command);
    return extractVersion(result.stdout || result.stderr || "");
}

async function getGithubCliState() {
    const base = CLI_TOOL_DEFINITIONS[0];
    const installPath = await getCommandPath("gh");

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            detailText: "未在 PATH 中找到 gh。",
            actionText: "",
            actionDisabled: true,
        };
    }

    const version = await getCommandVersion("gh --version 2>/dev/null | head -n 1");
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
            statusTone: "success",
            detailText: buildDetailText(version, installPath),
            actionText: "",
            actionDisabled: true,
            actionCommand: "",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
        statusTone: "warning",
        detailText: buildDetailText(version, installPath),
        actionText: "登录",
        actionDisabled: false,
        actionCommand: "nohup gh auth login --web --git-protocol https >/tmp/sunday-gh-auth.log 2>&1 & echo started",
    };
}

async function getOpenCliState() {
    const base = CLI_TOOL_DEFINITIONS[1];
    const installPath = await getCommandPath("opencli");

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            statusTone: "error",
            detailText: "未在 PATH 中找到 opencli。",
            actionText: "安装",
            actionDisabled: false,
            actionCommand: "npm install -g @jackwener/opencli",
        };
    }

    const version = await getCommandVersion("opencli --version 2>/dev/null || opencli version 2>/dev/null || true");
    const status = await getBrowserControlStatus();

    if (status.daemonRunning && status.extensionConnected) {
        return {
            ...base,
            enabled: true,
            statusToken: "available",
            statusText: "可用，浏览器已连接",
            statusTone: "success",
            detailText: buildDetailText(version, installPath),
            actionText: "诊断",
            actionDisabled: false,
            actionCommand: "opencli doctor",
        };
    }

    if (status.daemonRunning) {
        return {
            ...base,
            enabled: false,
            statusToken: "extension_disconnected",
            statusText: "守护进程已运行，插件未连接",
            statusTone: "warning",
            detailText: buildDetailText(version, installPath, ["建议先检查浏览器设置页中的插件连接状态。"]),
            actionText: "诊断",
            actionDisabled: false,
            actionCommand: "opencli doctor",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "daemon_stopped",
        statusText: "守护进程未运行",
        statusTone: "warning",
        detailText: buildDetailText(version, installPath),
        actionText: "诊断",
        actionDisabled: false,
        actionCommand: "opencli doctor",
    };
}

async function getLarkCliState() {
    const base = CLI_TOOL_DEFINITIONS[2];
    const installPath = await getCommandPath("lark-cli");

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            statusTone: "error",
            detailText: "未在 PATH 中找到 lark-cli。",
            actionText: "",
            actionDisabled: true,
        };
    }

    const version = await getCommandVersion("lark-cli --version 2>/dev/null || lark-cli version 2>/dev/null || true");
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
            statusTone: "success",
            detailText: buildDetailText(version, installPath),
            actionText: "",
            actionDisabled: true,
            actionCommand: "",
        };
    }

    if (tokenStatus === "expired" || tokenStatus === "needs_refresh") {
        return {
            ...base,
            enabled: false,
            statusToken: "expired",
            statusText: `授权已过期，${userName}`,
            statusTone: "warning",
            detailText: buildDetailText(version, installPath),
            actionText: "重新登录",
            actionDisabled: false,
            actionCommand: "lark-cli auth login --no-wait --json --domain all",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
        statusTone: "warning",
        detailText: buildDetailText(version, installPath),
        actionText: "登录",
        actionDisabled: false,
        actionCommand: "lark-cli auth login --no-wait --json --domain all",
    };
}

export async function getCliToolsState() {
    return Promise.all([
        getGithubCliState(),
        getOpenCliState(),
        getLarkCliState(),
    ]);
}
