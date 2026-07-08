import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import {
  IroningTaskStage,
  OnlineStatus,
  ProfileStatus,
  Role,
  TaskStatus,
} from "../../src/generated/prisma/enums";
import { numberArg, parseArgs } from "./common";

process.env.DATABASE_URL ??= "file:./prisma/loadtest.db";

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL ?? "";
const allowReset = process.env.ALLOW_LOADTEST_DB_RESET === "1" || databaseUrl.toLowerCase().includes("loadtest");

if (!allowReset) {
  throw new Error(
    `拒绝 seed 非 loadtest 数据库：${databaseUrl || "(empty)"}。请使用 DATABASE_URL=file:./prisma/loadtest.db，或显式设置 ALLOW_LOADTEST_DB_RESET=1。`,
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 5000 }),
});

const photographerCount = Math.max(1, Math.floor(numberArg(args, "photographers", 80)));
const assistantCount = Math.max(1, Math.floor(numberArg(args, "assistants", 30)));
const adminCount = Math.max(1, Math.floor(numberArg(args, "admins", 5)));
const initialTaskCount = Math.max(0, Math.floor(numberArg(args, "tasks", 360)));
const buildingCount = 5;
const roomsPerBuilding = 36;

function pad(value: number, length = 3): string {
  return String(value).padStart(length, "0");
}

function profileId(prefix: string, index: number): string {
  return `lt-${prefix}-${pad(index)}`;
}

function roomNumberFor(buildingId: number, index: number): string {
  return `${buildingId}${String(index + 1).padStart(2, "0")}`;
}

async function resetDatabase() {
  await prisma.taskAssistantTransferRequest.deleteMany();
  await prisma.taskPriorityUpgradeRequest.deleteMany();
  await prisma.taskCompletionRegistration.deleteMany();
  await prisma.standbyReassignmentNotice.deleteMany();
  await prisma.taskCollaborator.deleteMany();
  await prisma.bookingTask.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.ironingMachine.deleteMany();
  await prisma.room.deleteMany();
  await prisma.taskCategory.deleteMany();
  await prisma.systemConfig.deleteMany();
  await prisma.building.deleteMany();
}

async function seedBaseData() {
  await prisma.building.createMany({
    data: Array.from({ length: buildingCount }, (_, index) => ({
      id: index + 1,
      name: `${index + 1}号楼`,
      extraVenues: JSON.stringify(["化妆间", "公共区", "收货区", "熨烫区"]),
    })),
  });

  await prisma.room.createMany({
    data: Array.from({ length: buildingCount * roomsPerBuilding }, (_, index) => {
      const buildingId = Math.floor(index / roomsPerBuilding) + 1;
      const roomIndex = index % roomsPerBuilding;
      return {
        buildingId,
        roomNumber: roomNumberFor(buildingId, roomIndex),
        floor: buildingId,
        xPosition: 10 + ((roomIndex * 17) % 80),
        yPosition: 12 + ((roomIndex * 23) % 76),
        fenceRadius: 5,
      };
    }),
  });

  await prisma.ironingMachine.createMany({
    data: Array.from({ length: buildingCount * 3 }, (_, index) => {
      const buildingId = Math.floor(index / 3) + 1;
      const slot = (index % 3) + 1;
      return {
        buildingId,
        name: `熨烫机 ${slot}`,
        sortRank: slot,
        xPosition: 82 + slot * 3,
        yPosition: 12 + slot * 5,
      };
    }),
  });

  await prisma.taskCategory.createMany({
    data: [
      {
        id: 1,
        name: "短时手持",
        description: "压测短时手持任务",
        priorityLevel: 1,
        minDuration: 1,
        maxDuration: 10,
        estDuration: 5,
        hexColor: "#ef4444",
        sortRank: 1,
        canBeInterrupted: false,
      },
      {
        id: 2,
        name: "服装穿戴",
        description: "压测服装穿戴任务",
        priorityLevel: 2,
        minDuration: 10,
        maxDuration: 20,
        estDuration: 15,
        hexColor: "#f97316",
        sortRank: 2,
      },
      {
        id: 3,
        name: "手工DIY协助",
        description: "压测手工协助任务",
        priorityLevel: 3,
        minDuration: 15,
        maxDuration: 30,
        estDuration: 20,
        hexColor: "#eab308",
        sortRank: 3,
      },
      {
        id: 4,
        name: "短时熨烫",
        description: "压测短时熨烫任务",
        priorityLevel: 3,
        minDuration: 10,
        maxDuration: 30,
        estDuration: 20,
        hexColor: "#f59e0b",
        sortRank: 4,
      },
      {
        id: 5,
        name: "长时熨烫",
        description: "压测长时熨烫任务",
        priorityLevel: 4,
        minDuration: 30,
        maxDuration: 120,
        estDuration: 60,
        hexColor: "#3b82f6",
        sortRank: 5,
      },
      {
        id: 6,
        name: "手工DIY制作",
        description: "压测手工制作任务",
        priorityLevel: 4,
        minDuration: 30,
        maxDuration: 120,
        estDuration: 60,
        hexColor: "#6366f1",
        sortRank: 6,
      },
      {
        id: 7,
        name: "其他长时任务",
        description: "压测其他任务",
        priorityLevel: 4,
        minDuration: 30,
        maxDuration: 180,
        estDuration: 60,
        hexColor: "#64748b",
        sortRank: 7,
      },
    ],
  });

  await prisma.systemConfig.createMany({
    data: [
      { key: "ending_alert_min", value: "2", label: "快结束提醒(分钟)" },
      { key: "eating_overtime_alert_min", value: "30", label: "吃饭累计时长上限/提醒(分钟)" },
      { key: "eating_reentry_cooldown_min", value: "30", label: "结束吃饭后再次切换冷却(分钟)" },
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
      { key: "p1_interrupt_dispatch_mode", value: "priority_tier_rr", label: "P1插单派发策略" },
    ],
  });
}

