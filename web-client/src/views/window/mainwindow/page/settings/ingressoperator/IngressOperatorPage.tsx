import { computed, defineComponent, onMounted, ref } from "vue";
import ScrollBar from "@/components/ScrollBar";
import Switch from "@/components/Switch";
import TextButton from "@/components/TextButton";
import { useBackendStore, useNotifyStore } from "@/stores";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";
import "@/assets/styles/window/mainwindow/page/settings/ingressoperator/IngressOperatorPage.css";

interface IngressReplyTargetSummary {
    transport?: string;
    url?: string;
    hasSecret?: boolean;
    headerKeys?: string[];
}

interface IngressReplyRouteSummary {
    routeKey: string;
    source: string;
    channelId: string;
    threadId: string;
    conversationId: string;
    sessionId: string;
    replyTarget?: IngressReplyTargetSummary;
    updatedAt: string;
}

interface IngressReplayPayloadSummary {
    ok?: boolean;
    assistantTextPreview?: string;
    errorPreview?: string;
}

interface IngressReplayHistoryEvent {
    kind: string;
    mode: string;
    at: string;
    attemptCount: number;
    totalAttemptCount: number;
    status: string;
    error: string;
}

interface IngressReplayQueueEntry {
    id: string;
    status: string;
    transport: string;
    routeKey: string;
    conversationId: string;
    sessionId: string;
    requestExternalMessageId: string;
    replyTarget?: IngressReplyTargetSummary;
    payloadSummary?: IngressReplayPayloadSummary;
    attemptCount: number;
    replayCount: number;
    automaticReplayCount: number;
    latestError: string;
    createdAt: string;
    updatedAt: string;
    deliveredAt: string;
    resolvedAt: string;
    nextAttemptAt: string;
    lastAttemptAt: string;
    history: IngressReplayHistoryEvent[];
    latestReceipt?: {
        actor?: string;
        mode?: string;
        transport?: string;
        ok?: boolean;
        statusCode?: number;
        statusText?: string;
        at?: string;
        error?: string;
        providerCode?: string;
        providerMessage?: string;
        responseBodyPreview?: string;
        providerPayloadPreview?: string;
    } | null;
    processing?: {
        ownerId?: string;
        ownerKind?: string;
        mode?: string;
        claimedAt?: string;
        expiresAt?: string;
    } | null;
}

interface IngressReplayQueueState {
    worker: {
        enabled: boolean;
        pollMs: number;
        delaysMs: number[];
        paused?: boolean;
        pauseReason?: string;
        pausedAt?: string;
    };
    counts: {
        total: number;
        pending: number;
        processing: number;
        delivered: number;
        awaitingOperator: number;
        resolved: number;
        discarded: number;
    };
    entries: IngressReplayQueueEntry[];
}

interface IngressOperatorState {
    routes: IngressReplyRouteSummary[];
    replayQueue: IngressReplayQueueState;
    supportedReplyTransports: string[];
    replyRetryPolicy: {
        maxAttempts: number;
        delaysMs: number[];
    };
    backgroundReplay: {
        enabled: boolean;
        pollMs: number;
        delaysMs: number[];
        mode: string;
        hasDedicatedReplayService: boolean;
        deliveryPolicy: {
            strategy: string;
            delaysMs: number[];
            maxAutomaticAttempts: number;
            initialDelayMs: number;
            maxDelayMs: number;
            multiplier: number;
        };
        serviceStatus: {
            enabled: boolean;
            running: boolean;
            pid: number;
            restartCount: number;
            startedAt: string;
            lastHeartbeatAt: string;
            lastRunAt: string;
            lastError: string;
            manager: string;
            managedBySidecar: boolean;
        };
        control: {
            paused: boolean;
            pauseReason: string;
            pausedAt: string;
            updatedAt: string;
        };
        ownership: {
            routePersistence: string;
            routeMutationAuthority?: string;
            replayQueuePersistence: string;
            automaticReplayExecutor: string;
            serviceUsesSidecarOperatorApi: boolean;
        };
    };
    runtimeNote: string;
}

