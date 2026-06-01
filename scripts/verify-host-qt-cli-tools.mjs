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
        "gh cli",
        "opencli",
        "lark cli",
        "已安装，待授权",
        "已安装，浏览器未连接",
        "已授权，账号",
    ],
    verdictConfirmed: "host-qt-cli-tools-confirmed",
    verdictIncomplete: "host-qt-cli-tools-incomplete",
});
