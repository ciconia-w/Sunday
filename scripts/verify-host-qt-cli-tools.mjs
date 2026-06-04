import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "cliTools",
    staticPort: 4189,
    sidecarPort: 8798,
    expectedBundleMarkers: [
        "skills-page__tabs",
        "skills-page__tab",
        "技能",
        "CLI",
        "MCP",
        "CLI 工具",
        "命令行工具能力，后续将演进为 CLI 商店。",
        "正在检测 CLI 工具...",
        "gh cli",
        "opencli",
        "lark cli",
        "tool-management-list-item__detail",
        "tool-management-list-item__action-button",
        "getCliToolsState",
        "statusToken",
    ],
    verdictConfirmed: "host-qt-cli-tools-confirmed",
    verdictIncomplete: "host-qt-cli-tools-incomplete",
});
