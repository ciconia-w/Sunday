import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import BrowserPanelPage from "@/views/window/mainwindow/page/browserpanel/BrowserPanelPage";

export const browserPanelPageDefinition: MainWindowWorkspacePageDefinition = {
    id: "browserPanel" as any,
    component: BrowserPanelPage,
};
