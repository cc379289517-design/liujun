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
