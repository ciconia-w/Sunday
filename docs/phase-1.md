# Phase 1

目标：

1. 复用 `uos-ai preview3 web`
2. 用 `initializePiMode` 替代 `prodmode`
3. 注入本地 JS channel 对象
4. 用 `pi` 驱动最小聊天链路

当前状态：

- `web-client` 已切换到 `initializePiMode`
- `pi-sidecar/src/bridge` 已导入 starter bridge
- `pi-sidecar/src/dev-server.mjs` 已作为最小 sidecar scaffold 入口落地

下一步：

1. 为 `pi-sidecar` 增加真实的 channel 注入脚本
2. 增加最小 assistant/model mock 数据
3. 让 `web-client` 开发模式下读取本地注入对象
4. 验证主页面能正常进入和完成 `send -> stream -> stop`

