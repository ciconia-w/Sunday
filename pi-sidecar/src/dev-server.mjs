import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { PiSessionBridge } from "./runtime/pi-session-bridge.mjs";
import { ConversationRepository } from "./runtime/conversation-repository.mjs";
import { SkillsRegistry } from "./runtime/skills-registry.mjs";
import { McpRegistry } from "./runtime/mcp-registry.mjs";
import { ExternalIngress } from "./runtime/external-ingress.mjs";
import { createRuntimeConfig } from "./runtime/runtime-config.mjs";
import { ModelConfigRegistry } from "./runtime/model-config-registry.mjs";
import {
    captureBrowserScreenshot,
    createBrowserTab,
    extractBrowserPage,
    getBrowserScreenshotErrorDetails,
    getBrowserControlStatus,
    getBrowserPanelState,
    initBrowserSession,
    openBrowserUrl,
    selectBrowserTab,
    setBrowserControlEnabled,
    startBrowserSessionIfEnabled,
} from "./runtime/browser-control.mjs";
import { getCliToolsState } from "./runtime/cli-tools-status.mjs";
import { getModel } from "@earendil-works/pi-ai";
import { UosSessionEvent } from "./runtime/channel-types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgeDir = resolve(__dirname, "bridge");
const staticDir = resolve(__dirname, "static");
const workspaceDir = resolve(process.cwd(), "..");
const runtimeDir = resolve(process.cwd(), ".pi-sidecar");
const userSkillsDir = resolve(process.env.PERSONAL_AGENT_SKILLS_USER_DIR || join(homedir(), ".codex", "skills"));
const repoSkillsDir = resolve(process.env.PERSONAL_AGENT_SKILLS_REPO_DIR || resolve(workspaceDir, "skills"));

const files = [
    "signal.ts",
    "channel-types.ts",
    "create-browser-channels.ts",
    "pi-session-bridge.ts",
];

let runtimeConfig = createRuntimeConfig(runtimeDir);
const modelConfigRegistry = new ModelConfigRegistry({ agentDir: runtimeDir });

const genericAssistantDefinition = {
    id: "uos-ai-generic",
    name: "Sunday",
    description: "General-purpose desktop agent for chat, tools, and file work",
    icon: { line: "uos-ai", color: "uos-ai-color" },
    gradient_colors: ["#6448FF", "#FF37DF", "#FCA506"],
    path: "icons/",
    place_holder: "让 Sunday 帮你检查文件、调用工具或处理任务...",
    envExists: true,
};

const retainedAssistantDefinitions = [
    {
        id: "uos-ai-writing",
        name: "Writing",
        description: "Create and edit long-form documents",
        icon: { line: "ai-writing", color: "ai-writing-color" },
        gradient_colors: ["#00B9F1", "#0086DD"],
        path: "icons/",
        place_holder: "Describe the document you want to create...",
        envExists: true,
    },
];

const assistantDefinitions = [genericAssistantDefinition];
const assistantDefinitionsById = new Map(
    [genericAssistantDefinition, ...retainedAssistantDefinitions].map((assistant) => [assistant.id, assistant]),
);

function toModelSummary(modelId) {
    return {
        id: `${runtimeConfig.provider}/${modelId}`,
        name: modelId,
        icon: "",
        network: "online",
        provider: runtimeConfig.provider,
        ability: 5,
    };
}

const state = {
    assistants: assistantDefinitions,
    modelsByAssistant: {},
    currentModelId: `${runtimeConfig.provider}/${runtimeConfig.modelId}`,
    system: {
        activeColor: "#0081ff",
        fontInfo: "Noto Sans#14",
        themeColor: 1,
        networkStatus: true,
        translations: {},
    },
    runtime: {
        provider: runtimeConfig.provider,
        modelId: runtimeConfig.modelId,
        hasConfiguredKey: runtimeConfig.hasConfiguredKey,
        mode: runtimeConfig.mode,
        modeReason: runtimeConfig.modeReason,
    },
    recentWritingDocs: [],
    writingTemplates: [],
};

