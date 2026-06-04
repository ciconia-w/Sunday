# Verification - 2026-06-03 Phase 0

## Goal

Complete the Phase 0 verification-baseline work for Sunday handoff:

1. Remove known false negatives from the current verifier set.
2. Add explicit verification for the browser section in settings.
3. Make the `typecheck:web` gate decision explicit.

## Changes

### 1. Tool file actions verifier

Updated [verify-host-qt-tool-file-actions.mjs](/home/aaa/personal-agent-desktop/scripts/verify-host-qt-tool-file-actions.mjs:36) so it no longer depends on raw tool event payloads appearing in host logs.

New assertion shape:

- `open-file` auto action clicked
- host received `openFile`
- `copy-path` auto action clicked
- live assistant reply reached first-text timing

This keeps the check tied to real UI behavior instead of a log format detail.

### 2. CLI tools verifier

Updated [verify-host-qt-cli-tools.mjs](/home/aaa/personal-agent-desktop/scripts/verify-host-qt-cli-tools.mjs:3) to match the current CLI status model instead of stale strings.

Current accepted markers now reflect:

- generic auth-needed state: `已安装，待授权`
- authorized prefix: `已授权，`
- OpenCLI available state: `可用`

### 3. Browser settings verifier

Added:

- [verify-host-qt-browser-settings.mjs](/home/aaa/personal-agent-desktop/scripts/verify-host-qt-browser-settings.mjs:1)
- query-param support in [verify-host-qt-workspace.mjs](/home/aaa/personal-agent-desktop/scripts/lib/verify-host-qt-workspace.mjs:20)
- section bootstrapping in [SettingsHomePage.tsx](/home/aaa/personal-agent-desktop/web-client/src/views/window/mainwindow/page/settings/home/SettingsHomePage.tsx:8)

This allows Qt-host verification to open `settingsHome` directly on the browser section through `settingsSection=browser`.

### 4. Typecheck gate decision

Decision:

- `npm run typecheck:web` is **not** a Phase 0 release gate.
- It is currently treated as a **known repo-wide debt signal**, not a reliable indicator of regression in the active MVP/browser paths.
- Phase 0 release confidence comes from:
  - build success
  - API verifiers
  - Qt-host verifiers
  - targeted bundle/UI verifiers

Reason:

- the current `vue-tsc --build` output contains a large volume of unrelated pre-existing errors across untouched legacy surfaces, so it cannot yet serve as a truthful gate for current handoff progress
- this should be revisited in Phase 1 either as:
  - debt burn-down to green, or
  - a new scoped typecheck gate for maintained paths

## Phase 0 Exit Criteria

Phase 0 is complete when:

1. `verify:mvp` no longer fails due to known verifier drift
2. browser settings have an explicit verifier
3. `host-qt-cli-tools` reflects the current CLI state model
4. the typecheck gate status is documented explicitly
