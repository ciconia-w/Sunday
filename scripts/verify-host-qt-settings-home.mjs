import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "settingsHome",
    staticPort: 4178,
    sidecarPort: 8792,
    expectedBundleMarkers: ["运行诊断", "模型配置", "扩展中心", "外观"],
    verdictConfirmed: "host-qt-settings-home-confirmed",
    verdictIncomplete: "host-qt-settings-home-incomplete",
});
