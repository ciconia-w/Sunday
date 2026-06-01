import { AssistantID, type Assistant } from "./types/assistant";
import { ModelAbility, type Model } from "./types/model";
import { DemoApprovalBroker } from "./dev-approval-broker";

type Listener<TArgs extends unknown[]> = (...args: TArgs) => void;

class Signal<TArgs extends unknown[]> {
    private readonly listeners = new Set<Listener<TArgs>>();

    connect(listener: Listener<TArgs>) {
        this.listeners.add(listener);
    }

    disconnect(listener: Listener<TArgs>) {
        this.listeners.delete(listener);
    }

    emit(...args: TArgs) {
        for (const listener of this.listeners) {
            listener(...args);
        }
    }
}

function splitArgs(args: unknown[]) {
    const list = [...args];
    const maybeCallback = list[list.length - 1];
    if (typeof maybeCallback === "function") {
        return {
            params: list.slice(0, -1),
            callback: maybeCallback as (value: unknown) => void,
        };
    }

    return {
        params: list,
        callback: null as ((value: unknown) => void) | null,
    };
}

function callbackify<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<unknown> | unknown) {
    return (...args: unknown[]) => {
        const { params, callback } = splitArgs(args);
        Promise.resolve(fn(...(params as TArgs)))
            .then((value) => {
                callback?.(value);
            })
            .catch((error) => {
                console.error("[dev channels] callbackified call failed", error);
                callback?.(undefined);
            });
    };
}

type SessionPayload = {
    session_id: string;
    conversation_id: string;
    assistant: string;
    model: string;
    model_name: string;
    params?: Record<string, unknown>;
    message: {
        id: string;
        previous: string;
        content: Array<{ type: string; data: { content?: string } }>;
        extension?: Record<string, unknown>;
    };
};

type ConversationStore = {
    root: {
        id: string;
        assistant: string;
        cur_next: string;
        model: string;
        next: string[];
    };
    messages: Record<string, Record<string, unknown>>;
};

const assistants: Assistant[] = [
    {
        id: AssistantID.UOS_AI,
        name: "Sunday",
        description: "General-purpose desktop agent for chat, tools, and file work",
        icon: { line: "uos-ai", color: "uos-ai-color" },
        gradient_colors: ["#6448FF", "#FF37DF", "#FCA506"],
        path: "icons/",
        place_holder: "让 Sunday 帮你处理文件、调用工具或执行任务...",
        envExists: true,
    },
];

