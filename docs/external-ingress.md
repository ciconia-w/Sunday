# External Ingress

Sunday 当前提供一个 sidecar 级别的外部消息入站协议：

- `POST /ingress/message`

它的目标不是做 UI，而是把外部消息映射到 Sunday 已有的 `conversation / session` 协议里。

## Request

最小请求体：

```json
{
  "source": "im-demo",
  "channelId": "demo-room",
  "threadId": "thread-001",
  "userId": "demo-user",
  "text": "Reply with exactly: hello"
}
```

可选字段：

- `assistantId`
- `modelId`
- `externalMessageId`
- `conversationId`
- `sessionId`
- `previousMessageId`
- `replyTransport`
- `replyWebhookUrl`
- `replyWebhookHeaders`
- `replyWebhookSecret`

## Routing Contract

如果调用方没有显式传入 `conversationId` / `sessionId`，Sunday 会按下面的维度稳定路由：

- `source`
- `channelId`
- `threadId`

也就是说，同一 `source + channelId + threadId` 会落到同一 conversation / session。

- 默认 conversation id: `ext-conv-<route-token>`
- 默认 session id: `ext-sess-<route-token>`

其中 `<route-token>` 是对路由维度做安全编码后的稳定 token。

如果没有显式传 `threadId`，Sunday 会退化为按 `channelId` 路由。

## Follow-up Linking

如果调用方没有显式传 `previousMessageId`，Sunday 会自动读取当前 conversation 的 tail message，并把新的外部消息链接到这个 tail 后面。

这意味着：

- 同一 thread 下的 follow-up message 会自动串起来
- 外部消息不会因为没有前端参与而丢失最基本的链路关系

## Reply Push

当前 Sunday 在 canonical ingress 之上补了一条最小可用的 transport adapter：

- `replyTransport = webhook`
- `replyWebhookUrl = http(s)://...`

如果第一条 ingress message 带了 `replyWebhookUrl`，Sunday 会按 `source + channelId + threadId` 记住这条 reply 路由。后续同一 thread 的 follow-up message 即使不重复携带 `replyWebhookUrl`，也会继续复用这条 webhook 回推配置。

这条 route 配置会保存在 sidecar runtime 目录下的：

- `external-ingress-routes.json`

目前这是一个 sidecar 级 contract，不是前端能力。

### Provider-specific adapter: Lark / Feishu custom bot webhook

当前还额外支持一个 provider-specific transport：

- `replyTransport = lark-bot-webhook`
- `replyTransport = feishu-bot-webhook`（兼容别名，内部会归一化为 `lark-bot-webhook`）
- `replyWebhookUrl = https://open.feishu.cn/open-apis/bot/v2/hook/...`
- `replyWebhookSecret = ...`（可选；启用飞书自定义机器人的签名校验时需要）

这条 adapter 会把 Sunday 的 reply 转成飞书自定义机器人的 `text` 消息体，并在提供 `replyWebhookSecret` 时自动补 `timestamp + sign`。

当前保持最小实现：

- 成功时发送 assistant 文本
- 失败时发送 `Sunday 处理失败：...`
- 不引入前端配置面
- 继续复用相同的 route store

也就是说，同一 `source + channelId + threadId` 的 follow-up 在 sidecar 重启后，仍可继续向同一条飞书 bot webhook 回推。

### Provider-specific adapter: Slack incoming webhook

当前还支持一条非 Lark 的 provider-specific transport：

- `replyTransport = slack-webhook`
- `replyTransport = slack-incoming-webhook`（兼容别名，内部会归一化为 `slack-webhook`）
- `replyWebhookUrl = https://hooks.slack.com/services/...`

这条 adapter 会把 Sunday 的 reply 转成 Slack incoming webhook 的最小 `text` payload。

当前保持最小实现：

- 成功时发送 assistant 文本
- 失败时发送 `Sunday 处理失败：...`
- 不额外引入 secret / 签名字段
- 继续复用相同的 route store

### Provider-specific adapter: DingTalk custom bot webhook

当前还支持一条 DingTalk reply transport：

- `replyTransport = dingtalk-bot-webhook`
- `replyTransport = dingtalk-webhook` / `dingtalk-custom-bot-webhook`（兼容别名，内部会归一化为 `dingtalk-bot-webhook`）
- `replyWebhookUrl = https://oapi.dingtalk.com/robot/send?...`
- `replyWebhookSecret = ...`（可选；启用自定义机器人的加签校验时需要）

