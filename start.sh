#!/bin/bash

# 检查并启动 PostgreSQL
if ! brew services info postgresql@17 2>/dev/null | grep -q "running"; then
  echo "🐘 启动 PostgreSQL..."
  brew services start postgresql@17
  sleep 1
else
  echo "🐘 PostgreSQL 已在运行"
fi

# 检查数据库是否存在
if ! /opt/homebrew/opt/postgresql@17/bin/psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw spad; then
  echo "📦 创建数据库 spad..."
  /opt/homebrew/opt/postgresql@17/bin/createdb spad
  echo "📦 同步表结构..."
  npx prisma db push
  echo "🌱 填充初始数据..."
  npx prisma db seed
fi

# 启动开发服务器
echo "🚀 ��动开发服务器 http://localhost:3000"
npm run dev
