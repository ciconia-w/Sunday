# pi-sidecar

当前目录承载 `pi` 运行时桥接层。

## 当前状态

已具备：

- channel 契约定义
- 最小 signal 实现
- 浏览器侧 channel 组装器
- `PiSessionBridge` 真实会话桥
- 一个可运行的 HTTP runtime 入口：`src/dev-server.mjs`
- 运行时 provider/model bootstrap：`src/runtime/runtime-config.mjs`
- 真实 `pi SDK` 会话桥：`src/runtime/pi-session-bridge.mjs`
- model config API：读取/保存 `.env.local`
- skills / MCP / ingress 最小 sidecar API
- conversation / workspace 最小持久化

未具备：

- 宿主 preload / WebEngine 注入逻辑
- 审批回调的暂停 / 恢复机制
- 更完整的审批/权限控制

## 目标

当前目标不是做完整 sidecar 平台，而是先支撑 `PI Agent` 桌面 MVP：

1. 通用 agent 对话
2. tool call / `bash`
3. 本地文件最小读写操作
4. 模型配置最小闭环

## 下一步

1. 增加 `beforeToolCall` 审批占位
2. 继续扩完整文件变更审批体验
3. 再逐步扩 skills / MCP / ingress

## Local runtime config

当前 sidecar 支持以下环境变量：

- `PERSONAL_AGENT_PROVIDER`
- `PERSONAL_AGENT_MODEL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`

默认值：

- provider: `openai`
- model: `gpt-5.4-mini`

运行模式：

- `live`
  - 检测到当前 provider 对应的 API key
  - 真实调用 `pi` runtime
- `demo`
  - 未检测到 key
  - 仍通过统一远端 channel 路径返回演示事件
  - 明确提示当前不是 live 推理结果

示例：

```bash
export PERSONAL_AGENT_PROVIDER=openai
export PERSONAL_AGENT_MODEL=gpt-5.4-mini
export OPENAI_API_KEY=sk-...
node ./src/dev-server.mjs
```

如果没有 key，也可以直接启动：

```bash
node ./src/dev-server.mjs
```

此时会进入 `demo mode`，用于继续前端联调。
