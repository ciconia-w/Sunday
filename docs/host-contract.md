# Host Contract

Date: 2026-05-26

## Purpose

该文档定义 `personal-agent-desktop` 在 Phase 2 以后对原生桌面壳的最小能力边界。

目标：

1. 让 `web-client` 不直接依赖 Qt/DTK 细节
2. 让 `pi-sidecar` 不直接依赖桌面壳内部实现
3. 把 `V20 / V25` 差异收敛在 host 层，而不是散落到前端和 sidecar

## Layers

```text
Qt/DTK Host
  ├─ window / titlebar / sidebar persistence
  ├─ system integration
  ├─ file / screenshot / clipboard
  ├─ native notifications / app store / control center / dbus
  ├─ webview transport
  └─ sidecar lifecycle

Web Client
  ├─ chat UI
  ├─ settings UI
  ├─ skills / history / messages
  └─ host channel consumers

Pi Sidecar
  ├─ chat runtime
  ├─ demo/live mode
  ├─ approval broker
  └─ session protocol
```

## Contract Objects

Host must provide these channel groups:

- `windowObj`
- `systemObj`
- `fileObj`
- `taskObj`
- `sessionObj`
- `assistantObj`
- `conversationObj`
- `skillsMgr`
- `reportObj`
- `serviceConfigObj`
- `audioObj`

`sessionObj` / `assistantObj` / `conversationObj` / `skillsMgr` may be delegated to sidecar-backed adapters.

`windowObj` / `systemObj` / `fileObj` / `taskObj` / `audioObj` are expected to be primarily host-owned.

## Window Contract

Required methods:

- `windowMode`
- `switchMode`
- `minimize`
- `maximize`
- `restore`
- `close`
- `startMove`
- `systemMenu`
- `ensureMinimumWidth`
- `saveMainWindowSidebarState`
- `saveMainWindowSidebarGroupCollapsedStates`
- `getMainWindowSidebarState`
- `isMainWindowActive`
- `shouldShowNewUserGuideOnStartup`
- `recordNewUserGuideShown`
- `showConfig`
- `showHelpWindow`
- `showAboutWindow`
- `showUpdateLogWindow`

Required signals:

- `windowFontChanged`
- `windowStateChanged`
- `windowModeChanged`
- `windowShown`
- `windowAppendPrompt`
- `windowOverrideQuestion`
- `windowChangeToDigitalMode`
- `toastRequested`

## System Contract

Required properties/signals:

- `activeColor`
- `fontInfo`
- `themeColor`
- `networkStatus`
- `activeColorChanged`
- `networkChanged`
- `themeColorChanged`
- `themeIconChanged`
- `notificationActionInvoked`
- `appUpdateAvailable`

Required methods:

- `getIconBase64`
- `loadTranslations`
- `checkChineseLanguage`
- `isEnableAdvancedCssFeatures`
- `copyToClipboard`
- `openFile`
- `openUrl`
- `closeNotification`
- `checkAppUpdate`
- `markAppUpdateReminderConsumed`
- `themeColorOption`
- `switchThemeColor`
- `updateVolume`
- `updateBrightness`
- `updateFontSize`
- `toggleEyesProtection`
- `doBluetoothConfig`
- `doNoDisturb`
- `switchWifi`
- `openControlCenter`
- `openAppStore`
- `openAppStoreTab`
- `openCalendar`
- `saveImageAs`
- `getCurrentShortcut`
- `getCurrentTalkShortcut`

## File Contract

Required signals:

- `fileEvent`

Required methods:

- `validateIncomingPaths`
- `handleDroppedFiles`
- `handleCopiedFiles`
- `handleScreenshotFile`
- `parseFile`
- `removeFile`
- `isFileExist`
- `getFileIconBase64`
- `processClipboardData`
- `isEnableScreenshot`
- `startScreenshot`
- `selectFile`
- `setCurrentAssistantId`

## Task Contract

Required signals:

- `taskAdded`

Required methods:

- `onWindowCreated`

The host may use task channel for:

- deferred prompt injection
- deferred file injection
- external conversation switching
- shell-originated mode changes

## Audio Contract

Required signals:

- `audioEvent`

Required methods:

- `startRecorder`
- `stopRecorder`
- `playTextAudio`
- `stopPlayTextAudio`
- `getDeviceStatus`

## Session Contract

Owned by sidecar-backed runtime adapter.

Required signals:

- `sessionEvent`

Required methods:

- `sendMessage`
- `retry`
- `cancel`
- `invokeAction`

## Assistant Contract

Owned by sidecar-backed runtime adapter plus local config.

Required signals:

- `assistantChanged`
- `modelListChanged`

