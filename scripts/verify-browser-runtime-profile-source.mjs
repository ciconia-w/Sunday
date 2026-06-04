import { readFile } from "node:fs/promises";
import { repoRoot } from "./paths.mjs";

const sourcePath = `${repoRoot}/pi-sidecar/src/runtime/browser-control.mjs`;
const source = await readFile(sourcePath, "utf8");

const markers = [
    "function getBrowserRuntimeProfile(version)",
    "stableTabSwitch",
    "stableScreenshotCapture",
    "runtimeLimitNotice",
    "knownIssues",
    "tabSwitchCapabilityDescription",
    "screenshotCapabilityDescription",
    "screenshotGuidance",
    "screenshotActionLabel",
    "...getBrowserRuntimeProfile(parsed.version)",
];

const present = Object.fromEntries(markers.map((marker) => [marker, source.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "browser-runtime-profile-source-confirmed"
    : "browser-runtime-profile-source-incomplete";

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

process.exit(verdict === "browser-runtime-profile-source-confirmed" ? 0 : 1);
