#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

LOCAL_ENV_FILE="${PROJECT_DIR}/.mini-deploy.env"
if [ -f "${LOCAL_ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${LOCAL_ENV_FILE}"
  set +a
fi

BRANCH="${BRANCH:-$(git -C "${PROJECT_DIR}" branch --show-current)}"
REMOTE="${REMOTE:-origin}"
COMMIT_MESSAGE="${1:-${COMMIT_MESSAGE:-}}"
MINI_HOST="${MINI_HOST:-}"
MINI_USER="${MINI_USER:-}"
MINI_PROJECT_DIR="${MINI_PROJECT_DIR:-/Volumes/PortableSSD/liujun-portable/liujun}"
MINI_PORT="${MINI_PORT:-3000}"
MINI_HEALTH_PATH="${MINI_HEALTH_PATH:-/api/config}"
RUN_BUILD="${RUN_BUILD:-1}"
RUN_TYPECHECK="${RUN_TYPECHECK:-1}"
RUN_REMOTE_BUILD="${RUN_REMOTE_BUILD:-1}"
ALLOW_DB_COMMIT="${ALLOW_DB_COMMIT:-0}"
PRESERVE_REMOTE_DB="${PRESERVE_REMOTE_DB:-1}"
REMOTE_DIRTY_ACTION="${REMOTE_DIRTY_ACTION:-abort}"
SSH_OPTS="${SSH_OPTS:-}"

cd "${PROJECT_DIR}"

print_step() {
  printf "\n==> %s\n" "$1"
}

fail() {
  echo "错误：$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

remote_target() {
  if [ -n "${MINI_USER}" ]; then
    printf "%s@%s" "${MINI_USER}" "${MINI_HOST}"
  else
    printf "%s" "${MINI_HOST}"
  fi
}

require_cmd git
require_cmd ssh

[ -n "${BRANCH}" ] || fail "当前不在任何 git 分支，请先切换到目标分支。"
[ -n "${MINI_HOST}" ] || fail "请设置 MINI_HOST，例如：MINI_HOST=192.168.31.50"
[ -n "${COMMIT_MESSAGE}" ] || fail "请提供提交信息，例如：./scripts/release-to-mini.sh \"更新说明\""

print_step "检查数据库提交边界"
if [ "${ALLOW_DB_COMMIT}" != "1" ] && [ -n "$(git status --short -- prisma/dev.db)" ]; then
  cat >&2 <<'MSG'
检测到 prisma/dev.db 有本地改动。
为避免把本地开发数据库推送并覆盖 Mac mini 生产数据库，发布脚本默认停止。

如果这是明确需要同步的数据库变更，请设置：
  ALLOW_DB_COMMIT=1 ./scripts/release-to-mini.sh "提交信息"

否则请先处理或还原 prisma/dev.db 的本地改动，再重新发布。
MSG
  exit 1
fi

print_step "本地验证"
if [ "${RUN_TYPECHECK}" = "1" ]; then
  npx tsc --noEmit --pretty false
fi
if [ "${RUN_BUILD}" = "1" ]; then
  npm run build
fi

print_step "本地备份 SQLite"
./scripts/backup-sqlite.sh

print_step "创建 git 提交"
git add -A
git reset -q -- database-backups 2>/dev/null || true
if [ "${ALLOW_DB_COMMIT}" = "1" ]; then
  git add prisma/dev.db
else
  git reset -q -- prisma/dev.db 2>/dev/null || true
fi

if git diff --cached --quiet; then
  echo "没有需要提交的文件，跳过 commit。"
else
  git commit -m "${COMMIT_MESSAGE}"
fi

print_step "推送到远程"
git push "${REMOTE}" "HEAD:${BRANCH}"

TARGET="$(remote_target)"

print_step "同步并部署到 Mac mini：${TARGET}"
ssh ${SSH_OPTS} "${TARGET}" "bash -s" -- "${MINI_PROJECT_DIR}" "${BRANCH}" "${REMOTE}" "${RUN_REMOTE_BUILD}" "${PRESERVE_REMOTE_DB}" "${REMOTE_DIRTY_ACTION}" <<'REMOTE_SCRIPT'
set -euo pipefail

PROJECT_DIR="$1"
BRANCH="$2"
REMOTE="$3"
RUN_REMOTE_BUILD="$4"
PRESERVE_REMOTE_DB="$5"
REMOTE_DIRTY_ACTION="$6"

cd "${PROJECT_DIR}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

echo "Mac mini 项目目录：${PROJECT_DIR}"
echo "分支：${BRANCH}"
command -v npm >/dev/null 2>&1 || {
  echo "Mac mini 远程环境未找到 npm，请确认 Node.js 已安装并在 PATH 中。" >&2
  exit 127
}

PRESERVED_DB=""
if [ "${PRESERVE_REMOTE_DB}" = "1" ] && [ -f "prisma/dev.db" ]; then
  PRESERVED_DB="/tmp/spad-dev-db-preserve-$(date '+%Y%m%d-%H%M%S').db"
  cp "prisma/dev.db" "${PRESERVED_DB}"
  echo "已临时保护 Mac mini SQLite：${PRESERVED_DB}"
fi

if [ -n "$(git status --porcelain -- prisma/dev.db)" ]; then
  if [ -z "${PRESERVED_DB}" ]; then
    echo "Mac mini 上 prisma/dev.db 有改动，且未启用 PRESERVE_REMOTE_DB=1，停止部署。" >&2
    exit 1
  fi
  git checkout -- prisma/dev.db
fi

DIRTY_NON_DB="$(git status --porcelain -- . ':(exclude)prisma/dev.db' ':(exclude)database-backups' ':(exclude)logs' || true)"
if [ -n "${DIRTY_NON_DB}" ]; then
  if [ "${REMOTE_DIRTY_ACTION}" = "stash" ]; then
    git stash push -u -m "release-to-mini pre-deploy $(date '+%Y-%m-%d %H:%M:%S')" -- . ':(exclude)prisma/dev.db' ':(exclude)database-backups' ':(exclude)logs'
  else
    echo "Mac mini 工作区存在非数据库本地改动，停止部署：" >&2
    echo "${DIRTY_NON_DB}" >&2
    echo "确认可以暂存这些改动后，可设置 REMOTE_DIRTY_ACTION=stash 重试。" >&2
    exit 1
  fi
fi

git fetch "${REMOTE}" "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

if [ -n "${PRESERVED_DB}" ] && [ -f "${PRESERVED_DB}" ]; then
  cp "${PRESERVED_DB}" "prisma/dev.db"
  echo "已恢复 Mac mini 原 SQLite 数据库。"
fi

./scripts/backup-sqlite.sh
npm install

if [ "${RUN_REMOTE_BUILD}" = "1" ]; then
  npm run build
fi

PLIST="${HOME}/Library/LaunchAgents/com.spad.local.plist"
if [ -f "${PLIST}" ]; then
  launchctl unload "${PLIST}" >/dev/null 2>&1 || true
  launchctl load "${PLIST}"
else
  ./scripts/install-mac-mini-launchd.sh
fi

echo "Mac mini 部署完成。"
REMOTE_SCRIPT

print_step "健康检查"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 12 "http://${MINI_HOST}:${MINI_PORT}${MINI_HEALTH_PATH}" >/dev/null; then
    echo "健康检查通过：http://${MINI_HOST}:${MINI_PORT}${MINI_HEALTH_PATH}"
  else
    echo "健康检查未通过，请到 Mac mini 查看 logs/launchd.err.log。"
    exit 1
  fi
else
  echo "未找到 curl，跳过健康检查。"
fi

print_step "发布完成"
echo "访问地址：http://${MINI_HOST}:${MINI_PORT}/photographer"
