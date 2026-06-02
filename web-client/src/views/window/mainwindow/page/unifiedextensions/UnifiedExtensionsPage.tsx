import { computed, defineComponent } from "vue";
import { useBackendStore, useMainWindowStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import SkillsPage from "@/views/window/mainwindow/page/settings/skills/SkillsPage";
import CliToolsPage from "@/views/window/mainwindow/page/clitools/CliToolsPage";
import McpServicesPage from "@/views/window/mainwindow/page/settings/mcpservices/McpServicesPage";
import BrowserPanelPage from "@/views/window/mainwindow/page/browserpanel/BrowserPanelPage";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

export default defineComponent({
    name: "UnifiedExtensionsPage",
    components: {
        BrowserPanelPage,
        SkillsPage,
        CliToolsPage,
        McpServicesPage,
    },
    setup() {
        const backendStore = useBackendStore();
        const mainWindowStore = useMainWindowStore();

        const tabs = computed(() => [
            {
                id: MAIN_WINDOW_WORKSPACE_PAGES.SKILLS,
                label: backendStore.translate("技能"),
            },
            {
                id: MAIN_WINDOW_WORKSPACE_PAGES.CLI_TOOLS,
                label: "CLI",
            },
            {
                id: MAIN_WINDOW_WORKSPACE_PAGES.MCP_SERVICES,
                label: "MCP",
            },
            {
                id: MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL,
                label: "浏览器",
            },
        ]);

        const activeTab = computed(() => mainWindowStore.extensionsActiveTab);

        const handleTabClick = async (workspacePage: string) => {
            if (workspacePage === mainWindowStore.extensionsActiveTab) {
                return;
            }

            await mainWindowStore.openExtensionsPage(workspacePage);
        };

        return {
            tabs,
            activeTab,
            handleTabClick,
        };
    },
    render() {
        return (
            <div class={["skills-page", "unified-extensions-page"]}>
                <div class="skills-page__header-container">
                    <div class="skills-page__container">
                        <div class="skills-page__tabs">
                            {this.tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    class={[
                                        "skills-page__tab",
                                        this.activeTab === tab.id && "skills-page__tab--active",
                                    ]}
                                    onClick={() => void this.handleTabClick(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {this.activeTab === MAIN_WINDOW_WORKSPACE_PAGES.SKILLS && <SkillsPage />}
                {this.activeTab === MAIN_WINDOW_WORKSPACE_PAGES.CLI_TOOLS && <CliToolsPage />}
                {this.activeTab === MAIN_WINDOW_WORKSPACE_PAGES.MCP_SERVICES && <McpServicesPage />}
                {this.activeTab === MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL && <BrowserPanelPage />}
            </div>
        );
    },
});
