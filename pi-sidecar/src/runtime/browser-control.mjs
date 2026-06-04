import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { chooseBrowserTabSelectionAction } from "./browser-tab-selection.mjs";

const repoRoot = resolve(process.cwd(), "..");
const browserSessionName = "sunday";
const browserControlConfigPath = resolve(repoRoot, ".run", "browser-control.json");
const browserExtensionPath = resolve(repoRoot, "extensions", "opencli-browser");
const browserOutputDir = resolve(homedir(), "AI-output");

function getBrowserRuntimeProfile(version) {
    const normalizedVersion = String(version || "").trim();
    const stableTabSwitch = normalizedVersion !== "1.8.0";
    const stableScreenshotCapture = normalizedVersion !== "1.8.0";
    const knownIssues = [];
    let runtimeLimitNotice = "";
    let tabSwitchCapabilityDescription = "当前运行时支持稳定的标签页切换。";
    let screenshotCapabilityDescription = "当前运行时支持稳定的整页截图。";
    let screenshotGuidance = "建议先刷新状态并确认插件连接正常；如果仍失败，优先使用页面提取继续完成当前任务。";
    let screenshotActionLabel = "整页截图";

    if (normalizedVersion === "1.8.0") {
        runtimeLimitNotice = "当前 OpenCLI v1.8.0 下，多标签切换会退化为重新打开 URL，整页截图也可能因为运行时错误而失败。";
        knownIssues.push("tab-switch-fallback");
        knownIssues.push("screenshot-runtime-error");
        tabSwitchCapabilityDescription = "当前运行时会退化为重新打开 URL，不能当作可靠多标签能力。";
        screenshotCapabilityDescription = "当前运行时可能触发截图运行时错误，建议优先使用页面提取继续任务。";
        screenshotGuidance = "建议先继续使用页面提取、聊天里的 browser_* 工具或当前活动页内容完成任务，待 OpenCLI 升级后再重试截图。";
        screenshotActionLabel = "尝试整页截图";
    }

    return {
        stableTabSwitch,
        stableScreenshotCapture,
        runtimeLimitNotice,
        knownIssues,
        tabSwitchCapabilityDescription,
        screenshotCapabilityDescription,
        screenshotGuidance,
        screenshotActionLabel,
    };
}

function cleanOpenCliOutput(text) {
    return String(text || "")
        .split(/\r?\n/)
        .filter((line) => {
            const trimmed = line.trim();
            return (
                trimmed &&
                !trimmed.startsWith("Update available") &&
                !trimmed.startsWith("Run:") &&
                !trimmed.startsWith("Download:") &&
                !trimmed.includes("[UNDICI-EHPA] Warning:") &&
                !trimmed.startsWith("(Use `node --trace-warnings")
            );
        })
        .join("\n")
        .trim();
}

export function getBrowserScreenshotErrorDetails(error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    const normalizedMessage = String(rawMessage || "").trim();
    const existingErrorKind = error && typeof error === "object" && typeof error.errorKind === "string"
        ? error.errorKind.trim()
        : "";
    const existingErrorHint = error && typeof error === "object" && typeof error.errorHint === "string"
        ? error.errorHint.trim()
        : "";

    let errorKind = existingErrorKind || "unknown";
    let errorHint = existingErrorHint || "整页截图未成功完成，建议先使用页面提取继续任务。";

    if (!existingErrorKind) {
        if (
            normalizedMessage.includes("The first argument must be of type string")
            || normalizedMessage.includes("Received an instance of Object")
        ) {
            errorKind = "runtime-typeerror";
            errorHint = "当前 OpenCLI 运行时在截图阶段抛出了参数类型错误；这是已知限制，建议先使用页面提取继续任务。";
        } else if (normalizedMessage.includes("did not produce a file")) {
            errorKind = "missing-output";
            errorHint = "OpenCLI 没有产出截图文件，建议先使用页面提取继续任务。";
        } else if (normalizedMessage.includes("produced an empty file")) {
            errorKind = "empty-output";
            errorHint = "OpenCLI 产出的截图文件为空，建议先使用页面提取继续任务。";
        }
    }

    const errorMessage = normalizedMessage.startsWith("OpenCLI screenshot failed:")
        ? normalizedMessage
        : `OpenCLI screenshot failed: ${normalizedMessage}`;

    return {
        errorMessage,
        errorKind,
        errorHint,
    };
}

function createBrowserScreenshotError(error) {
    const details = getBrowserScreenshotErrorDetails(error);
    const wrappedError = new Error(details.errorMessage);
    wrappedError.name = "BrowserScreenshotError";
    wrappedError.errorKind = details.errorKind;
    wrappedError.errorHint = details.errorHint;
    return wrappedError;
}

function getStatusLineValue(rawText, label) {
    const match = rawText.match(new RegExp(`${label}:\\s*([^\\n\\r]+)`, "i"));
    return match?.[1]?.trim() ?? "";
}

