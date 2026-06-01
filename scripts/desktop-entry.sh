#!/bin/sh
cd /home/aaa/personal-agent-desktop
DISPLAY=:0 nohup bash scripts/run-demo.sh >/dev/null 2>&1 &
