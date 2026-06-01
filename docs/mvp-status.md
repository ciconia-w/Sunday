# MVP Status

Date: 2026-05-27

## Product Positioning

`personal-agent-desktop` 当前的目标不是复刻旧产品矩阵，而是交付一个：

- `pi agent` 桌面客户端壳子
- 可承接后续扩展能力的桌面宿主

后续扩展方向包括：

- skills
- MCP
- IM bridge
- other extensions

## MVP Scope

当前 MVP 只要求覆盖这些核心能力：

1. Qt 桌面壳能起
2. 通用 `pi agent` 能运行
3. 能正常对话
4. 能展示和执行工具调用
5. 能 `bash`
6. 能对本地文件做最小增删改查

## Completed

### Generic agent shell

- Qt host 可加载静态前端
- sidecar 可跑真实 provider
- 默认通用助手已统一对外命名为 `PI Agent`

### Chat / tool call

- 真实 provider 对话链路已通
- Qt host 下 live chat 已验证
- tool call / `bash` 展示链路已通
- 默认欢迎页已收为更聚焦的 PI Agent 工作台入口：
  - 最近会话继续入口
  - starter task 预填充
  - runtime / tool readiness 状态面板
- 扩展区已升级为统一工作区：
  - 左侧主导航只保留一个 `扩展` 入口
  - 页内通过 `技能 / CLI / MCP` 三个标签切换
- tool 卡片直达动作已接通并完成运行时验证：
  - `Open file`
  - `Copy path`
  - `Copy command`
- generic agent runtime 已开放 `read / write / edit / bash / grep / find / ls`
- 真实 agent 文件 `create / update / read / delete` 生命周期验证已补齐
- 删除当前通过 `bash` 工具完成，未额外引入专门删除工具

### Model config

- 本地 `.env.local` 可提供默认 provider / model / key
- sidecar 支持多模型列表
- 当前模型切换已接通
- 切换后新会话会按当前模型运行
- 前端已补最小 `Model Settings` 页面
- `Add Model` 直达 `Model Settings`
- `Settings` 已升级为首页控制台 `Settings Home`
- `Settings Home` 当前已前置一批高频控制：
  - runtime diagnostics
  - quick runtime config
  - 统一扩展中心入口
- 关键 workspace 页面当前都支持直接作为启动目标页：
  - `extensions`
  - `settingsHome`
  - `modelSettings`
  - `skills`
  - `mcpServices`
- 页面可保存 provider / model / available models / api key
- 保存后会更新 `.env.local`

### Local file workflow

- file channel 最小协议已接通
- 通用 agent 真实文件生命周期已验证：
  - 创建
  - 修改
  - 读取校验
  - 删除
- Qt host 下文件最短前端闭环已验证：
  - 文件注入
  - 文件卡片出现
  - 解析完成
  - 删除文件卡片

### Early extension surfaces

- `skillsMgr` 最小 sidecar-backed inventory 已落地
- `MCP registry` 最小 sidecar-backed registry 已落地

## Deliberately Out of MVP

这些不是当前 MVP 主目标：

- 完整旧产品矩阵体验
- 写作/翻译/知识库产品矩阵
- 完整数字人体验
- 完整导出/打印能力
- 完整 skills / MCP / IM bridge 交互面

说明：

- 这并不意味着技能和 MCP 完全不存在
- 目前仅有**最小 registry / inventory 能力**，用于承接后续扩展平台工作
- 写作工作区等能力仍保留在仓库中，但当前只作为兼容/扩展能力，不继续作为默认产品面推进

## Remaining Gaps Before MVP Feels “Ready”

- 默认启动体验还可以继续收口
- 仍有少量 Qt 控制台噪声
- 文件链路已具备最短闭环，但体验还不够“产品化”

## Next Recommended Work

1. 收默认启动和对外文案
2. 清理高频噪声
3. 给出一版简洁的“可演示 MVP”说明
4. 然后再进入扩展平台方向：
   - skills
   - MCP
   - IM bridge
