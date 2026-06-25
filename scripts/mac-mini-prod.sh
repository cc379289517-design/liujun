#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
NODE_ENV="${NODE_ENV:-production}"
DATABASE_URL="${DATABASE_URL:-file:./prisma/dev.db}"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:${PORT}}"
LOG_DIR="${LOG_DIR:-${PROJECT_DIR}/logs}"
BACKUP_ON_START="${BACKUP_ON_START:-1}"

cd "${PROJECT_DIR}"
mkdir -p "${LOG_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SPAD production start"
echo "Project: ${PROJECT_DIR}"
echo "Bind: ${HOST}:${PORT}"
echo "Database: ${DATABASE_URL}"

if [ ! -d "node_modules" ]; then
  echo "node_modules 不存在，请先在项目目录运行 npm install。"
  exit 1
fi

if [ ! -f ".next/BUILD_ID" ]; then
  echo ".next/BUILD_ID 不存在，正在执行生产构建..."
  npm run build
fi

if [ "${BACKUP_ON_START}" = "1" ]; then
  ./scripts/backup-sqlite.sh
fi

export NODE_ENV
export DATABASE_URL
export NEXT_PUBLIC_APP_URL

exec npm run start -- -p "${PORT}" -H "${HOST}"