const createDefaultOperatorState = (): IngressOperatorState => ({
    routes: [],
    replayQueue: {
        worker: {
            enabled: false,
            pollMs: 5000,
            delaysMs: [],
            paused: false,
            pauseReason: "",
            pausedAt: "",
        },
        counts: {
            total: 0,
            pending: 0,
            processing: 0,
            delivered: 0,
            awaitingOperator: 0,
            resolved: 0,
            discarded: 0,
        },
        entries: [],
    },
    supportedReplyTransports: ["webhook", "lark-bot-webhook", "dingtalk-bot-webhook", "slack-webhook", "discord-webhook", "teams-webhook"],
    replyRetryPolicy: {
        maxAttempts: 1,
        delaysMs: [],
    },
    backgroundReplay: {
        enabled: false,
        pollMs: 5000,
        delaysMs: [],
        mode: "in-process",
        hasDedicatedReplayService: false,
        deliveryPolicy: {
            strategy: "fixed",
            delaysMs: [],
            maxAutomaticAttempts: 0,
            initialDelayMs: 0,
            maxDelayMs: 0,
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
            paused: false,
            pauseReason: "",
            pausedAt: "",
            updatedAt: "",
        },
        ownership: {
            routePersistence: "",
            routeMutationAuthority: "",
            replayQueuePersistence: "",
            automaticReplayExecutor: "",
            serviceUsesSidecarOperatorApi: false,
        },
    },
    runtimeNote: "当前没有可用的 ingress operator 状态。",
});

