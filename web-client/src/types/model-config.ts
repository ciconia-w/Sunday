export interface ProviderOption {
    id: string;
    label: string;
    apiKeyEnv: string;
}

export interface ModelConfigState {
    provider: string;
    model: string;
    availableModels: string[];
    providerOptions: ProviderOption[];
    providerApiKeyEnv: string;
    providerApiKey: string;
    hasConfiguredKey: boolean;
    mode: string;
    modeReason: string;
}