async function seedProfiles() {
  const assistants = Array.from({ length: assistantCount }, (_, index) => {
    const buildingId = (index % buildingCount) + 1;
    const status =
      index < Math.min(15, assistantCount)
        ? ProfileStatus.assigned
        : index < Math.min(25, assistantCount)
          ? ProfileStatus.executing
          : index < Math.min(30, assistantCount)
            ? ProfileStatus.busy
            : ProfileStatus.idle;
    return {
      id: profileId("assistant", index + 1),
      employeeId: `LT-A${pad(index + 1)}`,
      name: `压测助理 ${pad(index + 1)}`,
      role: Role.assistant,
      buildingId,
      activeBuildingId: buildingId,
      currentRoom: null,
      activeRoom: null,
      status,
      onlineStatus: OnlineStatus.online,
      isOnline: true,
      department: "压测组",
      group: `A${(index % 5) + 1}`,
    };
  });

  const photographers = Array.from({ length: photographerCount }, (_, index) => {
    const buildingId = (index % buildingCount) + 1;
    return {
      id: profileId("photographer", index + 1),
      employeeId: `LT-P${pad(index + 1)}`,
      name: `压测摄影师 ${pad(index + 1)}`,
      role: Role.photographer,
      buildingId,
      currentRoom: roomNumberFor(buildingId, index % roomsPerBuilding),
      status: ProfileStatus.idle,
      onlineStatus: OnlineStatus.online,
      isOnline: true,
      department: "摄影部",
      group: `P${(index % 8) + 1}`,
    };
  });

  const admins = Array.from({ length: adminCount }, (_, index) => ({
    id: profileId("admin", index + 1),
    employeeId: `LT-M${pad(index + 1)}`,
    name: `压测管理 ${pad(index + 1)}`,
    role: Role.admin,
    buildingId: (index % buildingCount) + 1,
    currentRoom: "办公室",
    status: ProfileStatus.idle,
    onlineStatus: OnlineStatus.online,
    isOnline: true,
    department: "管理组",
    group: "M",
  }));

  await prisma.profile.createMany({ data: [...assistants, ...photographers, ...admins] });
}

