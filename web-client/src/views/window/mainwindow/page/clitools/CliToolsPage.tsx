import { computed, defineComponent, ref } from "vue";
import TextButton from "@/components/TextButton";
import ToolManagementList from "@/views/window/mainwindow/page/settings/common/components/ToolManagementList";
import { useBackendStore } from "@/stores";
import { convertCliToolToToolItem, type CliToolItem } from "@/views/window/mainwindow/page/settings/common/types";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

const DEFAULT_TOOLS: CliToolItem[] = [
    { id: "gh-cli", name: "gh cli", description: "GitHub CLI，管理仓库、PR、Issue。", enabled: false, statusText: "检测中..." },
    { id: "opencli", name: "opencli", description: "网页到命令行的桥接工具。", enabled: false, statusText: "检测中..." },
    { id: "lark-cli", name: "lark cli", description: "飞书 CLI，文档、消息、表格。", enabled: false, statusText: "检测中..." },
];

function parseJson(value: string): Record<string, unknown> | null {
    if (!value) return null;
    try { return JSON.parse(value.trim()) as Record<string, unknown>; } catch { return null; }
}

// Cache: only auto-detect once per app session
let cached: CliToolItem[] | null = null;
let detecting = false;

export default defineComponent({
    name: "CliToolsPage",
    components: { ToolManagementList, TextButton },
    setup() {
        const backendStore = useBackendStore();
        const cliTools = ref<CliToolItem[]>(cached ? [...cached] : [...DEFAULT_TOOLS]);
        const loading = ref(detecting);

        const refreshAll = async () => {
            loading.value = true;
            const results: CliToolItem[] = [...DEFAULT_TOOLS];
            await Promise.all([
                (async () => {
                    try {
                        const r = (await backendStore.requestSystem("runCliCommand", "gh auth status --json hosts 2>/dev/null || echo '{}'")) as string;
                        const h = parseJson(r)?.hosts as Record<string, Array<{ active?: boolean; login?: string }>> | undefined;
                        const host = h ? Object.values(h).flat().find((x) => x.active) : null;
                        results[0] = { ...results[0], enabled: !!host, statusText: host ? `已授权，${host.login || "GitHub"}` : "已安装，待授权" };
                    } catch { results[0] = { ...results[0], enabled: false, statusText: "未安装" }; }
                })(),
                (async () => {
                    try {
                        const r = (await backendStore.requestSystem("runCliCommand", "opencli daemon status 2>/dev/null || echo 'not running'")) as string;
                        results[1] = { ...results[1], enabled: !r.includes("not running"), statusText: r.includes("not running") ? "浏览器未连接" : "可用" };
                    } catch { results[1] = { ...results[1], enabled: false, statusText: "未安装" }; }
                })(),
                (async () => {
                    try {
                        const r = (await backendStore.requestSystem("runCliCommand", "lark-cli auth status 2>/dev/null || echo '{}'")) as string;
                        const p = parseJson(r);
                        const ok = p?.tokenStatus === "ok" || p?.tokenStatus === "needs_refresh";
                        results[2] = { ...results[2], enabled: ok, statusText: ok ? `已授权，${p?.userName || "飞书"}` : "已安装，待授权" };
                    } catch { results[2] = { ...results[2], enabled: false, statusText: "未安装" }; }
                })(),
            ]);
            cliTools.value = results;
            cached = results;
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

        return {
            titleText: computed(() => "CLI 工具"),
            subtitleText: computed(() => "命令行工具能力，后续将演进为 CLI 商店。"),
            refreshText: computed(() => loading.value ? "检测中..." : "刷新状态"),
            cliToolItems: computed(() => cliTools.value.map(convertCliToolToToolItem)),
            handleToggle, refreshAll,
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
                                isLoading={false}
                                items={this.cliToolItems}
                                showEditButton={false}
                                loadingText=""
                                emptyText="暂无 CLI 工具。"
                                onToggleItem={this.handleToggle}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    },
});
