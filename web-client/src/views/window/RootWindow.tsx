import { defineComponent, ref, onMounted, computed } from "vue";
import {
    useBackendStore,
    useAssistantInfosStore,
    useModelInfosStore,
    useSessionChannelStore,
    useUploadFilesStore,
    useConversationManagerStore,
    useNotifyStore,
    useTaskChannelStore,
    useConversationChannelStore,
    useFileChannelStore,
    useWindowChannelStore,
    useMainWindowStore,
    useNetworkStore,
    useRuntimeStatusStore,
} from "@/stores";
import { createId } from "@/utils/date";
import { AssistantID } from "@/types/assistant";
import { WindowMode } from "@/types/windowinfo";
import { FileEvent } from "@/types/uploadfile";
import { getMainWindowWorkspacePage } from "@/utils/mainwindow/workspacePages";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";

import MainWindow from "@/views/window/mainwindow/MainWindow";
import MiniWindow from "@/views/window/minwindow/MiniWindow";
import SideWindow from "@/views/window/mainwindow/SideWindow";
import { ensureBuiltInWorkspacePagesRegistered } from "@/views/window/mainwindow/page/builtinPages";

export default defineComponent({
    name: "RootWindow",
    components: {
        MainWindow,
        MiniWindow,
        SideWindow,
    },
    setup() {
        ensureBuiltInWorkspacePagesRegistered();

        const shouldLogSmokeDetails = () => {
            const params = new URL(window.location.href).searchParams;
            return (
                params.has("autoInjectFile") ||
                params.has("autoOpenRecentConversation") ||
                params.has("autoOpenToolFile") ||
                params.has("autoCopyToolPath") ||
                params.has("autoCopyToolCommand") ||
                params.has("autoOpenFullOutput") ||
                params.has("autoFollowUp") ||
                params.has("autoOpenBranch")
            );
        };

        const logSmoke = (...args: unknown[]) => {
            if (!shouldLogSmokeDetails()) {
                return;
            }
            console.log(...args);
        };

        const backend = useBackendStore();
        const assistantInfosStore = useAssistantInfosStore();
        const modelInfosStore = useModelInfosStore();
        const sessionChannelStore = useSessionChannelStore();
        const uploadFilesStore = useUploadFilesStore();
        const conversationManagerStore = useConversationManagerStore();
        const notifyStore = useNotifyStore();
        const taskChannelStore = useTaskChannelStore();
        const conversationChannelStore = useConversationChannelStore();
        const fileChannelStore = useFileChannelStore();
        const windowChannelStore = useWindowChannelStore();
        const mainWindowStore = useMainWindowStore();
        const networkStore = useNetworkStore();
        const runtimeStatusStore = useRuntimeStatusStore();

        const checkUpdatesInBackground = async () => {
            try {
                const sundayRaw = (await backend.requestSystem("runCliCommand", "curl -s https://api.github.com/repos/ciconia-w/Sunday/releases/latest 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get('tag_name',''))\" 2>/dev/null || echo ''")) as string;
                const sundayLatest = sundayRaw.trim().replace(/^v/, "");
                if (sundayLatest && sundayLatest !== "1.0.0") {
                    notifyStore.showToast({ type: "info", message: `Sunday v${sundayLatest} available`, duration: 4000 });
                }
            } catch { /* silent */ }

            try {
                const opencliRaw = (await backend.requestSystem("runCliCommand", "opencli daemon status 2>/dev/null | grep Version | awk '{print $2}' | tr -d 'v' || echo ''")) as string;
                const opencliCurrent = opencliRaw.trim();
                const npmRaw = (await backend.requestSystem("runCliCommand", "npm view @jackwener/opencli version 2>/dev/null || echo ''")) as string;
                const opencliLatest = npmRaw.trim();
                if (opencliCurrent && opencliLatest && opencliCurrent !== opencliLatest) {
                    notifyStore.showToast({ type: "info", message: `OpenCLI v${opencliLatest} available`, duration: 4000 });
                }
            } catch { /* silent */ }
        };

        const startBrowserSession = async () => {
            try {
                await backend.requestSystem(
                    "runCliCommand",
                    "opencli browser sunday init 2>/dev/null; echo done",
                );
                logSmoke("[RootWindow] browser session started");
            } catch {
                /* silent */
            }
        };

        const maybeRunAutoFileFlow = async () => {
            const url = new URL(window.location.href);
            const autoInjectFile = url.searchParams.get("autoInjectFile");
            const autoDeleteFile = url.searchParams.get("autoDeleteFile");
            const autoRetryFailedFile = url.searchParams.get("autoRetryFailedFile");
            const autoClearAllFiles = url.searchParams.get("autoClearAllFiles");
            const autoOpenRecentConversation = url.searchParams.get("autoOpenRecentConversation");
            const autoOpenToolFile = url.searchParams.get("autoOpenToolFile");
            const autoCopyToolPath = url.searchParams.get("autoCopyToolPath");
            const autoCopyToolCommand = url.searchParams.get("autoCopyToolCommand");
            const autoFollowUp = url.searchParams.get("autoFollowUp");
            const autoOpenBranch = url.searchParams.get("autoOpenBranch");
            const autoOpenFullOutput = url.searchParams.get("autoOpenFullOutput");

            const clickAttachmentAction = async (actionId: string, timeoutMs = 10000) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const button = document.querySelector<HTMLButtonElement>(
                        `[data-attachment-action="${actionId}"]`,
                    );
                    if (button && !button.disabled) {
                        button.click();
                        document.body.setAttribute("data-rootwindow-auto-attachment-action", actionId);
                        logSmoke("[RootWindow] auto attachment action clicked:", actionId);
                        return true;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                console.warn("[RootWindow] auto attachment action missing:", actionId);
                return false;
            };

            const clickToolAction = async (actionId: string, timeoutMs = 10000) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const buttons = Array.from(
                        document.querySelectorAll<HTMLElement>(`[data-tool-action="${actionId}"]`),
                    );
                    const button = buttons[buttons.length - 1] ?? null;
                    if (button && !button.classList.contains("icon-button-disabled")) {
                        const targetPath = button.getAttribute("data-tool-target-path") || "";
                        const command = button.getAttribute("data-tool-command") || "";
                        const outputPath = button.getAttribute("data-tool-output-path") || "";
                        button.click();
                        document.body.setAttribute("data-rootwindow-auto-tool-action", actionId);
                        if (targetPath) {
                            document.body.setAttribute("data-rootwindow-auto-tool-target-path", targetPath);
                            logSmoke("[RootWindow] auto tool action clicked:", actionId, targetPath);
                        } else if (command) {
                            document.body.setAttribute("data-rootwindow-auto-tool-command", command);
                            logSmoke("[RootWindow] auto tool action clicked:", actionId, command);
                        } else if (outputPath) {
                            document.body.setAttribute("data-rootwindow-auto-tool-output-path", outputPath);
                            logSmoke("[RootWindow] auto tool action clicked:", actionId, outputPath);
                        } else {
                            logSmoke("[RootWindow] auto tool action clicked:", actionId);
                        }
                        return true;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                console.warn("[RootWindow] auto tool action missing:", actionId);
                return false;
            };

            const clickMessageAction = async (actionId: string, timeoutMs = 15000) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const buttons = Array.from(
                        document.querySelectorAll<HTMLElement>(`[data-message-action="${actionId}"]`),
                    );
                    const button = buttons[buttons.length - 1] ?? null;
                    if (button && !button.classList.contains("icon-button-disabled")) {
                        button.click();
                        document.body.setAttribute("data-rootwindow-auto-message-action", actionId);
                        logSmoke("[RootWindow] auto message action clicked:", actionId);
                        return true;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
                console.warn("[RootWindow] auto message action missing:", actionId);
                return false;
            };

            const clickRecentConversationCard = async (timeoutMs = 15000) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const cards = Array.from(
                        document.querySelectorAll<HTMLElement>('[data-recent-conversation-card="true"]'),
                    );
                    const card = cards[0] ?? null;
                    if (card) {
                        const conversationId = card.getAttribute("data-recent-conversation-id") || "";
                        const summary = card.getAttribute("data-recent-conversation-summary") || "";
                        card.click();
                        document.body.setAttribute("data-rootwindow-auto-recent-conversation", conversationId);
                        logSmoke("[RootWindow] auto recent conversation clicked:", conversationId);
                        if (summary) {
                            logSmoke("[RootWindow] auto recent conversation summary:", summary);
                        }
                        return conversationId;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
                console.warn("[RootWindow] auto recent conversation missing");
                return "";
            };

            const waitForToolAction = async (actionId: string, timeoutMs = 15000) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const buttons = Array.from(
                        document.querySelectorAll<HTMLElement>(`[data-tool-action="${actionId}"]`),
                    );
                    const button = buttons[buttons.length - 1] ?? null;
                    if (button) {
                        return true;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
                return false;
            };

            if (autoOpenToolFile === "1" || autoOpenToolFile === "true") {
                await waitForToolAction("open-file", 18000);
                const didClickOpenToolFile = await clickToolAction("open-file", 15000);
                if (!didClickOpenToolFile) {
                    document.body.setAttribute("data-rootwindow-auto-tool-action", "open-file-missing");
                }
            }

            if (autoCopyToolPath === "1" || autoCopyToolPath === "true") {
                await waitForToolAction("copy-path", 18000);
                const didClickToolPath = await clickToolAction("copy-path", 15000);
                if (!didClickToolPath) {
                    document.body.setAttribute("data-rootwindow-auto-tool-action", "copy-path-missing");
                }
            }

            if (autoCopyToolCommand === "1" || autoCopyToolCommand === "true") {
                await waitForToolAction("copy-command", 18000);
                const didClickToolCommand = await clickToolAction("copy-command", 15000);
                if (!didClickToolCommand) {
                    document.body.setAttribute("data-rootwindow-auto-tool-action", "copy-command-missing");
                }
            }

            if (autoOpenFullOutput === "1" || autoOpenFullOutput === "true") {
                await waitForToolAction("open-full-output", 18000);
                const didClickOpenFullOutput = await clickToolAction("open-full-output", 15000);
                if (!didClickOpenFullOutput) {
                    document.body.setAttribute("data-rootwindow-auto-tool-action", "open-full-output-missing");
                }
            }

            if (autoOpenRecentConversation === "1" || autoOpenRecentConversation === "true") {
                const conversationId = await clickRecentConversationCard(18000);
                if (!conversationId) {
                    document.body.setAttribute("data-rootwindow-auto-recent-conversation", "missing");
                }
            }

            if (!autoInjectFile) {
                return;
            }

            document.body.setAttribute("data-rootwindow-auto-file", autoInjectFile);
            logSmoke("[RootWindow] auto file requested:", autoInjectFile);

            try {
                await uploadFilesStore.handleDroppedFiles([autoInjectFile]);
            } catch (error) {
                console.error("[RootWindow] auto file inject failed:", error);
                document.body.setAttribute("data-rootwindow-auto-file-status", "inject-failed");
                return;
            }

            let hasLoggedAdded = false;
            let parseStatus = "";
            const fileChannel = backend.fileChannel as any;
            const parseResultPromise =
                fileChannel?.fileEvent &&
                typeof fileChannel.fileEvent.connect === "function" &&
                typeof fileChannel.fileEvent.disconnect === "function"
                    ? new Promise<string>((resolve) => {
                          const listener = (event: number, _id: string, json: string) => {
                              if (event !== FileEvent.FeParseResult) {
                                  return;
                              }

                              try {
                                  const payload = JSON.parse(json) as { file_path?: string; error?: number };
                                  if (payload.file_path !== autoInjectFile) {
                                      return;
                                  }

                                  fileChannel.fileEvent.disconnect(listener);
                                  resolve(payload.error === 0 ? "completed" : "error");
                              } catch {
                                  fileChannel.fileEvent.disconnect(listener);
                                  resolve("error");
                              }
                          };

                          fileChannel.fileEvent.connect(listener);
                      })
                    : null;

            for (let attempt = 0; attempt < 40; attempt += 1) {
                const file = uploadFilesStore.getFileByPath(autoInjectFile);
                if (file) {
                    document.body.setAttribute("data-rootwindow-auto-file-status", "added");
                    if (!hasLoggedAdded) {
                        logSmoke("[RootWindow] auto file added:", autoInjectFile);
                        hasLoggedAdded = true;
                    }
                    parseStatus = file.parseStatus || "";
                    if (parseStatus === "completed" || parseStatus === "error") {
                        document.body.setAttribute("data-rootwindow-auto-file-parse-status", parseStatus);
                        logSmoke("[RootWindow] auto file parse status:", autoInjectFile, parseStatus);
                        break;
                    }
                }
                if (parseResultPromise) {
                    const resolvedStatus = await Promise.race([
                        parseResultPromise,
                        new Promise<string>((resolve) => setTimeout(() => resolve(""), 250)),
                    ]);
                    if (resolvedStatus) {
                        parseStatus = resolvedStatus;
                        document.body.setAttribute("data-rootwindow-auto-file-parse-status", parseStatus);
                        logSmoke("[RootWindow] auto file parse status:", autoInjectFile, parseStatus);
                        break;
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }

            if ((autoRetryFailedFile === "1" || autoRetryFailedFile === "true") && parseStatus === "error") {
                document.body.setAttribute("data-rootwindow-auto-file-retry", "requested");
                logSmoke("[RootWindow] auto file retry requested:", autoInjectFile);
                const didClickRetry = await clickAttachmentAction("retry-failed-files");
                if (!didClickRetry) {
                    document.body.setAttribute("data-rootwindow-auto-file-retry", "request-failed");
                }

                for (let attempt = 0; attempt < 40; attempt += 1) {
                    const retryFile = uploadFilesStore.getFileByPath(autoInjectFile);
                    const retryStatus = retryFile?.parseStatus || "";
                    if (retryStatus === "parsing") {
                        document.body.setAttribute("data-rootwindow-auto-file-retry", "parsing");
                        logSmoke("[RootWindow] auto file retry status:", autoInjectFile, "parsing");
                    }
                    if (retryStatus === "completed" || retryStatus === "error") {
                        document.body.setAttribute("data-rootwindow-auto-file-parse-status", retryStatus);
                        document.body.setAttribute("data-rootwindow-auto-file-retry", retryStatus);
                        logSmoke("[RootWindow] auto file retry status:", autoInjectFile, retryStatus);
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }
            }

            if (autoClearAllFiles === "1" || autoClearAllFiles === "true") {
                const didClickClearAll = await clickAttachmentAction("clear-all");
                if (!didClickClearAll) {
                    document.body.setAttribute("data-rootwindow-auto-file-status", "clear-missing");
                } else {
                    for (let attempt = 0; attempt < 40; attempt += 1) {
                        const clearedFile = uploadFilesStore.getFileByPath(autoInjectFile);
                        if (!clearedFile) {
                            document.body.setAttribute("data-rootwindow-auto-file-status", "cleared");
                            logSmoke("[RootWindow] auto file cleared:", autoInjectFile);
                            break;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 250));
                    }
                }
            }

            if (autoFollowUp === "1" || autoFollowUp === "true") {
                const didClickFollowUp = await clickMessageAction("follow-up", 18000);
                if (!didClickFollowUp) {
                    document.body.setAttribute("data-rootwindow-auto-message-action", "follow-up-missing");
                }
            }

            if (autoOpenBranch === "1" || autoOpenBranch === "true") {
                const didClickOpenBranch = await clickMessageAction("open-branch", 18000);
                if (!didClickOpenBranch) {
                    document.body.setAttribute("data-rootwindow-auto-message-action", "open-branch-missing");
                }
            }

            if (autoDeleteFile === "1" || autoDeleteFile === "true") {
                try {
                    await uploadFilesStore.removeFile(autoInjectFile);
                    document.body.setAttribute("data-rootwindow-auto-file-status", "deleted");
                    logSmoke("[RootWindow] auto file deleted:", autoInjectFile);
                } catch (error) {
                    console.error("[RootWindow] auto file delete failed:", error);
                    document.body.setAttribute("data-rootwindow-auto-file-status", "delete-failed");
                }
            }
        };

        // 初始化各个 channel 监听器
        windowChannelStore.initializeWindowChannel(backend.windowChannel);
        fileChannelStore.initializeFileChannel(backend.fileChannel);
        conversationChannelStore.initializeConversationChannel(backend.conversationChannel);
        taskChannelStore.initializeTaskChannel(backend.taskChannel);
        assistantInfosStore.initializeEnvChannel(backend.serviceConfigChannel);

        // 监听后端助手列表变化，保证动态增删助手后前端状态能及时刷新。
        assistantInfosStore.initializeConnections();
        modelInfosStore.initializeConnections();

        onMounted(async () => {
            document.body.setAttribute("data-rootwindow-mounted", "true");
            // Message timing observer
            const perfObs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.name.startsWith("sunday-")) {
                        console.log("[Sunday Timing]", entry.name, entry.startTime.toFixed(1) + "ms");
                    }
                }
            });
            perfObs.observe({ type: "mark", buffered: true });
            const startupUrl = new URL(window.location.href);
            const startupAssistantId = startupUrl.searchParams.get("assistant");
            const startupWorkspace = startupUrl.searchParams.get("workspace");
            if (startupAssistantId) {
                document.body.setAttribute("data-rootwindow-startup-assistant", startupAssistantId);
                logSmoke("[RootWindow] startup assistant requested:", startupAssistantId);
            }
            if (startupWorkspace) {
                document.body.setAttribute("data-rootwindow-startup-workspace", startupWorkspace);
                logSmoke("[RootWindow] startup workspace requested:", startupWorkspace);
            }
            const bootRuntime = window.__UOS_RUNTIME_STATUS__;
            if (bootRuntime) {
                if (bootRuntime.mode === "local-mock") {
                    runtimeStatusStore.setLocalMockStatus(bootRuntime.reason);
                } else if (bootRuntime.mode === "remote-unknown") {
                    runtimeStatusStore.setRemoteUnknownStatus(bootRuntime.reason);
                } else {
                    runtimeStatusStore.setRemoteStatus(
                        bootRuntime.provider,
                        bootRuntime.modelId,
                        bootRuntime.reason,
                        bootRuntime.mode === "remote-live",
                    );
                }
            }

            //初始化翻译
            await backend.loadTranslations();
            await backend.loadLanguageStatus();

            // 初始化是否启用高级 CSS 功能
            await backend.loadAdvancedCssFeaturesStatus();

            // 初始化窗口模式。主窗口渲染前先恢复侧边栏状态，避免首次进入时布局闪动。
            const windowMode = (await backend.requestWindow("windowMode")) as WindowMode;
            document.body.setAttribute("data-rootwindow-window-mode", String(windowMode));
            if (windowMode === WindowMode.Main) {
                await mainWindowStore.loadPersistedSidebarState();
            }
            windowChannelStore.windowMode = windowMode;

            // 先加载保存的顺序配置，再加载助手列表，避免首次渲染出现顺序闪动。
            await assistantInfosStore.loadAssistantOrder(backend);
            await assistantInfosStore.loadAssistantVisibleCount(backend);
            await assistantInfosStore.loadAssistantList(backend);

            // 使用当前助手ID加载模型列表
            const currentAssistant = assistantInfosStore.getCurrentAssistant;
            const visibleAssistantIds = assistantInfosStore.getAssistantList.map((assistant) => assistant.id);
            const inventoryAssistantIds = assistantInfosStore.getAssistantInventory.map((assistant) => assistant.id);
            const resolvedStartupAssistant = startupAssistantId
                ? assistantInfosStore.getAssistantById(startupAssistantId)
                : null;
            const defaultAssistantId = currentAssistant?.id || AssistantID.UOS_AI;
            const requestedAssistantId = resolvedStartupAssistant?.id || defaultAssistantId;
            if (requestedAssistantId !== defaultAssistantId) {
                if (resolvedStartupAssistant) {
                    assistantInfosStore.setCurrentAssistant(resolvedStartupAssistant);
                }
            }
            const assistantId = requestedAssistantId;
            await modelInfosStore.loadModelList(assistantId);

            await conversationManagerStore.loadConversationIndexList(backend);
            await conversationManagerStore.loadHistoryConversationIndexList(backend);

            // 初始化会话通道
            sessionChannelStore.initializeSessionChannel(backend.sessionChannel);
            notifyStore.initializeSystemNotificationChannel(backend.systemChannel);
            conversationManagerStore.initializeAiReplyNotificationHandlers();

            // 会话管理器创建对话
            await conversationManagerStore.createConversation(
                createId(), // 初始化会话ID，使用当前时间戳
                assistantId,
                modelInfosStore.getCurrentModel?.id || "", // TODO: 暂时使用当前模型
            );
            document.body.setAttribute(
                "data-rootwindow-current-conversation",
                conversationManagerStore.getCurrentConversationId || "",
            );

            // 初始化网络状态
            await networkStore.initNetworkStatus(backend.systemChannel);

            if (windowMode === WindowMode.Main) {
                await mainWindowStore.openStartupNewUserGuideDialogIfNeeded();
            }

            const builtInWorkspaceIds = new Set<string>(Object.values(MAIN_WINDOW_WORKSPACE_PAGES));
            const canOpenStartupWorkspace =
                !!startupWorkspace &&
                (builtInWorkspaceIds.has(startupWorkspace) || !!getMainWindowWorkspacePage(startupWorkspace));

            if (canOpenStartupWorkspace) {
                await mainWindowStore.openWorkspacePage(startupWorkspace);
                document.body.setAttribute("data-rootwindow-startup-workspace-opened", startupWorkspace);
                logSmoke("[RootWindow] startup workspace opened:", startupWorkspace);
            } else if (startupWorkspace) {
                console.warn("[RootWindow] startup workspace not registered:", startupWorkspace);
            }

            await maybeRunAutoFileFlow();

            // 通知后端窗口初始化完成
            taskChannelStore.notifyWindowCreated(backend.taskChannel);

            // 后台检查更新，不阻塞启动流程
            checkUpdatesInBackground();
            // 2.2: 自动创建浏览器会话
            startBrowserSession();
        });

        return {
            windowMode: computed(() => windowChannelStore.windowMode),
        };
    },
    render() {
        return (
            <div class="root-window">
                {this.windowMode === WindowMode.Main ? <MainWindow /> : null}
                {this.windowMode === WindowMode.Mini ? <MiniWindow /> : null}
                {this.windowMode === WindowMode.Side ? <SideWindow /> : null}
            </div>
        );
    },
});
