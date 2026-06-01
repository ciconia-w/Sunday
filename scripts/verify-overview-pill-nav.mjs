import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "chat-view__jump-target--highlighted",
    "chat-view__action-target--highlighted",
    "scrollIntoView",
    "tool-use__header--interactive",
    "tool-use__actions",
    "message__attachment-context",
    "Sent from file suggestion",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "overview-pill-nav-confirmed"
    : "overview-pill-nav-incomplete";

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

process.exit(verdict === "overview-pill-nav-confirmed" ? 0 : 1);
