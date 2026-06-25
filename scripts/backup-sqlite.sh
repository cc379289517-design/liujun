#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${DB_PATH:-${PROJECT_DIR}/prisma/dev.db}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/database-backups}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/dev-${STAMP}.db"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DB_PATH}" ]; then
  echo "SQLite 数据库不存在，跳过备份：${DB_PATH}"
  exit 0
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"
else
  cp "${DB_PATH}" "${BACKUP_FILE}"
fi

gzip -f "${BACKUP_FILE}"
echo "已备份 SQLite：${BACKUP_FILE}.gz"
