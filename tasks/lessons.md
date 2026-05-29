# Lessons

- Prisma schema 新增字段并 `prisma generate` 后，本地 Next dev server 可能仍持有旧客户端；涉及新增 Prisma 字段的 API 回归前需要重启 dev server。
- 区分“待就位让行”和“执行中插单”：前者是队列重排，不应复用任务类型可插单限制；后者才需要严格按后台可插单、30分钟内不可插单和最大离场时间配置执行。
