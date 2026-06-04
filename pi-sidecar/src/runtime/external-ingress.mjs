import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function normalizeRouteValue(value, fallback) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || fallback;
}

function encodeRouteSegment(value) {
    return encodeURIComponent(value)
        .replace(/%/g, "_")
        .replace(/_20/g, "-");
}

function normalizeHeaderMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key, item]) => typeof key === "string" && key.trim() && typeof item === "string" && item.trim())
            .map(([key, item]) => [key.trim(), item.trim()]),
    );
}

function normalizeReplyTarget(body) {
    const replyTransport = typeof body?.replyTransport === "string" ? body.replyTransport.trim() : "";
    const replyWebhookUrl = typeof body?.replyWebhookUrl === "string" ? body.replyWebhookUrl.trim() : "";

    if (!replyWebhookUrl) {
        if (replyTransport && replyTransport !== "webhook") {
            throw new Error(`Unsupported replyTransport: ${replyTransport}`);
        }
        return null;
    }

    if (replyTransport && replyTransport !== "webhook") {
        throw new Error(`Unsupported replyTransport: ${replyTransport}`);
    }

    let parsedUrl = null;
    try {
        parsedUrl = new URL(replyWebhookUrl);
    } catch {
        throw new Error("Invalid replyWebhookUrl");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("replyWebhookUrl must use http or https");
    }

    return {
        transport: "webhook",
        url: parsedUrl.toString(),
        headers: normalizeHeaderMap(body?.replyWebhookHeaders),
    };
}

function collectRenderText(renderItems) {
    return (Array.isArray(renderItems) ? renderItems : [])
        .filter((item) => item?.type === "text")
        .map((item) => item?.data?.content ?? "")
        .join("")
        .trim();
}

export class ExternalIngress {
    constructor(options) {
        this.options = options;
        this.routeStorePath = resolve(options.runtimeDir, "external-ingress-routes.json");
        this.routeTargets = new Map();
        this.sessionQueues = new Map();
        this.activeSessionJobs = new Map();
        this.readyPromise = null;
    }

    async ensureReady() {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = this.loadRouteTargets();
        return this.readyPromise;
    }

    async loadRouteTargets() {
        try {
            const raw = await readFile(this.routeStorePath, "utf8");
            const parsed = JSON.parse(raw);
            const records = Array.isArray(parsed?.routes) ? parsed.routes : [];

            this.routeTargets = new Map(
                records
                    .filter((record) => typeof record?.routeKey === "string" && record.routeKey.trim())
                    .map((record) => [record.routeKey.trim(), record]),
            );
        } catch {
            this.routeTargets = new Map();
        }
    }

    async saveRouteTargets() {
        await mkdir(dirname(this.routeStorePath), { recursive: true });
        const routes = [...this.routeTargets.values()].sort((left, right) =>
            String(left.routeKey ?? "").localeCompare(String(right.routeKey ?? "")),
        );
        await writeFile(this.routeStorePath, JSON.stringify({ routes }, null, 2));
    }

    getStoredReplyTarget(routeKey) {
        const stored = this.routeTargets.get(routeKey);
        return stored?.replyTarget ?? null;
    }

    enqueueSessionJob(job) {
        const queue = this.sessionQueues.get(job.sessionId) ?? [];
        queue.push(job);
        this.sessionQueues.set(job.sessionId, queue);
    }

    activateNextSessionJob(sessionId) {
        const current = this.activeSessionJobs.get(sessionId);
        if (current) {
            return current;
        }

        const queue = this.sessionQueues.get(sessionId) ?? [];
        const next = queue.shift() ?? null;
        if (queue.length > 0) {
            this.sessionQueues.set(sessionId, queue);
        } else {
            this.sessionQueues.delete(sessionId);
        }

        if (next) {
            this.activeSessionJobs.set(sessionId, next);
        }

        return next;
    }

    completeActiveSessionJob(sessionId) {
        const current = this.activeSessionJobs.get(sessionId) ?? this.activateNextSessionJob(sessionId);
        this.activeSessionJobs.delete(sessionId);
        return current ?? null;
    }

    async rememberReplyTarget(route, replyTarget) {
        if (!replyTarget) {
            return;
        }

        this.routeTargets.set(route.routeKey, {
            routeKey: route.routeKey,
            source: route.source,
            channelId: route.channelId,
            threadId: route.threadId,
            conversationId: route.conversationId,
            sessionId: route.sessionId,
            replyTarget,
            updatedAt: new Date().toISOString(),
        });
        await this.saveRouteTargets();
    }

    getRouteIdentity(body) {
        const source = normalizeRouteValue(body?.source, "external");
        const channelId = normalizeRouteValue(body?.channelId, "default");
        const threadId = normalizeRouteValue(body?.threadId, channelId);
        const routeSegments = [source, channelId, threadId].map((item) => encodeRouteSegment(item));
        const routeToken = routeSegments.join("-");
        const routeKey = `${source}:${channelId}:${threadId}`;

        return {
            source,
            channelId,
            threadId,
            routeKey,
            routeToken,
            conversationId: body?.conversationId ?? `ext-conv-${routeToken}`,
            sessionId: body?.sessionId ?? `ext-sess-${routeToken}`,
        };
    }

