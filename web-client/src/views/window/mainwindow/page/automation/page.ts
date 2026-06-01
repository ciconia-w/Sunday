import type { MainWindowWorkspacePageDefinition } from "@/utils/mainwindow/workspacePages";
import AutomationPage from "@/views/window/mainwindow/page/automation/AutomationPage";

export const automationWorkspacePageDefinition: MainWindowWorkspacePageDefinition = {
    id: "automation",
    component: AutomationPage,
};
