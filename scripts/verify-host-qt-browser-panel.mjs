import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "browserPanel",
    staticPort: 4192,
    sidecarPort: 8801,
    expectedBundleMarkers: [
        "BrowserPanelPage",
        "浏览器",
        "通过 OpenCLI 管理 Sunday 浏览器会话。",
        "初始化会话",
        "复制插件路径",
        "OpenCLI 已连接",
    ],
    verdictConfirmed: "host-qt-browser-panel-confirmed",
    verdictIncomplete: "host-qt-browser-panel-incomplete",
});
