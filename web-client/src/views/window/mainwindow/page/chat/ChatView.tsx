import { defineComponent, ref, computed, watch, provide, nextTick, onMounted, onUnmounted } from "vue";
import {
    useBackendStore,
    useModelInfosStore,
    useAssistantInfosStore,
    useToggleStateStore,
    useMcpServicesStore,
    useUploadFilesStore,
    useConversationManagerStore,
    useWindowChannelStore,
    useReportChannelStore,
    useRuntimeStatusStore,
} from "@/stores";
import FilePrivacyDialog from "@/components/FilePrivacyDialog";
import ScrollBar from "@/components/ScrollBar";
import SvgIcon from "@/components/SvgIcon";
import MessageNavigator from "@/views/window/mainwindow/page/chat/components/MessageNavigator";
import InputArea from "@/views/window/mainwindow/page/chat/components/InputArea";
import QuickInputButton from "@/views/window/mainwindow/page/chat/components/inputAreaAction/QuickInputButton";
import type { Message as ConversationMessage, Conversation, AgentStepData } from "@/types/conversation";
import { UserType, ConversationScene } from "@/types/conversation";
import { ContentType } from "@/types/message";
import { createConversation } from "@/utils/mainwindow/conversationActions";
import WelcomeView from "@/views/window/mainwindow/page/chat/components/WelcomeView";
import {
    CHAT_INPUT_KEY,
    QUICK_INPUT_KEY,
    type ChatInputActionContext,
    type ChatInputContext,
} from "@/types/chat-input";
import { ASSISTANT_VIEW_CONFIG_KEY } from "@/types/assistant-view";
import { getAssistantViewConfig } from "@/views/window/mainwindow/page/chat/config/assistantViewConfigs";
import { ModelAbility } from "@/types/model";
import type { ChatMessage, Params } from "@/types/message";
import type { UploadFile } from "@/types/uploadfile";
import { getRenderedText } from "@/views/window/mainwindow/page/chat/components/templateEditor/templateParser";
import {
    executeInputAreaAction,
    getInputAreaActionMenuItems,
} from "@/views/window/mainwindow/page/chat/config/inputAreaActions";
import { getInputAreaSceneConfig } from "@/views/window/mainwindow/page/chat/config/inputAreaScenes";
import type { Assistant } from "@/types/assistant";
import { AssistantID } from "@/types/assistant";
import { FileCategory } from "@/types/uploadfile";
import { createId } from "@/utils/date";
import { useTitleBarState } from "@/composables/useTitleBarState";
import {
    ReportEventType,
    type ModelPointParams,
    type AssistantChatPointParams,
    type ReportEventPayload,
} from "@/types/report";

