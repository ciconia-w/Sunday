import { computed, defineComponent, inject } from "vue";
import { useConversationManagerStore, useMainWindowStore } from "@/stores";
import { ConversationStatus, type ConversationIndexWithStatus } from "@/types/conversation";
import { CHAT_INPUT_KEY, type ChatInputContext } from "@/types/chat-input";
import { STARTER_TASKS } from "@/configs/starterTasks";

export default defineComponent({
    name: "GenericAssistant",

    setup() {
        const conversationManagerStore = useConversationManagerStore();
        const mainWindowStore = useMainWindowStore();
        const chatInputContext = inject<ChatInputContext | null>(CHAT_INPUT_KEY, null);

        const recentConversationCandidates = computed<ConversationIndexWithStatus[]>(() => {
            const currentConversationId = conversationManagerStore.getCurrentConversationId;
            return conversationManagerStore.getConversationIndexListWithStatus
                .filter((item) => item.assistant === "uos-ai-generic")
                .filter((item) => item.id !== currentConversationId)
                .filter((item) => item.title?.trim())
                .slice(0, 3);
        });

        const hasRecentConversations = computed(() => recentConversationCandidates.value.length > 0);
        const recentWorkPanelTitle = computed(() => "继续最近工作");
        const recentWorkPanelDesc = computed(() => "回到最近一次对话，继续当前任务。");
        const recentWorkActionLabel = computed(() => "打开会话");
        const recentWorkEmptyText = computed(() => "完成第一条任务后，最近的对话会显示在这里。");
        const starterPanelTitle = computed(() => "快速起手");
        const starterPanelDesc = computed(() => "先预填一个常用任务，再按你的方式继续。");
        const starterTasks = computed(() => STARTER_TASKS);
        const canApplyStarterTask = computed(() => !chatInputContext?.isInputDisabled?.());
        const getRecentConversationSummary = (conversation: ConversationIndexWithStatus) => {
            return String(conversation.introduction ?? "")
                .replace(/\s+/g, " ")
                .trim();
        };

        const getRecentConversationTitle = (conversation: ConversationIndexWithStatus) => {
            return String(conversation.title ?? "").trim() || "新对话";
        };

        const formatRecentConversationTime = (timestamp: number) => {
            if (!timestamp) {
                return "最近";
            }

            try {
                return new Intl.DateTimeFormat("zh-CN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                }).format(new Date(timestamp));
            } catch {
                return "最近";
            }
        };

        const getRecentConversationStatusLabel = (conversation: ConversationIndexWithStatus) => {
            if (conversation.conversationStatus === ConversationStatus.Generating) {
                return "生成中";
            }
            if (conversation.runtime_mode) {
                return conversation.runtime_mode === "live"
                    ? "实时"
                    : conversation.runtime_mode === "demo"
                      ? "演示"
                      : String(conversation.runtime_mode);
            }
            return "最近";
        };

        const handleOpenRecentConversation = async (conversationId: string) => {
            if (!conversationId) {
                return;
            }

            await conversationManagerStore.switchConversation(conversationId);
            await mainWindowStore.openChatPage();
        };

        const handleApplyStarterTask = (prompt: string) => {
            if (!chatInputContext || !prompt || chatInputContext.isInputDisabled?.()) {
                return;
            }

            chatInputContext.fillInput(prompt, "replace");
            chatInputContext.focusInput();
        };

        return {
            recentConversationCandidates,
            hasRecentConversations,
            recentWorkPanelTitle,
            recentWorkPanelDesc,
            recentWorkActionLabel,
            recentWorkEmptyText,
            starterPanelTitle,
            starterPanelDesc,
            starterTasks,
            canApplyStarterTask,
            getRecentConversationSummary,
            getRecentConversationTitle,
            formatRecentConversationTime,
            getRecentConversationStatusLabel,
            handleOpenRecentConversation,
            handleApplyStarterTask,
        };
    },

    render() {
        return (
            <div class="generic-assistant">
                <div class="generic-assistant__recent-panel" data-welcome-recent-work="true">
                    <div class="generic-assistant__recent-header">
                        <div class="generic-assistant__recent-title">{this.recentWorkPanelTitle}</div>
                        <div class="generic-assistant__recent-desc">{this.recentWorkPanelDesc}</div>
                    </div>
                    {this.hasRecentConversations ? (
                        <div class="generic-assistant__recent-list">
                            {this.recentConversationCandidates.map((conversation) => {
                                const summary = this.getRecentConversationSummary(conversation);

                                return (
                                    <button
                                        key={conversation.id}
                                        type="button"
                                        class="generic-assistant__recent-card"
                                        data-recent-conversation-card="true"
                                        data-recent-conversation-id={conversation.id}
                                        data-recent-conversation-summary={summary}
                                        onClick={() => void this.handleOpenRecentConversation(conversation.id)}
                                    >
                                        <div class="generic-assistant__recent-card-top">
                                            <div class="generic-assistant__recent-card-title">
                                                {this.getRecentConversationTitle(conversation)}
                                            </div>
                                            <div class="generic-assistant__recent-card-status">
                                                {this.getRecentConversationStatusLabel(conversation)}
                                            </div>
                                        </div>
                                        {summary && <div class="generic-assistant__recent-card-summary">{summary}</div>}
                                        <div class="generic-assistant__recent-card-meta">
                                            <span>{conversation.model_name || "Sunday"}</span>
                                            <span>{this.formatRecentConversationTime(conversation.updated_at)}</span>
                                        </div>
                                        <div
                                            class="generic-assistant__recent-card-action"
                                            data-welcome-open-conversation="true"
                                        >
                                            {this.recentWorkActionLabel}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div class="generic-assistant__recent-empty">{this.recentWorkEmptyText}</div>
                    )}
                </div>
                <div class="generic-assistant__start-panel">
                    <div class="generic-assistant__starter-header">
                        <div class="generic-assistant__starter-title">{this.starterPanelTitle}</div>
                        <div class="generic-assistant__starter-desc">{this.starterPanelDesc}</div>
                    </div>
                    <div class="generic-assistant__start-list">
                        {this.starterTasks.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                class="generic-assistant__start-card"
                                data-welcome-starter-card="true"
                                data-welcome-starter-id={item.id}
                                disabled={!this.canApplyStarterTask}
                                onClick={() => this.handleApplyStarterTask(item.prompt)}
                            >
                                <span class="generic-assistant__start-card-icon">{item.icon}</span>
                                <div class="generic-assistant__start-card-body">
                                    <div class="generic-assistant__start-card-title">{item.title}</div>
                                    <div class="generic-assistant__start-card-desc">{item.description}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

            </div>
        );
    },
});
