import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import BrowserPanelPage from "@/views/window/mainwindow/page/browserpanel/BrowserPanelPage";
import { MAIN_WINDOW_WORKSPACE_PAGES } from "@/types/mainwindow";

export const browserPanelPageDefinition: MainWindowWorkspacePageDefinition = {
    id: MAIN_WINDOW_WORKSPACE_PAGES.BROWSER_PANEL,
    component: BrowserPanelPage,
};
