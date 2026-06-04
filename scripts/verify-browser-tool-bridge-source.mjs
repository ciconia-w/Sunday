import { readFile } from "node:fs/promises";
import { repoRoot } from "./paths.mjs";

const sourcePath = `${repoRoot}/pi-sidecar/src/runtime/pi-session-bridge.mjs`;
const source = await readFile(sourcePath, "utf8");

const markers = [
    'toolCall.name !== "browser_screenshot"',
    "getBrowserScreenshotErrorDetails",
    "errorKind: screenshotFailure.errorKind",
    "errorHint: screenshotFailure.errorHint",
];

const present = Object.fromEntries(markers.map((marker) => [marker, source.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "browser-tool-bridge-source-confirmed"
    : "browser-tool-bridge-source-incomplete";

console.log(
    JSON.stringify(
        {
            sourcePath,
            present,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "browser-tool-bridge-source-confirmed" ? 0 : 1);
