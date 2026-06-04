import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function toConversationIndex(conversation, updatedAt, assistantName = "") {
    return {
        id: conversation?.root?.id ?? "",
        title: getConversationTitle(conversation),
        updated_at: updatedAt,
        assistant: conversation?.root?.assistant ?? "",
        assistant_name: assistantName,
        model: conversation?.root?.model ?? "",
        model_name: getConversationModelName(conversation),
        runtime_mode: conversation?.root?.runtime_mode ?? "",
        introduction: getConversationIntroduction(conversation),
    };
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function isEmptyValue(value) {
    if (value === undefined || value === null || value === "") {
        return true;
    }

    if (Array.isArray(value)) {
        return value.length === 0;
    }

    if (isPlainObject(value)) {
        return Object.keys(value).length === 0;
    }

    return false;
}

function truncateText(value, maxLength = 120) {
    const normalized = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "";
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1)}…`;
}

function collectTextFromToolValue(value) {
    if (isEmptyValue(value)) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => collectTextFromToolValue(item))
            .filter(Boolean)
            .join(" ");
    }

    if (isPlainObject(value)) {
        const maybeContent = value.content;
        if (Array.isArray(maybeContent)) {
            const text = maybeContent
                .map((item) => {
                    if (isPlainObject(item) && typeof item.text === "string") {
                        return item.text;
                    }
                    return collectTextFromToolValue(item);
                })
                .filter(Boolean)
                .join(" ");
            if (text) {
                return text;
            }
        }

        return Object.values(value)
            .map((item) => collectTextFromToolValue(item))
            .filter(Boolean)
            .join(" ");
    }

    return String(value);
}

function getRecordString(value, keys) {
    if (!isPlainObject(value)) {
        return "";
    }

    for (const key of keys) {
        const item = value[key];
        if (typeof item === "string" && item.trim()) {
            return item.trim();
        }
    }

    return "";
}

function getToolIntroduction(toolData) {
    const displayContent = isPlainObject(toolData?.display_content) ? toolData.display_content : null;
    const name = String(displayContent?.name ?? toolData?.name ?? "")
        .trim()
        .toLowerCase();
    const params = displayContent?.params ?? toolData?.params;
    const result = displayContent?.result ?? toolData?.result;
    const path = getRecordString(params, ["path", "file_path", "target_path"]);
    const resultText = truncateText(collectTextFromToolValue(result));

    if (name === "bash") {
        const command = truncateText(getRecordString(params, ["command", "cmd"]));
        return command ? `bash · ${command}` : resultText || "bash";
    }

    if (name === "read") {
        return path ? `read · ${path}` : resultText || "read";
    }

    if (name === "write") {
        return path ? `write · ${path}` : resultText || "write";
    }

    if (name === "edit") {
        return path ? `edit · ${path}` : resultText || "edit";
    }

    if (name === "find" || name === "grep" || name === "ls") {
        return resultText || name;
    }

    return resultText || name;
}

function getMessagePlainText(message) {
    const messageText = (message?.message ?? [])
        .flatMap((item) => item?.content ?? [])
        .filter((content) => content?.type === "text")
        .map((content) => content?.content ?? "")
        .join(" ");

    return truncateText(messageText);
}

function getMessageIntroduction(message) {
    const renderItems = Array.isArray(message?.render_message) ? message.render_message : [];

    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
        const item = renderItems[index];
        if (!item || typeof item !== "object") {
            continue;
        }

        if (item.type === "tool") {
            const toolIntroduction = getToolIntroduction(item.data);
            if (toolIntroduction) {
                return toolIntroduction;
            }
        }

        if (item.type === "text") {
            const text = truncateText(item?.data?.content ?? "");
            if (text) {
                return text;
            }
        }
    }

    return getMessagePlainText(message);
}

function getConversationModelName(conversation) {
    const root = conversation?.root;
    const messages = conversation?.messages ?? {};
    const firstMessage = root?.cur_next ? messages[root.cur_next] : null;

    if (typeof firstMessage?.model_name === "string" && firstMessage.model_name.trim()) {
        return firstMessage.model_name.trim();
    }

    const modelId = root?.model ?? "";
    if (typeof modelId !== "string" || !modelId.trim()) {
        return "";
    }

    const segments = modelId.split("/");
    return segments[segments.length - 1] ?? modelId;
}

function getConversationTitle(conversation) {
    const root = conversation?.root;
    const messages = conversation?.messages ?? {};
    const firstMessage = root?.cur_next ? messages[root.cur_next] : null;

    const renderText = (firstMessage?.render_message ?? [])
        .filter((item) => item?.type === "text")
        .map((item) => item?.data?.content ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

    if (renderText) {
        return renderText;
    }

    const messageText = (firstMessage?.message ?? [])
        .flatMap((item) => item?.content ?? [])
        .filter((content) => content?.type === "text")
        .map((content) => content?.content ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

    return messageText || "新对话";
}

function getConversationIntroduction(conversation) {
    const root = conversation?.root;
    const messages = conversation?.messages ?? {};
    let currentId = root?.cur_next ?? "";
    let latestAssistantIntroduction = "";
    let latestUserIntroduction = "";

    while (currentId && messages[currentId]) {
        const message = messages[currentId];
        const introduction = getMessageIntroduction(message);

        if (message?.role === 2 && introduction) {
            latestAssistantIntroduction = introduction;
        } else if (message?.role === 1 && introduction) {
            latestUserIntroduction = introduction;
        }

        currentId = message?.cur_next ?? "";
    }

    return latestAssistantIntroduction || latestUserIntroduction || "";
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function defaultOutlineData() {
    return {
        title: "Untitled Outline",
        paragraphs: [],
    };
}

function defaultArticle(articleId, title = "Untitled Document", content = "") {
    const now = new Date().toISOString();
    return {
        id: articleId,
        title,
        content,
        version: 1,
        created_at: now,
        updated_at: now,
        references: [],
    };
}

function normalizeUserMessage(payload) {
    const content = Array.isArray(payload?.message?.content) ? payload.message.content : [];
    return {
        id: payload?.message?.id ?? "",
        cur_next: "",
        extension: payload?.message?.extension ?? {},
        message: [
            {
                content: content.map((item) => ({
                    content: item?.data?.content ?? "",
                    type: item?.type ?? "text",
                })),
                role: "user",
                source: "",
            },
        ],
        next: [],
        previous: payload?.message?.previous ?? "",
        render_message: content
            .filter((item) => item?.type === "text")
            .map((item) => ({
                type: "text",
                data: {
                    content: item?.data?.content ?? "",
                },
            })),
        role: 1,
        model_id: payload?.model ?? "",
        model_name: payload?.model_name ?? "",
    };
}

function buildAssistantMessage(messageId, pending, renderMessage) {
    return {
        id: messageId,
        cur_next: "",
        extension: {},
        message: [],
        next: [],
        previous: pending?.userMessageId ?? "",
        render_message: renderMessage,
        role: 2,
        model_id: pending?.model ?? "",
        model_name: pending?.modelName ?? "",
    };
}

export class ConversationRepository {
    constructor(options) {
        this.options = options;
        this.baseDir = resolve(options.runtimeDir, "conversations");
        this.workspaceDir = resolve(options.runtimeDir, "workspace");
        this.conversations = new Map();
        this.workspaceArticles = new Map();
        this.workspaceOutlines = new Map();
        this.pendingSessions = new Map();
        this.lastSearchKeyword = "";
    }

    async ensureReady() {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = Promise.all([
            mkdir(this.baseDir, { recursive: true }),
            mkdir(this.workspaceDir, { recursive: true }),
        ]);
        return this.readyPromise;
    }

    getConversationPath(conversationId) {
        return resolve(this.baseDir, `${conversationId}.json`);
    }

    getWorkspaceConversationDir(conversationId) {
        return resolve(this.workspaceDir, conversationId);
    }

    getWorkspaceArticlePath(conversationId, articleId) {
        return resolve(this.getWorkspaceConversationDir(conversationId), `${articleId}.article.json`);
    }

    getWorkspaceOutlinePath(conversationId, articleId) {
        return resolve(this.getWorkspaceConversationDir(conversationId), `${articleId}.outline.json`);
    }

    getAssistantName(assistantId) {
        const assistants = this.options.assistants ?? [];
        const assistant = assistants.find((item) => item?.id === assistantId);
        return assistant?.name ?? "";
    }

    async loadConversation(conversationId) {
        await this.ensureReady();
        if (this.conversations.has(conversationId)) {
            return this.conversations.get(conversationId);
        }

        try {
            const raw = await readFile(this.getConversationPath(conversationId), "utf8");
            const conversation = JSON.parse(raw);
            this.conversations.set(conversationId, conversation);
            return conversation;
        } catch {
            return null;
        }
    }

    async saveConversationFile(conversationId) {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) {
            return false;
        }

        await this.ensureReady();
        await writeFile(this.getConversationPath(conversationId), JSON.stringify(conversation, null, 2));
        return true;
    }

    getWorkspaceArticleCacheKey(conversationId, articleId) {
        return `${conversationId}::${articleId}`;
    }

    async loadWorkspaceArticle(conversationId, articleId) {
        await this.ensureReady();
        const key = this.getWorkspaceArticleCacheKey(conversationId, articleId);
        if (this.workspaceArticles.has(key)) {
            return this.workspaceArticles.get(key);
        }

        try {
            const raw = await readFile(this.getWorkspaceArticlePath(conversationId, articleId), "utf8");
            const article = JSON.parse(raw);
            this.workspaceArticles.set(key, article);
            return article;
        } catch {
            return null;
        }
    }

    async loadWorkspaceOutline(conversationId, articleId) {
        await this.ensureReady();
        const key = this.getWorkspaceArticleCacheKey(conversationId, articleId);
        if (this.workspaceOutlines.has(key)) {
            return this.workspaceOutlines.get(key);
        }

        try {
            const raw = await readFile(this.getWorkspaceOutlinePath(conversationId, articleId), "utf8");
            const outline = JSON.parse(raw);
            this.workspaceOutlines.set(key, outline);
            return outline;
        } catch {
            return null;
        }
    }

    async saveWorkspaceArticle(conversationId, articleId, article) {
        await this.ensureReady();
        await mkdir(this.getWorkspaceConversationDir(conversationId), { recursive: true });
        const key = this.getWorkspaceArticleCacheKey(conversationId, articleId);
        this.workspaceArticles.set(key, article);
        await writeFile(this.getWorkspaceArticlePath(conversationId, articleId), JSON.stringify(article, null, 2));
        return article;
    }

    async saveWorkspaceOutline(conversationId, articleId, outline) {
        await this.ensureReady();
        await mkdir(this.getWorkspaceConversationDir(conversationId), { recursive: true });
        const key = this.getWorkspaceArticleCacheKey(conversationId, articleId);
        this.workspaceOutlines.set(key, outline);
        await writeFile(this.getWorkspaceOutlinePath(conversationId, articleId), JSON.stringify(outline, null, 2));
        return outline;
    }

    createConversationRoot(payload) {
        return {
            root: {
                id: payload?.conversation_id ?? "",
                assistant: payload?.assistant ?? "",
                cur_next: "",
                model: payload?.model ?? "",
                runtime_mode: payload?.runtime_mode ?? "",
                next: [],
            },
            messages: {},
        };
    }

    linkMessage(conversation, messageId, message) {
        const messages = conversation.messages ?? {};
        if (Object.keys(messages).length === 0) {
            conversation.root.cur_next = messageId;
            if (!conversation.root.next.includes(messageId)) {
                conversation.root.next.push(messageId);
            }
        }

        const previousId = message?.previous ?? "";
        if (previousId && messages[previousId]) {
            const previous = messages[previousId];
            previous.cur_next = messageId;
            previous.next = Array.isArray(previous.next)
                ? previous.next.filter((item) => item !== messageId)
                : [];
            previous.next.push(messageId);
        }

        messages[messageId] = message;
        conversation.messages = messages;
    }

    async trackOutgoingPayload(payload) {
        const conversationId = payload?.conversation_id ?? "";
        const sessionId = payload?.session_id ?? "";
        const messageId = payload?.message?.id ?? "";
        if (!conversationId || !sessionId || !messageId) {
            return;
        }

        const conversation =
            (await this.loadConversation(conversationId)) ?? this.createConversationRoot(payload);

        conversation.root.assistant = payload?.assistant ?? conversation.root.assistant ?? "";
        conversation.root.model = payload?.model ?? conversation.root.model ?? "";
        conversation.root.runtime_mode = payload?.runtime_mode ?? conversation.root.runtime_mode ?? "";

        const userMessage = normalizeUserMessage(payload);
        this.linkMessage(conversation, userMessage.id, userMessage);

        this.conversations.set(conversationId, conversation);
        this.pendingSessions.set(sessionId, {
            conversationId,
            assistant: payload?.assistant ?? "",
            model: payload?.model ?? "",
            modelName: payload?.model_name ?? "",
            userMessageId: userMessage.id,
        });
    }

    async getConversation(conversationId) {
        return this.loadConversation(conversationId);
    }

    async getConversationTailMessageId(conversationId) {
        const conversation = await this.loadConversation(conversationId);
        const messages = conversation?.messages ?? {};
        const visited = new Set();
        let currentId = conversation?.root?.cur_next ?? conversation?.root?.next?.[0] ?? "";
        let lastSeenId = "";

        while (currentId && messages[currentId] && !visited.has(currentId)) {
            visited.add(currentId);
            lastSeenId = currentId;
            currentId = messages[currentId]?.cur_next ?? "";
        }

        return lastSeenId;
    }

    async deleteConversation(ids) {
        await this.ensureReady();
        for (const id of ids ?? []) {
            this.conversations.delete(id);
            await rm(this.getConversationPath(id), { force: true });
        }
    }

    async releaseConversation(ids) {
        for (const id of ids ?? []) {
            this.conversations.delete(id);
        }
    }

    async saveConversation(conversationId) {
        return this.saveConversationFile(conversationId);
    }

    async setConversationRender(conversationId, messageId, renderJson) {
        const conversation = await this.loadConversation(conversationId);
        if (!conversation) {
            return false;
        }

        const renderMessage = JSON.parse(renderJson || "[]");
        await this.syncWorkspaceArtifactsFromRender(conversationId, renderMessage);
        let message = conversation.messages?.[messageId];
        if (!message) {
            const pending = [...this.pendingSessions.values()]
                .reverse()
                .find((item) => item?.conversationId === conversationId);
            message = buildAssistantMessage(messageId, pending, renderMessage);
            this.linkMessage(conversation, messageId, message);
        } else {
            message.render_message = renderMessage;
        }

        conversation.messages[messageId] = message;
        this.conversations.set(conversationId, conversation);
        return true;
    }

    async syncWorkspaceArtifactsFromRender(conversationId, renderMessage) {
        for (const item of renderMessage) {
            if (!item || typeof item !== "object") {
                continue;
            }

            if (item.type === "outline") {
                const outline = item.data;
                if (!outline || typeof outline !== "object") {
                    continue;
                }
                const articleId = outline.id ?? outline.article_id ?? outline.articleId ?? `${conversationId}-outline`;
                const title = outline.title ?? "Untitled Outline";
                const normalizedOutline = {
                    title,
                    paragraphs: Array.isArray(outline.paragraphs) ? outline.paragraphs : [],
                };
                await this.saveWorkspaceOutline(conversationId, articleId, normalizedOutline);
            }

            if (item.type === "doc_card") {
                const doc = item.data;
                if (!doc || typeof doc !== "object" || !doc.id) {
                    continue;
                }
                const existing = await this.loadWorkspaceArticle(conversationId, doc.id);
                if (!existing) {
                    await this.saveWorkspaceArticle(
                        conversationId,
                        doc.id,
                        defaultArticle(doc.id, doc.title ?? "Untitled Document", ""),
                    );
                }
            }
        }
    }

    async switchMessageNext(conversationId, target, next) {
        const conversation = await this.loadConversation(conversationId);
        if (!conversation) {
            return false;
        }

        const targetMessage = conversation.messages?.[target];
        if (!targetMessage) {
            return false;
        }

        targetMessage.cur_next = next;
        targetMessage.next = Array.isArray(targetMessage.next)
            ? targetMessage.next.filter((item) => item !== next)
            : [];
        targetMessage.next.push(next);
        return true;
    }

    async getAllConversationIndexes() {
        await this.ensureReady();
        const names = await readdir(this.baseDir);
        const items = [];

        for (const name of names) {
            if (!name.endsWith(".json")) {
                continue;
            }

            const conversationId = name.slice(0, -5);
            const conversation = await this.loadConversation(conversationId);
            if (!conversation?.root?.id) {
                continue;
            }

            const info = await stat(this.getConversationPath(conversationId));
            items.push(
                toConversationIndex(
                    conversation,
                    Math.floor(info.mtimeMs),
                    this.getAssistantName(conversation?.root?.assistant ?? ""),
                ),
            );
        }

        return items.sort((a, b) => b.updated_at - a.updated_at);
    }

    async getConversationIndexes() {
        return this.getAllConversationIndexes();
    }

    async searchConversations(keyword) {
        this.lastSearchKeyword = typeof keyword === "string" ? keyword.trim().toLowerCase() : "";
        return this.getHistoryConversationIndexes();
    }

    async getHistoryConversationIndexes() {
        const items = await this.getAllConversationIndexes();
        if (!this.lastSearchKeyword) {
            return items;
        }

        return items.filter((item) => {
            const title = (item?.title ?? "").toLowerCase();
            const introduction = (item?.introduction ?? "").toLowerCase();
            return title.includes(this.lastSearchKeyword) || introduction.includes(this.lastSearchKeyword);
        });
    }

    async getWorkspaceOutline() {
        if (arguments.length < 2) {
            return {};
        }
        const [conversationId, articleId] = arguments;
        const stored = await this.loadWorkspaceOutline(conversationId, articleId);
        if (stored) {
            return stored;
        }
        const fallback = defaultOutlineData();
        await this.saveWorkspaceOutline(conversationId, articleId, fallback);
        return fallback;
    }

    async updateWorkspaceOutline(conversationId, outlineJson) {
        const outline = JSON.parse(outlineJson || "{}");
        const articleId = outline?.id ?? outline?.article_id ?? outline?.articleId ?? `${conversationId}-outline`;
        await this.saveWorkspaceOutline(conversationId, articleId, {
            title: outline?.title ?? "Untitled Outline",
            paragraphs: Array.isArray(outline?.paragraphs) ? outline.paragraphs : [],
        });
        return true;
    }

    async getWorkspaceArticle(conversationId, articleId) {
        const stored = await this.loadWorkspaceArticle(conversationId, articleId);
        if (stored) {
            return stored;
        }

        const fallback = defaultArticle(articleId);
        await this.saveWorkspaceArticle(conversationId, articleId, fallback);
        return fallback;
    }

    async updateWorkspaceArticle(conversationId, articleId, newContent) {
        const current = (await this.loadWorkspaceArticle(conversationId, articleId)) ?? defaultArticle(articleId);
        const updated = {
            ...current,
            content: typeof newContent === "string" ? newContent : "",
            updated_at: new Date().toISOString(),
            version: Number.isFinite(current.version) ? current.version + 1 : 1,
        };
        await this.saveWorkspaceArticle(conversationId, articleId, updated);
        return true;
    }

    async saveWorkspaceArticleToFile(conversationId, articleId, format) {
        const article = await this.getWorkspaceArticle(conversationId, articleId);
        const safeFormat = ["md", "pdf", "docx"].includes(format) ? format : "md";
        const fileName = `${articleId}.${safeFormat}`;
        const exportDir = resolve(this.getWorkspaceConversationDir(conversationId), "exports");
        await mkdir(exportDir, { recursive: true });
        const exportPath = resolve(exportDir, fileName);
        const content = typeof article?.content === "string" ? article.content : "";
        await writeFile(exportPath, content, "utf8");
        return true;
    }

    async getRecentWritingDocs() {
        await this.ensureReady();
        const docs = [];
        const conversationDirNames = await readdir(this.workspaceDir).catch(() => []);

        for (const conversationId of conversationDirNames) {
            const names = await readdir(this.getWorkspaceConversationDir(conversationId)).catch(() => []);

            for (const name of names) {
                if (!name.endsWith(".article.json")) {
                    continue;
                }

                const articleId = name.replace(/\.article\.json$/, "");
                const article = await this.loadWorkspaceArticle(conversationId, articleId);
                if (!article?.id) {
                    continue;
                }

                docs.push({
                    id: article.id,
                    name: article.title || "Untitled Document",
                    updated_at: article.updated_at || article.created_at || new Date().toISOString(),
                    conversation_id: conversationId,
                });
            }
        }

        docs.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
        return docs;
    }

    getWritingTemplates() {
        return [
            {
                id: "tpl-001",
                name: "工作周报",
                description: "周度工作总结与计划模板",
                icon: "writing",
                category: "general",
                content: "# 工作周报\n\n## 本周工作\n1. \n2. \n\n## 下周计划\n1. \n2. ",
            },
            {
                id: "tpl-002",
                name: "技术文档",
                description: "API/系统技术文档模板",
                icon: "code",
                category: "tech",
                content: "# 技术文档\n\n## 概述\n\n## 接口说明\n\n## 示例代码\n\n```javascript\n```",
            },
        ];
    }

    async snapshotConversation(conversationId) {
        const conversation = await this.getConversation(conversationId);
        return conversation ? cloneJson(conversation) : null;
    }
}
