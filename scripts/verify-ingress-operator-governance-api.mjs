import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function waitForOperatorState(baseUrl, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;

    while (Date.now() < deadline) {
        latest = await post(baseUrl, "/service-config/get-ingress-operator-state", {
            includeResolved: true,
        });
        if (predicate(latest?.body?.result ?? {})) {
            return latest;
        }
        await wait(250);
    }

    return latest;
}

const runtimeDir = await mkdtemp(join(tmpdir(), "sunday-ingress-operator-governance-verify-"));
const controlPath = join(runtimeDir, "external-ingress-operator-control.json");
const now = Date.now();
const source = "im-operator-governance";
const channelId = `operator-governance-channel-${now}`;
const threadId = `operator-governance-thread-${now}`;
const externalMessageId = `operator-governance-external-${now}`;

try {
    let pausedState = null;
    let pausedStateAfterRestart = null;
    let resumedState = null;
    let finalEntry = null;
    let controlFileWhilePaused = null;
    let controlFileAfterResume = null;
    let pausedCallCount = 0;
    let finalWebhookCall = null;

    await withSlackCollector(async ({ webhookUrl, calls, setDeliveryMode, waitForCallCount }) => {
        const runtimeEnv = {
            PERSONAL_AGENT_RUNTIME_DIR: runtimeDir,
            PERSONAL_AGENT_INGRESS_REPLY_RETRY_DELAYS_MS: "5,10",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED: "1",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS: "800,800",
            PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS: "50",
        };

        await withSidecarRuntime(
            {
                sidecarPort: 8821,
                env: runtimeEnv,
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
                        text: "Reply with exactly: ingress-operator-governance-ok",
                        externalMessageId,
                        replyTransport: "slack-webhook",
                        replyWebhookUrl: webhookUrl,
                    });

                    collector.watchedSessionIds.add(ingressResult.body.sessionId);
                    const cycle = await waitForSessionFinish(collector.events, ingressResult.body.sessionId, 1);
                    if (!cycle.ok) {
                        throw new Error(`Ingress operator governance verifier session did not finish: ${cycle.reason}`);
                    }

                    await waitForCallCount(3);

                    const pendingState = await waitForOperatorState(baseUrl, (state) =>
                        (state?.replayQueue?.entries ?? []).some((entry) =>
                            entry?.requestExternalMessageId === externalMessageId && entry?.status === "pending"),
                    );
                    const pendingEntry = (pendingState?.body?.result?.replayQueue?.entries ?? []).find((entry) =>
                        entry?.requestExternalMessageId === externalMessageId && entry?.status === "pending");

                    if (!pendingEntry?.id) {
                        throw new Error("Ingress operator governance verifier did not find pending replay entry");
                    }

                    await post(baseUrl, "/service-config/pause-ingress-background-replay", {
                        reason: "operator-governance-verify",
                    });

                    pausedState = await waitForOperatorState(baseUrl, (state) =>
                        state?.backgroundReplay?.control?.paused === true
                        && state?.replayQueue?.worker?.paused === true,
                    );
                    controlFileWhilePaused = JSON.parse(await readFile(controlPath, "utf8"));
                    pausedCallCount = calls.length;

                    await wait(1200);
                    if (calls.length !== pausedCallCount) {
                        throw new Error("Automatic replay still fired while background replay was paused");
                    }
                } finally {
                    await collector.close();
                }
            },
        );

        setDeliveryMode("success");

        await withSidecarRuntime(
            {
                sidecarPort: 8821,
                env: runtimeEnv,
            },
            async ({ sidecarPort }) => {
                const baseUrl = `http://127.0.0.1:${sidecarPort}`;
                pausedStateAfterRestart = await waitForOperatorState(baseUrl, (state) =>
                    state?.backgroundReplay?.control?.paused === true
                    && state?.replayQueue?.worker?.paused === true,
                );

                await wait(1200);
                if (calls.length !== pausedCallCount) {
                    throw new Error("Automatic replay resumed before operator resume action");
                }

                await post(baseUrl, "/service-config/resume-ingress-background-replay", {});
                resumedState = await waitForOperatorState(baseUrl, (state) =>
                    state?.backgroundReplay?.control?.paused === false
                    && state?.replayQueue?.worker?.paused === false
                    && (state?.replayQueue?.entries ?? []).some((entry) =>
                        entry?.requestExternalMessageId === externalMessageId && entry?.status === "delivered"),
                );
                controlFileAfterResume = JSON.parse(await readFile(controlPath, "utf8"));
            },
        );

        await waitForCallCount(pausedCallCount + 1);
        finalWebhookCall = calls[calls.length - 1] ?? null;
        finalEntry = (resumedState?.body?.result?.replayQueue?.entries ?? []).find((entry) =>
            entry?.requestExternalMessageId === externalMessageId);
    });

    const verdict =
        pausedState?.body?.result?.backgroundReplay?.control?.paused === true
        && pausedStateAfterRestart?.body?.result?.backgroundReplay?.control?.paused === true
        && resumedState?.body?.result?.backgroundReplay?.control?.paused === false
        && finalEntry?.status === "delivered"
        && controlFileWhilePaused?.paused === true
        && controlFileAfterResume?.paused === false
        && finalWebhookCall?.status === 200
            ? "ingress-operator-governance-api-confirmed"
            : "ingress-operator-governance-api-incomplete";

    console.log(JSON.stringify({
        verdict,
        pausedState: pausedState?.body?.result ?? null,
        pausedStateAfterRestart: pausedStateAfterRestart?.body?.result ?? null,
        resumedState: resumedState?.body?.result ?? null,
        pausedCallCount,
        finalWebhookCall,
        finalEntry,
        controlFileWhilePaused,
        controlFileAfterResume,
    }, null, 2));

    process.exit(verdict === "ingress-operator-governance-api-confirmed" ? 0 : 1);
} finally {
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
}
