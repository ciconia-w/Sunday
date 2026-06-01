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
                console.error("[remote channels] callbackified call failed", error);
                callback?.(undefined);
            });
    };
}

type RemoteRuntimeState = {
    assistants?: Array<Record<string, unknown>>;
    modelsByAssistant?: Record<string, Array<Record<string, unknown>>>;
    currentModelId?: string;
    system?: {
        activeColor?: string;
        fontInfo?: string;
        themeColor?: number;
        networkStatus?: boolean;
        translations?: Record<string, string>;
    };
};

export async function createRemoteInjectedChannels(baseUrl = "") {
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

    const state: RemoteRuntimeState = {
        assistants: [
            {
                id: "uos-ai-generic",
                name: "Sunday",
                description: "Remote state unavailable",
                icon: { line: "uos-ai", color: "uos-ai-color" },
                gradient_colors: ["#6448FF", "#FF37DF", "#FCA506"],
                path: "icons/",
                place_holder: "让 Sunday 帮你处理文件、调用工具或执行任务...",
                envExists: true,
            },
        ],
        modelsByAssistant: {
            "uos-ai-generic": [
                {
                    id: "remote/unknown",
                    name: "unknown",
                    icon: "",
                    network: "online",
                    provider: "remote",
                    ability: 5,
                },
            ],
        },
        currentModelId: "remote/unknown",
        system: {
            activeColor: "#0081ff",
            fontInfo: "Noto Sans#14",
            themeColor: 1,
            networkStatus: true,
            translations: {},
        },
    };

    try {
        const stateUrl = new URL(`${baseUrl}/state`);
        const startupAssistant = new URL(window.location.href).searchParams.get("assistant");
        if (startupAssistant) {
            stateUrl.searchParams.set("assistant", startupAssistant);
        }
        const stateRes = await fetch(stateUrl.toString());
        const remoteState = (await stateRes.json()) as RemoteRuntimeState;
        if (remoteState && typeof remoteState === "object") {
            Object.assign(state, remoteState);
        }
    } catch (error) {
        console.warn("[remote channels] failed to fetch /state, using fallback state", error);
    }

    const eventSource = new EventSource(`${baseUrl}/events`);
    eventSource.addEventListener("session", (event) => {
        const payload = JSON.parse(event.data) as {
            event: number;
            sessionId: string;
            message: string;
        };
        sessionEvent.emit(payload.event, payload.sessionId, payload.message);
    });

    async function post(path: string, body: unknown) {
        const res = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
        });
        return res.json();
    }

    async function postConversation<T>(path: string, body: unknown, fallback: T): Promise<T> {
        try {
            const result = await post(path, body);
            return (result?.result ?? fallback) as T;
        } catch (error) {
            console.warn(`[remote channels] conversation call failed for ${path}`, error);
            return fallback;
        }
    }

    async function postServiceConfig<T>(path: string, body: unknown, fallback: T): Promise<T> {
        try {
            const result = await post(path, body);
            return (result?.result ?? fallback) as T;
        } catch (error) {
            console.warn(`[remote channels] service-config call failed for ${path}`, error);
            return fallback;
        }
    }

    return {
        sessObj: {
            sessionEvent,
            sendMessage: callbackify(async (params: string) => post("/session/send", { params })),
            retry: callbackify(async (params: string) => post("/session/retry", { params })),
            cancel: callbackify(async (params: string) => post("/session/cancel", { params })),
            invokeAction: callbackify(async (sessionId: string, json: string) =>
                post("/session/action", { sessionId, json }),
            ),
        },
        assistObj: {
            assistantChanged,
            modelListChanged,
            getAssistantList: callbackify(async () => state.assistants ?? []),
            getModelList: callbackify(async (assistantId: string) => state.modelsByAssistant?.[assistantId] ?? []),
            getCurrentModel: callbackify(async () => state.currentModelId ?? ""),
            setCurrentModel: callbackify(async (modelId: string, assistantId: string) => {
                const success = await postConversation(
                    "/assistant/set-current-model",
                    { modelId, assistantId },
                    true,
                );
                if (success) {
                    state.currentModelId = modelId;
                    modelListChanged.emit();
                }
                return success;
            }),
            getAssistantOrder: callbackify(async () => (state.assistants ?? []).map((item) => item.id as string)),
            setAssistantOrder: callbackify(async () => undefined),
            getAssistantVisibleCount: callbackify(async () => Math.min(4, (state.assistants ?? []).length || 1)),
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
            getConversation: callbackify(async (id: string) => postConversation("/conversation/get", { id }, null)),
            getConversationIndexes: callbackify(async () =>
                JSON.stringify(await postConversation("/conversation/indexes", {}, [])),
            ),
            getHistoryConversationIndexes: callbackify(async () =>
                JSON.stringify(await postConversation("/conversation/history-indexes", {}, [])),
            ),
            deleteConversation: callbackify(async (ids: string[]) => {
                await postConversation("/conversation/delete", { ids }, true);
            }),
            releaseConversation: callbackify(async (ids: string[]) => {
                await postConversation("/conversation/release", { ids }, true);
            }),
            searchConversations: callbackify(async (keyword: string) => {
                await postConversation("/conversation/search", { keyword }, []);
                indexSearchChanged.emit();
            }),
            setConversationRender: callbackify(async (conversationId: string, messageId: string, renderJson: string) => {
                await postConversation(
                    "/conversation/set-render",
                    { conversationId, messageId, renderJson },
                    true,
                );
            }),
            saveConversation: callbackify(async (id: string) =>
                postConversation("/conversation/save", { id }, true),
            ),
            switchMessageNext: callbackify(async (conversationId: string, target: string, next: string) =>
                postConversation("/conversation/switch-next", { conversationId, target, next }, true),
            ),
            getWorkspaceArticle: callbackify(async (conversationId: string, articleId: string) =>
                JSON.stringify(
                    await postConversation("/conversation/get-workspace-article", { conversationId, articleId }, {}),
                ),
            ),
            updateWorkspaceArticle: callbackify(
                async (conversationId: string, articleId: string, newContent: string) =>
                    postConversation(
                        "/conversation/update-workspace-article",
                        { conversationId, articleId, newContent },
                        true,
                    ),
            ),
            getWorkspaceOutline: callbackify(async (conversationId: string, articleId: string) =>
                JSON.stringify(
                    await postConversation("/conversation/get-workspace-outline", { conversationId, articleId }, {}),
                ),
            ),
            updateWorkspaceOutline: callbackify(async (conversationId: string, outlineJson: string) => {
                await postConversation("/conversation/update-workspace-outline", { conversationId, outlineJson }, true);
            }),
            saveWorkspaceArticleToFile: callbackify(async (conversationId: string, articleId: string, format: string) =>
                postConversation(
                    "/conversation/save-workspace-article-to-file",
                    { conversationId, articleId, format },
                    true,
                ),
            ),
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
            switchMode: callbackify(async (mode: number) => windowModeChanged.emit(mode)),
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
            activeColor: state.system?.activeColor ?? "#0081ff",
            fontInfo: state.system?.fontInfo ?? "Noto Sans#14",
            themeColor: state.system?.themeColor ?? 1,
            networkStatus: state.system?.networkStatus ?? true,
            activeColorChanged,
            networkChanged,
            themeColorChanged,
            themeIconChanged,
            notificationActionInvoked,
            appUpdateAvailable,
            getIconBase64: callbackify(async () => ""),
            loadTranslations: callbackify(async () => state.system?.translations ?? {}),
            checkChineseLanguage: callbackify(async () => true),
            isEnableAdvancedCssFeatures: callbackify(async () => true),
            openUrl: callbackify(async (url: string) => window.open(url, "_blank", "noopener,noreferrer")),
            runCliCommand: callbackify(async () => ""),
            copyToClipboard: callbackify(async (data: string) => navigator.clipboard?.writeText?.(data)),
            closeNotification: callbackify(async () => undefined),
            checkAppUpdate: callbackify(async () => undefined),
            markAppUpdateReminderConsumed: callbackify(async () => undefined),
            themeColorOption: callbackify(async () => 0),
            switchThemeColor: callbackify(async (value: number) => {
                state.system = { ...(state.system ?? {}), themeColor: value };
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
            getDeviceStatus: callbackify(async () => JSON.stringify({ hasInputDevice: false, hasOutputDevice: false })),
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
                console.debug("[remote channels] report", jsonData);
            }),
        },
        serviceConfigObj: {
            knowledgeBaseChanged,
            embeddingPluginsChanged,
            mcpPluginChanged,
            checkKnowledgeBase: callbackify(async () => false),
            checkEmbeddingPlugins: callbackify(async () => false),
            isMcpRuntimeReady: callbackify(async () =>
                postServiceConfig("/service-config/is-mcp-runtime-ready", {}, false),
            ),
            getRuntimeStatus: callbackify(async () =>
                postServiceConfig("/service-config/get-runtime-status", {}, state.runtime ?? {}),
            ),
            getMcpThirdPartyAgreement: callbackify(async () =>
                postServiceConfig("/service-config/get-mcp-third-party-agreement", {}, false),
            ),
            setMcpThirdPartyAgreement: callbackify(async (accepted: boolean) =>
                postServiceConfig("/service-config/set-mcp-third-party-agreement", { accepted }, true),
            ),
            getMcpServices: callbackify(async () =>
                postServiceConfig("/service-config/get-mcp-services", {}, { success: true, services: [] }),
            ),
        },
    };
}
