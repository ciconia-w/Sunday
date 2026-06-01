import { randomUUID } from "node:crypto";

export class ExternalIngress {
    constructor(options) {
        this.options = options;
    }

    normalizeTextMessage(body) {
        const externalMessageId = body.externalMessageId ?? randomUUID();
        const conversationId = body.conversationId ?? `ext-conv-${body.source ?? "external"}-${body.channelId ?? "default"}`;
        const sessionId = body.sessionId ?? `ext-sess-${externalMessageId}`;
        const assistantId = body.assistantId ?? "uos-ai-generic";
        const modelId = body.modelId ?? this.options.defaultModelId;
        const text = typeof body.text === "string" ? body.text.trim() : "";

        return {
            session_id: sessionId,
            conversation_id: conversationId,
            assistant: assistantId,
            model: `${this.options.provider}/${modelId}`,
            model_name: modelId,
            user: body.userId ?? "external-user",
            params: {
                source: body.source ?? "external",
                channel_id: body.channelId ?? "",
                external_message_id: externalMessageId,
            },
            message: {
                id: externalMessageId,
                previous: body.previousMessageId ?? "",
                content: [
                    {
                        type: "text",
                        data: {
                            content: text,
                        },
                    },
                ],
                extension: {
                    source: body.source ?? "external",
                    channelId: body.channelId ?? "",
                    userId: body.userId ?? "",
                },
            },
        };
    }

    async acceptMessage(body) {
        const payload = this.normalizeTextMessage(body);

        if (!payload.message.content[0]?.data?.content) {
            return {
                ok: false,
                error: "Empty external message",
            };
        }

        await this.options.conversationRepository.trackOutgoingPayload(payload);
        await this.options.sessionBridge.sendMessage(JSON.stringify(payload));

        return {
            ok: true,
            conversationId: payload.conversation_id,
            sessionId: payload.session_id,
            externalMessageId: payload.message.id,
        };
    }
}
