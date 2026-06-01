import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "title-bar__workspace-chip",
    "Settings Home",
    "Model Settings",
    "Skills",
    "MCP Services",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "titlebar-workspace-chip-confirmed"
    : "titlebar-workspace-chip-incomplete";

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

process.exit(verdict === "titlebar-workspace-chip-confirmed" ? 0 : 1);