Required methods:

- `getAssistantList`
- `getAssistantOrder`
- `setAssistantOrder`
- `getAssistantVisibleCount`
- `setAssistantVisibleCount`
- `getModelList`
- `getCurrentModel`
- `setCurrentModel`
- `getRecentWritingDocs`
- `getWritingTemplates`
- `getTranslationFAQ`
- `getClawFAQ`
- `requestAddModel`
- `claimUsageRequest`

Current Phase 2 status:

- `AssistantChannel` still exposes retained workspace summaries for compatibility:
  - `getRecentWritingDocs`
  - `getWritingTemplates`
- Current data source:
  - `getRecentWritingDocs` is derived from `.pi-sidecar/workspace/*/*.article.json`
  - `getWritingTemplates` is currently a minimal built-in template list provided by sidecar

## Conversation Contract

Owned by sidecar-backed adapter plus local persistence layer.

Required signals:

- `changeToConversation`
- `indexSearchChanged`

Required methods:

- `getConversation`
- `deleteConversation`
- `releaseConversation`
- `saveConversation`
- `getConversationIndexes`
- `getHistoryConversationIndexes`
- `switchMessageNext`
- `searchConversations`
- `setConversationRender`
- `getWorkspaceOutline`
- `updateWorkspaceOutline`
- `printHTML`

Current Phase 2 status:

- `ConversationChannel` is now partially sidecar-backed.
- Implemented through sidecar endpoints:
  - `getConversation`
  - `deleteConversation`
  - `releaseConversation`
  - `saveConversation`
  - `getConversationIndexes`
  - `getHistoryConversationIndexes`
  - `switchMessageNext`
  - `searchConversations`
  - `setConversationRender`
  - `getWorkspaceArticle`
  - `updateWorkspaceArticle`
  - `getWorkspaceOutline`
  - `updateWorkspaceOutline`
  - `saveWorkspaceArticleToFile`
- Current persistence model:
  - sidecar stores conversation JSON files under `.pi-sidecar/conversations/`
  - sidecar stores workspace article / outline artifacts under `.pi-sidecar/workspace/`
  - outgoing user messages are captured from `sendMessage` / `retry`
  - assistant render payload is persisted from `setConversationRender`
  - `saveConversation` flushes the in-memory conversation snapshot to disk
- Current limitation:
- workspace/article/outline support is minimal and file-backed, retained mainly for compatibility rather than as the main MVP product surface
  - `printHTML` remains host-local placeholder

## Skills Contract

Required methods:

- `skillsData`
- `reloadSkills`
- `setSkillEnabled`
- `hasSkill`
- `addSkillForWeb`
- `removeSkill`

## Service Config Contract

Required signals:

- `knowledgeBaseChanged`
- `embeddingPluginsChanged`
- `mcpPluginChanged`

Required methods:

- `checkKnowledgeBase`
- `checkEmbeddingPlugins`
- `isMcpRuntimeReady`
- `getMcpThirdPartyAgreement`
- `setMcpThirdPartyAgreement`
- `getMcpServices`

## V20 / V25 Boundary

The host layer is where cross-version differences must be hidden.

### V20

- Qt5 / DTK5
- deb-first
- old D-Bus names:
  - `com.deepin.daemon.*`
  - `com.deepin.dde.*`

### V25

- Qt6 / DTK6
- linyaps-first
- new D-Bus names:
  - `org.deepin.dde.*1`
  - other deepin25-specific services

### Contract rule

`web-client` and `pi-sidecar` must never branch on:

- `com.deepin...` vs `org.deepin...1`
- Qt5 vs Qt6
- deb vs linyaps

Those differences belong only in the host implementation.

## Phase 2 Implementation Guidance

When the Qt/DTK shell starts:

1. Start or supervise `pi-sidecar`
2. Create host-owned channels:
   - `windowObj`
   - `systemObj`
   - `fileObj`
   - `taskObj`
   - `audioObj`
3. Bind sidecar-backed channels:
   - `sessionObj`
   - `assistantObj`
   - `conversationObj`
   - `skillsMgr`
   - `reportObj`
   - `serviceConfigObj`
4. Materialize all of them into the embedded web runtime

## Current Status

As of now:

- local mock path fully covers:
  - chat demo
  - approval demo
- remote demo path covers:
  - chat demo with page-level evidence
  - approval protocol implemented in sidecar
  - browser-path hardening still in progress

Therefore this document should be treated as the stable target contract for the next native-shell stage.

## Host Skeleton Status

A minimal `host-qt` skeleton now exists in this repository with:

