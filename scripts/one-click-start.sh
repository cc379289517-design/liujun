#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
NEXT_HOST="${NEXT_HOST:-0.0.0.0}"
LOCAL_URL="http://localhost:${PORT}/photographer"
LOCAL_HEALTH_URL="http://localhost:${PORT}/api/config"
OPEN_BROWSER="${OPEN_BROWSER:-1}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

STATE_DIR="${TMPDIR:-/tmp}/liujun-one-click"
RUN_LOCK_DIR="${STATE_DIR}/launcher.lock"
RUN_LOCK_PID="${RUN_LOCK_DIR}/pid"
LOG_FILE="${STATE_DIR}/next-dev-${PORT}.log"
NEXT_LOCK="${PROJECT_DIR}/.next/dev/lock"

mkdir -p "${STATE_DIR}"
cd "${PROJECT_DIR}"

print_line() {
  printf "\n%s\n" "$1"
}

read_next_lock_value() {
  local key="$1"
  [ -f "${NEXT_LOCK}" ] || return 1
  node -e '
const fs = require("fs");
const path = process.argv[1];
const key = process.argv[2];
try {
  const value = JSON.parse(fs.readFileSync(path, "utf8"))[key];
  if (value !== undefined && value !== null) process.stdout.write(String(value));
} catch {}
' "${NEXT_LOCK}" "$key" 2>/dev/null || true
}

is_pid_alive() {
  local pid="$1"
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

listening_pids() {
  lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true
}

is_page_ready() {
  local url="${1:-${LOCAL_URL}}"
  curl -fsS --max-time 3 "${url}" >/dev/null 2>&1
}

open_project() {
  local url="${1:-${LOCAL_URL}}"
  if [ "${OPEN_BROWSER}" = "0" ]; then
    echo "已跳过自动打开浏览器：${url}"
    return 0
  fi
  if open -a "Google Chrome" "${url}" >/dev/null 2>&1; then
    return 0
  fi
  open "${url}"
}

cleanup_next_cache_artifacts() {
  if [ -d ".next" ]; then
    find ".next" -name '._*' -type f -delete 2>/dev/null || true
  fi
}

print_access_urls() {
  local url="${1:-${LOCAL_URL}}"
  local mobile_url=""
  echo "电脑访问：${url}"
  if [ -n "${LAN_IP}" ]; then
    mobile_url="${url/localhost/${LAN_IP}}"
    mobile_url="${mobile_url/127.0.0.1/${LAN_IP}}"
    echo "手机访问：${mobile_url}"
  else
    echo "手机访问：请确认电脑和手机在同一 Wi-Fi 后，用本机局域网 IP + :${PORT}/photographer"
  fi
}

explain_busy_port() {
  print_line "端口 ${PORT} 已被其他程序占用，但当前项目页面没有响应。"
  echo "为避免再次爆内存，启动器不会自动杀进程或另开多个服务。"
  echo "占用端口的进程："
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
  echo ""
  echo "建议：先关闭旧终端窗口，或在活动监视器里结束对应 Node/Next 进程，再重新双击启动。"
}

acquire_launcher_lock() {
  if mkdir "${RUN_LOCK_DIR}" 2>/dev/null; then
    echo "$$" > "${RUN_LOCK_PID}"
    return 0
  fi

  local existing_pid=""
  existing_pid="$(cat "${RUN_LOCK_PID}" 2>/dev/null || true)"
  if [ -n "${existing_pid}" ] && is_pid_alive "${existing_pid}"; then
    return 1
  fi

  rm -rf "${RUN_LOCK_DIR}"
  if mkdir "${RUN_LOCK_DIR}" 2>/dev/null; then
    echo "$$" > "${RUN_LOCK_PID}"
    return 0
  fi

  return 1
}

wait_for_ready() {
  local url="${1:-${LOCAL_URL}}"
  local health_url="${2:-${LOCAL_HEALTH_URL}}"
  local pid="${3:-}"
  print_line "等待项目启动完成..."
  for _ in {1..75}; do
    if [ -n "${pid}" ] && ! is_pid_alive "${pid}"; then
      print_line "开发服务进程已退出，没有继续重试。"
      echo "日志文件：${LOG_FILE}"
      tail -80 "${LOG_FILE}" 2>/dev/null || true
      open "${LOG_FILE}" >/dev/null 2>&1 || true
      return 1
    fi

    if is_page_ready "${health_url}"; then
      print_line "项目已启动，正在打开浏览器..."
      print_access_urls "${url}"
      open_project "${url}"
      return 0
    fi
    sleep 1
  done

  print_line "项目启动超时，没有继续重试。"
  echo "日志文件：${LOG_FILE}"
  tail -80 "${LOG_FILE}" 2>/dev/null || true
  open "${LOG_FILE}" >/dev/null 2>&1 || true
  return 1
}

start_dev_server() {
  print_line "正在启动项目..."
  print_access_urls
  echo "日志文件：${LOG_FILE}"
  echo "提示：关闭这个终端窗口，就会停止本地开发服务。"

  cleanup_next_cache_artifacts
  : > "${LOG_FILE}"

  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
  (
    for _ in {1..75}; do
      if is_page_ready "${LOCAL_HEALTH_URL}"; then
        print_line "项目已启动，正在打开浏览器..."
        print_access_urls "${LOCAL_URL}"
        open_project "${LOCAL_URL}"
        exit 0
      fi
      sleep 1
    done
    print_line "项目启动超时，请查看终端日志。"
  ) &

  npm run dev -- -p "${PORT}" -H "${NEXT_HOST}" 2>&1 | tee "${LOG_FILE}"
}

print_line "刘军摄影助理系统一键启动"
echo "项目目录：${PROJECT_DIR}"
print_access_urls

if ! acquire_launcher_lock; then
  print_line "已有一个启动器正在运行。"
  echo "我会打开当前项目地址，不再重复启动服务。"
  open_project
  exit 0
fi
trap 'rm -rf "${RUN_LOCK_DIR}" 2>/dev/null || true' EXIT INT TERM

if is_page_ready "${LOCAL_HEALTH_URL}"; then
  print_line "项目已经在运行，正在打开浏览器..."
  open_project "${LOCAL_URL}"
  exit 0
fi

LOCK_PID="$(read_next_lock_value pid || true)"
LOCK_PORT="$(read_next_lock_value port || true)"
LOCK_APP_URL="$(read_next_lock_value appUrl || true)"
if [ -n "${LOCK_PID}" ]; then
  if is_pid_alive "${LOCK_PID}"; then
    if [ -n "${LOCK_APP_URL}" ]; then
      LOCK_URL="${LOCK_APP_URL%/}/photographer"
      LOCK_HEALTH_URL="${LOCK_APP_URL%/}/api/config"
    elif [ -n "${LOCK_PORT}" ]; then
      LOCK_URL="http://localhost:${LOCK_PORT}/photographer"
      LOCK_HEALTH_URL="http://localhost:${LOCK_PORT}/api/config"
    else
      LOCK_URL="${LOCAL_URL}"
      LOCK_HEALTH_URL="${LOCAL_HEALTH_URL}"
    fi

    print_line "检测到当前项目已有 Next 服务，复用现有地址。"
    wait_for_ready "${LOCK_URL}" "${LOCK_HEALTH_URL}" "${LOCK_PID}"
    exit $?
  fi

  print_line "检测到上次异常退出留下的 Next lock，正在清理。"
  rm -f "${NEXT_LOCK}"
fi

PIDS="$(listening_pids)"
if [ -n "${PIDS}" ]; then
  explain_busy_port
  exit 1
fi

start_dev_server
