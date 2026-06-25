#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.spad.local"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
NODE_PATH="$(command -v node || true)"
NPM_PATH="$(command -v npm || true)"
PATH_VALUE="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ -z "${NODE_PATH}" ] || [ -z "${NPM_PATH}" ]; then
  echo "未找到 node/npm，请先安装 Node.js 并确认 npm 可用。"
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${PROJECT_DIR}/logs"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PROJECT_DIR}/scripts/mac-mini-prod.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH_VALUE}</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PORT</key>
    <string>3000</string>
    <key>HOST</key>
    <string>0.0.0.0</string>
    <key>DATABASE_URL</key>
    <string>file:./prisma/dev.db</string>
    <key>NEXT_PUBLIC_APP_URL</key>
    <string>http://localhost:3000</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/launchd.err.log</string>
</dict>
</plist>
PLIST

chmod +x "${PROJECT_DIR}/scripts/mac-mini-prod.sh" "${PROJECT_DIR}/scripts/backup-sqlite.sh"
launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"

echo "已安装并启动 launchd：${LABEL}"
echo "plist：${PLIST_PATH}"
echo "日志：${PROJECT_DIR}/logs/launchd.out.log / ${PROJECT_DIR}/logs/launchd.err.log"
echo "停止：launchctl unload ${PLIST_PATH}"
echo "重启：launchctl unload ${PLIST_PATH} && launchctl load ${PLIST_PATH}"
