# Mac mini 固定访问部署方案

本方案用于园区内 Mac mini 单机长期运行 SPAD，电脑端和手机端通过固定地址访问。它不改变派单规则、业务逻辑和 UI，只处理生产启动、进程托管、日志、备份和访问入口。

## 当前项目现状

- 开发启动：`scripts/one-click-start.sh` 和 `npm run dev`，适合本地调试，不作为长期生产入口。
- 生产启动：`npm run build` 后使用 `npm run start -- -p 3000 -H 0.0.0.0`。
- 数据库：SQLite，本地文件为 `prisma/dev.db`，`.env` 中 `DATABASE_URL="file:./prisma/dev.db"`。
- 旧 `start.sh` 仍包含 PostgreSQL 启动假设，和当前 SQLite 配置不一致，不建议作为 Mac mini 固定部署入口。
- 真机开发访问：`next.config.ts` 已放开常见局域网网段的 `allowedDevOrigins`；生产 `next start` 不依赖该开发配置。

## 推荐方案

优先使用 macOS `launchd`：

- 开机登录后自动启动。
- 进程异常退出后自动重启。
- 不需要额外安装 PM2。
- 日志固定写入项目 `logs/` 目录。

PM2 作为备选：它的进程列表、日志命令更友好，但需要额外全局安装 Node 工具，用户换机器或 Node 版本变更时多一个维护点。当前 Mac mini 单机内网部署先不引入。

## 第一次部署

在 Mac mini 上进入项目目录：

```bash
cd /Volumes/PortableSSD/liujun-portable/liujun
npm install
npm run build
./scripts/install-mac-mini-launchd.sh
```

安装后访问：

- Mac mini 本机：`http://localhost:3000/photographer`
- 园区电脑/手机：`http://<Mac mini 固定局域网 IP>:3000/photographer`

建议在路由器里给 Mac mini 做 DHCP 地址绑定，例如固定为 `192.168.1.50`。这样手机端固定入口就是：

```text
http://192.168.1.50:3000/photographer
```

如果园区内有本地域名/DNS，也可以把 `spad.local` 或类似域名指向 Mac mini IP，形成：

```text
http://spad.local:3000/photographer
```

## 日常操作

查看服务：

```bash
launchctl list | grep com.spad.local
```

停止：

```bash
launchctl unload ~/Library/LaunchAgents/com.spad.local.plist
```

启动：

```bash
launchctl load ~/Library/LaunchAgents/com.spad.local.plist
```

重启：

```bash
launchctl unload ~/Library/LaunchAgents/com.spad.local.plist
launchctl load ~/Library/LaunchAgents/com.spad.local.plist
```

卸载开机自启：

```bash
./scripts/uninstall-mac-mini-launchd.sh
```

日志位置：

- 标准输出：`logs/launchd.out.log`
- 错误日志：`logs/launchd.err.log`
- 启动时 SQLite 备份：`database-backups/dev-YYYYMMDD-HHMMSS.db.gz`

## 更新发布流程

每次更新代码后：

```bash
cd /Volumes/PortableSSD/liujun-portable/liujun
npm install
npm run build
launchctl unload ~/Library/LaunchAgents/com.spad.local.plist
launchctl load ~/Library/LaunchAgents/com.spad.local.plist
```

发布前建议手动备份一次：

```bash
./scripts/backup-sqlite.sh
```

## 一键 commit + push + 同步部署

老王主控会话统一验收后，可以使用一键发布脚本把当前改动提交、推送并同步到 Mac mini：

```bash
MINI_HOST=192.168.1.50 \
MINI_USER=ljuuuu \
MINI_PROJECT_DIR=/Volumes/PortableSSD/liujun-portable/liujun \
./scripts/release-to-mini.sh "本次更新说明"
```

也可以在本机项目根目录创建 `.mini-deploy.env` 保存常用配置。该文件已加入 `.gitignore`，不会提交到远程仓库：

```bash
MINI_HOST=192.168.1.50
MINI_USER=ljuuuu
MINI_PROJECT_DIR=/Volumes/PortableSSD/liujun-portable/liujun
SSH_OPTS="-i /Users/你的用户名/.ssh/spad_release -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
PRESERVE_REMOTE_DB=1
REMOTE_DIRTY_ACTION=abort
```

