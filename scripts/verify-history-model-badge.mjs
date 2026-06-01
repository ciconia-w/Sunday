import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "conversation-item__model-badge",
    "conversation-item__runtime-badge",
    "model_name",
    "runtime_mode",
    "LIVE",
    "DEMO",
    "MOCK",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "history-model-badge-confirmed"
    : "history-model-badge-incomplete";

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

process.exit(verdict === "history-model-badge-confirmed" ? 0 : 1);
