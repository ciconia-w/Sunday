import { readFile } from "node:fs/promises";
import { getBuiltBundlePath } from "./paths.mjs";

const bundlePath = getBuiltBundlePath();
const bundle = await readFile(bundlePath, "utf8");

const markers = [
    "data-ingress-operator-page",
    "data-ingress-summary",
    "data-ingress-route-row",
    "data-ingress-replay-row",
    "data-ingress-operator-runtime-note",
    "IM Bridge",
    "Delivery Policy",
    "Reply Routes",
    "Replay Queue",
    "Replay History",
    "显示已处理",
    "立即重试",
    "标记已处理",
    "忽略",
    "初始回推失败",
    "手动重试成功",
    "暂停自动重放",
    "恢复自动重放",
    "自动重放已暂停",
    "Sidecar In-Process Worker",
    "Standalone Replay Service",
    "Discord",
    "DingTalk",
    "Queue Ownership",
    "Route Persistence",
    "Worker Access",
    "Latest Receipt",
    "Provider Code",
    "Provider Message",
    "Response Preview",
    "Receipt Category",
    "Governance Action",
    "Governance Hint",
    "Automatic Replay",
    "Processing",
    "Worker 状态",
    "治理状态",
    "暂停时间",
    "退避策略",
    "自动重放分类",
    "人工处理分类",
    "当前回执分类",
    "Fixed Delays",
    "Exponential Backoff",
    "最近心跳",
    "查看 reply route、replay queue 和当前 delivery policy。",
    "data-ingress-operator-service-runtime",
    "data-ingress-operator-service-heartbeat",
    "data-ingress-operator-delivery-strategy",
    "data-ingress-operator-control-state",
    "data-ingress-operator-queue-ownership",
    "data-ingress-operator-route-ownership",
    "data-ingress-operator-api-dependency",
    "data-ingress-operator-receipt-taxonomy",
    "data-ingress-operator-operator-managed-categories",
    "data-ingress-operator-receipt-counts",
    "data-ingress-operator-pause-action",
    "data-ingress-operator-resume-action",
    "data-ingress-operator-paused-at",
    "data-ingress-replay-history",
    "data-ingress-replay-history-item",
    "data-ingress-replay-latest-receipt",
    "data-ingress-replay-receipt-provider-code",
    "data-ingress-replay-receipt-provider-message",
    "data-ingress-replay-receipt-response-preview",
    "data-ingress-replay-receipt-category",
    "data-ingress-replay-receipt-governance-action",
    "data-ingress-replay-receipt-governance-hint",
    "data-ingress-replay-receipt-replay-eligibility",
    "data-ingress-replay-processing",
];

const present = Object.fromEntries(markers.map((marker) => [marker, bundle.includes(marker)]));
const verdict = Object.values(present).every(Boolean)
    ? "ingress-operator-bundle-confirmed"
    : "ingress-operator-bundle-incomplete";

console.log(JSON.stringify({
    bundlePath,
    present,
    verdict,
}, null, 2));

process.exit(verdict === "ingress-operator-bundle-confirmed" ? 0 : 1);
