import { defineComponent, ref, inject, computed, type PropType, type VNodeRef } from "vue";
import IconTextButton from "@/components/IconTextButton";
import IconButton from "@/components/IconButton";
import Tooltip from "@/components/Tooltip";
import ComboBox from "@/components/combobox/ComboBox";
import { ButtonShape } from "@/types/button";
import { useToggleStateStore } from "@/stores";
import { useBackendStore } from "@/stores";
import Menu from "@/components/menu/Menu";
import type { MenuItem } from "@/types/menu";
import { ASSISTANT_VIEW_CONFIG_KEY } from "@/types/assistant-view";
import type { Model } from "@/types/model";
import { MODEL_NETWORK_ICON_MAP, ModelAbility } from "@/types/model";
import { useModelInfosStore } from "@/stores";
import { useAssistantInfosStore } from "@/stores";
import { useConversationManagerStore } from "@/stores";
import { useNotifyStore } from "@/stores";
import { AssistantID } from "@/types/assistant";
import type { ModelOption } from "@/types/combobox";
import ModelSelectorDropdown from "@/views/window/mainwindow/titlebar/components/ModelSelectorDropdown";

export default defineComponent({
    name: "InputAreaAction",

    props: {
        // 是否显示发送按钮
        showSendButton: {
            type: Boolean,
            default: true,
        },
        // 是否在发送/停止模式下
        isSending: {
            type: Boolean,
            default: false,
        },
        // 输入框的值（用于判断是否禁用发送按钮）
        modelValue: {
            type: String,
            default: "",
        },
        // 是否允许发送（支持“仅附件”场景）
        canSend: {
            type: Boolean,
            default: false,
        },
        // 是否禁用
        disabled: {
            type: Boolean,
            default: false,
        },
        actionMenuItems: {
            type: Array as PropType<MenuItem[]>,
            default: () => [],
        },
        // 是否正在录音
        recording: {
            type: Boolean,
            default: false,
        },
        // 音频音量级别（0表示静音）
        audioLevel: {
            type: Number,
            default: 0,
        },
        // 网络是否在线
        isNetworkOnline: {
            type: Boolean,
            default: true,
        },
        // 是否存在音频输入设备
        isAudioInputDeviceExists: {
            type: Boolean,
            default: true,
        },
        // 音频网络错误
        audioNetworkError: {
            type: Boolean,
            default: false,
        },
    },

    emits: {
        // 发送按钮点击事件
        send: null,
        // 添加按钮点击事件
        add: null,
        // 语音按钮点击事件
        voice: null,
        // 参考大纲菜单项点击事件
        referenceOutline: null,
        // 本地文件菜单项点击事件
        localFile: null,
        // 截图问答菜单项点击事件
        screenshot: null,
        // 通用菜单动作点击事件
        selectAction: (actionId: string) => {
            return typeof actionId === "string";
        },
    },

    setup(props, { emit }) {
        // 使用开关状态 store
        const toggleStateStore = useToggleStateStore();
        // 使用后端 store 进行翻译
        const backendStore = useBackendStore();
        const modelInfosStore = useModelInfosStore();
        const assistantInfosStore = useAssistantInfosStore();
        const conversationManagerStore = useConversationManagerStore();
        const notifyStore = useNotifyStore();

        const deepThinkText = computed(() => backendStore.translate("DeepThink"));
        const webSearchText = computed(() => backendStore.translate("Search"));
        // tooltip
        const sendTooltip = computed(() => backendStore.translate("Send"));
        const stopTooltip = computed(() => backendStore.translate("Stop"));
        const addTooltip = computed(() => backendStore.translate("Upload files/images as references"));
        const voiceTooltip = computed(() => {
            if (!props.isAudioInputDeviceExists) {
                return backendStore.translate("Please connect the microphone and try again");
            }

            if (!props.isNetworkOnline || props.audioNetworkError) {
                return backendStore.translate("Voice input is temporarily unavailable, please check the network!");
            }

            return backendStore.translate("Voice input");
        });
        const webSearchTooltip = computed(() =>
            backendStore.translate(
                "启用联网搜索，获取更实时、全面、准确的参考资料。",
            ),
        );

        const assistantViewConfig = inject(ASSISTANT_VIEW_CONFIG_KEY);
        const currentModel = computed(() => modelInfosStore.getCurrentModel);
        const modelOptions = computed<ModelOption[]>(() => {
            return modelInfosStore.getModelList.map((model: Model) => ({
                value: model.id,
                label: model.name,
                icon: MODEL_NETWORK_ICON_MAP[model.network],
                group: model.network,
                provider: model.provider,
            }));
        });
        const selectedModelId = computed(() => modelInfosStore.getCurrentModel?.id || "");
        const modelSelectDefault = computed(() => backendStore.translate("选择模型"));
        const newChatModelFeedbackText = computed(() =>
            backendStore.translate("Model changed. New chats will use this selection."),
        );
        const currentConversationModelFeedbackText = computed(() =>
            backendStore.translate("Updated for the next reply in this conversation"),
        );

        // 深度思考默认开
        const showDeepThink = computed(() => {
            const configEnabled = assistantViewConfig?.value.input?.showDeepThink ?? true;
            if (!configEnabled) return false;

            const ability = currentModel.value?.ability;
            if (ability === undefined || ability === null) return false;

            return (ability & ModelAbility.MaReasoning) !== 0;
        });

        // 联网搜索默认关
        const showSearch = computed(() => {
            const configEnabled = assistantViewConfig?.value.input?.showSearch ?? false;
            return configEnabled;
        });

        // 菜单状态
        const menuVisible = ref(false);

        // 使用 shallowRef 避免在 render 中自动解包
        const addButtonRef = ref<HTMLElement | null>(null);

        // 处理菜单项选择事件
        const handleSelectItem = (item: MenuItem) => {
            if (!item.id || item.type !== "item") {
                return;
            }

            emit("selectAction", item.id);
            menuVisible.value = false;
        };

        // 处理发送按钮点击事件
        const handleSendClick = () => {
            emit("send");
        };

        // 处理深度思考按钮点击事件
        const handleDeepThinkClick = () => {
            toggleStateStore.toggleDeepThink();
        };

        // 处理联网搜索按钮点击事件
        const handleWebSearchClick = () => {
            toggleStateStore.toggleWebSearch();
        };

        // 处理添加按钮点击事件
        const handleAddClick = async (event: MouseEvent) => {
            event.stopPropagation();
            menuVisible.value = !menuVisible.value;
        };

        // 处理语音按钮点击事件
        const handleVoiceClick = () => {
            emit("voice");
        };

        // 当前 MVP 主路径优先聚焦文字对话、工具与文件，不默认暴露语音入口。
        const showVoiceButton = computed(() => false);

        const handleModelSelect = async (value: string | number) => {
            const selectedModel = modelInfosStore.getModelList.find((model: Model) => model.id === value);
            if (!selectedModel) {
                return;
            }

            const currentAssistant = assistantInfosStore.getCurrentAssistant;
            const assistantId = currentAssistant?.id || AssistantID.UOS_AI;
            const switched = await modelInfosStore.setCurrentModelId(selectedModel.id, assistantId);

            if (!switched) {
                return;
            }

            const currentConversationRecord = conversationManagerStore.getCurrentConversationRecord;
            if (currentConversationRecord?.root) {
                currentConversationRecord.root = {
                    ...currentConversationRecord.root,
                    model: selectedModel.id,
                };
            }

            notifyStore.showToast({
                type: "success",
                message: currentConversationRecord?.root
                    ? currentConversationModelFeedbackText.value
                    : newChatModelFeedbackText.value,
                duration: 1800,
            });
        };

        const handleModelDropdownChange = async (isOpen: boolean) => {
            if (!isOpen) {
                return;
            }

            const currentAssistant = assistantInfosStore.getCurrentAssistant;
            const assistantId = currentAssistant?.id || AssistantID.UOS_AI;
            await modelInfosStore.fetchModelList(assistantId);
        };

        const setAddBtnTriggerRef: VNodeRef = (el) => {
            addButtonRef.value = el as HTMLElement | null;
        };

        return {
            handleSendClick,
            handleDeepThinkClick,
            handleWebSearchClick,
            handleAddClick,
            handleVoiceClick,
            toggleStateStore,
            backendStore,
            showDeepThink,
            showSearch,
            menuVisible,
            addButtonRef,
            handleSelectItem,
            setAddBtnTriggerRef,
            deepThinkText,
            webSearchText,
            showVoiceButton,
            sendTooltip,
            stopTooltip,
            addTooltip,
            voiceTooltip,
            webSearchTooltip,
            modelOptions,
            selectedModelId,
            modelSelectDefault,
            handleModelSelect,
            handleModelDropdownChange,
        };
    },

    render() {
        return (
            <div class="input-area__actions">
                <div class="input-area__actions-group-left">
                    {/* 深度思考按钮 */}
                    {this.showDeepThink && (
                        <IconTextButton
                            icon="deep-think"
                            iconSize={[16, 16]}
                            text={this.deepThinkText}
                            checked={this.toggleStateStore.isDeepThinkEnabled}
                            onClick={this.handleDeepThinkClick}
                            disabled={this.$props.disabled}
                        />
                    )}
                    {/* 联网搜索按钮 */}
                    {this.showSearch && (
                        <IconTextButton
                            icon="search-online"
                            iconSize={[16, 16]}
                            text={this.webSearchText}
                            checked={this.toggleStateStore.isWebSearchEnabled}
                            onClick={this.handleWebSearchClick}
                            disabled={this.$props.disabled}
                            tooltip={this.webSearchTooltip}
                        />
                    )}
                    {this.$slots.default?.()}
                </div>
                <div class="input-area__actions-group-right">
                    <ComboBox
                        customClass="input-area__model-selector"
                        options={this.modelOptions}
                        value={this.selectedModelId}
                        onUpdateValue={this.handleModelSelect}
                        onChangeDropdown={this.handleModelDropdownChange}
                        defaultValue={this.modelSelectDefault}
                        disabled={this.$props.disabled}
                    >
                        {{
                            dropdown: (slotProps: any) => (
                                <ModelSelectorDropdown
                                    {...slotProps}
                                    onSelect={slotProps.onSelect}
                                    onClose={slotProps.onClose}
                                />
                            ),
                        }}
                    </ComboBox>
                    {/* 添加按钮 */}
                    <div ref={this.setAddBtnTriggerRef}>
                        <IconButton
                            icon="add"
                            tooltip={this.addTooltip}
                            iconSize={[16, 16]}
                            size={[30, 30]}
                            shape={ButtonShape.Circle}
                            onClick={this.handleAddClick}
                            disabled={this.$props.disabled}
                        />
                    </div>
                    {/* 语音按钮 */}
                    {this.showVoiceButton && (
                        <div class={["input-area__voice-button-container"]}>
                            <IconButton
                                icon={this.$props.recording ? "voice-active" : "voice"}
                                tooltip={this.voiceTooltip}
                                iconSize={[16, 16]}
                                size={this.$props.recording ? [26, 26] : [30, 30]}
                                shape={ButtonShape.Circle}
                                class={[
                                    "input-area__voice-button",
                                    { recording: this.$props.recording },
                                    // { notalking: this.$props.recording && this.$props.audioLevel === 0 },
                                ]}
                                onClick={this.handleVoiceClick}
                                disabled={
                                    this.$props.disabled ||
                                    !this.$props.isNetworkOnline ||
                                    !this.$props.isAudioInputDeviceExists ||
                                    this.$props.audioNetworkError
                                }
                            />
                        </div>
                    )}

                    {/* 停止按钮 */}
                    {this.$props.isSending && this.$props.showSendButton && (
                        <Tooltip content={this.stopTooltip} showAfter={1000}>
                            <div class="input-area__stop-button" onClick={this.handleSendClick}>
                                <div class="custom-stop-button"></div>
                            </div>
                        </Tooltip>
                    )}
                    {/* 发送按钮 */}
                    {!this.$props.isSending && this.$props.showSendButton && (
                        <IconButton
                            class="input-area__send-button"
                            icon="send"
                            iconSize={[16, 16]}
                            size={[30, 30]}
                            shape={ButtonShape.Circle}
                            onClick={this.handleSendClick}
                            tooltip={this.sendTooltip}
                            disabled={this.$props.disabled || !this.$props.canSend}
                        />
                    )}
                </div>

                {/* 添加按钮菜单 */}
                <Menu
                    items={this.$props.actionMenuItems}
                    visible={this.menuVisible}
                    triggerRef={this.addButtonRef}
                    placement="top"
                    onUpdateVisible={(v) => (this.menuVisible = v)}
                    onSelectItem={this.handleSelectItem}
                />
            </div>
        );
    },
});
