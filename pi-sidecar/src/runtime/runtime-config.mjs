import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const KNOWN_PROVIDER_API_KEY_ENV_MAP = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
};

export const KNOWN_PROVIDER_OPTIONS = [
    { id: "deepseek", label: "DeepSeek", apiKeyEnv: KNOWN_PROVIDER_API_KEY_ENV_MAP.deepseek },
    { id: "openai", label: "OpenAI", apiKeyEnv: KNOWN_PROVIDER_API_KEY_ENV_MAP.openai },
    { id: "anthropic", label: "Anthropic", apiKeyEnv: KNOWN_PROVIDER_API_KEY_ENV_MAP.anthropic },
    { id: "google", label: "Google", apiKeyEnv: KNOWN_PROVIDER_API_KEY_ENV_MAP.google },
    { id: "openrouter", label: "OpenRouter", apiKeyEnv: KNOWN_PROVIDER_API_KEY_ENV_MAP.openrouter },
];

export function getLocalEnvPath() {
    return resolve(process.cwd(), "..", ".env.local");
}

export function loadLocalEnvFile() {
    const envPath = getLocalEnvPath();
    if (!existsSync(envPath)) {
        return {};
    }

    const result = {};
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }

    return result;
}

function serializeEnvValue(value) {
    if (typeof value !== "string") {
        return "";
    }

    if (value === "") {
        return "";
    }

    if (/[\s#"']/u.test(value)) {
        return JSON.stringify(value);
    }

    return value;
}

export function saveLocalEnvFile(entries) {
    const envPath = getLocalEnvPath();
    const lines = Object.entries(entries)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => `${key}=${serializeEnvValue(value)}`);
    writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
    return envPath;
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim() !== "") {
            return value.trim();
        }
    }
    return "";
}

export function createRuntimeConfig(agentDir) {
    const localEnv = loadLocalEnvFile();

    const provider = firstNonEmpty(
        process.env.PERSONAL_AGENT_PROVIDER,
        process.env.PI_PROVIDER,
        localEnv.PERSONAL_AGENT_PROVIDER,
        localEnv.PI_PROVIDER,
        "openai",
    );

    const modelId = firstNonEmpty(
        process.env.PERSONAL_AGENT_MODEL,
        process.env.PI_MODEL,
        localEnv.PERSONAL_AGENT_MODEL,
        localEnv.PI_MODEL,
        "gpt-5.4-mini",
    );

    const authStorage = AuthStorage.create(`${agentDir}/auth.json`);

    const envApiKeys = {
        openai: firstNonEmpty(process.env.OPENAI_API_KEY, localEnv.OPENAI_API_KEY),
        anthropic: firstNonEmpty(process.env.ANTHROPIC_API_KEY, localEnv.ANTHROPIC_API_KEY),
        google: firstNonEmpty(process.env.GEMINI_API_KEY, localEnv.GEMINI_API_KEY),
        deepseek: firstNonEmpty(process.env.DEEPSEEK_API_KEY, localEnv.DEEPSEEK_API_KEY),
        openrouter: firstNonEmpty(process.env.OPENROUTER_API_KEY, localEnv.OPENROUTER_API_KEY),
    };

    for (const [envProvider, apiKey] of Object.entries(envApiKeys)) {
        if (typeof apiKey === "string" && apiKey.trim() !== "") {
            authStorage.setRuntimeApiKey(envProvider, apiKey.trim());
        }
    }

    const modelRegistry = ModelRegistry.create(authStorage);
    const model = getModel(provider, modelId);

    const hasConfiguredKey =
        typeof envApiKeys[provider] === "string" && envApiKeys[provider].trim() !== "";

    const availableModelsRaw = firstNonEmpty(
        process.env.PERSONAL_AGENT_AVAILABLE_MODELS,
        process.env.PI_AVAILABLE_MODELS,
        localEnv.PERSONAL_AGENT_AVAILABLE_MODELS,
        localEnv.PI_AVAILABLE_MODELS,
        modelId,
    );

    const availableModelIds = availableModelsRaw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

    return {
        provider,
        modelId,
        availableModelIds,
        localEnv,
        authStorage,
        modelRegistry,
        model,
        envApiKeys,
        hasConfiguredKey,
        mode: hasConfiguredKey ? "live" : "demo",
        modeReason: hasConfiguredKey
            ? "provider credential detected"
            : `no API key found for provider ${provider}`,
    };
}
