import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "message__attachment-context",
    "message__attachment-stat--warning",
    "message__reply-context",
    "Sent from file suggestion",
];

const absentMarkers = [
    "chat-view__context-overview",
    "chat-view__context-overview-title",
    "chat-view__context-pill",
    "Conversation context",
    "Latest tool",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const absent = Object.fromEntries(absentMarkers.map((marker) => [marker, bundle.includes(marker)]));
const verdict =
    Object.values(present).every(Boolean) && Object.values(absent).every((value) => value === false)
        ? "conversation-context-overview-confirmed"
        : "conversation-context-overview-incomplete";

console.log(
    JSON.stringify(
        {
            bundlePath,
            present,
            absent,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "conversation-context-overview-confirmed" ? 0 : 1);
