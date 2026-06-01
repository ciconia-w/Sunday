import { computed, defineComponent, ref, watch } from "vue";
import type { PropType } from "vue";

import type { ToolUseData, ToolUseValue } from "@/types/conversation";
import { ToolUseStatus } from "@/types/conversation";
import { ButtonShape } from "@/types/button";
import { CopyDataType } from "@/types/message";

import CopyButton from "@/components/CopyButton";
import IconButton from "@/components/IconButton";
import SvgIcon from "@/components/SvgIcon";

import { useBackendStore } from "@/stores";

interface NormalizedToolUseData {
    name: string;
    status: ToolUseStatus;
    params?: ToolUseValue;
    result?: ToolUseValue;
    details?: Record<string, unknown>;
    hasParams: boolean;
    hasResult: boolean;
    summary: string;
    fullOutputPath: string;
}

const getToolTargetPath = (name: string, params: unknown): string => {
    const normalizedName = name.trim().toLowerCase();
    if (!["read", "write", "edit"].includes(normalizedName)) {
        return "";
    }

    return getRecordString(params, ["path", "file_path", "target_path"]);
};

const getBashCommand = (name: string, params: unknown): string => {
    const normalizedName = name.trim().toLowerCase();
    if (normalizedName !== "bash") {
        return "";
    }

    return getRecordString(params, ["command", "cmd"]);
};

const extractFullOutputPathFromText = (value: unknown): string => {
    const text = collectTextFromToolValue(value);
    if (!text) {
        return "";
    }

    const match = text.match(/Full output:\s*([^\s\]]+)/i);
    return match?.[1]?.trim() ?? "";
};

const getToolFullOutputPath = (name: string, result: unknown, details: unknown): string => {
    const normalizedName = name.trim().toLowerCase();
    if (normalizedName !== "bash") {
        return "";
    }

    if (isPlainObject(details)) {
        const fullOutputPath = details.fullOutputPath;
        if (typeof fullOutputPath === "string" && fullOutputPath.trim()) {
            return fullOutputPath.trim();
        }
    }

    return extractFullOutputPathFromText(result);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return Object.prototype.toString.call(value) === "[object Object]";
};

const isEmptyValue = (value: unknown): boolean => {
    if (value === undefined || value === null || value === "") {
        return true;
    }

    if (Array.isArray(value)) {
        return value.length === 0;
    }

    if (isPlainObject(value)) {
        return Object.keys(value).length === 0;
    }

    return false;
};

const normalizeStatus = (status: unknown): ToolUseStatus => {
    if (typeof status === "number" && status >= ToolUseStatus.Calling && status <= ToolUseStatus.Canceled) {
        return status;
    }

    if (typeof status === "string") {
        const normalized = status.trim().toLowerCase();
        if (normalized === "completed" || normalized === "complete" || normalized === "success") {
            return ToolUseStatus.Completed;
        }
        if (normalized === "failed" || normalized === "error") {
            return ToolUseStatus.Failed;
        }
        if (normalized === "canceled" || normalized === "cancelled") {
            return ToolUseStatus.Canceled;
        }
    }

    return ToolUseStatus.Calling;
};

const formatToolUseValue = (value: unknown): string => {
    if (isEmptyValue(value)) {
        return "";
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }

        try {
            return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
            return value;
        }
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const truncateText = (value: string, maxLength = 96): string => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
};

const collectTextFromToolValue = (value: unknown): string => {
    if (isEmptyValue(value)) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => collectTextFromToolValue(item))
            .filter(Boolean)
            .join(" ");
    }

    if (isPlainObject(value)) {
        const maybeContent = value.content;
        if (Array.isArray(maybeContent)) {
            const text = maybeContent
                .map((item) => {
                    if (isPlainObject(item) && typeof item.text === "string") {
                        return item.text;
                    }
                    return collectTextFromToolValue(item);
                })
                .filter(Boolean)
                .join(" ");
            if (text) {
                return text;
            }
        }

        return Object.values(value)
            .map((item) => collectTextFromToolValue(item))
            .filter(Boolean)
            .join(" ");
    }

    return String(value);
};

