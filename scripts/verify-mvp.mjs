import { spawn } from "node:child_process";
import { repoRoot } from "./paths.mjs";

const steps = [
    {
        name: "build-web-client",
        command: "npm",
        args: ["run", "build", "--prefix", "web-client"],
        description: "Rebuild the web client so bundle-based verification runs against the current source tree.",
    },
    {
        name: "cleanup-test-conversations",
        command: "npm",
        args: ["run", "cleanup:test-conversations"],
        description: "Remove known verification conversations from history before running the MVP suite.",
    },
    {
        name: "model-config",
        command: "npm",
        args: ["run", "verify:model-config"],
        description: "Verify model list, model switch, and post-switch live inference.",
    },
    {
        name: "agent-file-ops",
        command: "npm",
        args: ["run", "verify:agent-file-ops"],
        description: "Verify the generic agent can create, update, read, and delete a local file through real tool execution.",
    },
    {
        name: "host-qt-live",
        command: "npm",
        args: ["run", "verify:host-qt-live"],
        description: "Verify Qt host + live chat path.",
    },
    {
        name: "host-qt-tool-flow",
        command: "npm",
        args: ["run", "verify:host-qt-tool-flow"],
        description: "Verify Qt host surfaces real tool-call events during a live agent file operation.",
    },
    {
        name: "file-channel",
        command: "npm",
        args: ["run", "verify:file-channel"],
        description: "Verify host-side file channel protocol methods.",
    },
    {
        name: "host-qt-file-flow",
        command: "npm",
        args: ["run", "verify:host-qt-file-flow"],
        description: "Verify Qt host file add / parse / delete flow.",
    },
    {
        name: "host-qt-clear-all",
        command: "npm",
        args: ["run", "verify:host-qt-clear-all"],
        description: "Verify Qt host can clear attached files through the chat input action surface.",
    },
    {
        name: "host-qt-failed-file-retry",
        command: "npm",
        args: ["run", "verify:host-qt-failed-file-retry"],
        description: "Verify Qt host can surface a file parse failure and recover through the retry path.",
    },
    {
        name: "host-qt-tool-file-actions",
        command: "npm",
        args: ["run", "verify:host-qt-tool-file-actions"],
        description: "Verify Qt host can trigger file-related tool card actions through the real chat UI.",
    },
    {
        name: "host-qt-tool-command-action",
        command: "npm",
        args: ["run", "verify:host-qt-tool-command-action"],
        description: "Verify Qt host can trigger the bash tool card command-copy action through the real chat UI.",
    },
    {
        name: "host-qt-follow-up",
        command: "npm",
        args: ["run", "verify:host-qt-follow-up"],
        description: "Verify Qt host can trigger the assistant follow-up action and restore the prior prompt context.",
    },
    {
        name: "host-qt-recent-conversation-continue",
        command: "npm",
        args: ["run", "verify:host-qt-recent-conversation-continue"],
        description: "Verify the welcome screen can reopen a recent Sunday conversation through the real Qt chat shell.",
    },
    {
        name: "host-qt-welcome",
        command: "npm",
        args: ["run", "verify:host-qt-welcome"],
        description: "Verify the generic welcome experience keeps the recent-work entry and removes the old runtime header clutter.",
    },
    {
        name: "host-qt-settings-home",
        command: "npm",
        args: ["run", "verify:host-qt-settings-home"],
        description: "Verify the shell can launch directly into Settings Home through the Qt host.",
    },
    {
        name: "host-qt-model-settings",
        command: "npm",
        args: ["run", "verify:host-qt-model-settings"],
        description: "Verify the shell can launch directly into Model Settings through the Qt host.",
    },
    {
        name: "host-qt-extensions",
        command: "npm",
        args: ["run", "verify:host-qt-extensions"],
        description: "Verify the shell can launch directly into the unified extensions workspace through the Qt host.",
    },
    {
        name: "host-qt-skills",
        command: "npm",
        args: ["run", "verify:host-qt-skills"],
        description: "Verify the shell can launch directly into Skills through the Qt host.",
    },
    {
        name: "host-qt-mcp-services",
        command: "npm",
        args: ["run", "verify:host-qt-mcp-services"],
        description: "Verify the shell can launch directly into MCP Services through the Qt host.",
    },
    {
        name: "tool-summary",
        command: "npm",
        args: ["run", "verify:tool-summary"],
        description: "Verify human-readable tool execution summaries are present in the built UI bundle.",
    },
    {
        name: "tool-file-actions",
        command: "npm",
        args: ["run", "verify:tool-file-actions"],
        description: "Verify file-related tool cards expose direct file actions like open and copy path.",
    },
    {
        name: "file-guidance",
        command: "npm",
        args: ["run", "verify:file-guidance"],
        description: "Verify file guidance prompts and controls are present in the built UI bundle.",
    },
    {
        name: "file-bulk-actions",
        command: "npm",
        args: ["run", "verify:file-bulk-actions"],
        description: "Verify the chat input exposes bulk actions for attached files.",
    },
    {
        name: "message-attachment-context",
        command: "npm",
        args: ["run", "verify:message-attachment-context"],
        description: "Verify message-level attachment context and provenance affordances are present.",
    },
    {
        name: "history-model-badge",
        command: "npm",
        args: ["run", "verify:history-model-badge"],
        description: "Verify conversation history includes provider, model, and runtime mode badges.",
    },
    {
        name: "titlebar-selector-hint",
        command: "npm",
        args: ["run", "verify:titlebar-selector-hint"],
        description: "Verify the title bar clarifies that the global selector applies to new chats.",
    },
    {
        name: "model-switch-feedback",
        command: "npm",
        args: ["run", "verify:model-switch-feedback"],
        description: "Verify model changes provide explicit feedback for new chats and current conversations.",
    },
    {
        name: "sidebar-workspaces",
        command: "npm",
        args: ["run", "verify:sidebar-workspaces"],
        description: "Verify the primary sidebar exposes first-class workspace navigation for settings and extension pages.",
    },
    {
        name: "settings-home",
        command: "npm",
        args: ["run", "verify:settings-home"],
        description: "Verify the shell exposes a unified settings landing page for runtime, skills, and MCP surfaces.",
    },
    {
        name: "conversation-context-overview",
        command: "npm",
        args: ["run", "verify:conversation-context-overview"],
        description: "Verify the chat view exposes a compact conversation context overview.",
    },
    {
        name: "latest-tool-pill",
        command: "npm",
        args: ["run", "verify:latest-tool-pill"],
        description: "Verify the conversation overview can jump to and emphasize the latest tool execution.",
    },
    {
        name: "overview-pill-nav",
        command: "npm",
        args: ["run", "verify:overview-pill-nav"],
        description: "Verify overview pills can navigate to files, provenance, and tool execution areas.",
    },
    {
        name: "failed-file-action",
        command: "npm",
        args: ["run", "verify:failed-file-action"],
        description: "Verify failed file affordances stay visible and actionable in the input area.",
    },
    {
        name: "failed-file-feedback",
        command: "npm",
        args: ["run", "verify:failed-file-feedback"],
        description: "Verify failed file cleanup produces visible confirmation feedback.",
    },
];

function runStep(step) {
    return new Promise((resolve) => {
        const start = Date.now();
        const child = spawn(step.command, step.args, {
            cwd: repoRoot,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("exit", (code) => {
            resolve({
                ...step,
                code: code ?? 1,
                durationMs: Date.now() - start,
                stdout,
                stderr,
            });
        });
    });
}

const results = [];

for (const step of steps) {
    console.log(`\n==> ${step.name}`);
    const result = await runStep(step);
    results.push(result);

    if (result.stdout.trim()) {
        console.log(result.stdout.trim());
    }
    if (result.stderr.trim()) {
        console.error(result.stderr.trim());
    }

    if (result.code !== 0) {
        break;
    }
}

const summary = results.map((result) => ({
    step: result.name,
    ok: result.code === 0,
    durationMs: result.durationMs,
    description: result.description,
}));

const failed = results.find((result) => result.code !== 0) ?? null;

console.log(
    "\n" +
        JSON.stringify(
            {
                summary,
                verdict: failed ? "mvp-verification-failed" : "mvp-verification-confirmed",
                failedStep: failed?.name ?? null,
            },
            null,
            2,
        ),
);

process.exit(failed ? 1 : 0);
