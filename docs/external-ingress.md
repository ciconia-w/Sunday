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

## Persistence

外部消息进入 sidecar 后会立即：

1. 写入 conversation repository
2. 保存 conversation 文件
3. 交给 agent session 继续处理

对于没有前端参与的 headless 场景，Sunday 也会在 session 完成后把 assistant reply 持久化回 conversation。

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

源码/文档 verifier：

```bash
cd <repo-root>
npm run verify:ingress-source
```
