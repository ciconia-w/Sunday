import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "title-bar__brand-title",
    "Sunday",
    "AI 接管工作，每天都是周末",
    "input-area__model-selector",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "titlebar-shell-confirmed"
    : "titlebar-shell-incomplete";

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

process.exit(verdict === "titlebar-shell-confirmed" ? 0 : 1);
