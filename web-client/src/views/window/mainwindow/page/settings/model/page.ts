import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import ModelSettingsPage from "@/views/window/mainwindow/page/settings/model/ModelSettingsPage";

export const modelSettingsWorkspacePageDefinition: MainWindowWorkspacePageDefinition = {
    id: MAIN_WINDOW_WORKSPACE_PAGES.MODEL_SETTINGS,
    component: ModelSettingsPage,
    backButton: {
        text: "Back to Settings",
        fallbackPage: MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME,
    },
};
