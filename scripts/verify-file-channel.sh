#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_BIN="$(bash "$ROOT_DIR/scripts/resolve-host-bin.sh" personal-agent-filechannel-smoke)"

QT_QPA_PLATFORM=offscreen \
QTWEBENGINE_DISABLE_SANDBOX=1 \
"$HOST_BIN"
