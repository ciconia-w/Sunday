async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const servicesResult = await post("/service-config/get-mcp-services", {});
const runtimeReadyResult = await post("/service-config/is-mcp-runtime-ready", {});
const agreementBefore = await post("/service-config/get-mcp-third-party-agreement", {});
const setAgreement = await post("/service-config/set-mcp-third-party-agreement", { accepted: true });
const agreementAfter = await post("/service-config/get-mcp-third-party-agreement", {});

const verdict =
    servicesResult?.ok === true &&
    servicesResult?.result?.success === true &&
    Array.isArray(servicesResult?.result?.services) &&
    runtimeReadyResult?.result === true &&
    typeof agreementBefore?.result === "boolean" &&
    setAgreement?.result === true &&
    agreementAfter?.result === true
        ? "mcp-api-confirmed"
        : "mcp-api-incomplete";

console.log(
    JSON.stringify(
        {
            servicesResult: servicesResult.result,
            runtimeReadyResult,
            agreementBefore,
            setAgreement,
            agreementAfter,
            verdict,
        },
        null,
        2,
    ),
);
