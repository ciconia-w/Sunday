import { computed, defineComponent, ref } from "vue";
import type { PropType } from "vue";
import ScrollBar from "@/components/ScrollBar";
import SvgIcon from "@/components/SvgIcon";
import type { FileChangeApproveData } from "@/types/conversation";
import { InteractiveCompStatus } from "@/types/conversation";
import { useBackendStore } from "@/stores/backend";

type ChangeKind = "created" | "modified" | "deleted";

const CHANGE_KIND_META: Record<ChangeKind, { label: string; className: string }> = {
    created: {
        label: "Added",
        className: "file-approve__change-kind--created",
    },
    modified: {
        label: "Modified",
        className: "file-approve__change-kind--modified",
    },
    deleted: {
        label: "Deleted",
        className: "file-approve__change-kind--deleted",
    },
};

const normalizeChangeKind = (kind: string): ChangeKind => {
    const normalizedKind = kind.trim().toLowerCase();

    if (normalizedKind === "created" || normalizedKind === "modified" || normalizedKind === "deleted") {
        return normalizedKind;
    }

    return "modified";
};

const getFileNameFromPath = (filePath: string): string => {
    if (!filePath) {
        return "";
    }

    const normalizedPath = filePath.replace(/[\\/]+$/, "");
    const parts = normalizedPath.split(/[\\/]/).filter(Boolean);

    if (parts.length === 0) {
        return filePath;
    }

    return parts[parts.length - 1];
};

export default defineComponent({
    name: "FileChangeApprove",

    components: {
        ScrollBar,
        SvgIcon,
    },

    props: {
        data: {
            type: Object as PropType<FileChangeApproveData>,
            required: true,
        },
        onSubmit: {
            type: Function as PropType<(action: Record<string, unknown>) => void>,
            required: true,
        },
    },

    setup(props) {
        const backendStore = useBackendStore();
        const fileListScrollBar = ref<InstanceType<typeof ScrollBar> | null>(null);
        const changeCount = computed(() => props.data.changes.length);

        const createdCount = computed(
            () => props.data.changes.filter((c) => normalizeChangeKind(c.kind) === "created").length,
        );
        const modifiedCount = computed(
            () => props.data.changes.filter((c) => normalizeChangeKind(c.kind) === "modified").length,
        );
        const deletedCount = computed(
            () => props.data.changes.filter((c) => normalizeChangeKind(c.kind) === "deleted").length,
        );

        const headerTitle = computed(() =>
            backendStore
                .translate("%1 file changes (%2 added, %3 modified, %4 deleted)")
                .replace("%1", String(changeCount.value))
                .replace("%2", String(createdCount.value))
                .replace("%3", String(modifiedCount.value))
                .replace("%4", String(deletedCount.value)),
        );

        const applyText = computed(() => backendStore.translate("Apply"));
        const rejectText = computed(() => backendStore.translate("Reject"));
        const approvedText = computed(() => backendStore.translate("Applied"));
        const rejectedText = computed(() => backendStore.translate("Rejected"));

        const isPending = computed(() => props.data.status === InteractiveCompStatus.PENDING);
        const statusText = computed(() =>
            props.data.status === InteractiveCompStatus.APPROVED ? approvedText.value : rejectedText.value,
        );

        const getKindLabel = (kind: string) => {
            return backendStore.translate(CHANGE_KIND_META[normalizeChangeKind(kind)].label);
        };

        const getKindClass = (kind: string) => {
            return CHANGE_KIND_META[normalizeChangeKind(kind)].className;
        };

        const handleAccept = (event: MouseEvent) => {
            event.stopPropagation();
            props.onSubmit({
                request_id: props.data.id,
                type: props.data.ic_type,
                approve: true,
            });
        };

        const handleReject = (event: MouseEvent) => {
            event.stopPropagation();
            props.onSubmit({
                request_id: props.data.id,
                type: props.data.ic_type,
                approve: false,
            });
        };

        const handleFileListWheel = (event: WheelEvent) => {
            const container = fileListScrollBar.value?.scrollContainerRef;
            if (!container) {
                return;
            }

            const { scrollTop, scrollHeight, clientHeight } = container;
            const isAtTop = scrollTop <= 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

            if ((event.deltaY > 0 && !isAtBottom) || (event.deltaY < 0 && !isAtTop)) {
                event.stopPropagation();
            }
        };

        return {
            fileListScrollBar,
            headerTitle,
            applyText,
            rejectText,
            isPending,
            statusText,
            getFileNameFromPath,
            getKindClass,
            getKindLabel,
            handleAccept,
            handleReject,
            handleFileListWheel,
        };
    },

    render() {
        const { data } = this.$props;

        return (
            <div class="file-approve">
                <div class="file-approve__header">
                    <div class="file-approve__header-info">
                        <span class="file-approve__header-icon">
                            <SvgIcon icon="bash-file" size={[16, 16]} />
                        </span>
                        <span class="file-approve__header-title">{this.headerTitle}</span>
                    </div>

                    <div class="file-approve__header-actions">
                        {this.isPending ? (
                            <>
                                <div class="file-approve__btn file-approve__btn--accept" onClick={this.handleAccept}>
                                    <span>{this.applyText}</span>
                                </div>
                                <div class="file-approve__btn file-approve__btn--reject" onClick={this.handleReject}>
                                    <span>{this.rejectText}</span>
                                </div>
                            </>
                        ) : (
                            <span class="file-approve__status">{this.statusText}</span>
                        )}
                    </div>
                </div>

                <div class="file-approve__list-shell" onWheel={this.handleFileListWheel}>
                    <ScrollBar ref="fileListScrollBar" class="file-approve__list-scroll">
                        <div class="file-approve__list">
                            {data.changes.map((change, index) => {
                                const kindClass = this.getKindClass(change.kind);
                                const kindLabel = this.getKindLabel(change.kind);
                                const fileName = this.getFileNameFromPath(change.path);

                                return (
                                    <div key={`${change.path}-${index}`} class="file-approve__item">
                                        {change.is_dir && (
                                            <span class="file-approve__file-icon">
                                                <SvgIcon icon="icon_open_dir" size={[16, 16]} />
                                            </span>
                                        )}
                                        <span class="file-approve__file-name">{fileName}</span>
                                        <span class="file-approve__file-path">{change.path}</span>
                                        <span class={["file-approve__change-kind", kindClass]}>{kindLabel}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollBar>
                </div>
            </div>
        );
    },
});
