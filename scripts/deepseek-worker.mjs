#!/usr/bin/env node

import fs from "node:fs/promises";
import process from "node:process";

const DEFAULT_MODEL = process.env.DEEPSEEK_WORKER_MODEL || "deepseek-v4-pro";
const DEFAULT_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

const usage = `Usage:
  node ./scripts/deepseek-worker.mjs --prompt "task"
  node ./scripts/deepseek-worker.mjs --prompt-file /abs/path/task.txt

Options:
  --prompt <text>         Inline task prompt
  --prompt-file <path>    Read task prompt from file
  --system <text>         System prompt override
  --model <id>            Model id, default deepseek-v4-pro
  --output <path>         Write assistant output to file
  --stream                Print streaming output
`;

function readArg(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1) return "";
    return process.argv[index + 1] || "";
}

function hasArg(flag) {
    return process.argv.includes(flag);
}

async function loadPrompt() {
    const inlinePrompt = readArg("--prompt");
    if (inlinePrompt) {
        return inlinePrompt;
    }

    const promptFile = readArg("--prompt-file");
    if (promptFile) {
        return (await fs.readFile(promptFile, "utf8")).trim();
    }

    const stdinChunks = [];
    for await (const chunk of process.stdin) {
        stdinChunks.push(chunk);
    }
    return Buffer.concat(stdinChunks).toString("utf8").trim();
}

async function main() {
    if (hasArg("--help")) {
        process.stdout.write(`${usage}\n`);
        return;
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY is required");
    }

    const prompt = await loadPrompt();
    if (!prompt) {
        throw new Error("Prompt is required");
    }

    const systemPrompt =
        readArg("--system") ||
        [
            "You are an external coding worker.",
            "Return concise, high-signal output.",
            "When asked for code changes, prefer unified diffs or exact code blocks.",
            "Do not assume you can run tools inside the target repo unless explicitly told.",
        ].join(" ");

    const model = readArg("--model") || DEFAULT_MODEL;
    const outputPath = readArg("--output");
    const shouldStream = hasArg("--stream");

    const body = {
        model,
        stream: shouldStream,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ],
    };

    const response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`DeepSeek request failed: ${response.status} ${text}`);
    }

    let finalText = "";

    if (shouldStream) {
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
            const text = decoder.decode(chunk, { stream: true });
            const lines = text
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed.choices?.[0]?.delta?.content || "";
                    if (delta) {
                        finalText += delta;
                        process.stdout.write(delta);
                    }
                } catch {
                    // ignore malformed partial line
                }
            }
        }
        process.stdout.write("\n");
    } else {
        const data = await response.json();
        finalText = data.choices?.[0]?.message?.content || "";
        process.stdout.write(`${finalText}\n`);
    }

    if (outputPath) {
        await fs.writeFile(outputPath, finalText, "utf8");
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
