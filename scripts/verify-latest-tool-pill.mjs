import { readFile } from "node:fs/promises";

const bundlePath = "/home/aaa/personal-agent-desktop/web-client/dist/assets/RootWindow-legacy.js";
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "tool-use__header--interactive",
    "tool-use__summary",
    "tool-use__actions",
    "chat-view__jump-target--highlighted",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "latest-tool-pill-confirmed"
    : "latest-tool-pill-incomplete";

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

process.exit(verdict === "latest-tool-pill-confirmed" ? 0 : 1);
