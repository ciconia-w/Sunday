import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "settingsHome",
    staticPort: 4193,
    sidecarPort: 8802,
    extraQueryParams: {
        settingsSection: "browser",
    },
    expectedBundleMarkers: [
        "OpenCLI 浏览器",
        "浏览器控制",
        "默认关闭。开启后将引导你安装 OpenCLI 浏览器插件。",
        "showBrowserExtensionStatus",
        "showBrowserDaemonStatus",
        "showBrowserPanelEntry",
        "showBrowserInstallActions",
        "browserInstallSteps",
        "打开安装向导",
        "data-browser-install-step",
        "启动 OpenCLI",
        "复制路径",
        "打开扩展页",
        "刷新状态",
        "browserRuntimeLimitNotice",
        "已知限制",
    ],
    verdictConfirmed: "host-qt-browser-settings-confirmed",
    verdictIncomplete: "host-qt-browser-settings-incomplete",
});
