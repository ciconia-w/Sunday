#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM_BIN="/home/aaa/.config/nvm/versions/node/v22.22.0/bin/npm"

if [[ ! -x "$NPM_BIN" ]]; then
  echo "missing npm binary: $NPM_BIN" >&2
  exit 1
fi

export LANG="${LANG:-zh_CN.UTF-8}"
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"

cd "$ROOT_DIR"

exec "$NPM_BIN" run run:demo
