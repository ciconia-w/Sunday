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
    "显示已处理",
    "立即重试",
    "标记已处理",
    "忽略",
    "暂停自动重放",
    "恢复自动重放",
    "自动重放已暂停",
    "Sidecar In-Process Worker",
    "Standalone Replay Service",
    "Discord",
    "DingTalk",
    "Worker 状态",
    "治理状态",
    "暂停时间",
    "退避策略",
    "Fixed Delays",
    "Exponential Backoff",
    "最近心跳",
    "查看 reply route、replay queue 和当前 delivery policy。",
    "data-ingress-operator-service-runtime",
    "data-ingress-operator-service-heartbeat",
    "data-ingress-operator-delivery-strategy",
    "data-ingress-operator-control-state",
    "data-ingress-operator-pause-action",
    "data-ingress-operator-resume-action",
    "data-ingress-operator-paused-at",
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
