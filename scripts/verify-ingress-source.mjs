import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const externalIngressPath = join(repoRoot, "pi-sidecar", "src", "runtime", "external-ingress.mjs");
const devServerPath = join(repoRoot, "pi-sidecar", "src", "dev-server.mjs");
const ingressDocPath = join(repoRoot, "docs", "external-ingress.md");

const [externalIngressSource, devServerSource, ingressDocSource] = await Promise.all([
    readFile(externalIngressPath, "utf8"),
    readFile(devServerPath, "utf8"),
    readFile(ingressDocPath, "utf8"),
]);

const checks = {
    routeIdentityUsesThreadId: externalIngressSource.includes("threadId")
        && externalIngressSource.includes("routeKey"),
    routeCreatesStableConversationId: externalIngressSource.includes("`ext-conv-${routeToken}`"),
    routeCreatesStableSessionId: externalIngressSource.includes("`ext-sess-${routeToken}`"),
    followupLinksToConversationTail: externalIngressSource.includes("getConversationTailMessageId"),
    ingressPersistsConversationRoot: externalIngressSource.includes("saveConversation(payload.conversation_id)"),
    ingressStoresReplyWebhookRoute: externalIngressSource.includes("replyWebhookUrl")
        && externalIngressSource.includes("routeStorePath")
        && externalIngressSource.includes("saveRouteTargets"),
    ingressSupportsLarkWebhookTransport: externalIngressSource.includes("lark-bot-webhook")
        && externalIngressSource.includes("createHmac")
        && externalIngressSource.includes("replyWebhookSecret"),
    ingressPushesReplyOnFinish: externalIngressSource.includes("handleSessionFinished")
        && externalIngressSource.includes("postReply"),
    ingressPushesErrorOnFailure: externalIngressSource.includes("handleSessionError")
        && externalIngressSource.includes("errorCode"),
    ingressRetriesAndStoresDeadLetters: externalIngressSource.includes("replyRetryDelaysMs")
        && externalIngressSource.includes("deadLetterPath")
        && externalIngressSource.includes("appendDeadLetter")
        && externalIngressSource.includes("attemptCount"),
    ingressPersistsReplayQueue: externalIngressSource.includes("replayQueuePath")
        && externalIngressSource.includes("createReplayQueueEntry")
        && externalIngressSource.includes("replayQueuedReply")
        && externalIngressSource.includes("resolveReplayQueueEntry"),
    headlessRepliesPersistOnFinish: devServerSource.includes("persistHeadlessSessionRender")
        && devServerSource.includes("setConversationRender")
        && devServerSource.includes("saveConversation(current.conversationId)"),
    devServerTriggersReplyPush: devServerSource.includes("handleSessionStarted")
        && devServerSource.includes("handleSessionFinished")
        && devServerSource.includes("handleSessionError"),
    devServerExposesIngressOperatorApi: devServerSource.includes("/ingress/get-reply-routes")
        && devServerSource.includes("/ingress/get-replay-queue")
        && devServerSource.includes("/ingress/replay-queue/replay")
        && devServerSource.includes("/ingress/replay-queue/resolve"),
    docExplainsThreadRouting: ingressDocSource.includes("threadId")
        && ingressDocSource.includes("同一 thread")
        && ingressDocSource.includes("/ingress/message"),
    docExplainsWebhookReply: ingressDocSource.includes("replyWebhookUrl")
        && ingressDocSource.includes("webhook")
        && ingressDocSource.includes("assistantText"),
    docExplainsLarkAndReliability: ingressDocSource.includes("lark-bot-webhook")
        && ingressDocSource.includes("replyWebhookSecret")
        && ingressDocSource.includes("external-ingress-dead-letters.json")
        && ingressDocSource.includes("重试"),
    docExplainsReplayOperatorSurface: ingressDocSource.includes("external-ingress-replay-queue.json")
        && ingressDocSource.includes("/ingress/get-replay-queue")
        && ingressDocSource.includes("/ingress/replay-queue/replay")
        && ingressDocSource.includes("/ingress/replay-queue/resolve"),
};

const verdict = Object.values(checks).every(Boolean)
    ? "ingress-source-confirmed"
    : "ingress-source-incomplete";

console.log(JSON.stringify({ checks, verdict }, null, 2));
process.exit(verdict === "ingress-source-confirmed" ? 0 : 1);
