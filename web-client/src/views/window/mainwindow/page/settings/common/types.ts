import type { McpService } from "@/types/mcp-service";

export const TOOL_STATUS_TONE = {
    NEUTRAL: "neutral",
    SUCCESS: "success",
    WARNING: "warning",
    ERROR: "error",
} as const;

export type ToolStatusTone =
    (typeof TOOL_STATUS_TONE)[keyof typeof TOOL_STATUS_TONE];

/**
 * 工具管理项基础接口
 * 用于 MCP 服务和 Skills 的通用列表展示
 *
 * 注意：这是一个前端适配层接口，后端数据需要转换为此格式
 */
export interface ToolManagementItem {
    /** 唯一标识（MCP用id，Skills用name） */
    id: string;
    /** 名称（不翻译） */
    name: string;
    /** 简介/描述（不翻译） */
    description: string;
    /** 是否启用 */
    enabled: boolean;
    /** 开关是否禁用，仅展示状态不允许直接切换 */
    toggleDisabled?: boolean;
    /** 是否为内置项 */
    isBuiltIn: boolean;
    /** 是否可编辑 */
    editable: boolean;
    /** 是否可删除 */
    removable: boolean;
    /** 附加状态文案 */
    statusText?: string;
    /** 状态语义 */
    statusTone?: ToolStatusTone;
    /** 详情文案 */
    detailText?: string;
    /** 工具预览 */
    toolPreview?: string[];
    /** 工具总数 */
    toolCount?: number;
    /** 主动作文案 */
    actionText?: string;
    /** 主动作是否禁用 */
    actionDisabled?: boolean;
}

export type ToolManagementCustomActionResolver<T> = T | ((item: ToolManagementItem) => T);

export interface ToolManagementCustomAction {
    /** 自定义按钮图标 */
    icon: ToolManagementCustomActionResolver<string>;
    /** 自定义按钮点击事件 */
    onClick: (item: ToolManagementItem, event: MouseEvent) => void;
    /** 自定义按钮 tooltip */
    tooltip?: ToolManagementCustomActionResolver<string | undefined>;
    /** 自定义按钮图标尺寸 */
    iconSize?: ToolManagementCustomActionResolver<[number, number]>;
    /** 是否显示自定义按钮 */
    visible?: ToolManagementCustomActionResolver<boolean>;
    /** 是否禁用自定义按钮 */
    disabled?: ToolManagementCustomActionResolver<boolean>;
}

/**
 * 将 MCP 服务数据转换为 ToolManagementItem 格式
 * MCP 服务结构与 ToolManagementItem 几乎一致，直接转换即可
 */
export function convertMcpServiceToToolItem(service: McpService): ToolManagementItem {
    let statusTone: ToolStatusTone | undefined;
    if (service.runtimeStatus === "ready") {
        statusTone = TOOL_STATUS_TONE.SUCCESS;
    } else if (service.runtimeStatus === "error") {
        statusTone = TOOL_STATUS_TONE.ERROR;
    } else if (service.runtimeStatus === "connecting") {
        statusTone = TOOL_STATUS_TONE.WARNING;
    } else if (service.runtimeStatus === "disabled") {
        statusTone = TOOL_STATUS_TONE.NEUTRAL;
    }

    return {
        id: service.id,
        name: service.name,
        description: service.description,
        enabled: service.enabled,
        isBuiltIn: service.isBuiltIn,
        editable: service.editable,
        removable: service.removable,
        statusText: service.runtimeStatusText,
        statusTone,
        detailText: service.runtimeDetail,
        toolPreview: Array.isArray(service.toolPreview) ? service.toolPreview.map((tool) => tool.name).filter(Boolean) : [],
        toolCount: Number.isFinite(service.toolCount) ? service.toolCount : 0,
    };
}

/**
 * 将 Skills 数据转换为 ToolManagementItem 格式的辅助函数
 */
export interface SkillRawItem {
    name: string;
    description: string;
    path: string;
    source: string;
    enabled: boolean;
}

export interface CliToolItem {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    latestVersion?: string;
    updateAvailable?: boolean;
    statusText?: string;
    statusTone?: ToolStatusTone;
    detailText?: string;
    actionText?: string;
    actionDisabled?: boolean;
    actionKind?: string;
    actionPayload?: string;
    actionCommand?: string;
}

export function convertSkillToToolItem(skill: SkillRawItem): ToolManagementItem {
    const isBuiltInSkill = skill.source === "builtin";
    const sourceText = skill.source === "repo"
        ? "仓库"
        : skill.source === "local"
            ? "本地"
            : undefined;

    return {
        id: skill.name,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        isBuiltIn: isBuiltInSkill,
        editable: !isBuiltInSkill,
        removable: skill.source === "local",
        statusText: sourceText,
        statusTone: sourceText ? TOOL_STATUS_TONE.NEUTRAL : undefined,
        detailText: skill.path,
    };
}

export function convertCliToolToToolItem(tool: CliToolItem): ToolManagementItem {
    return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        enabled: tool.enabled,
        toggleDisabled: true,
        isBuiltIn: true,
        editable: false,
        removable: false,
        statusText: tool.statusText,
        statusTone: tool.statusTone,
        detailText: tool.detailText,
        actionText: tool.actionText,
        actionDisabled: tool.actionDisabled,
    };
}
