# Front-End Typecheck Triage

Date: 2026-06-03

## Command

```bash
cd /home/aaa/personal-agent-desktop
npm run typecheck:web
```

Current result:

- exit code: `2`
- error count: `183`

## Immediate Conclusion

`typecheck:web` is still a repo-wide debt signal, not a credible MVP release gate.

For the Phase 1 hardening work, the maintained/touched paths were re-checked after the latest edits. The current typecheck output no longer reports errors in:

- `src/views/window/RootWindow.tsx`
- `src/views/window/mainwindow/page/chat/components/welcomeComponents/GenericAssistant.tsx`
- `src/views/window/mainwindow/page/chat/ChatView.tsx`
- `src/views/window/mainwindow/page/automation/AutomationPage.tsx`
- `src/stores/reportchannel.ts`
- `src/stores/windowchannel.ts`
- `src/utils/themeAppearance.ts`
- `src/utils/debugLogging.ts`
- `src/configs/starterTasks.ts`

That is enough to treat the Phase 1 changes themselves as type-clean, while the repo-wide command remains red.

## Triage Buckets

### 1. Missing environment typings and root runtime shims

Representative files:

- `src/views/root/WebSocketChannel.tsx`
- `src/views/root/WebSocketTransport.tsx`
- `src/views/root/initializePiMode.ts`
- `src/views/root/prodmode.ts`
- `src/views/root/devfront.ts`
- `src/views/root/mockmode.ts`
- `src/common/svgBuilder.ts`

Observed themes:

- missing `qt` global typing
- missing `QWebChannel` declaration typing
- class fields/methods written in an untyped style
- missing Node typings for `fs`

Recommended handling:

- introduce explicit ambient declarations for Qt/QWebChannel
- decide whether the root websocket transport files are still active architecture or dead retention
- only then repair their local class typing

### 2. Store typing debt in shared runtime/state layers

Representative files:

- `src/stores/backend.ts`
- `src/stores/conversationmanager.ts`
- `src/stores/uploadfiles.ts`
- `src/stores/assistantinfos.ts`
- `src/stores/modelinfos.ts`

Observed themes:

- `unknown` results not narrowed
- implicit `any`
- incorrect record/index access
- store-returned object shapes drifting from actual record types

Recommended handling:

- normalize backend request return types first
- then repair downstream store assumptions
- do this as a dedicated store-typing pass, not mixed into feature work

### 3. Translation/data consistency issues

Representative file:

- `src/i18n/zhCN.ts`

Observed themes:

- duplicate object keys

Recommended handling:

- clean duplicate keys before further i18n expansion
- add a tiny static check for duplicate translation keys if the i18n surface keeps growing

### 4. Component prop/event typing drift

Representative files:

- `src/components/IconButton.tsx`
- `src/components/IconTextButton.tsx`
- `src/components/SvgIcon.tsx`
- `src/components/NewUserGuideDialog.tsx`
- `src/views/window/mainwindow/page/chat/components/McpServicesSelector.tsx`
- `src/views/window/mainwindow/page/chat/components/InputArea.tsx`
- `src/views/window/mainwindow/page/chat/components/commandCard/*`
- `src/views/window/mainwindow/page/chat/components/interactiveComp/*`

Observed themes:

- prop constructor casts that no longer satisfy stricter TS checks
- event prop casing mismatches
- verbatim-module-syntax type-only import issues

Recommended handling:

- repair the shared component typing layer before touching more downstream call sites

### 5. Rich chat surface typing debt

Representative files:

- `src/views/window/mainwindow/page/chat/components/Message.tsx`
- `src/views/window/mainwindow/page/chat/components/toolUse/ToolUse.tsx`
- `src/views/window/mainwindow/page/chat/components/docCard/DocCard.tsx`
- `src/views/window/mainwindow/page/chat/components/markdownEditor/*`
- `src/views/window/mainwindow/page/chat/config/inputAreaActions.ts`

Observed themes:

- instance properties used without being declared
- mixed-value unions not narrowed
- config types out of sync with current UI affordances

Recommended handling:

- repair by surface:
  1. `Message.tsx`
  2. `ToolUse.tsx`
  3. markdown/editor subtrees

## Suggested Next Gate

Until the repo-wide debt is reduced, use this rule:

- feature work must keep touched paths type-clean
- `verify:mvp` remains the authoritative MVP gate
- repo-wide `typecheck:web` remains a tracked debt bucket, not a release blocker
