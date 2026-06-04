import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";
import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

const browserControlConfigPath = join(repoRoot, ".run", "browser-control.json");

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnabledEnvVar(value) {
    return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getResult(response) {
    return response?.body?.result ?? null;
}

function getTabs(panelPayload) {
    return Array.isArray(panelPayload?.tabs) ? panelPayload.tabs : [];
}

function matchesProbeUrl(candidate, probeUrl) {
    return String(candidate || "").trim().startsWith(String(probeUrl || "").trim());
}

function findTabByProbeUrl(panelPayload, probeUrl) {
    return getTabs(panelPayload).find((tab) => matchesProbeUrl(tab?.url, probeUrl)) ?? null;
}

async function pollForProbeTab(baseUrl, probeUrl, maxAttempts = 8, delayMs = 1000) {
    let latestPanelState = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        latestPanelState = await post(baseUrl, "/service-config/get-browser-panel-state", {});
        const panelPayload = getResult(latestPanelState);
        const matchingTab = findTabByProbeUrl(panelPayload, probeUrl);
        const activeUrl = String(panelPayload?.url || "").trim();

        if (matchingTab || matchesProbeUrl(activeUrl, probeUrl)) {
            return {
                matched: true,
                attempt,
                panelState: latestPanelState,
                matchingTab,
                activeUrl,
            };
        }

        if (attempt < maxAttempts) {
            await sleep(delayMs);
        }
    }

    return {
        matched: false,
        attempt: maxAttempts,
        panelState: latestPanelState,
        matchingTab: null,
        activeUrl: String(getResult(latestPanelState)?.url || "").trim(),
    };
}

