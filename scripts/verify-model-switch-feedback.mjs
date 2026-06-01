import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Model changed. New chats will use this selection.",
    "Updated for the next reply in this conversation",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "model-switch-feedback-confirmed"
    : "model-switch-feedback-incomplete";

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

process.exit(verdict === "model-switch-feedback-confirmed" ? 0 : 1);
