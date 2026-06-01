# MVP Demo

## What This Is

This is the current MVP of a **`pi agent` desktop client shell**.

It already supports:

- generic agent chat
- live provider runtime
- tool call / `bash` flow
- model switching
- minimal local file lifecycle workflow
- a settings-home control surface for runtime / extensions
- one unified extensions workspace with `技能 / CLI / MCP` tabs

It is **not** a full clone of the earlier product matrix.

## Fastest Ways To Look At It

### Generic chat path

```bash
export DEEPSEEK_API_KEY='...'
cd <repo-root>
npm run run:chat
```

Expected:

- Qt desktop shell opens
- a generic agent conversation is auto-started
- a real live response comes back

### Optional writing workspace path

这条路径当前仍可运行，但它不是当前 MVP 的主展示面。

```bash
export DEEPSEEK_API_KEY='...'
cd <repo-root>
npm run run:writing
```

Expected:

- Qt desktop shell opens
- app starts in the retained writing workspace context
- a recent document auto-opens
- the Markdown editor is mounted

## One-Command MVP Verification

```bash
cd <repo-root>
npm run verify:mvp
```

This verifies:

1. model configuration
2. real generic-agent file create / update / read / delete operations
3. Qt host live chat
4. Qt host live tool-call visibility
5. host file channel protocol
6. Qt host file add / parse / delete flow

## Known Non-Blocking Noise

- some Qt console noise still exists
- `QCoreApplication::postEvent: Unexpected null receiver`
- some secondary UI text still reflects earlier prototype history, but the main MVP path is already aligned to `PI Agent`

## Current Settings Surface

The shell no longer treats `Settings` as a simple redirect to one form page.

Current behavior:

- `Add Model` goes straight to `Model Settings`
- `Settings` opens `Settings Home`

`Settings Home` currently surfaces:

- runtime diagnostics
- quick runtime config
- unified extensions entry

These workspace pages can now be launched directly through the shell startup path:

- `extensions`
- `settingsHome`
- `modelSettings`
- `skills`
- `mcpServices`
