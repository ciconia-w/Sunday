import { computed, defineComponent, onMounted, ref } from "vue";
import ComboBox from "@/components/combobox/ComboBox";
import TextButton from "@/components/TextButton";
import ScrollBar from "@/components/ScrollBar";
import { useMcpServicesStore, useBackendStore, useNotifyStore } from "@/stores";
import { ComboBoxDropdownAlign, type ComboboxOption } from "@/types/combobox";
import {
    MCP_SERVICE_CATEGORY,
    MCP_SERVICE_EDITOR_MODE,
    MCP_SERVICE_FILTER,
    type McpServiceEditorMode,
    type McpServiceDraft,
    type McpServiceFilter,
} from "@/types/mcp-service";
import McpServiceEditorDialog from "@/views/window/mainwindow/page/settings/mcpservices/components/McpServiceEditorDialog";
import ToolManagementList from "@/views/window/mainwindow/page/settings/common/components/ToolManagementList";
import { convertMcpServiceToToolItem } from "@/views/window/mainwindow/page/settings/common/types";

export default defineComponent({
    name: "McpServicesPage",

    components: {
        ComboBox,
        ScrollBar,
        McpServiceEditorDialog,
        ToolManagementList,
    },

    setup() {
        const mcpServicesStore = useMcpServicesStore();
        const backendStore = useBackendStore();
        const notifyStore = useNotifyStore();

        const currentFilter = ref<McpServiceFilter>(MCP_SERVICE_FILTER.ALL);
        const dialogVisible = ref(false);
        const dialogMode = ref<McpServiceEditorMode>(MCP_SERVICE_EDITOR_MODE.ADD);
        const editingServiceId = ref("");
        const dialogSubmitError = ref("");
        const filterOptions = computed<ComboboxOption[]>(() => {
            return [
                {
                    value: MCP_SERVICE_FILTER.ALL,
                    label: backendStore.translate("全部"),
                },
                {
                    value: MCP_SERVICE_FILTER.BUILT_IN,
                    label: backendStore.translate("仅看内置"),
                },
                {
                    value: MCP_SERVICE_FILTER.CUSTOM,
                    label: backendStore.translate("仅看自定义"),
                },
            ];
        });

        const editingService = computed(() => {
            return mcpServicesStore.services.find((service) => service.id === editingServiceId.value) || null;
        });

        const filteredServices = computed(() => {
            const orderedServices = [...mcpServicesStore.services].sort((leftService, rightService) => {
                const categoryOrderMap = {
                    [MCP_SERVICE_CATEGORY.SYSTEM_BUILT_IN]: 0,
                    [MCP_SERVICE_CATEGORY.THIRD_PARTY_BUILT_IN]: 1,
                    [MCP_SERVICE_CATEGORY.CUSTOM]: 2,
                };

                const categoryDiff = categoryOrderMap[leftService.category] - categoryOrderMap[rightService.category];

                if (categoryDiff !== 0) {
                    return categoryDiff;
                }

                return leftService.name.localeCompare(rightService.name);
            });

            if (currentFilter.value === MCP_SERVICE_FILTER.BUILT_IN) {
                return orderedServices.filter((service) => service.isBuiltIn);
            }

            if (currentFilter.value === MCP_SERVICE_FILTER.CUSTOM) {
                return orderedServices.filter((service) => !service.isBuiltIn);
            }

            return orderedServices;
        });

        const runtimeCounts = computed(() => {
            return mcpServicesStore.services.reduce(
                (summary, service) => {
                    const runtimeStatus = service.runtimeStatus || "connecting";
                    if (runtimeStatus === "ready") {
                        summary.ready += 1;
                    } else if (runtimeStatus === "error") {
                        summary.error += 1;
                    } else if (runtimeStatus === "disabled") {
                        summary.disabled += 1;
                    } else {
                        summary.connecting += 1;
                    }
                    return summary;
                },
                { ready: 0, error: 0, disabled: 0, connecting: 0 },
            );
        });

        // 转换为通用列表组件格式
        const toolItems = computed(() => {
            return filteredServices.value.map(convertMcpServiceToToolItem);
        });

        const dialogDraft = computed<McpServiceDraft | null>(() => {
            if (!editingService.value) {
                return null;
            }

            return {
                id: editingService.value.id,
                description: editingService.value.description,
                jsonConfig: editingService.value.jsonConfig || "",
            };
        });

        const loadPageData = async () => {
            if (mcpServicesStore.isLoaded) {
                void mcpServicesStore.refreshRuntimeState({ failSilently: true });
                return;
            }

            await mcpServicesStore.loadPageData().catch(() => undefined);
        };

        const handleFilterChange = (filterValue: McpServiceFilter) => {
            currentFilter.value = filterValue;
        };

        const handleFilterOptionClick = (option: ComboboxOption) => {
            handleFilterChange(option.value as McpServiceFilter);
        };

        const openDialog = (mode: McpServiceEditorMode, serviceId = "") => {
            dialogMode.value = mode;
            editingServiceId.value = serviceId;
            dialogSubmitError.value = "";
            dialogVisible.value = true;
        };

        const handleAddService = () => {
            openDialog(MCP_SERVICE_EDITOR_MODE.ADD);
        };

        const handleEditService = (serviceId: string) => {
            openDialog(MCP_SERVICE_EDITOR_MODE.EDIT, serviceId);
        };

        const handleDialogClose = () => {
            dialogVisible.value = false;
            editingServiceId.value = "";
            dialogSubmitError.value = "";
        };

        const handleSaveService = async (draft: McpServiceDraft) => {
            try {
                await mcpServicesStore.saveCustomService(draft);
                handleDialogClose();
            } catch (error) {
                dialogSubmitError.value =
                    error instanceof Error
                        ? error.message
                        : backendStore.translate("保存失败，请稍后重试。");
            }
        };

        const handleDeleteService = async (serviceId: string) => {
            const targetService = mcpServicesStore.services.find((service) => service.id === serviceId);

            if (!targetService) {
                return;
            }

            const result = await notifyStore.showDialog({
                title: `${backendStore.translate("确认删除")} ${targetService.name} ?`,
                content: backendStore.translate("删除后该服务将不可用，请谨慎操作。"),
                buttons: [
                    { key: "cancel", text: backendStore.translate("取消"), type: "default" },
                    { key: "confirm", text: backendStore.translate("删除"), type: "danger" },
                ],
            });

            if (result.key !== "confirm") {
                return;
            }

            await mcpServicesStore.deleteCustomService(serviceId).catch(() => undefined);
        };

        const handleToggleService = async (serviceId: string, enabled: boolean) => {
            await mcpServicesStore.toggleService(serviceId, enabled).catch(() => undefined);
        };

        const handleRefreshRuntime = async () => {
            try {
                await mcpServicesStore.refreshRuntimeState();
                notifyStore.showToast({ type: "success", message: "MCP 服务状态已刷新", duration: 1800 });
            } catch (error) {
                notifyStore.showToast({
                    type: "error",
                    message: error instanceof Error ? error.message : "刷新 MCP 服务状态失败，请稍后重试。",
                    duration: 2600,
                });
            }
        };

        onMounted(() => {
            void loadPageData();
        });

        const titleText = computed(() => {
            return backendStore.translate("MCP 服务");
        });
        const subtitleText = computed(() => {
            return backendStore.translate("查看每个 MCP 服务的运行状态、工具预览和配置错误。");
        });
        const addButtonText = computed(() => {
            return backendStore.translate("添加 MCP 服务");
        });
        const refreshButtonText = computed(() => {
            return mcpServicesStore.isRefreshingRuntime
                ? backendStore.translate("刷新中...")
                : backendStore.translate("刷新状态");
        });
        const runtimeSummaryText = computed(() => {
            if (mcpServicesStore.isRefreshingRuntime) {
                return backendStore.translate("正在刷新每个服务的运行状态和工具列表。");
            }

            if (mcpServicesStore.runtimeRefreshError) {
                return mcpServicesStore.runtimeRefreshError;
            }

            if (!mcpServicesStore.services.length) {
                return backendStore.translate("暂无 MCP 服务。");
            }

            if (runtimeCounts.value.error > 0) {
                return backendStore.translate(`有 ${runtimeCounts.value.error} 个服务需要处理，展开条目可查看原因。`);
            }

            if (runtimeCounts.value.connecting > 0) {
                return backendStore.translate(`有 ${runtimeCounts.value.connecting} 个服务等待检测。`);
            }

            return backendStore.translate(`已就绪 ${runtimeCounts.value.ready} 个服务，可直接查看工具预览。`);
        });
        const runtimeBadges = computed(() => {
            return [
                { key: "ready", text: `${backendStore.translate("已就绪")} ${runtimeCounts.value.ready}`, tone: "success" },
                { key: "error", text: `${backendStore.translate("异常")} ${runtimeCounts.value.error}`, tone: "error" },
                { key: "connecting", text: `${backendStore.translate("待检测")} ${runtimeCounts.value.connecting}`, tone: "warning" },
                { key: "disabled", text: `${backendStore.translate("已停用")} ${runtimeCounts.value.disabled}`, tone: "neutral" },
            ];
        });

        return {
            mcpServicesStore,
            currentFilter,
            filterOptions,
            toolItems,
            dialogVisible,
            dialogMode,
            editingService,
            dialogDraft,
            dialogSubmitError,
            titleText,
            subtitleText,
            addButtonText,
            refreshButtonText,
            runtimeSummaryText,
            runtimeBadges,
            handleFilterOptionClick,
            handleAddService,
            handleEditService,
            handleDialogClose,
            handleSaveService,
            handleDeleteService,
            handleToggleService,
            handleRefreshRuntime,
        };
    },

    render() {
        return (
            <div class="mcp-services-page">
                <div class="mcp-services-page__header-container">
                    <div class="mcp-services-page__container">
                        <div class="mcp-services-page__header">
                            <div class="mcp-services-page__header-left">
                                <div class="mcp-services-page__header-content">
                                    <div class="mcp-services-page__title">{this.titleText}</div>
                                    <div class="mcp-services-page__subtitle">{this.subtitleText}</div>
                                </div>
                            </div>

                            <div class="mcp-services-page__actions">
                                <TextButton
                                    text={this.refreshButtonText}
                                    onClick={this.handleRefreshRuntime}
                                    disabled={this.mcpServicesStore.isRefreshingRuntime}
                                />
                                <TextButton text={this.addButtonText} onClick={this.handleAddService} />
                                <ComboBox
                                    dropdownAlign={ComboBoxDropdownAlign.Right}
                                    onClickOption={this.handleFilterOptionClick}
                                    options={this.filterOptions}
                                    value={this.currentFilter}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mcp-services-page__content">
                    <ScrollBar class="mcp-services-page__scroll" edgeBounce momentum>
                        <div class="mcp-services-page__content-container">
                            <div class="mcp-services-page__container">
                                <section class="mcp-services-page__section">
                                    <div class="mcp-services-page__runtime-summary" data-mcp-runtime-summary>
                                        <div class="mcp-services-page__runtime-summary-copy">
                                            <div class="mcp-services-page__runtime-summary-title">运行时状态</div>
                                            <div class="mcp-services-page__runtime-summary-description">
                                                {this.runtimeSummaryText}
                                            </div>
                                        </div>
                                        <div class="mcp-services-page__runtime-summary-badges">
                                            {this.runtimeBadges.map((badge) => (
                                                <span
                                                    class={[
                                                        "mcp-services-page__runtime-badge",
                                                        `mcp-services-page__runtime-badge--${badge.tone}`,
                                                    ]}
                                                    key={badge.key}
                                                >
                                                    {badge.text}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <ToolManagementList
                                        isLoading={this.mcpServicesStore.isLoading}
                                        items={this.toolItems}
                                        showEditButton={true}
                                        loadingText="正在加载 MCP 服务..."
                                        emptyText="暂无 MCP 服务。"
                                        onToggleItem={this.handleToggleService}
                                        onEditItem={this.handleEditService}
                                        onDeleteItem={this.handleDeleteService}
                                    />
                                </section>
                            </div>
                        </div>
                    </ScrollBar>
                </div>

                <McpServiceEditorDialog
                    initialDraft={this.dialogDraft}
                    mode={this.dialogMode}
                    onClose={this.handleDialogClose}
                    onSaveService={this.handleSaveService}
                    serviceName={this.editingService?.name || ""}
                    submitError={this.dialogSubmitError}
                    visible={this.dialogVisible}
                />
            </div>
        );
    },
});
