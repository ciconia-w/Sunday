import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime(
    {
        sidecarPort: 8808,
    },
    async ({ sidecarPort }) => {
        const baseUrl = `http://127.0.0.1:${sidecarPort}`;
        const serviceId = `verify-mcp-${Date.now()}`;
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
        const servicesResult = await post(baseUrl, "/service-config/get-mcp-services", {});
        const runtimeReadyResult = await post(baseUrl, "/service-config/is-mcp-runtime-ready", {});
        const agreementBefore = await post(baseUrl, "/service-config/get-mcp-third-party-agreement", {});
        const setAgreement = await post(baseUrl, "/service-config/set-mcp-third-party-agreement", { accepted: true });
        const agreementAfter = await post(baseUrl, "/service-config/get-mcp-third-party-agreement", {});
        const saveService = await post(baseUrl, "/service-config/save-mcp-service", {
            jsonConfig,
            description: "MCP API verification service",
        });
        const afterSave = await post(baseUrl, "/service-config/get-mcp-services", {});
        const disableService = await post(baseUrl, "/service-config/set-mcp-service-enabled", {
            serviceId,
            enabled: false,
        });
        const afterDisable = await post(baseUrl, "/service-config/get-mcp-services", {});
        const deleteService = await post(baseUrl, "/service-config/delete-mcp-service", {
            serviceId,
        });
        const afterDelete = await post(baseUrl, "/service-config/get-mcp-services", {});

        const savedService = afterSave?.result?.services?.find?.((service) => service.id === serviceId);
        const disabledService = afterDisable?.result?.services?.find?.((service) => service.id === serviceId);
        const deletedService = afterDelete?.result?.services?.find?.((service) => service.id === serviceId);

        const verdict =
            servicesResult?.ok === true &&
            servicesResult?.result?.success === true &&
            Array.isArray(servicesResult?.result?.services) &&
            runtimeReadyResult?.result === true &&
            typeof agreementBefore?.result === "boolean" &&
            setAgreement?.result === true &&
            agreementAfter?.result === true &&
            saveService?.result?.success === true &&
            savedService?.isBuiltIn === false &&
            savedService?.editable === true &&
            savedService?.removable === true &&
            savedService?.enabled === true &&
            disableService?.result?.success === true &&
            disabledService?.enabled === false &&
            deleteService?.result?.success === true &&
            !deletedService
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
                    afterSave: afterSave.result,
                    disableService: disableService.result,
                    afterDisable: afterDisable.result,
                    deleteService: deleteService.result,
                    afterDelete: afterDelete.result,
                    verdict,
                },
                null,
                2,
            ),
        );

        process.exit(verdict === "mcp-api-confirmed" ? 0 : 1);
    },
);