const getRecordString = (value: unknown, keys: string[]): string => {
    if (!isPlainObject(value)) {
        return "";
    }

    for (const key of keys) {
        const item = value[key];
        if (typeof item === "string" && item.trim()) {
            return item.trim();
        }
    }

    return "";
};

const summarizeToolUse = (name: string, status: ToolUseStatus, params: unknown, result: unknown): string => {
    const normalizedName = name.trim().toLowerCase();
    const paramsPath = getRecordString(params, ["path", "file_path", "target_path"]);
    const resultText = truncateText(collectTextFromToolValue(result));

    if (normalizedName === "bash") {
        const command = truncateText(getRecordString(params, ["command", "cmd"]));
        if (status === ToolUseStatus.Calling) {
            return command ? `Running ${command}` : "Running shell command";
        }
        return command ? command : resultText || "Shell command finished";
    }

    if (normalizedName === "read") {
        if (status === ToolUseStatus.Calling) {
            return paramsPath ? `Reading ${paramsPath}` : "Reading file";
        }
        return resultText || (paramsPath ? `Read ${paramsPath}` : "Read file");
    }

    if (normalizedName === "write") {
        if (status === ToolUseStatus.Calling) {
            return paramsPath ? `Writing ${paramsPath}` : "Writing file";
        }
        return resultText || (paramsPath ? `Wrote ${paramsPath}` : "Write completed");
    }

    if (normalizedName === "edit") {
        if (status === ToolUseStatus.Calling) {
            return paramsPath ? `Editing ${paramsPath}` : "Editing file";
        }
        return resultText || (paramsPath ? `Edited ${paramsPath}` : "Edit completed");
    }

    if (normalizedName === "find" || normalizedName === "grep" || normalizedName === "ls") {
        if (status === ToolUseStatus.Calling) {
            return normalizedName === "ls" ? "Listing files" : `Searching with ${normalizedName}`;
        }
        return resultText || `${name} completed`;
    }

    if (status === ToolUseStatus.Calling) {
        return `${name} in progress`;
    }

    return resultText || `${name} completed`;
};

const normalizeToolUseData = (data: ToolUseData): NormalizedToolUseData => {
    const legacyDisplayContent = isPlainObject(data.display_content) ? data.display_content : undefined;
    const params = legacyDisplayContent?.params ?? data.params;
    const result = legacyDisplayContent?.result ?? data.result;
    const name = legacyDisplayContent?.name ?? data.name ?? useBackendStore().translate("Tool Use");
    const status = normalizeStatus(legacyDisplayContent?.status ?? data.status);
    const details = isPlainObject(data.details) ? { ...data.details } : undefined;

    return {
        name,
        status,
        params,
        result,
        details,
        hasParams: !isEmptyValue(params),
        hasResult: !isEmptyValue(result),
        summary: summarizeToolUse(name, status, params, result),
        fullOutputPath: getToolFullOutputPath(name, result, details),
    };
};

const getStatusText = (status: ToolUseStatus): string => {
    switch (status) {
        case ToolUseStatus.Completed:
            return useBackendStore().translate("Completed");
        case ToolUseStatus.Failed:
            return useBackendStore().translate("Failed");
        case ToolUseStatus.Canceled:
            return useBackendStore().translate("Canceled");
        case ToolUseStatus.Calling:
        default:
            return useBackendStore().translate("Calling");
    }
};

const getStatusClassName = (status: ToolUseStatus): string => {
    switch (status) {
        case ToolUseStatus.Completed:
            return "completed";
        case ToolUseStatus.Failed:
            return "failed";
        case ToolUseStatus.Canceled:
            return "canceled";
        case ToolUseStatus.Calling:
        default:
            return "calling";
    }
};

const getStatusIconName = (status: ToolUseStatus): string => {
    switch (status) {
        case ToolUseStatus.Completed:
            return "completed";
        case ToolUseStatus.Failed:
            return "warning-red";
        case ToolUseStatus.Canceled:
            return "cancal";
        case ToolUseStatus.Calling:
        default:
            return "loading";
    }
};

