# Skills Source Of Truth

Sunday 当前会从这些位置加载技能：

1. 用户 skills 根目录：`~/.codex/skills`
2. 用户 skills 下的内置目录：`~/.codex/skills/.system`
3. 仓库内 skills 目录：`<repo>/skills`

加载行为说明：

- `~/.codex/skills/.system` 用于系统级内置能力。
- `~/.codex/skills` 用于用户本地安装、目录导入和仓库导入后的受管副本。
- `<repo>/skills` 用于项目自带的 skills。

导入行为说明：

- “导入技能” 会从本地目录复制 skill 到用户 skills 根目录。
- “GitHub 导入” 会先拉取仓库，再把解析到的 skill 目录复制到用户 skills 根目录。
- 删除动作只针对 Sunday 管理的用户本地副本，不会直接删除仓库自带 skills 或外部源目录。
