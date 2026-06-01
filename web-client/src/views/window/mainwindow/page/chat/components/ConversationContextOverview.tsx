import { defineComponent, type PropType } from "vue";

type OverviewPill = {
    key: string;
    label: string;
    actionable: boolean;
};

export default defineComponent({
    name: "ConversationContextOverview",
    props: {
        title: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        pills: {
            type: Array as PropType<OverviewPill[]>,
            default: () => [],
        },
        onPillClick: {
            type: Function as PropType<(key: string, actionable: boolean) => void>,
            default: undefined,
        },
    },
    render() {
        if (this.pills.length === 0) {
            return null;
        }

        return (
            <div class="chat-view__context-overview">
                <div class="chat-view__context-overview-title">{this.title}</div>
                <div class="chat-view__context-overview-pills">
                    {this.pills.map((pill) => (
                        <button
                            key={pill.key}
                            type="button"
                            class={[
                                "chat-view__context-pill",
                                pill.actionable && "chat-view__context-pill--actionable",
                            ]}
                            onClick={() => this.onPillClick?.(pill.key, pill.actionable)}
                        >
                            {pill.label}
                        </button>
                    ))}
                </div>
                <div class="chat-view__context-overview-description">{this.description}</div>
            </div>
        );
    },
});