export default defineComponent({
    name: "ToolUse",

    components: {
        CopyButton,
        IconButton,
        SvgIcon,
    },

    emits: {
        expandChange: (expanded: boolean) => {
            return typeof expanded === "boolean";
        },
    },

    props: {
        data: {
            type: Object as PropType<ToolUseData>,
            required: true,
        },
        className: {
            type: String,
            default: "",
        },
        defaultExpanded: {
            type: Boolean,
            default: false,
        },
        forceCollapsed: {
            type: Boolean,
            default: false,
        },
    },

    setup(props, { emit }) {
        const backendStore = useBackendStore();
        const isExpanded = ref(props.defaultExpanded);

        const normalizedData = computed(() => normalizeToolUseData(props.data));
        const hasDetails = computed(() => normalizedData.value.hasParams || normalizedData.value.hasResult);
        const formattedParams = computed(() => formatToolUseValue(normalizedData.value.params));
        const formattedResult = computed(() => formatToolUseValue(normalizedData.value.result));
        const toolTargetPath = computed(() =>
            getToolTargetPath(normalizedData.value.name, normalizedData.value.params),
        );
        const bashCommand = computed(() =>
            getBashCommand(normalizedData.value.name, normalizedData.value.params),
        );
        const bashFullOutputPath = computed(() => normalizedData.value.fullOutputPath);
        const formattedDetails = computed(() => {
            const parts: string[] = [];

            if (normalizedData.value.hasParams) {
                parts.push(`# ${useBackendStore().translate("Params")}\n${formattedParams.value}`);
            }
            if (normalizedData.value.hasResult) {
                parts.push(`# ${useBackendStore().translate("Result")}\n${formattedResult.value}`);
            }

            return parts.join("\n\n");
        });
        const canCopy = computed(() => normalizedData.value.status !== ToolUseStatus.Calling);
        const canOpenTargetFile = computed(() => Boolean(toolTargetPath.value));
        const canCopyCommand = computed(() => Boolean(bashCommand.value));
        const canOpenFullOutput = computed(() => Boolean(bashFullOutputPath.value));

        watch(() => props.forceCollapsed, (val) => {
            if (val && isExpanded.value) {
                isExpanded.value = false;
                emit("expandChange", false);
            }
        });

        const toggleExpand = (event?: Event) => {
            event?.stopPropagation();
            if (!hasDetails.value) {
                return;
            }
            isExpanded.value = !isExpanded.value;
            emit("expandChange", isExpanded.value);
        };

        const handleCopy = (event: MouseEvent) => {
            event.stopPropagation();

            const payload = JSON.stringify(
                {
                    name: normalizedData.value.name,
                    param: formattedParams.value,
                    result: formattedResult.value,
                },
                null,
                2,
            );

            backendStore.requestSystem("copyToClipboard", payload, CopyDataType.CopyText);
        };

        const handleCopyPath = (event: MouseEvent) => {
            event.stopPropagation();
            if (!toolTargetPath.value) {
                return;
            }
            backendStore.requestSystem("copyToClipboard", toolTargetPath.value, CopyDataType.CopyText);
        };

        const handleCopyCommand = (event: MouseEvent) => {
            event.stopPropagation();
            if (!bashCommand.value) {
                return;
            }
            backendStore.requestSystem("copyToClipboard", bashCommand.value, CopyDataType.CopyText);
        };

        const handleOpenFullOutput = async (event: MouseEvent) => {
            event.stopPropagation();
            if (!bashFullOutputPath.value) {
                return;
            }
            await backendStore.requestSystem("openFile", bashFullOutputPath.value);
        };

        const handleOpenTargetFile = async (event: MouseEvent) => {
            event.stopPropagation();
            if (!toolTargetPath.value) {
                return;
            }
            await backendStore.requestSystem("openFile", toolTargetPath.value);
        };

        return {
            isExpanded,
            normalizedData,
            hasDetails,
            formattedParams,
            formattedResult,
            toolTargetPath,
            bashCommand,
            bashFullOutputPath,
            formattedDetails,
            canCopy,
            canOpenTargetFile,
            canCopyCommand,
            canOpenFullOutput,
            toggleExpand,
            handleCopy,
            handleCopyPath,
            handleCopyCommand,
            handleOpenFullOutput,
            handleOpenTargetFile,
            getStatusText,
            getStatusClassName,
            ToolUseStatus,
        };
    },

    render() {
        const statusClassName = this.getStatusClassName(this.normalizedData.status);

        return (
            <div class={["tool-use", this.$props.className].filter(Boolean).join(" ")}>
                <div
                    class={["tool-use__header", this.hasDetails && "tool-use__header--interactive"]
                        .filter(Boolean)
                        .join(" ")}
                    onClick={this.hasDetails ? this.toggleExpand : undefined}
                >
                    <div class="tool-use__header-main">
                        {this.hasDetails ? (
                            <IconButton
                                class={["tool-use__expand-btn", this.isExpanded && "is-expanded"]
                                    .filter(Boolean)
                                    .join(" ")}
                                icon="icon_arrow"
                                size={[24, 24]}
                                iconSize={[12, 12]}
                                shape={ButtonShape.Rounded}
                                onClick={this.toggleExpand}
                            />
                        ) : (
                            <span class="tool-use__expand-placeholder" />
                        )}
                        <span class="tool-use__name" title={this.normalizedData.name}>
                            {this.normalizedData.name}
                        </span>
                        <span class="tool-use__summary" title={this.normalizedData.summary}>
                            {this.normalizedData.summary}
                        </span>
                        <SvgIcon
                            class={[
                                "tool-use__status-icon",
                                `tool-use__status-icon--${statusClassName}`,
                                this.normalizedData.status === this.ToolUseStatus.Calling && "is-spinning",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            icon={getStatusIconName(this.normalizedData.status)}
                            size={[16, 16]}
                        />
                        <span class="tool-use__status-text">{this.getStatusText(this.normalizedData.status)}</span>
                    </div>

                    {this.canCopy && (
                        <div class="tool-use__actions">
                            {this.canOpenTargetFile && (
                                <IconButton
                                    class="tool-use__action"
                                    data-tool-action="open-file"
                                    data-tool-target-path={this.toolTargetPath}
                                    icon="icon_file_open"
                                    size={[24, 24]}
                                    iconSize={[16, 16]}
                                    shape={ButtonShape.Rounded}
                                    tooltip={useBackendStore().translate("Open file")}
                                    onClick={this.handleOpenTargetFile}
                                />
                            )}
                            {this.canOpenTargetFile && (
                                <CopyButton
                                    data-tool-target-path={this.toolTargetPath}
                                    size={[24, 24]}
                                    iconSize={[16, 16]}
                                    shape={ButtonShape.Rounded}
                                    tooltip={useBackendStore().translate("Copy path")}
                                    onClick={this.handleCopyPath}
                                    className="tool-use__action"
                                    data-tool-action="copy-path"
                                />
                            )}
                            {this.canCopyCommand && (
                                <CopyButton
                                    data-tool-command={this.bashCommand}
                                    size={[24, 24]}
                                    iconSize={[16, 16]}
                                    shape={ButtonShape.Rounded}
                                    tooltip={useBackendStore().translate("Copy command")}
                                    onClick={this.handleCopyCommand}
                                    className="tool-use__action"
                                    data-tool-action="copy-command"
                                />
                            )}
                            {this.canOpenFullOutput && (
                                <IconButton
                                    class="tool-use__action"
                                    data-tool-action="open-full-output"
                                    data-tool-output-path={this.bashFullOutputPath}
                                    icon="icon_file_open"
                                    size={[24, 24]}
                                    iconSize={[16, 16]}
                                    shape={ButtonShape.Rounded}
                                    tooltip={useBackendStore().translate("Open full output")}
                                    onClick={this.handleOpenFullOutput}
                                />
                            )}
                            <CopyButton
                                size={[24, 24]}
                                iconSize={[16, 16]}
                                shape={ButtonShape.Rounded}
                                onClick={this.handleCopy}
                                className="tool-use__copy"
                                data-tool-action="copy-tool-payload"
                            />
                        </div>
                    )}
                </div>

                {this.hasDetails && this.isExpanded && (
                    <div class="tool-use__content">
                        <pre class="tool-use__code">{this.formattedDetails}</pre>
                    </div>
                )}
            </div>
        );
    },
});
