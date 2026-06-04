# Extension Surfaces

Date: 2026-05-26

## Purpose

This document defines how `personal-agent-desktop` should evolve from a verified MVP into an extension-friendly `pi agent` desktop shell.

The goal is **not** to keep growing product-specific features first.
The goal is to keep the shell stable and make later integrations predictable.

## Current Layering

```text
Qt Host
  ├─ window shell
  ├─ file/system/native actions
  ├─ webview + QWebChannel
  └─ local desktop integration

Pi Sidecar
  ├─ provider / model runtime
  ├─ session orchestration
  ├─ conversation / workspace persistence
  └─ future extension orchestration

Web Client
  ├─ chat / tool / file UI
  ├─ optional retained workspace UI
  ├─ minimal model config UI
  └─ future extension management UI
```

## Principle

Prefer this split:

- **Host** owns desktop-native capabilities
- **Sidecar** owns agent/runtime/integration orchestration
- **Web client** owns rendering and user workflows

Do not let product-specific UI assumptions define the extension model.

## Extension Categories

### 1. Skills

Best home:

- sidecar orchestration
- optional host bridge only when desktop-native capability is required

Current reusable surfaces:

- `skillsMgr` channel exists in the host contract
- `useSkillsStore` already consumes skill list / enable / delete flows

Current landed minimum:

- sidecar-backed skill inventory now exists
- host `SkillsChannel` can read/toggle/remove through sidecar

Current gaps:

- no add/install flow yet
- no richer skill metadata model yet
- no polished skill management UX yet

Recommended next step:

- keep enable / disable / remove minimal first
- add install/import only after the shell contract stays stable

### 2. MCP

Best home:

- sidecar orchestration
- web client for configuration

Current reusable surfaces:

- `serviceConfigObj.getMcpServices()`
- `useMcpServicesStore`
- current chat scene param plumbing already supports passing MCP selections

Current landed minimum:

- sidecar-backed MCP registry now exists
- host `ServiceConfigChannel` can read services / runtime-ready / agreement state through sidecar

Current gaps:

- no custom service editing flow yet
- no sidecar-backed save/delete/toggle lifecycle yet
- no richer runtime state beyond the minimal filesystem example

Recommended next step:

- keep host as thin transport adapter
- expand from read-only/minimal registry to editable registry only after the MVP shell remains stable

### 3. IM Bridge

Best home:

- sidecar

Reason:

- IM bridges are transport/integration problems, not UI problems
- they should map incoming messages/events into the same session/conversation protocol

Current reusable surfaces:

- `taskObj` can already act as a deferred prompt / external event ingress
- conversation/session APIs are stable enough for external message injection

Current state:

- canonical `/ingress/message` contract now exists in sidecar
- default routing is stable by `source + channelId + threadId`
- follow-up messages can auto-link to the current conversation tail even without a frontend participant
- headless ingress replies can now be persisted back into conversation history after session completion
- generic webhook reply push is now available above the ingress contract and can be reused across sidecar restarts
- first provider-specific adapter is now available via `lark-bot-webhook` / `feishu-bot-webhook`
- provider-specific webhook adapters now also cover `slack-webhook`, `dingtalk-bot-webhook`, `discord-webhook`, and `teams-webhook`
- reply delivery now has baseline retry + dead-letter handling in sidecar runtime state
- persisted replay queue and sidecar operator API now exist for failed reply delivery
- pending reply deliveries can now be retried by an in-process worker, a sidecar-managed dedicated replay service child process, or a standalone replay service process
- extension workspace now also has a minimal `IM Bridge` operator UI backed by `serviceConfig`
- operator governance now includes persisted pause/resume for automatic replay, and the pause state survives sidecar restarts
- replay queue entries now expose replay history in operator state and the `IM Bridge` UI
- replay queue ownership is now down in a shared runtime store, and dedicated / standalone workers read it directly
- operator state and `IM Bridge` UI now expose queue ownership, latest delivery receipt, and active processing claim

Current gaps:

- platform-specific bridge logic still needs to be layered on top of the generic ingress contract
- provider coverage is still narrow; broader platform coverage is still missing
- route persistence still lives in sidecar; only replay queue ownership has moved
- retry policy is richer but still intentionally minimal; platform-specific delivery receipts and finer governance are still missing

Recommended next step:

- keep `/ingress/message` as the canonical sidecar ingress contract
- keep generic webhook reply push as the first reusable transport adapter
- keep replay / resolve / route inspection authored in sidecar operator APIs, with the front-end UI staying as a thin operator surface
- add more provider-specific push/reply adapters above it
- use `taskObj` only if host-level delivery is required

### 4. Other Extensions

General rule:

- if it touches provider/tool/runtime/session state, put it in sidecar
- if it touches desktop-native behavior, put it in host
- if it only changes how users see/control the state, put it in web client

## Already Good Reusable Surfaces

These are worth preserving:

- `sessionObj`
- `assistantObj`
- `conversationObj`
- `fileObj`
- `skillsMgr`
- `serviceConfigObj`

Also already useful:

- model config flow
- file event protocol
- workspace persistence
- Qt host smoke scripts

## Surfaces That Are Still Too Stubby

These should be improved before heavy extension work:

- `fileObj` beyond the current shortest happy path
- any desktop-native notifications that future extensions rely on

## Recommended Order After MVP

1. Keep the generic shell stable
2. Sidecar-back skill inventory and toggles
3. Sidecar-back MCP service registry and config
4. Define external ingress for IM bridge
5. Only then add richer extension UI

## Non-Goals

Not recommended:

- cloning the earlier product structure feature-by-feature
- baking extension semantics directly into assistant-specific welcome pages
- moving runtime integration logic into the frontend
