import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

function findService(response, serviceId) {
    return response?.result?.services?.find?.((service) => service.id === serviceId) ?? null;
}

await withSidecarRuntime(
    {
        sidecarPort: 8808,
    },
    async ({ sidecarPort }) => {
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const serviceId = `verify-mcp-${Date.now()}`;
        const brokenServiceId = `${serviceId}-broken`;
        const jsonConfig = JSON.stringify(
            {
                mcpServers: {
                    [serviceId]: {
                        command: "npx",
                        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    },
                },
            },
            null,
            2,
        );
        const brokenJsonConfig = JSON.stringify(
            {
                mcpServers: {
                    [brokenServiceId]: {
                        command: "definitely-missing-mcp-binary",
                    },
                },
            },
            null,
            2,
        );

        const cleanupServiceIds = [serviceId, brokenServiceId];

        try {
            const servicesResult = await post(baseUrl, "/service-config/get-mcp-services", {});
            const runtimeReadyResult = await post(baseUrl, "/service-config/is-mcp-runtime-ready", {});
            const agreementBefore = await post(baseUrl, "/service-config/get-mcp-third-party-agreement", {});
            const setAgreement = await post(baseUrl, "/service-config/set-mcp-third-party-agreement", { accepted: true });
            const agreementAfter = await post(baseUrl, "/service-config/get-mcp-third-party-agreement", {});
            const saveService = await post(baseUrl, "/service-config/save-mcp-service", {
                jsonConfig,
                description: "MCP API verification service",
            });
            const saveBrokenService = await post(baseUrl, "/service-config/save-mcp-service", {
                jsonConfig: brokenJsonConfig,
                description: "Broken MCP API verification service",
            });
            const afterSave = await post(baseUrl, "/service-config/get-mcp-services", {});
            const refreshRuntime = await post(baseUrl, "/service-config/refresh-mcp-runtime", {});
            const disableService = await post(baseUrl, "/service-config/set-mcp-service-enabled", {
                serviceId,
                enabled: false,
            });
            const afterDisable = await post(baseUrl, "/service-config/get-mcp-services", {});

            const builtInFilesystemService = findService(servicesResult, "filesystem");
            const savedServiceBeforeRefresh = findService(afterSave, serviceId);
            const refreshedService = findService(refreshRuntime, serviceId);
            const refreshedBrokenService = findService(refreshRuntime, brokenServiceId);
            const disabledService = findService(afterDisable, serviceId);

            const verdict =
                servicesResult?.ok === true &&
                servicesResult?.result?.success === true &&
                Array.isArray(servicesResult?.result?.services) &&
                runtimeReadyResult?.result === true &&
                typeof agreementBefore?.result === "boolean" &&
                setAgreement?.result === true &&
                agreementAfter?.result === true &&
                builtInFilesystemService?.runtimeStatus === "ready" &&
                builtInFilesystemService?.toolCount > 0 &&
                Array.isArray(builtInFilesystemService?.toolPreview) &&
                builtInFilesystemService.toolPreview.length > 0 &&
                saveService?.result?.success === true &&
                saveBrokenService?.result?.success === true &&
                savedServiceBeforeRefresh?.runtimeStatus === "connecting" &&
                refreshedService?.runtimeStatus === "ready" &&
                refreshedService?.transportKind === "stdio" &&
                refreshedService?.toolCount > 0 &&
                Array.isArray(refreshedService?.toolPreview) &&
                refreshedService.toolPreview.length > 0 &&
                refreshedBrokenService?.runtimeStatus === "error" &&
                typeof refreshedBrokenService?.runtimeDetail === "string" &&
                refreshedBrokenService.runtimeDetail.length > 0 &&
                disableService?.result?.success === true &&
                disabledService?.runtimeStatus === "disabled"
                    ? "mcp-api-confirmed"
                    : "mcp-api-incomplete";

            console.log(
                JSON.stringify(
                    {
                        sidecarPort,
                        servicesResult: servicesResult.result,
                        runtimeReadyResult,
                        agreementBefore,
                        setAgreement,
                        agreementAfter,
                        saveService: saveService.result,
                        saveBrokenService: saveBrokenService.result,
                        afterSave: afterSave.result,
                        refreshRuntime: refreshRuntime.result,
                        disableService: disableService.result,
                        afterDisable: afterDisable.result,
                        verdict,
                    },
                    null,
                    2,
                ),
            );

            process.exit(verdict === "mcp-api-confirmed" ? 0 : 1);
        } finally {
            await Promise.all(
                cleanupServiceIds.map(async (cleanupServiceId) => {
                    try {
                        await post(baseUrl, "/service-config/delete-mcp-service", {
                            serviceId: cleanupServiceId,
                        });
                    } catch {
                        // ignore cleanup errors in verifier
                    }
                }),
            );
        }
    },
);