const clients = new Set();
const demoPendingApprovals = new Map();
const sessionRenderState = new Map();
const sessionBridge = new PiSessionBridge({
    cwd: workspaceDir,
    agentDir: runtimeDir,
    authStorage: runtimeConfig.authStorage,
    modelRegistry: runtimeConfig.modelRegistry,
    model: runtimeConfig.model,
    defaultModelId: runtimeConfig.modelId,
    getModelById: (modelId) => getModel(runtimeConfig.provider, modelId),
    tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
});
const conversationRepository = new ConversationRepository({
    runtimeDir,
    assistants: [genericAssistantDefinition, ...retainedAssistantDefinitions],
});
const skillsRegistry = new SkillsRegistry({
    roots: [
        { dir: userSkillsDir, source: "auto" },
        { dir: repoSkillsDir, source: "repo" },
    ],
    managedRootDir: userSkillsDir,
    sourceDocPath: resolve(workspaceDir, "docs", "skills-source-of-truth.md"),
});
const mcpRegistry = new McpRegistry({ runtimeDir });
const externalIngress = new ExternalIngress({
    provider: runtimeConfig.provider,
    defaultModelId: runtimeConfig.modelId,
    conversationRepository,
    sessionBridge,
});

function normalizeRuntimeModelId(modelId) {
    if (typeof modelId !== "string") {
        return "";
    }

    const trimmed = modelId.trim();
    if (!trimmed) {
        return "";
    }

    const prefix = `${runtimeConfig.provider}/`;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function applyRuntimeConfig() {
    const sharedModelList = runtimeConfig.availableModelIds.map((modelId) => toModelSummary(modelId));
    state.modelsByAssistant = Object.fromEntries(
        [...assistantDefinitions, ...retainedAssistantDefinitions].map((assistant) => [assistant.id, sharedModelList]),
    );
    state.currentModelId = `${runtimeConfig.provider}/${sessionBridge.getCurrentModelId("uos-ai-generic")}`;
    state.runtime = {
        provider: runtimeConfig.provider,
        modelId: runtimeConfig.modelId,
        hasConfiguredKey: runtimeConfig.hasConfiguredKey,
        mode: runtimeConfig.mode,
        modeReason: runtimeConfig.modeReason,
    };
}

function reloadRuntimeConfig() {
    runtimeConfig = createRuntimeConfig(runtimeDir);
    sessionBridge.options.authStorage = runtimeConfig.authStorage;
    sessionBridge.options.modelRegistry = runtimeConfig.modelRegistry;
    sessionBridge.options.model = runtimeConfig.model;
    sessionBridge.options.getModelById = (modelId) => getModel(runtimeConfig.provider, modelId);
    sessionBridge.setDefaultModelId(runtimeConfig.modelId);
    sessionBridge.setAssistantModel("uos-ai-generic", runtimeConfig.modelId);
    sessionBridge.setAssistantModel("uos-ai-writing", runtimeConfig.modelId);
    externalIngress.provider = runtimeConfig.provider;
    externalIngress.defaultModelId = runtimeConfig.modelId;
    applyRuntimeConfig();
}

async function refreshDerivedState() {
    applyRuntimeConfig();
    state.recentWritingDocs = await conversationRepository.getRecentWritingDocs();
    state.writingTemplates = conversationRepository.getWritingTemplates();
    await skillsRegistry.reload();
}

reloadRuntimeConfig();

function emitSession(event, sessionId, message) {
    const payload = `event: session\ndata: ${JSON.stringify({ event, sessionId, message })}\n\n`;
    for (const client of clients) {
        client.write(payload);
    }
}

async function persistHeadlessSessionRender(event, sessionId, message) {
    if (event === UosSessionEvent.SeStarted) {
        sessionRenderState.set(sessionId, {
            conversationId: "",
            renderItems: [],
        });
        return;
    }

    if (event === UosSessionEvent.SeMessage) {
        try {
            const parsed = JSON.parse(message);
            const current = sessionRenderState.get(sessionId) ?? {
                conversationId: "",
                renderItems: [],
            };

            if (typeof parsed?.conversation_id === "string" && parsed.conversation_id.trim()) {
                current.conversationId = parsed.conversation_id.trim();
            }

            if (typeof parsed?.type === "string") {
                if (parsed.type === "text" && typeof parsed?.data?.content === "string") {
                    const lastItem = current.renderItems[current.renderItems.length - 1];
                    if (lastItem?.type === "text" && typeof lastItem?.data?.content === "string") {
                        lastItem.data.content += parsed.data.content;
                    } else {
                        current.renderItems.push({
                            type: "text",
                            data: {
                                content: parsed.data.content,
                            },
                        });
                    }
                } else {
                    current.renderItems.push({
                        type: parsed.type,
                        data: parsed.data ?? {},
                    });
                }
            }

            sessionRenderState.set(sessionId, current);
        } catch {
            // ignore malformed or non-JSON message payloads
        }
        return;
    }

    if (event === UosSessionEvent.SeFinished) {
        const current = sessionRenderState.get(sessionId);
        sessionRenderState.delete(sessionId);

        if (!current?.conversationId) {
            return;
        }

        try {
            const parsed = JSON.parse(message);
            const messageId = typeof parsed?.id === "string" ? parsed.id.trim() : "";
            if (!messageId) {
                return;
            }

            await conversationRepository.setConversationRender(
                current.conversationId,
                messageId,
                JSON.stringify(current.renderItems),
            );
            await conversationRepository.saveConversation(current.conversationId);
        } catch (error) {
            console.error("[dev-server] failed to persist headless session render:", error);
        }
        return;
    }

    if (event === UosSessionEvent.SeError) {
        sessionRenderState.delete(sessionId);
    }
}

sessionBridge.sessionEvent.connect((event, sessionId, message) => {
    persistHeadlessSessionRender(event, sessionId, message).catch((error) => {
        console.error("[dev-server] background session render persistence failed:", error);
    });
    emitSession(event, sessionId, message);
});

function emitDemoConversation(params) {
    const sessionId = params?.session_id ?? randomUUID();
    const conversationId = params?.conversation_id ?? randomUUID();
    const text = (params?.message?.content ?? [])
        .map((item) => item?.data?.content ?? "")
        .join("\n")
        .trim();
    const approvalId = randomUUID();

    demoPendingApprovals.set(approvalId, {
        sessionId,
        conversationId,
        text,
        kind: "bash_approve",
    });

    emitSession(1, sessionId, "");
    setTimeout(() => {
        emitSession(
            4,
            sessionId,
            JSON.stringify({
                type: "text",
                data: {
                    content: `[demo mode] 当前未检测到 ${runtimeConfig.provider} 的 API key。\n`,
                },
            }),
        );
    }, 50);
    setTimeout(() => {
        emitSession(
            4,
            sessionId,
            JSON.stringify({
                type: "interactive_components",
                data: {
                    id: approvalId,
                    ic_type: "bash_approve",
                    title: "Allow demo bash command?",
                    command: `echo ${JSON.stringify(text || "(empty)")}`,
                    status: "pending",
                },
            }),
        );
    }, 120);
}

function finishDemoApproval(action) {
    const requestId = action?.request_id ?? action?.id ?? "";
    const approval = demoPendingApprovals.get(requestId);
    if (!approval) {
        return;
    }

    demoPendingApprovals.delete(requestId);
    const approved = action?.approved === true || action?.approve === true;

    emitSession(
        4,
        approval.sessionId,
        JSON.stringify({
            type: "interactive_components",
            data: {
                id: requestId,
                ic_type: "bash_approve",
                title: "Allow demo bash command?",
                command: `echo ${JSON.stringify(approval.text || "(empty)")}`,
                status: approved ? "approved" : "rejected",
            },
        }),
    );

    if (approved) {
        emitSession(
            4,
            approval.sessionId,
            JSON.stringify({
                type: "tool",
                data: {
                    name: "demo_runtime_notice",
                    status: 1,
                    result: runtimeConfig.modeReason,
                },
            }),
        );
        emitSession(
            4,
            approval.sessionId,
            JSON.stringify({
                type: "text",
                data: {
                    content: `你刚刚输入的是：${approval.text || "(empty)"}\n请配置 provider key 后切换到 live mode。`,
                },
            }),
        );
    } else {
        emitSession(
            4,
            approval.sessionId,
            JSON.stringify({
                type: "error",
                data: {
                    error: 0,
                    error_message: action?.reject_msg || "Demo action rejected by user",
                },
            }),
        );
    }

    emitSession(
        2,
        approval.sessionId,
        JSON.stringify({
            id: randomUUID(),
            conversation_id: approval.conversationId,
        }),
    );
}

const server = createServer(async (_req, res) => {
    if (_req.url === "/runtime/channels.js") {
        const content = await readFile(resolve(staticDir, "channels-runtime.js"), "utf8");
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
        res.end(content);
        return;
    }

    if (_req.url === "/events") {
        res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
        });
        res.write("\n");
        clients.add(res);
        _req.on("close", () => {
            clients.delete(res);
        });
        return;
    }

    if (_req.url?.startsWith("/state")) {
        await refreshDerivedState();
        const startupAssistantId = (() => {
            try {
                const requestUrl = new URL(_req.url, "http://127.0.0.1");
                return requestUrl.searchParams.get("assistant") ?? "";
            } catch {
                return "";
            }
        })();
        const requestedRetainedAssistant =
            startupAssistantId && assistantDefinitionsById.has(startupAssistantId)
                ? assistantDefinitionsById.get(startupAssistantId)
                : null;
        const visibleAssistants = requestedRetainedAssistant
            ? [genericAssistantDefinition, requestedRetainedAssistant].filter(
                  (assistant, index, list) => list.findIndex((item) => item.id === assistant.id) === index,
              )
            : assistantDefinitions;
        const responseState = {
            ...state,
            assistants: visibleAssistants,
        };
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(responseState, null, 2));
        return;
    }

    if (_req.method === "POST" && _req.url?.startsWith("/session/")) {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            const body = raw ? JSON.parse(raw) : {};

            try {
                if (_req.url === "/session/send") {
                    if (runtimeConfig.mode === "demo") {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        await conversationRepository.trackOutgoingPayload(parsed);
                        emitDemoConversation(parsed);
                    } else {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        await conversationRepository.trackOutgoingPayload(parsed);
                        const sessionPromise = sessionBridge.sendMessage(body.params);
                        sessionPromise.catch((error) => {
                            emitSession(
                                3,
                                parsed?.session_id ?? randomUUID(),
                                JSON.stringify({
                                    error: -1,
                                    error_message: error instanceof Error ? error.message : String(error),
                                }),
                            );
                            console.error("[dev-server] background /session/send failed:", error);
                        });
                    }
                } else if (_req.url === "/session/retry") {
                    if (runtimeConfig.mode === "demo") {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        await conversationRepository.trackOutgoingPayload(parsed);
                        emitDemoConversation(parsed);
                    } else {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        await conversationRepository.trackOutgoingPayload(parsed);
                        await sessionBridge.retry(body.params);
                    }
                } else if (_req.url === "/session/cancel") {
                    if (runtimeConfig.mode === "demo") {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        const sessionId = parsed?.session_id ?? randomUUID();
                        emitSession(
                            3,
                            sessionId,
                            JSON.stringify({
                                error: 0,
                                error_message: "Generation stopped by user",
                            }),
                        );
                    } else {
                        await sessionBridge.cancel(body.params);
                    }
                } else if (_req.url === "/session/action") {
                    if (runtimeConfig.mode === "demo") {
                        const action = body.json ? JSON.parse(body.json) : {};
                        finishDemoApproval(action);
                    } else {
                        await sessionBridge.invokeAction(body.sessionId ?? "", body.json ?? "{}");
                    }
                } else {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown session endpoint" }));
                    return;
                }

                await refreshDerivedState();

                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true }));
            } catch (error) {
                const sessionId = (() => {
                    try {
                        const parsed = body.params ? JSON.parse(body.params) : null;
                        return parsed?.session_id ?? randomUUID();
                    } catch {
                        return randomUUID();
                    }
                })();

                emitSession(
                    3,
                    sessionId,
                    JSON.stringify({
                        error: -1,
                        error_message: error instanceof Error ? error.message : String(error),
                    }),
                );

                res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        });
        return;
    }

    if (_req.method === "POST" && _req.url === "/assistant/set-current-model") {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            const body = raw ? JSON.parse(raw) : {};
            const assistantId = body.assistantId ?? "";
            const modelId = normalizeRuntimeModelId(body.modelId ?? "");

            sessionBridge.setAssistantModel(assistantId, modelId);
            await refreshDerivedState();

            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, result: true }));
        });
        return;
    }

    if (_req.method === "POST" && _req.url?.startsWith("/model-config/")) {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            try {
                const body = raw ? JSON.parse(raw) : {};
                let result = null;

                if (_req.url === "/model-config/get") {
                    result = modelConfigRegistry.getConfig();
                } else if (_req.url === "/model-config/save") {
                    result = modelConfigRegistry.saveConfig(body);
                    reloadRuntimeConfig();
                    await refreshDerivedState();
                } else {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown model-config endpoint" }));
                    return;
                }

                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true, result }));
            } catch (error) {
                res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        });
        return;
    }

    if (_req.method === "POST" && _req.url?.startsWith("/service-config/")) {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            try {
                const body = raw ? JSON.parse(raw) : {};
                let result = null;

                if (_req.url === "/service-config/get-mcp-services") {
                    result = await mcpRegistry.getServicesResponse();
                } else if (_req.url === "/service-config/refresh-mcp-runtime") {
                    result = await mcpRegistry.refreshRuntimeState();
                } else if (_req.url === "/service-config/is-mcp-runtime-ready") {
                    result = mcpRegistry.isRuntimeReady();
                } else if (_req.url === "/service-config/set-mcp-service-enabled") {
                    result = await mcpRegistry.setServiceEnabled(body.serviceId ?? "", body.enabled === true);
                } else if (_req.url === "/service-config/save-mcp-service") {
                    result = await mcpRegistry.saveService(
                        body.jsonConfig ?? "",
                        body.description ?? "",
                        body.serviceId ?? "",
                    );
                } else if (_req.url === "/service-config/delete-mcp-service") {
                    result = await mcpRegistry.deleteService(body.serviceId ?? "");
                } else if (_req.url === "/service-config/get-runtime-status") {
                    result = state.runtime;
                } else if (_req.url === "/service-config/get-cli-tools-state") {
                    result = await getCliToolsState();
                } else if (_req.url === "/service-config/get-browser-control-state") {
                    result = await getBrowserControlStatus();
                } else if (_req.url === "/service-config/set-browser-control-enabled") {
                    result = setBrowserControlEnabled(body.enabled === true);
                } else if (_req.url === "/service-config/get-browser-panel-state") {
                    result = await getBrowserPanelState();
                } else if (_req.url === "/service-config/start-browser-session-if-enabled") {
                    result = await startBrowserSessionIfEnabled();
                } else if (_req.url === "/service-config/init-browser-session") {
                    result = await initBrowserSession();
                } else if (_req.url === "/service-config/browser-open-url") {
                    try {
                        result = {
                            ok: true,
                            message: await openBrowserUrl(body.url ?? ""),
                            error: "",
                        };
                    } catch (error) {
                        result = {
                            ok: false,
                            message: "",
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                } else if (_req.url === "/service-config/browser-new-tab") {
                    try {
                        result = {
                            ok: true,
                            message: await createBrowserTab(body.url ?? "https://example.com"),
                            error: "",
                        };
                    } catch (error) {
                        result = {
                            ok: false,
                            message: "",
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                } else if (_req.url === "/service-config/browser-select-tab") {
                    try {
                        result = {
                            ok: true,
                            message: await selectBrowserTab(body.pageId ?? ""),
                            error: "",
                        };
                    } catch (error) {
                        result = {
                            ok: false,
                            message: "",
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                } else if (_req.url === "/service-config/browser-extract-page") {
                    try {
                        result = {
                            ok: true,
                            content: await extractBrowserPage(),
                            error: "",
                        };
                    } catch (error) {
                        result = {
                            ok: false,
                            content: "",
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                } else if (_req.url === "/service-config/browser-capture-screenshot") {
                    try {
                        result = {
                            ok: true,
                            ...(await captureBrowserScreenshot(body.outputPath ?? "")),
                            error: "",
                            errorKind: "",
                            errorHint: "",
                        };
                    } catch (error) {
                        const screenshotFailure = getBrowserScreenshotErrorDetails(error);
                        result = {
                            ok: false,
                            screenshotPath: "",
                            error: screenshotFailure.errorMessage,
                            errorKind: screenshotFailure.errorKind,
                            errorHint: screenshotFailure.errorHint,
                        };
                    }
                } else if (_req.url === "/service-config/get-mcp-third-party-agreement") {
                    result = await mcpRegistry.getThirdPartyAgreement();
                } else if (_req.url === "/service-config/set-mcp-third-party-agreement") {
                    result = await mcpRegistry.setThirdPartyAgreement(body.accepted === true);
                } else {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown service-config endpoint" }));
                    return;
                }

                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true, result }));
            } catch (error) {
                res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        });
        return;
    }

    if (_req.method === "POST" && _req.url === "/ingress/message") {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            const body = raw ? JSON.parse(raw) : {};
            const result = await externalIngress.acceptMessage(body);
            res.writeHead(result.ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
        });
        return;
    }

    if (_req.method === "POST" && _req.url?.startsWith("/skills/")) {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            try {
                const body = raw ? JSON.parse(raw) : {};
                let result = null;

                if (_req.url === "/skills/data") {
                    await skillsRegistry.reload();
                    result = skillsRegistry.getSkills();
                } else if (_req.url === "/skills/reload") {
                    result = await skillsRegistry.reload();
                } else if (_req.url === "/skills/set-enabled") {
                    result = skillsRegistry.setSkillEnabled(body.skillName ?? "", body.enabled === true);
                } else if (_req.url === "/skills/has") {
                    result = skillsRegistry.hasSkill(body.skillName ?? "");
                } else if (_req.url === "/skills/source-of-truth") {
                    result = skillsRegistry.getSourceOfTruth();
                } else if (_req.url === "/skills/import-local") {
                    result = await skillsRegistry.importSkill(body.sourcePath ?? "");
                } else if (_req.url === "/skills/import-github") {
                    result = await skillsRegistry.importGithubSkill(body.repoInput ?? "");
                } else if (_req.url === "/skills/remove") {
                    result = await skillsRegistry.removeSkill(body.skillName ?? "");
                } else {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown skills endpoint" }));
                    return;
                }

                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true, result }));
            } catch (error) {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : "Skills operation failed",
                }));
            }
        });
        return;
    }

    if (_req.method === "POST" && _req.url?.startsWith("/conversation/")) {
        let raw = "";
        _req.on("data", (chunk) => {
            raw += chunk;
        });
        _req.on("end", async () => {
            const body = raw ? JSON.parse(raw) : {};

            try {
                let result = null;

                if (_req.url === "/conversation/get") {
                    result = await conversationRepository.snapshotConversation(body.id ?? "");
                } else if (_req.url === "/conversation/delete") {
                    await conversationRepository.deleteConversation(body.ids ?? []);
                    result = true;
                } else if (_req.url === "/conversation/release") {
                    await conversationRepository.releaseConversation(body.ids ?? []);
                    result = true;
                } else if (_req.url === "/conversation/save") {
                    result = await conversationRepository.saveConversation(body.id ?? "");
                } else if (_req.url === "/conversation/indexes") {
                    result = await conversationRepository.getConversationIndexes();
                } else if (_req.url === "/conversation/history-indexes") {
                    result = await conversationRepository.getHistoryConversationIndexes();
                } else if (_req.url === "/conversation/search") {
                    result = await conversationRepository.searchConversations(body.keyword ?? "");
                } else if (_req.url === "/conversation/set-render") {
                    result = await conversationRepository.setConversationRender(
                        body.conversationId ?? "",
                        body.messageId ?? "",
                        body.renderJson ?? "[]",
                    );
                } else if (_req.url === "/conversation/switch-next") {
                    result = await conversationRepository.switchMessageNext(
                        body.conversationId ?? "",
                        body.target ?? "",
                        body.next ?? "",
                    );
                } else if (_req.url === "/conversation/get-workspace-outline") {
                    result = await conversationRepository.getWorkspaceOutline(
                        body.conversationId ?? "",
                        body.articleId ?? "",
                    );
                } else if (_req.url === "/conversation/update-workspace-outline") {
                    result = await conversationRepository.updateWorkspaceOutline(
                        body.conversationId ?? "",
                        body.outlineJson ?? "",
                    );
                } else if (_req.url === "/conversation/get-workspace-article") {
                    result = await conversationRepository.getWorkspaceArticle(
                        body.conversationId ?? "",
                        body.articleId ?? "",
                    );
                } else if (_req.url === "/conversation/update-workspace-article") {
                    result = await conversationRepository.updateWorkspaceArticle(
                        body.conversationId ?? "",
                        body.articleId ?? "",
                        body.newContent ?? "",
                    );
                } else if (_req.url === "/conversation/save-workspace-article-to-file") {
                    result = await conversationRepository.saveWorkspaceArticleToFile(
                        body.conversationId ?? "",
                        body.articleId ?? "",
                        body.format ?? "md",
                    );
                } else {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown conversation endpoint" }));
                    return;
                }

                await refreshDerivedState();

                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true, result }));
            } catch (error) {
                res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        });
        return;
    }

    const snapshot = {};

    for (const file of files) {
        const abs = resolve(bridgeDir, file);
        snapshot[file] = await readFile(abs, "utf8");
    }

    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
        JSON.stringify(
            {
                ok: true,
                message: "Phase 1 sidecar scaffold is present. Runtime wiring is the next step.",
                files: snapshot,
            },
            null,
            2,
        ),
    );
});

const port = Number(process.env.PERSONAL_AGENT_SIDECAR_PORT || "8787");
server.listen(port, () => {
    console.log(
        `[personal-agent-desktop] sidecar listening on http://127.0.0.1:${port} in ${runtimeConfig.mode} mode (${runtimeConfig.modeReason})`,
    );
});
