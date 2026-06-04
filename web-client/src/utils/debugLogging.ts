const SMOKE_QUERY_PARAMS = [
    "autoSend",
    "autoInjectFile",
    "autoRetryFailedFile",
    "autoClearAllFiles",
    "autoOpenRecentConversation",
    "autoOpenToolFile",
    "autoCopyToolPath",
    "autoCopyToolCommand",
    "autoOpenFullOutput",
    "autoFollowUp",
    "autoOpenBranch",
    "autoBrowserInit",
    "autoBrowserOpenExample",
    "autoBrowserNewTabUrl",
    "autoBrowserSwitchTabUrl",
    "autoBrowserExtract",
    "autoBrowserCaptureScreenshot",
];

const getSearchParams = () => {
    if (typeof window === "undefined") {
        return null;
    }

    return new URL(window.location.href).searchParams;
};

export const isSmokeVerificationMode = () => {
    const params = getSearchParams();
    if (!params) {
        return false;
    }

    return SMOKE_QUERY_PARAMS.some((key) => params.has(key));
};

export const isVerboseUiLoggingEnabled = () => {
    const params = getSearchParams();
    if (!params) {
        return false;
    }

    const queryFlag = params.get("debugLogs");
    if (queryFlag === "1" || queryFlag === "true") {
        return true;
    }

    try {
        const localFlag = window.localStorage.getItem("sunday.debugLogs");
        if (localFlag === "1" || localFlag === "true") {
            return true;
        }
    } catch {
        // ignore storage access failures
    }

    return isSmokeVerificationMode();
};

export const debugUiLog = (...args: unknown[]) => {
    if (!isVerboseUiLoggingEnabled()) {
        return;
    }

    console.log(...args);
};

export const debugUiDebug = (...args: unknown[]) => {
    if (!isVerboseUiLoggingEnabled()) {
        return;
    }

    console.debug(...args);
};
