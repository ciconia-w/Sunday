import { defineComponent, computed } from "vue";
import { useRuntimeStatusStore } from "@/stores/runtimeStatus";
import { useDebugEventsStore } from "@/stores/debugEvents";
import { useConversationManagerStore } from "@/stores/conversationmanager";

export default defineComponent({
    name: "DebugSessionPanel",

    setup() {
        const runtime = useRuntimeStatusStore();
        const debugEvents = useDebugEventsStore();
        const conversations = useConversationManagerStore();

        const currentMessageCount = computed(() => {
            return Object.keys(conversations.getCurrentMessagesRender?.messages || {}).length;
        });

        const latest = computed(() => debugEvents.sessionEvents[0] ?? null);

        return {
            runtime,
            debugEvents,
            currentMessageCount,
            latest,
        };
    },

    render() {
        return (
            <div class="debug-session-panel">
                <div class="debug-session-panel__row">
                    <strong>mode</strong>
                    <span>{this.runtime.mode}</span>
                </div>
                <div class="debug-session-panel__row">
                    <strong>model</strong>
                    <span>{this.runtime.provider}/{this.runtime.modelId}</span>
                </div>
                <div class="debug-session-panel__row">
                    <strong>messages</strong>
                    <span>{this.currentMessageCount}</span>
                </div>
                <div class="debug-session-panel__row">
                    <strong>latest</strong>
                    <span>{this.latest ? `${this.latest.event} · ${this.latest.sessionId}` : "none"}</span>
                </div>
            </div>
        );
    },
});

