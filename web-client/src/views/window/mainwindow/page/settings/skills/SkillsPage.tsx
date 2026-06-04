import { computed, defineComponent, onMounted } from "vue";
import TextButton from "@/components/TextButton";
import ScrollBar from "@/components/ScrollBar";
import ToolManagementList from "@/views/window/mainwindow/page/settings/common/components/ToolManagementList";
import { useBackendStore, useNotifyStore, useSkillsStore } from "@/stores";
import type { SkillItem } from "@/types/skill";
import type { ToolManagementCustomAction } from "@/views/window/mainwindow/page/settings/common/types";
import "@/assets/styles/window/mainwindow/page/settings/skills/SkillsPage.css";

interface SkillImportResult {
    success?: boolean;
    cancelled?: boolean;
    error?: string;
    skill?: SkillItem;
}

interface SkillsSourceOfTruth {
    managedRootDir?: string;
    builtinRootDir?: string;
    repoSkillsDir?: string;
    sourceDocPath?: string;
}

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
        const githubImportButtonText = computed(() => backendStore.translate("GitHub 导入"));
        const sourceOfTruthButtonText = computed(() => backendStore.translate("来源说明"));

        const handleRefresh = async () => {
            await skillsStore.refreshSkills().catch(() => undefined);
        };

        const handleImportSkill = async () => {
            try {
                const result = await backendStore.requestSkillsMgr("addSkillForWeb") as SkillImportResult;

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

        const handleImportGithubSkill = async () => {
            const repoInput = typeof window !== "undefined"
                ? window.prompt(
                    backendStore.translate("输入 GitHub 仓库或技能子目录，例如 owner/repo 或 https://github.com/owner/repo/tree/main/skills/my-skill"),
                    "",
                )
                : "";
            const normalizedInput = typeof repoInput === "string" ? repoInput.trim() : "";
            if (!normalizedInput) {
                return;
            }

            try {
                const result = await backendStore.requestSkillsMgr("addGithubSkillForWeb", normalizedInput) as SkillImportResult;

                if (result.success) {
                    notifyStore.showToast({
                        type: "success",
                        message: backendStore.translate("GitHub 技能导入成功。"),
                        duration: 1400,
                    });
                    await skillsStore.refreshSkills();
                } else if (result.error) {
                    notifyStore.showToast({
                        type: "error",
                        message: result.error,
                        duration: 3200,
                    });
                }
            } catch (error) {
                notifyStore.showToast({
                    type: "error",
                    message:
                        error instanceof Error ? error.message : backendStore.translate("GitHub 技能导入失败，请稍后重试。"),
                    duration: 3200,
                });
            }
        };

        const handleOpenSourceOfTruth = async () => {
            const sourceOfTruth = await backendStore.requestSkillsMgr("getSkillsSourceOfTruth") as SkillsSourceOfTruth;
            const contentLines = [
                backendStore.translate("Sunday 当前会从这些位置加载技能："),
                sourceOfTruth.builtinRootDir ? `${backendStore.translate("内置 system")}: ${sourceOfTruth.builtinRootDir}` : "",
                sourceOfTruth.managedRootDir ? `${backendStore.translate("用户本地")}: ${sourceOfTruth.managedRootDir}` : "",
                sourceOfTruth.repoSkillsDir ? `${backendStore.translate("仓库 skills")}: ${sourceOfTruth.repoSkillsDir}` : "",
                "",
                backendStore.translate("本地目录导入和 GitHub 导入都会先复制到用户本地目录，再由 Sunday 管理删除和开关。"),
            ].filter(Boolean);

            const result = await notifyStore.showDialog({
                title: backendStore.translate("技能来源说明"),
                content: contentLines.join("\n"),
                buttons: [
                    { key: "cancel", text: backendStore.translate("关闭"), type: "default" },
                    {
                        key: "open-doc",
                        text: backendStore.translate("打开说明文档"),
                        type: "default",
                        disabled: !sourceOfTruth.sourceDocPath,
                    },
                    {
                        key: "open-user-root",
                        text: backendStore.translate("打开用户目录"),
                        type: "default",
                        disabled: !sourceOfTruth.managedRootDir,
                    },
                    {
                        key: "open-repo-root",
                        text: backendStore.translate("打开仓库目录"),
                        type: "primary",
                        disabled: !sourceOfTruth.repoSkillsDir,
                    },
                ],
            });

            if (result.key === "open-doc" && sourceOfTruth.sourceDocPath) {
                await backendStore.requestSystem("openFile", sourceOfTruth.sourceDocPath).catch(() => undefined);
            } else if (result.key === "open-user-root" && sourceOfTruth.managedRootDir) {
                await backendStore.requestSystem("openFile", sourceOfTruth.managedRootDir).catch(() => undefined);
            } else if (result.key === "open-repo-root" && sourceOfTruth.repoSkillsDir) {
                await backendStore.requestSystem("openFile", sourceOfTruth.repoSkillsDir).catch(() => undefined);
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
            githubImportButtonText,
            sourceOfTruthButtonText,
            handleRefresh,
            handleImportSkill,
            handleImportGithubSkill,
            handleOpenSourceOfTruth,
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
                                <TextButton text={this.githubImportButtonText} onClick={this.handleImportGithubSkill} />
                                <TextButton text={this.sourceOfTruthButtonText} onClick={this.handleOpenSourceOfTruth} />
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
