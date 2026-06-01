import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "fallbackPage:Fe.SETTINGS_HOME",
    "id:Fe.MODEL_SETTINGS",
    "id:Fe.SKILLS",
    "id:Fe.MCP_SERVICES",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "settings-fallbacks-confirmed"
    : "settings-fallbacks-incomplete";

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

process.exit(verdict === "settings-fallbacks-confirmed" ? 0 : 1);
