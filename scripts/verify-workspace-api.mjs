import { withSidecarRuntime } from "./sidecar-verify-runtime.mjs";

const now = Date.now();
const conversationId = `workspace-conv-${now}`;
const articleId = `article-${now}`;

async function post(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

await withSidecarRuntime({ sidecarPort: 8787 }, async ({ sidecarPort }) => {
    const baseUrl = `http://127.0.0.1:${sidecarPort}`;
    const articleBefore = await post(baseUrl, "/conversation/get-workspace-article", {
        conversationId,
        articleId,
    });

    const updateArticle = await post(baseUrl, "/conversation/update-workspace-article", {
        conversationId,
        articleId,
        newContent: "# Workspace Doc\n\nhello workspace",
    });

    const articleAfter = await post(baseUrl, "/conversation/get-workspace-article", {
        conversationId,
        articleId,
    });

    const updateOutline = await post(baseUrl, "/conversation/update-workspace-outline", {
        conversationId,
        outlineJson: JSON.stringify({
            id: articleId,
            title: "Workspace Outline",
            paragraphs: [
                {
                    title: "Chapter 1",
                    content: [{ title: "Section 1.1" }],
                },
            ],
        }),
    });

    const outlineAfter = await post(baseUrl, "/conversation/get-workspace-outline", {
        conversationId,
        articleId,
    });

    const exportResult = await post(baseUrl, "/conversation/save-workspace-article-to-file", {
        conversationId,
        articleId,
        format: "md",
    });

    const verdict =
        articleBefore?.result?.id === articleId &&
        updateArticle?.result === true &&
        articleAfter?.result?.content === "# Workspace Doc\n\nhello workspace" &&
        updateOutline?.result === true &&
        outlineAfter?.result?.title === "Workspace Outline" &&
        exportResult?.result === true
            ? "workspace-api-confirmed"
            : "workspace-api-incomplete";

    console.log(
        JSON.stringify(
            {
                sidecarPort,
                articleBefore: articleBefore.result,
                updateArticle,
                articleAfter: articleAfter.result,
                updateOutline,
                outlineAfter: outlineAfter.result,
                exportResult,
                verdict,
            },
            null,
            2,
        ),
    );

    process.exit(verdict === "workspace-api-confirmed" ? 0 : 1);
});