async function seedTasks() {
  const now = Date.now();
  const taskRows = [];
  const collaboratorRows = [];
  const activeTaskCount = Math.min(assistantCount, 30, initialTaskCount);

  for (let i = 0; i < initialTaskCount; i++) {
    const buildingId = (i % buildingCount) + 1;
    const photographerIndex = (i % photographerCount) + 1;
    const categoryId = (i % 7) + 1;
    const isIroning = categoryId === 4 || categoryId === 5;
    const id = `lt-task-${pad(i + 1, 4)}`;
    const createdAt = new Date(now - (i % 360) * 60_000);
    const assistantIndex = i < activeTaskCount ? i + 1 : ((i + 1) % assistantCount) + 1;
    const assistantId = i < activeTaskCount || i >= Math.floor(initialTaskCount * 0.65)
      ? profileId("assistant", assistantIndex)
      : null;

    let status: TaskStatus = TaskStatus.waiting;
    let ironingStage: IroningTaskStage = IroningTaskStage.none;
    let startedAt: Date | null = null;
    let pausedAt: Date | null = null;
    let completedAt: Date | null = null;
    let workSegmentStartedAt: Date | null = null;
    let effectiveWorkSeconds = 0;

    if (i < Math.min(15, activeTaskCount)) {
      status = TaskStatus.waiting;
      ironingStage = isIroning
        ? i % 2 === 0
          ? IroningTaskStage.notified
          : IroningTaskStage.waiting_machine
        : IroningTaskStage.none;
    } else if (i < Math.min(25, activeTaskCount)) {
      status = TaskStatus.executing;
      startedAt = new Date(now - 8 * 60_000);
      workSegmentStartedAt = startedAt;
      ironingStage = isIroning ? IroningTaskStage.using : IroningTaskStage.none;
    } else if (i < activeTaskCount) {
      status = TaskStatus.paused;
      startedAt = new Date(now - 18 * 60_000);
      pausedAt = new Date(now - 4 * 60_000);
      effectiveWorkSeconds = 14 * 60;
      ironingStage = isIroning ? IroningTaskStage.using : IroningTaskStage.none;
    } else if (i >= Math.floor(initialTaskCount * 0.65)) {
      status = TaskStatus.completed;
      startedAt = new Date(now - (120 + i) * 60_000);
      completedAt = new Date(now - (90 + i) * 60_000);
      effectiveWorkSeconds = 12 * 60 + (i % 600);
      ironingStage = IroningTaskStage.none;
    } else {
      status = TaskStatus.waiting;
      ironingStage = isIroning ? IroningTaskStage.waiting_machine : IroningTaskStage.none;
    }

    taskRows.push({
      id,
      photographerId: profileId("photographer", photographerIndex),
      assistantId,
      locationBuildingId: buildingId,
      roomNumber: roomNumberFor(buildingId, i % roomsPerBuilding),
      categoryId,
      priority: Math.min(6, Math.max(1, categoryId === 1 ? 1 : categoryId <= 3 ? categoryId : 4)),
      isLocked: false,
      isSpecified: i % 17 === 0 && assistantId != null,
      status,
      ironingStage,
      note: i % 11 === 0 ? "压测备注：需要小推车" : null,
      createdAt,
      startedAt,
      pausedAt,
      completedAt,
      effectiveWorkSeconds,
      workSegmentStartedAt,
      estEndTime: status === TaskStatus.executing ? new Date(now + 12 * 60_000) : null,
      ironingQueuedAt: ironingStage === IroningTaskStage.waiting_machine ? createdAt : null,
      ironingNotifiedAt: ironingStage === IroningTaskStage.notified ? new Date(now - 60_000) : null,
      ironingStartedAt: ironingStage === IroningTaskStage.using ? startedAt : null,
    });

    if (assistantId) {
      collaboratorRows.push({
        taskId: id,
        assistantId,
        role: "primary",
        status,
        joinedAt: createdAt,
        startedAt,
        completedAt,
        leftAt: completedAt,
        effectiveWorkSeconds,
        workSegmentStartedAt,
      });
    }
  }

  if (taskRows.length > 0) {
    await prisma.bookingTask.createMany({ data: taskRows });
  }
  if (collaboratorRows.length > 0) {
    await prisma.taskCollaborator.createMany({ data: collaboratorRows });
  }
}

async function main() {
  console.log(`Preparing loadtest database: ${databaseUrl}`);
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  await resetDatabase();
  await seedBaseData();
  await seedProfiles();
  await seedTasks();
  const [profiles, tasks] = await Promise.all([
    prisma.profile.count(),
    prisma.bookingTask.count(),
  ]);
  console.log(`Seed complete: ${profiles} profiles, ${tasks} tasks`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