这条 adapter 会把 Sunday 的 reply 转成 DingTalk custom bot 的最小 `text` 消息体，并在提供 `replyWebhookSecret` 时自动补 `timestamp + sign` query。

当前保持最小实现：

- 成功时发送 assistant 文本
- 失败时发送 `Sunday 处理失败：...`
- 不引入前端配置面
- 继续复用相同的 route store

### Provider-specific adapter: Discord webhook

当前还支持一条 Discord reply transport：

- `replyTransport = discord-webhook`
- `replyTransport = discord-incoming-webhook`（兼容别名，内部会归一化为 `discord-webhook`）
- `replyWebhookUrl = https://discord.com/api/webhooks/...`

这条 adapter 会把 Sunday 的 reply 转成 Discord webhook 的最小 `content` payload。

当前保持最小实现：

- 成功时发送 assistant 文本
- 失败时发送 `Sunday 处理失败：...`
- 不额外引入 secret / 签名字段
- 继续复用相同的 route store

### Provider-specific adapter: Teams workflow webhook

当前还支持一条 Teams reply transport：

- `replyTransport = teams-webhook`
- `replyTransport = teams-incoming-webhook` / `msteams-webhook` / `microsoft-teams-webhook`（兼容别名，内部会归一化为 `teams-webhook`）
- `replyWebhookUrl = https://...`（Teams Workflows 生成的 webhook URL）

这条 adapter 会把 Sunday 的 reply 转成 Teams workflow webhook 可接收的最小 `text` payload。

当前保持最小实现：

- 成功时发送 assistant 文本
- 失败时发送 `Sunday 处理失败：...`
- 不额外引入 secret / 签名字段
- 继续复用相同的 route store

## Reply Webhook Payload

成功回推示例：

```json
{
  "ok": true,
  "transport": "webhook",
  "source": "im-demo",
  "channelId": "demo-room",
  "threadId": "thread-001",
  "routeKey": "im-demo:demo-room:thread-001",
  "conversationId": "ext-conv-im-demo-demo-room-thread-001",
  "sessionId": "ext-sess-im-demo-demo-room-thread-001",
  "requestExternalMessageId": "ext-msg-123",
  "previousMessageId": "assistant-msg-previous",
  "assistantMessageId": "assistant-msg-current",
  "assistantText": "hello",
  "renderItems": [
    {
      "type": "text",
      "data": {
        "content": "hello"
      }
    }
  ],
  "createdAt": "2026-06-04T00:00:00.000Z"
}
```

失败回推示例：

```json
{
  "ok": false,
  "transport": "webhook",
  "source": "im-demo",
  "channelId": "demo-room",
  "threadId": "thread-001",
  "routeKey": "im-demo:demo-room:thread-001",
  "conversationId": "ext-conv-im-demo-demo-room-thread-001",
  "sessionId": "ext-sess-im-demo-demo-room-thread-001",
  "requestExternalMessageId": "ext-msg-123",
  "previousMessageId": "assistant-msg-previous",
  "error": "External ingress session failed",
  "errorCode": -1,
  "createdAt": "2026-06-04T00:00:00.000Z"
}
```

约束：

- 当前只支持 `http` / `https` webhook
- 当前 provider-specific transport 已覆盖飞书/Lark、Slack、DingTalk、Discord 和 Teams workflow webhook 的最小 reply adapter
- 更复杂的 IM 平台桥接应继续叠在 generic webhook / lark bot webhook 这层 adapter 之上

## Delivery Reliability

reply push 当前已经补了最小 delivery reliability：

- 默认最多投递 `3` 次
- 默认重试延迟：`1s`、`3s`
- 所有尝试都失败后，会写入 sidecar runtime 目录下的：
  - `external-ingress-dead-letters.json`
  - `external-ingress-replay-queue.json`

dead-letter 会记录：

- transport
- route key
- conversation / session
- 外部消息 id
- 尝试次数
- 每次失败时间和错误

reply queue 会额外保留：

- 完整 reply target（包含 provider-specific secret；该文件应视为敏感运行态文件）
- 待重放 payload
- 累计 attempt / replay 次数
- delivered / resolved 等状态
- 每条 queue entry 的 replay history（初始失败 / 自动或手动重试 / resolve）

当前还没有：

- 平台专属回执确认

## Background Replay

reply queue 现在已经有最小 background replay worker。

默认行为：

