#!/bin/bash
cd "$(dirname "$0")"

# 检查并启动 PostgreSQL
if ! brew services info postgresql@16 2>/dev/null | grep -q "running"; then
  echo "🐘 启动 PostgreSQL..."
  brew services start postgresql@16
  sleep 1
else
  echo "🐘 PostgreSQL 已在运行"
fi

# 检查数据库是否存在
if ! /opt/homebrew/opt/postgresql@16/bin/psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw spad; then
  echo "📦 创建数据库 spad..."
  /opt/homebrew/opt/postgresql@16/bin/createdb spad
  echo "📦 同步表结构..."
  npx prisma db push
  echo "🌱 填充初始数据..."
  npx prisma db seed
fi

# 生成 Prisma Client
echo "⚙️  生成 Prisma Client..."
npx prisma generate

# 安装依赖（如有更新）
echo "📦 检查依赖..."
npm install

# 清理旧缓存
echo "🧹 清理构建缓存..."
rm -rf .next

# 启动开发服务器
echo "🚀 启动开发服务器 http://localhost:3000"
npm run dev
