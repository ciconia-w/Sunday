import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "extensions",
    staticPort: 4191,
    sidecarPort: 8800,
    expectedBundleMarkers: [
        "skills-page__tabs",
        "skills-page__tab",
        "技能",
        "CLI",
        "MCP",
        "IM Bridge",
        "扩展",
        "技能导入成功。",
        "CLI 工具",
        "MCP 服务",
        "data-ingress-operator-page",
    ],
    verdictConfirmed: "host-qt-extensions-confirmed",
    verdictIncomplete: "host-qt-extensions-incomplete",
});
