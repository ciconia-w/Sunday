import { defineStore } from "pinia";

export type RuntimeConnectionMode = "remote-live" | "remote-demo" | "remote-unknown" | "local-mock";

export interface RuntimeStatusState {
    mode: RuntimeConnectionMode;
    provider: string;
    modelId: string;
    reason: string;
}

export const useRuntimeStatusStore = defineStore("runtimeStatus", {
    state: (): RuntimeStatusState => ({
        mode: "local-mock",
        provider: "mock",
        modelId: "mock/gpt-5.4-mini",
        reason: "local mock fallback",
    }),

    actions: {
        setRemoteStatus(provider: string, modelId: string, reason: string, live: boolean) {
            this.mode = live ? "remote-live" : "remote-demo";
            this.provider = provider;
            this.modelId = modelId;
            this.reason = reason;
        },

        setRemoteUnknownStatus(reason: string) {
            this.mode = "remote-unknown";
            this.provider = "remote";
            this.modelId = "unknown";
            this.reason = reason;
        },

        setLocalMockStatus(reason = "local mock fallback") {
            this.mode = "local-mock";
            this.provider = "mock";
            this.modelId = "mock/gpt-5.4-mini";
            this.reason = reason;
        },
    },
});
