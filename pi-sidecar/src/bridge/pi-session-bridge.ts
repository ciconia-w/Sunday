import { randomUUID } from "node:crypto";
import {
    createAgentSession,
    SessionManager,
    type AgentSession,
    type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { UosSessionEvent, type SessionChannelLike } from "./channel-types.ts";
import { SimpleSignal } from "./signal.ts";

type UosMessageContent = {
    type: string;
    data: Record<string, unknown> | unknown[];
};

type UosSendMessagePayload = {
    session_id: string;
    conversation_id: string;
    assistant: string;
    model: string;
    model_name: string;
    params?: Record<string, unknown>;
    message: {
        id: string;
        previous: string;
        content: UosMessageContent[];
        extension?: Record<string, unknown>;
    };
};

type ActivePiSession = {
    session: AgentSession;
    conversationId: string;
    unsubscribe: () => void;
};

export interface PiSessionBridgeOptions {
    cwd: string;
    agentDir?: string;
    model?: Model<unknown>;
    tools?: string[];
}

export class PiSessionBridge implements SessionChannelLike {
    readonly sessionEvent = new SimpleSignal<[UosSessionEvent, string, string]>();

    private readonly sessions = new Map<string, ActivePiSession>();
    private readonly selectedModelByAssistant = new Map<string, string>();
    private readonly options: PiSessionBridgeOptions;

    constructor(options: PiSessionBridgeOptions) {
        this.options = options;
    }

    async sendMessage(params: string): Promise<void> {
        const payload = this.parsePayload(params);
        const activeSession = await this.getOrCreateSession(payload);
        const prompt = this.extractPrompt(payload);

        if (!prompt) {
            return;
        }

        await activeSession.session.prompt(prompt);
    }

    async retry(params: string): Promise<void> {
        const payload = this.parsePayload(params);
        const activeSession = await this.getOrCreateSession(payload);
        const prompt = this.extractPrompt(payload);

        if (!prompt) {
            return;
        }

        await activeSession.session.prompt(prompt);
    }

    async cancel(params: string): Promise<void> {
        const parsed = JSON.parse(params) as { session_id?: string };
        const sessionId = parsed.session_id ?? "";
        const activeSession = this.sessions.get(sessionId);
        if (!activeSession) {
            return;
        }
        await activeSession.session.abort();
    }

    async invokeAction(_sessionId: string, json: string): Promise<void> {
        const action = JSON.parse(json) as Record<string, unknown>;
        console.debug("[uosai-pi-mvp] invokeAction placeholder", action);
        /**
         * 在真正实现审批时，这里需要：
         * 1. 根据 request_id 找到等待中的 beforeToolCall promise
         * 2. 用户同意则继续
         * 3. 用户拒绝则返回 block
         */
    }

    setAssistantModel(assistantId: string, modelId: string): void {
        this.selectedModelByAssistant.set(assistantId, modelId);
    }

    private parsePayload(params: string): UosSendMessagePayload {
        return JSON.parse(params) as UosSendMessagePayload;
    }

    private extractPrompt(payload: UosSendMessagePayload): string {
        return payload.message.content
            .filter((item) => item.type === "text")
            .map((item) => {
                const data = item.data as { content?: string };
                return data.content ?? "";
            })
            .join("\n")
            .trim();
    }

    private async getOrCreateSession(payload: UosSendMessagePayload): Promise<ActivePiSession> {
        const existing = this.sessions.get(payload.session_id);
        if (existing) {
            return existing;
        }

        const created = await createAgentSession({
            cwd: this.options.cwd,
            agentDir: this.options.agentDir,
            model: this.options.model,
            tools: this.options.tools ?? ["read", "bash", "grep", "find", "ls"],
            sessionManager: SessionManager.inMemory(this.options.cwd),
        });

        const session = created.session;
        const unsubscribe = session.subscribe((event) => {
            this.handlePiEvent(payload.session_id, payload.conversation_id, event);
        });

        /**
         * 真正接审批时，建议在这里挂：
         *
         * session.agent.beforeToolCall = async ({ toolCall, args }) => { ... }
         *
         * 对 bash / edit / write 等高风险工具先发 interactive_components
         * 到前端，再等待 invokeAction 的结果。
         */

        const active: ActivePiSession = {
            session,
            conversationId: payload.conversation_id,
            unsubscribe,
        };

        this.sessions.set(payload.session_id, active);
        return active;
    }

    private handlePiEvent(sessionId: string, conversationId: string, event: AgentSessionEvent): void {
        switch (event.type) {
            case "agent_start":
                this.sessionEvent.emit(UosSessionEvent.SeStarted, sessionId, "");
                return;
            case "message_update":
                if (event.assistantMessageEvent.type === "text_delta") {
                    this.sessionEvent.emit(
                        UosSessionEvent.SeMessage,
                        sessionId,
                        JSON.stringify({
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
                        type: "tool",
                        data: {
                            name: event.toolName,
                            status: 0,
                            params: event.args,
                        },
                    }),
                );
                return;
            case "tool_execution_end":
                this.sessionEvent.emit(
                    UosSessionEvent.SeMessage,
                    sessionId,
                    JSON.stringify({
                        type: "tool",
                        data: {
                            name: event.toolName,
                            status: event.isError ? 2 : 1,
                            result: event.result,
                        },
                    }),
                );
                return;
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
}
