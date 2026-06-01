import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
    const postToRuntime = async (path, body) => {
        const response = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
        });
        return response.json();
    };

    const initial = await postToRuntime("/model-config/get");
    const initialConfig = initial.result ?? {};

    const savePayload = {
        provider: initialConfig.provider ?? "deepseek",
        model: initialConfig.model ?? "deepseek-v4-pro",
        availableModels: Array.isArray(initialConfig.availableModels)
            ? initialConfig.availableModels.join(",")
            : "deepseek-v4-pro,deepseek-v4-flash",
        providerApiKey: initialConfig.providerApiKey ?? "",
    };

    const saved = await postToRuntime("/model-config/save", savePayload);
    const updated = await postToRuntime("/model-config/get");
    const state = await fetch(`http://127.0.0.1:${sidecarPort}/state`).then((response) => response.json());

    const verdict =
        initial.ok === true &&
        saved.ok === true &&
        updated.ok === true &&
        updated.result?.provider === savePayload.provider &&
        updated.result?.model === savePayload.model &&
        Array.isArray(updated.result?.availableModels) &&
        updated.result.availableModels.includes(savePayload.model) &&
        state.runtime?.provider === savePayload.provider &&
        state.runtime?.modelId === savePayload.model
            ? "model-config-api-confirmed"
            : "model-config-api-incomplete";

    console.log(
        JSON.stringify(
            {
                initial: initial.result,
                saved: saved.result,
                updated: updated.result,
                runtime: state.runtime,
                verdict,
            },
            null,
            2,
        ),
    );

    if (verdict !== "model-config-api-confirmed") {
        process.exit(1);
    }
});
