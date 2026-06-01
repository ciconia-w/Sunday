import type {
    AssistantChannelLike,
    AssistantSummary,
    ConversationChannelLike,
    FileChannelLike,
    AudioChannelLike,
    ModelSummary,
    ReportChannelLike,
    ServiceConfigChannelLike,
    SessionChannelLike,
    SkillSummary,
    SkillsManagerLike,
    SystemChannelLike,
    TaskChannelLike,
    UosPiChannels,
    WindowChannelLike,
} from "./channel-types";
} from "./channel-types.ts";
import { SimpleSignal } from "./signal.ts";

export interface CreateBrowserChannelsOptions {
    sessionBridge: SessionChannelLike;
    assistants: AssistantSummary[];
    modelsByAssistant: Record<string, ModelSummary[]>;
    skills?: SkillSummary[];
    translations?: Record<string, string>;
    activeColor?: string;
    fontInfo?: string;
    themeColor?: number;
    networkStatus?: boolean;
    windowMode?: number;
}

export function createBrowserChannels(options: CreateBrowserChannelsOptions): UosPiChannels {
    const assistantOrder = options.assistants.map((assistant) => assistant.id);
    const enabledSkills = new Map((options.skills ?? []).map((skill) => [skill.name, { ...skill }]));
    const currentModelByAssistant = new Map<string, string>();

    for (const [assistantId, models] of Object.entries(options.modelsByAssistant)) {
        currentModelByAssistant.set(assistantId, models[0]?.id ?? "");
    }

    const assistObj: AssistantChannelLike = {
        assistantChanged: new SimpleSignal(),
        modelListChanged: new SimpleSignal(),
        getAssistantList: () => options.assistants,
        getModelList: (assistantId) => options.modelsByAssistant[assistantId] ?? [],
        getCurrentModel: (assistantId) => currentModelByAssistant.get(assistantId) ?? "",
        setCurrentModel: (modelId, assistantId) => {
            currentModelByAssistant.set(assistantId, modelId);
            assistObj.modelListChanged.emit();
            return true;
        },
        getAssistantOrder: () => assistantOrder,
        setAssistantOrder: (order) => {
            assistantOrder.splice(0, assistantOrder.length, ...order);
        },
        getAssistantVisibleCount: () => Math.min(4, options.assistants.length || 1),
        setAssistantVisibleCount: () => {},
    };

    const conversationObj: ConversationChannelLike = {
        changeToConversation: new SimpleSignal(),
        indexSearchChanged: new SimpleSignal(),
        getConversation: () => null,
        getConversationIndexes: () => "[]",
        getHistoryConversationIndexes: () => "[]",
        deleteConversation: () => {},
        releaseConversation: () => {},
        searchConversations: () => {},
    };

    const windowObj: WindowChannelLike = {
        windowFontChanged: new SimpleSignal(),
        windowModeChanged: new SimpleSignal(),
        windowShown: new SimpleSignal(),
        windowAppendPrompt: new SimpleSignal(),
        windowOverrideQuestion: new SimpleSignal(),
        windowChangeToDigitalMode: new SimpleSignal(),
        toastRequested: new SimpleSignal(),
        windowMode: () => options.windowMode ?? 0,
        switchMode: (mode) => {
            windowObj.windowModeChanged.emit(mode);
        },
        isMainWindowActive: () => true,
        showConfig: () => {},
        showHelpWindow: () => {},
        showAboutWindow: () => {},
    };

    const systemObj: SystemChannelLike = {
        activeColor: options.activeColor ?? "#0081ff",
        fontInfo: options.fontInfo ?? "Noto Sans#14",
        themeColor: options.themeColor ?? 1,
        networkStatus: options.networkStatus ?? true,
        activeColorChanged: new SimpleSignal(),
        networkChanged: new SimpleSignal(),
        themeColorChanged: new SimpleSignal(),
        themeIconChanged: new SimpleSignal(),
        notificationActionInvoked: new SimpleSignal(),
        appUpdateAvailable: new SimpleSignal(),
        loadTranslations: () => options.translations ?? {},
        checkChineseLanguage: () => true,
        isEnableAdvancedCssFeatures: () => true,
        openUrl: (url) => {
            window.open(url, "_blank", "noopener,noreferrer");
        },
        copyToClipboard: async (data) => {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                await navigator.clipboard.writeText(data);
            }
        },
        closeNotification: () => {},
        checkAppUpdate: () => {},
        markAppUpdateReminderConsumed: () => {},
    };

    const fileObj: FileChannelLike = {
        fileEvent: new SimpleSignal(),
        validateIncomingPaths: (params) => params,
        handleDroppedFiles: () => {},
        handleCopiedFiles: () => {},
        handleScreenshotFile: () => {},
        parseFile: () => {},
        removeFile: () => {},
        isFileExist: () => true,
        getFileIconBase64: () => "",
    };

    const audioObj: AudioChannelLike = {
        audioEvent: new SimpleSignal(),
        startRecorder: () => false,
        stopRecorder: () => false,
        playTextAudio: () => false,
        stopPlayTextAudio: () => false,
        getDeviceStatus: () => JSON.stringify({ hasInputDevice: false, hasOutputDevice: false }),
    };

    const taskObj: TaskChannelLike = {
        taskAdded: new SimpleSignal(),
        onWindowCreated: () => {},
    };

    const skillsMgr: SkillsManagerLike = {
        skillsData: () => [...enabledSkills.values()],
        reloadSkills: () => {},
        setSkillEnabled: (skillName, enabled) => {
            const skill = enabledSkills.get(skillName);
            if (!skill) {
                return false;
            }
            skill.enabled = enabled;
            return true;
        },
        hasSkill: (skillName) => enabledSkills.has(skillName),
    };

    const reportObj: ReportChannelLike = {
        writeReportEvent: (jsonData) => {
            console.debug("[uosai-pi-mvp] report", jsonData);
        },
    };

    const serviceConfigObj: ServiceConfigChannelLike = {
        knowledgeBaseChanged: new SimpleSignal(),
        embeddingPluginsChanged: new SimpleSignal(),
        mcpPluginChanged: new SimpleSignal(),
        checkKnowledgeBase: () => false,
        checkEmbeddingPlugins: () => false,
        isMcpRuntimeReady: () => false,
    };

    return {
        sessObj: options.sessionBridge,
        assistObj,
        conversationObj,
        windowObj,
        systemObj,
        fileObj,
        audioObj,
        taskObj,
        skillsMgr,
        reportObj,
        serviceConfigObj,
    };
}
