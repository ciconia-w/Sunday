import { computed, defineComponent, ref } from "vue";
import TextButton from "@/components/TextButton";
import ToolManagementList from "@/views/window/mainwindow/page/settings/common/components/ToolManagementList";
import { useBackendStore, useNotifyStore } from "@/stores";
import { convertCliToolToToolItem, type CliToolItem } from "@/views/window/mainwindow/page/settings/common/types";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

interface CliToolRuntimeItem extends CliToolItem {
    statusToken: string;
    detailText?: string;
    actionText?: string;
    actionDisabled?: boolean;
    actionCommand?: string;
}

const DEFAULT_TOOLS: CliToolItem[] = [
    { id: "gh-cli", name: "gh cli", description: "GitHub CLI，管理仓库、PR、Issue。", enabled: false, statusText: "检测中..." },
    { id: "opencli", name: "opencli", description: "网页到命令行的桥接工具。", enabled: false, statusText: "检测中..." },
    { id: "lark-cli", name: "lark cli", description: "飞书 CLI，文档、消息、表格。", enabled: false, statusText: "检测中..." },
];

// Cache: only auto-detect once per app session
let cached: CliToolRuntimeItem[] | null = null;
let detecting = false;

export default defineComponent({
    name: "CliToolsPage",
    components: { ToolManagementList, TextButton },
    setup() {
        const backendStore = useBackendStore();
        const notifyStore = useNotifyStore();
        const cliTools = ref<CliToolRuntimeItem[]>(
            cached
                ? [...cached]
                : DEFAULT_TOOLS.map((tool) => ({ ...tool, statusToken: "checking" })),
        );
        const loading = ref(detecting);

        const refreshAll = async () => {
            loading.value = true;
            try {
                const results = (await backendStore.requestServiceConfig("getCliToolsState")) as CliToolRuntimeItem[];
                cliTools.value = Array.isArray(results) && results.length > 0
                    ? results
                    : DEFAULT_TOOLS.map((tool) => ({ ...tool, statusToken: "unknown" }));
                cached = cliTools.value;
            } catch {
                cliTools.value = DEFAULT_TOOLS.map((tool) => ({ ...tool, statusToken: "unknown" }));
                cached = cliTools.value;
            }
            detecting = false;
            loading.value = false;
        };

        // First mount: auto-detect in background
        if (!cached && !detecting) {
            detecting = true;
            setTimeout(refreshAll, 100);
        }

        const handleToggle = async (toolId: string, enabled: boolean) => {
            if (!enabled) return;
            if (toolId === "gh-cli") {
                await backendStore.requestSystem("runCliCommand", "nohup gh auth login --web --git-protocol https >/tmp/sunday-gh-auth.log 2>&1 & echo started");
            } else if (toolId === "opencli") {
                await backendStore.requestSystem("runCliCommand", "opencli doctor");
            } else if (toolId === "lark-cli") {
                await backendStore.requestSystem("runCliCommand", "lark-cli auth login --no-wait --json --domain all");
            }
            setTimeout(refreshAll, 3000);
        };

        const handleRunAction = async (toolId: string) => {
            const targetTool = cliTools.value.find((item) => item.id === toolId);
            const actionCommand = String(targetTool?.actionCommand || "").trim();

            if (!targetTool?.actionText || !actionCommand) {
                void refreshAll();
                return;
            }

            try {
                await backendStore.requestSystem("runCliCommand", actionCommand);
                notifyStore.showToast({
                    type: "success",
                    message: `${targetTool.name}：${targetTool.actionText}`,
                    duration: 1800,
                });
            } catch (error) {
                notifyStore.showToast({
                    type: "error",
                    message: error instanceof Error ? error.message : "执行 CLI 动作失败，请稍后重试。",
                    duration: 2600,
                });
            }

            setTimeout(refreshAll, 3000);
        };

        return {
            titleText: computed(() => "CLI 工具"),
            subtitleText: computed(() => "命令行工具能力，后续将演进为 CLI 商店。"),
            refreshText: computed(() => loading.value ? "检测中..." : "刷新状态"),
            cliToolItems: computed(() => cliTools.value.map(convertCliToolToToolItem)),
            loading,
            handleToggle, handleRunAction, refreshAll,
        };
    },
    render() {
        return (
            <div class="skills-page">
                <div class="skills-page__header-container">
                    <div class="skills-page__container">
                        <div class="skills-page__header">
                            <div class="skills-page__header-left">
                                <div class="skills-page__header-content">
                                    <div class="skills-page__title">{this.titleText}</div>
                                    <div class="skills-page__subtitle">{this.subtitleText}</div>
                                </div>
                            </div>
                            <div class="skills-page__actions">
                                <TextButton text={this.refreshText} onClick={this.refreshAll} />
                            </div>
                        </div>
                    </div>
                </div>
                <div class="skills-page__content" style="overflow-y:auto">
                    <div class="skills-page__content-container">
                        <div class="skills-page__container">
                            <ToolManagementList
                                isLoading={this.loading}
                                items={this.cliToolItems}
                                showEditButton={false}
                                loadingText="正在检测 CLI 工具..."
                                emptyText="暂无 CLI 工具。"
                                onRunItemAction={this.handleRunAction}
                                onToggleItem={this.handleToggle}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    },
});
