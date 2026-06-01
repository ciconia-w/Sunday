export type HostWindowMode = -1 | 0 | 1 | 2;

export interface HostSignal<TArgs extends unknown[]> {
    connect(listener: (...args: TArgs) => void): void;
    disconnect(listener: (...args: TArgs) => void): void;
}

export interface WindowChannelContract {
    windowFontChanged: HostSignal<[string]>;
    windowStateChanged: HostSignal<[number]>;
    windowModeChanged: HostSignal<[number]>;
    windowShown: HostSignal<[]>;
    windowAppendPrompt: HostSignal<[string, boolean]>;
    windowOverrideQuestion: HostSignal<[string]>;
    windowChangeToDigitalMode: HostSignal<[]>;
    toastRequested: HostSignal<[string, string]>;

    windowMode(cb: (value: HostWindowMode) => void): void;
    switchMode(mode: HostWindowMode, cb?: (value: unknown) => void): void;
    minimize(cb?: (value: unknown) => void): void;
    maximize(cb?: (value: unknown) => void): void;
    restore(cb?: (value: unknown) => void): void;
    close(cb?: (value: unknown) => void): void;
    startMove(
        startX: number,
        startY: number,
        currentX: number,
        currentY: number,
        cb?: (value: unknown) => void,
    ): void;
}

export interface SystemChannelContract {
    activeColor: string;
    fontInfo: string;
    themeColor: number;
    networkStatus: boolean;

    activeColorChanged: HostSignal<[string]>;
    networkChanged: HostSignal<[boolean]>;
    themeColorChanged: HostSignal<[number]>;
    themeIconChanged: HostSignal<[]>;
    notificationActionInvoked: HostSignal<[number, string]>;
    appUpdateAvailable: HostSignal<[Record<string, unknown>]>;

    getIconBase64(iconName: string, width: number, height: number, cb: (value: string) => void): void;
    loadTranslations(cb: (value: Record<string, string>) => void): void;
    openUrl(url: string, cb?: (value: unknown) => void): void;
    copyToClipboard(data: string, type: number, cb?: (value: unknown) => void): void;
}

export interface FileChannelContract {
    fileEvent: HostSignal<[number, string, string]>;
    validateIncomingPaths(params: string, cb: (value: string) => void): void;
    handleDroppedFiles(params: string, cb?: (value: unknown) => void): void;
    handleCopiedFiles(params: string, cb?: (value: unknown) => void): void;
    handleScreenshotFile(params: string, cb?: (value: unknown) => void): void;
}

export interface SessionChannelContract {
    sessionEvent: HostSignal<[number, string, string]>;
    sendMessage(params: string, cb?: (value: unknown) => void): void;
    retry(params: string, cb?: (value: unknown) => void): void;
    cancel(params: string, cb?: (value: unknown) => void): void;
    invokeAction(sessionId: string, json: string, cb?: (value: unknown) => void): void;
}

export interface HostContract {
    windowObj: WindowChannelContract;
    systemObj: SystemChannelContract;
    fileObj: FileChannelContract;
    sessionObj: SessionChannelContract;
}