function parseBrowserStateText(rawText) {
    const cleaned = cleanOpenCliOutput(rawText);
    let text = cleaned;

    try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed?.data === "string") {
            text = parsed.data;
        } else if (typeof parsed?.url === "string" || typeof parsed?.title === "string") {
            return {
                url: String(parsed.url || "").trim(),
                title: String(parsed.title || "").trim(),
                interactive: Number(parsed.interactive || 0) || 0,
                sessionName: String(parsed.session || browserSessionName).trim() || browserSessionName,
            };
        }
    } catch {
        // Use the plain-text fallback below.
    }

    const lines = text.split(/\r?\n/);
    return {
        url: (lines.find((line) => line.startsWith("url:")) || "").replace("url:", "").trim(),
        title: (lines.find((line) => line.startsWith("title:")) || "").replace("title:", "").trim(),
        interactive:
            Number(
                (lines.find((line) => line.startsWith("interactive:")) || "")
                    .replace("interactive:", "")
                    .trim(),
            ) || 0,
        sessionName: browserSessionName,
    };
}

function parseBrowserTabs(rawText) {
    const cleaned = cleanOpenCliOutput(rawText);
    if (!cleaned) {
        return [];
    }

    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseOpenCliStatus(rawText) {
    const cleaned = cleanOpenCliOutput(rawText);
    const daemonValue = getStatusLineValue(cleaned, "Daemon");
    const extensionValue = getStatusLineValue(cleaned, "Extension");
    const version = (cleaned.match(/Version:\s*v?([\d.]+)/i) || ["", ""])[1];
    const lower = cleaned.toLowerCase();
    const notInstalled =
        lower.includes("command not found") ||
        lower.includes("not found") ||
        lower.includes("enoent");
    const daemonRunning = daemonValue
        ? /\brunning\b/i.test(daemonValue)
        : lower.includes("daemon: running") || lower.includes("running");
    const extensionConnected = extensionValue
        ? /\bconnected\b/i.test(extensionValue) && !/\bdisconnected\b/i.test(extensionValue)
        : lower.includes("extension: connected");

    let daemonLabel = "未运行";
    if (notInstalled) {
        daemonLabel = "未安装";
    } else if (daemonRunning) {
        daemonLabel = "运行中";
    }

    let extensionLabel = "未连接";
    if (notInstalled) {
        extensionLabel = "—";
    } else if (extensionConnected) {
        extensionLabel = "已连接";
    }

    let statusSummary = "守护进程未运行";
    if (!daemonRunning && notInstalled) {
        statusSummary = "OpenCLI 未安装";
    } else if (!daemonRunning) {
        statusSummary = "守护进程未运行";
    } else if (!extensionConnected) {
        statusSummary = "插件未连接";
    } else {
        statusSummary = "OpenCLI 已连接";
    }

    return {
        raw: cleaned,
        daemonRunning,
        extensionConnected,
        daemonLabel,
        extensionLabel,
        version,
        statusSummary,
        notInstalled,
    };
}

export function getBrowserControlPaths() {
    return {
        repoRoot,
        browserSessionName,
        browserControlConfigPath,
        browserExtensionPath,
        browserOutputDir,
    };
}

export function readBrowserControlState() {
    try {
        if (!existsSync(browserControlConfigPath)) {
            return { enabled: false };
        }
        const raw = readFileSync(browserControlConfigPath, "utf8");
        const parsed = JSON.parse(raw);
        return { enabled: parsed?.enabled === true };
    } catch {
        return { enabled: false };
    }
}

export function isBrowserControlEnabled() {
    return readBrowserControlState().enabled;
}

export function setBrowserControlEnabled(enabled) {
    mkdirSync(dirname(browserControlConfigPath), { recursive: true });
    writeFileSync(browserControlConfigPath, JSON.stringify({ enabled: enabled === true }) + "\n", "utf8");
    return { enabled: enabled === true };
}

export function ensureBrowserControlEnabled() {
    if (!isBrowserControlEnabled()) {
        throw new Error("Browser control is disabled. Enable it in 设置 > 浏览器 first.");
    }
}

export function getDefaultBrowserScreenshotPath(prefix = "sunday-browser") {
    mkdirSync(browserOutputDir, { recursive: true });
    return resolve(browserOutputDir, `${prefix}-${Date.now()}.png`);
}

function normalizeBrowserWindowMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return normalized === "foreground" ? "foreground" : "background";
}

function injectBrowserWindowMode(args, windowMode) {
    if (String(args?.[0] || "") !== "browser" || typeof args?.[1] !== "string" || !windowMode) {
        return args;
    }

    return [
        args[0],
        args[1],
        "--window",
        normalizeBrowserWindowMode(windowMode),
        ...args.slice(2),
    ];
}

export function getDefaultBrowserWindowMode() {
    return normalizeBrowserWindowMode(process.env.SUNDAY_BROWSER_WINDOW_MODE);
}

