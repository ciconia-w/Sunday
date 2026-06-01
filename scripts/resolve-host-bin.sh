#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_BUILD_DIR="${PERSONAL_AGENT_HOST_BUILD_DIR:-$ROOT_DIR/.build/host-qt}"

case "${1:-personal-agent-host}" in
  personal-agent-host)
    HOST_BIN="${PERSONAL_AGENT_HOST_BIN:-$HOST_BUILD_DIR/personal-agent-host}"
    ;;
  personal-agent-filechannel-smoke)
    HOST_BIN="${PERSONAL_AGENT_FILECHANNEL_SMOKE_BIN:-$HOST_BUILD_DIR/personal-agent-filechannel-smoke}"
    ;;
  personal-agent-systemchannel-smoke)
    HOST_BIN="${PERSONAL_AGENT_SYSTEMCHANNEL_SMOKE_BIN:-$HOST_BUILD_DIR/personal-agent-systemchannel-smoke}"
    ;;
  *)
    echo "unknown host binary key: ${1:-}" >&2
    exit 1
    ;;
esac

if [[ ! -x "$HOST_BIN" ]]; then
  echo "missing host binary: $HOST_BIN" >&2
  echo "build it first: cmake -S $ROOT_DIR/host-qt -B $ROOT_DIR/.build/host-qt && cmake --build $ROOT_DIR/.build/host-qt -j2" >&2
  exit 1
fi

printf '%s\n' "$HOST_BIN"
