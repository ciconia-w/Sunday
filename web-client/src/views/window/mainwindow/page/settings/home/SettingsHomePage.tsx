import "@/assets/styles/window/mainwindow/page/settings/home/SettingsHomePage.css";
import { computed, defineComponent, onMounted, ref } from "vue";
import CommonButton from "@/components/CommonButton";
import { useBackendStore, useMainWindowStore, useMcpServicesStore, useModelConfigStore, useNotifyStore, useRuntimeStatusStore, useSkillsStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";

type Section = "general" | "appearance" | "extensions" | "browser" | "updates" | "about";

interface UpdateInfo { current: string; latest: string; hasUpdate: boolean; checking: boolean; }

export default defineComponent({
    name: "SettingsHomePage",
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
        const activeSection = ref<Section>("general");

        const opencliStatus = ref({ daemon: "检测中...", extension: "检测中...", version: "" });
        const opencliChecking = ref(false);

        const sundayUpdate = ref<UpdateInfo>({ current: "1.0.0", latest: "", hasUpdate: false, checking: false });
        const opencliUpdate = ref<UpdateInfo>({ current: "", latest: "", hasUpdate: false, checking: false });

        const loadPageData = async () => {
            await Promise.all([
                modelConfigStore.loadConfig().catch(() => undefined),
                skillsStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadThirdPartyAgreement().catch(() => undefined),
            ]);
            await refreshThemeOption();
            await runRuntimeDiagnostics(false);
            checkOpencliStatus();
            checkSundayUpdate();
            checkOpencliUpdate();
        };
        onMounted(() => { void loadPageData(); });

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
            opencliChecking.value = true;
            try {
                const raw = (await backendStore.requestSystem("runCliCommand", "opencli daemon status 2>/dev/null || echo '{}'")) as string;
                opencliStatus.value = {
                    daemon: raw.includes("running") ? "运行中" : "未运行",
                    extension: raw.includes("connected") ? "已连接" : "未连接",
                    version: (raw.match(/Version:\s*v?([\d.]+)/) || ["",""])[1],
                };
            } catch {
                opencliStatus.value = { daemon: "未安装", extension: "—", version: "" };
            } finally { opencliChecking.value = false; }
        };

        const installOpencliExtension = async () => {
            try {
                const extPath = "/home/aaa/personal-agent-desktop/extensions/opencli-browser";
                await backendStore.requestSystem("runCliCommand", "opencli daemon restart 2>/dev/null; sleep 1; opencli daemon status 2>/dev/null | grep -q connected && echo already-connected || echo need-install");
                const status = (await backendStore.requestSystem("runCliCommand", "opencli daemon status 2>/dev/null | grep Extension || echo disconnected")) as string;
                if (status.includes("connected")) {
                    opencliStatus.value.extension = "已连接";
                    notifyStore.showToast({ type: "success", message: "OpenCLI 插件已连接。", duration: 2000 });
                } else {
                    await backendStore.requestSystem("runCliCommand", `python3 -c "import pyperclip; pyperclip.copy('${extPath}')" 2>/dev/null; echo done`);
                    notifyStore.showToast({ type: "info", message: "插件路径已复制。请打开 chrome://extensions → 开发者模式 → 加载已解压的扩展程序，选择 Sunday/extensions/opencli-browser", duration: 6000 });
                }
            } catch {
                notifyStore.showToast({ type: "error", message: "OpenCLI 启动失败。请确认已安装 opencli: npm install -g @jackwener/opencli", duration: 3000 });
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

        return {
            activeSection, navItems, runtimeCheckBusy, runtimeCheckSummary,
            runRuntimeDiagnostics, modelConfigStore, appearanceOptions, switchTheme,
            opencliStatus, opencliChecking, checkOpencliStatus, installOpencliExtension,
            sundayUpdate, opencliUpdate, checkSundayUpdate, checkOpencliUpdate, updateOpencli, updateSunday,
            openModelSettings: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.MODEL_SETTINGS),
            openExtensions: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS),
            openBrowserPanel: () => mainWindowStore.openExtensionsPage(MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL),
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
                                <div class="settings-page__row-desc">统一管理技能、CLI 工具和 MCP 服务。</div>
                            </div>
                            <CommonButton text="打开" variant="primary" onClick={this.openExtensions} />
                        </div>
                    </div>}
                    {this.activeSection === "browser" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">OpenCLI 浏览器</div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">守护进程</div>
                                <div class="settings-page__row-desc">{this.opencliStatus.daemon}</div>
                            </div>
                            <span class={["settings-page__badge", this.opencliStatus.daemon === "运行中" ? "settings-page__badge--ok" : "settings-page__badge--warn"]}>
                                {this.opencliStatus.daemon === "运行中" ? "正常" : "异常"}
                            </span>
                        </div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">Chrome 插件</div>
                                <div class="settings-page__row-desc">{this.opencliStatus.extension}</div>
                            </div>
                            {this.opencliStatus.extension === "已连接" ? (
                                <span class="settings-page__badge settings-page__badge--ok">已连接</span>
                            ) : (
                                <CommonButton text={this.opencliChecking ? "检测中..." : "安装插件"} variant="primary"
                                    onClick={this.installOpencliExtension} />
                            )}
                        </div>
                        <div class="settings-page__row">
                            <div>
                                <div class="settings-page__row-title">浏览器会话</div>
                                <div class="settings-page__row-desc">打开 Sunday 浏览器面板，查看会话状态并初始化。</div>
                            </div>
                            <CommonButton text="打开面板" variant="default" onClick={this.openBrowserPanel} />
                        </div>
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
            </div>
        );
    },
});
