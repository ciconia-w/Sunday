# Verification - 2026-05-26 Phase 2

## Goal

验证 `personal-agent-desktop` 当前是否已经具备“`pi agent` 桌面客户端壳子”的关键能力：

1. sidecar 可跑真实 provider
2. Qt host 能加载静态前端
3. Qt host 下真实 agent 对话链路可用
4. tool call 事件能进入桌面前端
5. local file channel 最小协议可用
6. local file 最短前端闭环可用
7. workspace article / outline 最小持久化可用
8. 当前工作区链路可在 Qt host 中被真实消费

## Evidence

### Real provider runtime

使用临时环境变量启动 sidecar：

```bash
export DEEPSEEK_API_KEY=...
export PERSONAL_AGENT_PROVIDER=deepseek
export PERSONAL_AGENT_MODEL=deepseek-chat
cd /home/aaa/personal-agent-desktop/pi-sidecar
node ./src/dev-server.mjs
```

`/state` 返回包含：

```json
{
  "provider": "deepseek",
  "modelId": "deepseek-chat",
  "hasConfiguredKey": true,
  "mode": "live"
}
```

### Conversation API

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:conversation-api
```

结果：

- `verdict: conversation-api-confirmed`

### Workspace API

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:workspace-api
```

结果：

- `verdict: workspace-api-confirmed`

验证内容包括：

- `getWorkspaceArticle`
- `updateWorkspaceArticle`
- `getWorkspaceOutline`
- `updateWorkspaceOutline`
- `saveWorkspaceArticleToFile`

### Qt host static bundle bootstrap

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:host-qt-smoke
```

结果：

- `verdict=host-qt-smoke-confirmed`

证明：

- `loadFinished true`
- assistant/model/bootstrap 成功
- conversation indexes/history indexes 加载成功

### Qt host live chat

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:host-qt-live
```

结果：

- `verdict=host-qt-live-confirmed`

证明：

- Qt host 内部真实触发发送
- 收到 `Session event: 1`
- 收到多段 `Session event: 4`
- 收到 `Session event: 2`
- DeepSeek live 回复拼接后为 `qt-live-ok`

### Qt host system channel smoke

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:system-channel
```

结果：

- `verdict: system-channel-confirmed`

证明：

- `copyToClipboard` 可用
- `activeColor` / `fontInfo` / `themeColor` / `networkStatus` 可用

### Qt host file channel smoke

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:file-channel
```

结果：

- `verdict: file-channel-confirmed`

证明：

- `validateIncomingPaths` 可用
- `isFileExist` 可用
- `getFileIconBase64` 返回有效内容
- `processClipboardData` 可返回文本
- `handleDroppedFiles` 会发出 `FeFileReady`
- `parseFile` 会发出 `FeParseResult`

### Qt host file add/remove flow

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:host-qt-file-flow
```

结果：

- `verdict: host-qt-file-flow-confirmed`

证明：

- 文件可自动注入到前端上传区
- 文件卡片可进入已添加状态
- 解析完成状态可被前端识别
- 文件卡片可被前端删除

### Workspace doc open in Qt host

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:host-qt-doc-open
```

结果：

- `verdict=host-qt-doc-open-confirmed`

证明：

- 当前桌面壳可切到工作区入口
- workspace article 可从前端入口真实打开
- `MarkdownEditor` 成功挂载

### Workspace auto-save in Qt host

命令：

```bash
cd /home/aaa/personal-agent-desktop
npm run verify:host-qt-doc-save
```

结果：

- `verdict: host-qt-doc-save-confirmed`

证明：

- 工作区文档打开成功
- `MarkdownEditor` 自动追加测试内容
- auto-save 成功触发
- sidecar 回读 article 内容包含 `qt-save-ok`

## Current Assessment

当前工程已经从“技术预研骨架”推进为“可运行的 `pi agent` 桌面壳原型”：

- 对话主链路已可运行
- tool call 展示链路已可运行
- system channel 最小动作已可运行
- file channel 最小协议链路已可运行
- file 最短前端闭环已可运行
- workspace 最小链路已可运行
- Qt host 下已有多条端到端验证脚本

## Known Gaps

- Qt 控制台仍有 legacy fallback 噪声
- `QCoreApplication::postEvent: Unexpected null receiver` 仍待定位
- 导出/打印仍为最小实现
- generic local file CRUD 的更完整交互体验仍未补齐
- 当前 smoke 偏工程验证，还未完全收成最终演示路径