    async normalizeTextMessage(body) {
        await this.ensureReady();
        const externalMessageId = body.externalMessageId ?? randomUUID();
        const route = this.getRouteIdentity(body);
        const explicitReplyTarget = normalizeReplyTarget(body);
        const replyTarget = explicitReplyTarget ?? this.getStoredReplyTarget(route.routeKey);
        const conversationTailId =
            typeof body.previousMessageId === "string" && body.previousMessageId.trim()
                ? body.previousMessageId.trim()
                : await this.options.conversationRepository.getConversationTailMessageId(route.conversationId);
        const assistantId = body.assistantId ?? "uos-ai-generic";
        const modelId = body.modelId ?? this.options.defaultModelId;
        const text = typeof body.text === "string" ? body.text.trim() : "";

        return {
            route,
            replyTarget,
            session_id: route.sessionId,
            conversation_id: route.conversationId,
            assistant: assistantId,
            model: `${this.options.provider}/${modelId}`,
            model_name: modelId,
            user: body.userId ?? "external-user",
            params: {
                source: route.source,
                channel_id: route.channelId,
                thread_id: route.threadId,
                route_key: route.routeKey,
                external_message_id: externalMessageId,
            },
            message: {
                id: externalMessageId,
                previous: conversationTailId,
                content: [
                    {
                        type: "text",
                        data: {
                            content: text,
                        },
                    },
                ],
                extension: {
                    source: route.source,
                    channelId: route.channelId,
                    threadId: route.threadId,
                    routeKey: route.routeKey,
                    userId: body.userId ?? "",
                },
            },
        };
    }

    async acceptMessage(body) {
        const payload = await this.normalizeTextMessage(body);
        const { route, replyTarget } = payload;

        if (!payload.message.content[0]?.data?.content) {
            return {
                ok: false,
                error: "Empty external message",
            };
        }

        await this.rememberReplyTarget(route, replyTarget);
        await this.options.conversationRepository.trackOutgoingPayload(payload);
        await this.options.conversationRepository.saveConversation(payload.conversation_id);
        this.enqueueSessionJob({
            sessionId: payload.session_id,
            conversationId: payload.conversation_id,
            source: route.source,
            channelId: route.channelId,
            threadId: route.threadId,
            routeKey: route.routeKey,
            userId: body.userId ?? "external-user",
            externalMessageId: payload.message.id,
            previousMessageId: payload.message.previous ?? "",
            replyTarget,
        });
        await this.options.sessionBridge.sendMessage(JSON.stringify(payload));

        return {
            ok: true,
            conversationId: payload.conversation_id,
            sessionId: payload.session_id,
            externalMessageId: payload.message.id,
            previousMessageId: payload.message.previous,
            routeKey: route.routeKey,
            threadId: route.threadId,
        };
    }

    handleSessionStarted(sessionId) {
        this.activateNextSessionJob(sessionId);
    }

    async handleSessionFinished(sessionId, message) {
        const job = this.completeActiveSessionJob(sessionId);
        if (!job?.replyTarget) {
            return {
                ok: true,
                skipped: true,
                reason: "no-reply-target",
            };
        }

        const parsed = typeof message === "string" ? JSON.parse(message) : message ?? {};
        const renderItems = Array.isArray(parsed?.renderItems) ? parsed.renderItems : [];
        const assistantText = collectRenderText(renderItems);

        return this.postReply(job.replyTarget, {
            ok: true,
            transport: job.replyTarget.transport,
            source: job.source,
            channelId: job.channelId,
            threadId: job.threadId,
            routeKey: job.routeKey,
            conversationId: parsed?.conversation_id ?? job.conversationId,
            sessionId,
            requestExternalMessageId: job.externalMessageId,
            previousMessageId: job.previousMessageId,
            userId: job.userId,
            assistantMessageId: typeof parsed?.id === "string" ? parsed.id : "",
            assistantText,
            renderItems,
            createdAt: new Date().toISOString(),
        });
    }

    async handleSessionError(sessionId, message) {
        const job = this.completeActiveSessionJob(sessionId);
        if (!job?.replyTarget) {
            return {
                ok: true,
                skipped: true,
                reason: "no-reply-target",
            };
        }

        const parsed = typeof message === "string" ? JSON.parse(message) : message ?? {};

        return this.postReply(job.replyTarget, {
            ok: false,
            transport: job.replyTarget.transport,
            source: job.source,
            channelId: job.channelId,
            threadId: job.threadId,
            routeKey: job.routeKey,
            conversationId: job.conversationId,
            sessionId,
            requestExternalMessageId: job.externalMessageId,
            previousMessageId: job.previousMessageId,
            userId: job.userId,
            error: typeof parsed?.error_message === "string" ? parsed.error_message : "External ingress session failed",
            errorCode: parsed?.error ?? -1,
            createdAt: new Date().toISOString(),
        });
    }

    async postReply(replyTarget, payload) {
        if (replyTarget.transport !== "webhook") {
            throw new Error(`Unsupported reply transport: ${replyTarget.transport}`);
        }

        const response = await fetch(replyTarget.url, {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                ...replyTarget.headers,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Reply webhook returned HTTP ${response.status}`);
        }

        return {
            ok: true,
            transport: replyTarget.transport,
            status: response.status,
        };
    }
}
