#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Volumes/PortableSSD/liujun-portable/liujun"
cd "${PROJECT_DIR}"

echo "一键发布 / 同步到 Mac mini"
echo "项目目录：${PROJECT_DIR}"
echo

read -r -p "请输入本次更新说明，直接回车则使用默认说明：" COMMIT_MESSAGE

if [ -z "${COMMIT_MESSAGE}" ]; then
  COMMIT_MESSAGE="chore: release to mac mini $(date '+%Y-%m-%d %H:%M:%S')"
fi

echo
echo "即将发布：${COMMIT_MESSAGE}"
echo

./scripts/release-to-mini.sh "${COMMIT_MESSAGE}"

echo
echo "发布完成。"
read -r -p "按回车关闭窗口..."
