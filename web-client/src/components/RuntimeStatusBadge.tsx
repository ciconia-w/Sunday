import { defineComponent, computed } from "vue";
import { useRuntimeStatusStore } from "@/stores/runtimeStatus";

export default defineComponent({
    name: "RuntimeStatusBadge",

    setup() {
        const runtime = useRuntimeStatusStore();

        const label = computed(() => {
            if (runtime.mode === "remote-live") {
                return `LIVE · ${runtime.provider}/${runtime.modelId}`;
            }
            if (runtime.mode === "remote-demo") {
                return `DEMO · ${runtime.provider}/${runtime.modelId}`;
            }
            if (runtime.mode === "remote-unknown") {
                return "RUNTIME UNKNOWN";
            }
            return "OFFLINE MOCK";
        });

        const title = computed(() => runtime.reason);

        return {
            runtime,
            label,
            title,
        };
    },

    render() {
        return (
            <div
                class={[
                    "runtime-status-badge",
                    `runtime-status-badge--${this.runtime.mode}`,
                ]}
                title={this.title}
            >
                {this.label}
            </div>
        );
    },
});
