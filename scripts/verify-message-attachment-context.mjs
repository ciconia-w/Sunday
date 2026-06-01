import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Files attached",
    "Files attached with warnings",
    "file(s) were attached as context for this request.",
    "file(s) were still parsing when this message was sent.",
    "Working from attached files",
    "Working from attached files with warnings",
    "file(s) were attached to the request above.",
    "Sent from file suggestion",
    "Answering a file-guided request",
    "Failed files",
    "message__attachment-context",
    "message__attachment-stat--warning",
    "message__attachment-warning-list",
    "message__reply-context",
    "message__prompt-source-badge",
    "file-item--warning",
    "files-list-popover__item--warning",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "message-attachment-context-confirmed"
    : "message-attachment-context-incomplete";

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

process.exit(verdict === "message-attachment-context-confirmed" ? 0 : 1);
