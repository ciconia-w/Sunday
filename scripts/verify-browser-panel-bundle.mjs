import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "data-browser-panel-connection-help",
    "data-browser-panel-capabilities",
    "data-browser-panel-capability-item",
    "data-browser-panel-runtime-notice",
    "data-browser-panel-screenshot-guidance",
    "data-browser-panel-screenshot-error-kind",
    "多标签切换",
    "整页截图",
    "OpenCLI 守护进程未运行，浏览器动作暂不可用。",
    "浏览器扩展尚未连接，浏览器动作暂不可用。",
    "启动 OpenCLI",
    "打开扩展页",
    "复制插件路径",
    "打开输出目录",
    "复制截图路径",
    "复制提取内容",
    "browserCaptureScreenshot\",\"\"",
    "screenshotActionLabel",
    "建议先继续使用页面提取、聊天里的 browser_* 工具或当前活动页内容完成任务",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "browser-panel-bundle-confirmed"
    : "browser-panel-bundle-incomplete";

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

process.exit(verdict === "browser-panel-bundle-confirmed" ? 0 : 1);
