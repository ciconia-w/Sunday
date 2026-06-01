#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
fi

WEB_DIST_DIR="$ROOT_DIR/web-client/dist"
HOST_BIN="/tmp/personal-agent-host-build/personal-agent-host"
STATIC_PORT="${PERSONAL_AGENT_STATIC_PORT:-4174}"
SIDECAR_PORT="${PERSONAL_AGENT_SIDECAR_PORT:-8787}"
PROVIDER="${PERSONAL_AGENT_PROVIDER:-deepseek}"
MODEL="${PERSONAL_AGENT_MODEL:-deepseek-v4-pro}"
STARTUP_ASSISTANT="${PERSONAL_AGENT_STARTUP_ASSISTANT:-}"
STARTUP_WORKSPACE="${PERSONAL_AGENT_STARTUP_WORKSPACE:-}"
AUTO_OPEN_RECENT_DOC="${PERSONAL_AGENT_AUTO_OPEN_RECENT_DOC:-0}"
AUTO_SEND="${PERSONAL_AGENT_AUTO_SEND:-}"
QT_PLATFORM_VALUE="${QT_QPA_PLATFORM:-}"

if [[ -z "$QT_PLATFORM_VALUE" ]]; then
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    QT_PLATFORM_VALUE="xcb"
  else
    QT_PLATFORM_VALUE="offscreen"
  fi
fi

if [[ ! -x "$HOST_BIN" ]]; then
  echo "missing host binary: $HOST_BIN" >&2
  echo "build it first: cmake --build /tmp/personal-agent-host-build -j2" >&2
  exit 1
fi

if [[ ! -f "$WEB_DIST_DIR/index.html" ]]; then
  echo "missing web dist: $WEB_DIST_DIR/index.html" >&2
  echo "build it first: cd $ROOT_DIR/web-client && npm run build" >&2
  exit 1
fi

if [[ "$PROVIDER" == "deepseek" && -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "DEEPSEEK_API_KEY is required for deepseek live demo" >&2
  exit 1
fi

STATIC_PID=""
SIDECAR_PID=""
PROFILE_DIR=""
cleanup() {
  if [[ -n "$STATIC_PID" ]]; then
    kill "$STATIC_PID" 2>/dev/null || true
  fi
  if [[ -n "$SIDECAR_PID" ]]; then
    kill "$SIDECAR_PID" 2>/dev/null || true
  fi
  if [[ -n "$PROFILE_DIR" ]]; then
    rm -rf "$PROFILE_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

lsof -iTCP:"$STATIC_PORT" -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true
lsof -iTCP:"$SIDECAR_PORT" -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true

python3 -m http.server "$STATIC_PORT" --directory "$WEB_DIST_DIR" >/tmp/personal-agent-static.log 2>&1 &
STATIC_PID=$!

(
  export PERSONAL_AGENT_PROVIDER="$PROVIDER"
  export PERSONAL_AGENT_MODEL="$MODEL"
  cd "$ROOT_DIR/pi-sidecar"
  node ./src/dev-server.mjs
) >/tmp/personal-agent-sidecar.log 2>&1 &
SIDECAR_PID=$!

sleep 1

PROFILE_DIR="$(mktemp -d /tmp/personal-agent-demo-XXXXXX)"
export XDG_CONFIG_HOME="$PROFILE_DIR/config"
export XDG_CACHE_HOME="$PROFILE_DIR/cache"
export XDG_DATA_HOME="$PROFILE_DIR/data"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"

FRONT_URL="http://127.0.0.1:${STATIC_PORT}/"
if [[ -n "$STARTUP_ASSISTANT" || -n "$STARTUP_WORKSPACE" || "$AUTO_OPEN_RECENT_DOC" == "1" || -n "$AUTO_SEND" ]]; then
  QUERY=()
  QUERY+=("disableResizeObservers=1")
  if [[ -n "$STARTUP_ASSISTANT" ]]; then
    QUERY+=("assistant=$STARTUP_ASSISTANT")
  fi
  if [[ -n "$STARTUP_WORKSPACE" ]]; then
    QUERY+=("workspace=$STARTUP_WORKSPACE")
  fi
  if [[ "$AUTO_OPEN_RECENT_DOC" == "1" ]]; then
    QUERY+=("autoOpenRecentDoc=1")
  fi
  if [[ -n "$AUTO_SEND" ]]; then
    QUERY+=("autoSend=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$AUTO_SEND")")
  fi
  FRONT_URL="${FRONT_URL}?$(IFS='&'; echo "${QUERY[*]}")#/"
else
  FRONT_URL="${FRONT_URL}?disableResizeObservers=1#/"
fi

echo "static web: http://127.0.0.1:${STATIC_PORT}"
echo "sidecar:    http://127.0.0.1:${SIDECAR_PORT}"
echo "front url:  ${FRONT_URL}"
echo "qt platform:${QT_PLATFORM_VALUE}"
echo "logs:       /tmp/personal-agent-static.log /tmp/personal-agent-sidecar.log"

QT_QPA_PLATFORM="${QT_PLATFORM_VALUE}" \
QTWEBENGINE_DISABLE_SANDBOX="${QTWEBENGINE_DISABLE_SANDBOX:-1}" \
QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:---no-sandbox --disable-gpu}" \
PERSONAL_AGENT_AUTOSTART_SIDECAR=0 \
PERSONAL_AGENT_FRONT_URL="${FRONT_URL}" \
PERSONAL_AGENT_SIDECAR_URL="http://127.0.0.1:${SIDECAR_PORT}" \
"$HOST_BIN"
