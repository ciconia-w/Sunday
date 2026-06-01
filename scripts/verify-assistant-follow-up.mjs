import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Open branch",
    "handleFollowUpClick",
    "arrow-right-up-line",
    "data-message-action",
    "open-branch",
    "clearFiles",
    "handleFileEvent",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "assistant-follow-up-confirmed"
    : "assistant-follow-up-incomplete";

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

process.exit(verdict === "assistant-follow-up-confirmed" ? 0 : 1);