await withSidecarRuntime(
    {
        sidecarPort: 8807,
    },
    async ({ sidecarPort }) => {
        const previousConfig = existsSync(browserControlConfigPath)
            ? readFileSync(browserControlConfigPath, "utf8")
            : null;

        try {
            writeFileSync(browserControlConfigPath, JSON.stringify({ enabled: true }) + "\n", "utf8");

            const baseUrl = `http://127.0.0.1:${sidecarPort}`;
            const controlState = await post(baseUrl, "/service-config/get-browser-control-state", {});
            const panelState = await post(baseUrl, "/service-config/get-browser-panel-state", {});
            const extractResult = await post(baseUrl, "/service-config/browser-extract-page", {});
            const screenshotResult = await post(baseUrl, "/service-config/browser-capture-screenshot", {
                outputPath: "",
            });
            const controlPayload = getResult(controlState);
            const panelPayload = getResult(panelState);
            const targetTab = getTabs(panelPayload).find((tab) => typeof tab?.page === "string" && tab.page.trim());
            const fallbackCandidateUrl = String(targetTab?.url || "").trim()
                || ((targetTab?.active === true || String(targetTab?.active) === "true")
                    ? String(panelPayload?.url || "").trim()
                    : "");
            const selectResult = targetTab
                ? await post(baseUrl, "/service-config/browser-select-tab", { pageId: targetTab.page })
                : null;

            const extractPayload = getResult(extractResult);
            const screenshotPayload = getResult(screenshotResult);
            const selectPayload = getResult(selectResult);

            const extractShapeOk =
                extractResult.status === 200 &&
                extractResult.body?.ok === true &&
                extractPayload &&
                typeof extractPayload.ok === "boolean" &&
                typeof extractPayload.content === "string" &&
                typeof extractPayload.error === "string";

            const screenshotShapeOk =
                screenshotResult.status === 200 &&
                screenshotResult.body?.ok === true &&
                screenshotPayload &&
                typeof screenshotPayload.ok === "boolean" &&
                typeof screenshotPayload.screenshotPath === "string" &&
                typeof screenshotPayload.error === "string" &&
                typeof screenshotPayload.errorKind === "string" &&
                typeof screenshotPayload.errorHint === "string";

            const extractBehaviorOk = extractPayload?.ok === true || isNonEmptyString(extractPayload?.error);
            const screenshotBehaviorOk =
                screenshotPayload?.ok === true
                    ? isNonEmptyString(screenshotPayload?.screenshotPath)
                    : isNonEmptyString(screenshotPayload?.error)
                        && isNonEmptyString(screenshotPayload?.errorKind)
                        && isNonEmptyString(screenshotPayload?.errorHint);
            const runtimeProfileShapeOk =
                typeof controlPayload?.tabSwitchCapabilityDescription === "string" &&
                typeof controlPayload?.screenshotCapabilityDescription === "string" &&
                typeof controlPayload?.screenshotGuidance === "string" &&
                typeof controlPayload?.screenshotActionLabel === "string" &&
                typeof panelPayload?.tabSwitchCapabilityDescription === "string" &&
                typeof panelPayload?.screenshotCapabilityDescription === "string" &&
                typeof panelPayload?.screenshotGuidance === "string" &&
                typeof panelPayload?.screenshotActionLabel === "string";
            const screenshotErrorSanitized =
                screenshotPayload?.ok === false
                    ? !String(screenshotPayload?.error || "").includes("[UNDICI-EHPA]")
                    : true;
            const selectShapeOk = !selectResult
                || (
                    selectResult.status === 200 &&
                    selectResult.body?.ok === true &&
                    selectPayload &&
                    typeof selectPayload.ok === "boolean" &&
                    typeof selectPayload.message === "string" &&
                    typeof selectPayload.error === "string"
                );
            const expectFallbackMessage = controlPayload?.stableTabSwitch === false
                && !!targetTab
                && /^https?:\/\//i.test(fallbackCandidateUrl);
            const selectBehaviorOk = !selectResult
                || (
                    selectPayload?.ok === true &&
                    (
                        !expectFallbackMessage
                        || String(selectPayload?.message || "").includes("已改为重新打开")
                    )
                );
            const httpFallbackProbe = {
                attempted: false,
                probeUrl: "",
                openResult: null,
                matched: false,
                matchedPageId: "",
                finalPanelState: null,
                selectResult: null,
                status: "not-needed",
                note: "",
            };
            const enableRealBrowserProbe = isEnabledEnvVar(process.env.SUNDAY_VERIFY_REAL_BROWSER_PROBE);

            if (controlPayload?.extensionConnected === true && controlPayload?.stableTabSwitch === false && enableRealBrowserProbe) {
                httpFallbackProbe.attempted = true;
                httpFallbackProbe.probeUrl = `https://example.com/?sunday-tab-fallback-probe=${Date.now()}`;
                httpFallbackProbe.openResult = await post(baseUrl, "/service-config/browser-open-url", {
                    url: httpFallbackProbe.probeUrl,
                });

                const openPayload = getResult(httpFallbackProbe.openResult);
                const openShapeOk =
                    httpFallbackProbe.openResult?.status === 200 &&
                    httpFallbackProbe.openResult?.body?.ok === true &&
                    openPayload &&
                    typeof openPayload.ok === "boolean" &&
                    typeof openPayload.message === "string" &&
                    typeof openPayload.error === "string";

                if (!openShapeOk || openPayload?.ok !== true) {
                    httpFallbackProbe.status = "unexpected-failure";
                    httpFallbackProbe.note = "browser-open-url did not return the expected structured success result.";
                } else {
                    const probePanelState = await pollForProbeTab(baseUrl, httpFallbackProbe.probeUrl);
                    httpFallbackProbe.matched = probePanelState.matched;
                    httpFallbackProbe.finalPanelState = probePanelState.panelState;
                    httpFallbackProbe.matchedPageId = String(probePanelState.matchingTab?.page || "").trim();

                    if (!probePanelState.matched || !httpFallbackProbe.matchedPageId) {
                        httpFallbackProbe.status = "runtime-gap";
                        httpFallbackProbe.note =
                            "browser-open-url succeeded, but the runtime did not expose an http/https tab for fallback verification.";
                    } else {
                        httpFallbackProbe.selectResult = await post(baseUrl, "/service-config/browser-select-tab", {
                            pageId: httpFallbackProbe.matchedPageId,
                        });

                        const probeSelectPayload = getResult(httpFallbackProbe.selectResult);
                        const probeSelectOk =
                            httpFallbackProbe.selectResult?.status === 200 &&
                            httpFallbackProbe.selectResult?.body?.ok === true &&
                            probeSelectPayload &&
                            probeSelectPayload.ok === true &&
                            isNonEmptyString(probeSelectPayload.message) &&
                            String(probeSelectPayload.message).includes("已改为重新打开") &&
                            String(probeSelectPayload.message).includes(httpFallbackProbe.probeUrl);

                        if (probeSelectOk) {
                            httpFallbackProbe.status = "confirmed";
                        } else {
                            httpFallbackProbe.status = "unexpected-failure";
                            httpFallbackProbe.note =
                                "The runtime exposed an http/https tab, but browser-select-tab did not report reopen-url fallback.";
                        }
                    }
                }
            } else if (controlPayload?.extensionConnected === true && controlPayload?.stableTabSwitch === false) {
                httpFallbackProbe.status = "skipped-by-default";
                httpFallbackProbe.note =
                    "Real http/https tab probing is disabled by default to avoid interrupting the active browser workflow. Set SUNDAY_VERIFY_REAL_BROWSER_PROBE=1 to enable it.";
            }

            const httpFallbackProbeOk = ["not-needed", "confirmed", "runtime-gap", "skipped-by-default"].includes(httpFallbackProbe.status);

            const verdict =
                controlState.status === 200 &&
                controlState.body?.ok === true &&
                panelState.status === 200 &&
                panelState.body?.ok === true &&
                extractShapeOk &&
                screenshotShapeOk &&
                runtimeProfileShapeOk &&
                selectShapeOk &&
                extractBehaviorOk &&
                screenshotErrorSanitized &&
                screenshotBehaviorOk &&
                selectBehaviorOk &&
                httpFallbackProbeOk
                    ? "browser-service-config-api-confirmed"
                    : "browser-service-config-api-incomplete";

            console.log(
                JSON.stringify(
                    {
                        sidecarPort,
                        controlState,
                        panelState,
                        fallbackCandidateUrl,
                        extractResult,
                        screenshotResult,
                        selectResult,
                        httpFallbackProbe,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "browser-service-config-api-confirmed" ? 0 : 1);
        } finally {
            if (previousConfig === null) {
                if (existsSync(browserControlConfigPath)) {
                    unlinkSync(browserControlConfigPath);
                }
            } else {
                writeFileSync(browserControlConfigPath, previousConfig, "utf8");
            }
        }
    },
);
