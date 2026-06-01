import { computed, defineComponent, onMounted } from "vue";
import TextButton from "@/components/TextButton";
import ScrollBar from "@/components/ScrollBar";
import ToolManagementList from "@/views/window/mainwindow/page/settings/common/components/ToolManagementList";
import { useBackendStore, useNotifyStore, useSkillsStore } from "@/stores";
import type { SkillItem } from "@/types/skill";
import type { ToolManagementCustomAction } from "@/views/window/mainwindow/page/settings/common/types";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

export default defineComponent({
    name: "SkillsPage",
    components: {
        ScrollBar,
        ToolManagementList,
    },
    setup() {
        const skillsStore = useSkillsStore();
        const backendStore = useBackendStore();
        const notifyStore = useNotifyStore();

        const loadPageData = async () => {
            await skillsStore.loadPageData().catch(() => undefined);
        };

        onMounted(() => {
            void loadPageData();
        });

        const sortedToolItems = computed(() => skillsStore.toolItems);
        const loadingText = computed(() => backendStore.translate("正在加载技能..."));
        const emptyText = computed(() => backendStore.translate("暂无可用技能。"));
        const refreshButtonText = computed(() => backendStore.translate("刷新"));
        const importButtonText = computed(() => backendStore.translate("导入技能"));

        const handleRefresh = async () => {
            await skillsStore.refreshSkills().catch(() => undefined);
        };

        const handleImportSkill = async () => {
            try {
                const result = await backendStore.requestSkillsMgr("addSkillForWeb");

                if (result.success) {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("技能导入成功。"),
                        duration: 1200,
                    });
                    await skillsStore.refreshSkills();
                } else if (result.error) {
                    notifyStore.showToast({
                        type: "error",
                        message: result.error,
                        duration: 2600,
                    });
                }
            } catch (error) {
                notifyStore.showToast({
                    type: "error",
                    message:
                        error instanceof Error ? error.message : backendStore.translate("导入技能失败，请稍后重试。"),
                    duration: 2600,
                });
            }
        };

        const handleToggleSkill = async (skillId: string, enabled: boolean) => {
            await skillsStore.toggleSkill(skillId, enabled).catch(() => undefined);
        };

        const handleOpenSkillDirectory = async (skillId: string) => {
            const targetSkill = skillsStore.skills.find((skill: SkillItem) => skill.name === skillId);
            if (!targetSkill?.path) {
                return;
            }

            await backendStore.requestSystem("openFile", targetSkill.path).catch(() => undefined);
        };

        const skillDirectoryAction: ToolManagementCustomAction = {
            icon: "icon_open_dir",
            tooltip: () => backendStore.translate("打开安装目录"),
            visible: (item) => item.editable,
            onClick: (item) => {
                void handleOpenSkillDirectory(item.id);
            },
        };

        const handleDeleteSkill = async (skillId: string) => {
            const targetSkill = skillsStore.skills.find((skill) => skill.name === skillId);
            if (!targetSkill) {
                return;
            }

            const result = await notifyStore.showDialog({
                title: `${backendStore.translate("确认删除")} ${targetSkill.name} ?`,
                content: backendStore.translate("删除后该技能将不可用，请谨慎操作。"),
                buttons: [
                    { key: "cancel", text: backendStore.translate("取消"), type: "default" },
                    { key: "confirm", text: backendStore.translate("删除"), type: "danger" },
                ],
            });

            if (result.key !== "confirm") {
                return;
            }

            await skillsStore.deleteSkill(skillId).catch(() => false);
        };

        return {
            skillsStore,
            sortedToolItems,
            loadingText,
            emptyText,
            refreshButtonText,
            importButtonText,
            handleRefresh,
            handleImportSkill,
            handleToggleSkill,
            skillDirectoryAction,
            handleDeleteSkill,
            titleText: computed(() => "技能"),
            subtitleText: computed(() => "管理当前接入 Sunday 的内置技能与本地扩展能力。"),
        };
    },
    render() {
        return (
            <div class="skills-page">
                <div class="skills-page__header-container">
                    <div class="skills-page__container">
                        <div class="skills-page__header">
                            <div class="skills-page__header-left">
                                <div class="skills-page__header-content">
                                    <div class="skills-page__title">{this.titleText}</div>
                                    <div class="skills-page__subtitle">{this.subtitleText}</div>
                                </div>
                            </div>

                            <div class="skills-page__actions">
                                <TextButton text={this.refreshButtonText} onClick={this.handleRefresh} />
                                <TextButton text={this.importButtonText} onClick={this.handleImportSkill} />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="skills-page__content">
                    <ScrollBar class="skills-page__scroll" edgeBounce momentum>
                        <div class="skills-page__content-container">
                            <div class="skills-page__container">
                                <section class="skills-page__section">
                                    <ToolManagementList
                                        isLoading={this.skillsStore.isLoading}
                                        items={this.sortedToolItems}
                                        customAction={this.skillDirectoryAction}
                                        showEditButton={false}
                                        loadingText={this.loadingText}
                                        emptyText={this.emptyText}
                                        onToggleItem={this.handleToggleSkill}
                                        onDeleteItem={this.handleDeleteSkill}
                                    />
                                </section>
                            </div>
                        </div>
                    </ScrollBar>
                </div>
            </div>
        );
    },
});
