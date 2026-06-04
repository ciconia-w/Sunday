import { readFile } from "node:fs/promises";
import { repoRoot } from "./paths.mjs";

const devServerPath = `${repoRoot}/pi-sidecar/src/dev-server.mjs`;
const serviceConfigPath = `${repoRoot}/host-qt/src/channels/serviceconfigchannel.cpp`;

const [devServerSource, serviceConfigSource] = await Promise.all([
    readFile(devServerPath, "utf8"),
    readFile(serviceConfigPath, "utf8"),
]);

const devServerMarkers = [
    '"/service-config/browser-open-url"',
    "result = {",
    "ok: false",
    "message: await openBrowserUrl",
    "content: await extractBrowserPage()",
    "...(await captureBrowserScreenshot(body.outputPath ?? \"\"))",
    "errorKind: screenshotFailure.errorKind",
    "errorHint: screenshotFailure.errorHint",
];

const serviceConfigMarkers = [
    "if (result.isObject()) {",
    "if (payload.contains(QStringLiteral(\"ok\"))) {",
    "if (result.contains(QStringLiteral(\"ok\")) && !result.value(QStringLiteral(\"ok\")).toBool(true)) {",
];

const present = {
    devServer: Object.fromEntries(devServerMarkers.map((marker) => [marker, devServerSource.includes(marker)])),
    serviceConfig: Object.fromEntries(serviceConfigMarkers.map((marker) => [marker, serviceConfigSource.includes(marker)])),
};

const verdict = [
    ...Object.values(present.devServer),
    ...Object.values(present.serviceConfig),
].every(Boolean)
    ? "browser-action-bridge-source-confirmed"
    : "browser-action-bridge-source-incomplete";

console.log(
    JSON.stringify(
        {
            devServerPath,
            serviceConfigPath,
            present,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "browser-action-bridge-source-confirmed" ? 0 : 1);
