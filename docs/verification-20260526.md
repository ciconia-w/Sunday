# Verification - 2026-05-26

## Goal

验证 `personal-agent-desktop` 的 Phase 1 项目骨架是否已经具备可继续开发的基础：

1. 项目目录已建立
2. `uos-ai preview3 web` 已导入
3. 前端入口已切到 `initializePiMode`
4. 最小 mock channel 注入已存在
5. 前端可构建

## Evidence

### Project skeleton

- `personal-agent-desktop/README.md`
- `personal-agent-desktop/web-client`
- `personal-agent-desktop/pi-sidecar`
- `personal-agent-desktop/docs`

### Frontend entry switched

- `web-client/src/views/root/Root.vue`
- imports `./initializePiMode`

### Mock channel injection

- `web-client/src/dev-bootstrap.ts`
- `web-client/src/dev-injected-channels.ts`

### Sidecar bridge scaffold

- `pi-sidecar/src/bridge/channel-types.ts`
- `pi-sidecar/src/bridge/create-browser-channels.ts`
- `pi-sidecar/src/bridge/pi-session-bridge.ts`
- `pi-sidecar/src/runtime/channel-types.mjs`
- `pi-sidecar/src/runtime/signal.mjs`
- `pi-sidecar/src/runtime/pi-session-bridge.mjs`

### Build verification

Command:

```bash
cd /home/aaa/personal-agent-desktop/web-client
npm run build
```

Result:

- success
- output emitted to `web-client/dist`

### Real Pi SDK path verification

Command sequence:

```bash
cd /home/aaa/personal-agent-desktop/pi-sidecar
npm install --ignore-scripts
node ./src/dev-server.mjs
```

Then:

```bash
POST http://127.0.0.1:8787/session/send
```

Observed result:

- HTTP status: `500`
- Error body came from real `pi-coding-agent` runtime:

```text
No API key found for the selected model.
```

Interpretation:

- request no longer terminates inside the old mock path
- request already enters real `createAgentSession()` execution path
- current blocker is provider/model credential configuration, not bridge wiring

### Runtime bootstrap verification

Command:

```bash
GET http://127.0.0.1:8787/state
```

Observed result included:

```json
{
  "runtime": {
    "provider": "openai",
    "modelId": "gpt-5.4-mini",
    "hasConfiguredKey": false,
    "mode": "demo",
    "modeReason": "no API key found for provider openai"
  }
}
```

Interpretation:

- sidecar runtime bootstrap is active
- provider/model selection is no longer hard-coded mock-only state
- frontend can now read the current runtime bootstrap status

### Demo mode verification

Command:

```bash
POST http://127.0.0.1:8787/session/send
```

Observed result:

- HTTP status: `200`
- response: `{"ok":true}`

Interpretation:

- when provider credentials are missing, sidecar no longer fails hard by default
- the remote path stays usable for frontend development
- the response stream is now intentionally in `demo mode`, not mislabeled as live inference

### Frontend startup verification

Commands:

```bash
cd /home/aaa/personal-agent-desktop/web-client
npm run dev -- --host 127.0.0.1 --port 4173
```

Then:

```bash
chromium --headless --disable-gpu --virtual-time-budget=5000 --dump-dom http://127.0.0.1:4173
```

Observed result:

- page root mounted successfully
- final DOM contained:
  - `<html class="light" ...>`
  - runtime-initialized CSS vars such as `--system-active-color: #0081ff`
  - `<div id="app" data-v-app=""><div class="root-window">...`

Interpretation:

- the frontend no longer crashes on boot after the direct-channel changes
- remote bootstrap path is at least compatible with page initialization
- current remaining gap is not boot, but verifying that session events are rendered inside the app UI

### In-app debug instrumentation

Added:

- `src/stores/runtimeStatus.ts`
- `src/stores/debugEvents.ts`
- `src/components/RuntimeStatusBadge.tsx`
- `src/components/DebugSessionPanel.tsx`

