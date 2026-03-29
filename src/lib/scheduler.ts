import { prisma } from "./prisma";
import { TaskStatus, ProfileStatus } from "@/generated/prisma/client";
import { PRIORITY, SCHEDULER_CONFIG } from "@/types";

/**
 * 从数据库获取动态配置，回退到硬编码默认值
 */
async function getConfig() {
  try {
    const configs = await prisma.systemConfig.findMany();
    const map: Record<string, string> = {};
    configs.forEach((c) => { map[c.key] = c.value; });
    return {
      ESCALATION_THRESHOLD_MINUTES: parseInt(map.upgrade_threshold) || SCHEDULER_CONFIG.ESCALATION_THRESHOLD_MINUTES,
      COMPLETION_WARNING_MINUTES: parseInt(map.ending_alert_min) || SCHEDULER_CONFIG.COMPLETION_WARNING_MINUTES,
      AUTO_COMPLETE_IDLE_MINUTES: parseInt(map.auto_finish_min) || SCHEDULER_CONFIG.AUTO_COMPLETE_IDLE_MINUTES,
      INTERRUPT_MAX_MINUTES: parseInt(map.interruption_max) || SCHEDULER_CONFIG.INTERRUPT_MAX_MINUTES,
    };
  } catch {
    return SCHEDULER_CONFIG;
  }
}

/**
 * 自动分配最优空闲助理
 * 优先匹配同楼座、状态空闲的助理
 */
export async function assignTask(taskId: string): Promise<string | null> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: { photographer: true },
  });

  if (!task) return null;

  // 查找空闲助理，优先同楼座
  const availableAssistants = await prisma.profile.findMany({
    where: {
      role: "assistant",
      status: ProfileStatus.idle,
      isOnline: true,
      subStatus: null, // 排除有微标签的（请假/不适等）
    },
    orderBy: [{ buildingId: "asc" }],
  });

  if (availableAssistants.length === 0) return null;

  // 优先选择同楼座的助理
  const sameBuilding = availableAssistants.find(
    (a) => a.buildingId === task.photographer.buildingId
  );
  const selected = sameBuilding ?? availableAssistants[0];

  // 分配任务（助理状态设为待就位，等待助理确认开始）
  await prisma.$transaction([
    prisma.bookingTask.update({
      where: { id: taskId },
      data: { assistantId: selected.id },
    }),
    prisma.profile.update({
      where: { id: selected.id },
      data: { status: ProfileStatus.assigned },
    }),
  ]);

  return selected.id;
}

/**
 * 判断是否可以插单
 * P1 任务可以插断正在执行 P4 的未锁定助理
 */
export async function canInterrupt(
  assistantId: string,
  newPriority: number
): Promise<boolean> {
  if (newPriority !== PRIORITY.P1_URGENT) return false;

  const currentTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.executing,
    },
  });

  if (!currentTask) return false;

  // 只有 P4 任务且未锁定才能被插单
  return currentTask.priority === PRIORITY.P4_LOW && !currentTask.isLocked;
}

/**
 * 执行插单操作
 * 暂停当前 P4 任务，分配新 P1 任务给该助理
 */
export async function interruptAssistant(
  assistantId: string,
  newTaskId: string
): Promise<boolean> {
  const currentTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.executing,
    },
  });

  if (!currentTask) return false;

  await prisma.$transaction([
    // 暂停当前任务
    prisma.bookingTask.update({
      where: { id: currentTask.id },
      data: { status: TaskStatus.paused },
    }),
    // 分配新任务，记录父任务
    prisma.bookingTask.update({
      where: { id: newTaskId },
      data: {
        assistantId,
        parentTaskId: currentTask.id,
        status: TaskStatus.executing,
        startedAt: new Date(),
      },
    }),
    // 更新助理状态
    prisma.profile.update({
      where: { id: assistantId },
      data: { status: ProfileStatus.executing },
    }),
  ]);

  return true;
}

/**
 * 动态提权
 * P2/P3/P4 任务等待超过30分钟，优先级自动向上提一级
 */
export async function escalatePriorities(): Promise<number> {
  const cfg = await getConfig();
  const threshold = new Date(
    Date.now() - cfg.ESCALATION_THRESHOLD_MINUTES * 60 * 1000
  );

  // 查找需要提权的任务
  const tasksToEscalate = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      priority: { gte: PRIORITY.P2_HIGH }, // P2, P3, P4
      createdAt: { lte: threshold },
      OR: [
        { escalatedAt: null },
        { escalatedAt: { lte: threshold } },
      ],
    },
  });

  let escalatedCount = 0;
  for (const task of tasksToEscalate) {
    if (task.priority > PRIORITY.P1_URGENT) {
      await prisma.bookingTask.update({
        where: { id: task.id },
        data: {
          priority: task.priority - 1,
          escalatedAt: new Date(),
        },
      });
      escalatedCount++;
    }
  }

  return escalatedCount;
}

/**
 * 获取即将结束的任务（2分钟内）
 * 用于触发结项预警
 */
export async function getFinishingSoonTasks() {
  const cfg = await getConfig();
  const warningTime = new Date(
    Date.now() + cfg.COMPLETION_WARNING_MINUTES * 60 * 1000
  );

  return prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.executing,
      estEndTime: {
        lte: warningTime,
        gte: new Date(),
      },
    },
    include: {
      assistant: true,
      photographer: true,
      category: true,
    },
  });
}

/**
 * 完成任务并释放助理状态
 * 如果有被暂停的父任务，恢复执行
 * 使用事务保证原子性
 */
export async function completeTask(taskId: string): Promise<void> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
  });

  if (!task || !task.assistantId) return;

  const assistantId = task.assistantId;

  if (task.parentTaskId) {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: { status: TaskStatus.completed, completedAt: new Date() },
      }),
      prisma.bookingTask.update({
        where: { id: task.parentTaskId },
        data: { status: TaskStatus.executing },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.executing },
      }),
    ]);
    return;
  }

  const pausedTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.paused,
    },
    orderBy: { priority: "asc" },
  });

  if (pausedTask) {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: { status: TaskStatus.completed, completedAt: new Date() },
      }),
      prisma.bookingTask.update({
        where: { id: pausedTask.id },
        data: { status: TaskStatus.executing },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.executing },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: { status: TaskStatus.completed, completedAt: new Date() },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.idle },
      }),
    ]);
  }
}
