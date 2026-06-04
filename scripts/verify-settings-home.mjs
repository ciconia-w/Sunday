import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "settings-page__nav",
    "settings-page__panel",
    "设置",
    "运行诊断",
    "模型配置",
    "扩展中心",
    "技能 / CLI / MCP",
    "统一管理技能、CLI 工具和 MCP 服务。",
    "外观",
    "跟随系统",
    "浅色",
    "深色",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean) ? "settings-home-confirmed" : "settings-home-incomplete";

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

process.exit(verdict === "settings-home-confirmed" ? 0 : 1);
