import { createHmac } from "node:crypto";
import { createDeliveryReceipt } from "./ingress-replay-store.mjs";

export const SUPPORTED_REPLY_TRANSPORTS = [
    "webhook",
    "lark-bot-webhook",
    "dingtalk-bot-webhook",
    "slack-webhook",
    "discord-webhook",
    "teams-webhook",
];

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizeRetryDelays(value, fallback) {
    if (typeof value !== "string" || !value.trim()) {
        return fallback;
    }

    const normalized = value
        .split(",")
        .map((item) => normalizeNonNegativeInteger(item, -1))
        .filter((item) => item >= 0);

    return normalized.length > 0 ? normalized : fallback;
}

export function normalizeReplyTransport(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
        return "";
    }

    if (normalized === "feishu-bot-webhook") {
        return "lark-bot-webhook";
    }

    if (normalized === "slack-incoming-webhook") {
        return "slack-webhook";
    }

    if (normalized === "discord-incoming-webhook") {
        return "discord-webhook";
    }

    if (normalized === "dingtalk-webhook" || normalized === "dingtalk-custom-bot-webhook") {
        return "dingtalk-bot-webhook";
    }

    if (
        normalized === "msteams-webhook"
        || normalized === "microsoft-teams-webhook"
        || normalized === "teams-incoming-webhook"
    ) {
        return "teams-webhook";
    }

    return normalized;
}

export function formatPlainTextReply(payload) {
    if (payload?.ok === true) {
        return typeof payload?.assistantText === "string" && payload.assistantText.trim()
            ? payload.assistantText.trim()
            : "Sunday 已完成处理，但没有生成文本回复。";
    }

    const errorText = typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : "unknown error";
    return `Sunday 处理失败：${errorText}`;
}

function createReplyDeliveryError(message, details = {}) {
    const error = new Error(message);
    error.statusCode = normalizeNonNegativeInteger(details.statusCode, 0);
    error.transport = typeof details.transport === "string" ? details.transport : "";
    error.providerPayload = details.providerPayload && typeof details.providerPayload === "object"
        ? details.providerPayload
        : null;
    return error;
}

function createLarkBotSignature(secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = createHmac("sha256", stringToSign).digest("base64");

    return {
        timestamp,
        sign,
    };
}

function createDingtalkBotSignature(secret) {
    const timestamp = String(Date.now());
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = encodeURIComponent(
        createHmac("sha256", secret).update(stringToSign).digest("base64"),
    );

    return {
        timestamp,
        sign,
    };
}

function buildLarkBotReplyBody(replyTarget, payload) {
    const body = {
        msg_type: "text",
        content: {
            text: formatPlainTextReply(payload),
        },
    };

    if (replyTarget.secret) {
        const signature = createLarkBotSignature(replyTarget.secret);
        body.timestamp = signature.timestamp;
        body.sign = signature.sign;
    }

    return body;
}

function buildSlackReplyBody(payload) {
    return {
        text: formatPlainTextReply(payload),
    };
}

function buildDingtalkReplyBody(payload) {
    return {
        msgtype: "text",
        text: {
            content: formatPlainTextReply(payload),
        },
    };
}

function buildDiscordReplyBody(payload) {
    return {
        content: formatPlainTextReply(payload),
    };
}

function buildTeamsReplyBody(payload) {
    return {
        text: formatPlainTextReply(payload),
    };
}

async function postGenericWebhookReply(replyTarget, payload) {
    const response = await fetch(replyTarget.url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`Reply webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: payload,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
    };
}

async function postLarkBotWebhookReply(replyTarget, payload) {
    const body = buildLarkBotReplyBody(replyTarget, payload);
    const response = await fetch(replyTarget.url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`Lark bot webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: body,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
        providerPayload: body,
    };
}