Purpose:

- distinguish `remote-live`, `remote-demo`, and `local-mock`
- surface latest `sessionEvent` traffic in the page itself
- reduce ambiguity during Phase 1 frontend/sidecar integration

Build verification after adding the debug instrumentation:

```bash
cd /home/aaa/personal-agent-desktop/web-client
npm run build
```

Result:

- success
- debug instrumentation does not break the frontend build

### Same-origin dev proxy verification

`web-client/vite.config.ts` now proxies:

- `/runtime`
- `/state`
- `/events`
- `/session`

to local sidecar on `127.0.0.1:8787`.

Verified:

```bash
curl http://127.0.0.1:4173/runtime/channels.js
curl http://127.0.0.1:4173/state
```

Observed result:

- both endpoints returned `200`
- `/state` returned sidecar runtime info including:
  - `provider: openai`
  - `modelId: gpt-5.4-mini`
  - `mode: demo`

Interpretation:

- the browser-side bootstrap no longer depends on direct cross-origin calls to `127.0.0.1:8787`
- remaining uncertainty is now in page-side event/render observation, not in basic endpoint reachability

### Remote bootstrap hardening

`pi-sidecar/src/static/channels-runtime.js` was updated so that:

- remote channels are created even if `/state` fails
- `/state` now enriches remote state opportunistically instead of being a hard prerequisite

Interpretation:

- `remote channel script load` and `remote runtime state fetch` are no longer coupled
- frontend should no longer fall back to `local-mock` solely because `/state` failed
- the next reliable proof should come from page-side event receipt rather than headless full-DOM dumps

### Page-side remote demo verification

Verification script:

```bash
cd /home/aaa/personal-agent-desktop
node ./scripts/verify-remote-demo.mjs
```

Observed result included:

- `runtimeChannelSource: remote`
- `rootwindowMounted: true`
- `rootwindowWindowMode: 0`
- `mainwindowMounted: true`
- `chatviewMounted: true`
- `autoSendRequested: hello-from-cdp`
- `autoSendReady: true`
- `autoSendFired: true`
- `sessionEventCount: 2`
- `sessionLastEvent: 4`
- `sessionLastMessageType: text`

`bodyTextPreview` also contained:

- `REMOTE DEMO · openai/gpt-5.4-mini`
- `hello-from-cdp`
- `[demo mode] 当前未检测到 openai 的 API key。`

Interpretation:

- the frontend is no longer silently stuck before `MainWindow` / `ChatView`
- the remote sidecar path is now active in-page
- remote demo session events do reach the frontend state flow and visible UI
- Phase 1 has crossed from “remote bridge available” into “remote bridge visibly drives chat UI”

### Local mock approval card verification

Observed in page verification output:

- `sessionEventCount` increased beyond the initial text event
- `sessionLastMessageType` reached `interactive_components`
- page text preview contained:
  - `Awaiting Approval`
  - `Allow demo bash command?`
  - `echo "hello-from-cdp"`
  - option labels such as `Allow Once`, `Allow Chat`, `Skip`, `Submit`

Interpretation:

- the frontend approval card UI contract is now exercised by the stable `local-mock` path
- approval cards render in-page with the expected bash approval structure
- the initial approval UI is working in-page

### Local mock approval roundtrip verification

Observed in the latest verification output:

- `sessionEventCount: 7`
- `sessionLastEvent: 2`
- `sessionLastMessageType: text`
- page text preview contained:
  - `Awaiting Approval`
  - `Allow demo bash command?`
  - `mock_tool`
  - `Completed`
  - `审批已通过，继续执行：hello-from-cdp`

Console event flow also included:

- `Session event: 1` (started)
- `Session event: 4` with `interactive_components`
- `Session event: 4` with approved follow-up text
- `Session event: 2` (finished)

Interpretation:

- the stable `local-mock` path now supports a full demo approval roundtrip
- approve action changes the card state and allows the conversation to continue
- the demo flow now covers:
  - pending approval
  - approval action
  - follow-up tool/text output
  - finished event

