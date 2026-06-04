import { AssistantID, type Assistant } from "./types/assistant";
import { ModelAbility, type Model } from "./types/model";
import type { McpService } from "./types/mcp-service";
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

type MockMcpServerConfig = {
    command?: unknown;
    url?: unknown;
};

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
    const mockFilesystemToolPreview = [
        "read_file",
        "read_text_file",
        "read_multiple_files",
        "write_file",
        "edit_file",
        "list_directory",
    ];
    let mcpServices: McpService[] = [
        {
            id: "filesystem",
            name: "Filesystem",
            description: "Local filesystem access for the agent runtime.",
            category: "systemBuiltIn",
            enabled: true,
            isBuiltIn: true,
            editable: false,
            removable: false,
            runtimeStatus: "ready",
            runtimeStatusText: "已就绪",
            runtimeDetail: "内置文件系统服务已就绪，可直接访问本地文件。",
            transportKind: "builtin",
            toolPreview: mockFilesystemToolPreview.map((name) => ({ name, description: "" })),
            toolCount: 14,
        },
    ];
    let mockIngressBackgroundReplayPaused = false;
    let mockIngressBackgroundReplayPauseReason = "";
    let mockIngressBackgroundReplayPausedAt = "";
    let mockIngressBackgroundReplayUpdatedAt = "";
    const buildMockIngressOperatorState = (includeResolved = false) => {
        const routes = [
            {
                routeKey: "slack:alerts:thread-001",
                source: "slack",
                channelId: "alerts",
                threadId: "thread-001",
                conversationId: "ext-conv-slack-alerts-thread-001",
                sessionId: "ext-sess-slack-alerts-thread-001",
                replyTarget: {
                    transport: "slack-webhook",
                    url: "https://hooks.slack.com/services/demo/demo/demo",
                    hasSecret: false,
                    headerKeys: [],
                },
                updatedAt: "2026-06-04T13:30:00.000Z",
            },
        ];
        const replayEntries = [
            {
                id: "demo-replay-pending",
                status: "awaiting-operator",
                transport: "slack-webhook",
                routeKey: "slack:alerts:thread-001",
                conversationId: "ext-conv-slack-alerts-thread-001",
                sessionId: "ext-sess-slack-alerts-thread-001",
                requestExternalMessageId: "ext-msg-demo-1",
                replyTarget: {
                    transport: "slack-webhook",
                    url: "https://hooks.slack.com/services/demo/demo/demo",
                    hasSecret: false,
                    headerKeys: [],
                },
                payloadSummary: {
                    ok: false,
                    assistantTextPreview: "",
                    errorPreview: "Sunday 处理失败：demo webhook timeout",
                },
                attemptCount: 3,
                replayCount: 1,
                automaticReplayCount: 3,
                latestError: "demo webhook timeout",
                createdAt: "2026-06-04T13:20:00.000Z",
                updatedAt: "2026-06-04T13:25:00.000Z",
                deliveredAt: "",
                resolvedAt: "",
                nextAttemptAt: "",
                lastAttemptAt: "2026-06-04T13:25:00.000Z",
                history: [
                    {
                        kind: "delivery-failed",
                        mode: "initial",
                        at: "2026-06-04T13:20:00.000Z",
                        attemptCount: 3,
                        totalAttemptCount: 3,
                        status: "awaiting-operator",
                        error: "demo webhook timeout",
                    },
                    {
                        kind: "replay-failed",
                        mode: "manual",
                        at: "2026-06-04T13:25:00.000Z",
                        attemptCount: 1,
                        totalAttemptCount: 4,
                        status: "awaiting-operator",
                        error: "demo webhook timeout",
                    },
                ],
            },
            {
                id: "demo-replay-resolved",
                status: "resolved",
                transport: "webhook",
                routeKey: "webhook:ops:thread-009",
                conversationId: "ext-conv-webhook-ops-thread-009",
                sessionId: "ext-sess-webhook-ops-thread-009",
                requestExternalMessageId: "ext-msg-demo-2",
                replyTarget: {
                    transport: "webhook",
                    url: "https://example.com/reply",
                    hasSecret: false,
                    headerKeys: ["x-demo-token"],
                },
                payloadSummary: {
                    ok: true,
                    assistantTextPreview: "已完成处理",
                    errorPreview: "",
                },
                attemptCount: 2,
                replayCount: 1,
                automaticReplayCount: 0,
                latestError: "",
                createdAt: "2026-06-04T11:20:00.000Z",
                updatedAt: "2026-06-04T11:30:00.000Z",
                deliveredAt: "2026-06-04T11:25:00.000Z",
                resolvedAt: "2026-06-04T11:30:00.000Z",
                nextAttemptAt: "",
                lastAttemptAt: "2026-06-04T11:25:00.000Z",
                history: [
                    {
                        kind: "delivery-failed",
                        mode: "initial",
                        at: "2026-06-04T11:20:00.000Z",
                        attemptCount: 2,
                        totalAttemptCount: 2,
                        status: "pending",
                        error: "temporary upstream 500",
                    },
                    {
                        kind: "replay-succeeded",
                        mode: "manual",
                        at: "2026-06-04T11:25:00.000Z",
                        attemptCount: 1,
                        totalAttemptCount: 3,
                        status: "delivered",
                        error: "",
                    },
                    {
                        kind: "resolved",
                        mode: "operator",
                        at: "2026-06-04T11:30:00.000Z",
                        attemptCount: 0,
                        totalAttemptCount: 3,
                        status: "resolved",
                        error: "",
                    },
                ],
            },
        ];
        const visibleReplayEntries = includeResolved
            ? replayEntries
            : replayEntries.filter((entry) => !["resolved", "discarded"].includes(entry.status));
        const counts = {
            total: visibleReplayEntries.length,
            pending: visibleReplayEntries.filter((entry) => entry.status === "pending").length,
            delivered: visibleReplayEntries.filter((entry) => entry.status === "delivered").length,
            awaitingOperator: visibleReplayEntries.filter((entry) => entry.status === "awaiting-operator").length,
            resolved: visibleReplayEntries.filter((entry) => entry.status === "resolved").length,
            discarded: visibleReplayEntries.filter((entry) => entry.status === "discarded").length,
        };

        return {
            routes,
            replayQueue: {
                worker: {
                    enabled: true,
                    pollMs: 5000,
                    delaysMs: [30000, 120000, 300000],
                    paused: mockIngressBackgroundReplayPaused,
                    pauseReason: mockIngressBackgroundReplayPauseReason,
                    pausedAt: mockIngressBackgroundReplayPausedAt,
                },
                counts,
                entries: visibleReplayEntries,
            },
            supportedReplyTransports: ["webhook", "lark-bot-webhook", "dingtalk-bot-webhook", "slack-webhook", "discord-webhook", "teams-webhook"],
            replyRetryPolicy: {
                maxAttempts: 3,
                delaysMs: [1000, 3000],
            },
            backgroundReplay: {
                enabled: true,
                pollMs: 5000,
                delaysMs: [30000, 120000, 300000],
                mode: "in-process",
                hasDedicatedReplayService: false,
                deliveryPolicy: {
                    strategy: "fixed",
                    delaysMs: [30000, 120000, 300000],
                    maxAutomaticAttempts: 3,
                    initialDelayMs: 30000,
                    maxDelayMs: 300000,
                    multiplier: 1,
                },
                serviceStatus: {
                    enabled: false,
                    running: false,
                    pid: 0,
                    restartCount: 0,
                    startedAt: "",
                    lastHeartbeatAt: "",
                    lastRunAt: "",
                    lastError: "",
                    manager: "none",
                    managedBySidecar: false,
                },
                control: {
                    paused: mockIngressBackgroundReplayPaused,
                    pauseReason: mockIngressBackgroundReplayPauseReason,
                    pausedAt: mockIngressBackgroundReplayPausedAt,
                    updatedAt: mockIngressBackgroundReplayUpdatedAt,
                },
            },
            runtimeNote: mockIngressBackgroundReplayPaused
                ? "当前 automatic replay 已被 operator 暂停；手动重试和 resolve 仍可继续使用。"
                : "当前 background replay worker 仍运行在 sidecar 进程内；更强的 delivery reliability 仍需要 dedicated replay service。",
        };
    };

    function clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }

    function parseMcpServiceDraft(jsonConfig: string, description: string): McpService {
        const parsed = JSON.parse(jsonConfig);
        const servers = parsed?.mcpServers;

        if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
            throw new Error("JSON 配置缺少 mcpServers 对象。");
        }

        const entries = Object.entries(servers);
        if (entries.length !== 1) {
            throw new Error("当前仅支持每次保存一个 MCP 服务配置。");
        }

        const [serviceId, serviceConfig] = entries[0];
        const normalizedId = serviceId.trim();
        const typedConfig = (serviceConfig && typeof serviceConfig === "object"
            ? serviceConfig
            : {}) as MockMcpServerConfig;

        if (!normalizedId) {
            throw new Error("MCP 服务 ID 不能为空。");
        }

        const normalizedConfig = JSON.stringify(parsed, null, 2);
        const inferredDescription =
            typeof typedConfig.command === "string" && typedConfig.command.trim()
                ? `Command: ${typedConfig.command.trim()}`
                : "Custom MCP service configuration.";

        return {
            id: normalizedId,
            name: normalizedId,
            description: description.trim() || inferredDescription,
            category: "custom",
            enabled: true,
            isBuiltIn: false,
            editable: true,
            removable: true,
            jsonConfig: normalizedConfig,
        };
    }

    function getMockMcpRuntimeShape(service: McpService) {
        if (service.isBuiltIn === true) {
            const enabled = service.enabled !== false;
            return {
                runtimeStatus: enabled ? "ready" : "disabled",
                runtimeStatusText: enabled ? "已就绪" : "已停用",
                runtimeDetail: enabled ? "内置文件系统服务已就绪，可直接访问本地文件。" : "启用后可恢复本地文件访问能力。",
                transportKind: "builtin",
                toolPreview: mockFilesystemToolPreview.map((name) => ({ name, description: "" })),
                toolCount: 14,
            };
        }

        const enabled = service.enabled === true;
        if (!enabled) {
            return {
                runtimeStatus: "disabled",
                runtimeStatusText: "已停用",
                runtimeDetail: "启用后才会参与运行时检测。",
                transportKind: "stdio",
                toolPreview: [],
                toolCount: 0,
            };
        }

        try {
            const parsed = JSON.parse(String(service.jsonConfig ?? ""));
            const servers = parsed?.mcpServers;
            const entries = servers && typeof servers === "object" && !Array.isArray(servers)
                ? Object.entries(servers)
                : [];
            const serviceConfig = (entries[0]?.[1] && typeof entries[0][1] === "object"
                ? entries[0][1]
                : {}) as MockMcpServerConfig;

            if (typeof serviceConfig?.command === "string" && serviceConfig.command.trim()) {
                const command = serviceConfig.command.trim();
                if (command === "definitely-missing-mcp-binary") {
                    return {
                        runtimeStatus: "error",
                        runtimeStatusText: "命令不存在",
                        runtimeDetail: "spawn definitely-missing-mcp-binary ENOENT",
                        transportKind: "stdio",
                        toolPreview: [],
                        toolCount: 0,
                    };
                }

                return {
                    runtimeStatus: "ready",
                    runtimeStatusText: "已就绪",
                    runtimeDetail: "通过 stdio 检出 14 个工具。",
                    transportKind: "stdio",
                    toolPreview: mockFilesystemToolPreview.map((name) => ({ name, description: "" })),
                    toolCount: 14,
                };
            }

            if (typeof serviceConfig?.url === "string" && serviceConfig.url.trim()) {
                return {
                    runtimeStatus: "error",
                    runtimeStatusText: "暂不支持",
                    runtimeDetail: "当前仅支持 stdio 类型的 MCP 服务运行时检测。",
                    transportKind: "url",
                    toolPreview: [],
                    toolCount: 0,
                };
            }
        } catch (error) {
            return {
                runtimeStatus: "error",
                runtimeStatusText: "配置错误",
                runtimeDetail: error instanceof Error ? error.message : "JSON 配置格式不合法，请检查后重试。",
                transportKind: "unknown",
                toolPreview: [],
                toolCount: 0,
            };
        }

        return {
            runtimeStatus: "connecting",
            runtimeStatusText: "待检测",
            runtimeDetail: "点击“刷新状态”后将尝试启动服务并读取工具列表。",
            transportKind: "unknown",
            toolPreview: [],
            toolCount: 0,
        };
    }

    function buildMockMcpServicesResponse() {
        return {
            success: true,
            services: clone(mcpServices).map((service) => ({
                ...service,
                ...getMockMcpRuntimeShape(service),
            })),
            runtimeReady: true,
            thirdPartyAgreementAccepted: mcpThirdPartyAgreementAccepted,
        };
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
            getSkillsSourceOfTruth: callbackify(async () => ({
                managedRootDir: "/home/demo/.codex/skills",
                builtinRootDir: "/home/demo/.codex/skills/.system",
                repoSkillsDir: "/workspace/project/skills",
                sourceDocPath: "/workspace/project/docs/skills-source-of-truth.md",
            })),
            addSkillForWeb: callbackify(async () => ({
                success: false,
                error: "当前模式不支持导入技能，请在桌面宿主中操作。",
            })),
            addGithubSkillForWeb: callbackify(async () => ({
                success: false,
                error: "当前模式不支持 GitHub 技能导入，请在桌面宿主中操作。",
            })),
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
            getCliToolsState: callbackify(async () => ([
                {
                    id: "gh-cli",
                    name: "gh cli",
                    description: "GitHub CLI，管理仓库、PR、Issue。",
                    enabled: true,
                    statusToken: "authorized",
                    statusText: "已授权，demo",
                    statusTone: "success",
                    detailText: "版本 2.55.0\n最新版本 2.93.0\n/usr/bin/gh\n检测到新版本，建议按安装文档中的方式升级。",
                    latestVersion: "2.93.0",
                    updateAvailable: true,
                    actionText: "打开升级文档",
                    actionDisabled: false,
                    actionKind: "open-url",
                    actionPayload: "https://cli.github.com/manual/installation",
                    actionCommand: "",
                },
                {
                    id: "opencli",
                    name: "opencli",
                    description: "网页到命令行的桥接工具。",
                    enabled: false,
                    statusToken: "extension_disconnected",
                    statusText: "守护进程已运行，插件未连接",
                    statusTone: "warning",
                    detailText: "版本 1.8.0\n最新版本 1.8.2\n/usr/local/bin/opencli\n建议先检查浏览器设置页中的插件连接状态。\n检测到新版本，可在恢复连接后复制更新命令升级。",
                    latestVersion: "1.8.2",
                    updateAvailable: true,
                    actionText: "诊断",
                    actionDisabled: false,
                    actionKind: "run-command",
                    actionPayload: "opencli doctor",
                    actionCommand: "opencli doctor",
                },
                {
                    id: "lark-cli",
                    name: "lark cli",
                    description: "飞书 CLI，文档、消息、表格。",
                    enabled: false,
                    statusToken: "expired",
                    statusText: "授权已过期，Demo",
                    statusTone: "warning",
                    detailText: "版本 0.9.0\n最新版本 1.0.47\n/usr/local/bin/lark-cli\n检测到新版本，建议登录恢复后尽快升级。",
                    latestVersion: "1.0.47",
                    updateAvailable: true,
                    actionText: "重新登录",
                    actionDisabled: false,
                    actionKind: "run-command",
                    actionPayload: "lark-cli auth login --no-wait --json --domain all",
                    actionCommand: "lark-cli auth login --no-wait --json --domain all",
                },
            ])),
            getBrowserControlState: callbackify(async () => ({
                enabled: false,
                daemonRunning: false,
                extensionConnected: false,
                daemonLabel: "未运行",
                extensionLabel: "未连接",
                version: "",
                statusSummary: "浏览器控制已关闭",
                extensionPath: "",
                outputDir: "",
                sessionName: "sunday",
                repoRoot: "",
                stableTabSwitch: true,
                stableScreenshotCapture: true,
                runtimeLimitNotice: "",
                knownIssues: [],
                tabSwitchCapabilityDescription: "当前运行时支持稳定的标签页切换。",
                screenshotCapabilityDescription: "当前运行时支持稳定的整页截图。",
                screenshotGuidance: "建议先刷新状态并确认插件连接正常；如果仍失败，优先使用页面提取继续完成当前任务。",
                screenshotActionLabel: "整页截图",
            })),
            setBrowserControlEnabled: callbackify(async (enabled: boolean) => ({ enabled })),
            getBrowserPanelState: callbackify(async () => ({
                enabled: false,
                daemonRunning: false,
                extensionConnected: false,
                daemonLabel: "未运行",
                extensionLabel: "未连接",
                version: "",
                statusSummary: "浏览器控制已关闭",
                extensionPath: "",
                outputDir: "",
                sessionName: "sunday",
                repoRoot: "",
                stableTabSwitch: true,
                stableScreenshotCapture: true,
                runtimeLimitNotice: "",
                knownIssues: [],
                tabSwitchCapabilityDescription: "当前运行时支持稳定的标签页切换。",
                screenshotCapabilityDescription: "当前运行时支持稳定的整页截图。",
                screenshotGuidance: "建议先刷新状态并确认插件连接正常；如果仍失败，优先使用页面提取继续完成当前任务。",
                screenshotActionLabel: "整页截图",
                url: "",
                title: "",
                interactive: 0,
                tabs: [],
            })),
            startBrowserSessionIfEnabled: callbackify(async () => ({
                enabled: false,
                started: false,
                reason: "disabled",
            })),
            initBrowserSession: callbackify(async () => undefined),
            browserOpenUrl: callbackify(async () => ({
                ok: false,
                message: "",
                error: "浏览器控制未启用（mock）",
            })),
            browserNewTab: callbackify(async () => ({
                ok: false,
                message: "",
                error: "浏览器控制未启用（mock）",
            })),
            browserSelectTab: callbackify(async () => ({
                ok: false,
                message: "",
                error: "浏览器控制未启用（mock）",
            })),
            browserExtractPage: callbackify(async () => ({
                ok: false,
                content: "",
                error: "浏览器控制未启用（mock）",
            })),
            browserCaptureScreenshot: callbackify(async () => ({
                ok: false,
                screenshotPath: "",
                error: "浏览器控制未启用（mock）",
                errorKind: "unavailable",
                errorHint: "浏览器控制未启用（mock）",
            })),
            getIngressOperatorState: callbackify(async (includeResolved: boolean = false) =>
                buildMockIngressOperatorState(includeResolved),
            ),
            replayIngressQueueEntry: callbackify(async (id: string) => {
                const matchedEntry = buildMockIngressOperatorState(true).replayQueue.entries.find((entry) => entry.id === id);
                return {
                    ok: true,
                    automatic: false,
                    attemptCount: 1,
                    error: "",
                    entry: {
                        ...(matchedEntry || {}),
                        id,
                        status: "delivered",
                        latestError: "",
                        deliveredAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        history: [
                            ...(((matchedEntry || {}).history ?? []) as unknown[]),
                            {
                                kind: "replay-succeeded",
                                mode: "manual",
                                at: new Date().toISOString(),
                                attemptCount: 1,
                                totalAttemptCount: Number((matchedEntry as { attemptCount?: number } | undefined)?.attemptCount ?? 0) + 1,
                                status: "delivered",
                                error: "",
                            },
                        ],
                    },
                };
            }),
            pauseIngressBackgroundReplay: callbackify(async (reason: string) => {
                const now = new Date().toISOString();
                mockIngressBackgroundReplayPaused = true;
                mockIngressBackgroundReplayPauseReason = typeof reason === "string" ? reason.trim() : "";
                mockIngressBackgroundReplayPausedAt = mockIngressBackgroundReplayPausedAt || now;
                mockIngressBackgroundReplayUpdatedAt = now;
                return {
                    paused: true,
                    pauseReason: mockIngressBackgroundReplayPauseReason,
                    pausedAt: mockIngressBackgroundReplayPausedAt,
                    updatedAt: mockIngressBackgroundReplayUpdatedAt,
                };
            }),
            resumeIngressBackgroundReplay: callbackify(async () => {
                mockIngressBackgroundReplayPaused = false;
                mockIngressBackgroundReplayPauseReason = "";
                mockIngressBackgroundReplayPausedAt = "";
                mockIngressBackgroundReplayUpdatedAt = new Date().toISOString();
                return {
                    paused: false,
                    pauseReason: "",
                    pausedAt: "",
                    updatedAt: mockIngressBackgroundReplayUpdatedAt,
                };
            }),
            resolveIngressQueueEntry: callbackify(async (id: string, resolution: string) => ({
                id,
                status: resolution || "resolved",
                updatedAt: new Date().toISOString(),
                resolvedAt: new Date().toISOString(),
                history: [
                    {
                        kind: resolution || "resolved",
                        mode: "operator",
                        at: new Date().toISOString(),
                        attemptCount: 0,
                        totalAttemptCount: 0,
                        status: resolution || "resolved",
                        error: "",
                    },
                ],
            })),
            getMcpThirdPartyAgreement: callbackify(async () => mcpThirdPartyAgreementAccepted),
            setMcpThirdPartyAgreement: callbackify(async (accepted: boolean) => {
                mcpThirdPartyAgreementAccepted = accepted === true;
                return true;
            }),
            getMcpServices: callbackify(async () => ({
                ...buildMockMcpServicesResponse(),
            })),
            refreshMcpRuntime: callbackify(async () => ({
                ...buildMockMcpServicesResponse(),
            })),
            setMcpServiceEnabled: callbackify(async (serviceId: string, enabled: boolean) => {
                const targetService = mcpServices.find((service) => service.id === serviceId);

                if (!targetService) {
                    throw new Error("MCP 服务不存在。");
                }

                targetService.enabled = enabled === true;
                return buildMockMcpServicesResponse();
            }),
            saveMcpService: callbackify(async (jsonConfig: string, description: string, serviceId = "") => {
                const nextService = parseMcpServiceDraft(jsonConfig, description);
                const duplicateService = mcpServices.find((service) => service.id === nextService.id);

                if (!serviceId) {
                    if (duplicateService) {
                        throw new Error(`MCP 服务 "${nextService.id}" 已存在。`);
                    }

                    mcpServices.push(nextService);
                } else {
                    const targetIndex = mcpServices.findIndex((service) => service.id === serviceId && !service.isBuiltIn);

                    if (targetIndex < 0) {
                        throw new Error("只能编辑自定义 MCP 服务。");
                    }

                    if (duplicateService && duplicateService.id !== serviceId) {
                        throw new Error(`MCP 服务 "${nextService.id}" 已存在。`);
                    }

                    nextService.enabled = mcpServices[targetIndex].enabled;
                    mcpServices.splice(targetIndex, 1, nextService);
                }

                return buildMockMcpServicesResponse();
            }),
            deleteMcpService: callbackify(async (serviceId: string) => {
                const nextServices = mcpServices.filter((service) => service.id !== serviceId || service.isBuiltIn);

                if (nextServices.length === mcpServices.length) {
                    throw new Error("只能删除自定义 MCP 服务。");
                }

                mcpServices = nextServices;
                return buildMockMcpServicesResponse();
            }),
        },
    } as never;
}
