# MVP Status

Date: 2026-06-03

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
- 默认通用助手当前已统一对外显示为 `Sunday`

### Chat / tool call

- 真实 provider 对话链路已通
- Qt host 下 live chat 已验证
- tool call / `bash` 展示链路已通
- 默认欢迎页已收为更聚焦的 Sunday 工作台入口：
  - 最近会话继续入口
  - starter task 预填充
  - 不再自动弹出 startup onboarding
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
  - model settings entry
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
- 附件区当前已补最小产品化状态：
  - ready / parsing / failed guidance
  - `Clear all` 批量动作
  - failed file retry / remove 动作与反馈
  - message-level attachment context

### Early extension surfaces

- `skillsMgr` 最小 sidecar-backed inventory 已落地
- `MCP registry` 最小 sidecar-backed registry 已落地
- `MCP services` 已具备自定义服务增删改开关的真实 sidecar CRUD 基线
- MCP 服务现在已补齐运行态产品面：
  - per-service `disabled / ready / connecting / error`
  - `refreshMcpRuntime`
  - tool preview
  - runtime detail / startup failure explanation
- CLI tools 现在已补齐更细的可操作状态面：
  - PATH 动态发现
  - 版本和安装路径展示
  - 登录 / 重新登录 / 安装 / 诊断动作入口
  - latest version 比对
  - 安装 / 更新 guidance（复制命令或打开文档）
  - CLI 列表不再把状态开关当成主操作按钮
- skills inventory 现在会过滤 frontmatter 噪声，展示更干净的描述，并把 source/path 作为可见上下文暴露在列表里
- skills 页面现在已补齐：
  - 本地目录导入
  - GitHub / git 仓库导入
  - 导入后复制到受管的 user skills root
  - 已导入 skill 的删除闭环
- skills 页面现在也提供明确的 source-of-truth 入口：
  - 可查看 system / user / repo 三层 skills 来源
  - 可直接打开来源说明文档、用户目录和仓库目录
- skills API verifier 现在会在临时 skills root 下验证导入/删除闭环，不会污染真实 `~/.codex/skills`
- `CLI tools` 已具备 sidecar 统一状态模型
- external ingress 现在已具备 canonical sidecar contract：
  - `POST /ingress/message`
  - `source + channelId + threadId` 的稳定 conversation / session 路由
  - headless ingress reply 的 conversation 持久化
  - generic webhook reply push
  - webhook route 的 sidecar runtime 持久化与重载
  - `lark-bot-webhook` / `feishu-bot-webhook` provider-specific reply adapter
  - `slack-webhook` provider-specific reply adapter
  - `discord-webhook` / `discord-incoming-webhook` provider-specific reply adapter
  - 最小 reply retry / dead-letter 落盘
  - persisted replay queue
  - `in-process` 与 `service` 两种 background replay 模式
  - dedicated replay service heartbeat/status 落盘：`external-ingress-replay-service-status.json`
  - sidecar operator API：
    - `get-reply-routes`
    - `get-replay-queue`
    - `replay-queue/replay`
    - `replay-queue/resolve`
  - 扩展区 `IM Bridge` operator UI：
    - reply route 列表
    - replay queue 列表
    - delivery policy / background replay 模式展示
    - `立即重试 / 标记已处理 / 忽略` 的人工操作
  - `serviceConfig` 已补齐 ingress operator surface：
    - `getIngressOperatorState`
    - `replayIngressQueueEntry`
    - `resolveIngressQueueEntry`
- `browser control` 已具备默认关闭、按需启用、按需注册工具的基础能力
- Qt host 的 `serviceConfig` 已补齐浏览器 / CLI / MCP 基本 runtime bridge
- 浏览器运行时能力画像已下沉到 sidecar：`stableTabSwitch`、`stableScreenshotCapture`、`runtimeLimitNotice`、`knownIssues` 由 `browser-control.mjs` 统一给出，前端不再直接写死 OpenCLI 版本判断
- 截图受限时的按钮标签、能力描述和后续引导现在也由 sidecar runtime profile 统一给出，浏览器设置页和浏览器面板不再各自拼接一套截图限制文案
- 浏览器设置页现在明确保留 guided install 路线：未连接时直接暴露扩展目录、复制路径、打开扩展页、刷新状态和安装步骤清单，不再只靠 toast
- 浏览器设置页现在有独立的 bundle verifier，可在不启动 Qt host 的情况下检查 install actions 和 runtime notice 是否进入产物
- sidecar 运行时画像现在也有独立的 source verifier，可在不启动 Qt host 的情况下检查能力字段和已知问题逻辑是否仍在 `browser-control.mjs`
- browser action bridge 现在也有独立的 source verifier，可在不启动 Qt host 的情况下检查 `dev-server -> serviceconfigchannel` 的结构化成功/失败结果仍然保留
- browser service-config 现在也有独立的 API verifier，可在不启动 Qt host 的情况下直接验证 `/service-config/browser-extract-page`、`/service-config/browser-capture-screenshot` 的结构化返回，并单次探测真实 `http/https` 页面下的 `reopen-url` fallback
- Sunday 通过 OpenCLI 执行 `browser open / tab new` 时，当前默认使用 `--window background`，避免验证和运行时动作抢占当前浏览器前台
- `verify:browser-service-config-api` 当前默认已经切到非打扰模式：不会主动打开真实测试页；如需验证真实 `http/https` fallback，可显式运行 `npm run verify:browser-service-config-api:real`
- tab select fallback 现在也有独立的逻辑 verifier，可在不打开真实网页的情况下验证 `http/https` 页面会走 reopen-url，而 `about:blank` 这类 scheme 不会误触 fallback
- 聊天里的 browser tool use 现在也有独立的 bundle verifier，可在不启动 Qt host 的情况下检查失败摘要和截图识别逻辑是否进入产物
- 浏览器面板现在也有独立的 bundle verifier，可在不启动 Qt host 的情况下检查 runtime notice、截图失败引导和结果区动作是否进入产物
- 浏览器非打扰默认策略现在也有独立的 source verifier，可检查后台窗口模式和真实 probe 的显式开关仍然保留
- `verify:mcp-api` 现在会真实拉起 stdio MCP 服务并校验 tool preview、错误命令失败态和 disable 后状态，不再只验证 CRUD
- `verify:cli-tools-api` 现在会验证 CLI detail/action metadata，不再只验证 `statusToken`
- `verify:skills-api` 现在会拒绝 frontmatter 噪声描述，确保 skills inventory 给到的是可读描述而不是 `---` 或 YAML 字段
- 浏览器设置页和浏览器面板现在都会直接展示运行时能力状态卡，显式标出“多标签切换 / 整页截图”当前是稳定还是受限
- `browser panel` 已具备真实交互验证链路：
  - init session
  - open example
  - new tab
  - fallback reopen-url
  - extract page
  - capture screenshot action
