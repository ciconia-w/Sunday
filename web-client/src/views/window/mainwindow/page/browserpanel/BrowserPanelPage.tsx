import { computed, defineComponent, onMounted, ref } from "vue";
import CommonButton from "@/components/CommonButton";
import { useBackendStore, useMainWindowStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import { CopyDataType } from "@/types/message";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

type BrowserTab = {
    index?: number;
    page?: string;
    url?: string;
    title?: string;
    active?: boolean;
};

type BrowserPanelState = {
    enabled: boolean;
    daemonRunning: boolean;
    extensionConnected: boolean;
    daemonLabel: string;
    extensionLabel: string;
    version: string;
    statusSummary: string;
    extensionPath: string;
    outputDir: string;
    sessionName: string;
    repoRoot: string;
    stableTabSwitch: boolean;
    stableScreenshotCapture: boolean;
    runtimeLimitNotice: string;
    knownIssues: string[];
    tabSwitchCapabilityDescription: string;
    screenshotCapabilityDescription: string;
    screenshotGuidance: string;
    screenshotActionLabel: string;
    url: string;
    title: string;
    interactive: number;
    tabs: BrowserTab[];
};

type BrowserActionResponse = {
    ok?: boolean;
    message?: string;
    error?: string;
    errorKind?: string;
    errorHint?: string;
    content?: string;
    screenshotPath?: string;
};

type BrowserCapabilityItem = {
    id: string;
    title: string;
    description: string;
    ok: boolean;
};

const EMPTY_PANEL_STATE: BrowserPanelState = {
    enabled: false,
    daemonRunning: false,
    extensionConnected: false,
    daemonLabel: "未运行",
    extensionLabel: "未连接",
    version: "",
    statusSummary: "浏览器控制已关闭",
    extensionPath: "",
    outputDir: "",
    sessionName: "sunday",
    repoRoot: "",
    stableTabSwitch: true,
    stableScreenshotCapture: true,
    runtimeLimitNotice: "",
    knownIssues: [],
    tabSwitchCapabilityDescription: "当前运行时支持稳定的标签页切换。",
    screenshotCapabilityDescription: "当前运行时支持稳定的整页截图。",
    screenshotGuidance: "建议先刷新状态并确认插件连接正常；如果仍失败，优先使用页面提取继续完成当前任务。",
    screenshotActionLabel: "整页截图",
    url: "",
    title: "",
    interactive: 0,
    tabs: [],
};

export default defineComponent({
    name: "BrowserPanelPage",
    setup() {
        const backend = useBackendStore();
        const mainWindowStore = useMainWindowStore();
        const panelState = ref<BrowserPanelState>({ ...EMPTY_PANEL_STATE });
        const busy = ref(false);
        const loaded = ref(false);
        const extractResult = ref("");
        const extractError = ref("");
        const screenshotPath = ref("");
        const screenshotError = ref("");
        const screenshotErrorKind = ref("");
        const urlInput = ref("");
        const lastActionKind = ref<"idle" | "success" | "error">("idle");
        const lastActionTitle = ref("");
        const lastActionDetail = ref("");

        const setActionFeedback = (
            kind: "success" | "error",
            title: string,
            detail = "",
        ) => {
            lastActionKind.value = kind;
            lastActionTitle.value = title;
            lastActionDetail.value = detail;
        };

        const isExplicitActionFailure = (result: BrowserActionResponse | null | undefined) =>
            !!result &&
            Object.prototype.hasOwnProperty.call(result, "ok") &&
            result.ok !== true;

        const getActionErrorMessage = (result: BrowserActionResponse | null | undefined, fallback: string) => {
            const detail = String(result?.error || result?.message || "").trim();
            return detail || fallback;
        };

        const getActionErrorHint = (result: BrowserActionResponse | null | undefined) =>
            String(result?.errorHint || "").trim();

        const getScreenshotFallbackMessage = () => {
            const version = String(panelState.value.version || "").trim();
            if (version) {
                return `当前 OpenCLI v${version} 未返回截图文件路径。这通常是截图运行时错误，建议先保留当前页面内容，后续升级 OpenCLI 后再重试。`;
            }
            return "当前 OpenCLI 未返回截图文件路径。这通常是截图运行时错误，建议稍后在升级运行时后再重试。";
        };

        const runtimeLimitNotice = computed(() => {
            return String(panelState.value.runtimeLimitNotice || "").trim();
        });

        const browserReady = computed(() =>
            panelState.value.enabled && panelState.value.daemonRunning && panelState.value.extensionConnected,
        );
        const needsDaemon = computed(() =>
            panelState.value.enabled && !panelState.value.daemonRunning,
        );
        const needsExtension = computed(() =>
            panelState.value.enabled && panelState.value.daemonRunning && !panelState.value.extensionConnected,
        );
        const browserActionDisabledReason = computed(() => {
            if (!panelState.value.enabled) {
                return "先在设置页开启浏览器控制。";
            }
            if (!panelState.value.daemonRunning) {
                return "OpenCLI 守护进程未运行，浏览器动作暂不可用。";
            }
            if (!panelState.value.extensionConnected) {
                return "浏览器扩展尚未连接，浏览器动作暂不可用。";
            }
            return "";
        });
        const capabilityItems = computed<BrowserCapabilityItem[]>(() => [
            {
                id: "tab-switch",
                title: "多标签切换",
                description: String(panelState.value.tabSwitchCapabilityDescription || "").trim()
                    || (panelState.value.stableTabSwitch
                        ? "当前运行时支持稳定的标签页切换。"
                        : "当前运行时会退化为重新打开 URL，不能当作可靠多标签能力。"),
                ok: panelState.value.stableTabSwitch,
            },
            {
                id: "screenshot",
                title: "整页截图",
                description: String(panelState.value.screenshotCapabilityDescription || "").trim()
                    || (panelState.value.stableScreenshotCapture
                        ? "当前运行时支持稳定的整页截图。"
                        : "当前运行时可能触发截图运行时错误，建议优先使用页面提取继续任务。"),
                ok: panelState.value.stableScreenshotCapture,
            },
        ]);

        const screenshotGuidance = computed(() => {
            if (!screenshotError.value) {
                return "";
            }

            if (!panelState.value.stableScreenshotCapture) {
                return String(panelState.value.screenshotGuidance || "").trim()
                    || "建议先继续使用页面提取、聊天里的 browser_* 工具或当前活动页内容完成任务，待 OpenCLI 升级后再重试截图。";
            }

            return "建议先刷新状态并确认插件连接正常；如果仍失败，优先使用页面提取继续完成当前任务。";
        });

        const applyPanelState = (nextState: Partial<BrowserPanelState> | null | undefined) => {
            panelState.value = {
                ...panelState.value,
                ...(nextState || {}),
                tabs: Array.isArray(nextState?.tabs) ? nextState.tabs : panelState.value.tabs,
            };
            if (!urlInput.value.trim() && panelState.value.url) {
                urlInput.value = panelState.value.url;
            }
        };

        const refreshPanelState = async () => {
            busy.value = true;
            try {
                const state = (await backend.requestServiceConfig("getBrowserPanelState")) as
                    | Partial<BrowserPanelState>
                    | null;
                applyPanelState(state);
            } catch (error) {
                applyPanelState({
                    ...EMPTY_PANEL_STATE,
                    statusSummary: error instanceof Error ? error.message : "检查失败",
                });
            } finally {
                busy.value = false;
                loaded.value = true;
            }
        };

        onMounted(() => {
            setTimeout(() => {
                void refreshPanelState();
            }, 500);
        });

        const initSession = async () => {
            busy.value = true;
            try {
                const state = (await backend.requestServiceConfig("initBrowserSession")) as Partial<BrowserPanelState> | null;
                applyPanelState(state);
                setActionFeedback("success", "浏览器会话已初始化", state?.statusSummary || "");
            } catch (error) {
                applyPanelState({
                    statusSummary: "初始化失败",
                });
                setActionFeedback("error", "初始化浏览器会话失败", error instanceof Error ? error.message : "初始化失败");
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const openUrl = async (url: string) => {
            const trimmed = url.trim();
            if (!trimmed) {
                return;
            }
            busy.value = true;
            try {
                const result = (await backend.requestServiceConfig("browserOpenUrl", trimmed)) as BrowserActionResponse | null;
                if (isExplicitActionFailure(result)) {
                    setActionFeedback("error", "打开链接失败", getActionErrorMessage(result, "打开链接失败"));
                    return;
                }
                urlInput.value = trimmed;
                setActionFeedback("success", "链接已打开", trimmed);
            } catch (error) {
                setActionFeedback("error", "打开链接失败", error instanceof Error ? error.message : "打开链接失败");
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const extractPage = async () => {
            busy.value = true;
            extractResult.value = "";
            extractError.value = "";
            try {
                const result = (await backend.requestServiceConfig("browserExtractPage")) as BrowserActionResponse | null;
                if (isExplicitActionFailure(result)) {
                    extractError.value = getActionErrorMessage(result, "提取失败");
                    setActionFeedback("error", "页面提取失败", extractError.value);
                    return;
                }
                extractResult.value = String(result?.content || "").trim() || "暂无可提取内容";
                setActionFeedback("success", "页面提取完成", extractResult.value.slice(0, 120));
            } catch (error) {
                extractError.value = error instanceof Error ? error.message : "提取失败";
                setActionFeedback("error", "页面提取失败", extractError.value);
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const captureScreenshot = async () => {
            busy.value = true;
            screenshotPath.value = "";
            screenshotError.value = "";
            screenshotErrorKind.value = "";
            try {
                const result = (await backend.requestServiceConfig("browserCaptureScreenshot", "")) as BrowserActionResponse | null;
                if (isExplicitActionFailure(result)) {
                    const rawMessage = getActionErrorMessage(result, "截图失败");
                    const hintMessage = getActionErrorHint(result);
                    screenshotError.value = hintMessage || rawMessage;
                    screenshotErrorKind.value = String(result?.errorKind || "").trim();
                    setActionFeedback(
                        "error",
                        "整页截图失败",
                        hintMessage && hintMessage !== rawMessage ? `${hintMessage}\n${rawMessage}` : rawMessage,
                    );
                    return;
                }
                screenshotPath.value = String(result?.screenshotPath || "").trim();
                if (!screenshotPath.value) {
                    const rawMessage = getActionErrorMessage(result, getScreenshotFallbackMessage());
                    const hintMessage = getActionErrorHint(result);
                    screenshotError.value = hintMessage || rawMessage;
                    screenshotErrorKind.value = String(result?.errorKind || "").trim() || "missing-output";
                    setActionFeedback(
                        "error",
                        "整页截图失败",
                        hintMessage && hintMessage !== rawMessage ? `${hintMessage}\n${rawMessage}` : rawMessage,
                    );
                    return;
                }
                setActionFeedback("success", "整页截图完成", screenshotPath.value);
            } catch (error) {
                screenshotError.value = error instanceof Error ? error.message : "截图失败";
                screenshotErrorKind.value = "unknown";
                setActionFeedback("error", "整页截图失败", screenshotError.value);
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const selectTab = async (pageId: string) => {
            if (!pageId) {
                return;
            }
            busy.value = true;
            try {
                const result = (await backend.requestServiceConfig("browserSelectTab", pageId)) as BrowserActionResponse | null;
                if (isExplicitActionFailure(result)) {
                    setActionFeedback("error", "切换标签页失败", getActionErrorMessage(result, "切换标签页失败"));
                    return;
                }
                setActionFeedback(
                    "success",
                    "标签页切换已触发",
                    String(result?.message || "").trim() || pageId,
                );
            } catch (error) {
                setActionFeedback("error", "切换标签页失败", error instanceof Error ? error.message : "切换标签页失败");
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const newTab = async () => {
            busy.value = true;
            try {
                const result = (await backend.requestServiceConfig(
                    "browserNewTab",
                    urlInput.value.trim() || "https://example.com",
                )) as BrowserActionResponse | null;
                if (isExplicitActionFailure(result)) {
                    setActionFeedback("error", "新建标签页失败", getActionErrorMessage(result, "新建标签页失败"));
                    return;
                }
                setActionFeedback("success", "新建标签页已触发", urlInput.value.trim() || "https://example.com");
            } catch (error) {
                setActionFeedback("error", "新建标签页失败", error instanceof Error ? error.message : "新建标签页失败");
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const copyExtensionPath = async () => {
            if (!panelState.value.extensionPath) {
                return;
            }
            await backend.requestSystem("copyToClipboard", panelState.value.extensionPath, CopyDataType.CopyText);
            setActionFeedback("success", "插件路径已复制", panelState.value.extensionPath);
        };

        const restartOpenCli = async () => {
            busy.value = true;
            try {
                await backend.requestSystem(
                    "runCliCommand",
                    "opencli daemon restart 2>/dev/null; sleep 1; opencli daemon status 2>/dev/null || true",
                );
                setActionFeedback("success", "OpenCLI 已尝试重启", "稍后刷新状态确认守护进程和插件连接情况。");
            } catch (error) {
                setActionFeedback("error", "启动 OpenCLI 失败", error instanceof Error ? error.message : "启动失败");
            } finally {
                busy.value = false;
                await refreshPanelState();
            }
        };

        const openBrowserExtensionPage = async () => {
            try {
                await backend.requestSystem(
                    "runCliCommand",
                    "if command -v google-chrome >/dev/null 2>&1; then nohup google-chrome --new-window chrome://extensions >/dev/null 2>&1 & elif command -v google-chrome-stable >/dev/null 2>&1; then nohup google-chrome-stable --new-window chrome://extensions >/dev/null 2>&1 & elif command -v chromium >/dev/null 2>&1; then nohup chromium --new-window chrome://extensions >/dev/null 2>&1 & elif command -v chromium-browser >/dev/null 2>&1; then nohup chromium-browser --new-window chrome://extensions >/dev/null 2>&1 & else xdg-open chrome://extensions >/dev/null 2>&1 & fi; echo started",
                );
                setActionFeedback("success", "浏览器扩展页已尝试打开", "加载已解压扩展后，请回到这里刷新状态。");
            } catch (error) {
                setActionFeedback("error", "打开扩展页失败", error instanceof Error ? error.message : "打开失败");
            }
        };

        const copyScreenshotPath = async () => {
            if (!screenshotPath.value) {
                return;
            }
            await backend.requestSystem("copyToClipboard", screenshotPath.value, CopyDataType.CopyText);
        };

        const openScreenshotFile = async () => {
            if (!screenshotPath.value) {
                return;
            }
            await backend.requestSystem("openFile", screenshotPath.value);
        };

        const openOutputDir = async () => {
            if (!panelState.value.outputDir) {
                return;
            }
            await backend.requestSystem("openFile", panelState.value.outputDir);
        };

        const copyExtractResult = async () => {
            if (!extractResult.value) {
                return;
            }
            await backend.requestSystem("copyToClipboard", extractResult.value, CopyDataType.CopyText);
        };

        return {
            panelState,
            busy,
            loaded,
            extractResult,
            extractError,
            screenshotPath,
            screenshotError,
            screenshotErrorKind,
            urlInput,
            lastActionKind,
            lastActionTitle,
            lastActionDetail,
            refreshPanelState,
            initSession,
            openUrl,
            extractPage,
            captureScreenshot,
            selectTab,
            newTab,
            copyExtensionPath,
            copyScreenshotPath,
            openScreenshotFile,
            openOutputDir,
            copyExtractResult,
            openBrowserSettings: () =>
                mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME),
            openBrowserExtensionPage,
            restartOpenCli,
            titleText: computed(() => "浏览器"),
            subtitleText: computed(() => "通过 OpenCLI 管理 Sunday 浏览器会话。"),
            connectionLabel: computed(() =>
                panelState.value.extensionConnected ? "OpenCLI 已连接" : panelState.value.statusSummary,
            ),
            sessionLabel: computed(() => panelState.value.sessionName || "sunday"),
            runtimeLimitNotice,
            screenshotGuidance,
            browserReady,
            needsDaemon,
            needsExtension,
            browserActionDisabledReason,
            capabilityItems,
        };
    },
    render() {
        const activeTab = this.panelState.tabs.find((tab) => tab.active) || this.panelState.tabs[0] || null;
        return (
            <div
                class="skills-page"
                data-browser-panel-root="true"
                data-browser-panel-loaded={String(this.loaded)}
                data-browser-panel-busy={String(this.busy)}
                data-browser-panel-enabled={String(this.panelState.enabled)}
                data-browser-panel-daemon-running={String(this.panelState.daemonRunning)}
                data-browser-panel-extension-connected={String(this.panelState.extensionConnected)}
                data-browser-panel-status-summary={this.panelState.statusSummary || ""}
                data-browser-panel-session={this.sessionLabel}
                data-browser-panel-url={this.panelState.url || ""}
                data-browser-panel-title={this.panelState.title || ""}
                data-browser-panel-interactive={String(this.panelState.interactive || 0)}
                data-browser-panel-tab-count={String(this.panelState.tabs.length)}
                data-browser-panel-active-tab-page={activeTab?.page || ""}
                data-browser-panel-active-tab-url={activeTab?.url || ""}
                data-browser-panel-active-tab-title={activeTab?.title || ""}
                data-browser-panel-extract-ready={String(Boolean(this.extractResult))}
                data-browser-panel-extract-preview={String(this.extractResult || "").replace(/\s+/g, " ").trim().slice(0, 240)}
                data-browser-panel-extract-error={this.extractError || ""}
                data-browser-panel-screenshot-ready={String(Boolean(this.screenshotPath))}
                data-browser-panel-screenshot-path={this.screenshotPath || ""}
                data-browser-panel-screenshot-error={this.screenshotError || ""}
                data-browser-panel-screenshot-error-kind={this.screenshotErrorKind || ""}
                data-browser-panel-last-action-kind={this.lastActionKind}
                data-browser-panel-last-action-title={this.lastActionTitle || ""}
                data-browser-panel-last-action-detail={this.lastActionDetail || ""}
            >
                <div class="skills-page__header-container"><div class="skills-page__container">
                    <div class="skills-page__header">
                        <div class="skills-page__header-left"><div class="skills-page__header-content">
                            <div class="skills-page__title">{this.titleText}</div>
                            <div class="skills-page__subtitle">{this.subtitleText}</div>
                        </div></div>
                        <div class="skills-page__actions">
                            <CommonButton
                                text={this.busy ? "检查中..." : "刷新"}
                                variant="primary"
                                data-browser-panel-action="refresh"
                                onClick={this.refreshPanelState}
                            />
                        </div>
                    </div>
                </div></div>
                <div class="skills-page__content" style="overflow-y:auto">
                    <div class="skills-page__content-container"><div class="skills-page__container">
                        {!this.panelState.enabled ? (
                            <div style="margin-bottom:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px">浏览器控制当前未开启</div>
                                <div style="font-size:12px;color:var(--text-tertiary,#999);margin-bottom:12px">先在设置页开启浏览器控制，再回到这里管理 Sunday 浏览器会话。</div>
                                <CommonButton
                                    text="打开浏览器设置"
                                    variant="primary"
                                    data-browser-panel-action="open-settings"
                                    onClick={this.openBrowserSettings}
                                />
                            </div>
                        ) : null}
                        <div style="margin-bottom:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                            <div style="font-size:14px;font-weight:600;margin-bottom:4px">会话状态</div>
                            <div style="font-size:12px;color:var(--text-tertiary,#999)">{this.connectionLabel}</div>
                            <div style="margin-top:8px;font-size:12px;line-height:1.7">
                                Session: {this.sessionLabel}<br />
                                守护进程: {this.panelState.daemonLabel}<br />
                                插件: {this.panelState.extensionLabel}<br />
                                URL: {this.panelState.url || "无"}<br />
                                标题: {this.panelState.title || "无"}<br />
                                可交互: {this.panelState.interactive} 个元素
                            </div>
                        </div>
                        <div
                            style="margin-bottom:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)"
                            data-browser-panel-capabilities="true"
                        >
                            <div style="font-size:14px;font-weight:600;margin-bottom:8px">能力状态</div>
                            <div style="display:flex;flex-direction:column;gap:10px">
                                {this.capabilityItems.map((item) => (
                                    <div
                                        key={item.id}
                                        style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;background:var(--card-bg,#fff)"
                                        data-browser-panel-capability-item={item.id}
                                        data-browser-panel-capability-ok={String(item.ok)}
                                    >
                                        <div style="flex:1 1 auto;min-width:0">
                                            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                                                <div style="font-size:13px;font-weight:600">{item.title}</div>
                                                <span
                                                    style={{
                                                        display: "inline-flex",
                                                        padding: "2px 8px",
                                                        borderRadius: "999px",
                                                        fontSize: "11px",
                                                        fontWeight: 600,
                                                        color: item.ok ? "#15803d" : "#b45309",
                                                        background: item.ok ? "rgba(22,163,74,0.12)" : "rgba(245,158,11,0.14)",
                                                    }}
                                                >
                                                    {item.ok ? "稳定" : "受限"}
                                                </span>
                                            </div>
                                            <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666)">
                                                {item.description}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {this.runtimeLimitNotice ? (
                            <div
                                style="margin-bottom:16px;padding:12px 16px;background:rgba(245,158,11,0.08);border-radius:10px;border:1px solid rgba(245,158,11,0.2)"
                                data-browser-panel-runtime-notice="true"
                            >
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px">已知限制</div>
                                <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666)">
                                    {this.runtimeLimitNotice}
                                </div>
                            </div>
                        ) : null}
                        {!this.browserReady && this.panelState.enabled ? (
                            <div
                                style="margin-bottom:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)"
                                data-browser-panel-connection-help="true"
                            >
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px">连接引导</div>
                                <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666);margin-bottom:10px">
                                    {this.browserActionDisabledReason}
                                </div>
                                {this.needsDaemon ? (
                                    <div style="font-size:12px;line-height:1.6;color:var(--text-tertiary,#999);margin-bottom:10px">
                                        先启动 OpenCLI 守护进程，再继续扩展安装和浏览器会话初始化。
                                    </div>
                                ) : null}
                                {this.needsExtension ? (
                                    <div style="font-size:12px;line-height:1.6;color:var(--text-tertiary,#999);margin-bottom:10px;word-break:break-all;">
                                        插件目录：{this.panelState.extensionPath || "尚未检测到扩展目录"}
                                    </div>
                                ) : null}
                                <div style="display:flex;gap:8px;flex-wrap:wrap">
                                    {this.needsDaemon ? (
                                        <CommonButton
                                            text="启动 OpenCLI"
                                            variant="primary"
                                            data-browser-panel-action="restart-opencli"
                                            disabled={this.busy}
                                            onClick={this.restartOpenCli}
                                        />
                                    ) : null}
                                    {this.needsExtension ? (
                                        <CommonButton
                                            text="复制插件路径"
                                            variant="default"
                                            data-browser-panel-action="copy-extension-path"
                                            disabled={!this.panelState.extensionPath}
                                            onClick={this.copyExtensionPath}
                                        />
                                    ) : null}
                                    {this.needsExtension ? (
                                        <CommonButton
                                            text="打开扩展页"
                                            variant="default"
                                            data-browser-panel-action="open-extension-page"
                                            disabled={this.busy}
                                            onClick={this.openBrowserExtensionPage}
                                        />
                                    ) : null}
                                    <CommonButton
                                        text="打开浏览器设置"
                                        variant="default"
                                        data-browser-panel-action="open-settings"
                                        disabled={this.busy}
                                        onClick={this.openBrowserSettings}
                                    />
                                    <CommonButton
                                        text="刷新状态"
                                        variant="default"
                                        data-browser-panel-action="refresh-connection"
                                        disabled={this.busy}
                                        onClick={this.refreshPanelState}
                                    />
                                </div>
                            </div>
                        ) : null}
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
                            <input
                                value={this.urlInput}
                                onInput={(event) => {
                                    this.urlInput = String((event.target as HTMLInputElement)?.value || "");
                                }}
                                placeholder="输入 URL"
                                data-browser-panel-input="url"
                                style="flex:1 1 320px;min-width:240px;padding:10px 12px;border-radius:8px;border:1px solid var(--border-color,#e5e7eb);background:var(--card-bg,#fff)"
                            />
                            <CommonButton
                                text="打开链接"
                                variant="primary"
                                data-browser-panel-action="open-url"
                                disabled={this.busy || !this.browserReady}
                                onClick={() => this.openUrl(this.urlInput)}
                            />
                            <CommonButton
                                text="初始化会话"
                                variant="default"
                                data-browser-panel-action="init-session"
                                disabled={this.busy || !this.browserReady}
                                onClick={this.initSession}
                            />
                            <CommonButton
                                text="新建标签页"
                                variant="default"
                                data-browser-panel-action="new-tab"
                                disabled={this.busy || !this.browserReady}
                                onClick={this.newTab}
                            />
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            <CommonButton
                                text="打开 Example"
                                variant="default"
                                data-browser-panel-action="open-example"
                                disabled={this.busy || !this.browserReady}
                                onClick={() => this.openUrl("https://example.com")}
                            />
                            <CommonButton
                                text="打开百度"
                                variant="default"
                                data-browser-panel-action="open-baidu"
                                disabled={this.busy || !this.browserReady}
                                onClick={() => this.openUrl("https://www.baidu.com")}
                            />
                            <CommonButton
                                text="打开 GitHub"
                                variant="default"
                                data-browser-panel-action="open-github"
                                disabled={this.busy || !this.browserReady}
                                onClick={() => this.openUrl("https://github.com")}
                            />
                            <CommonButton
                                text="提取页面"
                                variant="default"
                                data-browser-panel-action="extract-page"
                                disabled={this.busy || !this.browserReady}
                                onClick={this.extractPage}
                            />
                            <CommonButton
                                text={this.panelState.screenshotActionLabel || "整页截图"}
                                variant="default"
                                data-browser-panel-action="capture-screenshot"
                                disabled={this.busy || !this.browserReady}
                                onClick={this.captureScreenshot}
                            />
                            <CommonButton
                                text="复制插件路径"
                                variant="default"
                                data-browser-panel-action="copy-extension-path-shortcut"
                                disabled={!this.panelState.extensionPath}
                                onClick={this.copyExtensionPath}
                            />
                        </div>
                        {this.lastActionTitle ? (
                            <div
                                style={{
                                    marginTop: "16px",
                                    padding: "12px 16px",
                                    background:
                                        this.lastActionKind === "error"
                                            ? "rgba(220,38,38,0.08)"
                                            : "rgba(22,163,74,0.08)",
                                    borderRadius: "10px",
                                    border:
                                        this.lastActionKind === "error"
                                            ? "1px solid rgba(220,38,38,0.2)"
                                            : "1px solid rgba(22,163,74,0.2)",
                                }}
                            >
                                <div style="font-size:14px;font-weight:600;margin-bottom:4px">{this.lastActionTitle}</div>
                                {this.lastActionDetail ? (
                                    <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666)">{this.lastActionDetail}</div>
                                ) : null}
                            </div>
                        ) : null}
                        <div style="margin-top:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                            <div style="font-size:14px;font-weight:600;margin-bottom:8px">标签页</div>
                            {this.panelState.tabs.length ? (
                                <div style="display:flex;flex-direction:column;gap:8px">
                                    {this.panelState.tabs.map((tab) => (
                                        <button
                                            key={tab.page || `${tab.index || 0}-${tab.url || ""}`}
                                            type="button"
                                            data-browser-panel-tab-page={tab.page || ""}
                                            data-browser-panel-tab={tab.page || ""}
                                            data-browser-panel-tab-active={String(Boolean(tab.active))}
                                            data-browser-panel-tab-url={tab.url || ""}
                                            data-browser-panel-tab-title={tab.title || ""}
                                            style={{
                                                textAlign: "left",
                                                padding: "10px 12px",
                                                borderRadius: "8px",
                                                border: tab.active ? "1px solid var(--active-color, #0081ff)" : "1px solid var(--border-color,#e5e7eb)",
                                                background: tab.active ? "rgba(0,129,255,0.08)" : "transparent",
                                                cursor: this.browserReady ? "pointer" : "default",
                                                opacity: this.browserReady ? 1 : 0.72,
                                            }}
                                            disabled={!this.browserReady}
                                            onClick={() => this.browserReady && this.selectTab(tab.page || "")}
                                        >
                                            <div style="font-size:12px;font-weight:600">{tab.title || tab.url || tab.page || "未命名标签页"}</div>
                                            <div style="font-size:11px;color:var(--text-tertiary,#999);margin-top:4px">{tab.url || "无 URL"}</div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div style="font-size:12px;color:var(--text-tertiary,#999)">暂无标签页信息</div>
                            )}
                        </div>
                        {(this.screenshotPath || this.screenshotError) && (
                            <div style="margin-top:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                                <div style="font-size:14px;font-weight:600;margin-bottom:6px">
                                    {this.screenshotPath ? "最近截图" : "截图失败"}
                                </div>
                                {this.screenshotPath ? (
                                    <>
                                        <div style="font-size:12px;color:var(--text-tertiary,#999);margin-bottom:8px">{this.screenshotPath}</div>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                                            <CommonButton
                                                text="打开截图"
                                                variant="default"
                                                data-browser-panel-action="open-screenshot"
                                                onClick={this.openScreenshotFile}
                                            />
                                            <CommonButton
                                                text="复制截图路径"
                                                variant="default"
                                                data-browser-panel-action="copy-screenshot-path"
                                                onClick={this.copyScreenshotPath}
                                            />
                                            {this.panelState.outputDir ? (
                                                <CommonButton
                                                    text="打开输出目录"
                                                    variant="default"
                                                    data-browser-panel-action="open-output-dir"
                                                    onClick={this.openOutputDir}
                                                />
                                            ) : null}
                                        </div>
                                        <img src={`file://${this.screenshotPath}`} style="max-width:100%;border-radius:8px;display:block" alt="Browser Screenshot" />
                                    </>
                                ) : (
                                    <>
                                        <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666)">
                                            {this.screenshotError || "当前运行时没有返回截图文件。"}
                                        </div>
                                        {this.screenshotGuidance ? (
                                            <div
                                                style="margin-top:8px;font-size:12px;line-height:1.6;color:var(--text-tertiary,#999)"
                                                data-browser-panel-screenshot-guidance={this.screenshotGuidance}
                                            >
                                                {this.screenshotGuidance}
                                            </div>
                                        ) : null}
                                        {this.panelState.outputDir ? (
                                            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                                                <CommonButton
                                                    text="打开输出目录"
                                                    variant="default"
                                                    data-browser-panel-action="open-output-dir"
                                                    onClick={this.openOutputDir}
                                                />
                                            </div>
                                        ) : null}
                                    </>
                                )}
                            </div>
                        )}
                        {(this.extractResult || this.extractError) && (
                            <div style="margin-top:16px;padding:12px 16px;background:var(--card-bg,#fff);border-radius:10px;border:1px solid var(--border-color,#e5e7eb)">
                                <div style="font-size:14px;font-weight:600;margin-bottom:6px">
                                    {this.extractResult ? "页面提取" : "页面提取失败"}
                                </div>
                                {this.extractResult ? (
                                    <>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                                            <CommonButton
                                                text="复制提取内容"
                                                variant="default"
                                                data-browser-panel-action="copy-extract-result"
                                                onClick={this.copyExtractResult}
                                            />
                                        </div>
                                        <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;margin:0">{this.extractResult}</pre>
                                    </>
                                ) : (
                                    <div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#666)">
                                        {this.extractError || "当前运行时没有返回可提取内容。"}
                                    </div>
                                )}
                            </div>
                        )}
                    </div></div>
                </div>
            </div>
        );
    },
});
