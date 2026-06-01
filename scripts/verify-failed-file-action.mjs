import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "input-area__failed-files-row",
    "input-area__failed-files-action",
    "Retry failed files",
    "Retrying failed files...",
    "Remove failed files",
    "Removing failed files...",
    "Failed files:",
    "chat-view__action-target--highlighted",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "failed-file-action-confirmed"
    : "failed-file-action-incomplete";

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

process.exit(verdict === "failed-file-action-confirmed" ? 0 : 1);