export default defineComponent({
    name: "ChatView",
    props: {
        message: {
            type: String,
            default: "Hello World!",
        },
        isActivate: Boolean,
    },
    emits: {
        // 运行时验证
        click: null, // 无参数
        update: (value: string) => {
            return typeof value === "string";
        },
    },
    setup(props, { emit }) {
        const shouldLogSmokeDetails = () => {
            const params = new URL(window.location.href).searchParams;
            return (
                params.has("autoSend") ||
                params.has("autoInjectFile") ||
                params.has("autoRetryFailedFile") ||
                params.has("autoClearAllFiles") ||
                params.has("autoOpenRecentConversation") ||
                params.has("autoOpenToolFile") ||
                params.has("autoCopyToolPath") ||
                params.has("autoCopyToolCommand") ||
                params.has("autoFollowUp") ||
                params.has("autoOpenBranch") ||
                params.has("autoOpenFullOutput")
            );
        };

        const logSmoke = (...args: unknown[]) => {
            if (!shouldLogSmokeDetails()) {
                return;
            }
            console.log(...args);
        };

        const backend = useBackendStore();
        const modelInfosStore = useModelInfosStore();
        const assistantInfosStore = useAssistantInfosStore();
        const toggleStateStore = useToggleStateStore();
        const mcpServicesStore = useMcpServicesStore();
        const uploadFilesStore = useUploadFilesStore();
        const conversationManagerStore = useConversationManagerStore();
        const windowChannelStore = useWindowChannelStore();
        const reportChannelStore = useReportChannelStore();
        const runtimeStatusStore = useRuntimeStatusStore();

        // ScrollBar 组件引用
        const scrollBarRef = ref<InstanceType<typeof ScrollBar> | null>(null);
        // 消息区域容器引用
        const messagesContainerRef = ref<HTMLElement | null>(null);
        // MessageNavigator 组件引用
        const messageNavigatorRef = ref<InstanceType<typeof MessageNavigator> | null>(null);
        // ResizeObserver 实例（消息容器）
        let resizeObserver: ResizeObserver | null = null;
        // ResizeObserver 实例（MessageNavigator）
        let navigatorResizeObserver: ResizeObserver | null = null;
        // 自动滚动定时器
        let autoScrollTimer: number | null = null;
        // 记录 resize 前的滚动状态
        let wasAtBottomBeforeResize = false;
        let wasScrollableBeforeResize = false;
        // 回到底部按钮显示状态
        const showScrollToBottomButton = ref(false);
        // 底部渐隐效果显示状态
        const showBottomFade = ref(false);

        const inputValue = ref("");
        const pendingPromptSource = ref<"file-guidance" | null>(null);
        const currentAssistant = ref<Assistant | null>(null);
        const currentMessageId = ref("");
        const currentModel = computed(() => modelInfosStore.getCurrentModel);
        const currentConversationRecord = computed(() => conversationManagerStore.getCurrentConversationRecord);
        const sessionRuntimeMode = ref("unknown");

        // 操作被取消的状态，用于控制 OperationCanceledHint 的显示
        const isOperationCanceled = ref(false);
        const conversation = computed(() => conversationManagerStore.getCurrentMessagesRender); // 获取当前会话
        const lastConversationId = ref(""); // 上一个会话 ID
        const isFromHistory = computed(() => conversationManagerStore.getIsFromHistory); // 获取当前会话是否是从历史记录中恢复的

        // 判断是否已有用户消息
        const hasUserMessages = computed(() => {
            const conv = conversation.value;
            if (!conv) return false;
            // 从root.cur_next开始遍历，检查是否有用户消息
            let currentId = conv.root.cur_next;
            while (currentId && conv.messages[currentId]) {
                const message = conv.messages[currentId];
                if (message && message.role === UserType.USER) {
                    return true;
                }
                if (message) {
                    currentId = message.cur_next;
                } else {
                    break;
                }
            }
            return false;
        });

        // 判断当前是否有正在进行的会话
        const isSessionRunning = computed(() => conversationManagerStore.isCurrentSessionRunning);

        // 判断会话是否已开始（收到 SeStarted 事件）
        const isSessionStarted = computed(() => conversationManagerStore.isSessionStarted);

        // 判断是否应该显示停止按钮（会话正在运行且已开始）
        const shouldShowStopButton = computed(() => isSessionRunning.value && isSessionStarted.value);

        // 判断是否应该禁用输入框（会话正在运行但未开始）
        const shouldDisableInput = computed(() => {
            return (isSessionRunning.value && !isSessionStarted.value) || shouldDisableInputByAssistant.value;
        });
        // 助手不存在
        const shouldDisableInputByAssistant = ref(false);

        // 判断是否正在流式输出最后一条消息
        const isStreamingLastMessage = computed(() => {
            if (!isSessionRunning.value) {
                return false;
            }
            const conv = conversation.value;
            if (!conv) return false;

            // 获取最后一条消息
            let lastMessage: ConversationMessage | null = null;
            let currentId = conv.root.cur_next;
            while (currentId && conv.messages[currentId]) {
                const message = conv.messages[currentId];
                if (message) {
                    lastMessage = message;
                    currentId = message.cur_next;
                } else {
                    break;
                }
            }

            // Check if the last message is from AI assistant
            return lastMessage && lastMessage.role === UserType.ASSISTANT;
        });

        const enabledMcpServiceIds = computed(() => {
            return mcpServicesStore.services.filter((service) => service.enabled).map((service) => service.id);
        });

        const currentSelectedMcpServiceIds = computed(() => {
            return conversationManagerStore.getSelectedMcpServers(
                conversationManagerStore.getCurrentConversationId,
                enabledMcpServiceIds.value,
            );
        });

        const inputAreaSceneConfig = computed(() => {
            return getInputAreaSceneConfig(currentAssistant.value?.id);
        });
        const assistantViewConfig = computed(() => getAssistantViewConfig(currentAssistant.value?.id));

        // 与 inputAreaAction 保持一致：只有助手配置允许且模型支持 Reasoning 时才启用深度思考
        const canUseDeepThink = computed(() => {
            const configEnabled = assistantViewConfig.value.input?.showDeepThink ?? true;
            if (!configEnabled) return false;
            const ability = currentModel.value?.ability;
            if (ability === undefined || ability === null) return false;
            return (ability & ModelAbility.MaReasoning) !== 0;
        });

        // 与 inputAreaAction 保持一致：只有助手配置允许时才启用联网搜索
        const canUseWebSearch = computed(() => {
            const configEnabled = assistantViewConfig.value.input?.showSearch ?? false;
            return configEnabled;
        });

        const inputAreaActionMenuItems = computed(() => {
            return getInputAreaActionMenuItems(inputAreaSceneConfig.value.actions, {
                isInputDisabled: shouldDisableInput.value,
                isScreenshotVisible: uploadFilesStore.getIsScreenshotVisible,
            });
        });

        const hasUploadedFiles = computed(() => uploadFilesStore.getFileCount > 0);

        const latestUserMessage = computed<ConversationMessage | null>(() => {
            const conv = conversation.value;
            if (!conv) {
                return null;
            }

            let currentId = conv.root.cur_next;
            let latest: ConversationMessage | null = null;
            while (currentId && conv.messages[currentId]) {
                const message = conv.messages[currentId];
                if (message?.role === UserType.USER) {
                    latest = message;
                }
                currentId = message?.cur_next || "";
            }

            return latest;
        });

        const latestRequestUploadedFiles = computed<UploadFile[]>(() => getCachedUploadedFiles(latestUserMessage.value));

        const latestRequestPromptSource = computed(() => {
            const source = latestUserMessage.value?.extension?.promptSource;
            return typeof source === "string" ? source : "";
        });

        const latestRequestFileSummary = computed(() => {
            const files = latestRequestUploadedFiles.value;
            const total = files.length;
            const failed = files.filter((file) => file.parseStatus === "error").length;
            return {
                total,
                failed,
            };
        });

        const conversationToolCount = computed(() => {
            const conv = conversation.value;
            if (!conv) {
                return 0;
            }

            let total = 0;
            for (const message of Object.values(conv.messages)) {
                for (const item of message.render_message || []) {
                    if (item.type === ContentType.CntTool) {
                        total += 1;
                        continue;
                    }

                    if (item.type === ContentType.CntAgentStep) {
                        const entries = (item.data as AgentStepData)?.entries || [];
                        total += entries.filter((entry) => entry.kind === "tool").length;
                    }
                }
            }

            return total;
        });

        const highlightedOverviewTarget = ref<HTMLElement | null>(null);
        const highlightedActionTarget = ref<HTMLElement | null>(null);

        const clearHighlightedOverviewTarget = () => {
            if (!highlightedOverviewTarget.value) {
                return;
            }

            highlightedOverviewTarget.value.classList.remove("chat-view__jump-target--highlighted");
            highlightedOverviewTarget.value = null;
        };

        const clearHighlightedActionTarget = () => {
            if (!highlightedActionTarget.value) {
                return;
            }

            highlightedActionTarget.value.classList.remove("chat-view__action-target--highlighted");
            highlightedActionTarget.value = null;
        };

        const scrollToSelector = (selector: string, scope: ParentNode | null = messagesContainerRef.value) => {
            if (!scope) {
                return false;
            }

            const matches = Array.from(scope.querySelectorAll(selector)) as HTMLElement[];
            const target = matches[matches.length - 1] ?? null;
            if (!target) {
                return false;
            }

            clearHighlightedOverviewTarget();
            highlightedOverviewTarget.value = target;
            target.classList.add("chat-view__jump-target--highlighted");
            window.setTimeout(() => {
                if (highlightedOverviewTarget.value === target) {
                    clearHighlightedOverviewTarget();
                }
            }, 2200);

            target.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });

            return true;
        };

        const highlightActionSelector = (selector: string) => {
            const target = document.querySelector(selector) as HTMLElement | null;
            if (!target) {
                return false;
            }

            clearHighlightedActionTarget();
            highlightedActionTarget.value = target;
            target.classList.add("chat-view__action-target--highlighted");
            window.setTimeout(() => {
                if (highlightedActionTarget.value === target) {
                    clearHighlightedActionTarget();
                }
            }, 2200);

            return true;
        };

        const expandLatestToolUse = () => {
            const container = messagesContainerRef.value;
            if (!container) {
                return false;
            }

            const toolHeaders = Array.from(
                container.querySelectorAll(".tool-use__header--interactive"),
            ) as HTMLElement[];
            const latestToolHeader = toolHeaders[toolHeaders.length - 1] ?? null;
            if (!latestToolHeader) {
                return false;
            }

            latestToolHeader.click();
            return true;
        };

        const focusLatestToolUse = () => {
            const container = messagesContainerRef.value;
            if (!container) {
                return false;
            }

            const toolCards = Array.from(container.querySelectorAll(".tool-use")) as HTMLElement[];
            const latestToolCard = toolCards[toolCards.length - 1] ?? null;
            if (!latestToolCard) {
                return false;
            }

            clearHighlightedOverviewTarget();
            highlightedOverviewTarget.value = latestToolCard;
            latestToolCard.classList.add("chat-view__jump-target--highlighted");
            window.setTimeout(() => {
                if (highlightedOverviewTarget.value === latestToolCard) {
                    clearHighlightedOverviewTarget();
                }
            }, 2200);

            latestToolCard.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });

            return true;
        };

        const inputPlaceholder = computed(() => {
            if (hasUploadedFiles.value && !inputValue.value.trim()) {
                return backend.translate("Summarize the key content of the file.");
            }

            // 写作助手发送消息后显示特定 placeholder
            if (currentAssistant.value?.id === AssistantID.UOS_AI_WRITING && hasUserMessages.value) {
                return backend.translate(
                    "可输入更多需求来优化或调整生成内容。",
                );
            }

            return currentAssistant.value?.place_holder;
        });

        const canSendMessage = computed(() => {
            return !!inputValue.value.trim() || hasUploadedFiles.value;
        });

        const buildSceneParams = () => {
            return (
                inputAreaSceneConfig.value.resolveParams?.({
                    conversationId: conversationManagerStore.getCurrentConversationId,
                    getSelectedMcpServiceIds: () => currentSelectedMcpServiceIds.value,
                }) || {}
            );
        };

        const getConversationMessageText = (message?: ConversationMessage | null): string => {
            if (!message) {
                return "";
            }

            return message.render_message
                .filter(
                    (item): item is { type: "text"; data: { content: string } } =>
                        item.type === "text" &&
                        typeof item.data === "object" &&
                        item.data !== null &&
                        "content" in item.data &&
                        typeof item.data.content === "string",
                )
                .map((item) => item.data.content)
                .join("\n");
        };

        const getCachedUploadedFiles = (message?: ConversationMessage | null): UploadFile[] => {
            // 统一从 extension.uploadedFiles 读取前端元数据
            const uploadedFiles = message?.extension?.uploadedFiles;
            if (Array.isArray(uploadedFiles)) {
                return uploadedFiles
                    .filter(
                        (file): file is UploadFile =>
                            typeof file === "object" &&
                            file !== null &&
                            typeof (file as UploadFile).filePath === "string" &&
                            typeof (file as UploadFile).fileName === "string",
                    )
                    .map((file) => ({ ...file }));
            }

            return [];
        };

        const buildMessageExtension = (uploadedFiles: UploadFile[]) => {
            const extension: Record<string, unknown> = {};

            // 统一保存上传文件的前端元数据，渲染时只从这份元数据读取
            if (uploadedFiles.length > 0) {
                extension.uploadedFiles = uploadedFiles;
            }

            if (pendingPromptSource.value) {
                extension.promptSource = pendingPromptSource.value;
            }

            return Object.keys(extension).length > 0 ? extension : undefined;
        };

        const buildUploadParams = (uploadedFiles: UploadFile[]): Partial<Params> => {
            if (uploadedFiles.length === 0) {
                return {};
            }

            const outlineFile = uploadedFiles.find((file) => file.category === FileCategory.Outline);
            // 素材文件和无分类文件都放到 upload_files 中
            const uploadFiles = uploadedFiles
                .filter((file) => file.category !== FileCategory.Outline)
                .map((file) => file.filePath);

            const params: Partial<Params> = {};
            if (outlineFile) {
                params.outline_path = outlineFile.filePath;
            }
            if (uploadFiles.length > 0) {
                params.upload_files = uploadFiles;
            }
            return params;
        };

        const buildOutgoingMessageContent = (text: string, uploadedFiles: UploadFile[]) => {
            const content: ChatMessage["message"]["content"] = [
                {
                    type: "text",
                    data: { content: text },
                },
            ];

            if (uploadedFiles.length > 0) {
                content.push({
                    type: "file",
                    data: uploadedFiles.map((file) => file.filePath),
                });
            }

            return content;
        };

        const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

        // 文件隐私保护对话框状态
        const showFilePrivacyDialog = ref(false);
        // 触发原因：true = 仅联网搜索（本地模型+联网），false = 在线模型
        const filePrivacyWebSearch = ref(false);

        /**
         * 判断是否需要弹出文件隐私保护对话框。
         * 触发条件：当前助手启用了文件隐私提醒，且（在线模型 或 开启联网搜索）并选择了文件。
         */
        const shouldShowFilePrivacyDialog = (): boolean => {
            if (!assistantViewConfig.value.chat?.showFilePrivacyDialog) {
                return false;
            }

            const isOnlineModel = currentModel.value !== null && currentModel.value.network === "online";
            const isOnlineOrSearch = isOnlineModel || toggleStateStore.webSearchEnabled;
            const hasFiles = uploadFilesStore.getFileCount > 0;
            if (isOnlineOrSearch && hasFiles) {
                // 记录触发原因：模型本身是本地模型但开了联网搜索，则为 webSearch 触发
                filePrivacyWebSearch.value = !isOnlineModel && toggleStateStore.webSearchEnabled;
                return true;
            }
            return false;
        };

        // 埋点
        const reportEvent = () => {
            // 助手埋点参数
            const assistantChatPointParams: AssistantChatPointParams = {
                assistant_type: currentAssistant.value?.id || "",
            };

            const reportEventPayloadAssistant: ReportEventPayload = {
                type: ReportEventType.AssistantChatPoint,
                params: assistantChatPointParams,
            };

            // 模型点埋点参数
            const modelPointParams: ModelPointParams = {
                model_species: currentModel.value?.network || "",
                model_type: currentModel.value?.provider || "",
            };
            const reportEventPayloadModel: ReportEventPayload = {
                type: ReportEventType.ModelPoint,
                params: modelPointParams,
            };

            const reports = [reportEventPayloadAssistant, reportEventPayloadModel];

            // 隐私对话
            const conversationScene = conversationManagerStore.getCurrentConversationScene;
            if (conversationScene === ConversationScene.Temporary) {
                const reportEventPayloadTemporary: ReportEventPayload = {
                    type: ReportEventType.PrivateChatPoint,
                };
                reports.push(reportEventPayloadTemporary);
            }

            reportChannelStore.writeReportEvent(reports);
        };

        // 处理发送消息
        const handleSendMessage = async (bypassPrivacyCheck = false) => {
        performance.mark("sunday-send-start");
            // 判断是否应该禁用发送（与发送按钮的 disabled 条件同步）
            if (shouldDisableInput.value || !canSendMessage.value) {
                return;
            }

            // 检查会话数限制
            if (!(await conversationManagerStore.canCreateNewConversation())) {
                return;
            }

            // 将模板渲染为最终纯文本再提交
            const renderedText = getRenderedText(inputValue.value);
            const uploadedFiles = uploadFilesStore.getUploadedFilesSnapshot();
            const finalMessageText = renderedText.trim()
                ? renderedText
                : uploadedFiles.length > 0
                  ? backend.translate("Summarize the key content of the file.")
                  : "";

            if (!finalMessageText.trim()) {
                return;
            }

            // 检查是否需要弹出文件隐私保护对话框
            if (!bypassPrivacyCheck && shouldShowFilePrivacyDialog()) {
                showFilePrivacyDialog.value = true;
                return;
            }

            // 隐藏操作取消提示
            isOperationCanceled.value = false;

            // 从 modelList 获取第一个模型的 id

            // 保存输入的值
            const userMessage = {
                content: finalMessageText,
            };

            emit("update", "button clicked from ChatView");
            currentMessageId.value = createId(); // 生成一个当前唯一的消息ID
            if (1) {
                const sessionId = createId();

                // 从 toggleStateStore 获取深度思考和联网搜索状态
                let params = {} as Params;
                if (canUseDeepThink.value) {
                    params.thinking = toggleStateStore.deepThinkEnabled; // 深度思考
                }
                if (canUseWebSearch.value) {
                    params.online = toggleStateStore.webSearchEnabled; // 联网搜索
                }
                Object.assign(params, buildSceneParams());
                Object.assign(params, buildUploadParams(uploadedFiles));

                const messageExtension = buildMessageExtension(uploadedFiles);

                // 获取当前会话ID
                const currentConversationId = conversationManagerStore.getCurrentConversationId;
                // 创建 ChatMessage 发送给后端（保持不变）
                let message: ChatMessage = {
                    session_id: sessionId,
                    conversation_id: currentConversationId,
                    assistant: currentAssistant.value?.id || "",
                    model: currentModel.value?.id || "",
                    model_name: currentModel.value?.name || "",
                    runtime_mode: sessionRuntimeMode.value,
                    user: "user",
                    params: params,
                    message: {
                        id: currentMessageId.value, // 消息ID, 前端发送
                        previous:
                            currentConversationId ===
                            conversationManagerStore.getMessageIdByConversationId(currentConversationId)
                                ? ""
                                : (conversationManagerStore.getMessageIdByConversationId(
                                      currentConversationId,
                                  ) as string), // 当前显示上一条消息的message.id
                        content: buildOutgoingMessageContent(userMessage.content, uploadedFiles),
                        extension: messageExtension,
                    },
                };

                const conversationRecordMessage: ConversationMessage = {
                    id: currentMessageId.value,
                    cur_next: "",
                    extension: messageExtension || {},
                    message: [
                        {
                            content: [
                                {
                                    content: userMessage.content,
                                    type: "text",
                                },
                            ],
                            role: "user",
                            source: "",
                        },
                    ],
                    next: [],
                    previous: conversationManagerStore.getMessageIdByConversationId(currentConversationId) as string,
                    render_message: [
                        {
                            data: {
                                content: userMessage.content,
                            },
                            type: "text",
                        },
                    ],
                    role: UserType.USER,
                    model_id: currentModel.value?.id || "",
                    model_name: currentModel.value?.name || "",
                };

                // 会话管理器添加消息
                await conversationManagerStore.addConversationMessage(
                    currentConversationId,
                    currentMessageId.value,
                    conversationRecordMessage,
                    sessionId,
                );
                logSmoke(
                    "[ChatView] queued session mapping:",
                    JSON.stringify({
                        sessionId,
                        conversationId: currentConversationId,
                        currentConversationId: conversationManagerStore.getCurrentConversationId,
                        currentRecordSessionId:
                            conversationManagerStore.getCurrentConversationRecord?.sessionId || "",
                    }),
                );
                // 发送新消息时显示卡片
                const conversationRecord = conversationManagerStore.conversionList.get(currentConversationId);
                if (conversationRecord) {
                    conversationRecord.showCards = true;
                }
                logSmoke("Sending message:", message);
                backend.requestSession("sendMessage", JSON.stringify(message));
            performance.mark("sunday-send-done");
                reportEvent();
                uploadFilesStore.clearFiles();
                pendingPromptSource.value = null;
            } else {
                // 当前助手没有新建会话成功
                console.error("Failed to find conversation for assistant:", currentAssistant.value?.id);
            }

            // 清空输入框
            inputValue.value = "";
        };

        const handleApplySuggestedPrompt = async (payload: { prompt: string; send: boolean }) => {
            pendingPromptSource.value = "file-guidance";

            if (!payload?.send) {
                return;
            }

            inputValue.value = payload.prompt;
            await nextTick();
            await handleSendMessage();
        };

        const maybeRunAutoSend = async () => {
            const url = new URL(window.location.href);
            const autoSend = url.searchParams.get("autoSend");
            if (!autoSend) {
                return;
            }

            document.body.setAttribute("data-auto-send-requested", autoSend);

            for (let attempt = 0; attempt < 40; attempt += 1) {
                const ready =
                    !!currentAssistant.value?.id &&
                    !!currentModel.value?.id &&
                    !!conversationManagerStore.getCurrentConversationId;

                document.body.setAttribute("data-auto-send-attempt", String(attempt + 1));
                document.body.setAttribute("data-auto-send-ready", ready ? "true" : "false");

                if (ready) {
                    inputValue.value = autoSend;
                    await nextTick();
                    document.body.setAttribute("data-auto-send-fired", "true");
                    await handleSendMessage(true);
                    return;
                }

                await wait(250);
            }

            document.body.setAttribute("data-auto-send-timeout", "true");
        };

        const refreshSessionRuntimeMode = async () => {
            try {
                const runtime = await backend.requestServiceConfig("getRuntimeStatus");
                const rawMode = runtime?.mode;
                if (rawMode === "live" || rawMode === "demo") {
                    sessionRuntimeMode.value = rawMode;
                    return;
                }
            } catch (error) {
                console.warn("[ChatView] Failed to read runtime mode from serviceConfig:", error);
            }

            if (runtimeStatusStore.mode === "local-mock") {
                sessionRuntimeMode.value = "mock";
            } else {
                sessionRuntimeMode.value = "unknown";
            }
        };

        // 文件隐私对话框：取消，不发送任何内容
        const handleFilePrivacyCancel = () => {
            showFilePrivacyDialog.value = false;
        };

        // 文件隐私对话框：确认继续生成，绕过隐私检查直接发送
        const handleFilePrivacyConfirm = async () => {
            showFilePrivacyDialog.value = false;
            await handleSendMessage(true);
        };

        // 处理停止消息
        const handleStopMessage = () => {
            const currentSessionId = conversationManagerStore.getSessionIdByConversationId; // 获取当前会话ID

            if (currentSessionId) {
                // 调用后端停止会话
                backend.requestSession("cancel", JSON.stringify({ session_id: currentSessionId }));
                // 显示操作取消提示
                isOperationCanceled.value = true;
            }
        };

        // 处理输入框值更新
        const handleInputUpdate = (value: string) => {
            inputValue.value = value;
        };

        // 处理消息点击
        const handleMessageClick = (message: ConversationMessage) => {
            // console.log("Message clicked:", message);
        };

        // 标题栏滚动状态
        const { titleBarScrolled } = useTitleBarState();

        // 处理消息区域滚动
        const handleMessagesScroll = (scrollTop: number) => {
            if (!scrollBarRef.value) return;
            const isAtBottom = scrollBarRef.value.isAtBottom();
            const canScroll = scrollBarRef.value.isScrollable();

            // 持续记录滚动状态，供 resize 时使用
            wasAtBottomBeforeResize = isAtBottom;
            wasScrollableBeforeResize = canScroll;

            // 更新回到底部按钮状态：只有内容可滚动且当前没有滚动到底部时才显示
            showScrollToBottomButton.value = canScroll && !isAtBottom;
            // 更新底部渐隐效果：内容可滚动且未到底部时显示
            showBottomFade.value = canScroll && !isAtBottom;

            // 更新标题栏下边线状态
            titleBarScrolled.value = scrollTop > 0;

            if (autoScrollTimer !== null) {
                // 正在自动滚动时，检测用户是否手动向上滚动
                if (!isAtBottom) {
                    // 用户手动向上滚动，停止自动滚动
                    window.clearInterval(autoScrollTimer);
                    autoScrollTimer = null;
                }
            } else if (isAtBottom && shouldShowStopButton.value) {
                // 自动滚动已停止，但用户滚动到底部且会话仍在运行，重新启动自动滚动
                const scrollToBottom = () => {
                    scrollBarRef.value?.scrollToBottom();
                };
                scrollToBottom();
                autoScrollTimer = window.setInterval(scrollToBottom, 100);
            }
        };

        const handleWelcomeViewScroll = (scrollTop: number) => {
            // 欢迎页滚动时更新标题栏下边线状态
            titleBarScrolled.value = scrollTop > 0;
        };

        // 处理点击回到底部按钮
        const handleScrollToBottom = () => {
            // 滚动动画时长（毫秒），可调整此值控制滚动速度
            const scrollAnimationDuration = 10;
            scrollBarRef.value?.scrollToBottomWithAnimation(scrollAnimationDuration);
        };

        // 处理消息重试
        const handleRetryMessage = async (msg: ConversationMessage) => {
            // 检查会话数限制
            if (!(await conversationManagerStore.canCreateNewConversation())) {
                return;
            }
            // 隐藏操作取消提示
            isOperationCanceled.value = false;

            // 从 modelList 获取第一个模型的 id

            const currentConversationId = conversationManagerStore.getCurrentConversationId;

            currentMessageId.value = Date.now().toString(); // 生成一个当前唯一的消息ID

            // 创建会话id：毫秒时间戳_4位随机数
            const timestamp = Date.now();
            const randomNum = Math.floor(Math.random() * 9000) + 1000; // 生成1000-9999的随机数
            const sessionId = `${timestamp}_${randomNum}`;

            // 从 toggleStateStore 获取深度思考和联网搜索状态
            let params = {} as Params;
            if (canUseDeepThink.value) {
                params.thinking = toggleStateStore.deepThinkEnabled; // 深度思考
            }
            if (canUseWebSearch.value) {
                params.online = toggleStateStore.webSearchEnabled; // 联网搜索
            }
            Object.assign(params, buildSceneParams());

            // 找到重试的问题
            const questionMsg = conversation.value?.messages[msg.previous];
            const retryText = getConversationMessageText(questionMsg);
            const retryUploadedFiles = getCachedUploadedFiles(questionMsg);
            Object.assign(params, buildUploadParams(retryUploadedFiles));
            const messageExtension = buildMessageExtension(retryUploadedFiles);
            logSmoke("To Retry Question Message:", questionMsg);
            logSmoke("Message retried:", msg);
            // 创建 ChatMessage 发送给后端（保持不变）
            let message: ChatMessage = {
                session_id: sessionId,
                conversation_id: currentConversationId,
                assistant: currentAssistant.value?.id || "",
                model: currentModel.value?.id || "",
                model_name: currentModel.value?.name || "",
                runtime_mode: sessionRuntimeMode.value,
                user: "user",
                params: params,
                message: {
                    id: questionMsg?.id || "", // 消息ID, 前端发送
                    previous:
                        currentConversationId ===
                        conversationManagerStore.getMessageIdByConversationId(currentConversationId)
                            ? ""
                            : (conversationManagerStore.getMessageIdByConversationId(currentConversationId) as string), // 当前显示上一条消息的message.id
                    content: buildOutgoingMessageContent(retryText, retryUploadedFiles),
                    extension: messageExtension,
                },
            };

            // 处理重试
            await conversationManagerStore.handleRetry(currentConversationId, questionMsg?.id || "", sessionId);

            logSmoke("Retry Sending message:", message);
            backend.requestSession("retry", JSON.stringify(message));
            reportEvent();
        };

        // ========== Input Context 实现了 ==========
        const textareaRef = ref<any>(null);

        const fillInput = (content: string, mode: "replace" | "append" = "replace") => {
            if (mode === "replace") {
                inputValue.value = content;
            } else {
                // 追加模式
                if (inputValue.value && !inputValue.value.endsWith("\n")) {
                    inputValue.value += "\n" + content;
                } else {
                    inputValue.value += content;
                }
            }
        };

        const clearInput = () => {
            inputValue.value = "";
        };

        const focusInput = () => {
            nextTick(() => {
                window.requestAnimationFrame(() => {
                    // 等待一帧，避免会话切换/页面切换后的重渲染把焦点抢走。
                    if (textareaRef.value?.focus && !shouldDisableInput.value) {
                        textareaRef.value.focus();
                    }
                });
            });
        };

        const getInputValue = () => {
            return inputValue.value;
        };

        const isInputDisabled = () => {
            return shouldDisableInput.value;
        };

        const inputActionContext: ChatInputActionContext = {
            fillInput,
            clearInput,
            focusInput,
            getInputValue,
            isInputDisabled,
            selectFile: (options) => uploadFilesStore.selectFile(options),
            startScreenshot: () => uploadFilesStore.startScreenshot(),
        };

        const handleInputActionSelect = async (actionId: string) => {
            await executeInputAreaAction(inputAreaSceneConfig.value.actions, actionId, inputActionContext);
        };

        // Provide 给子组件
        provide(CHAT_INPUT_KEY, {
            fillInput,
            clearInput,
            focusInput,
            getInputValue,
            isInputDisabled,
        } as ChatInputContext);

        // ========== QuickInput 状态（provide 到整棵树，供 Message 注入触发） ==========
        const quickInputVisible = ref(false);
        const quickInputIcon = ref("add");
        const quickInputText = ref("");
        const quickInputStyle = ref("");

        const showQuickInput = (icon: string, text: string, styleClass?: string) => {
            console.log("[ChatView] showQuickInput called:", { icon, text, styleClass });
            if (!icon.trim() || !text.trim()) {
                console.warn("[ChatView] showQuickInput: icon or text is empty, ignored.");
                return;
            }
            quickInputIcon.value = icon;
            quickInputText.value = text;
            quickInputStyle.value = styleClass ?? "";
            quickInputVisible.value = true;
        };

        const hideQuickInput = () => {
            console.log("[ChatView] hideQuickInput called");
            quickInputVisible.value = false;
        };

        provide(QUICK_INPUT_KEY, { showQuickInput, hideQuickInput });

        provide(ASSISTANT_VIEW_CONFIG_KEY, assistantViewConfig);

        // 点击快速输入按钮：填充文本 → 立即发送 → 隐藏按钮
        const handleQuickInputSend = () => {
            fillInput(quickInputText.value, "replace");
            handleSendMessage(); // TODO 可能需要返回值来决定是否隐藏快速输入
            hideQuickInput();
        };

        // 监听 store 中 currentAssistant 的变化
        watch(
            () => assistantInfosStore.getCurrentAssistant,
            async (newAssistant) => {
                const assistantId = newAssistant?.id || "";
                void backend.requestFile("setCurrentAssistantId", assistantId).catch((error: unknown) => {
                    console.warn("Failed to sync current assistant to file channel:", error);
                });

                if (!newAssistant) {
                    // 切换回来的会话助手不存在，设置输入框禁用
                    shouldDisableInputByAssistant.value = true;
                    currentAssistant.value = null;
                    return;
                }
                // 检查环境是否存在
                if (newAssistant.envExists === false) {
                    shouldDisableInputByAssistant.value = true;
                } else {
                    shouldDisableInputByAssistant.value = false;
                }
                // 只有当新值不为 null 且与当前值不同时才更新
                if (newAssistant && (!currentAssistant.value || currentAssistant.value.id !== newAssistant.id)) {
                    currentAssistant.value = newAssistant;
                    // 重新加载模型列表
                    await modelInfosStore.loadModelList(newAssistant.id);
                    isOperationCanceled.value = false; // 切换会话时，重置操作取消状态
                }
            },
            { immediate: true, deep: true }, // 立即执行一次，使用当前值
        );

        watch(
            () => conversationManagerStore.getCurrentConversationId,
            (newConversationId, oldConversationId) => {
                if (!newConversationId) {
                    return;
                }

                if (newConversationId === oldConversationId) {
                    return;
                }

                if (oldConversationId) {
                    uploadFilesStore.clearFiles();
                }

                focusInput();
            },
            { immediate: true, flush: "post" },
        );

        watch(
            inputValue,
            (value) => {
                if (!value.trim()) {
                    pendingPromptSource.value = null;
                }
            },
        );

        // 监听 shouldShowStopButton 变化，控制自动滚动
        watch(
            shouldShowStopButton,
            (isRunning) => {
                if (isRunning) {
                    // 开始自动滚动到底部
                    const scrollToBottom = () => {
                        scrollBarRef.value?.scrollToBottom();
                    };
                    // 立即滚动一次
                    scrollToBottom();
                    // 设置定时器持续滚动
                    autoScrollTimer = window.setInterval(scrollToBottom, 100);
                } else {
                    // 停止自动滚动
                    if (autoScrollTimer !== null) {
                        window.clearInterval(autoScrollTimer);
                        autoScrollTimer = null;
                    }
                    setTimeout(() => {
                        // 停止回答后，将模型回答底部按钮滚动到可见区域
                        scrollBarRef.value?.scrollToBottom();
                    }, 100);
                }
            },
            { immediate: true },
        );

        // 监听会话 ID 变化，处理输入框初始化和焦点
        watch(
            () => conversation.value?.root?.id,
            (newConversationId, oldConversationId) => {
                if (newConversationId === oldConversationId) {
                    return;
                }

                if (!newConversationId) {
                    return;
                }

                // conversation 变化且为新会话时，填充默认提示词或清空输入框
                const conv = conversation.value;
                const defaultPrompt = assistantViewConfig.value.defaultPrompt;
                const isNewConversation = Object.keys(conv?.messages || {}).length === 0;
                if (defaultPrompt && isNewConversation) {
                    fillInput(defaultPrompt, "replace");
                } else {
                    clearInput();
                }
                focusInput();
            },
            { immediate: true },
        );

        // 监听 conversation 变化，处理滚动和状态重置
        watch(
            conversation,
            (newConversation) => {
                if (Object.keys(newConversation?.messages || {}).length === 0) {
                    isOperationCanceled.value = false; // 新建会话时，重置操作取消状态
                }
                if (
                    Object.keys(newConversation?.messages || {}).length > 0 &&
                    newConversation?.root?.id !== lastConversationId.value
                ) {
                    // 定时器100毫秒后，滚动到底部，确保新消息可见
                    setTimeout(() => {
                        scrollBarRef.value?.scrollToBottom();
                    }, 100);
                    // 更新上一个会话 ID
                    lastConversationId.value = newConversation?.root?.id || "";
                    isOperationCanceled.value = false; // 切换会话时，重置操作取消状态
                }
            },
            { immediate: true, deep: true },
        );

        // 监听 windowChannelStore.pendingPrompt 变化，处理 windowAppendPrompt 信号
        watch(
            () => windowChannelStore.pendingPrompt,
            async (pendingPrompt) => {
                if (!pendingPrompt) {
                    return;
                }

                const { question, isSend } = pendingPrompt;
                console.log("Processing pending prompt:", question, isSend);

                if (isSend) {
                    // 如果 isSend 为 true，先创建新会话再发送消息
                    const currentAssistantId = currentAssistant.value?.id;
                    if (currentAssistantId) {
                        await createConversation({ assistantId: currentAssistantId });
                    }
                    // 等待会话创建完成后设置输入值并发送
                    await nextTick();
                    inputValue.value = question;
                    handleSendMessage();
                } else {
                    // 如果 isSend 为 false，将问题追加到输入框
                    fillInput(question, "append");
                }

                // 清除待处理的提示信息
                windowChannelStore.clearPendingPrompt();
            },
            { immediate: true },
        );

        onMounted(() => {
            document.body.setAttribute("data-chatview-mounted", "true");
            // 组件挂载时滚动到底部
            nextTick(() => {
                scrollBarRef.value?.scrollToBottom();
            });
            void refreshSessionRuntimeMode();
            void maybeRunAutoSend();
        });

        // 监听消息区域尺寸变化
        watch(
            messagesContainerRef,
            (newRef) => {
                if (resizeObserver) {
                    resizeObserver.disconnect();
                }
                if (newRef) {
                    if (!resizeObserver) {
                        resizeObserver = new ResizeObserver(() => {
                            // resize 发生时，使用之前记录的状态判断是否需要滚动到底部
                            // 如果 resize 前：在底部 或 内容不可滚动，则保持底部
                            if (wasAtBottomBeforeResize || !wasScrollableBeforeResize) {
                                // 确保滚动到底部
                                setTimeout(() => {
                                    scrollBarRef.value?.scrollToBottom();
                                }, 100);
                            }
                        });
                    }
                    resizeObserver.observe(newRef);
                }
            },
            { immediate: true },
        );

        // 监听 MessageNavigator 高度变化
        watch(
            messageNavigatorRef,
            (newRef) => {
                if (navigatorResizeObserver) {
                    navigatorResizeObserver.disconnect();
                }
                if (newRef && newRef.$el) {
                    if (!navigatorResizeObserver) {
                        navigatorResizeObserver = new ResizeObserver(() => {
                            if (scrollBarRef.value) {
                                setTimeout(() => {
                                    const isAtBottom = scrollBarRef.value?.isAtBottom();
                                    const canScroll = scrollBarRef.value?.isScrollable();
                                    showScrollToBottomButton.value = !isAtBottom && (canScroll as boolean);
                                    showBottomFade.value = (canScroll as boolean) && !isAtBottom;
                                }, 100);
                            }
                        });
                    }
                    navigatorResizeObserver.observe(newRef.$el);
                }
            },
            { immediate: true },
        );

        onUnmounted(() => {
            // 组件卸载时清理定时器
            if (autoScrollTimer !== null) {
                window.clearInterval(autoScrollTimer);
                autoScrollTimer = null;
            }
            clearHighlightedOverviewTarget();
            clearHighlightedActionTarget();
            // 卸载时重置标题栏滚动状态
            titleBarScrolled.value = false;
            // 清理 ResizeObserver（消息容器）
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }
            // 清理 ResizeObserver（MessageNavigator）
            if (navigatorResizeObserver) {
                navigatorResizeObserver.disconnect();
                navigatorResizeObserver = null;
            }
        });

        return {
            inputValue,
            conversation,
            hasUserMessages,
            shouldShowStopButton,
            isSessionRunning,
            shouldDisableInput,
            isStreamingLastMessage,
            inputAreaSceneConfig,
            inputAreaActionMenuItems,
            inputPlaceholder,
            canSendMessage,
            handleInputUpdate,
            handleSendMessage,
            handleApplySuggestedPrompt,
            handleStopMessage,
            handleMessageClick,
            handleMessagesScroll,
            handleWelcomeViewScroll,
            handleRetryMessage,
            handleInputActionSelect,
            handleScrollToBottom,
            textareaRef,
            // QuickInput 状态
            quickInputVisible,
            quickInputIcon,
            quickInputText,
            quickInputStyle,
            hideQuickInput,
            handleQuickInputSend,
            // 操作取消状态
            isOperationCanceled,
            isFromHistory, // 是否从历史记录中加载
            // 文件隐私保护对话框
            showFilePrivacyDialog,
            filePrivacyWebSearch,
            handleFilePrivacyCancel,
            handleFilePrivacyConfirm,
            currentModelForDialog: currentModel,
            currentAssistant,
            // ScrollBar 引用
            scrollBarRef,
            // 消息区域容器引用
            messagesContainerRef,
            // MessageNavigator 引用
            messageNavigatorRef,
            // 回到底部按钮状态
            showScrollToBottomButton,
            // 底部渐隐效果状态
            showBottomFade,
            isEnableAdvancedCssFeatures: backend.$state.isEnableAdvancedCssFeatures,
        };
    },
    render() {
        const InputAreaExtension = this.inputAreaSceneConfig.actionExtension;

        return (
            <div class="chat-view">
                {/* 聊天消息或欢迎页区域 */}
                {this.hasUserMessages && this.conversation ? (
                    <div
                        ref="messagesContainerRef"
                        class={["chat-view__messages", this.showBottomFade && "chat-view__messages--fade-bottom"]}
                    >
                        <ScrollBar ref="scrollBarRef" edgeBounce momentum onScroll={this.handleMessagesScroll}>
                            <MessageNavigator
                                ref="messageNavigatorRef"
                                conversation={this.conversation}
                                isStreamingLastMessage={this.isStreamingLastMessage || false}
                                isSessionRunning={this.isSessionRunning}
                                isOperationCanceled={this.isOperationCanceled}
                                isFromHistory={this.isFromHistory}
                                onMessageClick={this.handleMessageClick}
                                onRetryMessage={this.handleRetryMessage}
                                currentAssistant={this.currentAssistant || undefined}
                                shouldDisableRetry={this.shouldDisableInput}
                            />
                        </ScrollBar>
                        {/* 回到底部按钮 */}
                        {this.showScrollToBottomButton && (
                            <div class="chat-view__scroll-to-bottom-container">
                                <div
                                    class={[
                                        "chat-view__scroll-to-bottom-button",
                                        this.isEnableAdvancedCssFeatures &&
                                            "chat-view__scroll-to-bottom-button--advanced-css",
                                    ]}
                                    onClick={this.handleScrollToBottom}
                                >
                                    <SvgIcon icon="icon_arrow" size={[16, 16]} />
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div class="chat-view__welcome">
                        <ScrollBar edgeBounce momentum onScroll={this.handleWelcomeViewScroll}>
                            <WelcomeView />
                        </ScrollBar>
                    </div>
                )}

                {/* 输入区域 */}
                <div class="chat-view__input-wrapper">
                    {this.quickInputVisible && (
                        <div class="chat-view__quick-input-floater">
                            <QuickInputButton
                                icon={this.quickInputIcon}
                                text={this.quickInputText}
                                styleClass={this.quickInputStyle}
                                onClick={this.handleQuickInputSend}
                            />
                        </div>
                    )}
                    <div class="chat-view__input-area">
                        <InputArea
                            ref="textareaRef"
                            modelValue={this.inputValue}
                            onUpdateValue={this.handleInputUpdate}
                            onEnter={this.shouldShowStopButton ? this.handleStopMessage : this.handleSendMessage}
                            onSend={this.shouldShowStopButton ? this.handleStopMessage : this.handleSendMessage}
                            onApplySuggestedPrompt={this.handleApplySuggestedPrompt}
                            sendButtonText={this.shouldShowStopButton ? "停止" : "发送"}
                            isSending={this.shouldShowStopButton}
                            canSend={this.canSendMessage}
                            disabled={this.shouldDisableInput}
                            placeholder={this.inputPlaceholder}
                            actionMenuItems={this.inputAreaActionMenuItems}
                            onSelectAction={this.handleInputActionSelect}
                            rows={3}
                            autoResize={true}
                        >
                            {InputAreaExtension ? <InputAreaExtension /> : null}
                        </InputArea>
                    </div>
                </div>

                {/* 文件隐私保护对话框 */}
                <FilePrivacyDialog
                    visible={this.showFilePrivacyDialog}
                    modelName={this.currentModelForDialog?.name ?? ""}
                    webSearch={this.filePrivacyWebSearch}
                    onCancel={this.handleFilePrivacyCancel}
                    onConfirm={this.handleFilePrivacyConfirm}
                />
            </div>
        );
    },
});
