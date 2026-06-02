import { ensureDevInjectedChannels } from "./dev-injected-channels";
import { createRemoteInjectedChannels } from "./remote-injected-channels";

declare global {
    interface Window {
        __UOS_PI_CHANNELS__?: unknown;
        __UOS_RUNTIME_STATUS__?: {
            mode: "remote-live" | "remote-demo" | "remote-unknown" | "local-mock";
            rawMode?: "live" | "demo" | "mock" | "unknown";
            provider: string;
            modelId: string;
            reason: string;
        };
    }
}

async function injectRemoteChannels() {
    if (typeof window !== "undefined" && (window as any).qt?.webChannelTransport) {
        document.body.setAttribute("data-runtime-channel-source", "qt-webchannel");
        return;
    }

    const baseUrl = "";
    window.__UOS_PI_CHANNELS__ = await createRemoteInjectedChannels(baseUrl);
    document.body.setAttribute("data-runtime-channel-source", "remote");

    try {
        const stateResponse = await fetch(`${baseUrl}/state`);
        const state = await stateResponse.json();
        const runtime = state.runtime ?? {};
        window.__UOS_RUNTIME_STATUS__ = {
            mode: runtime.mode === "live" ? "remote-live" : "remote-demo",
            rawMode: runtime.mode === "live" || runtime.mode === "demo" ? runtime.mode : "unknown",
            provider: runtime.provider ?? "unknown",
            modelId: runtime.modelId ?? "unknown",
            reason: runtime.modeReason ?? "remote sidecar connected",
        };
    } catch (error) {
        window.__UOS_RUNTIME_STATUS__ = {
            mode: "remote-unknown",
            rawMode: "unknown",
            provider: "remote",
            modelId: "unknown",
            reason: error instanceof Error ? error.message : "remote state fetch failed",
        };
        document.body.setAttribute(
            "data-runtime-state-error",
            error instanceof Error ? error.message.slice(0, 160) : "remote state fetch failed",
        );
    }
}

void (async () => {
    try {
        await injectRemoteChannels();
    } catch (error) {
        console.warn("[personal-agent-desktop] remote sidecar unavailable, fallback to local mock", error);
        ensureDevInjectedChannels();
        window.__UOS_RUNTIME_STATUS__ = {
            mode: "local-mock",
            rawMode: "mock",
            provider: "mock",
            modelId: "mock/gpt-5.4-mini",
            reason: error instanceof Error ? error.message : "local mock fallback",
        };
        document.body.setAttribute("data-runtime-channel-source", "local-mock");
        document.body.setAttribute(
            "data-runtime-channel-error",
            error instanceof Error ? error.message.slice(0, 160) : "local mock fallback",
        );
    }
})();
