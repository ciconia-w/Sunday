#!/bin/sh
cd /home/aaa/personal-agent-desktop
DISPLAY="${DISPLAY:-:0}" nohup bash scripts/launch-desktop.sh >/dev/null 2>&1 &
