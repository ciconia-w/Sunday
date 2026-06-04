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
- 当前还没有平台专属签名、重试队列或死信处理
- 更复杂的 IM 平台桥接应继续叠在这层 generic webhook adapter 之上

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

源码/文档 verifier：

```bash
cd <repo-root>
npm run verify:ingress-source
```
