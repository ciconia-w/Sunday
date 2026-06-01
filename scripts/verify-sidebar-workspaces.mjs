import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Sunday",
    "新建对话",
    "扩展",
    "自动化",
    "对话列表",
    "全部历史",
    "设置",
    "window-sidebar__nav",
    "window-sidebar__conversation-section",
    'type:"workspace"',
    "window-sidebar__footer",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "sidebar-workspaces-confirmed"
    : "sidebar-workspaces-incomplete";

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

process.exit(verdict === "sidebar-workspaces-confirmed" ? 0 : 1);