export function runOpenCli(args, options = {}) {
    const finalArgs = injectBrowserWindowMode(args, options.windowMode);
    return new Promise((resolvePromise, reject) => {
        execFile("opencli", finalArgs, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
            const output = cleanOpenCliOutput(stdout || stderr || error?.message || "");
            if (error) {
                reject(new Error(output || "opencli browser failed"));
                return;
            }
            resolvePromise(output);
        });
    });
}

export async function getBrowserControlStatus() {
    let raw = "";
    try {
        raw = await runOpenCli(["daemon", "status"]);
    } catch (error) {
        raw = error instanceof Error ? error.message : String(error);
    }

    const parsed = parseOpenCliStatus(raw);
    return {
        enabled: isBrowserControlEnabled(),
        extensionPath: browserExtensionPath,
        outputDir: browserOutputDir,
        sessionName: browserSessionName,
        repoRoot,
        ...parsed,
        ...getBrowserRuntimeProfile(parsed.version),
    };
}

export async function getBrowserPanelState() {
    const controlState = await getBrowserControlStatus();
    const base = {
        ...controlState,
        url: "",
        title: "",
        interactive: 0,
        tabs: [],
    };

    if (!controlState.enabled || !controlState.daemonRunning || !controlState.extensionConnected) {
        return base;
    }

    try {
        const [stateText, tabText] = await Promise.all([
            runOpenCli(["browser", browserSessionName, "state"]),
            runOpenCli(["browser", browserSessionName, "tab", "list"]),
        ]);
        const parsedState = parseBrowserStateText(stateText);
        const parsedTabs = parseBrowserTabs(tabText);
        return {
            ...base,
            url: parsedState.url,
            title: parsedState.title,
            interactive: parsedState.interactive,
            sessionName: parsedState.sessionName || browserSessionName,
            tabs: parsedTabs,
        };
    } catch (error) {
        return {
            ...base,
            statusSummary: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function startBrowserSessionIfEnabled() {
    const controlState = await getBrowserControlStatus();
    if (!controlState.enabled) {
        return {
            ...controlState,
            started: false,
            reason: "disabled",
        };
    }

    if (!controlState.daemonRunning || !controlState.extensionConnected) {
        return {
            ...controlState,
            started: false,
            reason: "not-ready",
        };
    }

    await runOpenCli(["browser", browserSessionName, "init"]);
    return {
        ...(await getBrowserPanelState()),
        started: true,
        reason: "started",
    };
}

export async function initBrowserSession() {
    ensureBrowserControlEnabled();
    await runOpenCli(["browser", browserSessionName, "init"]);
    return getBrowserPanelState();
}

export async function openBrowserUrl(url) {
    ensureBrowserControlEnabled();
    return runOpenCli(
        ["browser", browserSessionName, "open", String(url || "").trim()],
        { windowMode: getDefaultBrowserWindowMode() },
    );
}

export async function createBrowserTab(url = "https://example.com") {
    ensureBrowserControlEnabled();
    return runOpenCli(
        ["browser", browserSessionName, "tab", "new", String(url || "").trim()],
        { windowMode: getDefaultBrowserWindowMode() },
    );
}

export async function selectBrowserTab(pageId) {
    ensureBrowserControlEnabled();
    const targetPageId = String(pageId || "").trim();
    const controlState = await getBrowserControlStatus();

    if (!controlState.stableTabSwitch) {
        const panelState = await getBrowserPanelState();
        const selectionAction = chooseBrowserTabSelectionAction(controlState, panelState, targetPageId);

        if (selectionAction.mode === "reopen-url" && selectionAction.fallbackUrl) {
            await openBrowserUrl(selectionAction.fallbackUrl);
            return selectionAction.message;
        }
    }

    return runOpenCli(["browser", browserSessionName, "tab", "select", targetPageId]);
}

export async function extractBrowserPage() {
    ensureBrowserControlEnabled();
    return runOpenCli(["browser", browserSessionName, "extract", "--chunk-size", "4000"]);
}

export async function captureBrowserScreenshot(outputPath = "") {
    ensureBrowserControlEnabled();
    const screenshotPath = String(outputPath || getDefaultBrowserScreenshotPath()).trim();
    mkdirSync(dirname(screenshotPath), { recursive: true });
    try {
        await runOpenCli(["browser", browserSessionName, "screenshot", screenshotPath, "--full-page"]);
    } catch (error) {
        if (existsSync(screenshotPath)) {
            rmSync(screenshotPath, { force: true });
        }
        throw createBrowserScreenshotError(error);
    }
    if (!existsSync(screenshotPath)) {
        throw createBrowserScreenshotError("OpenCLI screenshot did not produce a file.");
    }
    const screenshotStat = statSync(screenshotPath);
    if (screenshotStat.size <= 0) {
        rmSync(screenshotPath, { force: true });
        throw createBrowserScreenshotError("OpenCLI screenshot produced an empty file.");
    }
    return {
        screenshotPath,
    };
}
