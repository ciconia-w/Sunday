import { execFile } from "node:child_process";
import { getBrowserControlStatus } from "./browser-control.mjs";

const CLI_TOOL_DEFINITIONS = [
    { id: "gh-cli", name: "gh cli", description: "GitHub CLI，管理仓库、PR、Issue。" },
    { id: "opencli", name: "opencli", description: "网页到命令行的桥接工具。" },
    { id: "lark-cli", name: "lark cli", description: "飞书 CLI，文档、消息、表格。" },
];
const GH_INSTALL_GUIDE_URL = "https://cli.github.com/manual/installation";
const OPENCLI_PACKAGE_NAME = "@jackwener/opencli";
const LARK_CLI_PACKAGE_NAME = "@larksuite/cli";
const LATEST_VERSION_TTL_MS = 10 * 60 * 1000;
const latestVersionCache = new Map();

function buildDetailText({ version = "", latestVersion = "", installPath = "", extraLines = [] } = {}) {
    const lines = [];

    if (version) {
        lines.push(`版本 ${version}`);
    }

    if (latestVersion) {
        lines.push(`最新版本 ${latestVersion}`);
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

function compareVersions(left, right) {
    const normalizeParts = (value) => extractVersion(value)
        .replace(/^v/i, "")
        .split(/[.+-]/)
        .map((part) => Number.parseInt(part, 10))
        .map((part) => (Number.isFinite(part) ? part : 0));

    const leftParts = normalizeParts(left);
    const rightParts = normalizeParts(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;
        if (leftPart > rightPart) {
            return 1;
        }
        if (leftPart < rightPart) {
            return -1;
        }
    }

    return 0;
}

function isUpdateAvailable(currentVersion, latestVersion) {
    if (!currentVersion || !latestVersion) {
        return false;
    }

    return compareVersions(currentVersion, latestVersion) < 0;
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

async function getCachedLatestVersion(cacheKey, loadLatestVersion) {
    const cached = latestVersionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    const value = extractVersion(await loadLatestVersion());
    latestVersionCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + LATEST_VERSION_TTL_MS,
    });
    return value;
}

async function getCommandPath(commandName) {
    const result = await runShell(`command -v ${commandName} 2>/dev/null || true`);
    return result.stdout.trim();
}

async function getCommandVersion(command) {
    const result = await runShell(command);
    return extractVersion(result.stdout || result.stderr || "");
}

async function getNpmLatestVersion(packageName) {
    return getCachedLatestVersion(`npm:${packageName}`, async () => {
        const result = await runShell(`npm view ${packageName} version 2>/dev/null || true`);
        return result.stdout || result.stderr;
    });
}

async function getGithubCliLatestVersion() {
    return getCachedLatestVersion("github:cli", async () => {
        try {
            const response = await fetch("https://api.github.com/repos/cli/cli/releases/latest", {
                headers: {
                    "user-agent": "Sunday CLI status probe",
                    "accept": "application/vnd.github+json",
                },
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                return "";
            }

            const payload = await response.json();
            return payload?.tag_name || "";
        } catch {
            return "";
        }
    });
}

async function getGithubCliState() {
    const base = CLI_TOOL_DEFINITIONS[0];
    const installPath = await getCommandPath("gh");
    const latestVersion = await getGithubCliLatestVersion();

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            statusTone: "error",
            detailText: buildDetailText({
                latestVersion,
                extraLines: ["未在 PATH 中找到 gh。", "建议先打开安装文档，再按系统包管理方式安装。"],
            }),
            latestVersion,
            updateAvailable: false,
            actionText: "打开安装文档",
            actionDisabled: false,
            actionKind: "open-url",
            actionPayload: GH_INSTALL_GUIDE_URL,
            actionCommand: "",
        };
    }

    const version = await getCommandVersion("gh --version 2>/dev/null | head -n 1");
    const updateAvailable = isUpdateAvailable(version, latestVersion);
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
            detailText: buildDetailText({
                version,
                latestVersion,
                installPath,
                extraLines: updateAvailable ? ["检测到新版本，建议按安装文档中的方式升级。"] : [],
            }),
            latestVersion,
            updateAvailable,
            actionText: updateAvailable ? "打开升级文档" : "",
            actionDisabled: !updateAvailable,
            actionKind: updateAvailable ? "open-url" : "",
            actionPayload: updateAvailable ? GH_INSTALL_GUIDE_URL : "",
            actionCommand: "",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
        statusTone: "warning",
        detailText: buildDetailText({
            version,
            latestVersion,
            installPath,
            extraLines: updateAvailable ? ["检测到新版本，可在完成授权后按安装文档升级。"] : [],
        }),
        latestVersion,
        updateAvailable,
        actionText: "登录",
        actionDisabled: false,
        actionKind: "run-command",
        actionPayload: "nohup gh auth login --web --git-protocol https >/tmp/sunday-gh-auth.log 2>&1 & echo started",
        actionCommand: "nohup gh auth login --web --git-protocol https >/tmp/sunday-gh-auth.log 2>&1 & echo started",
    };
}