const models: Model[] = [
    {
        id: "mock/gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        icon: "",
        network: "online",
        provider: "mock",
        ability: ModelAbility.MaText | ModelAbility.MaFunctionCalling,
    },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureDevInjectedChannels() {
    if (window.__UOS_PI_CHANNELS__) {
        return;
    }

    const sessionEvent = new Signal<[number, string, string]>();
    const windowFontChanged = new Signal<[string]>();
    const windowStateChanged = new Signal<[number]>();
    const windowModeChanged = new Signal<[number]>();
    const windowShown = new Signal<[]>();
    const windowAppendPrompt = new Signal<[string, boolean]>();
    const windowOverrideQuestion = new Signal<[string]>();
    const windowChangeToDigitalMode = new Signal<[]>();
    const toastRequested = new Signal<[string, string]>();
    const activeColorChanged = new Signal<[string]>();
    const networkChanged = new Signal<[boolean]>();
    const themeColorChanged = new Signal<[number]>();
    const themeIconChanged = new Signal<[]>();
    const notificationActionInvoked = new Signal<[number, string]>();
    const appUpdateAvailable = new Signal<[Record<string, unknown>]>();
    const fileEvent = new Signal<[number, string, string]>();
    const audioEvent = new Signal<[number, string, string]>();
    const taskAdded = new Signal<[number]>();
    const assistantChanged = new Signal<[]>();
    const modelListChanged = new Signal<[]>();
    const changeToConversation = new Signal<[string, string]>();
    const indexSearchChanged = new Signal<[]>();
    const knowledgeBaseChanged = new Signal<[boolean]>();
    const embeddingPluginsChanged = new Signal<[boolean]>();
    const mcpPluginChanged = new Signal<[boolean]>();

    const approvalBroker = new DemoApprovalBroker({
        emitSession: (event, sessionId, message) => {
            sessionEvent.emit(event, sessionId, message);
        },
        wait,
    });

    let currentModelId = models[0]?.id ?? "";
    const conversations = new Map<string, ConversationStore>();
    let lastSearchKeyword = "";
    const workspaceArticles = new Map<
        string,
        {
            id: string;
            title: string;
            content: string;
            version: number;
            created_at: string;
            updated_at: string;
            references: Array<{
                index: number;
                title: string;
                url: string;
                website: string;
                icon: string;
                snippet: string;
            }>;
        }
    >();
    const workspaceOutlines = new Map<string, { title: string; paragraphs: Array<{ title: string; content: Array<{ title: string }> }> }>();
    let mcpThirdPartyAgreementAccepted = false;
    const mcpServices = [
        {
            id: "filesystem",
            name: "Filesystem",
            description: "Local filesystem access for the agent runtime.",
            category: "systemBuiltIn",
            enabled: true,
            isBuiltIn: true,
            editable: false,
            removable: false,
        },
    ];

    function clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }

    function workspaceKey(conversationId: string, articleId: string) {
        return `${conversationId}::${articleId}`;
    }

    function ensureWorkspaceArticle(conversationId: string, articleId: string, title = "Untitled Document") {
        const key = workspaceKey(conversationId, articleId);
        const existing = workspaceArticles.get(key);
        if (existing) {
            return existing;
        }

        const now = new Date().toISOString();
        const created = {
            id: articleId,
            title,
            content: "",
            version: 1,
            created_at: now,
            updated_at: now,
            references: [],
        };
        workspaceArticles.set(key, created);
        return created;
    }

    function ensureWorkspaceOutline(conversationId: string, articleId: string) {
        const key = workspaceKey(conversationId, articleId);
        const existing = workspaceOutlines.get(key);
        if (existing) {
            return existing;
        }

        const created = {
            title: "Untitled Outline",
            paragraphs: [],
        };
        workspaceOutlines.set(key, created);
        return created;
    }

    function getOrCreateConversation(payload: SessionPayload) {
        const existing = conversations.get(payload.conversation_id);
        if (existing) {
            return existing;
        }

        const created: ConversationStore = {
            root: {
                id: payload.conversation_id,
                assistant: payload.assistant,
                cur_next: "",
                model: payload.model,
                next: [],
            },
            messages: {},
        };
        conversations.set(payload.conversation_id, created);
        return created;
    }

    function buildConversationIndex(conversation: ConversationStore) {
        const firstMessageId = conversation.root.cur_next;
        const firstMessage = firstMessageId ? conversation.messages[firstMessageId] : null;
        const title = String(
            (firstMessage as { render_message?: Array<{ type?: string; data?: { content?: string } }> } | null)
                ?.render_message?.find((item) => item?.type === "text")?.data?.content ?? "新对话",
        )
            .replace(/\s+/g, " ")
            .trim();

        return {
            id: conversation.root.id,
            title: title || "新对话",
            updated_at: Number(conversation.root.id) || Date.now(),
            assistant: conversation.root.assistant,
            assistant_name: assistants.find((item) => item.id === conversation.root.assistant)?.name ?? "",
            introduction: "",
        };
    }

    window.__UOS_PI_CHANNELS__ = {
        sessObj: {
            sessionEvent,
            sendMessage: callbackify(async (params: string) => {
                const payload = JSON.parse(params) as SessionPayload;
                const conversation = getOrCreateConversation(payload);
                const userMessage = {
                    id: payload.message.id,
                    cur_next: "",
                    extension: payload.message.extension ?? {},
                    message: [
                        {
                            content: payload.message.content.map((item) => ({
                                content: item.data.content ?? "",
                                type: item.type,
                            })),
                            role: "user",
                            source: "",
                        },
                    ],
                    next: [],
                    previous: payload.message.previous,
                    render_message: payload.message.content
                        .filter((item) => item.type === "text")
                        .map((item) => ({
                            type: "text",
                            data: { content: item.data.content ?? "" },
                        })),
                    role: 1,
                    model_id: payload.model,
                    model_name: payload.model_name,
                };
                if (!conversation.root.cur_next) {
                    conversation.root.cur_next = payload.message.id;
                    conversation.root.next.push(payload.message.id);
                }
                if (payload.message.previous && conversation.messages[payload.message.previous]) {
                    const prev = conversation.messages[payload.message.previous] as {
                        cur_next?: string;
                        next?: string[];
                    };
                    prev.cur_next = payload.message.id;
                    prev.next = (prev.next ?? []).filter((id) => id !== payload.message.id);
                    prev.next.push(payload.message.id);
                }
                conversation.messages[payload.message.id] = userMessage;
                const text = payload.message.content
                    .map((item) => item.data.content ?? "")
                    .join("\n")
                    .trim();
                const requestId = approvalBroker.create(payload.session_id, payload.conversation_id, text);

                sessionEvent.emit(1, payload.session_id, "");
                await wait(80);
                sessionEvent.emit(
                    4,
                    payload.session_id,
                    JSON.stringify({ type: "text", data: { content: `收到：${text}\n` } }),
                );
                await wait(120);
                approvalBroker.emitPendingBashApprove(requestId);
            }),
            retry: callbackify(async (params: string) => {
                const payload = JSON.parse(params) as SessionPayload;
                const text = payload.message.content
                    .map((item) => item.data.content ?? "")
                    .join("\n")
                    .trim();
                const requestId = approvalBroker.create(payload.session_id, payload.conversation_id, text);

                sessionEvent.emit(1, payload.session_id, "");
                await wait(80);
                sessionEvent.emit(
                    4,
                    payload.session_id,
                    JSON.stringify({ type: "text", data: { content: `收到：${text}\n` } }),
                );
                await wait(120);
                approvalBroker.emitPendingBashApprove(requestId);
            }),
            cancel: callbackify(async (params: string) => {
                const { session_id } = JSON.parse(params) as { session_id: string };
                sessionEvent.emit(
                    3,
                    session_id,
                    JSON.stringify({ error: 0, error_message: "Generation stopped by user" }),
                );
            }),
            invokeAction: callbackify(async (_sessionId: string, json: string) => {
                console.debug("[dev channels] invokeAction", json);
                const action = JSON.parse(json) as {
                    request_id?: string;
                    approved?: boolean;
                    approve?: boolean;
                    reject_msg?: string;
                };
                await approvalBroker.apply(action);
            }),
        },
        assistObj: {
            assistantChanged,
            modelListChanged,
            getAssistantList: callbackify(async () => assistants),
            getModelList: callbackify(async () => models),
            getCurrentModel: callbackify(async () => currentModelId),
            setCurrentModel: callbackify(async (modelId: string) => {
                currentModelId = modelId;
                modelListChanged.emit();
                return true;
            }),
            getAssistantOrder: callbackify(async () => assistants.map((item) => item.id)),
            setAssistantOrder: callbackify(async () => undefined),
            getAssistantVisibleCount: callbackify(async () => Math.min(4, assistants.length)),
            setAssistantVisibleCount: callbackify(async () => undefined),
            getRecentWritingDocs: callbackify(async () => "[]"),
            getWritingTemplates: callbackify(async () => "[]"),
            getTranslationFAQ: callbackify(async () => "[]"),
            getClawFAQ: callbackify(async () => "[]"),
            requestAddModel: callbackify(async () => undefined),
            claimUsageRequest: callbackify(async () => undefined),
        },
        conversationObj: {
            changeToConversation,
            indexSearchChanged,
            getConversation: callbackify(async (id: string) => clone(conversations.get(id) ?? null)),
            getConversationIndexes: callbackify(async () =>
                JSON.stringify(Array.from(conversations.values()).map((item) => buildConversationIndex(item))),
            ),
            getHistoryConversationIndexes: callbackify(async () =>
                JSON.stringify(
                    Array.from(conversations.values())
                        .map((item) => buildConversationIndex(item))
                        .filter((item) => {
                            if (!lastSearchKeyword) {
                                return true;
                            }
                            return item.title.toLowerCase().includes(lastSearchKeyword);
                        }),
                ),
            ),
            deleteConversation: callbackify(async (ids: string[]) => {
                for (const id of ids) {
                    conversations.delete(id);
                }
            }),
            releaseConversation: callbackify(async () => undefined),
            searchConversations: callbackify(async (keyword: string) => {
                lastSearchKeyword = keyword.trim().toLowerCase();
                indexSearchChanged.emit();
            }),
            setConversationRender: callbackify(async (conversationId: string, messageId: string, renderJson: string) => {
                const conversation = conversations.get(conversationId);
                if (!conversation) {
                    return;
                }
                const messages = conversation.messages;
                const renderMessage = JSON.parse(renderJson) as Array<Record<string, unknown>>;
                for (const item of renderMessage) {
                    if (item?.type === "doc_card") {
                        const doc = item.data as { id?: string; title?: string };
                        if (doc?.id) {
                            ensureWorkspaceArticle(conversationId, doc.id, doc.title ?? "Untitled Document");
                        }
                    } else if (item?.type === "outline") {
                        const outline = item.data as { id?: string; title?: string; paragraphs?: Array<{ title: string; content: Array<{ title: string }> }> };
                        const articleId = outline?.id ?? `${conversationId}-outline`;
                        workspaceOutlines.set(workspaceKey(conversationId, articleId), {
                            title: outline?.title ?? "Untitled Outline",
                            paragraphs: Array.isArray(outline?.paragraphs) ? outline.paragraphs : [],
                        });
                    }
                }
                const previousId = Object.keys(messages).find((id) => {
                    const message = messages[id] as { cur_next?: string };
                    return message?.cur_next === "" && id !== messageId;
                });
                messages[messageId] = {
                    id: messageId,
                    cur_next: "",
                    extension: {},
                    message: [],
                    next: [],
                    previous: previousId ?? "",
                    render_message: renderMessage,
                    role: 2,
                    model_id: currentModelId,
                    model_name: models.find((item) => item.id === currentModelId)?.name ?? "",
                };
                if (previousId && messages[previousId]) {
                    const prev = messages[previousId] as { cur_next?: string; next?: string[] };
                    prev.cur_next = messageId;
                    prev.next = (prev.next ?? []).filter((id) => id !== messageId);
                    prev.next.push(messageId);
                }
            }),
            saveConversation: callbackify(async () => true),
            switchMessageNext: callbackify(async (conversationId: string, target: string, next: string) => {
                const conversation = conversations.get(conversationId);
                const message = conversation?.messages[target] as { cur_next?: string; next?: string[] } | undefined;
                if (!message) {
                    return false;
                }
                message.cur_next = next;
                message.next = (message.next ?? []).filter((id) => id !== next);
                message.next.push(next);
                return true;
            }),
            getWorkspaceArticle: callbackify(async (conversationId: string, articleId: string) =>
                JSON.stringify(clone(ensureWorkspaceArticle(conversationId, articleId))),
            ),
            updateWorkspaceArticle: callbackify(async (conversationId: string, articleId: string, newContent: string) => {
                const article = ensureWorkspaceArticle(conversationId, articleId);
                article.content = newContent;
                article.updated_at = new Date().toISOString();
                article.version += 1;
                return true;
            }),
            getWorkspaceOutline: callbackify(async (conversationId: string, articleId: string) =>
                JSON.stringify(clone(ensureWorkspaceOutline(conversationId, articleId))),
            ),
            updateWorkspaceOutline: callbackify(async (conversationId: string, outlineJson: string) => {
                const outline = JSON.parse(outlineJson || "{}") as {
                    id?: string;
                    title?: string;
                    paragraphs?: Array<{ title: string; content: Array<{ title: string }> }>;
                };
                const articleId = outline.id ?? `${conversationId}-outline`;
                workspaceOutlines.set(workspaceKey(conversationId, articleId), {
                    title: outline.title ?? "Untitled Outline",
                    paragraphs: Array.isArray(outline.paragraphs) ? outline.paragraphs : [],
                });
            }),
            saveWorkspaceArticleToFile: callbackify(async () => true),
            printHTML: callbackify(async () => undefined),
        },
        windowObj: {
            windowFontChanged,
            windowStateChanged,
            windowModeChanged,
            windowShown,
            windowAppendPrompt,
            windowOverrideQuestion,
            windowChangeToDigitalMode,
            toastRequested,
            windowMode: callbackify(async () => 0),
            switchMode: callbackify(async (mode: number) => {
                windowModeChanged.emit(mode);
            }),
            isMainWindowActive: callbackify(async () => true),
            showConfig: callbackify(async () => undefined),
            showHelpWindow: callbackify(async () => undefined),
            showAboutWindow: callbackify(async () => undefined),
            minimize: callbackify(async () => undefined),
            maximize: callbackify(async () => undefined),
            restore: callbackify(async () => undefined),
            close: callbackify(async () => undefined),
            ensureMinimumWidth: callbackify(async () => undefined),
            saveMainWindowSidebarState: callbackify(async () => undefined),
            saveMainWindowSidebarGroupCollapsedStates: callbackify(async () => undefined),
            getMainWindowSidebarState: callbackify(async () => ({
                sidebarWidth: 220,
                sidebarExpanded: true,
                groupCollapsedStates: {},
            })),
            shouldShowNewUserGuideOnStartup: callbackify(async () => false),
            recordNewUserGuideShown: callbackify(async () => undefined),
            showUpdateLogWindow: callbackify(async () => undefined),
            startMove: callbackify(async () => undefined),
            systemMenu: callbackify(async () => undefined),
        },
        systemObj: {
            activeColor: "#0081ff",
            fontInfo: "Noto Sans#14",
            themeColor: 1,
            networkStatus: true,
            activeColorChanged,
            networkChanged,
            themeColorChanged,
            themeIconChanged,
            notificationActionInvoked,
            appUpdateAvailable,
            getIconBase64: callbackify(async () => ""),
            loadTranslations: callbackify(async () => ({})),
            checkChineseLanguage: callbackify(async () => true),
            isEnableAdvancedCssFeatures: callbackify(async () => true),
            openUrl: callbackify(async (url: string) => window.open(url, "_blank", "noopener,noreferrer")),
            runCliCommand: callbackify(async (command: string) => {
                if (command.startsWith("gh auth status")) {
                    return '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"demo","tokenSource":"keyring"}]}}';
                }
                if (command.startsWith("opencli profile list")) {
                    return "Daemon is not running. Run opencli doctor after opening Chrome.";
                }
                if (command.startsWith("lark-cli auth status")) {
                    return '{"tokenStatus":"needs_refresh","userName":"Demo"}';
                }
                return "";
            }),
            copyToClipboard: callbackify(async (data: string) => {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(data);
                }
            }),
            closeNotification: callbackify(async () => undefined),
            checkAppUpdate: callbackify(async () => undefined),
            markAppUpdateReminderConsumed: callbackify(async () => undefined),
            themeColorOption: callbackify(async () => 0),
            switchThemeColor: callbackify(async (value: number) => {
                themeColorChanged.emit(value);
            }),
            openFile: callbackify(async () => undefined),
            openControlCenter: callbackify(async () => undefined),
            openAppStore: callbackify(async () => undefined),
            openAppStoreTab: callbackify(async () => undefined),
            openCalendar: callbackify(async () => undefined),
            updateVolume: callbackify(async () => undefined),
            updateBrightness: callbackify(async () => undefined),
            updateFontSize: callbackify(async () => undefined),
            toggleEyesProtection: callbackify(async () => undefined),
            doBluetoothConfig: callbackify(async () => undefined),
            doNoDisturb: callbackify(async () => undefined),
            switchWifi: callbackify(async () => undefined),
            getCurrentShortcut: callbackify(async () => ""),
            getCurrentTalkShortcut: callbackify(async () => ""),
        },
        fileObj: {
            fileEvent,
            validateIncomingPaths: callbackify(async (params: string) => params),
            handleDroppedFiles: callbackify(async () => undefined),
            handleCopiedFiles: callbackify(async () => undefined),
            handleScreenshotFile: callbackify(async () => undefined),
            parseFile: callbackify(async () => undefined),
            removeFile: callbackify(async () => undefined),
            isFileExist: callbackify(async () => true),
            getFileIconBase64: callbackify(async () => ""),
            processClipboardData: callbackify(async () => ""),
            isEnableScreenshot: callbackify(async () => false),
            startScreenshot: callbackify(async () => undefined),
            selectFile: callbackify(async () => undefined),
            setCurrentAssistantId: callbackify(async () => undefined),
        },
        audioObj: {
            audioEvent,
            startRecorder: callbackify(async () => false),
            stopRecorder: callbackify(async () => false),
            playTextAudio: callbackify(async () => false),
            stopPlayTextAudio: callbackify(async () => false),
            getDeviceStatus: callbackify(
                async () => JSON.stringify({ hasInputDevice: false, hasOutputDevice: false }),
            ),
        },
        taskObj: {
            taskAdded,
            onWindowCreated: callbackify(async () => undefined),
        },
        skillsMgr: {
            skillsData: callbackify(async () => []),
            reloadSkills: callbackify(async () => undefined),
            setSkillEnabled: callbackify(async () => true),
            hasSkill: callbackify(async () => false),
            addSkillForWeb: callbackify(async () => ({ success: false, error: "not implemented" })),
            removeSkill: callbackify(async () => false),
        },
        reportObj: {
            writeReportEvent: callbackify(async (jsonData: string) => {
                console.debug("[dev channels] report", jsonData);
            }),
        },
        serviceConfigObj: {
            knowledgeBaseChanged,
            embeddingPluginsChanged,
            mcpPluginChanged,
            checkKnowledgeBase: callbackify(async () => false),
            checkEmbeddingPlugins: callbackify(async () => false),
            isMcpRuntimeReady: callbackify(async () => true),
            getRuntimeStatus: callbackify(async () => ({
                provider: "mock",
                modelId: "mock/gpt-5.4-mini",
                mode: "mock",
                modeReason: "local mock fallback",
            })),
            getMcpThirdPartyAgreement: callbackify(async () => mcpThirdPartyAgreementAccepted),
            setMcpThirdPartyAgreement: callbackify(async (accepted: boolean) => {
                mcpThirdPartyAgreementAccepted = accepted === true;
                return true;
            }),
            getMcpServices: callbackify(async () => ({
                success: true,
                services: mcpServices,
                runtimeReady: true,
                thirdPartyAgreementAccepted: mcpThirdPartyAgreementAccepted,
            })),
        },
    } as never;
}