### Current validation split

At this stage, two different facts are true and should not be conflated:

1. **Stable proof**
   - `local-mock` path supports:
     - chat send/receive
     - approval card rendering
     - approve action roundtrip
     - follow-up text
     - finished event

2. **In-progress hardening**
   - the `remote` path has previously shown successful in-page chat state,
     but current automated verification can still fall back during bootstrap/runtime script timing.
   - therefore, `remote approval roundtrip` should remain an explicit next verification task,
     not a claimed completed capability.

### Remote demo approval protocol status

The `pi-sidecar` demo mode now has an explicit approval protocol implementation:

- `send` emits:
  - `SeStarted`
  - a demo explanatory text chunk
  - a `bash_approve` `interactive_components` payload
- `invokeAction` handles:
  - approve / reject decision
  - approval card status update
  - follow-up text or error
  - final `SeFinished`

Interpretation:

- remote demo approval logic is implemented on the sidecar side
- current remaining work is browser-path stability and page-side verification,
  not missing protocol branches in the sidecar demo implementation

### Remote demo approval roundtrip verification

Latest verification output showed:

- `verdict: remote-path-confirmed`
- `runtimeChannelSource: remote`
- `chatviewMounted: true`
- `autoSendFired: true`
- `sessionEventCount: 7`
- `sessionLastEvent: 2`
- `sessionLastMessageType: text`

The page preview contained:

- `REMOTE DEMO · openai/gpt-5.4-mini`
- `Awaiting Approval`
- `Allow demo bash command?`
- `demo_runtime_notice`
- `你刚刚输入的是：hello-from-cdp`

Interpretation:

- the remote demo path now drives page chat state through the same approval roundtrip shape
- remote-side approval is no longer just a protocol hypothesis; it has page-level verification evidence
- Phase 1 now has:
  - stable local-mock approval roundtrip
  - verified remote-demo approval roundtrip

### Root cause findings during validation

Important blockers that were identified and fixed during Phase 1 verification:

1. `windowMode` mismatch
   - frontend expects `Main = 0`
   - earlier mock/remote channels returned `1`
   - this caused `MiniWindow` to render instead of `MainWindow`

2. channel contract mismatch
   - frontend `backend.request*()` expects Qt-style callback methods
   - earlier mock/remote channels returned Promise-only methods
   - this caused initialization to stall in multiple places

3. remote bootstrap over-coupling
   - remote channel creation previously hard-failed if `/state` failed
   - this caused fallback to `local-mock` even when the remote sidecar itself was reachable

These issues are now fixed in the current project state.

### Current remote bootstrap caveat

The remote sidecar path has been proven workable in-page earlier in this phase, but
subsequent automation runs still show intermittent fallback to `local-mock` caused by
the runtime script bootstrap path (`window.__createUosPiRemoteChannels` not becoming
available in time in some headless verification runs).

Interpretation:

- this is now an environment/boot stability issue around the remote runtime script path
- it is no longer a blocker for continuing frontend feature work
- local mock remains the stable fallback path for ongoing UI iteration
- the remote bootstrap instability should be tracked as a separate hardening task rather than blocking all product development

## Known gaps

1. `npm run type-check` still fails due to upstream `uos-ai preview3 web` strict TypeScript issues and a few local additions.
2. `PiSessionBridge` now reaches real `pi` runtime, but still only covers minimal event mapping and has placeholder approval behavior.
3. There is not yet a real host injector or preload path.
4. There is not yet a real Qt shell.
5. Current sidecar requires a usable provider/API key before real end-to-end chat can succeed.

## Conclusion

Phase 1 scaffold is valid and has crossed from pure mock mode into real `pi SDK` execution.

The next engineering priority should be:

1. provide a usable local provider/API key and verify real streamed text in `live` mode
2. switch from remote demo to remote live by providing a real provider key
3. approval gating
