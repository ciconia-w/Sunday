import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "Files are still being prepared",
    "Files are attached and ready",
    "Summarize the uploaded files and list the key points.",
    "Compare the uploaded files and highlight the important differences.",
    "input-area__file-guidance",
    "input-area__file-prompt-chip",
    "input-area__file-prompt-fill",
    "applySuggestedPrompt",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean) ? "file-guidance-confirmed" : "file-guidance-incomplete";

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

process.exit(verdict === "file-guidance-confirmed" ? 0 : 1);
