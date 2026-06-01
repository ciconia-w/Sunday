const now = Date.now();
const conversationId = `workspace-conv-${now}`;
const articleId = `article-${now}`;

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return response.json();
}

const articleBefore = await post("/conversation/get-workspace-article", {
    conversationId,
    articleId,
});

const updateArticle = await post("/conversation/update-workspace-article", {
    conversationId,
    articleId,
    newContent: "# Workspace Doc\n\nhello workspace",
});

const articleAfter = await post("/conversation/get-workspace-article", {
    conversationId,
    articleId,
});

const updateOutline = await post("/conversation/update-workspace-outline", {
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

const outlineAfter = await post("/conversation/get-workspace-outline", {
    conversationId,
    articleId,
});

const exportResult = await post("/conversation/save-workspace-article-to-file", {
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
