import "@/assets/styles/window/mainwindow/page/settings/home/SettingsHomePage.css";
import { computed, defineComponent, onMounted, ref } from "vue";
import CommonButton from "@/components/CommonButton";
import CommonDialog from "@/components/dialog/CommonDialog";
import Switch from "@/components/Switch";
import { useBackendStore, useMainWindowStore, useMcpServicesStore, useModelConfigStore, useNotifyStore, useRuntimeStatusStore, useSkillsStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import { CopyDataType } from "@/types/message";

type Section = "general" | "appearance" | "extensions" | "browser" | "updates" | "about";

interface UpdateInfo { current: string; latest: string; hasUpdate: boolean; checking: boolean; }
interface BrowserControlState {
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
}

interface BrowserInstallStep {
    id: string;
    title: string;
    description: string;
    done: boolean;
    actionText?: string;
    action?: () => void;
    disabled?: boolean;
}

interface BrowserCapabilityItem {
    id: string;
    title: string;
    description: string;
    ok: boolean;
}

const VALID_SECTIONS = new Set<Section>(["general", "appearance", "extensions", "browser", "updates", "about"]);

function getInitialSection() {
    if (typeof window === "undefined") {
        return "general" as Section;
    }

    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("settingsSection");
    return candidate && VALID_SECTIONS.has(candidate as Section)
        ? candidate as Section
        : "general" as Section;
}

export default defineComponent({
    name: "SettingsHomePage",
    components: {
        CommonDialog,
        Switch,
    },
    setup() {
        const backendStore = useBackendStore();
        const mainWindowStore = useMainWindowStore();
        const modelConfigStore = useModelConfigStore();
        const skillsStore = useSkillsStore();
        const mcpServicesStore = useMcpServicesStore();
        const notifyStore = useNotifyStore();
        const runtimeStatusStore = useRuntimeStatusStore();

        const runtimeCheckBusy = ref(false);
        const runtimeCheckSummary = ref("");
        const themeOption = ref(0);
        const activeSection = ref<Section>(getInitialSection());

        const opencliStatus = ref({ daemon: "检测中...", extension: "检测中...", version: "" });
        const opencliChecking = ref(false);
        const browserControlEnabled = ref(false);
        const browserInstallGuideVisible = ref(false);
        const browserControlState = ref<BrowserControlState>({
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
        });

        const sundayUpdate = ref<UpdateInfo>({ current: "1.0.0", latest: "", hasUpdate: false, checking: false });
        const opencliUpdate = ref<UpdateInfo>({ current: "", latest: "", hasUpdate: false, checking: false });

        const applyBrowserControlState = (state: Partial<BrowserControlState> | null | undefined) => {
            browserControlState.value = {
                ...browserControlState.value,
                ...(state || {}),
            };
            browserControlEnabled.value = browserControlState.value.enabled;
            opencliStatus.value = {
                daemon: browserControlState.value.daemonLabel || "未运行",
                extension: browserControlState.value.extensionLabel || "未连接",
                version: browserControlState.value.version || "",
            };
        };

        const loadPageData = async () => {
            await Promise.all([
                modelConfigStore.loadConfig().catch(() => undefined),
                skillsStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadThirdPartyAgreement().catch(() => undefined),
            ]);
            await refreshThemeOption();
            await runRuntimeDiagnostics(false);
            await refreshBrowserControlState();
            checkSundayUpdate();
            checkOpencliUpdate();
        };
        onMounted(() => { void loadPageData(); });

        const refreshBrowserControlState = async () => {
            opencliChecking.value = true;
            try {
                const state = (await backendStore.requestServiceConfig(
                    "getBrowserControlState",
                )) as Partial<BrowserControlState> | null;
                applyBrowserControlState(state);
            } catch {
                applyBrowserControlState({
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
                });
            } finally {
                opencliChecking.value = false;
            }
        };

        const persistBrowserControlState = async (enabled: boolean) => {
            const state = (await backendStore.requestServiceConfig(
                "setBrowserControlEnabled",
                enabled,
            )) as Partial<BrowserControlState> | null;
            applyBrowserControlState({
                ...state,
                enabled,
            });
        };

        const refreshThemeOption = async () => {
            themeOption.value = (await backendStore.requestSystem("themeColorOption")) as number;
        };

        const runRuntimeDiagnostics = async (showToast = true) => {
            runtimeCheckBusy.value = true;
            try {
                const runtime = (await backendStore.requestServiceConfig("getRuntimeStatus")) as any;
                const runtimeReady = await backendStore.requestServiceConfig("isMcpRuntimeReady");
                const reason = runtime?.modeReason || "暂无运行时说明。";
                if (runtime?.mode === "live") runtimeStatusStore.setRemoteStatus(runtime.provider || "", runtime.modelId || "", reason, true);
                else if (runtime?.mode === "demo") runtimeStatusStore.setRemoteStatus(runtime.provider || "", runtime.modelId || "", reason, false);
                else if (runtime?.mode === "mock") runtimeStatusStore.setLocalMockStatus(reason);
                else runtimeStatusStore.setRemoteUnknownStatus(reason);
                runtimeCheckSummary.value = runtimeReady ? "运行时检查通过" : "运行时仍需确认";
                if (showToast) notifyStore.showToast({ type: runtimeReady ? "success" : "warning", message: runtimeCheckSummary.value, duration: 1800 });
            } catch (e: any) {
                runtimeCheckSummary.value = "运行时检查失败";
                if (showToast) notifyStore.showToast({ type: "error", message: e?.message || "运行时检查失败", duration: 2200 });
            } finally { runtimeCheckBusy.value = false; }
        };

        const switchTheme = async (value: number) => {
            await backendStore.requestSystem("switchThemeColor", value);
            themeOption.value = value;
        };

        const checkOpencliStatus = async () => {
            await refreshBrowserControlState();
        };

        const copyBrowserExtensionPath = async (showToast = false) => {
            if (!browserControlState.value.extensionPath) {
                if (showToast) {
                    notifyStore.showToast({ type: "warning", message: "当前没有可复制的插件目录。", duration: 2200 });
                }
                return;
            }
            await backendStore.requestSystem(
                "copyToClipboard",
                browserControlState.value.extensionPath,
                CopyDataType.CopyText,
            );
            if (showToast) {
                notifyStore.showToast({ type: "success", message: "插件路径已复制。", duration: 1800 });
            }
        };

        const installOpencliExtension = async () => {
            try {
                await backendStore.requestSystem("runCliCommand", "opencli daemon restart 2>/dev/null; sleep 1; opencli daemon status 2>/dev/null | grep -q connected && echo already-connected || echo need-install");
                await refreshBrowserControlState();
                if (browserControlState.value.extensionConnected) {
                    notifyStore.showToast({ type: "success", message: "OpenCLI 插件已连接。", duration: 2000 });
                } else {
                    await copyBrowserExtensionPath();
                    notifyStore.showToast({ type: "info", message: "插件路径已复制。请打开 chrome://extensions → 开发者模式 → 加载已解压的扩展程序，并选择刚刚复制的目录。", duration: 6000 });
                }
            } catch {
                notifyStore.showToast({ type: "error", message: "OpenCLI 启动失败。请确认已安装 opencli: npm install -g @jackwener/opencli", duration: 3000 });
            }
        };

        const openBrowserExtensionPage = async () => {
            await backendStore.requestSystem(
                "runCliCommand",
                "if command -v google-chrome >/dev/null 2>&1; then nohup google-chrome --new-window chrome://extensions >/dev/null 2>&1 & elif command -v google-chrome-stable >/dev/null 2>&1; then nohup google-chrome-stable --new-window chrome://extensions >/dev/null 2>&1 & elif command -v chromium >/dev/null 2>&1; then nohup chromium --new-window chrome://extensions >/dev/null 2>&1 & elif command -v chromium-browser >/dev/null 2>&1; then nohup chromium-browser --new-window chrome://extensions >/dev/null 2>&1 & else xdg-open chrome://extensions >/dev/null 2>&1 & fi; echo started",
            );
        };

        const enableBrowserControl = async () => {
            browserControlEnabled.value = true;
            await persistBrowserControlState(true);
            await checkOpencliStatus();
            if (!browserControlState.value.extensionConnected) {
                browserInstallGuideVisible.value = true;
                await installOpencliExtension();
                await openBrowserExtensionPage();
            } else {
                notifyStore.showToast({ type: "success", message: "浏览器控制已开启。", duration: 2000 });
            }
        };

        const disableBrowserControl = async () => {
            browserControlEnabled.value = false;
            await persistBrowserControlState(false);
            notifyStore.showToast({ type: "info", message: "浏览器控制已关闭。", duration: 1800 });
        };

        const handleBrowserControlChange = async (enabled: boolean) => {
            if (enabled) {
                await enableBrowserControl();
                return;
            }
            await disableBrowserControl();
        };

        const handleBrowserInstallGuideDone = async () => {
            browserInstallGuideVisible.value = false;
            await checkOpencliStatus();
            if (opencliStatus.value.extension === "已连接") {
                notifyStore.showToast({ type: "success", message: "OpenCLI 浏览器插件已连接，现在可以直接用对话控制浏览器。", duration: 2600 });
            } else {
                notifyStore.showToast({ type: "warning", message: "尚未检测到插件连接。完成安装后可再次点击刷新状态。", duration: 2600 });
            }
        };

        const checkSundayUpdate = async () => {
            sundayUpdate.value.checking = true;
            try {
                const raw = (await backendStore.requestSystem("runCliCommand", "curl -s https://api.github.com/repos/ciconia-w/Sunday/releases/latest 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get('tag_name',''))\" 2>/dev/null || echo ''")) as string;
                const latest = raw.trim().replace(/^v/, "");
                sundayUpdate.value = { current: "1.0.0", latest: latest || "未知", hasUpdate: !!(latest && latest !== "1.0.0"), checking: false };
            } catch {
                sundayUpdate.value = { current: "1.0.0", latest: "检查失败", hasUpdate: false, checking: false };
            }
        };

        const checkOpencliUpdate = async () => {
            opencliUpdate.value.checking = true;
            try {
                const raw = (await backendStore.requestSystem("runCliCommand", "npm view @jackwener/opencli version 2>/dev/null || echo ''")) as string;
                const latest = raw.trim();
                opencliUpdate.value = { current: opencliStatus.value.version || "—", latest: latest || "未知", hasUpdate: !!(latest && opencliStatus.value.version && latest !== opencliStatus.value.version), checking: false };
            } catch {
                opencliUpdate.value = { current: opencliStatus.value.version || "—", latest: "检查失败", hasUpdate: false, checking: false };
            }
        };

        const updateOpencli = async () => {
            try {
                await backendStore.requestSystem("runCliCommand", "npm install -g @jackwener/opencli 2>&1 | tail -1");
                notifyStore.showToast({ type: "success", message: "OpenCLI 更新完成。", duration: 2000 });
                setTimeout(checkOpencliUpdate, 1000);
            } catch {
                notifyStore.showToast({ type: "error", message: "OpenCLI 更新失败。", duration: 2500 });
            }
        };

        const updateSunday = async () => {
            try {
                notifyStore.showToast({ type: "info", message: "正在更新 Sunday...", duration: 2000 });
                await backendStore.requestSystem("runCliCommand", "cd /home/aaa/personal-agent-desktop && git pull 2>&1 | tail -1");
                notifyStore.showToast({ type: "success", message: "代码已更新，请手动执行构建命令。", duration: 3000 });
            } catch {
                notifyStore.showToast({ type: "error", message: "更新失败。", duration: 2500 });
            }
        };

        const navItems = [
            { id: "general" as Section, label: "通用", icon: "⚙" },
            { id: "appearance" as Section, label: "外观", icon: "☀" },
            { id: "extensions" as Section, label: "扩展", icon: "⊞" },
            { id: "browser" as Section, label: "浏览器", icon: "🌐" },
            { id: "updates" as Section, label: "更新", icon: "↻" },
            { id: "about" as Section, label: "关于", icon: "ℹ" },
        ];

        const appearanceOptions = computed(() => [
            { id: 0, title: "跟随系统", active: themeOption.value === 0 },
            { id: 1, title: "浅色", active: themeOption.value === 1 },
            { id: 2, title: "深色", active: themeOption.value === 2 },
        ]);

        const showBrowserExtensionStatus = computed(() => browserControlEnabled.value);
        const showBrowserDaemonStatus = computed(() => browserControlEnabled.value && !browserControlState.value.daemonRunning);
        const showBrowserPanelEntry = computed(() => browserControlEnabled.value && browserControlState.value.extensionConnected);
        const showBrowserInstallActions = computed(() => browserControlEnabled.value && !browserControlState.value.extensionConnected);
        const browserExtensionActionLabel = computed(() => {
            if (opencliChecking.value) {
                return "检测中...";
            }
            if (!browserControlState.value.daemonRunning) {
                return "启动 OpenCLI";
            }
            return "安装插件";
        });
        const browserInstallSummary = computed(() => {
            if (!browserControlEnabled.value) {
                return "";
            }
            if (!browserControlState.value.daemonRunning) {
                return "先启动或重启 OpenCLI 守护进程，再继续扩展安装。";
            }
            return "保留 guided install：在 Chrome 扩展页加载已解压扩展，然后刷新状态直到显示已连接。";
        });
        const browserRuntimeLimitNotice = computed(() => {
            if (!browserControlEnabled.value) {
                return "";
            }
            return browserControlState.value.runtimeLimitNotice || "";
        });
        const browserCapabilityItems = computed<BrowserCapabilityItem[]>(() => {
            if (!browserControlEnabled.value) {
                return [];
            }

            return [
                {
                    id: "tab-switch",
                    title: "多标签切换",
                    description: browserControlState.value.tabSwitchCapabilityDescription
                        || (
                            browserControlState.value.stableTabSwitch
                                ? "当前运行时支持稳定的标签页切换。"
                                : "当前运行时会退化为重新打开 URL，不能当作可靠多标签能力。"
                        ),
                    ok: browserControlState.value.stableTabSwitch,
                },
                {
                    id: "screenshot",
                    title: "整页截图",
                    description: browserControlState.value.screenshotCapabilityDescription
                        || (
                            browserControlState.value.stableScreenshotCapture
                                ? "当前运行时支持稳定的整页截图。"
                                : "当前运行时可能触发截图运行时错误，建议优先使用页面提取继续任务。"
                        ),
                    ok: browserControlState.value.stableScreenshotCapture,
                },
            ];
        });
        const browserInstallSteps = computed<BrowserInstallStep[]>(() => [
            {
                id: "daemon",
                title: "OpenCLI 守护进程",
                description: browserControlState.value.daemonRunning
                    ? "守护进程已运行，可以继续安装浏览器扩展。"
                    : "需要先启动或重启 OpenCLI 守护进程。",
                done: browserControlState.value.daemonRunning,
                actionText: browserControlState.value.daemonRunning ? undefined : "启动 OpenCLI",
                action: browserControlState.value.daemonRunning ? undefined : () => { void installOpencliExtension(); },
            },
            {
                id: "page",
                title: "打开扩展页",
                description: browserControlState.value.extensionConnected
                    ? "浏览器扩展页安装步骤已完成。"
                    : "打开 chrome://extensions，并启用右上角“开发者模式”。",
                done: browserControlState.value.extensionConnected,
                actionText: browserControlState.value.extensionConnected ? undefined : "打开扩展页",
                action: browserControlState.value.extensionConnected ? undefined : () => { void openBrowserExtensionPage(); },
            },
            {
                id: "path",
                title: "加载已解压扩展",
                description: browserControlState.value.extensionPath
                    ? `使用这个插件目录：${browserControlState.value.extensionPath}`
                    : "尚未检测到插件目录，先刷新状态后再复制路径。",
                done: browserControlState.value.extensionConnected,
                actionText: browserControlState.value.extensionPath ? "复制路径" : "刷新状态",
                action: browserControlState.value.extensionPath
                    ? () => { void copyBrowserExtensionPath(true); }
                    : () => { void checkOpencliStatus(); },
            },
            {
                id: "refresh",
                title: "确认连接",
                description: browserControlState.value.extensionConnected
                    ? "Chrome 插件已连接，现在可以直接在对话或浏览器面板里使用浏览器控制。"
                    : "完成加载后点击刷新状态，直到这里显示“已连接”。",
                done: browserControlState.value.extensionConnected,
                actionText: browserControlState.value.extensionConnected ? "打开面板" : "刷新状态",
                action: browserControlState.value.extensionConnected
                    ? () => { mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL); }
                    : () => { void checkOpencliStatus(); },
            },
        ]);

        return {
            activeSection, navItems, runtimeCheckBusy, runtimeCheckSummary,
            runRuntimeDiagnostics, modelConfigStore, appearanceOptions, switchTheme,
            opencliStatus, opencliChecking, checkOpencliStatus, installOpencliExtension,
            browserControlEnabled, browserInstallGuideVisible, handleBrowserControlChange, handleBrowserInstallGuideDone,
            browserControlState, copyBrowserExtensionPath, openBrowserExtensionPage,
            showBrowserExtensionStatus, showBrowserDaemonStatus, showBrowserPanelEntry, showBrowserInstallActions,
            browserExtensionActionLabel, browserInstallSummary, browserInstallSteps, browserCapabilityItems, browserRuntimeLimitNotice,
            sundayUpdate, opencliUpdate, checkSundayUpdate, checkOpencliUpdate, updateOpencli, updateSunday,
            openModelSettings: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.MODEL_SETTINGS),
            openExtensions: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS),
            openBrowserPanel: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL),
            reopenBrowserInstallGuide: () => { browserInstallGuideVisible.value = true; },
        };
    },
    render() {
        return (
            <div class="settings-page">
                <div class="settings-page__nav">
                    <div class="settings-page__nav-title">设置</div>
                    {this.navItems.map((item) => (
                        <button key={item.id} type="button"
                            class={["settings-page__nav-item", this.activeSection === item.id && "settings-page__nav-item--active"]}
                            onClick={() => { this.activeSection = item.id; }}>
                            <span class="settings-page__nav-icon">{item.icon}</span>
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
                <div class="settings-page__content">
                    {this.activeSection === "general" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">运行诊断</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">运行时状态</div>
                                <div class="settings-page__row-desc">{this.runtimeCheckSummary || "检查当前模型连接和运行时状态。"}</div>
                            </div>
                            <CommonButton text={this.runtimeCheckBusy ? "检查中..." : "立即检查"} variant="primary"
                                onClick={() => void this.runRuntimeDiagnostics(true)} />
                        </div>
                        <div class="settings-page__section-title" style="margin-top:24px">模型配置</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">当前模型</div>
                                <div class="settings-page__row-desc">{this.modelConfigStore.config.provider || "deepseek"} / {this.modelConfigStore.config.model || "未配置"}</div>
                            </div>
                            <CommonButton text="打开" variant="primary" onClick={this.openModelSettings} />
                        </div>
                    </div>}
                    {this.activeSection === "appearance" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">主题</div>
                        <div class="settings-page__theme-row">
                            {this.appearanceOptions.map((option) => (
                                <button key={option.id} type="button"
                                    class={["settings-page__theme-btn", option.active && "settings-page__theme-btn--active"]}
                                    onClick={() => this.switchTheme(option.id)}>{option.title}</button>
                            ))}
                        </div>
                    </div>}
                    {this.activeSection === "extensions" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">扩展中心</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">技能 / CLI / MCP</div>
                                <div class="settings-page__row-desc">统一管理技能、CLI 工具、MCP 服务和 IM Bridge。</div>
                            </div>
                            <CommonButton text="打开" variant="primary" onClick={this.openExtensions} />
                        </div>
                    </div>}
                    {this.activeSection === "browser" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">OpenCLI 浏览器</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">浏览器控制</div>
                                <div class="settings-page__row-desc">{this.browserControlEnabled ? "已开启。对话可以直接调用浏览器控制能力。" : "默认关闭。开启后将引导你安装 OpenCLI 浏览器插件。"}</div>
                            </div>
                            <Switch value={this.browserControlEnabled} onChange={(value: boolean) => void this.handleBrowserControlChange(value)} />
                        </div>
                        {this.showBrowserDaemonStatus && <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">守护进程</div>
                                <div class="settings-page__row-desc">{this.opencliStatus.daemon}</div>
                            </div>
                            <span class={["settings-page__badge", this.opencliStatus.daemon === "运行中" ? "settings-page__badge--ok" : "settings-page__badge--warn"]}>
                                {this.opencliStatus.daemon === "运行中" ? "正常" : "异常"}
                            </span>
                        </div>}
                        {this.showBrowserExtensionStatus && <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">Chrome 插件</div>
                                <div class="settings-page__row-desc">{this.opencliStatus.extension}</div>
                            </div>
                            {this.opencliStatus.extension === "已连接" ? (
                                <span class="settings-page__badge settings-page__badge--ok">已连接</span>
                            ) : (
                                <CommonButton text={this.browserExtensionActionLabel} variant="primary"
                                    onClick={this.installOpencliExtension} />
                            )}
                        </div>}
                        {this.showBrowserInstallActions && <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">安装步骤</div>
                                <div class="settings-page__row-desc">{this.browserInstallSummary}</div>
                                <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                                    {this.browserInstallSteps.map((step, index) => (
                                        <div
                                            key={step.id}
                                            style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;background:var(--card-bg,#fff)"
                                            data-browser-install-step={step.id}
                                            data-browser-install-step-done={String(step.done)}
                                        >
                                            <div style="font-size:12px;font-weight:600;min-width:18px;color:var(--text-tertiary,#999)">{index + 1}.</div>
                                            <div style="flex:1 1 auto;min-width:0">
                                                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                                                    <div style="font-size:13px;font-weight:600">{step.title}</div>
                                                    <span class={["settings-page__badge", step.done ? "settings-page__badge--ok" : "settings-page__badge--warn"]}>
                                                        {step.done ? "已完成" : "待操作"}
                                                    </span>
                                                </div>
                                                <div class="settings-page__row-desc" style="word-break:break-all;">
                                                    {step.description}
                                                </div>
                                            </div>
                                            {step.actionText ? (
                                                <CommonButton
                                                    text={step.actionText}
                                                    variant="default"
                                                    disabled={step.disabled}
                                                    onClick={step.action}
                                                />
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                                <CommonButton text="打开安装向导" variant="default" onClick={this.reopenBrowserInstallGuide} />
                                <CommonButton text="复制路径" variant="default" onClick={() => this.copyBrowserExtensionPath(true)} disabled={!this.browserControlState.extensionPath} />
                                <CommonButton text="打开扩展页" variant="default" onClick={this.openBrowserExtensionPage} />
                                <CommonButton text="刷新状态" variant="default" onClick={this.checkOpencliStatus} />
                            </div>
                        </div>}
                        {this.showBrowserPanelEntry && <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">浏览器会话</div>
                                <div class="settings-page__row-desc">打开 Sunday 浏览器面板，查看会话状态并初始化。</div>
                            </div>
                            <CommonButton text="打开面板" variant="default" onClick={this.openBrowserPanel} />
                        </div>}
                        {this.browserCapabilityItems.length ? <div class="settings-page__row">
                            <div style="width:100%">
                                <div class="settings-page__row-title">能力状态</div>
                                <div class="settings-page__row-desc">这些状态来自当前 OpenCLI 运行时画像，不再由前端硬编码版本判断。</div>
                                <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                                    {this.browserCapabilityItems.map((item) => (
                                        <div
                                            key={item.id}
                                            style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;background:var(--card-bg,#fff)"
                                            data-browser-capability-item={item.id}
                                            data-browser-capability-ok={String(item.ok)}
                                        >
                                            <div style="flex:1 1 auto;min-width:0">
                                                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                                                    <div style="font-size:13px;font-weight:600">{item.title}</div>
                                                    <span class={["settings-page__badge", item.ok ? "settings-page__badge--ok" : "settings-page__badge--warn"]}>
                                                        {item.ok ? "稳定" : "受限"}
                                                    </span>
                                                </div>
                                                <div class="settings-page__row-desc">{item.description}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div> : null}
                        {this.browserRuntimeLimitNotice ? <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">已知限制</div>
                                <div class="settings-page__row-desc">{this.browserRuntimeLimitNotice}</div>
                            </div>
                            <span class="settings-page__badge settings-page__badge--warn">注意</span>
                        </div> : null}
                        <CommonButton text="刷新状态" variant="default" onClick={this.checkOpencliStatus}
                            style="margin-top:8px" />
                    </div>}
                    {this.activeSection === "updates" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">Sunday</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">当前版本</div>
                                <div class="settings-page__row-desc">v{this.sundayUpdate.current}</div>
                            </div>
                            <div style="text-align:right">
                                <div class="settings-page__row-title">最新版本</div>
                                <div class="settings-page__row-desc">{this.sundayUpdate.checking ? "检查中..." : (this.sundayUpdate.latest || "—")}</div>
                            </div>
                        </div>
                        <CommonButton text={this.sundayUpdate.checking ? "检查中..." : "检查更新"} variant="default"
                            onClick={this.checkSundayUpdate} style="margin-bottom:24px" />

                        <div class="settings-page__section-title">OpenCLI</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">当前版本</div>
                                <div class="settings-page__row-desc">{this.opencliUpdate.current ? "v" + this.opencliUpdate.current : "—"}</div>
                            </div>
                            <div style="text-align:right">
                                <div class="settings-page__row-title">最新版本</div>
                                <div class="settings-page__row-desc">{this.opencliUpdate.checking ? "检查中..." : (this.opencliUpdate.latest || "—")}</div>
                            </div>
                        </div>
                        <CommonButton text={this.opencliUpdate.checking ? "检查中..." : "检查更新"} variant="default"
                            onClick={this.checkOpencliUpdate} />
                    </div>}
                    {this.activeSection === "about" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">关于 Sunday</div>
                        <p class="settings-page__about">Sunday 是 pi agent 的通用桌面客户端。<br/>AI 接管工作，每天都是周末。<br/>MVP 版本 — 2026.06</p>
                    </div>}
                </div>
                <CommonDialog
                    visible={this.browserInstallGuideVisible}
                    title="安装浏览器控制插件"
                    buttons={[
                        { key: "done", text: "我已安装", type: "primary", suggested: true },
                        { key: "later", text: "稍后", type: "default" },
                    ]}
                    onCancel={() => { this.browserInstallGuideVisible = false; }}
                    onButtonClick={(key: string) => {
                        if (key === "done") {
                            void this.handleBrowserInstallGuideDone();
                            return;
                        }
                        this.browserInstallGuideVisible = false;
                    }}
                >
                    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.6;">
                        <div>Sunday 当前采用 guided install 路线，不做浏览器扩展一键安装。</div>
                        <div>已为你复制插件目录，并尝试打开浏览器扩展页。</div>
                        <div>当前状态：守护进程 {this.browserControlState.daemonLabel} / 插件 {this.browserControlState.extensionLabel}</div>
                        <div style="padding:8px 10px;border-radius:8px;background:var(--card-bg,#fff);border:1px solid var(--border-color,#e5e7eb);word-break:break-all;">
                            插件目录：{this.browserControlState.extensionPath || "尚未检测到"}
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <CommonButton text="复制路径" variant="default" onClick={() => this.copyBrowserExtensionPath(true)} disabled={!this.browserControlState.extensionPath} />
                            <CommonButton text="打开扩展页" variant="default" onClick={this.openBrowserExtensionPage} />
                            <CommonButton text="刷新状态" variant="default" onClick={this.checkOpencliStatus} />
                        </div>
                        <div>接下来只需要：</div>
                        <ol style="margin:0;padding-left:18px;">
                            <li>打开右上角“开发者模式”</li>
                            <li>点击“加载已解压的扩展程序”</li>
                            <li>直接粘贴刚刚复制好的插件路径并确认</li>
                            <li>回到这里点击“刷新状态”，直到显示“已连接”</li>
                        </ol>
                        {this.browserRuntimeLimitNotice ? (
                            <div style="color:var(--text-secondary,#666)">已知限制：{this.browserRuntimeLimitNotice}</div>
                        ) : null}
                        <div>安装成功后，Sunday 就可以在对话里直接调用浏览器控制能力。</div>
                    </div>
                </CommonDialog>
            </div>
        );
    },
});
