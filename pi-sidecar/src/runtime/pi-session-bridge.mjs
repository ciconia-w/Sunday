import { randomUUID } from "node:crypto";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { UosSessionEvent } from "./channel-types.mjs";
import { SimpleSignal } from "./signal.mjs";
import { browserTools, isBrowserControlEnabled } from "./browser-tools.mjs";
import { getBrowserScreenshotErrorDetails } from "./browser-control.mjs";

export class PiSessionBridge {
    constructor(options) {
        this.options = options;
        this.sessionEvent = new SimpleSignal();
        this.sessions = new Map();
        this.selectedModelByAssistant = new Map();
    }

    async sendMessage(params) {
        const payload = this.parsePayload(params);
        const activeSession = await this.getOrCreateSession(payload);
        const prompt = this.extractPrompt(payload);

        if (!prompt) {
            return;
        }

        await activeSession.session.prompt(prompt);
    }

    async retry(params) {
        const payload = this.parsePayload(params);
        const activeSession = await this.getOrCreateSession(payload);
        const prompt = this.extractPrompt(payload);

        if (!prompt) {
            return;
        }

        await activeSession.session.prompt(prompt);
    }

    async cancel(params) {
        const parsed = JSON.parse(params);
        const sessionId = parsed.session_id ?? "";
        const activeSession = this.sessions.get(sessionId);
        if (!activeSession) {
            return;
        }
        await activeSession.session.abort();
    }

    async invokeAction(_sessionId, json) {
        const action = JSON.parse(json);
        console.debug("[personal-agent-desktop] invokeAction placeholder", action);
    }

    setAssistantModel(assistantId, modelId) {
        this.selectedModelByAssistant.set(assistantId, modelId);
    }

    setDefaultModelId(modelId) {
        this.options.defaultModelId = modelId;
    }

    getCurrentModelId(assistantId) {
        return this.selectedModelByAssistant.get(assistantId) ?? this.options.defaultModelId;
    }

    parsePayload(params) {
        return JSON.parse(params);
    }

    extractPrompt(payload) {
        return payload.message.content
            .filter((item) => item.type === "text")
            .map((item) => item.data.content ?? "")
            .join("\n")
            .trim();
    }

    async getOrCreateSession(payload) {
        const existing = this.sessions.get(payload.session_id);
        if (existing) {
            return existing;
        }

        const targetModelId = this.getCurrentModelId(payload.assistant);
        const targetModel = this.options.getModelById
            ? this.options.getModelById(targetModelId)
            : this.options.model;
        const browserEnabled = isBrowserControlEnabled();
        const enabledBrowserToolNames = browserEnabled ? browserTools.map((tool) => tool.name) : [];
        const baseTools = this.options.tools ?? ["read", "bash", "grep", "find", "ls"];
        const tools = browserEnabled
            ? [...baseTools, ...enabledBrowserToolNames.filter((toolName) => !baseTools.includes(toolName))]
            : baseTools;

        const created = await createAgentSession({
            cwd: this.options.cwd,
            agentDir: this.options.agentDir,
            model: targetModel,
            authStorage: this.options.authStorage,
            modelRegistry: this.options.modelRegistry,
            tools,
            customTools: browserEnabled ? browserTools : [],
            afterToolCall: async ({ toolCall, result, isError }) => {
                if (!isError || toolCall.name !== "browser_screenshot") {
                    return undefined;
                }

                const normalizedDetails =
                    result && typeof result === "object" && result.details && typeof result.details === "object"
                        ? { ...result.details }
                        : {};
                const screenshotFailure = getBrowserScreenshotErrorDetails(this.collectTextFromToolValue(result));

                return {
                    details: {
                        ...normalizedDetails,
                        errorKind: screenshotFailure.errorKind,
                        errorHint: screenshotFailure.errorHint,
                    },
                    isError: true,
                };
            },
            sessionManager: SessionManager.inMemory(this.options.cwd),
        });

        const session = created.session;
        const unsubscribe = session.subscribe((event) => {
            this.handlePiEvent(payload.session_id, payload.conversation_id, event);
        });

        const active = {
            session,
            conversationId: payload.conversation_id,
            unsubscribe,
        };

        this.sessions.set(payload.session_id, active);
        return active;
    }

