import "@/assets/styles/window/mainwindow/page/settings/home/SettingsHomePage.css";
import { computed, defineComponent, onMounted, ref } from "vue";
import CommonButton from "@/components/CommonButton";
import { useBackendStore, useMainWindowStore, useMcpServicesStore, useModelConfigStore, useNotifyStore, useRuntimeStatusStore, useSkillsStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";

type Section = "general" | "appearance" | "extensions" | "about";

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

        const loadPageData = async () => {
            await Promise.all([
                modelConfigStore.loadConfig().catch(() => undefined),
                skillsStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadPageData().catch(() => undefined),
                mcpServicesStore.loadThirdPartyAgreement().catch(() => undefined),
            ]);
            await refreshThemeOption();
            await runRuntimeDiagnostics(false);
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

        const navItems = [
            { id: "general" as Section, label: "通用", icon: "⚙" },
            { id: "appearance" as Section, label: "外观", icon: "☀" },
            { id: "extensions" as Section, label: "扩展", icon: "⊞" },
            { id: "about" as Section, label: "关于", icon: "ℹ" },
        ];

        const appearanceOptions = computed(() => [
            { id: 0, title: "跟随系统", active: themeOption.value === 0 },
            { id: 1, title: "浅色", active: themeOption.value === 1 },
            { id: 2, title: "深色", active: themeOption.value === 2 },
        ]);

        const goBack = () => mainWindowStore.goBackWorkspacePage();

        return {
            activeSection, navItems, runtimeCheckBusy, runtimeCheckSummary,
            runRuntimeDiagnostics, modelConfigStore, appearanceOptions, switchTheme, goBack,
            openModelSettings: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.MODEL_SETTINGS),
            openExtensions: () => mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS),
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
                    {this.activeSection === "about" && <div class="settings-page__panel">
                        <div class="settings-page__section-title">关于 Sunday</div>
                        <p class="settings-page__about">Sunday 是 pi agent 的通用桌面客户端。AI 接管工作，每天都是周末。MVP 版本 — 2026.05</p>
                    </div>}
                </div>
            </div>
        );
    },
});
