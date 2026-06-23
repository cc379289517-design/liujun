#!/bin/bash
set -euo pipefail

LABEL="com.spad.local"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"

echo "已卸载 launchd：${LABEL}"
