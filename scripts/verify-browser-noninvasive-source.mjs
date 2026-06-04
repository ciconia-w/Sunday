import { readFile } from "node:fs/promises";
import { repoRoot } from "./paths.mjs";

const browserControlPath = `${repoRoot}/pi-sidecar/src/runtime/browser-control.mjs`;
const browserToolsPath = `${repoRoot}/pi-sidecar/src/runtime/browser-tools.mjs`;
const browserServiceConfigVerifyPath = `${repoRoot}/scripts/verify-browser-service-config-api.mjs`;

const [browserControlSource, browserToolsSource, browserServiceConfigVerifySource] = await Promise.all([
    readFile(browserControlPath, "utf8"),
    readFile(browserToolsPath, "utf8"),
    readFile(browserServiceConfigVerifyPath, "utf8"),
]);

const browserControlMarkers = [
    'return normalized === "foreground" ? "foreground" : "background";',
    'process.env.SUNDAY_BROWSER_WINDOW_MODE',
    '"--window"',
    "{ windowMode: getDefaultBrowserWindowMode() }",
];

const browserToolsMarkers = [
    "openBrowserUrl,",
    "const output = await openBrowserUrl(url);",
];

const browserServiceConfigVerifyMarkers = [
    "const enableRealBrowserProbe = isEnabledEnvVar(process.env.SUNDAY_VERIFY_REAL_BROWSER_PROBE);",
    'httpFallbackProbe.status = "skipped-by-default";',
    "Set SUNDAY_VERIFY_REAL_BROWSER_PROBE=1 to enable it.",
];

const present = {
    browserControl: Object.fromEntries(browserControlMarkers.map((marker) => [marker, browserControlSource.includes(marker)])),
    browserTools: Object.fromEntries(browserToolsMarkers.map((marker) => [marker, browserToolsSource.includes(marker)])),
    browserServiceConfigVerify: Object.fromEntries(
        browserServiceConfigVerifyMarkers.map((marker) => [marker, browserServiceConfigVerifySource.includes(marker)]),
    ),
};

const verdict = [
    ...Object.values(present.browserControl),
    ...Object.values(present.browserTools),
    ...Object.values(present.browserServiceConfigVerify),
].every(Boolean)
    ? "browser-noninvasive-source-confirmed"
    : "browser-noninvasive-source-incomplete";

console.log(
    JSON.stringify(
        {
            browserControlPath,
            browserToolsPath,
            browserServiceConfigVerifyPath,
            present,
            verdict,
        },
        null,
        2,
    ),
);

process.exit(verdict === "browser-noninvasive-source-confirmed" ? 0 : 1);
