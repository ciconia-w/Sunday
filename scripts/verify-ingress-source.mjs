import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

const externalIngressPath = join(repoRoot, "pi-sidecar", "src", "runtime", "external-ingress.mjs");
const ingressReplayWorkerPath = join(repoRoot, "pi-sidecar", "src", "runtime", "ingress-replay-worker.mjs");
const ingressReplayStorePath = join(repoRoot, "pi-sidecar", "src", "runtime", "ingress-replay-store.mjs");
const ingressReplyDeliveryPath = join(repoRoot, "pi-sidecar", "src", "runtime", "ingress-reply-delivery.mjs");
const devServerPath = join(repoRoot, "pi-sidecar", "src", "dev-server.mjs");
const ingressDocPath = join(repoRoot, "docs", "external-ingress.md");

const [
    externalIngressSource,
    ingressReplayWorkerSource,
    ingressReplayStoreSource,
    ingressReplyDeliverySource,
    devServerSource,
    ingressDocSource,
] = await Promise.all([
    readFile(externalIngressPath, "utf8"),
    readFile(ingressReplayWorkerPath, "utf8"),
    readFile(ingressReplayStorePath, "utf8"),
    readFile(ingressReplyDeliveryPath, "utf8"),
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
        && externalIngressSource.includes("rememberReplyTarget")
        && ingressReplayStoreSource.includes("routeStorePath")
        && ingressReplayStoreSource.includes("saveReplyRouteEntries")
        && ingressReplayStoreSource.includes("upsertReplyRoute"),
    ingressSupportsLarkWebhookTransport: ingressReplyDeliverySource.includes("lark-bot-webhook")
        && ingressReplyDeliverySource.includes("createHmac")
        && ingressReplyDeliverySource.includes("buildLarkBotReplyBody"),
    ingressSupportsSlackWebhookTransport: ingressReplyDeliverySource.includes("slack-webhook")
        && ingressReplyDeliverySource.includes("buildSlackReplyBody")
        && ingressReplyDeliverySource.includes("postSlackWebhookReply"),
    ingressSupportsDingtalkWebhookTransport: ingressReplyDeliverySource.includes("dingtalk-bot-webhook")
        && ingressReplyDeliverySource.includes("buildDingtalkReplyBody")
        && ingressReplyDeliverySource.includes("createDingtalkBotSignature"),
    ingressSupportsDiscordWebhookTransport: ingressReplyDeliverySource.includes("discord-webhook")
        && ingressReplyDeliverySource.includes("buildDiscordReplyBody")
        && ingressReplyDeliverySource.includes("postDiscordWebhookReply"),
    ingressSupportsTeamsWebhookTransport: ingressReplyDeliverySource.includes("teams-webhook")
        && ingressReplyDeliverySource.includes("buildTeamsReplyBody")
        && ingressReplyDeliverySource.includes("postTeamsWebhookReply"),
    ingressPushesReplyOnFinish: externalIngressSource.includes("handleSessionFinished")
        && externalIngressSource.includes("deliverReply("),
    ingressPushesErrorOnFailure: externalIngressSource.includes("handleSessionError")
        && externalIngressSource.includes("errorCode"),
    ingressRetriesAndStoresDeadLetters: externalIngressSource.includes("replyRetryDelaysMs")
        && externalIngressSource.includes("appendDeadLetter")
        && ingressReplayStoreSource.includes("deadLetterPath")
        && ingressReplyDeliverySource.includes("attemptCount"),
    ingressPersistsReplayQueue: externalIngressSource.includes("createReplayQueueEntry")
        && externalIngressSource.includes("replayQueuedReply")
        && externalIngressSource.includes("resolveReplayQueueEntry")
        && ingressReplayStoreSource.includes("replayQueuePath")
        && ingressReplayStoreSource.includes("claimReplayQueueEntry")
        && ingressReplayStoreSource.includes("mutateReplayQueue"),
    ingressStoresDeliveryReceiptsAndClaims: ingressReplayStoreSource.includes("latestReceipt")
        && ingressReplayStoreSource.includes("processing")
        && ingressReplayStoreSource.includes("createDeliveryReceipt")
        && ingressReplayStoreSource.includes("createReplayProcessingClaim"),
    ingressCapturesProviderSpecificReceipts: ingressReplyDeliverySource.includes("providerCode")
        && ingressReplyDeliverySource.includes("providerMessage")
        && ingressReplyDeliverySource.includes("responseBodyPreview")
        && ingressReplyDeliverySource.includes("errcode")
        && externalIngressSource.includes("routeMutationAuthority"),
    ingressClassifiesReceiptTaxonomy: ingressReplayStoreSource.includes("receiptCategory")
        && ingressReplayStoreSource.includes("automaticReplayEligible")
        && ingressReplayStoreSource.includes("governanceAction")
        && ingressReplayStoreSource.includes("governanceHint")
        && ingressReplayStoreSource.includes("transport-network")
        && ingressReplayStoreSource.includes("provider-policy"),
    ingressUsesTaxonomyForReplayGovernance: ingressReplayStoreSource.includes("deliveryReceiptAllowsAutomaticReplay")
        && externalIngressSource.includes("deliveryReceiptAllowsAutomaticReplay")
        && externalIngressSource.includes("receiptTaxonomy")
        && ingressReplayWorkerSource.includes("deliveryReceiptAllowsAutomaticReplay"),
    ingressRunsBackgroundReplayWorker: externalIngressSource.includes("backgroundReplayEnabled")
        && externalIngressSource.includes("backgroundReplayDelaysMs")
        && externalIngressSource.includes("startBackgroundReplayLoop")
        && externalIngressSource.includes("runDueBackgroundReplays"),
    ingressSupportsDedicatedReplayServiceMode: externalIngressSource.includes("backgroundReplayMode")
        && externalIngressSource.includes("service-worker-direct")
        && externalIngressSource.includes("serviceUsesSidecarOperatorApi")
        && devServerSource.includes("startIngressReplayServiceWorker"),
    ingressSupportsStandaloneReplayServiceMode: externalIngressSource.includes("standalone-service")
        && externalIngressSource.includes("standalone-worker-direct")
        && ingressReplayWorkerSource.includes("standalone-worker")
        && devServerSource.includes("usesSidecarManagedBackgroundReplayService"),
    ingressSupportsOperatorPauseResume: ingressReplayStoreSource.includes("backgroundReplayControlPath")
        && externalIngressSource.includes("pauseBackgroundReplay")
        && externalIngressSource.includes("resumeBackgroundReplay")
        && externalIngressSource.includes("isBackgroundReplayPaused"),
    ingressReplayWorkerUsesSharedStoreDirectly: ingressReplayWorkerSource.includes("IngressReplayStore")
        && ingressReplayWorkerSource.includes("executeReplyDelivery")
        && ingressReplayWorkerSource.includes("claimReplayQueueEntry")
        && ingressReplayWorkerSource.includes("mutateReplayQueue")
        && !ingressReplayWorkerSource.includes("/ingress/get-replay-queue")
        && !ingressReplayWorkerSource.includes("/ingress/replay-queue/replay"),
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
    docExplainsTeamsWorkflowWebhook: ingressDocSource.includes("teams-webhook")
        && ingressDocSource.includes("Teams workflow webhook")
        && ingressDocSource.includes("text` payload"),
    docExplainsSharedQueueOwnership: ingressDocSource.includes("shared runtime store")
        && ingressDocSource.includes("直接读取 shared replay queue")
        && ingressDocSource.includes("latestReceipt")
        && ingressDocSource.includes("processing"),
    docExplainsSharedRouteOwnershipAndProviderReceipts: ingressDocSource.includes("route ownership")
        && ingressDocSource.includes("routeMutationAuthority")
        && ingressDocSource.includes("providerCode")
        && ingressDocSource.includes("providerMessage")
        && ingressDocSource.includes("responseBodyPreview"),
    docExplainsReceiptTaxonomyAndGovernance: ingressDocSource.includes("receiptCategory")
        && ingressDocSource.includes("automaticReplayEligible")
        && ingressDocSource.includes("governanceAction")
        && ingressDocSource.includes("governanceHint")
        && ingressDocSource.includes("transport-network")
        && ingressDocSource.includes("provider-policy"),
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
