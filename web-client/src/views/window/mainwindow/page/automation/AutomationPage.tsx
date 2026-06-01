import "@/assets/styles/window/mainwindow/page/automation/AutomationPage.css";
import { computed, defineComponent } from "vue";
import { useBackendStore, useMainWindowStore, useWindowChannelStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";

const STARTERS = [
    { id: "repo", icon: "📁", title: "检查工作区", desc: "总结项目结构，列出最值得看的文件" },
    { id: "file", icon: "📄", title: "处理文件", desc: "分析工作区文件，给出修改建议" },
    { id: "bash", icon: "⚡", title: "运行 Bash", desc: "检查环境并汇报关键结果" },
];

export default defineComponent({
    name: "AutomationPage",
    setup() {
        const backendStore = useBackendStore();
        const mainWindowStore = useMainWindowStore();
        const windowChannelStore = useWindowChannelStore();
        const openChat = async (prompt: string) => {
            await mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.CHAT);
            windowChannelStore.setPendingPrompt(prompt, true);
        };
        return { starters: STARTERS, openChat };
    },
    render() {
        return (
            <div class="automation-page">
                <div class="automation-page__hero">
                    <h2 class="automation-page__title">自动化</h2>
                    <p class="automation-page__desc">选择一个起点，Sunday 会在对话中继续完成任务。</p>
                </div>
                <div class="automation-page__grid">
                    {this.starters.map((item) => (
                        <button key={item.id} type="button" class="automation-page__card"
                            onClick={() => void this.openChat(`${item.title}：${item.desc}。`)}>
                            <span class="automation-page__card-icon">{item.icon}</span>
                            <div class="automation-page__card-body">
                                <div class="automation-page__card-title">{item.title}</div>
                                <div class="automation-page__card-desc">{item.desc}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    },
});