配置好以后，日常只需要运行：

```bash
./scripts/release-to-mini.sh "本次更新说明"
```

参数说明：

- `MINI_HOST`：Mac mini 固定局域网 IP 或主机名，必填。
- `MINI_USER`：Mac mini SSH 用户名；如果本机 SSH 配置已包含用户名，可以不填。
- `MINI_PROJECT_DIR`：Mac mini 上项目目录，默认 `/Volumes/PortableSSD/liujun-portable/liujun`。
- `MINI_PORT`：健康检查端口，默认 `3000`。
- `RUN_TYPECHECK=0`：跳过本地 TypeScript 检查。
- `RUN_BUILD=0`：跳过本地生产构建。
- `RUN_REMOTE_BUILD=0`：跳过 Mac mini 上的生产构建。
- `SSH_OPTS`：SSH 私钥和连接参数，例如 `-i /Users/你的用户名/.ssh/spad_release`。
- `PRESERVE_REMOTE_DB=1`：默认保护 Mac mini 上的 SQLite，并在拉取代码后恢复。
- `REMOTE_DIRTY_ACTION=stash`：首次同步时如 Mac mini 上已有本地部署文件，可确认后暂存非数据库改动再拉取。

脚本会依次执行：

1. 检查 `prisma/dev.db` 是否有本地改动。
2. 本地运行 TypeScript 检查和生产构建。
3. 本地备份 SQLite。
4. `git add / commit / push`。
5. SSH 到 Mac mini 执行 `git pull --ff-only`。
6. 在 Mac mini 上备份 SQLite、安装依赖、生产构建。
7. 重启或安装 `launchd` 服务。
8. 检查 `http://<MINI_HOST>:3000/api/config`。

### 数据库保护

`release-to-mini.sh` 默认不会提交 `prisma/dev.db` 的本地改动，也不会提交 `database-backups/`。

如果检测到 `prisma/dev.db` 有改动，脚本会停止，避免把本地开发数据库推送并覆盖 Mac mini 生产数据库。只有明确需要同步数据库时，才使用：

```bash
ALLOW_DB_COMMIT=1 \
MINI_HOST=192.168.1.50 \
MINI_USER=ljuuuu \
./scripts/release-to-mini.sh "同步数据库和代码"
```

正式使用时更推荐：代码走 Git 同步，Mac mini 的生产 SQLite 留在 Mac mini 本机，通过 `database-backups/` 做备份和恢复。

首次从已有 Mac mini 项目切换到一键发布时，如果远程工作区已有本地部署脚本或文档改动，脚本会停止并提示。确认这些非数据库改动可以暂存后，再临时使用：

```bash
REMOTE_DIRTY_ACTION=stash ./scripts/release-to-mini.sh "首次同步部署脚本"
```

## SQLite 风险边界

当前不迁移 PostgreSQL。SQLite 在 Mac mini 单机试运行可以继续使用，但要遵守：

- 同一时间只运行一个生产服务实例，避免多个 Node 进程同时写同一个 `prisma/dev.db`。
- 不要同时打开多个旧开发服务器和生产服务器写同一个库。
- 每次服务启动会自动备份一次 SQLite；重大配置或人员调整前建议手动备份。
- 上百人长期同时写入、频繁发单/完成/转派时，SQLite 单写入机制可能出现写锁排队；这属于后续 PostgreSQL 迁移议题，不在本轮擅自推进。

## HTTPS 与 PWA 预留

手机可以先用固定内网 HTTP 地址访问。后续要把 PWA 当长期入口推广，需要满足：

- 稳定域名或内网 DNS 名称，不再依赖变化的 IP。
- HTTPS 证书或内网反向代理终止 TLS。
- `NEXT_PUBLIC_APP_URL` 改成最终固定地址。
- PWA manifest、service worker、图标和添加到主屏幕流程完成后，再通知员工统一添加。

内网临时 HTTP 链接适合试运行；正式 PWA/添加到主屏幕建议等 HTTPS 固定域名就绪。
