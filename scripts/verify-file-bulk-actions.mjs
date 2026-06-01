import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const sourcePath = new URL("../web-client/src/views/window/mainwindow/page/chat/components/InputArea.tsx", import.meta.url);
const bundle = await readFile(bundlePath, "utf8");
const source = await readFile(sourcePath, "utf8");

const markers = [
    "input-area__file-guidance-actions",
    "input-area__file-guidance-action",
    "Clear all",
    "Removing all files...",
    "handleClearAllFiles",
    "file(s) removed",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const clearAllMatch = source.match(/const handleClearAllFiles = async \(\) => \{([\s\S]*?)\n        \};/);
const clearAllBody = clearAllMatch?.[1] ?? "";
const sourceChecks = {
    usesAsyncClearAllHandler: Boolean(clearAllMatch),
    removesEachFileViaBackend: clearAllBody.includes("uploadFilesStore.removeFile(filePath)"),
    doesNotShortCircuitToClearFiles: !clearAllBody.includes("uploadFilesStore.clearFiles()"),
    tracksRemovalResults: clearAllBody.includes("Promise.allSettled"),
};

const verdict =
    Object.values(present).every(Boolean) && Object.values(sourceChecks).every(Boolean)
        ? "file-bulk-actions-confirmed"
        : "file-bulk-actions-incomplete";

console.log(
    JSON.stringify(
        {
            bundlePath,
            sourcePath,
            present,
            sourceChecks,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "file-bulk-actions-confirmed" ? 0 : 1);
