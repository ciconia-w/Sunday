function normalizeTabs(panelState) {
    return Array.isArray(panelState?.tabs) ? panelState.tabs : [];
}

function getFallbackCandidateUrl(targetTab, panelState) {
    const tabUrl = String(targetTab?.url || "").trim();
    if (tabUrl) {
        return tabUrl;
    }

    if (targetTab?.active === true) {
        return String(panelState?.url || "").trim();
    }

    return "";
}

export function isHttpBrowserUrl(url) {
    return /^https?:\/\//i.test(String(url || "").trim());
}

export function chooseBrowserTabSelectionAction(controlState, panelState, pageId) {
    const targetPageId = String(pageId || "").trim();
    if (!targetPageId) {
        return {
            mode: "select",
            pageId: "",
            fallbackUrl: "",
            message: "",
        };
    }

    if (controlState?.stableTabSwitch !== false) {
        return {
            mode: "select",
            pageId: targetPageId,
            fallbackUrl: "",
            message: "",
        };
    }

    const targetTab = normalizeTabs(panelState).find((tab) => String(tab?.page || "").trim() === targetPageId);
    const fallbackUrl = getFallbackCandidateUrl(targetTab, panelState);

    if (isHttpBrowserUrl(fallbackUrl)) {
        return {
            mode: "reopen-url",
            pageId: targetPageId,
            fallbackUrl,
            message: `当前运行时不支持稳定切换标签页，已改为重新打开 ${fallbackUrl}`,
        };
    }

    return {
        mode: "select",
        pageId: targetPageId,
        fallbackUrl,
        message: "",
    };
}
