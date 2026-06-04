# Sunday

`Sunday` 当前是一个 **通用智能体桌面客户端壳子 MVP**，目标是先把个人 agent 的桌面宿主跑通，再逐步整理为适合协同开发和后期开源的工程基线。

目标不是复刻旧产品矩阵，而是先交付一个可运行的通用 agent 桌面宿主，后续再承接：

- skills
- MCP
- IM bridge
- other extensions

## 当前 MVP 已覆盖

- Qt 桌面壳
- 通用 agent 对话
- tool call / `bash`
- 模型配置最小闭环
- 本地文件最小增删改查闭环
- 默认欢迎页上的近期会话继续入口

## 快速启动

前提：

- `web-client/dist` 已构建
- Qt host 已编译
- 配好 `.env.local`

建议先复制环境模板：

```bash
cp .env.example .env.local
```

建议构建命令：

```bash
npm run install:all
cd web-client && npm run build
cmake -S host-qt -B .build/host-qt
cmake --build .build/host-qt -j2
```

默认脚本会优先读取这些位置：

- `PERSONAL_AGENT_HOST_BIN`
- `PERSONAL_AGENT_HOST_BUILD_DIR`
- `.build/host-qt`

### 启动通用壳子

```bash
cd <repo-root>
npm run run:demo
```

### 直接看聊天

```bash
cd <repo-root>
npm run run:chat
```

### 直接拉起设置/扩展页

```bash
cd <repo-root>
npm run run:settings-home
```

也可以直接启动到扩展管理页：

```bash
cd <repo-root>
npm run run:extensions     # 统一扩展页 (技能 / CLI / MCP)
npm run run:model-settings # 模型设置
npm run run:settings-home  # 设置首页
```

## 一键验证当前 MVP

```bash
cd <repo-root>
npm run verify:mvp
```

这个验证会顺序覆盖：

1. 模型配置
2. 通用 agent 真实文件创建 / 修改 / 读取 / 删除
3. Qt host 下 live 对话
4. Qt host 下真实工具调用事件
5. file channel 协议
6. Qt host 下文件添加 / 解析 / 删除
7. 默认欢迎页下继续最近会话

## 模型配置

当前已支持一版最小运行时配置中心：

- 标题栏模型下拉里的 `Add Model`
- 标题栏菜单里的 `Settings`
- 默认欢迎页里的 `Settings`

其中：

- `Add Model` 仍会直达 `Model Settings`
- `Settings` 会先进入首页控制台 `Settings Home`
- `扩展` 现在是一个统一工作区，内部用 `技能 / CLI / MCP` 三个标签切换

`Settings Home` 当前已经可以直接完成一部分高频配置和管理动作：

- runtime diagnostics
- provider / default model / available models / api key 的 quick runtime config
- skills quick controls
- MCP quick controls

当前这些页面都已经支持直接作为启动目标页：

- `extensions`（统一扩展页，内部技能 / CLI / MCP 三标签）
- `settingsHome`
- `modelSettings`

完整配置仍可进入 `Model Settings` 页面，用于编辑：

- provider
- default model
- available models
- provider API key

保存后会更新本地 `.env.local`，并用于后续新建会话。

单独验证配置 API：

```bash
cd <repo-root>
npm run verify:model-config-api
```

## 进一步说明

- [MVP Status](./docs/mvp-status.md)
- [MVP Demo](./docs/mvp-demo.md)
- [Extension Surfaces](./docs/extension-surfaces.md)
- [External Ingress](./docs/external-ingress.md)
- [Host Contract](./docs/host-contract.md)
- [Phase 2 Verification](./docs/verification-20260526-phase2.md)

## 非主路径能力

当前仓库里仍保留了一些非 MVP 主路径能力，例如写作工作区：

```bash
cd <repo-root>
npm run run:writing
```

这些能力目前保留为后续扩展/兼容能力，不作为当前桌面壳默认产品面来推进。

## 协同开发基线

- 环境变量模板：`.env.example`
- 贡献规范：`CONTRIBUTING.md`
- 安全披露：`SECURITY.md`
- 行为准则：`CODE_OF_CONDUCT.md`
- 仓库自动检查：`.github/workflows/repo-checks.yml`

建议在 GitHub 仓库设置里同时开启：

- branch protection for `main`
- required pull request reviews
- required status checks
- secret scanning
- Dependabot alerts
