import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

export class McpRegistry {
    constructor(options = {}) {
        this.configPath = options.runtimeDir ? resolve(options.runtimeDir, "mcp-services.json") : "";
        this.thirdPartyAgreementAccepted = false;
        this.enabledStates = {};
        this.customServices = [];
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
            id: normalizedId,
            name: normalizedId,
            description: description.trim() || inferServiceDescription(serviceConfig),
            jsonConfig: JSON.stringify(parsedConfig, null, 2),
        };
    }

    async getServicesResponse() {
        await this.ensureLoaded();
        return {
            success: true,
            services: this.getServices(),
            runtimeReady: true,
            thirdPartyAgreementAccepted: this.thirdPartyAgreementAccepted,
        };
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
        await this.persist();
        return this.getServicesResponse();
    }
}
