#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env.local" ]] && { set -a; source "$ROOT/.env.local"; set +a; }
SP=4190
CP=8790
PLAT="${QT_QPA_PLATFORM:-${DISPLAY:+xcb}}"
PLAT="${PLAT:-offscreen}"
HOST="$(bash "$ROOT/scripts/resolve-host-bin.sh" personal-agent-host)"

nohup bash -c "
python3 -m http.server $SP --directory '$ROOT/web-client/dist' &
P1=\$!
( cd '$ROOT/pi-sidecar' && PERSONAL_AGENT_SIDECAR_PORT=$CP node ./src/dev-server.mjs ) &
P2=\$!
sleep 2
QT_QPA_PLATFORM='$PLAT' \
QTWEBENGINE_DISABLE_SANDBOX=1 \
QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu' \
PERSONAL_AGENT_AUTOSTART_SIDECAR=0 \
PERSONAL_AGENT_FRONT_URL='http://127.0.0.1:$SP/?disableResizeObservers=1#/' \
PERSONAL_AGENT_SIDECAR_URL='http://127.0.0.1:$CP' \
'$HOST' &
P3=\$!
wait \$P3
kill \$P1 \$P2 2>/dev/null
" &>/tmp/sunday-daemon.log &
echo "Sunday PID=$!  static:$SP  sidecar:$CP"
