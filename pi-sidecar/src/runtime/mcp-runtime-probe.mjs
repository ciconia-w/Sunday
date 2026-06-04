import { spawn } from "node:child_process";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SHUTDOWN_GRACE_MS = 400;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeMessage(message) {
    return `${JSON.stringify(message)}\n`;
}

function extractJsonRpcMessages(buffer) {
    const messages = [];
    let offset = 0;

    while (offset < buffer.length) {
        const lineEnd = buffer.indexOf("\n", offset, "utf8");
        if (lineEnd < 0) {
            break;
        }

        const line = buffer.subarray(offset, lineEnd).toString("utf8").replace(/\r$/, "").trim();
        offset = lineEnd + 1;

        if (!line) {
            continue;
        }

        try {
            messages.push(JSON.parse(line));
        } catch {
            // Ignore non-JSON stdout noise and keep reading the stream.
        }
    }

    return {
        messages,
        remainder: buffer.subarray(offset),
    };
}

function cleanupChildProcess(childProcess) {
    if (!childProcess || childProcess.killed) {
        return;
    }

    childProcess.kill("SIGTERM");
    setTimeout(() => {
        if (childProcess.exitCode === null && childProcess.signalCode === null) {
            childProcess.kill("SIGKILL");
        }
    }, DEFAULT_SHUTDOWN_GRACE_MS).unref?.();
}

function normalizeEnvRecord(env) {
    if (!isPlainObject(env)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(env)
            .filter(([key]) => typeof key === "string" && key.trim())
            .map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]),
    );
}

function formatProbeError(error, stderrBuffer = "") {
    const stderrText = String(stderrBuffer || "").trim();
    const errorMessage = error instanceof Error ? error.message : String(error || "");

    if (stderrText && errorMessage && !stderrText.includes(errorMessage)) {
        return `${errorMessage}\n${stderrText}`.trim();
    }

    return (stderrText || errorMessage || "Unknown MCP runtime probe error.").trim();
}

export async function probeStdioMcpServer(serverConfig, options = {}) {
    const command = typeof serverConfig?.command === "string" ? serverConfig.command.trim() : "";
    const args = Array.isArray(serverConfig?.args)
        ? serverConfig.args.map((value) => String(value))
        : [];
    const cwd = typeof serverConfig?.cwd === "string" && serverConfig.cwd.trim()
        ? serverConfig.cwd.trim()
        : undefined;
    const env = {
        ...process.env,
        ...normalizeEnvRecord(serverConfig?.env),
    };
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(Number(options.timeoutMs), 1000) : DEFAULT_TIMEOUT_MS;
    const protocolVersion = typeof options.protocolVersion === "string" && options.protocolVersion.trim()
        ? options.protocolVersion.trim()
        : DEFAULT_PROTOCOL_VERSION;

    if (!command) {
        throw new Error("MCP stdio 配置缺少 command。");
    }

    return await new Promise((resolve, reject) => {
        const childProcess = spawn(command, args, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdoutBuffer = Buffer.alloc(0);
        let stderrBuffer = "";
        let settled = false;
        let nextRequestId = 1;
        const pendingRequests = new Map();

        const finish = (error, result) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeoutHandle);
            cleanupChildProcess(childProcess);

            for (const pending of pendingRequests.values()) {
                pending.reject(new Error(error ? formatProbeError(error, stderrBuffer) : "MCP probe terminated early."));
            }
            pendingRequests.clear();

            if (error) {
                reject(new Error(formatProbeError(error, stderrBuffer)));
                return;
            }

            resolve(result);
        };

        const send = (message) => {
            childProcess.stdin.write(serializeMessage(message), "utf8");
        };

        const request = (method, params = {}) => {
            return new Promise((resolveRequest, rejectRequest) => {
                const id = nextRequestId;
                nextRequestId += 1;
                pendingRequests.set(id, { resolve: resolveRequest, reject: rejectRequest });
                send({
                    jsonrpc: "2.0",
                    id,
                    method,
                    params,
                });
            });
        };

        childProcess.on("error", (error) => {
            finish(error);
        });

        childProcess.on("exit", (code, signal) => {
            if (!settled) {
                const suffix = code !== null ? `code ${code}` : `signal ${signal || "unknown"}`;
                finish(new Error(`MCP probe process exited before completing (${suffix}).`));
            }
        });

        childProcess.stderr.on("data", (chunk) => {
            stderrBuffer += chunk.toString("utf8");
        });

        childProcess.stdout.on("data", (chunk) => {
            stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
            const { messages, remainder } = extractJsonRpcMessages(stdoutBuffer);
            stdoutBuffer = remainder;

            for (const message of messages) {
                if (message?.id && pendingRequests.has(message.id)) {
                    const pending = pendingRequests.get(message.id);
                    pendingRequests.delete(message.id);

                    if (message.error) {
                        pending.reject(new Error(message.error?.message || JSON.stringify(message.error)));
                    } else {
                        pending.resolve(message.result);
                    }
                }
            }
        });

        const timeoutHandle = setTimeout(() => {
            finish(new Error(`MCP runtime probe timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        void (async () => {
            try {
                const initializeResult = await request("initialize", {
                    protocolVersion,
                    capabilities: {},
                    clientInfo: {
                        name: "sunday-mcp-probe",
                        version: "1.0.0",
                    },
                });

                send({
                    jsonrpc: "2.0",
                    method: "notifications/initialized",
                    params: {},
                });

                const toolPreview = [];
                let cursor = undefined;

                do {
                    const toolsResult = await request("tools/list", cursor ? { cursor } : {});
                    const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
                    toolPreview.push(
                        ...tools
                            .map((tool) => ({
                                name: typeof tool?.name === "string" ? tool.name.trim() : "",
                                description: typeof tool?.description === "string" ? tool.description.trim() : "",
                            }))
                            .filter((tool) => tool.name),
                    );
                    cursor = typeof toolsResult?.nextCursor === "string" && toolsResult.nextCursor.trim()
                        ? toolsResult.nextCursor.trim()
                        : undefined;
                } while (cursor);

                finish(null, {
                    protocolVersion: typeof initializeResult?.protocolVersion === "string" && initializeResult.protocolVersion.trim()
                        ? initializeResult.protocolVersion.trim()
                        : protocolVersion,
                    serverName: typeof initializeResult?.serverInfo?.name === "string" ? initializeResult.serverInfo.name.trim() : "",
                    serverVersion: typeof initializeResult?.serverInfo?.version === "string" ? initializeResult.serverInfo.version.trim() : "",
                    tools: toolPreview,
                    toolCount: toolPreview.length,
                });
            } catch (error) {
                finish(error);
            }
        })();
    });
}
