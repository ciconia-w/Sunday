import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withQtVerifyRuntime } from "./qt-verify-runtime.mjs";

const browserControlConfigPath = resolve(process.cwd(), ".run", "browser-control.json");
const primaryTabUrl = "https://example.com/";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

function buildFrontUrl(port, secondaryTabUrl) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("disableResizeObservers", "1");
    url.searchParams.set("workspace", "browserPanel");
    url.searchParams.set("autoBrowserInit", "1");
    url.searchParams.set("autoBrowserOpenExample", "1");
    url.searchParams.set("autoBrowserNewTabUrl", secondaryTabUrl);
    url.searchParams.set("autoBrowserSwitchTabUrl", primaryTabUrl);
    url.searchParams.set("autoBrowserExtract", "1");
    url.searchParams.set("autoBrowserCaptureScreenshot", "1");
    url.hash = "/";
    return url.toString();
}

async function listPngFiles(dirPath) {
    try {
        const entries = await readdir(dirPath);
        return entries.filter((entry) => entry.endsWith(".png")).sort();
    } catch {
        return [];
    }
}

function hasBrowserPanelSmokeEvidence(hostLog) {
    return (
        hostLog.includes("[RootWindow] startup workspace opened: browserPanel") ||
        hostLog.includes("[RootWindow] browser panel initial:")
    );
}

