import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return {
        status: response.status,
        body: await response.json(),
    };
}

async function createEventCollector(baseUrl) {
    const watchedSessionIds = new Set();
    const events = [];
    const decoder = new TextDecoder();
    const controller = new AbortController();
    let buffer = "";
    let stopReading = false;

    const eventResponse = await fetch(`${baseUrl}/events`, {
        signal: controller.signal,
    });
    const reader = eventResponse.body.getReader();
    const readLoop = (async () => {
        try {
            while (!stopReading) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                let chunkEndIndex = -1;
                while ((chunkEndIndex = buffer.indexOf("\n\n")) >= 0) {
                    const chunk = buffer.slice(0, chunkEndIndex);
                    buffer = buffer.slice(chunkEndIndex + 2);
                    const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
                    if (!dataLine) {
                        continue;
                    }

                    const parsed = JSON.parse(dataLine.slice(6));
                    if (watchedSessionIds.size > 0 && !watchedSessionIds.has(parsed.sessionId)) {
                        continue;
                    }

                    events.push(parsed);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stopReading && error?.name !== "AbortError" && !/terminated/i.test(message)) {
                throw error;
            }
        }
    })();

    return {
        events,
        watchedSessionIds,
        async close() {
            stopReading = true;
            controller.abort();
            await reader.cancel().catch(() => undefined);
            await readLoop.catch(() => undefined);
        },
    };
}

async function waitForSessionFinish(events, sessionId, expectedFinishCount, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const sessionEvents = events.filter((evt) => evt.sessionId === sessionId);
        const finishCount = sessionEvents.filter((evt) => evt.event === 2).length;
        const errorEvent = sessionEvents.find((evt) => evt.event === 3);

        if (errorEvent) {
            return {
                ok: false,
                reason: "session-error",
                sessionEvents,
            };
        }

        if (finishCount >= expectedFinishCount) {
            return {
                ok: true,
                sessionEvents,
            };
        }

        await wait(250);
    }

    return {
        ok: false,
        reason: "timeout",
        sessionEvents: events.filter((evt) => evt.sessionId === sessionId),
    };
}

async function waitForReplayEntry(baseUrl, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;

    while (Date.now() < deadline) {
        latest = await post(baseUrl, "/service-config/get-ingress-operator-state", { includeResolved: true });
        const entries = latest?.body?.result?.replayQueue?.entries ?? [];
        const match = entries.find(predicate);
        if (match) {
            return {
                response: latest,
                entry: match,
            };
        }
        await wait(250);
    }

    return {
        response: latest,
        entry: null,
    };
}

async function withSlackCollector(run) {
    const calls = [];
    let deliveryMode = "fail";
    const server = createServer((req, res) => {
        if (req.method !== "POST") {
            res.writeHead(405);
            res.end();
            return;
        }

        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
        });
        req.on("end", () => {
            let parsed = {};
            try {
                parsed = raw ? JSON.parse(raw) : {};
            } catch {
                res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: false, error: "invalid json" }));
                return;
            }

            const status = deliveryMode === "success" ? 200 : 500;
            calls.push({
                path: req.url ?? "/",
                body: parsed,
                status,
            });
            res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
            res.end(status === 200 ? "ok" : "error");
        });
    });

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;

    async function waitForCallCount(expectedCount, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (calls.length >= expectedCount) {
                return calls.slice(0, expectedCount);
            }
            await wait(250);
        }
        return [...calls];
    }

    try {
        return await run({
            webhookUrl: `http://127.0.0.1:${port}/reply-slack`,
            calls,
            setDeliveryMode(mode) {
                deliveryMode = mode;
            },
            waitForCallCount,
        });
    } finally {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }
}

const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-replay-history-verify-"));
const now = Date.now();
const source = "im-replay-history";
const channelId = `replay-history-channel-${now}`;
const threadId = `replay-history-thread-${now}`;
const externalMessageId = `replay-history-external-${now}`;

