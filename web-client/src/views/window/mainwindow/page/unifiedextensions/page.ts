import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";
import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import UnifiedExtensionsPage from "@/views/window/mainwindow/page/unifiedextensions/UnifiedExtensionsPage";

export const unifiedExtensionsWorkspacePageDefinition: MainWindowWorkspacePageDefinition = {
    id: MAIN_WINDOW_WORKSPACE_PAGES.EXTENSIONS,
    component: UnifiedExtensionsPage,
};
