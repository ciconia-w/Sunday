import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import UnifiedExtensionsPage from "@/views/window/mainwindow/page/unifiedextensions/UnifiedExtensionsPage";

export const ingressOperatorWorkspacePageDefinition: MainWindowWorkspacePageDefinition = {
    id: MAIN_WINDOW_WORKSPACE_PAGES.INGRESS_OPERATOR,
    component: UnifiedExtensionsPage,
    backButton: {
        text: "Back to Settings",
        fallbackPage: MAIN_WINDOW_WORKSPACE_PAGES.SETTINGS_HOME,
    },
};
