import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "tool-use__actions",
    "tool-use__action",
    "Open file",
    "Copy path",
    "Copy command",
    "Open full output",
    "icon_file_open",
    "handleOpenTargetFile",
    "handleCopyPath",
    "handleCopyCommand",
    "handleOpenFullOutput",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "tool-file-actions-confirmed"
    : "tool-file-actions-incomplete";

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

process.exit(verdict === "tool-file-actions-confirmed" ? 0 : 1);