- 新的失败 entry 会进入 persisted replay queue
- worker 会周期扫描 `pending` entry
- 到达 `nextAttemptAt` 后自动重放
- 自动重放成功后会把 entry 标成 `delivered`
- 自动重放超出当前 delay policy 后，会把 entry 标成 `awaiting-operator`
- operator 现在可以显式暂停 / 恢复 automatic replay
- pause 状态会保存在：
  - `external-ingress-operator-control.json`

当前相关环境变量：

- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_STRATEGY`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_INITIAL_DELAY_MS`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_DELAY_MS`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MAX_ATTEMPTS`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_BACKOFF_MULTIPLIER`
- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_POLL_MS`

当前支持三种模式：

- `in-process`：worker 运行在 sidecar 进程内
- `service`：worker 运行在 sidecar 管理的 dedicated replay service 子进程中
- `standalone-service`：worker 运行在 sidecar 外部的独立进程中，但 queue / route 的所有权仍保留在 sidecar

当 `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE=service` 时：

- sidecar 会拉起 `ingress-replay-worker.mjs`
- replay service 会通过 sidecar operator API 轮询 queue 并执行自动重放
- service heartbeat 会写入 runtime 目录下的：
  - `external-ingress-replay-service-status.json`

当 `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE=standalone-service` 时：

- sidecar 不再托管 worker 子进程
- 外部 replay service 仍通过 sidecar operator API 轮询 queue 并执行自动重放
- service heartbeat 同样会写入：
  - `external-ingress-replay-service-status.json`

最小启动方式示例：

```bash
cd /home/aaa/personal-agent-desktop/pi-sidecar
PERSONAL_AGENT_RUNTIME_DIR=/path/to/runtime \
PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_ENABLED=1 \
PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE=standalone-service \
PERSONAL_AGENT_INGRESS_REPLAY_SERVICE_BASE_URL=http://127.0.0.1:8787 \
node ./src/runtime/ingress-replay-worker.mjs
```

background replay 当前支持两类 delivery policy：

- `fixed`：按 `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_DELAYS_MS` 使用固定 delay
- `exponential`：按 `INITIAL_DELAY_MS / MAX_DELAY_MS / MAX_ATTEMPTS / BACKOFF_MULTIPLIER` 计算指数退避

当前这个 dedicated replay service 仍然是最小实现：

- replay history 已进入 operator state 和前端 UI，但还没有单独的导出/检索面
- queue / route 的真实所有权仍保留在 sidecar，不是完全自持久化的独立服务

## Operator Surface

为了让失败投递不只停留在 dead-letter 文件里，sidecar 现在额外暴露最小 operator API：

- `POST /ingress/get-reply-routes`
- `POST /ingress/get-replay-queue`
- `POST /ingress/replay-queue/replay`
- `POST /ingress/replay-queue/resolve`
- `POST /ingress/background-replay/pause`
- `POST /ingress/background-replay/resume`

这些 endpoint 当前都是 sidecar operator surface，不经过前端 UI。

对应的扩展区 `IM Bridge` operator UI 和 `serviceConfig` surface，现在已补齐：

- `getIngressOperatorState`
- `replayIngressQueueEntry`
- `resolveIngressQueueEntry`
- `pauseIngressBackgroundReplay`
- `resumeIngressBackgroundReplay`

当前 pause / resume 约束：

- 只暂停 automatic replay，不影响 operator 手动 `replay / resolve`
- pause 状态跨 sidecar 重启保留
- dedicated / standalone replay worker 都会尊重这个 paused state

另外，Sunday 前端扩展区现在已经补了一层最小 operator UI，通过 `serviceConfig` 通道读取这些 sidecar 状态并执行人工动作：

- `getIngressOperatorState`
- `replayIngressQueueEntry`
- `resolveIngressQueueEntry`

这层 UI 当前放在 `扩展 -> IM Bridge`，职责保持很窄：

- 查看 reply routes
- 查看 replay queue
- 查看单条 queue entry 的 replay history timeline
- 查看当前 delivery policy / background replay 模式
- 对单条失败 delivery 执行 `立即重试 / 标记已处理 / 忽略`

前端 UI 不直接管理 runtime 文件，也不绕开 sidecar operator API。

### Reply routes

`POST /ingress/get-reply-routes`

返回当前按 `source + channelId + threadId` 持久化的 reply route。返回体里的 `replyTarget` 会做安全收口：

- 保留 `transport`
- 保留 `url`
- 保留 `hasSecret`
- 不直接暴露 secret 明文

### Replay queue

`POST /ingress/get-replay-queue`

请求体可选：

