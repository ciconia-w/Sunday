import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "skills",
    staticPort: 4180,
    sidecarPort: 8794,
    expectedBundleMarkers: [
        "skills-page__tabs",
        "skills-page__tab",
        "技能",
        "CLI",
        "MCP",
        "导入技能",
        "管理当前接入 Sunday 的内置技能与本地扩展能力。",
    ],
    verdictConfirmed: "host-qt-skills-confirmed",
    verdictIncomplete: "host-qt-skills-incomplete",
});