async function postSlackWebhookReply(replyTarget, payload) {
    const body = buildSlackReplyBody(payload);
    const response = await fetch(replyTarget.url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`Slack webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: body,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
        providerPayload: body,
    };
}

async function postDingtalkBotWebhookReply(replyTarget, payload) {
    const body = buildDingtalkReplyBody(payload);
    const targetUrl = new URL(replyTarget.url);

    if (replyTarget.secret) {
        const signature = createDingtalkBotSignature(replyTarget.secret);
        targetUrl.searchParams.set("timestamp", signature.timestamp);
        targetUrl.searchParams.set("sign", signature.sign);
    }

    const response = await fetch(targetUrl.toString(), {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`DingTalk bot webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: body,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
        providerPayload: body,
    };
}

async function postDiscordWebhookReply(replyTarget, payload) {
    const body = buildDiscordReplyBody(payload);
    const response = await fetch(replyTarget.url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`Discord webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: body,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
        providerPayload: body,
    };
}

async function postTeamsWebhookReply(replyTarget, payload) {
    const body = buildTeamsReplyBody(payload);
    const response = await fetch(replyTarget.url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...replyTarget.headers,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw createReplyDeliveryError(`Teams webhook returned HTTP ${response.status}`, {
            statusCode: response.status,
            transport: replyTarget.transport,
            providerPayload: body,
        });
    }

    return {
        ok: true,
        transport: replyTarget.transport,
        status: response.status,
        providerPayload: body,
    };
}

export async function postReply(replyTarget, payload) {
    if (replyTarget.transport === "webhook") {
        return postGenericWebhookReply(replyTarget, payload);
    }

    if (replyTarget.transport === "lark-bot-webhook") {
        return postLarkBotWebhookReply(replyTarget, payload);
    }

    if (replyTarget.transport === "slack-webhook") {
        return postSlackWebhookReply(replyTarget, payload);
    }

    if (replyTarget.transport === "dingtalk-bot-webhook") {
        return postDingtalkBotWebhookReply(replyTarget, payload);
    }

    if (replyTarget.transport === "discord-webhook") {
        return postDiscordWebhookReply(replyTarget, payload);
    }

    if (replyTarget.transport === "teams-webhook") {
        return postTeamsWebhookReply(replyTarget, payload);
    }

    throw createReplyDeliveryError(`Unsupported reply transport: ${replyTarget.transport}`, {
        transport: replyTarget.transport,
    });
}

export async function executeReplyDelivery(replyTarget, payload, options = {}) {
    const retryDelaysMs = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : [];
    const actor = typeof options.actor === "string" ? options.actor : "sidecar";
    const mode = typeof options.mode === "string" ? options.mode : "initial";
    const errors = [];
    const maxAttempts = retryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const result = await postReply(replyTarget, payload);
            return {
                ok: true,
                result,
                errors,
                attemptCount: attempt,
                latestReceipt: createDeliveryReceipt({
                    actor,
                    mode,
                    transport: result.transport ?? replyTarget.transport ?? "",
                    ok: true,
                    statusCode: result.status ?? 0,
                    at: new Date().toISOString(),
                    error: "",
                    providerPayload: result.providerPayload ?? null,
                }),
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({
                attempt,
                error: errorMessage,
                statusCode: normalizeNonNegativeInteger(error?.statusCode, 0),
                at: new Date().toISOString(),
            });

            if (attempt < maxAttempts) {
                await wait(retryDelaysMs[attempt - 1] ?? 0);
                continue;
            }

            return {
                ok: false,
                errors,
                attemptCount: errors.length,
                latestReceipt: createDeliveryReceipt({
                    actor,
                    mode,
                    transport: replyTarget.transport ?? "",
                    ok: false,
                    statusCode: normalizeNonNegativeInteger(error?.statusCode, 0),
                    at: new Date().toISOString(),
                    error: errorMessage,
                    providerPayload: error?.providerPayload ?? null,
                }),
            };
        }
    }

    return {
        ok: false,
        errors,
        attemptCount: errors.length,
        latestReceipt: createDeliveryReceipt({
            actor,
            mode,
            transport: replyTarget.transport ?? "",
            ok: false,
            statusCode: 0,
            at: new Date().toISOString(),
            error: "Reply delivery failed",
            providerPayload: null,
        }),
    };
}
