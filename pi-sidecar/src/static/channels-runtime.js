(function () {
  class Signal {
    constructor() {
      this.listeners = new Set();
    }

    connect(listener) {
      this.listeners.add(listener);
    }

    disconnect(listener) {
      this.listeners.delete(listener);
    }

    emit(...args) {
      for (const listener of this.listeners) {
        listener(...args);
      }
    }
  }

  function splitArgs(args) {
    const list = Array.from(args);
    const maybeCallback = list[list.length - 1];
    if (typeof maybeCallback === "function") {
      return { params: list.slice(0, -1), callback: maybeCallback };
    }
    return { params: list, callback: null };
  }

  function callbackify(fn) {
    return (...args) => {
      const { params, callback } = splitArgs(args);
      Promise.resolve(fn(...params))
        .then((value) => {
          if (callback) callback(value);
        })
        .catch((error) => {
          console.error("[channels-runtime] callbackified call failed", error);
          if (callback) callback(undefined);
        });
    };
  }

  async function createRemoteBackedChannels(baseUrl) {
    const sessionEvent = new Signal();
    const windowFontChanged = new Signal();
    const windowStateChanged = new Signal();
    const windowModeChanged = new Signal();
    const windowShown = new Signal();
    const windowAppendPrompt = new Signal();
    const windowOverrideQuestion = new Signal();
    const windowChangeToDigitalMode = new Signal();
    const toastRequested = new Signal();
    const activeColorChanged = new Signal();
    const networkChanged = new Signal();
    const themeColorChanged = new Signal();
    const themeIconChanged = new Signal();
    const notificationActionInvoked = new Signal();
    const appUpdateAvailable = new Signal();
    const fileEvent = new Signal();
    const audioEvent = new Signal();
    const taskAdded = new Signal();
    const assistantChanged = new Signal();
    const modelListChanged = new Signal();
    const changeToConversation = new Signal();
    const indexSearchChanged = new Signal();
    const knowledgeBaseChanged = new Signal();
    const embeddingPluginsChanged = new Signal();
    const mcpPluginChanged = new Signal();

    const state = {
        assistants: [
          {
            id: "uos-ai-generic",
            name: "Sunday",
            description: "Remote state unavailable",
            icon: { line: "uos-ai", color: "uos-ai-color" },
            gradient_colors: ["#6448FF", "#FF37DF", "#FCA506"],
            path: "icons/",
            place_holder: "让 Sunday 帮你检查文件、调用工具或处理任务...",
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
      const remoteState = await stateRes.json();
      if (remoteState && typeof remoteState === "object") {
        Object.assign(state, remoteState);
      }
    } catch (error) {
      console.warn("[channels-runtime] failed to fetch /state, using fallback state", error);
    }

    const eventSource = new EventSource(`${baseUrl}/events`);
    eventSource.addEventListener("session", (event) => {
      const payload = JSON.parse(event.data);
      sessionEvent.emit(payload.event, payload.sessionId, payload.message);
    });

    async function post(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      return res.json();
    }

    return {
      sessObj: {
        sessionEvent,
        sendMessage: callbackify(async (params) => {
          await post("/session/send", { params });
        }),
        retry: callbackify(async (params) => {
          await post("/session/retry", { params });
        }),
        cancel: callbackify(async (params) => {
          await post("/session/cancel", { params });
        }),
        invokeAction: callbackify(async (sessionId, json) => {
          await post("/session/action", { sessionId, json });
        }),
      },
      assistObj: {
        assistantChanged,
        modelListChanged,
        getAssistantList: callbackify(async () => state.assistants),
        getModelList: callbackify(async (assistantId) => state.modelsByAssistant[assistantId] ?? []),
        getCurrentModel: callbackify(async () => state.currentModelId),
        setCurrentModel: callbackify(async (modelId) => {
          state.currentModelId = modelId;
          modelListChanged.emit();
          return true;
        }),
        getAssistantOrder: callbackify(async () => state.assistants.map((item) => item.id)),
        setAssistantOrder: callbackify(async () => undefined),
        getAssistantVisibleCount: callbackify(async () => Math.min(4, state.assistants.length || 1)),
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
        getConversation: callbackify(async () => null),
        getConversationIndexes: callbackify(async () => "[]"),
        getHistoryConversationIndexes: callbackify(async () => "[]"),
        deleteConversation: callbackify(async () => undefined),
        releaseConversation: callbackify(async () => undefined),
        searchConversations: callbackify(async () => undefined),
        saveConversation: callbackify(async () => true),
        switchMessageNext: callbackify(async () => true),
        getWorkspaceOutline: callbackify(async () => ""),
        updateWorkspaceOutline: callbackify(async () => undefined),
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
        switchMode: callbackify(async (mode) => windowModeChanged.emit(mode)),
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
            activeColor: state.system.activeColor,
            fontInfo: state.system.fontInfo,
            themeColor: state.system.themeColor,
            networkStatus: state.system.networkStatus,
        activeColorChanged,
        networkChanged,
        themeColorChanged,
        themeIconChanged,
        notificationActionInvoked,
        appUpdateAvailable,
        getIconBase64: callbackify(async () => ""),
        loadTranslations: callbackify(async () => state.system.translations),
        checkChineseLanguage: callbackify(async () => true),
        isEnableAdvancedCssFeatures: callbackify(async () => true),
        openUrl: callbackify(async (url) => window.open(url, "_blank", "noopener,noreferrer")),
        copyToClipboard: callbackify(async (data) => navigator.clipboard?.writeText?.(data)),
        closeNotification: callbackify(async () => undefined),
        checkAppUpdate: callbackify(async () => undefined),
        markAppUpdateReminderConsumed: callbackify(async () => undefined),
        themeColorOption: callbackify(async () => 0),
        switchThemeColor: callbackify(async (value) => {
          state.system.themeColor = typeof value === "number" ? value : state.system.themeColor;
          themeColorChanged.emit(state.system.themeColor);
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
        validateIncomingPaths: callbackify(async (params) => params),
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
        writeReportEvent: callbackify(async (jsonData) => {
          console.debug("[remote channels] report", jsonData);
        }),
      },
      serviceConfigObj: {
        knowledgeBaseChanged,
        embeddingPluginsChanged,
        mcpPluginChanged,
        checkKnowledgeBase: callbackify(async () => false),
        checkEmbeddingPlugins: callbackify(async () => false),
        getModelConfig: callbackify(async () => (await post("/model-config/get")).result),
        saveModelConfig: callbackify(async (provider, model, availableModels, providerApiKey) => {
          const response = await post("/model-config/save", {
            provider,
            model,
            availableModels,
            providerApiKey,
          });
          state.currentModelId = `${response.result.provider}/${response.result.model}`;
          return response.result;
        }),
        isMcpRuntimeReady: callbackify(async () => false),
        getMcpThirdPartyAgreement: callbackify(async () => false),
        setMcpThirdPartyAgreement: callbackify(async () => undefined),
        getMcpServices: callbackify(async () => ({ success: true, services: [] })),
      },
    };
  }

  window.__createUosPiRemoteChannels = createRemoteBackedChannels;
})();
