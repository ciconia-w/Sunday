import { defineStore } from "pinia";
import { useBackendStore } from "./backend";
import type { ModelConfigState } from "@/types/model-config";

const DEFAULT_STATE: ModelConfigState = {
    provider: "",
    model: "",
    availableModels: [],
    providerOptions: [],
    providerApiKeyEnv: "",
    providerApiKey: "",
    hasConfiguredKey: false,
    mode: "demo",
    modeReason: "",
};

function normalizeConfig(raw: unknown): ModelConfigState {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

    return {
        provider: typeof source.provider === "string" ? source.provider : "",
        model: typeof source.model === "string" ? source.model : "",
        availableModels: Array.isArray(source.availableModels)
            ? source.availableModels.filter((item): item is string => typeof item === "string" && item.length > 0)
            : [],
        providerOptions: Array.isArray(source.providerOptions)
            ? source.providerOptions
                  .map((item) => {
                      const option = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                      return {
                          id: typeof option.id === "string" ? option.id : "",
                          label: typeof option.label === "string" ? option.label : "",
                          apiKeyEnv: typeof option.apiKeyEnv === "string" ? option.apiKeyEnv : "",
                      };
                  })
                  .filter((item) => item.id.length > 0)
            : [],
        providerApiKeyEnv: typeof source.providerApiKeyEnv === "string" ? source.providerApiKeyEnv : "",
        providerApiKey: typeof source.providerApiKey === "string" ? source.providerApiKey : "",
        hasConfiguredKey: source.hasConfiguredKey === true,
        mode: typeof source.mode === "string" ? source.mode : "demo",
        modeReason: typeof source.modeReason === "string" ? source.modeReason : "",
    };
}

export const useModelConfigStore = defineStore("modelConfig", {
    state: () => ({
        config: { ...DEFAULT_STATE } as ModelConfigState,
        isLoading: false,
        isLoaded: false,
        isSaving: false,
    }),

    getters: {
        providerOptions: (state) => state.config.providerOptions,
    },

    actions: {
        async loadConfig(force = false) {
            if (this.isLoaded && !force) {
                return this.config;
            }

            this.isLoading = true;
            try {
                const backend = useBackendStore();
                const result = await backend.requestServiceConfig("getModelConfig");
                this.config = normalizeConfig(result);
                this.isLoaded = true;
                return this.config;
            } finally {
                this.isLoading = false;
            }
        },

        async saveConfig(payload: {
            provider: string;
            model: string;
            availableModels: string[];
            providerApiKey: string;
        }) {
            this.isSaving = true;
            try {
                const backend = useBackendStore();
                const result = await backend.requestServiceConfig(
                    "saveModelConfig",
                    payload.provider,
                    payload.model,
                    payload.availableModels.join(","),
                    payload.providerApiKey,
                );
                this.config = normalizeConfig(result);
                this.isLoaded = true;
                return this.config;
            } finally {
                this.isSaving = false;
            }
        },
    },
});
