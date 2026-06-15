#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

PORT=3001
URL="http://localhost:${PORT}/photographer"
LOG_FILE="${TMPDIR:-/tmp}/liujun-next-${PORT}.log"

is_port_ready() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

is_page_ready() {
  curl -fsS "${URL}" >/dev/null 2>&1
}

echo "固定打开地址：${URL}"

if is_port_ready; then
  echo "开发服务已在 ${PORT} 端口运行。"
else
  echo "开发服务未运行，正在启动 ${PORT} 端口..."
  echo "日志文件：${LOG_FILE}"
  nohup npm run dev -- -p "${PORT}" >"${LOG_FILE}" 2>&1 &
fi

echo "等待项目可访问..."
for _ in {1..90}; do
  if is_page_ready; then
    echo "项目已启动，正在打开..."
    open "${URL}"
    exit 0
  fi
  sleep 1
done

echo "项目启动超时，请查看日志：${LOG_FILE}"
open "${LOG_FILE}"
exit 1
