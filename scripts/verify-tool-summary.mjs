import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Running shell command",
    "Reading file",
    "Writing file",
    "Editing file",
    "Listing files",
    "Searching with",
    "tool-use__summary",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean) ? "tool-summary-confirmed" : "tool-summary-incomplete";

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

process.exit(verdict === "tool-summary-confirmed" ? 0 : 1);
