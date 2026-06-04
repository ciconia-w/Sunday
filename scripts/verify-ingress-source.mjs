import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const externalIngressPath = join(repoRoot, "pi-sidecar", "src", "runtime", "external-ingress.mjs");
const ingressReplayWorkerPath = join(repoRoot, "pi-sidecar", "src", "runtime", "ingress-replay-worker.mjs");
const devServerPath = join(repoRoot, "pi-sidecar", "src", "dev-server.mjs");
const ingressDocPath = join(repoRoot, "docs", "external-ingress.md");

const [externalIngressSource, ingressReplayWorkerSource, devServerSource, ingressDocSource] = await Promise.all([
    readFile(externalIngressPath, "utf8"),
    readFile(ingressReplayWorkerPath, "utf8"),
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
    ingressSupportsSlackWebhookTransport: externalIngressSource.includes("slack-webhook")
        && externalIngressSource.includes("buildSlackReplyBody")
        && externalIngressSource.includes("postSlackWebhookReply"),
    ingressSupportsDingtalkWebhookTransport: externalIngressSource.includes("dingtalk-bot-webhook")
        && externalIngressSource.includes("buildDingtalkReplyBody")
        && externalIngressSource.includes("postDingtalkBotWebhookReply")
        && externalIngressSource.includes("createDingtalkBotSignature"),
    ingressSupportsDiscordWebhookTransport: externalIngressSource.includes("discord-webhook")
        && externalIngressSource.includes("buildDiscordReplyBody")
        && externalIngressSource.includes("postDiscordWebhookReply"),
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
    ingressRunsBackgroundReplayWorker: externalIngressSource.includes("backgroundReplayEnabled")
        && externalIngressSource.includes("backgroundReplayDelaysMs")
        && externalIngressSource.includes("startBackgroundReplayLoop")
        && externalIngressSource.includes("runDueBackgroundReplays"),
    ingressSupportsDedicatedReplayServiceMode: externalIngressSource.includes("backgroundReplayMode")
        && externalIngressSource.includes("usesDedicatedBackgroundReplayService")
        && externalIngressSource.includes("serviceStatus")
        && externalIngressSource.includes("runtimeNote"),
    ingressSupportsStandaloneReplayServiceMode: externalIngressSource.includes("standalone-service")
        && externalIngressSource.includes("usesStandaloneBackgroundReplayService")
        && ingressReplayWorkerSource.includes("managedBySidecar")
        && devServerSource.includes("usesSidecarManagedBackgroundReplayService"),
    ingressSupportsOperatorPauseResume: externalIngressSource.includes("backgroundReplayControlPath")
        && externalIngressSource.includes("pauseBackgroundReplay")
        && externalIngressSource.includes("resumeBackgroundReplay")
        && externalIngressSource.includes("isBackgroundReplayPaused"),
    ingressReplayWorkerPollsOperatorApi: ingressReplayWorkerSource.includes("/ingress/get-replay-queue")
        && ingressReplayWorkerSource.includes("/ingress/replay-queue/replay")
        && ingressReplayWorkerSource.includes("getBackgroundReplayServiceStatusPath")
        && ingressReplayWorkerSource.includes("replayQueue?.worker?.paused === true"),
    headlessRepliesPersistOnFinish: devServerSource.includes("persistHeadlessSessionRender")
        && devServerSource.includes("setConversationRender")
        && devServerSource.includes("saveConversation(current.conversationId)"),
    devServerTriggersReplyPush: devServerSource.includes("handleSessionStarted")
        && devServerSource.includes("handleSessionFinished")
        && devServerSource.includes("handleSessionError"),
    devServerExposesIngressOperatorApi: devServerSource.includes("/ingress/get-reply-routes")
        && devServerSource.includes("/ingress/get-replay-queue")
        && devServerSource.includes("/ingress/replay-queue/replay")
        && devServerSource.includes("/ingress/replay-queue/resolve")
        && devServerSource.includes("/ingress/background-replay/pause")
        && devServerSource.includes("/ingress/background-replay/resume"),
    devServerSupervisesReplayService: devServerSource.includes("ingress-replay-worker.mjs")
        && devServerSource.includes("setBackgroundReplayServiceSupervisorStateProvider")
        && devServerSource.includes("startIngressReplayServiceWorker"),
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
    docExplainsSlackAndBackgroundReplay: ingressDocSource.includes("slack-webhook")
        && ingressDocSource.includes("background replay")
        && ingressDocSource.includes("PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS"),
    docExplainsDingtalkAndStandaloneReplay: ingressDocSource.includes("dingtalk-bot-webhook")
        && ingressDocSource.includes("standalone-service")
        && ingressDocSource.includes("PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_STRATEGY"),
    docExplainsDiscordAndReplayService: ingressDocSource.includes("discord-webhook")
        && ingressDocSource.includes("PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE")
        && ingressDocSource.includes("external-ingress-replay-service-status.json"),
    docExplainsReplayOperatorSurface: ingressDocSource.includes("external-ingress-replay-queue.json")
        && ingressDocSource.includes("/ingress/get-replay-queue")
        && ingressDocSource.includes("/ingress/replay-queue/replay")
        && ingressDocSource.includes("/ingress/replay-queue/resolve")
        && ingressDocSource.includes("/ingress/background-replay/pause")
        && ingressDocSource.includes("/ingress/background-replay/resume"),
};

const verdict = Object.values(checks).every(Boolean)
    ? "ingress-source-confirmed"
    : "ingress-source-incomplete";

console.log(JSON.stringify({ checks, verdict }, null, 2));
process.exit(verdict === "ingress-source-confirmed" ? 0 : 1);
