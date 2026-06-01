import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import SettingsHomePage from "@/views/window/mainwindow/page/settings/home/SettingsHomePage";

export const settingsHomeWorkspacePageDefinition: MainWindowWorkspacePageDefinition = {
    id: MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME,
    component: SettingsHomePage,
    backButton: {
        text: "Back to Chat",
        fallbackPage: MAIN_WINDOW_WORKSPACE_PAGES.CHAT,
    },
};
