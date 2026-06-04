import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Failed to open",
    "Failed to read browser state",
    "Failed to extract page content",
    "Failed to capture page screenshot",
    "screenshotPath",
    "errorHint",
    'translate("Details"',
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "browser-tool-use-bundle-confirmed"
    : "browser-tool-use-bundle-incomplete";

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

process.exit(verdict === "browser-tool-use-bundle-confirmed" ? 0 : 1);