    handlePiEvent(sessionId, conversationId, event) {
        switch (event.type) {
            case "agent_start":
                this.sessionEvent.emit(
                    UosSessionEvent.SeStarted,
                    sessionId,
                    JSON.stringify({
                        conversation_id: conversationId,
                    }),
                );
                return;
            case "message_update":
                if (event.assistantMessageEvent.type === "text_delta") {
                    this.sessionEvent.emit(
                        UosSessionEvent.SeMessage,
                        sessionId,
                        JSON.stringify({
                            conversation_id: conversationId,
                            type: "text",
                            data: { content: event.assistantMessageEvent.delta },
                        }),
                    );
                }
                return;
            case "tool_execution_start":
                this.sessionEvent.emit(
                    UosSessionEvent.SeMessage,
                    sessionId,
                    JSON.stringify({
                        conversation_id: conversationId,
                        type: "tool",
                        data: {
                            name: event.toolName,
                            status: 0,
                            params: event.args,
                        },
                    }),
                );
                return;
            case "tool_execution_update":
                {
                    const normalizedDetails = this.normalizeToolDetails(event.toolName, event.partialResult);
                    const normalizedPartialResult =
                        normalizedDetails && event.partialResult && typeof event.partialResult === "object"
                            ? {
                                  ...event.partialResult,
                                  details: normalizedDetails,
                              }
                            : event.partialResult;

                    this.sessionEvent.emit(
                        UosSessionEvent.SeMessage,
                        sessionId,
                        JSON.stringify({
                            conversation_id: conversationId,
                            type: "tool",
                            data: {
                                name: event.toolName,
                                status: 0,
                                params: event.args,
                                result: normalizedPartialResult,
                                details: normalizedDetails,
                            },
                        }),
                    );
                    return;
                }
            case "tool_execution_end":
                {
                    const normalizedDetails = this.normalizeToolDetails(event.toolName, event.result);
                    const normalizedResult =
                        normalizedDetails && event.result && typeof event.result === "object"
                            ? {
                                  ...event.result,
                                  details: normalizedDetails,
                              }
                            : event.result;

                    this.sessionEvent.emit(
                        UosSessionEvent.SeMessage,
                        sessionId,
                        JSON.stringify({
                            conversation_id: conversationId,
                            type: "tool",
                            data: {
                                name: event.toolName,
                                status: event.isError ? 2 : 1,
                                result: normalizedResult,
                                details: normalizedDetails,
                            },
                        }),
                    );
                    return;
                }
            case "agent_end":
                this.sessionEvent.emit(
                    UosSessionEvent.SeFinished,
                    sessionId,
                    JSON.stringify({
                        id: randomUUID(),
                        conversation_id: conversationId,
                    }),
                );
                return;
            default:
                return;
        }
    }

    normalizeToolDetails(toolName, result) {
        const details =
            result && typeof result === "object" && result.details && typeof result.details === "object"
                ? { ...result.details }
                : {};

        if (toolName !== "bash") {
            return Object.keys(details).length > 0 ? details : undefined;
        }

        if (typeof details.fullOutputPath === "string" && details.fullOutputPath.trim()) {
            return details;
        }

        const extractedPath = this.extractFullOutputPath(result);
        if (extractedPath) {
            details.fullOutputPath = extractedPath;
        }

        return Object.keys(details).length > 0 ? details : undefined;
    }

    extractFullOutputPath(value) {
        const text = this.collectTextFromToolValue(value);
        if (!text) {
            return "";
        }

        const match = text.match(/Full output:\s*([^\s\]]+)/i);
        return match?.[1]?.trim() ?? "";
    }

    collectTextFromToolValue(value) {
        if (value === undefined || value === null || value === "") {
            return "";
        }

        if (typeof value === "string") {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.collectTextFromToolValue(item)).filter(Boolean).join(" ");
        }

        if (typeof value === "object") {
            if (Array.isArray(value.content)) {
                const contentText = value.content
                    .map((item) => {
                        if (item && typeof item === "object" && typeof item.text === "string") {
                            return item.text;
                        }
                        return this.collectTextFromToolValue(item);
                    })
                    .filter(Boolean)
                    .join(" ");
                if (contentText) {
                    return contentText;
                }
            }

            return Object.values(value)
                .map((item) => this.collectTextFromToolValue(item))
                .filter(Boolean)
                .join(" ");
        }

        return String(value);
    }
}
