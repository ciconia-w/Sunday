# OpenCLI Browser Integration + Settings Redesign + Update Mechanism

## Status: Design Phase

## 1. Settings Page Redesign (Reference: Codex)

### Current State
- `SettingsHomePage.tsx` uses custom CSS with left nav + right panel
- Separate `ModelSettingsPage.tsx` for model configuration
- Theme switching in settings page
- Scattered configuration across multiple pages

### Target State (Codex-style)
- Single settings page with sidebar navigation similar to Codex `SettingsLayout.tsx`:
  - Left sidebar: icon + label nav items (active highlight)
  - Right panel: section-specific content
- Nav categories:
  - 通用 (General): Runtime diagnostics + Model config
  - 外观 (Appearance): Theme switching
  - 扩展 (Extensions): Skills / CLI / MCP management
  - 浏览器 (Browser): OpenCLI status, extension install, session management
  - 更新 (Updates): Sunday version + OpenCLI version + update triggers
  - 关于 (About): App info

### Key UI Patterns from Codex
- `flex h-full flex-col` root layout
- `border-b` header bar with title + description
- `flex min-h-0 flex-1` body with `w-52` sidebar + `flex-1 overflow-auto` content
- `Button variant="ghost"` for nav items, `bg-accent` for active
- Section components loaded by tab

## 2. OpenCLI One-Click Extension Install

### Current State
- OpenCLI extension is manually installed as unpacked Chrome extension
- User needs to: download from GitHub → open chrome://extensions → enable dev mode → load unpacked
- Extension status: "connected" after manual setup

### Target: One-Click Install
```
Sunday CLI Tools → OpenCLI → "安装浏览器插件" button
```

Implementation approach:

1. **Package extension in Sunday repo** (`extensions/opencli-browser/`)
2. **Chrome --load-extension flag** on launch (for new profiles)
3. **shell-based install** for existing Chrome:
   ```bash
   # Check if extension is loaded
   curl -s http://localhost:19825/status | jq .extension
   # If not connected, guide user to:
   # 1. Open chrome://extensions
   # 2. Enable "Developer mode"
   # 3. Load unpacked from <Sunday dir>/extensions/opencli-browser
   ```

4. **Auto-detect + prompt**: Check extension status on CLI page load, show "安装" button if disconnected

### Extension Source
- OpenCLI Chrome extension is bundled in `@jackwener/opencli` npm package
- Extension manifest and background script live in the npm dist
- We can symlink/copy to a known path for easy loading

## 3. Sunday Update Mechanism

### Current State
- No update mechanism
- Version tracked only in `package.json` (name: "pi-agent-desktop-shell")
- Manual build + deploy

### Target: Auto-update
```
Settings → Updates → "检查更新" → Download → Apply
```

Implementation:

1. **Version file**: `.sunday-version` in project root containing `version=1.0.0`
2. **GitHub Releases check**:
   ```bash
   curl -s https://api.github.com/repos/ciconia-w/Sunday/releases/latest | jq -r .tag_name
   ```
3. **Update flow**:
   - On app launch or manual check: compare local version vs latest release
   - If newer available: show toast notification "Sunday 有新版本 vX.Y.Z"
   - Click toast → opens update dialog with changelog + "立即更新" button
   - "立即更新" → `git pull && npm run build --prefix web-client && cmake --build /tmp/personal-agent-host-build -j2`
   - Show progress, then prompt restart

4. **Force update**: 
   - `PERSONAL_AGENT_MIN_VERSION` env var
   - Frontend checks at startup: if current < min, show blocking update dialog

### Update Notification UI
- Non-blocking toast on launch: "Sunday v1.0.1 可用，点击查看更新"
- Settings → Updates section shows: current version, latest version, changelog, "检查更新"/"立即更新" buttons
- Update progress bar

## 4. OpenCLI Update Mechanism

### Current State
- `opencli daemon status` shows "Update available: v1.8.0 → v1.8.1"
- Manual: `npm install -g @jackwener/opencli`

### Target: Integrated Update
```
Settings → Updates → OpenCLI section → "更新 OpenCLI"
```

Implementation:

1. **Version check**: `opencli --version` or `opencli daemon status`
2. **Update command**: `npm install -g @jackwener/opencli`
3. **Extension update**: Download latest from GitHub releases
4. **UI integration**:
   - CLI tools page: show update badge on opencli card
   - Settings → Updates: OpenCLI version row with update button
   - Auto-check on app launch

### Combined Update Check
On Sunday launch:
1. Check Sunday version via GitHub API
2. Check opencli version via `opencli --version` vs npm registry
3. Show consolidated "N updates available" toast

## 5. Implementation Order

1. **Settings page redesign** (solo) — foundation for updates UI
2. **OpenCLI extension one-click install** (solo) — CLI page enhancement
3. **Sunday update check** (solo) — GitHub Releases integration
4. **OpenCLI update check** (solo) — npm registry integration  
5. **Combined update flow** (integration) — Settings → Updates section
