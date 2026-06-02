#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env.local" ]] && { set -a; source "$ROOT/.env.local"; set +a; }

pkill -f "personal-agent-host" 2>/dev/null; true
pkill -f "http.server 4174" 2>/dev/null; true
pkill -f "dev-server.mjs" 2>/dev/null; true
sleep 1

nohup python3 -m http.server 4174 --directory "$ROOT/web-client/dist" >/tmp/personal-agent-static.log 2>&1 &
nohup bash -lc "cd '$ROOT/pi-sidecar' && PERSONAL_AGENT_SIDECAR_PORT=8787 node ./src/dev-server.mjs" >/tmp/personal-agent-sidecar.log 2>&1 &
sleep 2

PLAT="${QT_QPA_PLATFORM:-${DISPLAY:+xcb}}"
if [[ -z "$PLAT" || "$PLAT" == *";"* ]]; then
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    PLAT="xcb"
  else
    PLAT="offscreen"
  fi
fi

PROFILE_DIR="$(mktemp -d /tmp/personal-agent-launch-XXXXXX)"
export XDG_CONFIG_HOME="$PROFILE_DIR/config"
export XDG_CACHE_HOME="$PROFILE_DIR/cache"
export XDG_DATA_HOME="$PROFILE_DIR/data"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"

nohup env DISPLAY="${DISPLAY:-:0}" QT_QPA_PLATFORM="$PLAT" QTWEBENGINE_DISABLE_SANDBOX=1 \
  QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu" \
  PERSONAL_AGENT_AUTOSTART_SIDECAR=0 \
  PERSONAL_AGENT_FRONT_URL="http://127.0.0.1:4174/?disableResizeObservers=1#/" \
  PERSONAL_AGENT_SIDECAR_URL="http://127.0.0.1:8787" \
  XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
  XDG_CACHE_HOME="$XDG_CACHE_HOME" \
  XDG_DATA_HOME="$XDG_DATA_HOME" \
  "$ROOT/.build/host-qt/personal-agent-host" >/tmp/sunday.log 2>&1 &
