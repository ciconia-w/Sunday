import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME_BIN = process.env.CHROME_BIN || "chromium";
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const cacheBust = Date.now();
const APP_URL =
    process.env.APP_URL || `http://127.0.0.1:4173/?autoSend=hello-from-cdp&cb=${cacheBust}`;

async function waitForJsonVersion() {
    for (let i = 0; i < 40; i += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
            if (response.ok) {
                return;
            }
        } catch {
            // ignore
        }
        await sleep(250);
    }
    throw new Error(`Chrome remote debugging port ${DEBUG_PORT} did not come up`);
}

async function getPageTarget() {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await response.json();
    const pageTarget = targets.find((target) => target.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) {
        throw new Error("No page target with webSocketDebuggerUrl found");
    }
    return pageTarget;
}

async function createCdpClient(wsUrl) {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;

    await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
    });

    const eventListeners = new Map();

    socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data);
        if (!payload.id) {
            const listeners = eventListeners.get(payload.method);
            if (listeners) {
                for (const listener of listeners) {
                    listener(payload.params);
                }
            }
            return;
        }
        const callbacks = pending.get(payload.id);
        if (!callbacks) {
            return;
        }
        pending.delete(payload.id);
        if (payload.error) {
            callbacks.reject(new Error(payload.error.message || "CDP error"));
            return;
        }
        callbacks.resolve(payload.result);
    });

    const send = (method, params = {}) => {
        const id = nextId;
        nextId += 1;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
        });
    };

    return {
        send,
        on(method, listener) {
            if (!eventListeners.has(method)) {
                eventListeners.set(method, new Set());
            }
            eventListeners.get(method).add(listener);
        },
        close() {
            socket.close();
        },
    };
}

async function readBodyDebugState(client) {
    const expression = `JSON.stringify({
        dataset: {...document.body.dataset},
        title: document.title,
        text: document.body.innerText.slice(0, 400),
        flags: {
          mainWindow: !!document.querySelector('.main-window'),
          chatView: !!document.querySelector('.chat-view'),
          debugPanel: !!document.querySelector('.debug-session-panel'),
          runtimeBadge: !!document.querySelector('.runtime-status-badge'),
          rootWindow: !!document.querySelector('.root-window')
        }
    })`;

    const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
    });

    const raw = result?.result?.value;
    return raw ? JSON.parse(raw) : null;
}

async function waitForRuntimeState(client) {
    for (let i = 0; i < 40; i += 1) {
        const state = await readBodyDebugState(client);
        if (state?.dataset?.runtimeChannelSource) {
            return state;
        }
        await sleep(250);
    }
    throw new Error("runtimeChannelSource never appeared in document.body.dataset");
}

async function waitForSessionEvent(client) {
    for (let i = 0; i < 60; i += 1) {
        const state = await readBodyDebugState(client);
        if (state?.dataset?.sessionEventCount && Number(state.dataset.sessionEventCount) > 0) {
            return state;
        }
        await sleep(250);
    }
    throw new Error("No session events observed in page dataset");
}

async function waitForMessageType(client, expectedType) {
    for (let i = 0; i < 60; i += 1) {
        const state = await readBodyDebugState(client);
        if (state?.dataset?.sessionLastMessageType === expectedType) {
            return state;
        }
        await sleep(250);
    }
    throw new Error(`No session event with message type ${expectedType} observed`);
}

async function main() {
    await fetch(`http://127.0.0.1:4173/runtime/channels.js?cb=${cacheBust}`).catch(() => {});
    const chrome = spawn(
        CHROME_BIN,
        [
            "--headless",
            "--disable-gpu",
            `--remote-debugging-port=${DEBUG_PORT}`,
            "--no-first-run",
            "--no-default-browser-check",
            APP_URL,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    chrome.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });

    try {
        await waitForJsonVersion();
        const target = await getPageTarget();
        const client = await createCdpClient(target.webSocketDebuggerUrl);
        try {
            await client.send("Page.enable");
            await client.send("Runtime.enable");
            const consoleMessages = [];
            const exceptions = [];

            client.on("Runtime.consoleAPICalled", (params) => {
                consoleMessages.push({
                    type: params.type,
                    args: (params.args || []).map((arg) => arg.value ?? arg.description ?? null),
                });
            });

            client.on("Runtime.exceptionThrown", (params) => {
                exceptions.push({
                    text: params.exceptionDetails?.text,
                    exception: params.exceptionDetails?.exception?.description ?? null,
                });
            });

            const runtimeState = await waitForRuntimeState(client);
            let eventState = null;
            try {
                eventState = await waitForSessionEvent(client);
                const approvalState = await waitForMessageType(client, "interactive_components").catch(() => null);
                if (approvalState?.dataset?.sessionLastMessageType === "interactive_components") {
                    const encodedMessage = approvalState.dataset.sessionLastMessage;
                    const parsedMessage = encodedMessage
                        ? JSON.parse(decodeURIComponent(encodedMessage))
                        : null;
                    const requestId = parsedMessage?.data?.id ?? "";
                    const actionPayload = {
                        request_id: requestId,
                        type: "bash_approve",
                        approved: true,
                        always_approve: false,
                        reject_msg: "",
                    };
                    const source = approvalState.dataset.runtimeChannelSource;

                    if (source === "remote") {
                        await fetch("http://127.0.0.1:4173/session/action", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                                sessionId: approvalState.dataset.sessionLastId || "",
                                json: JSON.stringify(actionPayload),
                            }),
                        }).catch(() => {});
                    } else {
                        await client.send("Runtime.evaluate", {
                            expression: `
                                window.__UOS_PI_CHANNELS__?.sessObj?.invokeAction(
                                  ${JSON.stringify(approvalState.dataset.sessionLastId || "")},
                                  ${JSON.stringify(JSON.stringify(actionPayload))}
                                )
                            `,
                            awaitPromise: true,
                        });
                    }
                    eventState = await waitForMessageType(client, "text");
                }
            } catch (error) {
                const currentState = await readBodyDebugState(client);
                console.log(
                    JSON.stringify(
                        {
                            appUrl: APP_URL,
                            runtimeDataset: runtimeState?.dataset,
                            currentDataset: currentState?.dataset,
                            flags: currentState?.flags,
                            bodyTextPreview: currentState?.text,
                            consoleMessages,
                            exceptions,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        null,
                        2,
                    ),
                );
                throw error;
            }

            console.log(
                JSON.stringify(
                    {
                        appUrl: APP_URL,
                        runtimeDataset: runtimeState.dataset,
                        eventDataset: eventState.dataset,
                        verdict:
                            eventState.dataset.runtimeChannelSource === "remote"
                                ? "remote-path-confirmed"
                                : "fallback-path-confirmed",
                        bodyTextPreview: eventState.text,
                        consoleMessages,
                        exceptions,
                    },
                    null,
                    2,
                ),
            );
        } finally {
            client.close();
        }
    } finally {
        chrome.kill("SIGTERM");
        await sleep(500);
        if (!chrome.killed) {
            chrome.kill("SIGKILL");
        }
        if (stderr.trim()) {
            console.error(stderr.trim());
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
