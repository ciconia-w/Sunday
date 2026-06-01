# OpenCLI Browser

You have access to browser automation through OpenCLI. Use `opencli browser sunday <command>` for web tasks.

## Commands
- `opencli browser sunday open <url>` — Open URL
- `opencli browser sunday state` — Get page state (URL, title, interactive elements)
- `opencli browser sunday click [N]` — Click element by index
- `opencli browser sunday type [N] <text>` — Type text
- `opencli browser sunday fill [N] <text>` — Fill input exactly
- `opencli browser sunday screenshot [path]` — Screenshot
- `opencli browser sunday scroll <direction>` — Scroll
- `opencli browser sunday find <selector>` — Find elements
- `opencli browser sunday eval <js>` — Execute JavaScript
- `opencli browser sunday wait selector <css>` — Wait for selector
- `opencli browser sunday wait text <text>` — Wait for text
- `opencli browser sunday wait time <sec>` — Wait

## Rules
1. Always check `state` first to see page content
2. Use element indices [1] [2] from state output for click/type
3. Wait 2 seconds after `open` before interacting
4. Take screenshots to verify results
5. Session "sunday" is auto-started on Sunday launch
