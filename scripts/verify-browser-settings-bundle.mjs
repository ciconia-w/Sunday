import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "OpenCLI 浏览器",
    "浏览器控制",
    "showBrowserInstallActions",
    "browserInstallSteps",
    "打开安装向导",
    "data-browser-install-step",
    "data-browser-capability-item",
    "多标签切换",
    "整页截图",
    "启动 OpenCLI",
    "复制路径",
    "打开扩展页",
    "刷新状态",
    "browserRuntimeLimitNotice",
    "已知限制",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "browser-settings-bundle-confirmed"
    : "browser-settings-bundle-incomplete";

console.log(
    JSON.stringify(
        {
            bundlePath,
            present,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "browser-settings-bundle-confirmed" ? 0 : 1);
