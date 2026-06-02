export const MAIN_WINDOW_WORKSPACE_PAGES = {
    CHAT: "chat",
    HISTORY_CONVERSATION: "historyConversation",
    SETTINGS_HOME: "settingsHome",
    MODEL_SETTINGS: "modelSettings",
    EXTENSIONS: "extensions",
    MCP_SERVICES: "mcpServices",
    SKILLS: "skills",
    CLI_TOOLS: "cliTools",
    BROWSER_PANEL: "browserPanel",
    DIGITAL_HUMAN: "digitalHuman",
} as const;

export type BuiltInMainWindowWorkspacePage =
    (typeof MAIN_WINDOW_WORKSPACE_PAGES)[keyof typeof MAIN_WINDOW_WORKSPACE_PAGES];

export type MainWindowWorkspacePage = BuiltInMainWindowWorkspacePage | (string & {});
