import type { SignalLike } from "./signal.ts";

export enum UosSessionEvent {
    SeUnknown = 0,
    SeStarted = 1,
    SeFinished = 2,
    SeError = 3,
    SeMessage = 4,
}

export interface AssistantSummary {
    id: string;
    name: string;
    description: string;
    placeHolder?: string;
    icons?: Record<string, string>;
    gradientColors?: string[];
    path?: string;
}

export interface ModelSummary {
    id: string;
    name: string;
    provider: string;
    ability: number;
    network: "online" | "local" | string;
    icon?: string;
}

export interface SkillSummary {
    name: string;
    description: string;
    path: string;
    source: string;
    enabled: boolean;
}

export interface SessionChannelLike {
    sessionEvent: SignalLike<[UosSessionEvent, string, string]>;
    sendMessage(params: string): Promise<void> | void;
    retry(params: string): Promise<void> | void;
    cancel(params: string): Promise<void> | void;
    invokeAction(sessionId: string, json: string): Promise<void> | void;
}

export interface AssistantChannelLike {
    assistantChanged: SignalLike<[]>;
    modelListChanged: SignalLike<[]>;
    getAssistantList(): Promise<AssistantSummary[]> | AssistantSummary[];
    getModelList(assistantId: string): Promise<ModelSummary[]> | ModelSummary[];
    getCurrentModel(assistantId: string): Promise<string> | string;
    setCurrentModel(modelId: string, assistantId: string): Promise<boolean> | boolean;
    getAssistantOrder(): Promise<string[]> | string[];
    setAssistantOrder(order: string[]): Promise<void> | void;
    getAssistantVisibleCount(): Promise<number> | number;
    setAssistantVisibleCount(count: number): Promise<void> | void;
}

export interface ConversationChannelLike {
    changeToConversation: SignalLike<[string, string]>;
    indexSearchChanged: SignalLike<[]>;
    getConversation(id: string): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
    getConversationIndexes(): Promise<string> | string;
    getHistoryConversationIndexes(): Promise<string> | string;
    deleteConversation(ids: string[]): Promise<void> | void;
    releaseConversation(ids: string[]): Promise<void> | void;
    searchConversations(keyword: string): Promise<void> | void;
}

export interface WindowChannelLike {
    windowFontChanged: SignalLike<[string]>;
    windowModeChanged: SignalLike<[number]>;
    windowShown: SignalLike<[]>;
    windowAppendPrompt: SignalLike<[string, boolean]>;
    windowOverrideQuestion: SignalLike<[string]>;
    windowChangeToDigitalMode: SignalLike<[]>;
    toastRequested: SignalLike<[string, string]>;
    windowMode(): Promise<number> | number;
    switchMode(mode: number): Promise<void> | void;
    isMainWindowActive(): Promise<boolean> | boolean;
    showConfig(page: number): Promise<void> | void;
    showHelpWindow(): Promise<void> | void;
    showAboutWindow(): Promise<void> | void;
}

export interface SystemChannelLike {
    activeColor: string;
    fontInfo: string;
    themeColor: number;
    networkStatus: boolean;
    activeColorChanged: SignalLike<[string]>;
    networkChanged: SignalLike<[boolean]>;
    themeColorChanged: SignalLike<[number]>;
    themeIconChanged: SignalLike<[]>;
    notificationActionInvoked: SignalLike<[number, string]>;
    appUpdateAvailable: SignalLike<[Record<string, unknown>]>;
    loadTranslations(): Promise<Record<string, string>> | Record<string, string>;
    checkChineseLanguage(): Promise<boolean> | boolean;
    isEnableAdvancedCssFeatures(): Promise<boolean> | boolean;
    openUrl(url: string): Promise<void> | void;
    copyToClipboard(data: string, type: number): Promise<void> | void;
    closeNotification(notificationId: number): Promise<void> | void;
    checkAppUpdate(): Promise<void> | void;
    markAppUpdateReminderConsumed(version: string): Promise<void> | void;
}

export interface FileChannelLike {
    fileEvent: SignalLike<[number, string, string]>;
    validateIncomingPaths(params: string): Promise<string> | string;
    handleDroppedFiles(params: string): Promise<void> | void;
    handleCopiedFiles(params: string): Promise<void> | void;
    handleScreenshotFile(params: string): Promise<void> | void;
    parseFile(id: string, filePath: string): Promise<void> | void;
    removeFile(filePath: string): Promise<void> | void;
    isFileExist(filePath: string): Promise<boolean> | boolean;
    getFileIconBase64(filePath: string, width?: number, height?: number): Promise<string> | string;
}

export interface AudioChannelLike {
    audioEvent: SignalLike<[number, string, string]>;
    startRecorder(params: string): Promise<boolean> | boolean;
    stopRecorder(params: string): Promise<boolean> | boolean;
    playTextAudio(params: string): Promise<boolean> | boolean;
    stopPlayTextAudio(params: string): Promise<boolean> | boolean;
    getDeviceStatus(params: string): Promise<string> | string;
}

export interface TaskChannelLike {
    taskAdded: SignalLike<[number]>;
    onWindowCreated(): Promise<void> | void;
}

export interface SkillsManagerLike {
    skillsData(): Promise<SkillSummary[]> | SkillSummary[];
    reloadSkills(): Promise<void> | void;
    setSkillEnabled(skillName: string, enabled: boolean): Promise<boolean> | boolean;
    hasSkill(skillName: string): Promise<boolean> | boolean;
}

export interface ReportChannelLike {
    writeReportEvent(jsonData: string): Promise<void> | void;
}

export interface ServiceConfigChannelLike {
    knowledgeBaseChanged: SignalLike<[boolean]>;
    embeddingPluginsChanged: SignalLike<[boolean]>;
    mcpPluginChanged: SignalLike<[boolean]>;
    checkKnowledgeBase(): Promise<boolean> | boolean;
    checkEmbeddingPlugins(): Promise<boolean> | boolean;
    isMcpRuntimeReady(): Promise<boolean> | boolean;
}

export interface UosPiChannels {
    sessObj: SessionChannelLike;
    assistObj: AssistantChannelLike;
    conversationObj: ConversationChannelLike;
    windowObj: WindowChannelLike;
    systemObj: SystemChannelLike;
    fileObj: FileChannelLike;
    audioObj: AudioChannelLike;
    taskObj: TaskChannelLike;
    skillsMgr: SkillsManagerLike;
    reportObj: ReportChannelLike;
    serviceConfigObj: ServiceConfigChannelLike;
}

declare global {
    interface Window {
        __UOS_PI_CHANNELS__?: UosPiChannels;
    }
}
