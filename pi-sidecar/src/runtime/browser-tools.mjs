import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
    ensureBrowserControlEnabled,
    getDefaultBrowserScreenshotPath,
    isBrowserControlEnabled,
    openBrowserUrl,
    runOpenCli,
} from "./browser-control.mjs";

export { isBrowserControlEnabled };

function normalizeToolResult(name, rawText, details = {}) {
    return {
        content: [{ type: "text", text: rawText || `${name} completed` }],
        details,
    };
}

const session = "sunday";

export const browserOpenTool = defineTool({
    name: "browser_open",
    label: "Browser Open",
    description: "Open a URL in the Sunday browser session.",
    parameters: Type.Object({
        url: Type.String({ description: "URL to open" }),
    }),
    async execute(_toolCallId, params) {
        ensureBrowserControlEnabled();
        const url = String(params.url || "").trim();
        const output = await openBrowserUrl(url);
        return normalizeToolResult("browser_open", output, { url });
    },
});

export const browserStateTool = defineTool({
    name: "browser_state",
    label: "Browser State",
    description: "Get the current page URL, title, and interactive element summary from the Sunday browser session.",
    parameters: Type.Object({}),
    async execute() {
        ensureBrowserControlEnabled();
        const output = await runOpenCli(["browser", session, "state"]);
        return normalizeToolResult("browser_state", output);
    },
});

export const browserClickTool = defineTool({
    name: "browser_click",
    label: "Browser Click",
    description: "Click a browser element by ref/index or selector in the Sunday browser session.",
    parameters: Type.Object({
        target: Type.String({ description: "Element ref/index or selector target" }),
    }),
    async execute(_toolCallId, params) {
        ensureBrowserControlEnabled();
        const target = String(params.target || "").trim();
        const output = await runOpenCli(["browser", session, "click", target]);
        return normalizeToolResult("browser_click", output, { target });
    },
});

export const browserTypeTool = defineTool({
    name: "browser_type",
    label: "Browser Type",
    description: "Type text into a browser element in the Sunday browser session.",
    parameters: Type.Object({
        target: Type.String({ description: "Element ref/index or selector target" }),
        text: Type.String({ description: "Text to type" }),
    }),
    async execute(_toolCallId, params) {
        ensureBrowserControlEnabled();
        const target = String(params.target || "").trim();
        const text = String(params.text || "");
        const output = await runOpenCli(["browser", session, "type", target, text]);
        return normalizeToolResult("browser_type", output, { target, text });
    },
});

export const browserWaitTool = defineTool({
    name: "browser_wait",
    label: "Browser Wait",
    description: "Wait for selector, text, time, xhr, or download in the Sunday browser session.",
    parameters: Type.Object({
        waitType: Type.String({ description: "Wait type: selector, text, time, xhr, download" }),
        waitValue: Type.String({ description: "Wait target value" }),
    }),
    async execute(_toolCallId, params) {
        ensureBrowserControlEnabled();
        const waitType = String(params.waitType || "").trim();
        const waitValue = String(params.waitValue || "").trim();
        const output = await runOpenCli(["browser", session, "wait", waitType, waitValue]);
        return normalizeToolResult("browser_wait", output, { waitType, waitValue });
    },
});

export const browserScreenshotTool = defineTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Take a full-page screenshot in the Sunday browser session.",
    parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "Optional output path for the screenshot PNG" })),
    }),
    async execute(_toolCallId, params) {
        ensureBrowserControlEnabled();
        const path = String(params.path || getDefaultBrowserScreenshotPath("sunday-tool-screenshot")).trim();
        const output = await runOpenCli(["browser", session, "screenshot", path, "--full-page"]);
        return normalizeToolResult("browser_screenshot", output, {
            fullOutputPath: path,
            screenshotPath: path,
        });
    },
});

export const browserExtractTool = defineTool({
    name: "browser_extract",
    label: "Browser Extract",
    description: "Extract the current page content as markdown from the Sunday browser session.",
    parameters: Type.Object({}),
    async execute() {
        ensureBrowserControlEnabled();
        const output = await runOpenCli(["browser", session, "extract", "--chunk-size", "4000"]);
        return normalizeToolResult("browser_extract", output);
    },
});

export const browserTools = [
    browserOpenTool,
    browserStateTool,
    browserClickTool,
    browserTypeTool,
    browserWaitTool,
    browserScreenshotTool,
    browserExtractTool,
];
