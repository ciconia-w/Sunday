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
- 当前 provider-specific transport 只落了飞书自定义机器人 webhook
- 更复杂的 IM 平台桥接应继续叠在 generic webhook / lark bot webhook 这层 adapter 之上

## Delivery Reliability

reply push 当前已经补了最小 delivery reliability：

- 默认最多投递 `3` 次
- 默认重试延迟：`1s`、`3s`
- 所有尝试都失败后，会写入 sidecar runtime 目录下的：
  - `external-ingress-dead-letters.json`

dead-letter 会记录：

- transport
- route key
- conversation / session
- 外部消息 id
- 尝试次数
- 每次失败时间和错误

当前还没有：

- 持久化重放队列
- 指数退避策略
- UI 管理面
- 平台专属回执确认

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

源码/文档 verifier：

```bash
cd <repo-root>
npm run verify:ingress-source
```
