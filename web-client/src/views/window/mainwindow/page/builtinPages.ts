import { chatWorkspacePageDefinition } from "@/views/window/mainwindow/page/chat/page";
import { historyConversationWorkspacePageDefinition } from "@/views/window/mainwindow/page/historyconversation/page";
import { settingsHomeWorkspacePageDefinition } from "@/views/window/mainwindow/page/settings/home/page";
import { modelSettingsWorkspacePageDefinition } from "@/views/window/mainwindow/page/settings/model/page";
import { mcpServicesWorkspacePageDefinition } from "@/views/window/mainwindow/page/settings/mcpservices/page";
import { skillsWorkspacePageDefinition } from "@/views/window/mainwindow/page/settings/skills/page";
import { registerMainWindowWorkspacePage } from "@/utils/mainwindow/workspacePages";
import { digitalHumanWorkspacePageDefinition } from "@/views/window/mainwindow/page/digitalhuman/page";
import { automationWorkspacePageDefinition } from "@/views/window/mainwindow/page/automation/page";
import { cliToolsWorkspacePageDefinition } from "@/views/window/mainwindow/page/clitools/page";
import { unifiedExtensionsWorkspacePageDefinition } from "@/views/window/mainwindow/page/unifiedextensions/page";

let isBuiltInWorkspacePagesRegistered = false;

export const ensureBuiltInWorkspacePagesRegistered = () => {
    if (isBuiltInWorkspacePagesRegistered) {
        return;
    }

    registerMainWindowWorkspacePage(chatWorkspacePageDefinition);
    registerMainWindowWorkspacePage(historyConversationWorkspacePageDefinition);
    registerMainWindowWorkspacePage(settingsHomeWorkspacePageDefinition);
    registerMainWindowWorkspacePage(modelSettingsWorkspacePageDefinition);
    registerMainWindowWorkspacePage(unifiedExtensionsWorkspacePageDefinition);
    registerMainWindowWorkspacePage(mcpServicesWorkspacePageDefinition);
    registerMainWindowWorkspacePage(skillsWorkspacePageDefinition);
    registerMainWindowWorkspacePage(cliToolsWorkspacePageDefinition);
    registerMainWindowWorkspacePage(automationWorkspacePageDefinition);
    registerMainWindowWorkspacePage(digitalHumanWorkspacePageDefinition);

    isBuiltInWorkspacePagesRegistered = true;
};
