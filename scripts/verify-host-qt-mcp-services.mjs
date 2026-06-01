import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "mcpServices",
    staticPort: 4181,
    sidecarPort: 8795,
    expectedBundleMarkers: [
        "skills-page__tabs",
        "skills-page__tab",
        "技能",
        "CLI",
        "MCP",
        "MCP 服务",
        "添加 MCP 服务",
        "仅看内置",
        "仅看自定义",
    ],
    verdictConfirmed: "host-qt-mcp-services-confirmed",
    verdictIncomplete: "host-qt-mcp-services-incomplete",
});
