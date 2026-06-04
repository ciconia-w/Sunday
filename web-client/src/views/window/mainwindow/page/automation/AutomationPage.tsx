import "@/assets/styles/window/mainwindow/page/automation/AutomationPage.css";
import { defineComponent } from "vue";
import { useMainWindowStore, useWindowChannelStore } from "@/stores";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import { STARTER_TASKS } from "@/configs/starterTasks";

export default defineComponent({
    name: "AutomationPage",
    setup() {
        const mainWindowStore = useMainWindowStore();
        const windowChannelStore = useWindowChannelStore();
        const openChat = async (prompt: string) => {
            await mainWindowStore.openWorkspacePage(MAIN_WINDOW_WORKSPACE_PAGES.CHAT);
            windowChannelStore.setPendingPrompt(prompt, true);
        };
        return { starters: STARTER_TASKS, openChat };
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
                            onClick={() => void this.openChat(item.prompt)}>
                            <span class="automation-page__card-icon">{item.icon}</span>
                            <div class="automation-page__card-body">
                                <div class="automation-page__card-title">{item.title}</div>
                                <div class="automation-page__card-desc">{item.description}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        );
    },
});