async function run() {
    const hadConfigFile = existsSync(browserControlConfigPath);
    const previousConfig = hadConfigFile ? await readFile(browserControlConfigPath, "utf8") : null;

    await mkdir(dirname(browserControlConfigPath), { recursive: true });
    await writeFile(browserControlConfigPath, JSON.stringify({ enabled: true }) + "\n", "utf8");

    try {
        await withQtVerifyRuntime(
            {
                staticPort: 4192,
                sidecarPort: 8801,
                profilePrefix: "personal-agent-qt-browser-panel-",
                captureSidecarOutput: true,
            },
            async ({ staticPort, sidecarPort, getSidecarOutput, runHost }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const secondaryUrl = new URL(primaryTabUrl);
                const tabToken = `stage-b-tab-${Date.now()}`;
                secondaryUrl.searchParams.set("sunday_browser_tab", tabToken);
                const secondaryTabUrl = secondaryUrl.toString();
                const controlStateBefore = await post(baseUrl, "/service-config/get-browser-control-state", {});
                const frontUrl = buildFrontUrl(staticPort, secondaryTabUrl);
                const outputDir = String(controlStateBefore?.result?.outputDir || "");
                const screenshotFilesBefore = outputDir ? await listPngFiles(outputDir) : [];
                const screenshotFilesBeforeSet = new Set(screenshotFilesBefore);
                const panelStateBefore = await post(baseUrl, "/service-config/get-browser-panel-state", {});
                const hostLogs = [];
                let hostLog = "";
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    hostLog = await runHost(frontUrl, "42000", 60000);
                    hostLogs.push(hostLog);
                    if (hasBrowserPanelSmokeEvidence(hostLog)) {
                        break;
                    }
                }
                const controlStateAfter = await post(baseUrl, "/service-config/get-browser-control-state", {});
                const panelStateAfter = await post(baseUrl, "/service-config/get-browser-panel-state", {});
                const screenshotFilesAfter = outputDir ? await listPngFiles(outputDir) : [];

                const sawLoadFinished = hostLog.includes("[host-qt web] loadFinished true");
                const sawWorkspaceOpened = hostLog.includes("[RootWindow] startup workspace opened: browserPanel");
                const sawInitialState = hostLog.includes("[RootWindow] browser panel initial:");
                const sawInitAction = hostLog.includes("[RootWindow] browser panel action clicked: init-session");
                const sawOpenExampleAction = hostLog.includes("[RootWindow] browser panel action clicked: open-example");
                const sawNewTabAction = hostLog.includes("[RootWindow] browser panel action clicked: new-tab");
                const sawNewTabReady =
                    hostLog.includes("[RootWindow] browser panel new tab ready:") &&
                    hostLog.includes(tabToken);
                const sawCreatedTabSelection =
                    hostLog.includes("[RootWindow] browser panel active tab:") &&
                    hostLog.includes(secondaryTabUrl);
                const sawSwitchAttempt =
                    hostLog.includes("[RootWindow] browser panel tab clicked:") ||
                    hostLog.includes("[RootWindow] browser panel action clicked: open-url");
                const sawSwitchBack =
                    (hostLog.includes("[RootWindow] browser panel switched tab:") &&
                        hostLog.includes(primaryTabUrl)) ||
                    (hostLog.includes("[RootWindow] browser panel reopened url:") &&
                        hostLog.includes(primaryTabUrl));
                const sawExtractAction = hostLog.includes("[RootWindow] browser panel action clicked: extract-page");
                const sawScreenshotAction =
                    hostLog.includes("[RootWindow] browser panel action clicked: capture-screenshot");
                const sawScreenshotReady =
                    hostLog.includes("[RootWindow] browser panel screenshot ready:");
                const sawScreenshotFailed =
                    hostLog.includes("[RootWindow] browser panel screenshot failed:");
                const sawUrlReady = /\[RootWindow\] browser panel url ready:\s+.*example\.com/i.test(hostLog);
                const sawExtractPreview =
                    /\[RootWindow\] browser panel extract preview:\s+/i.test(hostLog) &&
                    !hostLog.includes("[RootWindow] browser panel extract preview: 提取失败");
                const newScreenshotFiles = screenshotFilesAfter.filter((entry) => !screenshotFilesBeforeSet.has(entry));
                const screenshotPath = newScreenshotFiles[0]
                    ? resolve(outputDir, newScreenshotFiles[0])
                    : "";
                const screenshotExists = screenshotPath ? existsSync(screenshotPath) : false;
                const hasRuntimeError =
                    hostLog.includes("TypeError") ||
                    hostLog.includes("ReferenceError") ||
                    hostLog.includes("[app-error-stack]");
                const hasAutomationMiss =
                    hostLog.includes("[RootWindow] browser panel root missing") ||
                    hostLog.includes("[RootWindow] browser panel action missing:");

                const afterPanelState = panelStateAfter?.result ?? {};
                const finalUrlMatches =
                    String(afterPanelState.url || "").includes("example.com") ||
                    (Array.isArray(afterPanelState.tabs) &&
                        afterPanelState.tabs.some((tab) => String(tab?.url || "").includes("example.com")));
                const hasCreatedTab = sawNewTabReady;
                const tabSwitchSupported =
                    Array.isArray(afterPanelState.tabs) &&
                    afterPanelState.tabs.some((tab) => tab?.active === true && String(tab?.url || "").startsWith(primaryTabUrl));
                const screenshotSupported = screenshotExists || sawScreenshotReady || sawScreenshotFailed;

                const verdict =
                    controlStateBefore?.ok === true &&
                    controlStateBefore?.result?.enabled === true &&
                    panelStateBefore?.ok === true &&
                    controlStateAfter?.ok === true &&
                    controlStateAfter?.result?.enabled === true &&
                    panelStateAfter?.ok === true &&
                    sawLoadFinished &&
                    sawWorkspaceOpened &&
                    sawInitialState &&
                    sawInitAction &&
                    sawOpenExampleAction &&
                    sawNewTabAction &&
                    sawNewTabReady &&
                    sawCreatedTabSelection &&
                    sawSwitchAttempt &&
                    sawSwitchBack &&
                    sawExtractAction &&
                    sawScreenshotAction &&
                    sawUrlReady &&
                    sawExtractPreview &&
                    finalUrlMatches &&
                    hasCreatedTab &&
                    screenshotSupported &&
                    !hasRuntimeError &&
                    !hasAutomationMiss
                        ? "host-qt-browser-panel-confirmed"
                        : "host-qt-browser-panel-incomplete";

                if (screenshotExists) {
                    await rm(screenshotPath, { force: true }).catch(() => undefined);
                }

                console.log(
                    JSON.stringify(
                        {
                            frontUrl,
                            secondaryTabUrl,
                            tabToken,
                            controlStateBefore,
                            panelStateBefore,
                            controlStateAfter,
                            panelStateAfter,
                            hostAttemptCount: hostLogs.length,
                            hostAttempts: hostLogs,
                            sawLoadFinished,
                            sawWorkspaceOpened,
                            sawInitialState,
                            sawInitAction,
                            sawOpenExampleAction,
                            sawNewTabAction,
                            sawNewTabReady,
                            sawCreatedTabSelection,
                            sawSwitchAttempt,
                            sawSwitchBack,
                            sawExtractAction,
                            sawScreenshotAction,
                            sawScreenshotReady,
                            sawScreenshotFailed,
                            sawUrlReady,
                            sawExtractPreview,
                            screenshotPath,
                            screenshotExists,
                            screenshotFilesBefore,
                            screenshotFilesAfter,
                            newScreenshotFiles,
                            finalUrlMatches,
                            hasCreatedTab,
                            tabSwitchSupported,
                            screenshotSupported,
                            hasRuntimeError,
                            hasAutomationMiss,
                            hostLog,
                            sidecarOutput: getSidecarOutput(),
                            verdict,
                        },
                        null,
                        2,
                    ),
                );

                process.exit(verdict === "host-qt-browser-panel-confirmed" ? 0 : 1);
            },
        );
    } finally {
        if (hadConfigFile) {
            await writeFile(browserControlConfigPath, previousConfig, "utf8");
        } else {
            await rm(browserControlConfigPath, { force: true });
        }
    }
}

await run();
