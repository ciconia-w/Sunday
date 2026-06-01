import {
    KNOWN_PROVIDER_API_KEY_ENV_MAP,
    KNOWN_PROVIDER_OPTIONS,
    createRuntimeConfig,
    loadLocalEnvFile,
    saveLocalEnvFile,
} from "./runtime-config.mjs";

function parseModelList(value, fallback) {
    const normalized = `${value ?? ""}`
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    if (normalized.length > 0) {
        return normalized;
    }

    return fallback;
}

function cloneProviderOptions() {
    return KNOWN_PROVIDER_OPTIONS.map((option) => ({ ...option }));
}

export class ModelConfigRegistry {
    constructor(options = {}) {
        this.options = options;
    }

    getConfig() {
        const runtimeConfig = createRuntimeConfig(this.options.agentDir);
        const providerApiKeyEnv = KNOWN_PROVIDER_API_KEY_ENV_MAP[runtimeConfig.provider] ?? "";
        const providerApiKey = providerApiKeyEnv ? runtimeConfig.localEnv[providerApiKeyEnv] ?? "" : "";

        return {
            provider: runtimeConfig.provider,
            model: runtimeConfig.modelId,
            availableModels: [...runtimeConfig.availableModelIds],
            providerOptions: cloneProviderOptions(),
            providerApiKeyEnv,
            providerApiKey,
            hasConfiguredKey: runtimeConfig.hasConfiguredKey,
            mode: runtimeConfig.mode,
            modeReason: runtimeConfig.modeReason,
        };
    }

    saveConfig(payload = {}) {
        const current = this.getConfig();
        const provider = `${payload.provider ?? current.provider}`.trim() || current.provider;
        const model = `${payload.model ?? current.model}`.trim() || current.model;
        const availableModels = parseModelList(payload.availableModels, [model]);
        const providerApiKeyEnv = KNOWN_PROVIDER_API_KEY_ENV_MAP[provider];

        if (!providerApiKeyEnv) {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        const localEnv = loadLocalEnvFile();
        const nextEnv = {
            ...localEnv,
            PERSONAL_AGENT_PROVIDER: provider,
            PERSONAL_AGENT_MODEL: model,
            PERSONAL_AGENT_AVAILABLE_MODELS: availableModels.join(","),
        };

        const rawApiKey =
            typeof payload.providerApiKey === "string" ? payload.providerApiKey.trim() : current.providerApiKey;
        if (rawApiKey) {
            nextEnv[providerApiKeyEnv] = rawApiKey;
        } else if (!nextEnv[providerApiKeyEnv]) {
            nextEnv[providerApiKeyEnv] = "";
        }

        saveLocalEnvFile(nextEnv);
        return this.getConfig();
    }
}