```json
{
  "includeResolved": true
}
```

返回：

- `counts`
- `entries`

其中每个 entry 当前会带：

- `id`
- `status`
- `transport`
- `routeKey`
- `conversationId`
- `sessionId`
- `requestExternalMessageId`
- `replyTarget`（已做 secret 脱敏）
- `payloadSummary`
- `attemptCount`
- `replayCount`
- `latestError`
- `createdAt / updatedAt / deliveredAt / resolvedAt`

### Replay one entry

`POST /ingress/replay-queue/replay`

```json
{
  "id": "<queue-entry-id>"
}
```

行为：

- 读取持久化 replay queue 中的完整 reply target 和 payload
- 使用当前 reply retry policy 再投递一次
- 成功后把 entry 标成 `delivered`
- 失败后继续保留为 `pending`

### Resolve one entry

`POST /ingress/replay-queue/resolve`

```json
{
  "id": "<queue-entry-id>",
  "resolution": "resolved"
}
```

当前支持：

- `resolved`
- `discarded`

resolve 后该 entry 会从默认 open queue 里消失，但在 `includeResolved=true` 时仍可查历史记录。

## Persistence

外部消息进入 sidecar 后会立即：

1. 写入 conversation repository
2. 保存 conversation 文件
3. 交给 agent session 继续处理

对于没有前端参与的 headless 场景，Sunday 也会在 session 完成后把 assistant reply 持久化回 conversation。
如果该 route 配置了 webhook reply target，Sunday 还会在 session 完成或失败后主动回推结果。

## Response

成功响应示例：

```json
{
  "ok": true,
  "conversationId": "ext-conv-im-demo-demo-room-thread-001",
  "sessionId": "ext-sess-im-demo-demo-room-thread-001",
  "externalMessageId": "ext-msg-123",
  "previousMessageId": "assistant-msg-previous",
  "routeKey": "im-demo:demo-room:thread-001",
  "threadId": "thread-001"
}
```

## Verification

真实 API verifier：

```bash
cd <repo-root>
npm run verify:ingress-api
```

这条 verifier 当前会额外验证：

- webhook reply push
- sidecar 重启后的 route reload
- follow-up 在不重复携带 `replyWebhookUrl` 时仍可回推

飞书 / Lark custom bot verifier：

```bash
cd <repo-root>
npm run verify:ingress-lark-api
```

这条 verifier 当前会验证：

- `lark-bot-webhook` / `feishu-bot-webhook` transport
- 自定义机器人 `timestamp + sign`
- 重试后成功投递
- 多次失败后的 dead-letter 落盘

background replay + Slack verifier：

```bash
cd <repo-root>
npm run verify:ingress-background-replay-api
```

这条 verifier 当前会验证：

- `slack-webhook` provider-specific adapter
- persisted replay queue
- sidecar 重启后的 background replay
- 自动重放成功后的 delivered 状态

Discord verifier：

```bash
cd <repo-root>
npm run verify:ingress-discord-api
```

这条 verifier 当前会验证：

- `discord-webhook` / `discord-incoming-webhook` transport
- provider payload 使用 `content`
- route store 中的 transport 归一化
- follow-up 不重复携带 webhook 仍可复用已持久化 route

Teams verifier：

```bash
cd <repo-root>
npm run verify:ingress-teams-api
```

这条 verifier 当前会验证：

- `teams-webhook` / `teams-incoming-webhook` transport
- provider payload 使用最小 `text` body
- route store 中的 transport 归一化
- follow-up 不重复携带 webhook 仍可复用已持久化 route

dedicated replay service verifier：

```bash
cd <repo-root>
npm run verify:ingress-dedicated-replay-service-api
```

这条 verifier 当前会验证：

- `PERSONAL_AGENT_INGRESS_BACKGROUND_REPLAY_MODE=service`
- operator state 暴露 dedicated replay service 状态
- replay worker PID 与 sidecar PID 分离
- 自动重放由独立 replay worker 驱动并更新 delivered 状态
- `external-ingress-replay-service-status.json` heartbeat 落盘

operator surface verifier：

```bash
cd <repo-root>
npm run verify:ingress-operator-api
```

这条 verifier 当前会验证：

- 失败 reply push 会进入持久化 replay queue
- replay queue 能跨 sidecar 重启保留
- operator replay 会重新投递并更新状态
- operator resolve 会把 entry 从 open queue 中移除

源码/文档 verifier：

```bash
cd <repo-root>
npm run verify:ingress-source
```
