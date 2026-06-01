import { computed, defineComponent, onMounted, ref, watch } from "vue";
import ScrollBar from "@/components/ScrollBar";
import TextButton from "@/components/TextButton";
import CommonButton from "@/components/CommonButton";
import { useBackendStore, useMainWindowStore, useModelConfigStore, useModelInfosStore, useNotifyStore } from "@/stores";
import "@/assets/styles/window/mainwindow/page/settings/model/ModelSettingsPage.css";

const splitModelList = (value: string) =>
    value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

export default defineComponent({
    name: "ModelSettingsPage",

    components: {
        ScrollBar,
    },

    setup() {
        const backendStore = useBackendStore();
        const mainWindowStore = useMainWindowStore();
        const modelConfigStore = useModelConfigStore();
        const modelInfosStore = useModelInfosStore();
        const notifyStore = useNotifyStore();

        const provider = ref("");
        const model = ref("");
        const availableModelsText = ref("");
        const providerApiKey = ref("");

        const syncLocalDraft = () => {
            provider.value = modelConfigStore.config.provider;
            model.value = modelConfigStore.config.model;
            availableModelsText.value = modelConfigStore.config.availableModels.join(", ");
            providerApiKey.value = modelConfigStore.config.providerApiKey;
        };

        watch(
            () => modelConfigStore.config,
            () => {
                syncLocalDraft();
            },
            { deep: true },
        );

        const currentProviderOption = computed(
            () => modelConfigStore.providerOptions.find((item) => item.id === provider.value) ?? null,
        );

        const modeBadgeText = computed(() => {
            return modelConfigStore.config.mode === "live"
                ? backendStore.translate("Live Mode")
                : backendStore.translate("Demo Mode");
        });

        const modeBadgeClass = computed(() => {
            return modelConfigStore.config.mode === "live"
                ? "model-settings-page__badge--live"
                : "model-settings-page__badge--demo";
        });

        const isDirty = computed(() => {
            return (
                provider.value !== modelConfigStore.config.provider ||
                model.value !== modelConfigStore.config.model ||
                availableModelsText.value.trim() !== modelConfigStore.config.availableModels.join(", ") ||
                providerApiKey.value !== modelConfigStore.config.providerApiKey
            );
        });

        const canSave = computed(() => {
            return (
                !modelConfigStore.isSaving &&
                provider.value.trim().length > 0 &&
                model.value.trim().length > 0 &&
                splitModelList(availableModelsText.value).length > 0
            );
        });

        const loadPageData = async () => {
            await modelConfigStore.loadConfig().catch((error) => {
                console.error("[ModelSettingsPage] Failed to load model config", error);
            });
            syncLocalDraft();
        };

        const handleReset = () => {
            syncLocalDraft();
        };

        const handleSave = async () => {
            if (!canSave.value) {
                return;
            }

            const availableModels = splitModelList(availableModelsText.value);
            if (!availableModels.includes(model.value.trim())) {
                availableModels.unshift(model.value.trim());
            }

            try {
                const saved = await modelConfigStore.saveConfig({
                    provider: provider.value.trim(),
                    model: model.value.trim(),
                    availableModels,
                    providerApiKey: providerApiKey.value.trim(),
                });

                await modelInfosStore.loadModelList("uos-ai-generic");
                notifyStore.showToast({
                    type: "success",
                    message: backendStore.translate("Model configuration updated."),
                    duration: 1500,
                });

                if (mainWindowStore.workspacePage !== "chat") {
                    await mainWindowStore.openChatPage();
                }

                if (saved.mode === "demo") {
                    notifyStore.showToast({
                        type: "warning",
                        message: saved.modeReason || backendStore.translate("Provider key is missing."),
                        duration: 2500,
                    });
                }
            } catch (error) {
                console.error("[ModelSettingsPage] Failed to save model config", error);
                notifyStore.showToast({
                    type: "error",
                    message:
                        error instanceof Error
                            ? error.message
                            : backendStore.translate("Failed to save model configuration."),
                    duration: 3000,
                });
            }
        };

        onMounted(() => {
            void loadPageData();
        });

        const goBack = () => mainWindowStore.goBackWorkspacePage();
        const titleText = computed(() => backendStore.translate("Model Settings"));
        const subtitleText = computed(() =>
            backendStore.translate("配置 Sunday 新对话默认使用的 Provider、模型和 API Key。"),
        );
        const providerLabelText = computed(() => backendStore.translate("Provider"));
        const modelLabelText = computed(() => backendStore.translate("Default Model"));
        const availableModelsLabelText = computed(() => backendStore.translate("Available Models"));
        const availableModelsHintText = computed(() =>
            backendStore.translate("Comma-separated model IDs shown in the title-bar model switcher."),
        );
        const apiKeyLabelText = computed(() => backendStore.translate("API Key"));
        const apiKeyHintText = computed(() =>
            currentProviderOption.value?.apiKeyEnv
                ? backendStore.translate("Saved locally to .env.local as") +
                  ` ${currentProviderOption.value.apiKeyEnv}`
                : backendStore.translate("Saved locally to .env.local"),
        );
        const modeReasonText = computed(() => modelConfigStore.config.modeReason);
        const resetButtonText = computed(() => backendStore.translate("Reset"));
        const saveButtonText = computed(() =>
            modelConfigStore.isSaving ? backendStore.translate("Saving...") : backendStore.translate("Save"),
        );

        return {
            goBack,
            provider,
            model,
            availableModelsText,
            providerApiKey,
            modelConfigStore,
            titleText,
            subtitleText,
            providerLabelText,
            modelLabelText,
            availableModelsLabelText,
            availableModelsHintText,
            apiKeyLabelText,
            apiKeyHintText,
            modeBadgeText,
            modeBadgeClass,
            modeReasonText,
            resetButtonText,
            saveButtonText,
            canSave,
            isDirty,
            handleReset,
            handleSave,
        };
    },

    render() {
        return (
            <div class="model-settings-page">
                <div class="model-settings-page__header-container">
                    <div class="model-settings-page__container">
                        <div class="model-settings-page__header">
                            <div class="model-settings-page__header-copy">
                                <button type="button" class="page-back-btn" onClick={this.goBack}>&larr; 返回</button>
                                <div class="model-settings-page__title-row">
                                    <div class="model-settings-page__title">{this.titleText}</div>
                                    <span class={["model-settings-page__badge", this.modeBadgeClass]}>
                                        {this.modeBadgeText}
                                    </span>
                                </div>
                                <div class="model-settings-page__subtitle">{this.subtitleText}</div>
                                {this.modeReasonText && (
                                    <div class="model-settings-page__mode-reason">{this.modeReasonText}</div>
                                )}
                            </div>
                            <div class="model-settings-page__actions">
                                <TextButton
                                    text={this.resetButtonText}
                                    disabled={!this.isDirty || this.modelConfigStore.isSaving}
                                    onClick={this.handleReset}
                                />
                                <CommonButton
                                    text={this.saveButtonText}
                                    variant="primary"
                                    disabled={!this.canSave || !this.isDirty}
                                    onClick={this.handleSave}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="model-settings-page__content">
                    <ScrollBar class="model-settings-page__scroll" edgeBounce momentum>
                        <div class="model-settings-page__content-container">
                            <div class="model-settings-page__container">
                                <section class="model-settings-page__panel">
                                    <label class="model-settings-page__field">
                                        <span class="model-settings-page__field-label">{this.providerLabelText}</span>
                                        <select
                                            class="model-settings-page__select"
                                            value={this.provider}
                                            onChange={(event) =>
                                                (this.provider = (event.target as HTMLSelectElement).value)
                                            }
                                        >
                                            {this.modelConfigStore.providerOptions.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label class="model-settings-page__field">
                                        <span class="model-settings-page__field-label">{this.modelLabelText}</span>
                                        <input
                                            class="model-settings-page__input"
                                            type="text"
                                            value={this.model}
                                            onInput={(event) => (this.model = (event.target as HTMLInputElement).value)}
                                        />
                                    </label>

                                    <label class="model-settings-page__field">
                                        <span class="model-settings-page__field-label">{this.availableModelsLabelText}</span>
                                        <input
                                            class="model-settings-page__input"
                                            type="text"
                                            value={this.availableModelsText}
                                            onInput={(event) =>
                                                (this.availableModelsText = (event.target as HTMLInputElement).value)
                                            }
                                        />
                                        <span class="model-settings-page__field-hint">
                                            {this.availableModelsHintText}
                                        </span>
                                    </label>

                                    <label class="model-settings-page__field">
                                        <span class="model-settings-page__field-label">{this.apiKeyLabelText}</span>
                                        <input
                                            class="model-settings-page__input"
                                            type="password"
                                            value={this.providerApiKey}
                                            onInput={(event) =>
                                                (this.providerApiKey = (event.target as HTMLInputElement).value)
                                            }
                                        />
                                        <span class="model-settings-page__field-hint">{this.apiKeyHintText}</span>
                                    </label>
                                </section>
                            </div>
                        </div>
                    </ScrollBar>
                </div>
            </div>
        );
    },
});
