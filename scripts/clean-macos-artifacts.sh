#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPLY=0
INCLUDE_NEXT_CACHE=0
PRINT_ALL=0
PREVIEW_LIMIT="${PREVIEW_LIMIT:-100}"

usage() {
  cat <<'USAGE'
用法：
  ./scripts/clean-macos-artifacts.sh [--dry-run] [--apply] [--include-next-cache] [--all]

默认只预览将清理的 macOS 伴生文件，不会删除。

范围：
  - 删除文件名为 ._* 的 macOS AppleDouble 伴生文件
  - 可选删除 .next/cache 与 .next/dev/cache 这类构建缓存
  - 永不删除 prisma/dev.db、database-backups、logs、public 上传资源或 .git
  - 默认最多展示前 100 条预览，设置 PREVIEW_LIMIT 或使用 --all 可调整
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      APPLY=0
      ;;
    --apply)
      APPLY=1
      ;;
    --include-next-cache)
      INCLUDE_NEXT_CACHE=1
      ;;
    --all)
      PRINT_ALL=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

cd "${PROJECT_DIR}"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/spad-macos-artifacts.XXXXXX")"
trap 'rm -f "${TMP_FILE}"' EXIT

echo "项目目录：${PROJECT_DIR}"
if [ "${APPLY}" = "1" ]; then
  echo "模式：实际删除"
else
  echo "模式：预览，不删除"
fi

find_companions() {
  find . \
    -path "./.git" -prune -o \
    -path "./database-backups" -prune -o \
    -path "./logs" -prune -o \
    -path "./public/uploads" -prune -o \
    -name "._*" -type f -print
}

find_companions > "${TMP_FILE}"
COMPANION_COUNT="$(wc -l < "${TMP_FILE}" | tr -d " ")"
echo "发现 macOS 伴生文件：${COMPANION_COUNT} 个"

if [ "${COMPANION_COUNT}" -gt 0 ]; then
  if [ "${PRINT_ALL}" = "1" ]; then
    cat "${TMP_FILE}"
  else
    sed -n "1,${PREVIEW_LIMIT}p" "${TMP_FILE}"
    if [ "${COMPANION_COUNT}" -gt "${PREVIEW_LIMIT}" ]; then
      echo "... 还有 $((COMPANION_COUNT - PREVIEW_LIMIT)) 个未展示；使用 --all 查看全部。"
    fi
  fi
fi

if [ "${APPLY}" = "1" ] && [ "${COMPANION_COUNT}" -gt 0 ]; then
  while IFS= read -r file_path; do
    [ -n "${file_path}" ] || continue
    rm -f "${file_path}"
  done < "${TMP_FILE}"
  echo "已删除 macOS 伴生文件。"
fi

if [ "${INCLUDE_NEXT_CACHE}" = "1" ]; then
  CACHE_TARGETS=()
  [ -d ".next/cache" ] && CACHE_TARGETS+=(".next/cache")
  [ -d ".next/dev/cache" ] && CACHE_TARGETS+=(".next/dev/cache")

  echo "发现 Next 缓存目录：${#CACHE_TARGETS[@]} 个"
  if [ "${#CACHE_TARGETS[@]}" -gt 0 ]; then
    printf "%s\n" "${CACHE_TARGETS[@]}"
  fi

  if [ "${APPLY}" = "1" ] && [ "${#CACHE_TARGETS[@]}" -gt 0 ]; then
    rm -rf "${CACHE_TARGETS[@]}"
    echo "已删除 Next 缓存目录。"
  fi
fi

echo "完成。"
