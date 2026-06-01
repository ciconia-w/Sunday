#!/usr/bin/env bash
set -euo pipefail

HOST_BIN="/tmp/personal-agent-host-build/personal-agent-host"
FRONT_URL="${PERSONAL_AGENT_FRONT_URL:-http://127.0.0.1:4174/#/?autoSend=qt-smoke-static}"
SIDECAR_URL="${PERSONAL_AGENT_SIDECAR_URL:-http://127.0.0.1:8787}"
SMOKE_EXIT_MS="${PERSONAL_AGENT_SMOKE_EXIT_MS:-5000}"

if [[ ! -x "$HOST_BIN" ]]; then
  echo "missing host binary: $HOST_BIN" >&2
  exit 1
fi

LOG_FILE="$(mktemp)"
trap 'rm -f "$LOG_FILE"' EXIT

QT_QPA_PLATFORM=offscreen \
QTWEBENGINE_DISABLE_SANDBOX=1 \
QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu" \
PERSONAL_AGENT_AUTOSTART_SIDECAR=0 \
PERSONAL_AGENT_FRONT_URL="$FRONT_URL" \
PERSONAL_AGENT_SIDECAR_URL="$SIDECAR_URL" \
PERSONAL_AGENT_SMOKE_EXIT_MS="$SMOKE_EXIT_MS" \
timeout 15s "$HOST_BIN" >"$LOG_FILE" 2>&1 || true

cat "$LOG_FILE"

if ! grep -q "\[host-qt web\] loadFinished true" "$LOG_FILE"; then
  echo "verdict=host-load-failed" >&2
  exit 1
fi

if grep -q "channel does not have method" "$LOG_FILE"; then
  echo "verdict=host-channel-gap" >&2
  exit 1
fi

echo "verdict=host-qt-smoke-confirmed"
