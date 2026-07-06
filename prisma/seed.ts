import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ============================================
  // 1. 创建 5 个楼座
  // ============================================
  const buildings = await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      prisma.building.upsert({
        where: { id: i },
        update: {},
        create: { id: i, name: `${i}号楼` },
      })
    )
  );
  console.log(`✅ Created ${buildings.length} buildings`);

  // ============================================
  // 2. 每栋楼创建房间
  // ============================================
  const roomData: { buildingId: number; rooms: string[] }[] = [
    { buildingId: 1, rooms: ["101", "102", "103", "104", "105", "106"] },
    { buildingId: 2, rooms: ["201", "202", "203", "204", "205"] },
    { buildingId: 3, rooms: ["301", "302", "303", "304", "305", "306", "307"] },
    { buildingId: 4, rooms: ["401", "402", "403", "404"] },
    { buildingId: 5, rooms: ["501", "502", "503", "504", "505"] },
  ];

  let roomCount = 0;
  for (const { buildingId, rooms } of roomData) {
    for (const roomNumber of rooms) {
      await prisma.room.upsert({
        where: {
          buildingId_roomNumber: { buildingId, roomNumber },
        },
        update: {},
        create: {
          buildingId,
          roomNumber,
          floor: Math.floor(parseInt(roomNumber) / 100),
          xPosition: Math.random() * 100,
          yPosition: Math.random() * 100,
          fenceRadius: 5,
        },
      });
      roomCount++;
    }
  }
  console.log(`✅ Created ${roomCount} rooms`);

  // ============================================
  // 3. 创建任务类型
  // ============================================
  const categories = [
    { id: 1, name: "短时手持", description: "短暂手持1-10分钟内，紧急需立刻协助", priorityLevel: 1, minDuration: 1, maxDuration: 10, estDuration: 5, hexColor: "#ef4444", sortRank: 1 },
    { id: 2, name: "服装穿戴", description: "服装穿戴对角度10-20分钟，可能有身高要求", priorityLevel: 2, minDuration: 10, maxDuration: 20, estDuration: 15, hexColor: "#f97316", sortRank: 2 },
    { id: 3, name: "手工DIY协助", description: "需拍摄操作步骤图，需要即时", priorityLevel: 3, minDuration: 15, maxDuration: 30, estDuration: 20, hexColor: "#eab308", sortRank: 3 },
    { id: 4, name: "短时熨烫", description: "30分钟内的熨烫工作", priorityLevel: 3, minDuration: 10, maxDuration: 30, estDuration: 20, hexColor: "#f59e0b", sortRank: 4 },
    { id: 5, name: "长时熨烫", description: "超过30分钟的熨烫工作，可灵活暂停", priorityLevel: 4, minDuration: 30, maxDuration: 120, estDuration: 60, hexColor: "#3b82f6", sortRank: 5 },
    { id: 6, name: "手工DIY制作", description: "只需拍摄成品，不需要边拍边制作", priorityLevel: 4, minDuration: 30, maxDuration: 120, estDuration: 60, hexColor: "#6366f1", sortRank: 6 },
    { id: 7, name: "其他长时任务", description: "30分钟以上的其他任务", priorityLevel: 4, minDuration: 30, maxDuration: 180, estDuration: 60, hexColor: "#64748b", sortRank: 7 },
  ];

  for (const cat of categories) {
    await prisma.taskCategory.upsert({
      where: { id: cat.id },
      update: { hexColor: cat.hexColor, sortRank: cat.sortRank, estDuration: cat.estDuration },
      create: cat,
    });
  }
  console.log(`✅ Created ${categories.length} task categories`);

  // ============================================
  // 4. 系统配置
  // ============================================
  const configs = [
    { key: "ending_alert_min", value: "2", label: "快结束提醒(分钟)" },
    { key: "eating_overtime_alert_min", value: "30", label: "吃饭中超时提醒(分钟)" },
    { key: "eating_reentry_cooldown_min", value: "30", label: "吃饭再次切换冷却(分钟)" },
    { key: "interruption_max", value: "30", label: "插单最大离场时间(分钟)" },
    { key: "upgrade_threshold", value: "30", label: "自动提权阈值(分钟)" },
    { key: "priority_upgrade_request_enabled", value: "true", label: "人工提权申请开关" },
    { key: "priority_upgrade_request_min_priority", value: "3", label: "人工提权申请开放优先级(P3以上默认)" },
    { key: "priority_upgrade_request_building_ids", value: "", label: "人工提权申请开放楼座ID(空为全部)" },
    { key: "ironing_prep_window_min", value: "5", label: "熨烫机准备窗口(分钟)" },
    { key: "ironing_confirm_timeout_sec", value: "60", label: "熨烫机空出确认倒计时(秒)" },
    { key: "ironing_machine_claim_ttl_min", value: "2", label: "熨烫机使用权保护时间(分钟)" },
    { key: "standby_reassign_timeout_min", value: "20", label: "待就位超时多久更换派发助理(分钟)" },
    { key: "photographer_max_active_tasks", value: "1", label: "摄影师最多同时下达任务数" },
    { key: "workbench_page_background", value: "", label: "工作台页面背景图" },
    { key: "collaboration_queue_auto_close_limit", value: "10", label: "当前区域任务队列达到多少条自动关闭多人协作" },
    {
      key: "p1_interrupt_dispatch_mode",
      value: "priority_tier_rr",
      label: "P1插单派发策略(priority_tier_rr|flat_round_robin)",
    },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: {},
      create: cfg,
    });
  }
  console.log(`✅ Created ${configs.length} system configs`);

  console.log("🎉 Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