async function getOpenCliState() {
    const base = CLI_TOOL_DEFINITIONS[1];
    const installPath = await getCommandPath("opencli");
    const latestVersion = await getNpmLatestVersion(OPENCLI_PACKAGE_NAME);

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            statusTone: "error",
            detailText: buildDetailText({
                latestVersion,
                extraLines: ["未在 PATH 中找到 opencli。", "复制安装命令后请在终端执行。"],
            }),
            latestVersion,
            updateAvailable: false,
            actionText: "复制安装命令",
            actionDisabled: false,
            actionKind: "copy-text",
            actionPayload: `npm install -g ${OPENCLI_PACKAGE_NAME}@latest`,
            actionCommand: "",
        };
    }

    const version = await getCommandVersion("opencli --version 2>/dev/null || opencli version 2>/dev/null || true");
    const latestUpdateAvailable = isUpdateAvailable(version, latestVersion);
    const status = await getBrowserControlStatus();

    if (status.daemonRunning && status.extensionConnected) {
        return {
            ...base,
            enabled: true,
            statusToken: "available",
            statusText: "可用，浏览器已连接",
            statusTone: "success",
            detailText: buildDetailText({
                version,
                latestVersion,
                installPath,
                extraLines: latestUpdateAvailable ? ["检测到新版本，可复制更新命令后在终端升级。"] : [],
            }),
            latestVersion,
            updateAvailable: latestUpdateAvailable,
            actionText: latestUpdateAvailable ? "复制更新命令" : "诊断",
            actionDisabled: false,
            actionKind: latestUpdateAvailable ? "copy-text" : "run-command",
            actionPayload: latestUpdateAvailable ? `npm install -g ${OPENCLI_PACKAGE_NAME}@latest` : "opencli doctor",
            actionCommand: latestUpdateAvailable ? "" : "opencli doctor",
        };
    }

    if (status.daemonRunning) {
        return {
            ...base,
            enabled: false,
            statusToken: "extension_disconnected",
            statusText: "守护进程已运行，插件未连接",
            statusTone: "warning",
            detailText: buildDetailText({
                version,
                latestVersion,
                installPath,
                extraLines: [
                    "建议先检查浏览器设置页中的插件连接状态。",
                    latestUpdateAvailable ? "检测到新版本，可在恢复连接后复制更新命令升级。" : "",
                ],
            }),
            latestVersion,
            updateAvailable: latestUpdateAvailable,
            actionText: "诊断",
            actionDisabled: false,
            actionKind: "run-command",
            actionPayload: "opencli doctor",
            actionCommand: "opencli doctor",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "daemon_stopped",
        statusText: "守护进程未运行",
        statusTone: "warning",
        detailText: buildDetailText({
            version,
            latestVersion,
            installPath,
            extraLines: latestUpdateAvailable ? ["检测到新版本，可在诊断后复制更新命令升级。"] : [],
        }),
        latestVersion,
        updateAvailable: latestUpdateAvailable,
        actionText: "诊断",
        actionDisabled: false,
        actionKind: "run-command",
        actionPayload: "opencli doctor",
        actionCommand: "opencli doctor",
    };
}

async function getLarkCliState() {
    const base = CLI_TOOL_DEFINITIONS[2];
    const installPath = await getCommandPath("lark-cli");
    const latestVersion = await getNpmLatestVersion(LARK_CLI_PACKAGE_NAME);

    if (!installPath) {
        return {
            ...base,
            enabled: false,
            statusToken: "not_installed",
            statusText: "未安装",
            statusTone: "error",
            detailText: buildDetailText({
                latestVersion,
                extraLines: ["未在 PATH 中找到 lark-cli。", "复制安装命令后请在终端执行。"],
            }),
            latestVersion,
            updateAvailable: false,
            actionText: "复制安装命令",
            actionDisabled: false,
            actionKind: "copy-text",
            actionPayload: `npm install -g ${LARK_CLI_PACKAGE_NAME}@latest`,
            actionCommand: "",
        };
    }

    const version = await getCommandVersion("lark-cli --version 2>/dev/null || lark-cli version 2>/dev/null || true");
    const latestUpdateAvailable = isUpdateAvailable(version, latestVersion);
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
            detailText: buildDetailText({
                version,
                latestVersion,
                installPath,
                extraLines: latestUpdateAvailable ? ["检测到新版本，可复制更新命令后在终端升级。"] : [],
            }),
            latestVersion,
            updateAvailable: latestUpdateAvailable,
            actionText: latestUpdateAvailable ? "复制更新命令" : "",
            actionDisabled: !latestUpdateAvailable,
            actionKind: latestUpdateAvailable ? "copy-text" : "",
            actionPayload: latestUpdateAvailable ? `npm install -g ${LARK_CLI_PACKAGE_NAME}@latest` : "",
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
            detailText: buildDetailText({
                version,
                latestVersion,
                installPath,
                extraLines: latestUpdateAvailable ? ["检测到新版本，建议登录恢复后尽快升级。"] : [],
            }),
            latestVersion,
            updateAvailable: latestUpdateAvailable,
            actionText: "重新登录",
            actionDisabled: false,
            actionKind: "run-command",
            actionPayload: "lark-cli auth login --no-wait --json --domain all",
            actionCommand: "lark-cli auth login --no-wait --json --domain all",
        };
    }

    return {
        ...base,
        enabled: false,
        statusToken: "needs_auth",
        statusText: "已安装，待授权",
        statusTone: "warning",
        detailText: buildDetailText({
            version,
            latestVersion,
            installPath,
            extraLines: latestUpdateAvailable ? ["检测到新版本，可在完成登录后按需升级。"] : [],
        }),
        latestVersion,
        updateAvailable: latestUpdateAvailable,
        actionText: "登录",
        actionDisabled: false,
        actionKind: "run-command",
        actionPayload: "lark-cli auth login --no-wait --json --domain all",
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
