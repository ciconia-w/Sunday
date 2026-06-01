import { verifyHostQtWorkspace } from "./lib/verify-host-qt-workspace.mjs";

await verifyHostQtWorkspace({
    workspace: "modelSettings",
    staticPort: 4179,
    sidecarPort: 8793,
    expectedBundleMarkers: ["Model Settings", "Available Models", "Saved locally to .env.local as"],
    verdictConfirmed: "host-qt-model-settings-confirmed",
    verdictIncomplete: "host-qt-model-settings-incomplete",
});
