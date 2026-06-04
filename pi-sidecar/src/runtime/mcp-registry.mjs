import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { probeStdioMcpServer } from "./mcp-runtime-probe.mjs";

const BUILT_IN_FILESYSTEM_TOOLS = [
    { name: "read_file", description: "Read a file as text." },
    { name: "read_text_file", description: "Read a text file with head/tail support." },
    { name: "read_media_file", description: "Read image or audio data." },
    { name: "read_multiple_files", description: "Read multiple files in one request." },
    { name: "write_file", description: "Create or overwrite a file." },
    { name: "edit_file", description: "Apply targeted edits to a file." },
    { name: "create_directory", description: "Create a directory if needed." },
    { name: "list_directory", description: "List directory contents." },
    { name: "list_directory_with_sizes", description: "List directory contents with sizes." },
    { name: "directory_tree", description: "Inspect a recursive directory tree." },
    { name: "move_file", description: "Move or rename a file or directory." },
    { name: "search_files", description: "Search files by pattern." },
    { name: "get_file_info", description: "Inspect file metadata." },
    { name: "list_allowed_directories", description: "Show allowed filesystem roots." },
];

const BUILT_IN_SERVICES = [
    {
        id: "filesystem",
        name: "Filesystem",
        description: "Local filesystem access for the agent runtime.",
        category: "systemBuiltIn",
        enabled: true,
        isBuiltIn: true,
        editable: false,
        removable: false,
    },
];

const MCP_RUNTIME_STATUS = {
    DISABLED: "disabled",
    READY: "ready",
    CONNECTING: "connecting",
    ERROR: "error",
};

