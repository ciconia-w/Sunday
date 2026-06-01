#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_BIN="$(bash "$ROOT_DIR/scripts/resolve-host-bin.sh" personal-agent-host)"
STATIC_PORT="${PERSONAL_AGENT_STATIC_PORT:-4175}"
SIDECAR_PORT="${PERSONAL_AGENT_SIDECAR_PORT:-8788}"
FRONT_URL="${PERSONAL_AGENT_FRONT_URL:-http://127.0.0.1:${STATIC_PORT}/?assistant=uos-ai-writing&autoOpenRecentDoc=1#/}"
SIDECAR_URL="${PERSONAL_AGENT_SIDECAR_URL:-http://127.0.0.1:${SIDECAR_PORT}}"
SMOKE_EXIT_MS="${PERSONAL_AGENT_SMOKE_EXIT_MS:-12000}"
WEB_DIST_DIR="$ROOT_DIR/web-client/dist"

STATIC_PID=""
SIDECAR_PID=""
PROFILE_DIR=""
LOG_FILE=""

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
  if [[ -n "$LOG_FILE" ]]; then
    rm -f "$LOG_FILE" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local deadline=$((SECONDS + 15))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "timed out waiting for $url" >&2
      exit 1
    fi
    sleep 0.25
  done
}

if [[ ! -x "$HOST_BIN" ]]; then
  echo "missing host binary: $HOST_BIN" >&2
  exit 1
fi

if [[ ! -f "$WEB_DIST_DIR/index.html" ]]; then
  echo "missing web dist: $WEB_DIST_DIR/index.html" >&2
  echo "build it first: cd $ROOT_DIR/web-client && npm run build" >&2
  exit 1
fi

lsof -iTCP:"$STATIC_PORT" -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true
lsof -iTCP:"$SIDECAR_PORT" -sTCP:LISTEN -Pn 2>/dev/null | awk 'NR>1{print $2}' | xargs -r kill || true

python3 -m http.server "$STATIC_PORT" --directory "$WEB_DIST_DIR" >/tmp/personal-agent-verify-doc-open-static.log 2>&1 &
STATIC_PID=$!

(
  export PERSONAL_AGENT_PROVIDER="${PERSONAL_AGENT_PROVIDER:-deepseek}"
  export PERSONAL_AGENT_MODEL="${PERSONAL_AGENT_MODEL:-deepseek-v4-pro}"
  export PERSONAL_AGENT_SIDECAR_PORT="$SIDECAR_PORT"
  cd "$ROOT_DIR/pi-sidecar"
  node ./src/dev-server.mjs
) >/tmp/personal-agent-verify-doc-open-sidecar.log 2>&1 &
SIDECAR_PID=$!

wait_for_http "http://127.0.0.1:${STATIC_PORT}"
wait_for_http "${SIDECAR_URL}/state"

PROFILE_DIR="$(mktemp -d /tmp/personal-agent-verify-doc-open-XXXXXX)"
export XDG_CONFIG_HOME="$PROFILE_DIR/config"
export XDG_CACHE_HOME="$PROFILE_DIR/cache"
export XDG_DATA_HOME="$PROFILE_DIR/data"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"

LOG_FILE="$(mktemp)"

QT_QPA_PLATFORM=offscreen \
QTWEBENGINE_DISABLE_SANDBOX=1 \
QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu" \
PERSONAL_AGENT_AUTOSTART_SIDECAR=0 \
PERSONAL_AGENT_FRONT_URL="$FRONT_URL" \
PERSONAL_AGENT_SIDECAR_URL="$SIDECAR_URL" \
PERSONAL_AGENT_SMOKE_EXIT_MS="$SMOKE_EXIT_MS" \
timeout 20s "$HOST_BIN" >"$LOG_FILE" 2>&1 || true

cat "$LOG_FILE"

if ! grep -q "\[host-qt web\] loadFinished true" "$LOG_FILE"; then
  echo "verdict=host-load-failed" >&2
  exit 1
fi

if grep -q "channel does not have method" "$LOG_FILE"; then
  echo "verdict=host-channel-gap" >&2
  exit 1
fi

if grep -q "Failed to load article" "$LOG_FILE"; then
  echo "verdict=host-doc-open-failed" >&2
  exit 1
fi

if ! grep -q "\[WritingAssistant\] Opening recent doc:" "$LOG_FILE"; then
  echo "verdict=host-doc-open-trigger-missing" >&2
  exit 1
fi

if ! grep -q "\[MarkdownEditor\] mounted" "$LOG_FILE"; then
  echo "verdict=host-markdown-editor-mount-missing" >&2
  exit 1
fi

echo "verdict=host-qt-doc-open-confirmed"