function formatTimeLabel(value: string) {
    if (!value) {
        return "";
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatDelayList(delaysMs: number[]) {
    if (!Array.isArray(delaysMs) || !delaysMs.length) {
        return "无";
    }

    return delaysMs.map((delay) => `${Math.max(0, Math.round(delay / 1000))}s`).join(" / ");
}

function normalizeTransportLabel(transport: string) {
    if (transport === "lark-bot-webhook") {
        return "Lark / Feishu";
    }

    if (transport === "slack-webhook") {
        return "Slack";
    }

    if (transport === "dingtalk-bot-webhook") {
        return "DingTalk";
    }

    if (transport === "webhook") {
        return "Generic Webhook";
    }

    if (transport === "discord-webhook") {
        return "Discord";
    }

    if (transport === "teams-webhook") {
        return "Teams";
    }

    return transport || "unknown";
}

function formatReplayHistoryTitle(event: IngressReplayHistoryEvent) {
    if (event.kind === "delivery-failed") {
        return "初始回推失败";
    }

    if (event.kind === "replay-succeeded") {
        return event.mode === "automatic" ? "自动重放成功" : "手动重试成功";
    }

    if (event.kind === "replay-failed") {
        return event.mode === "automatic" ? "自动重放失败" : "手动重试失败";
    }

    if (event.kind === "resolved") {
        return "已标记为已处理";
    }

    if (event.kind === "discarded") {
        return "已标记为忽略";
    }

    if (event.kind === "delivered") {
        return "已成功送达";
    }

    return "历史记录";
}

function formatReplayHistoryDetail(event: IngressReplayHistoryEvent) {
    const fragments: string[] = [];

    if (event.attemptCount > 0) {
        fragments.push(`本次 ${event.attemptCount} 次尝试`);
    }

    if (event.totalAttemptCount > 0) {
        fragments.push(`累计 ${event.totalAttemptCount} 次`);
    }

    if (event.status) {
        fragments.push(`状态 ${event.status}`);
    }

    if (event.error) {
        fragments.push(event.error);
    }

    return fragments.join(" / ");
}

export default defineComponent({
    name: "IngressOperatorPage",
    components: {
        ScrollBar,
        Switch,
        TextButton,
    },
    setup() {
        const backendStore = useBackendStore();
        const notifyStore = useNotifyStore();

        const operatorState = ref<IngressOperatorState>(createDefaultOperatorState());
        const isLoading = ref(false);
        const lastError = ref("");
        const includeResolved = ref(false);
        const pendingActionIds = ref<Record<string, string>>({});
        const controlAction = ref("");

        const loadOperatorState = async (showToast = false) => {
            isLoading.value = true;
            lastError.value = "";
            try {
                const state = await backendStore.requestServiceConfig(
                    "getIngressOperatorState",
                    includeResolved.value,
                ) as Partial<IngressOperatorState> | null;
                operatorState.value = {
                    ...createDefaultOperatorState(),
                    ...(state || {}),
                    replayQueue: {
                        ...createDefaultOperatorState().replayQueue,
                        ...(state?.replayQueue || {}),
                        worker: {
                            ...createDefaultOperatorState().replayQueue.worker,
                            ...(state?.replayQueue?.worker || {}),
                        },
                        counts: {
                            ...createDefaultOperatorState().replayQueue.counts,
                            ...(state?.replayQueue?.counts || {}),
                        },
                        entries: Array.isArray(state?.replayQueue?.entries)
                            ? state.replayQueue.entries.map((entry) => ({
                                ...entry,
                                history: Array.isArray(entry?.history) ? entry.history : [],
                                latestReceipt: entry?.latestReceipt || null,
                                processing: entry?.processing || null,
                            }))
                            : [],
                    },
                    backgroundReplay: {
                        ...createDefaultOperatorState().backgroundReplay,
                        ...(state?.backgroundReplay || {}),
                        deliveryPolicy: {
                            ...createDefaultOperatorState().backgroundReplay.deliveryPolicy,
                            ...(state?.backgroundReplay?.deliveryPolicy || {}),
                        },
                        serviceStatus: {
                            ...createDefaultOperatorState().backgroundReplay.serviceStatus,
                            ...(state?.backgroundReplay?.serviceStatus || {}),
                        },
                        control: {
                            ...createDefaultOperatorState().backgroundReplay.control,
                            ...(state?.backgroundReplay?.control || {}),
                        },
                        ownership: {
                            ...createDefaultOperatorState().backgroundReplay.ownership,
                            ...(state?.backgroundReplay?.ownership || {}),
                        },
                    },
                    routes: Array.isArray(state?.routes) ? state.routes : [],
                    supportedReplyTransports: Array.isArray(state?.supportedReplyTransports)
                        ? state.supportedReplyTransports
                        : createDefaultOperatorState().supportedReplyTransports,
                };

                if (showToast) {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("IM Bridge 状态已刷新"),
                        duration: 1800,
                    });
                }
            } catch (error) {
                lastError.value = error instanceof Error ? error.message : "加载 IM Bridge 状态失败。";
                if (showToast) {
                    notifyStore.showToast({
                        type: "error",
                        message: lastError.value,
                        duration: 2600,
                    });
                }
            } finally {
                isLoading.value = false;
            }
        };

        const withEntryAction = async (entryId: string, actionKey: string, handler: () => Promise<void>) => {
            pendingActionIds.value = {
                ...pendingActionIds.value,
                [entryId]: actionKey,
            };
            try {
                await handler();
            } finally {
                const nextPending = {
                    ...pendingActionIds.value,
                };
                delete nextPending[entryId];
                pendingActionIds.value = nextPending;
            }
        };

        const handleReplayEntry = async (entryId: string) => {
            await withEntryAction(entryId, "replay", async () => {
                const result = await backendStore.requestServiceConfig("replayIngressQueueEntry", entryId) as {
                    ok?: boolean;
                    error?: string;
                    automatic?: boolean;
                } | null;
                if (result?.ok === true) {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("已触发重试"),
                        duration: 1800,
                    });
                } else {
                    notifyStore.showToast({
                        type: "error",
                        message: result?.error || backendStore.translate("重试失败，请稍后再试。"),
                        duration: 2600,
                    });
                }
                await loadOperatorState(false);
            });
        };

        const handleResolveEntry = async (entryId: string, resolution: "resolved" | "discarded") => {
            await withEntryAction(entryId, resolution, async () => {
                await backendStore.requestServiceConfig("resolveIngressQueueEntry", entryId, resolution);
                notifyStore.showToast({
                    type: "success",
                    message: resolution === "discarded"
                        ? backendStore.translate("该回推项已标记为忽略")
                        : backendStore.translate("该回推项已标记为已处理"),
                    duration: 1800,
                });
                await loadOperatorState(false);
            });
        };

        const withControlAction = async (actionKey: string, handler: () => Promise<void>) => {
            controlAction.value = actionKey;
            try {
                await handler();
            } finally {
                controlAction.value = "";
            }
        };

        const handlePauseBackgroundReplay = async () => {
            await withControlAction("pause", async () => {
                const result = await backendStore.requestServiceConfig("pauseIngressBackgroundReplay", "operator-ui") as {
                    error?: string;
                } | null;
                if (result?.error) {
                    notifyStore.showToast({
                        type: "error",
                        message: result.error,
                        duration: 2600,
                    });
                } else {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("自动重放已暂停"),
                        duration: 1800,
                    });
                }
                await loadOperatorState(false);
            });
        };

        const handleResumeBackgroundReplay = async () => {
            await withControlAction("resume", async () => {
                const result = await backendStore.requestServiceConfig("resumeIngressBackgroundReplay") as {
                    error?: string;
                } | null;
                if (result?.error) {
                    notifyStore.showToast({
                        type: "error",
                        message: result.error,
                        duration: 2600,
                    });
                } else {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("自动重放已恢复"),
                        duration: 1800,
                    });
                }
                await loadOperatorState(false);
            });
        };

        onMounted(() => {
            void loadOperatorState(false);
        });

        const headerTitleText = computed(() => "IM Bridge");
        const headerSubtitleText = computed(() => "查看 reply route、replay queue 和当前 delivery policy。");
        const refreshButtonText = computed(() => isLoading.value ? "刷新中..." : "刷新状态");
        const pauseButtonText = computed(() => controlAction.value === "pause" ? "暂停中..." : "暂停自动重放");
        const resumeButtonText = computed(() => controlAction.value === "resume" ? "恢复中..." : "恢复自动重放");
        const workerModeText = computed(() =>
            operatorState.value.backgroundReplay.mode === "standalone-service"
                ? "Standalone Replay Service"
                : operatorState.value.backgroundReplay.hasDedicatedReplayService
                ? "Dedicated Replay Service"
                : "Sidecar In-Process Worker",
        );
        const deliveryStrategyText = computed(() => {
            if (!operatorState.value.backgroundReplay.enabled) {
                return "未启用";
            }

            const policy = operatorState.value.backgroundReplay.deliveryPolicy;
            if (policy.strategy === "exponential") {
                return `Exponential Backoff x${policy.multiplier}`;
            }

            return "Fixed Delays";
        });
        const supportedTransportText = computed(() =>
            operatorState.value.supportedReplyTransports.map(normalizeTransportLabel).join(" / "),
        );
        const queueOwnershipText = computed(() => {
            const ownership = operatorState.value.backgroundReplay.ownership;
            if (!ownership.replayQueuePersistence) {
                return "未提供";
            }

            return `${ownership.replayQueuePersistence} / ${ownership.automaticReplayExecutor || "unknown"}`;
        });
        const routeOwnershipText = computed(() => {
            const ownership = operatorState.value.backgroundReplay.ownership;
            if (!ownership.routePersistence) {
                return "未提供";
            }

            return ownership.routeMutationAuthority
                ? `${ownership.routePersistence} / ${ownership.routeMutationAuthority}`
                : ownership.routePersistence;
        });
        const operatorApiDependencyText = computed(() => {
            return operatorState.value.backgroundReplay.ownership.serviceUsesSidecarOperatorApi
                ? "依赖 sidecar operator API"
                : "worker 直接访问 shared store";
        });
        const backgroundReplayControlText = computed(() => {
            if (!operatorState.value.backgroundReplay.enabled) {
                return "未启用";
            }

            return operatorState.value.backgroundReplay.control.paused ? "已暂停" : "自动运行";
        });
        const workerRuntimeText = computed(() => {
            if (!operatorState.value.backgroundReplay.hasDedicatedReplayService) {
                return "由 sidecar 进程内 worker 驱动";
            }

            const serviceStatus = operatorState.value.backgroundReplay.serviceStatus;
            if (!serviceStatus.enabled) {
                return "未启用";
            }

            if (!serviceStatus.running) {
                return "未运行";
            }

            return serviceStatus.pid > 0 ? `运行中 (PID ${serviceStatus.pid})` : "运行中";
        });
        const summaryBadges = computed(() => [
            {
                key: "routes",
                label: "Reply Routes",
                value: String(operatorState.value.routes.length),
            },
            {
                key: "pending",
                label: "Pending",
                value: String(operatorState.value.replayQueue.counts.pending),
            },
            {
                key: "processing",
                label: "Processing",
                value: String(operatorState.value.replayQueue.counts.processing),
            },
            {
                key: "awaiting",
                label: "Awaiting Operator",
                value: String(operatorState.value.replayQueue.counts.awaitingOperator),
            },
            {
                key: "delivered",
                label: "Delivered",
                value: String(operatorState.value.replayQueue.counts.delivered),
            },
            {
                key: "resolved",
                label: "Resolved",
                value: String(operatorState.value.replayQueue.counts.resolved + operatorState.value.replayQueue.counts.discarded),
            },
        ]);

        const canReplayEntry = (entry: IngressReplayQueueEntry) => {
            return ["pending", "awaiting-operator"].includes(entry.status) && !entry.processing?.ownerId;
        };

        const canResolveEntry = (entry: IngressReplayQueueEntry) => {
            return !["resolved", "discarded"].includes(entry.status) && !entry.processing?.ownerId;
        };

        const isActionPending = (entryId: string, actionKey: string) => {
            return pendingActionIds.value[entryId] === actionKey;
        };

        const statusToneClass = (status: string) => {
            if (status === "delivered" || status === "resolved") {
                return "ingress-operator-page__badge--success";
            }
            if (status === "pending" || status === "awaiting-operator") {
                return "ingress-operator-page__badge--warning";
            }
            if (status === "discarded") {
                return "ingress-operator-page__badge--neutral";
            }
            return "ingress-operator-page__badge--error";
        };

        return {
            backendStore,
            operatorState,
            isLoading,
            lastError,
            includeResolved,
            controlAction,
            headerTitleText,
            headerSubtitleText,
            refreshButtonText,
            pauseButtonText,
            resumeButtonText,
            workerModeText,
            supportedTransportText,
            queueOwnershipText,
            routeOwnershipText,
            operatorApiDependencyText,
            backgroundReplayControlText,
            workerRuntimeText,
            summaryBadges,
            canReplayEntry,
            canResolveEntry,
            isActionPending,
            statusToneClass,
            formatTimeLabel,
            formatDelayList,
            normalizeTransportLabel,
            formatReplayHistoryTitle,
            formatReplayHistoryDetail,
            deliveryStrategyText,
            loadOperatorState,
            handlePauseBackgroundReplay,
            handleResumeBackgroundReplay,
            handleReplayEntry,
            handleResolveEntry,
        };
    },
    render() {
        return (
            <div class={["skills-page", "ingress-operator-page"]} data-ingress-operator-page>
                <div class="skills-page__header-container">
                    <div class="skills-page__container">
                        <div class="skills-page__header">
                            <div class="skills-page__header-left">
                                <div class="skills-page__header-content">
                                    <div class="skills-page__title">{this.headerTitleText}</div>
                                    <div class="skills-page__subtitle">{this.headerSubtitleText}</div>
                                </div>
                            </div>
                            <div class="skills-page__actions">
                                <div class="ingress-operator-page__toggle">
                                    <span class="ingress-operator-page__toggle-label">显示已处理</span>
                                    <Switch
                                        value={this.includeResolved}
                                        onChange={(value: boolean) => {
                                            this.includeResolved = value;
                                            void this.loadOperatorState(false);
                                        }}
                                    />
                                </div>
                                <TextButton text={this.refreshButtonText} onClick={() => void this.loadOperatorState(true)} />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="skills-page__content">
                    <ScrollBar class="skills-page__scroll">
                        <div class="skills-page__content-container">
                            <div class="skills-page__container">
                                <div class="skills-page__section ingress-operator-page__stack">
                                    <div class="ingress-operator-page__summary-grid" data-ingress-summary>
                                        {this.summaryBadges.map((badge) => (
                                            <div class="ingress-operator-page__summary-card" key={badge.key}>
                                                <div class="ingress-operator-page__summary-label">{badge.label}</div>
                                                <div class="ingress-operator-page__summary-value">{badge.value}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div class="ingress-operator-page__panel">
                                        <div class="ingress-operator-page__panel-header">
                                            <div class="ingress-operator-page__panel-title">Delivery Policy</div>
                                            <div class="ingress-operator-page__panel-header-actions">
                                                <div
                                                    class={[
                                                        "ingress-operator-page__badge",
                                                        this.operatorState.backgroundReplay.enabled
                                                            ? (this.operatorState.backgroundReplay.control.paused
                                                                ? "ingress-operator-page__badge--warning"
                                                                : "ingress-operator-page__badge--success")
                                                            : "ingress-operator-page__badge--neutral",
                                                    ]}
                                                    data-ingress-operator-control-state
                                                >
                                                    {this.operatorState.backgroundReplay.enabled
                                                        ? (this.operatorState.backgroundReplay.control.paused ? "自动重放已暂停" : "Worker 已启用")
                                                        : "Worker 已关闭"}
                                                </div>
                                                {this.operatorState.backgroundReplay.enabled && !this.operatorState.backgroundReplay.control.paused && (
                                                    <TextButton
                                                        text={this.pauseButtonText}
                                                        disabled={this.controlAction === "resume"}
                                                        data-ingress-operator-pause-action
                                                        onClick={() => void this.handlePauseBackgroundReplay()}
                                                    />
                                                )}
                                                {this.operatorState.backgroundReplay.enabled && this.operatorState.backgroundReplay.control.paused && (
                                                    <TextButton
                                                        text={this.resumeButtonText}
                                                        disabled={this.controlAction === "pause"}
                                                        data-ingress-operator-resume-action
                                                        onClick={() => void this.handleResumeBackgroundReplay()}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                        <div class="ingress-operator-page__fact-grid">
                                            <div class="ingress-operator-page__fact-item">
                                                <div class="ingress-operator-page__fact-label">当前模式</div>
                                                <div class="ingress-operator-page__fact-value">{this.workerModeText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item" data-ingress-operator-queue-ownership>
                                                <div class="ingress-operator-page__fact-label">Queue Ownership</div>
                                                <div class="ingress-operator-page__fact-value">{this.queueOwnershipText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item" data-ingress-operator-route-ownership>
                                                <div class="ingress-operator-page__fact-label">Route Persistence</div>
                                                <div class="ingress-operator-page__fact-value">{this.routeOwnershipText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item">
                                                <div class="ingress-operator-page__fact-label">支持回推</div>
                                                <div class="ingress-operator-page__fact-value">{this.supportedTransportText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item">
                                                <div class="ingress-operator-page__fact-label">同步重试</div>
                                                <div class="ingress-operator-page__fact-value">
                                                    {this.operatorState.replyRetryPolicy.maxAttempts} 次 / {this.formatDelayList(this.operatorState.replyRetryPolicy.delaysMs)}
                                                </div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item">
                                                <div class="ingress-operator-page__fact-label">后台重放</div>
                                                <div class="ingress-operator-page__fact-value">
                                                    {this.operatorState.backgroundReplay.enabled
                                                        ? `${this.formatDelayList(this.operatorState.backgroundReplay.delaysMs)} / ${Math.max(1, Math.round(this.operatorState.backgroundReplay.pollMs / 1000))}s 轮询`
                                                        : "未启用"}
                                                </div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item">
                                                <div class="ingress-operator-page__fact-label">治理状态</div>
                                                <div class="ingress-operator-page__fact-value">{this.backgroundReplayControlText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item" data-ingress-operator-delivery-strategy>
                                                <div class="ingress-operator-page__fact-label">退避策略</div>
                                                <div class="ingress-operator-page__fact-value">{this.deliveryStrategyText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item" data-ingress-operator-service-runtime>
                                                <div class="ingress-operator-page__fact-label">Worker 状态</div>
                                                <div class="ingress-operator-page__fact-value">{this.workerRuntimeText}</div>
                                            </div>
                                            <div class="ingress-operator-page__fact-item" data-ingress-operator-api-dependency>
                                                <div class="ingress-operator-page__fact-label">Worker Access</div>
                                                <div class="ingress-operator-page__fact-value">{this.operatorApiDependencyText}</div>
                                            </div>
                                            {this.operatorState.backgroundReplay.control.paused && (
                                                <div class="ingress-operator-page__fact-item" data-ingress-operator-paused-at>
                                                    <div class="ingress-operator-page__fact-label">暂停时间</div>
                                                    <div class="ingress-operator-page__fact-value">
                                                        {this.formatTimeLabel(this.operatorState.backgroundReplay.control.pausedAt) || "-"}
                                                    </div>
                                                </div>
                                            )}
                                            {this.operatorState.backgroundReplay.control.paused && this.operatorState.backgroundReplay.control.pauseReason && (
                                                <div class="ingress-operator-page__fact-item" data-ingress-operator-pause-reason>
                                                    <div class="ingress-operator-page__fact-label">暂停原因</div>
                                                    <div class="ingress-operator-page__fact-value">
                                                        {this.operatorState.backgroundReplay.control.pauseReason}
                                                    </div>
                                                </div>
                                            )}
                                            {this.operatorState.backgroundReplay.hasDedicatedReplayService && (
                                                <div class="ingress-operator-page__fact-item" data-ingress-operator-service-heartbeat>
                                                    <div class="ingress-operator-page__fact-label">最近心跳</div>
                                                    <div class="ingress-operator-page__fact-value">
                                                        {this.formatTimeLabel(this.operatorState.backgroundReplay.serviceStatus.lastHeartbeatAt) || "-"}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div class="ingress-operator-page__note" data-ingress-operator-runtime-note>
                                            {this.operatorState.runtimeNote}
                                        </div>
                                        {this.lastError && (
                                            <div class="ingress-operator-page__error">{this.lastError}</div>
                                        )}
                                    </div>

                                    <div class="ingress-operator-page__panel">
                                        <div class="ingress-operator-page__panel-header">
                                            <div class="ingress-operator-page__panel-title">Reply Routes</div>
                                            <div class="ingress-operator-page__panel-subtitle">当前按 source / channel / thread 持久化的回推目标。</div>
                                        </div>
                                        {this.operatorState.routes.length > 0 ? (
                                            <div class="ingress-operator-page__list">
                                                {this.operatorState.routes.map((route) => (
                                                    <div class="ingress-operator-page__list-row" key={route.routeKey} data-ingress-route-row>
                                                        <div class="ingress-operator-page__row-topline">
                                                            <div class="ingress-operator-page__row-title">{route.routeKey}</div>
                                                            <div class={["ingress-operator-page__badge", "ingress-operator-page__badge--neutral"]}>
                                                                {this.normalizeTransportLabel(route.replyTarget?.transport || "")}
                                                            </div>
                                                        </div>
                                                        <div class="ingress-operator-page__row-meta">
                                                            <span>{route.source}</span>
                                                            <span>{route.channelId}</span>
                                                            <span>{route.threadId}</span>
                                                        </div>
                                                        <div class="ingress-operator-page__row-detail">
                                                            <div>Target: {route.replyTarget?.url || "未配置"}</div>
                                                            <div>Conversation: {route.conversationId || "-"}</div>
                                                            <div>Session: {route.sessionId || "-"}</div>
                                                            <div>最后更新: {this.formatTimeLabel(route.updatedAt) || "-"}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div class="ingress-operator-page__empty">当前没有持久化的 reply route。</div>
                                        )}
                                    </div>

                                    <div class="ingress-operator-page__panel">
                                        <div class="ingress-operator-page__panel-header">
                                            <div class="ingress-operator-page__panel-title">Replay Queue</div>
                                            <div class="ingress-operator-page__panel-subtitle">查看待重放项，并直接执行重试、已处理或忽略。</div>
                                        </div>
                                        {this.operatorState.replayQueue.entries.length > 0 ? (
                                            <div class="ingress-operator-page__list">
                                                {this.operatorState.replayQueue.entries.map((entry) => (
                                                    <div class="ingress-operator-page__list-row" key={entry.id} data-ingress-replay-row>
                                                        <div class="ingress-operator-page__row-topline">
                                                            <div class="ingress-operator-page__row-title">{entry.routeKey || entry.id}</div>
                                                            <div class={["ingress-operator-page__badge", this.statusToneClass(entry.status)]}>
                                                                {entry.status}
                                                            </div>
                                                        </div>
                                                        <div class="ingress-operator-page__row-meta">
                                                            <span>{this.normalizeTransportLabel(entry.transport)}</span>
                                                            <span>{entry.requestExternalMessageId || "no external message id"}</span>
                                                        </div>
                                                        <div class="ingress-operator-page__row-preview">
                                                            {entry.payloadSummary?.ok
                                                                ? (entry.payloadSummary?.assistantTextPreview || "无文本预览")
                                                                : (entry.payloadSummary?.errorPreview || entry.latestError || "无错误摘要")}
                                                        </div>
                                                        <div class="ingress-operator-page__row-detail">
                                                            <div>Attempt: {entry.attemptCount} / Manual: {entry.replayCount} / Auto: {entry.automaticReplayCount}</div>
                                                            <div>Next Attempt: {this.formatTimeLabel(entry.nextAttemptAt) || "-"}</div>
                                                            <div>Last Attempt: {this.formatTimeLabel(entry.lastAttemptAt) || "-"}</div>
                                                            <div>Updated: {this.formatTimeLabel(entry.updatedAt) || "-"}</div>
                                                            {entry.latestError ? <div>Latest Error: {entry.latestError}</div> : null}
                                                        </div>
                                                        {entry.latestReceipt && (
                                                            <div class="ingress-operator-page__row-detail" data-ingress-replay-latest-receipt>
                                                                <div>
                                                                    Latest Receipt: {entry.latestReceipt.ok ? "success" : "failed"}
                                                                    {" / "}
                                                                    {entry.latestReceipt.actor || "unknown"}
                                                                    {" / "}
                                                                    {entry.latestReceipt.mode || "unknown"}
                                                                    {entry.latestReceipt.statusCode ? ` / HTTP ${entry.latestReceipt.statusCode}` : ""}
                                                                    {entry.latestReceipt.statusText ? ` ${entry.latestReceipt.statusText}` : ""}
                                                                </div>
                                                                <div>At: {this.formatTimeLabel(entry.latestReceipt.at || "") || "-"}</div>
                                                                {entry.latestReceipt.error ? <div>Error: {entry.latestReceipt.error}</div> : null}
                                                                {entry.latestReceipt.providerCode ? (
                                                                    <div data-ingress-replay-receipt-provider-code>
                                                                        Provider Code: {entry.latestReceipt.providerCode}
                                                                    </div>
                                                                ) : null}
                                                                {entry.latestReceipt.providerMessage ? (
                                                                    <div data-ingress-replay-receipt-provider-message>
                                                                        Provider Message: {entry.latestReceipt.providerMessage}
                                                                    </div>
                                                                ) : null}
                                                                {entry.latestReceipt.responseBodyPreview ? (
                                                                    <div data-ingress-replay-receipt-response-preview>
                                                                        Response Preview: {entry.latestReceipt.responseBodyPreview}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        )}
                                                        {entry.processing?.ownerId && (
                                                            <div class="ingress-operator-page__row-detail" data-ingress-replay-processing>
                                                                <div>
                                                                    Processing: {entry.processing.ownerKind || "worker"}
                                                                    {" / "}
                                                                    {entry.processing.ownerId}
                                                                    {" / "}
                                                                    {entry.processing.mode || "unknown"}
                                                                </div>
                                                                <div>Claimed: {this.formatTimeLabel(entry.processing.claimedAt || "") || "-"}</div>
                                                                <div>Expires: {this.formatTimeLabel(entry.processing.expiresAt || "") || "-"}</div>
                                                            </div>
                                                        )}
                                                        {entry.history.length > 0 && (
                                                            <div class="ingress-operator-page__history" data-ingress-replay-history>
                                                                <div class="ingress-operator-page__history-title">Replay History</div>
                                                                <div class="ingress-operator-page__history-list">
                                                                    {[...entry.history].reverse().map((historyEvent, index) => (
                                                                        <div
                                                                            class="ingress-operator-page__history-item"
                                                                            key={`${entry.id}-${historyEvent.at}-${historyEvent.kind}-${index}`}
                                                                            data-ingress-replay-history-item
                                                                        >
                                                                            <div class="ingress-operator-page__history-topline">
                                                                                <span class="ingress-operator-page__history-label">
                                                                                    {this.formatReplayHistoryTitle(historyEvent)}
                                                                                </span>
                                                                                <span class="ingress-operator-page__history-time">
                                                                                    {this.formatTimeLabel(historyEvent.at) || "-"}
                                                                                </span>
                                                                            </div>
                                                                            <div class="ingress-operator-page__history-detail">
                                                                                {this.formatReplayHistoryDetail(historyEvent) || "-"}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {(this.canReplayEntry(entry) || this.canResolveEntry(entry)) && (
                                                            <div class="ingress-operator-page__row-actions">
                                                                {this.canReplayEntry(entry) && (
                                                                    <TextButton
                                                                        text={this.isActionPending(entry.id, "replay") ? "重试中..." : "立即重试"}
                                                                        disabled={this.isActionPending(entry.id, "replay")}
                                                                        onClick={() => void this.handleReplayEntry(entry.id)}
                                                                    />
                                                                )}
                                                                {this.canResolveEntry(entry) && (
                                                                    <TextButton
                                                                        text={this.isActionPending(entry.id, "resolved") ? "处理中..." : "标记已处理"}
                                                                        disabled={this.isActionPending(entry.id, "resolved")}
                                                                        onClick={() => void this.handleResolveEntry(entry.id, "resolved")}
                                                                    />
                                                                )}
                                                                {this.canResolveEntry(entry) && (
                                                                    <TextButton
                                                                        text={this.isActionPending(entry.id, "discarded") ? "处理中..." : "忽略"}
                                                                        disabled={this.isActionPending(entry.id, "discarded")}
                                                                        onClick={() => void this.handleResolveEntry(entry.id, "discarded")}
                                                                    />
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div class="ingress-operator-page__empty">当前没有需要处理的 replay queue 项。</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ScrollBar>
                </div>
            </div>
        );
    },
});