const MCP_TRANSPORT_KIND = {
    BUILTIN: "builtin",
    STDIO: "stdio",
    URL: "url",
    UNKNOWN: "unknown",
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCustomServiceRecord(record) {
    if (!isPlainObject(record)) {
        return null;
    }

    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : id;
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const jsonConfig = typeof record.jsonConfig === "string" ? record.jsonConfig : "";

    if (!id || !jsonConfig) {
        return null;
    }

    return {
        id,
        name: name || id,
        description,
        jsonConfig,
    };
}

function inferServiceDescription(serviceConfig) {
    if (typeof serviceConfig?.command === "string" && serviceConfig.command.trim()) {
        return `Command: ${serviceConfig.command.trim()}`;
    }

    if (typeof serviceConfig?.url === "string" && serviceConfig.url.trim()) {
        return `URL: ${serviceConfig.url.trim()}`;
    }

    return "Custom MCP service configuration.";
}

function parseServiceConfigDraft(jsonConfig) {
    let parsedConfig;
    try {
        parsedConfig = JSON.parse(jsonConfig);
    } catch (_error) {
        throw new Error("JSON 配置格式不合法，请检查后重试。");
    }

    const servers = parsedConfig?.mcpServers;
    if (!isPlainObject(servers)) {
        throw new Error("JSON 配置缺少 mcpServers 对象。");
    }

    const entries = Object.entries(servers);
    if (entries.length !== 1) {
        throw new Error("当前仅支持每次保存一个 MCP 服务配置。");
    }

    const [serviceId, serviceConfig] = entries[0];
    const normalizedId = typeof serviceId === "string" ? serviceId.trim() : "";
    if (!normalizedId) {
        throw new Error("MCP 服务 ID 不能为空。");
    }

    if (!isPlainObject(serviceConfig)) {
        throw new Error("MCP 服务配置必须是对象。");
    }

    return {
        serviceId: normalizedId,
        serviceConfig,
        normalizedJsonConfig: JSON.stringify(parsedConfig, null, 2),
    };
}

function inferTransportKind(serviceConfig) {
    if (typeof serviceConfig?.command === "string" && serviceConfig.command.trim()) {
        return MCP_TRANSPORT_KIND.STDIO;
    }

    if (typeof serviceConfig?.url === "string" && serviceConfig.url.trim()) {
        return MCP_TRANSPORT_KIND.URL;
    }

    return MCP_TRANSPORT_KIND.UNKNOWN;
}

function buildToolPreview(tools, limit = 6) {
    return (Array.isArray(tools) ? tools : [])
        .map((tool) => ({
            name: typeof tool?.name === "string" ? tool.name.trim() : "",
            description: typeof tool?.description === "string" ? tool.description.trim() : "",
        }))
        .filter((tool) => tool.name)
        .slice(0, limit);
}

function classifyProbeFailure(error) {
    const message = error instanceof Error ? error.message.trim() : String(error || "").trim();
    const lowerMessage = message.toLowerCase();

    if (!message) {
        return {
            runtimeStatusText: "启动失败",
            runtimeDetail: "MCP 服务启动失败，请检查配置后重试。",
        };
    }

    if (message.includes("缺少 command") || message.includes("配置")) {
        return {
            runtimeStatusText: "配置错误",
            runtimeDetail: message,
        };
    }

    if (lowerMessage.includes("enoent") || lowerMessage.includes("command not found")) {
        return {
            runtimeStatusText: "命令不存在",
            runtimeDetail: message,
        };
    }

    if (lowerMessage.includes("timed out")) {
        return {
            runtimeStatusText: "启动超时",
            runtimeDetail: message,
        };
    }

    return {
        runtimeStatusText: "启动失败",
        runtimeDetail: message,
    };
}

function buildBuiltInRuntimeSnapshot(enabled, previousState = null) {
    return {
        runtimeStatus: enabled ? MCP_RUNTIME_STATUS.READY : MCP_RUNTIME_STATUS.DISABLED,
        runtimeStatusText: enabled ? "已就绪" : "已停用",
        runtimeDetail: enabled
            ? "内置文件系统服务已就绪，可直接访问本地文件。"
            : "启用后可恢复本地文件访问能力。",
        transportKind: MCP_TRANSPORT_KIND.BUILTIN,
        toolPreview: buildToolPreview(previousState?.toolPreview?.length ? previousState.toolPreview : BUILT_IN_FILESYSTEM_TOOLS),
        toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0
            ? previousState.toolCount
            : BUILT_IN_FILESYSTEM_TOOLS.length,
        lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
    };
}

function buildDisabledRuntimeSnapshot(transportKind, previousState = null) {
    return {
        runtimeStatus: MCP_RUNTIME_STATUS.DISABLED,
        runtimeStatusText: "已停用",
        runtimeDetail: "启用后才会参与运行时检测。",
        transportKind,
        toolPreview: buildToolPreview(previousState?.toolPreview),
        toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
        lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
    };
}

export class McpRegistry {
    constructor(options = {}) {
        this.configPath = options.runtimeDir ? resolve(options.runtimeDir, "mcp-services.json") : "";
        this.thirdPartyAgreementAccepted = false;
        this.enabledStates = {};
        this.customServices = [];
        this.runtimeStates = {};
        this.runtimeRefreshPromise = null;
        this.loaded = false;
        this.loadingPromise = null;
    }

    async ensureLoaded() {
        if (this.loaded) {
            return;
        }

        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        this.loadingPromise = (async () => {
            if (!this.configPath) {
                this.loaded = true;
                return;
            }

            try {
                const raw = await readFile(this.configPath, "utf8");
                const parsed = JSON.parse(raw);
                this.thirdPartyAgreementAccepted = parsed?.thirdPartyAgreementAccepted === true;
                this.enabledStates = isPlainObject(parsed?.enabledStates) ? { ...parsed.enabledStates } : {};
                this.customServices = Array.isArray(parsed?.customServices)
                    ? parsed.customServices
                        .map(normalizeCustomServiceRecord)
                        .filter(Boolean)
                    : [];
            } catch (error) {
                if (error?.code !== "ENOENT") {
                    console.warn("[mcp-registry] Failed to load saved MCP services", error);
                }
            }

            this.loaded = true;
        })();

        try {
            await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    buildBuiltInService(service) {
        const enabledOverride = this.enabledStates[service.id];

        return {
            ...clone(service),
            enabled: typeof enabledOverride === "boolean" ? enabledOverride : service.enabled,
        };
    }

    buildCustomService(service) {
        const enabledOverride = this.enabledStates[service.id];

        return {
            ...clone(service),
            category: "custom",
            enabled: typeof enabledOverride === "boolean" ? enabledOverride : true,
            isBuiltIn: false,
            editable: true,
            removable: true,
        };
    }

    getServices() {
        return [
            ...BUILT_IN_SERVICES.map((service) => this.buildBuiltInService(service)),
            ...this.customServices.map((service) => this.buildCustomService(service)),
        ];
    }

    async persist() {
        if (!this.configPath) {
            return;
        }

        await mkdir(dirname(this.configPath), { recursive: true });
        await writeFile(
            this.configPath,
            JSON.stringify(
                {
                    version: 1,
                    thirdPartyAgreementAccepted: this.thirdPartyAgreementAccepted,
                    enabledStates: this.enabledStates,
                    customServices: this.customServices,
                },
                null,
                2,
            ),
            "utf8",
        );
    }

    parseServiceDraft(jsonConfig, description) {
        const { serviceId, serviceConfig, normalizedJsonConfig } = parseServiceConfigDraft(jsonConfig);
        return {
            id: serviceId,
            name: serviceId,
            description: description.trim() || inferServiceDescription(serviceConfig),
            jsonConfig: normalizedJsonConfig,
        };
    }

    dropRuntimeState(serviceId) {
        if (!serviceId) {
            return;
        }

        delete this.runtimeStates[serviceId];
    }

    getBaseRuntimeSnapshot(service, previousState = null) {
        if (service.isBuiltIn) {
            return buildBuiltInRuntimeSnapshot(service.enabled !== false, previousState);
        }

        let parsedDraft = null;
        try {
            parsedDraft = parseServiceConfigDraft(service.jsonConfig || "");
        } catch (error) {
            if (service.enabled === false) {
                return buildDisabledRuntimeSnapshot(MCP_TRANSPORT_KIND.UNKNOWN, previousState);
            }

            return {
                runtimeStatus: MCP_RUNTIME_STATUS.ERROR,
                runtimeStatusText: "配置错误",
                runtimeDetail: error instanceof Error ? error.message : String(error),
                transportKind: MCP_TRANSPORT_KIND.UNKNOWN,
                toolPreview: buildToolPreview(previousState?.toolPreview),
                toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
                lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
            };
        }

        const transportKind = inferTransportKind(parsedDraft.serviceConfig);
        if (service.enabled === false) {
            return buildDisabledRuntimeSnapshot(transportKind, previousState);
        }

        if (transportKind === MCP_TRANSPORT_KIND.URL) {
            return {
                runtimeStatus: MCP_RUNTIME_STATUS.ERROR,
                runtimeStatusText: "暂不支持",
                runtimeDetail: "当前仅支持 stdio 类型的 MCP 服务运行时检测。",
                transportKind,
                toolPreview: buildToolPreview(previousState?.toolPreview),
                toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
                lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
            };
        }

        if (transportKind !== MCP_TRANSPORT_KIND.STDIO) {
            return {
                runtimeStatus: MCP_RUNTIME_STATUS.ERROR,
                runtimeStatusText: "配置错误",
                runtimeDetail: "MCP 服务缺少可执行命令或 URL 配置。",
                transportKind,
                toolPreview: buildToolPreview(previousState?.toolPreview),
                toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
                lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
            };
        }

        return {
            runtimeStatus: MCP_RUNTIME_STATUS.CONNECTING,
            runtimeStatusText: "待检测",
            runtimeDetail: "点击“刷新状态”后将尝试启动服务并读取工具列表。",
            transportKind,
            toolPreview: buildToolPreview(previousState?.toolPreview),
            toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
            lastCheckedAt: typeof previousState?.lastCheckedAt === "string" ? previousState.lastCheckedAt : "",
        };
    }

    decorateService(service) {
        const runtimeSnapshot = this.runtimeStates[service.id]
            ? {
                ...this.getBaseRuntimeSnapshot(service, this.runtimeStates[service.id]),
                ...clone(this.runtimeStates[service.id]),
            }
            : this.getBaseRuntimeSnapshot(service);

        return {
            ...clone(service),
            ...runtimeSnapshot,
        };
    }

    buildServicesResponse() {
        return {
            success: true,
            services: this.getServices().map((service) => this.decorateService(service)),
            runtimeReady: true,
            thirdPartyAgreementAccepted: this.thirdPartyAgreementAccepted,
        };
    }

    async getServicesResponse() {
        await this.ensureLoaded();
        return this.buildServicesResponse();
    }

    isRuntimeReady() {
        return true;
    }

    async getThirdPartyAgreement() {
        await this.ensureLoaded();
        return this.thirdPartyAgreementAccepted;
    }

    async setThirdPartyAgreement(accepted) {
        await this.ensureLoaded();
        this.thirdPartyAgreementAccepted = accepted === true;
        await this.persist();
        return true;
    }

    async setServiceEnabled(serviceId, enabled) {
        await this.ensureLoaded();
        const hasService = this.getServices().some((service) => service.id === serviceId);

        if (!hasService) {
            throw new Error("MCP 服务不存在。");
        }

        this.enabledStates[serviceId] = enabled === true;
        if (enabled !== true) {
            this.dropRuntimeState(serviceId);
        }
        await this.persist();
        return this.getServicesResponse();
    }

    async saveService(jsonConfig, description, serviceId = "") {
        await this.ensureLoaded();

        const nextService = this.parseServiceDraft(jsonConfig, description);
        const existingCustomIndex = this.customServices.findIndex((service) => service.id === serviceId);
        const duplicateService = this.getServices().find((service) => service.id === nextService.id);

        if (!serviceId) {
            if (duplicateService) {
                throw new Error(`MCP 服务 "${nextService.id}" 已存在。`);
            }

            this.customServices.push(nextService);
            this.enabledStates[nextService.id] = true;
            this.dropRuntimeState(nextService.id);
        } else {
            if (existingCustomIndex < 0) {
                throw new Error("只能编辑自定义 MCP 服务。");
            }

            if (duplicateService && duplicateService.id !== serviceId) {
                throw new Error(`MCP 服务 "${nextService.id}" 已存在。`);
            }

            const previousService = this.customServices[existingCustomIndex];
            const previousEnabledState = this.enabledStates[serviceId];
            this.customServices.splice(existingCustomIndex, 1, nextService);
            this.dropRuntimeState(serviceId);
            this.dropRuntimeState(nextService.id);

            if (nextService.id !== serviceId) {
                delete this.enabledStates[serviceId];
                this.enabledStates[nextService.id] =
                    typeof previousEnabledState === "boolean" ? previousEnabledState : previousService.enabled !== false;
            }
        }

        await this.persist();
        return this.getServicesResponse();
    }

    async deleteService(serviceId) {
        await this.ensureLoaded();

        const nextCustomServices = this.customServices.filter((service) => service.id !== serviceId);
        if (nextCustomServices.length === this.customServices.length) {
            throw new Error("只能删除自定义 MCP 服务。");
        }

        this.customServices = nextCustomServices;
        delete this.enabledStates[serviceId];
        this.dropRuntimeState(serviceId);
        await this.persist();
        return this.getServicesResponse();
    }

    async probeServiceRuntime(service) {
        const previousState = this.runtimeStates[service.id] ?? null;
        const baseSnapshot = this.getBaseRuntimeSnapshot(service, previousState);

        if (baseSnapshot.runtimeStatus !== MCP_RUNTIME_STATUS.CONNECTING) {
            return baseSnapshot;
        }

        try {
            const { serviceConfig } = parseServiceConfigDraft(service.jsonConfig || "");
            const result = await probeStdioMcpServer(serviceConfig, { timeoutMs: 10000 });
            const toolPreview = buildToolPreview(result.tools);
            return {
                runtimeStatus: MCP_RUNTIME_STATUS.READY,
                runtimeStatusText: "已就绪",
                runtimeDetail: `通过 stdio 检出 ${result.toolCount} 个工具。`,
                transportKind: MCP_TRANSPORT_KIND.STDIO,
                toolPreview,
                toolCount: Number.isFinite(result.toolCount) ? result.toolCount : toolPreview.length,
                lastCheckedAt: new Date().toISOString(),
            };
        } catch (error) {
            const classifiedFailure = classifyProbeFailure(error);
            return {
                runtimeStatus: MCP_RUNTIME_STATUS.ERROR,
                runtimeStatusText: classifiedFailure.runtimeStatusText,
                runtimeDetail: classifiedFailure.runtimeDetail,
                transportKind: MCP_TRANSPORT_KIND.STDIO,
                toolPreview: buildToolPreview(previousState?.toolPreview),
                toolCount: Number.isFinite(previousState?.toolCount) && previousState.toolCount > 0 ? previousState.toolCount : 0,
                lastCheckedAt: new Date().toISOString(),
            };
        }
    }

    async refreshRuntimeState() {
        await this.ensureLoaded();

        if (this.runtimeRefreshPromise) {
            return this.runtimeRefreshPromise;
        }

        this.runtimeRefreshPromise = (async () => {
            const services = this.getServices();
            const entries = await Promise.all(
                services.map(async (service) => [service.id, await this.probeServiceRuntime(service)]),
            );
            this.runtimeStates = Object.fromEntries(entries);
            return this.buildServicesResponse();
        })();

        try {
            return await this.runtimeRefreshPromise;
        } finally {
            this.runtimeRefreshPromise = null;
        }
    }
}