- 浏览器面板在未连接时现在会直接提供守护进程重启、扩展页打开、插件路径复制、设置页跳转和刷新状态动作；浏览器动作在未就绪前会禁用，避免无效点击
- 截图和提取失败现在会在浏览器面板里显式展示，不再静默吞掉；截图失败时会提示当前 OpenCLI 运行时限制
- 浏览器面板结果区现在提供 `打开输出目录`、`复制截图路径`、`复制提取内容` 等后续动作，截图请求也会显式传空输出路径，避免 Qt bridge 的隐式参数歧义
- `dev-server` 和 Qt `serviceConfigChannel` 现在都支持结构化 browser action 结果，截图失败不再只能依赖 HTTP 400 运输错误来传递详情
- sidecar 的 OpenCLI 错误输出现在会清洗 `UNDICI-EHPA` 这类运行时 warning，截图失败在 API 层已经能稳定拿到更干净的错误文本
- 截图失败现在除了原始错误文本，还会返回结构化的 `errorKind / errorHint`；当前 `OpenCLI v1.8.0` 的已知失败会被归类成 `runtime-typeerror`，浏览器面板可据此稳定显示降级提示
- 当运行时标记 `stableTabSwitch=false` 时，`selectBrowserTab` 现在会优先尝试对 `http/https` 标签页做 reopen-url fallback；对 `about:blank` 这类非网页 scheme 则保留原始 select 路径
- 聊天里的 `browser_*` tool use 现在也会区分失败摘要，`browser_screenshot` 成功时可直接识别并预览截图文件，不再只在面板里可见
- 聊天里的 `browser_screenshot` 失败现在也会通过 tool-use bridge 吃到 `errorHint`，摘要和展开详情不再只剩技术错误文本
- `host-qt-browser-panel` verifier 已补冷启动重试，不再把偶发 `loadFinished true` 空跑当成通过或失败依据

当前仍未收口的浏览器运行时缺口：

- 当前 OpenCLI 环境下真正的多 tab 切换还不能当成可靠能力；但 `reopen-url` fallback 已通过 sidecar-only verifier 在真实 `http/https` 页面下确认，不再只是纯逻辑推断
- 当前 OpenCLI `browser ... screenshot` 在 `v1.8.0` 下会抛运行时错误，Sunday 已能触发动作，但截图文件不能稳定生成

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

## MVP Closure Notes

- `npm run verify:mvp` 当前已可作为可信基线
- `host-qt-follow-up` 的附件消息隐藏 render error 已修复，并已纳入 `verify:mvp` gate
- `host-qt-browser-panel` 已从静态 bundle 检查升级为真实 Qt 面板交互 verifier
- 默认启动主路径当前明确为 Sunday 通用对话壳
- 高噪声前端 / host 启动日志已限制在 smoke 或显式调试场景
- `typecheck:web` 仍然不是 MVP release gate；它是仓库级历史债，需要按专题继续拆解

## Next Recommended Work

1. browser control productization:
    - 扩展安装路线
    - 真正的多标签切换能力
    - 成功截图产物与 OpenCLI 运行时缺口
    - 截图 / 提取结果展示继续打磨
2. MCP refinement:
    - runtime status
    - tool preview
    - clearer error feedback
3. skills / CLI productization:
   - CLI install / update 路线继续产品化
4. IM bridge refinement:
   - provider-specific ingress integration
   - 更多 provider-specific push/reply adapter
   - dedicated replay service 从 sidecar 子进程进一步演进到真正独立服务
5. 然后再进入更大的扩展平台方向：
   - extension install / market flows
   - architecture / performance cleanup