try {
    let initialEntry = null;
    let replayResult = null;
    let deliveredEntry = null;
    let resolvedEntry = null;
    let hiddenResolvedEntry = null;

    await withSlackCollector(async ({ webhookUrl, setDeliveryMode, waitForCallCount }) => {
        await withSidecarRuntime(
            {
                sidecarPort: 8824,
                env: {
                    PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
                    PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "5,10",
                    PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "0",
                },
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                const collector = await createEventCollector(baseUrl);

                try {
                    const ingressResult = await post(baseUrl, "/ingress/message", {
                        source,
                        channelId,
                        threadId,
                        userId: "demo-user",
                        assistantId: "uos-ai-generic",
                        text: "Reply with exactly: ingress-replay-history-ok",
                        externalMessageId,
                        replyTransport: "slack-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(ingressResult.body.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.body.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`ingress replay history session did not finish: ${cycle.reason}`);
                    }

                    await waitForCallCount(3);

                    const initialState = await waitForReplayEntry(
                        baseUrl,
                        (entry) => entry.requestExternalMessageId === externalMessageId,
                    );
                    initialEntry = initialState.entry;
                    if (!initialEntry) {
                        throw new Error("replay history verifier did not find initial replay queue entry");
                    }

                    setDeliveryMode("success");
                    replayResult = await post(baseUrl, "/service-config/replay-ingress-queue-entry", {
                        id: initialEntry.id,
                    });

                    const deliveredState = await waitForReplayEntry(
                        baseUrl,
                        (entry) => entry.id === initialEntry.id && entry.status === "delivered",
                    );
                    deliveredEntry = deliveredState.entry;
                    if (!deliveredEntry) {
                        throw new Error("replay history verifier did not observe delivered replay queue entry");
                    }

                    await post(baseUrl, "/service-config/resolve-ingress-queue-entry", {
                        id: initialEntry.id,
                        resolution: "resolved",
                    });
                    const resolvedState = await waitForReplayEntry(
                        baseUrl,
                        (entry) => entry.id === initialEntry.id && entry.status === "resolved",
                    );
                    resolvedEntry = resolvedState.entry;

                    const hiddenState = await post(baseUrl, "/service-config/get-ingress-operator-state", {
                        includeResolved: false,
                    });
                    hiddenResolvedEntry = (hiddenState?.body?.result?.replayQueue?.entries ?? []).find((entry) => entry.id === initialEntry.id) ?? null;
                } finally {
                    await collector.close();
                }
            },
        );
    });

    const initialHistoryKinds = Array.isArray(initialEntry?.history)
        ? initialEntry.history.map((event) => event.kind)
        : [];
    const deliveredHistoryKinds = Array.isArray(deliveredEntry?.history)
        ? deliveredEntry.history.map((event) => event.kind)
        : [];
    const resolvedHistoryKinds = Array.isArray(resolvedEntry?.history)
        ? resolvedEntry.history.map((event) => event.kind)
        : [];

    const checks = {
        initialEntryExists: Boolean(initialEntry?.id),
        initialHistoryHasDeliveryFailure: initialHistoryKinds.includes("delivery-failed"),
        replaySucceeded: replayResult?.body?.result?.ok === true,
        deliveredHistoryHasManualSuccess: deliveredHistoryKinds.includes("replay-succeeded")
            && deliveredEntry?.history?.some((event) => event.kind === "replay-succeeded" && event.mode === "manual"),
        resolvedHistoryHasResolved: resolvedHistoryKinds.includes("resolved"),
        resolvedEntryHiddenWhenExcluded: hiddenResolvedEntry === null,
    };

    const verdict = Object.values(checks).every(Boolean)
        ? "ingress-replay-history-api-confirmed"
        : "ingress-replay-history-api-incomplete";

    console.log(JSON.stringify({
        runtimeDir,
        checks,
        initialHistoryKinds,
        deliveredHistoryKinds,
        resolvedHistoryKinds,
        replayResult: replayResult?.body?.result ?? null,
        verdict,
    }, null, 2));

    process.exit(verdict === "ingress-replay-history-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
}
