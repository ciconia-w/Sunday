# Sunday Phase 2 Plan

## 已完成（Phase 1 / PR #1）

- [x] 通用 agent 对话 + 流式输出 + 工具调用
- [x] 文件 CRUD + bash 执行
- [x] 模型配置（provider/model/key）
- [x] 统一扩展页：技能 / CLI / MCP 三标签
- [x] CLI 内置 gh cli / opencli / lark cli + 授权
- [x] 侧边栏品牌区 + 折叠展开
- [x] 设置页 6 分类（通用/外观/扩展/浏览器/更新/关于）
- [x] OpenCLI 扩展源码打包 + 一键安装流程
- [x] Sunday + OpenCLI 双更新机制（启动 toast + 设置面板）
- [x] 桌面入口 + 守护启动脚本
- [x] 9 个核心 verifier 全部 confirmed

---

## Phase 2 规划

### 2.1 基础体验收口

| 任务 | 说明 |
|------|------|
| 默认欢迎页简化 | 去掉多余入口，只留"继续最近工作"+"发送消息" |
| Qt 控制台日志清理 | 消除剩余 `QWebEnginePage::InfoMessageLevel` 噪声 |
| 窗口管理 | 最小化到系统托盘、全局快捷键 |
| 启动速度优化 | 懒加载非首屏页面、sidecar 预热 |
| 首次使用引导 | 新用户引导弹窗（检测 opencli/Chrome/model 状态） |

### 2.2 浏览器自动化（OpenCLI 深度集成）

| 任务 | 说明 |
|------|------|
| 浏览器会话管理 UI | 侧边栏或扩展页新增"浏览器"面板，显示活跃 session、标签页列表 |
| 自动会话启动 | Sunday 启动时 `opencli browser sunday init`，agent 随时可用 |
| 一键安装自动化 | 用 `--load-extension` Chrome 启动参数跳过手动 chrome://extensions 步骤 |
| 浏览器工具注册 | sidecar 将 `opencli browser` 命令注册为 first-class tool，带参数 schema |
| 截图预览 | agent 截图后在聊天界面内嵌预览 |
| 网页提取 | `opencli browser extract` 结构化提取，agent 自动解析 |

### 2.3 技能系统完善

| 任务 | 说明 |
|------|------|
| 技能安装/导入 | 从本地文件导入 SKILL.md，从 GitHub 仓库拉取 |
| 技能市场 | 在线技能目录，一键安装（参考 opencli plugin install） |
| 技能运行时 | 技能在对话中自动激活，按需加载上下文 |
| 技能编辑器 | 内置简易 Markdown 编辑器，快速创建/修改技能 |

### 2.4 MCP 服务完善

| 任务 | 说明 |
|------|------|
| MCP 服务编辑 | 自定义服务增删改，JSON 配置编辑器 |
| MCP 服务状态 | 运行时状态指示（连接中/已连接/错误） |
| 服务发现 | 自动扫描本地 MCP 服务，一键注册 |
| 工具预览 | 列出每个 MCP 服务提供的工具清单 |

### 2.5 CLI 商店

| 任务 | 说明 |
|------|------|
| CLI 动态发现 | 自动扫描 PATH 中的 CLI 工具，不再硬编码 |
| CLI 商店 UI | 浏览/搜索/安装 CLI 工具，类似插件市场 |
| CLI 版本管理 | 显示已安装版本 vs 最新版本，一键更新 |
| CLI 授权流程 | 统一的 OAuth/Device Flow 授权体验 |

### 2.6 IM 桥接

| 任务 | 说明 |
|------|------|
| Sidecar 外部消息入站 API | 定义 IM → agent 的标准协议 |
| 消息路由 | 外部平台消息自动创建/路由到对应会话 |
| 通知推送 | agent 回复后推送回 IM 平台 |
| 首批接入 | 飞书（lark-cli 已有授权）、微信（需调研） |

### 2.7 架构优化

| 任务 | 说明 |
|------|------|
| 前端代码分包 | 非首屏页面改为 `defineAsyncComponent` 懒加载 |
| Sidecar 模块化 | 拆分 dev-server.mjs 为独立路由模块 |
| 错误处理 | 统一错误边界、降级提示、重试机制 |
| 日志系统 | 分级日志（debug/info/warn/error），按模块过滤 |
| 性能监控 | 消息延迟打点（send → first-text → done）、内存监控 |

---

## 执行顺序建议

```
Phase 2a (体验优先):
  2.1 欢迎页简化 → 窗口管理 → 启动速度 → 首次引导

Phase 2b (核心能力):
  2.2 浏览器自动化 → 2.6 IM 桥接

Phase 2c (扩展平台):
  2.3 技能系统 → 2.4 MCP 服务 → 2.5 CLI 商店

Phase 2d (工程基座):
  2.7 架构优化 → 日志系统 → 性能监控
```