- root `CMakeLists.txt`
- `main.cpp`
- `AppWindow`
- `HostContext`
- host-owned channel stubs for:
  - `window`
  - `system`
  - `file`
  - `task`
  - `audio`
  - startup-side sidecar-backed object names as minimal stubs:
    - `session`
    - `assistant`
    - `conversation`
    - `serviceConfig`
    - `skills`
    - `report`

This skeleton has passed a basic configuration check:

```bash
cmake -S host-qt -B .build/host-qt
```

The skeleton now also passes a compile step:

```bash
cmake --build .build/host-qt -j2
```

That means the project has now entered the “native-shell preparation” stage rather than staying purely in frontend demo mode.

## Shell Boot Status

At this point the native shell skeleton:

- knows the frontend-facing channel object names expected by startup
- registers them into `QWebChannel`
- compiles successfully as a single Qt/WebEngine executable

What it does **not** do yet:

- launch or supervise the real sidecar
- bridge sidecar-backed channels to runtime data
- provide platform-specific V20/V25 implementations
- prove an actual interactive window boot on this machine

## Sidecar Supervision Status

The native shell skeleton now also includes a minimal `SidecarSupervisor`:

- configure program / args / working directory
- start / stop process
- report running status and last error

This supervision layer is intentionally small and does **not** yet:

- auto-restart crashed sidecars
- parse sidecar stdout/stderr for health
- decide between demo/live modes
- bind sidecar-backed channel adapters into `QWebChannel`

The current purpose is only to establish a host-owned lifecycle boundary for the future real sidecar integration.

## Sidecar Client Status

The native shell skeleton now also includes a minimal `SidecarClient`:

- configure a base URL
- `GET /state`
- generic `POST` JSON helper

This client is intentionally minimal and currently exists to:

- establish the HTTP boundary between host and sidecar
- avoid hardcoding network access inside individual channel classes later
- provide the first reusable primitive for sidecar-backed channel adapters

It does **not** yet:

- subscribe to SSE/session events
- reconnect automatically
- map HTTP payloads into Qt channel objects
- replace any of the current startup-side stubs

## Sidecar Event Stream Status

The native shell skeleton now also includes a minimal `SidecarEventStream`:

- opens `/events`
- buffers server-sent event chunks
- extracts `event: session`
- emits a Qt signal with:
  - `event`
  - `sessionId`
  - `message`

Current limitation:

- the stream exists as a shell/runtime primitive
- it is not yet wired into `SessionChannel`
- therefore the host can now receive the event stream in principle, but the channel layer does not consume it yet

That limitation has now been partially lifted:

- `SessionChannel` can subscribe to `SidecarEventStream`
- the native shell now has both:
  - request path to the sidecar
  - event path from the sidecar

## Native Shell Smoke Status

The current `personal-agent-host` binary can now be launched against the frontend dev server with:

```bash
PERSONAL_AGENT_AUTOSTART_SIDECAR=0 .build/host-qt/personal-agent-host
```

A lightweight timeout-based smoke run showed:

- the Qt shell process starts
- the embedded frontend is loaded enough to produce browser-side console output
- the process does not fail immediately at shell/bootstrap level

Current remaining issue in the smoke:

- frontend runtime still throws page-side JavaScript errors during route/navigation execution

Interpretation:

- shell assembly is now far enough along that the next blockers are inside frontend/runtime behavior,
  not in the basic Qt shell startup path

## First Sidecar-backed Adapter

`AssistantChannel` is now the first host-side channel that reads live data from the sidecar-facing HTTP boundary:

- `getAssistantList()` reads `assistants` from `/state`
- `getModelList(assistantId)` reads `modelsByAssistant[assistantId]` from `/state`
- `getCurrentModel()` reads `currentModelId` from `/state`

This is intentionally narrow:

- it proves the adapter direction
- it keeps write operations and more complex synchronization out of the first cut
- it provides the template for future `session` / `conversation` / `serviceConfig` adapters

`SessionChannel` is now the second host-side adapter that uses the sidecar HTTP boundary:

- `sendMessage()` -> `POST /session/send`
- `retry()` -> `POST /session/retry`
- `cancel()` -> `POST /session/cancel`
- `invokeAction()` -> `POST /session/action`

Current limitation:

- this is request-only integration
- it does not yet subscribe to sidecar event streams
- therefore it is enough to establish the command path, but not yet enough to drive a live end-to-end Qt-hosted chat loop

That limitation has now been partially lifted:

- `SessionChannel` can subscribe to `SidecarEventStream`
- sidecar `sessionEvent` signals can now be forwarded through the native shell layer

Remaining limitation:

- the shell has not yet been exercised in a real running window against the live dev server
- higher-level conversation/history state is still not sidecar-backed on the Qt side
