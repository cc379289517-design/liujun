import { prisma } from "./prisma";
import { TaskStatus, ProfileStatus, OnlineStatus } from "@/generated/prisma/client";
import { PRIORITY, SCHEDULER_CONFIG } from "@/types";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";

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
export async function assignTask(taskId: string, buildingId?: number): Promise<string | null> {
  let effectiveBuildingId = buildingId;

  if (effectiveBuildingId == null) {
    const task = await prisma.bookingTask.findUnique({
      where: { id: taskId },
      include: { photographer: true },
    });
    if (!task) return null;
    effectiveBuildingId = task.photographer.buildingId;
  }

  // 查找同楼座的空闲助理（按姓名稳定排序，避免派单结果飘忽）
  const availableAssistants = await prisma.profile.findMany({
    where: {
      role: { in: ["assistant", "assistant_leader"] },
      status: ProfileStatus.idle,
      onlineStatus: OnlineStatus.online,
      subStatus: null,
      buildingId: effectiveBuildingId,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  if (availableAssistants.length === 0) return null;

  const selected = availableAssistants[0];

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
 * 自动认领等待中的任务
 * 助理变为 idle 时调用，按优先级从高到低找第一个未分配的等待任务并分配
 */
export async function autoClaimWaitingTask(assistantId: string): Promise<string | null> {
  const assistant = await prisma.profile.findUnique({ where: { id: assistantId } });
  if (!assistant || assistant.status !== ProfileStatus.idle || assistant.onlineStatus !== OnlineStatus.online || assistant.subStatus) return null;

  // 确认该助理确实没有活跃任务
  const existingTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
    },
  });
  if (existingTask) return null;

  // 查找同楼座、未分配助理的等待任务（按优先级升序、创建时间升序）
  const waitingTask = await prisma.bookingTask.findFirst({
    where: {
      status: TaskStatus.waiting,
      assistantId: null,
      photographer: { buildingId: assistant.buildingId },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  if (!waitingTask) return null;

  await prisma.$transaction([
    prisma.bookingTask.update({
      where: { id: waitingTask.id },
      data: { assistantId },
    }),
    prisma.profile.update({
      where: { id: assistantId },
      data: { status: ProfileStatus.assigned },
    }),
  ]);

  console.log(`[autoClaimWaitingTask] 助理 ${assistantId} 自动认领任务 ${waitingTask.id} (P${waitingTask.priority})`);
  return waitingTask.id;
}

/**
 * 全局扫描：将所有空闲助理与等待中未分配的任务进行匹配
 * 按优先级从高到低、创建时间从早到晚依次分配
 * 使用防抖避免并发重复执行
 * 返回本次分配的数量
 */
let _sweepRunning = false;
export async function sweepWaitingTasks(): Promise<number> {
  // 防止并发执行
  if (_sweepRunning) return 0;
  _sweepRunning = true;

  try {
    // 1. 查找所有空闲且可用的助理
    const idleAssistants = await prisma.profile.findMany({
      where: {
        role: { in: ["assistant", "assistant_leader"] },
        status: ProfileStatus.idle,
        onlineStatus: OnlineStatus.online,
        subStatus: null,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    if (idleAssistants.length === 0) return 0;

    // 2. 排除已有活跃任务的助理（防止重复分配）
    const busyAssistantIds = (await prisma.bookingTask.findMany({
      where: {
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
        assistantId: { not: null },
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    })).map((t) => t.assistantId!);

    const trulyIdle = idleAssistants.filter((a) => !busyAssistantIds.includes(a.id));
    if (trulyIdle.length === 0) return 0;

    // 3. 查找等待中且未分配助理的任务
    const waitingTasks = await prisma.bookingTask.findMany({
      where: {
        status: TaskStatus.waiting,
        assistantId: null,
      },
      include: { photographer: { select: { buildingId: true } } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    if (waitingTasks.length === 0) return 0;

    // 4. 按楼座分组空闲助理
    const assistantsByBuilding = new Map<number, string[]>();
    for (const a of trulyIdle) {
      if (a.buildingId == null) continue;
      const list = assistantsByBuilding.get(a.buildingId) || [];
      list.push(a.id);
      assistantsByBuilding.set(a.buildingId, list);
    }

    // 5. 按优先级顺序逐个分配
    let assignedCount = 0;
    for (const task of waitingTasks) {
      const buildingId = task.photographer.buildingId;
      if (buildingId == null) continue;
      const available = assistantsByBuilding.get(buildingId);
      if (!available || available.length === 0) continue;

      const assistantId = available.shift()!;

      await prisma.$transaction([
        prisma.bookingTask.update({
          where: { id: task.id },
          data: { assistantId },
        }),
        prisma.profile.update({
          where: { id: assistantId },
          data: { status: ProfileStatus.assigned },
        }),
      ]);

      console.log(`[sweepWaitingTasks] 助理 ${assistantId} 分配任务 ${task.id} (P${task.priority})`);
      assignedCount++;
    }

    return assignedCount;
  } finally {
    _sweepRunning = false;
  }
}

/**
 * 判断是否可以插单
 * P1 任务可以插断优先级低于自己的未锁定任务（P2-P5）
 * 同时检查任务类型级别的 canBeInterrupted 设置
 */
export async function canInterrupt(
  assistantId: string,
  newPriority: number
): Promise<boolean> {
  if (newPriority !== PRIORITY.P1) return false;

  const currentTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.executing,
    },
    include: { category: true },
  });

  if (!currentTask) return false;

  // 检查任务类型是否允许被打断
  if (!currentTask.category.canBeInterrupted) return false;

  // P1 可以插断所有比自己优先级低的未锁定任务（P2-P5）
  return currentTask.priority > PRIORITY.P1 && !currentTask.isLocked;
}

/**
 * 执行插单操作
 * 仅将新 P1 任务分配给助理（记录 parentTaskId），不立即暂停当前任务。
 * 助理需手动在工作台点击暂停，再确认就位后开始新任务。
 */
export async function interruptAssistant(
  assistantId: string,
  newTaskId: string
): Promise<boolean> {
  const currentTask = await prisma.bookingTask.findFirst({
    where: { assistantId, status: TaskStatus.executing },
  });

  if (!currentTask) return false;

  // 只分配新任务 + 记录父任务，不改变旧任务状态，不改变助理状态
  await prisma.bookingTask.update({
    where: { id: newTaskId },
    data: { assistantId, parentTaskId: currentTask.id },
  });

  return true;
}

const P1_INTERRUPT_RR_KEY = (buildingId: number) => `p1_interrupt_rr_b${buildingId}`;

async function getLastP1InterruptAssistant(buildingId: number): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: P1_INTERRUPT_RR_KEY(buildingId) },
  });
  return row?.value ?? null;
}

/**
 * 记录本次 P1 插单选中的助理，供同楼座下一轮在同档位内轮询。
 */
export async function recordP1InterruptRoundRobin(buildingId: number, assistantId: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: P1_INTERRUPT_RR_KEY(buildingId) },
    create: {
      key: P1_INTERRUPT_RR_KEY(buildingId),
      value: assistantId,
      label: "P1紧急插单同楼座轮询指针",
    },
    update: { value: assistantId },
  });
}

/**
 * 同档位（当前执行任务 priority 相同）内按助理 id 稳定排序后轮询，避免总派给同一人。
 * @param sortedByPriorityDesc 已按「当前任务 priority」降序排好（P5→P2，优先插低优先级任务）
 */
export function orderP1InterruptCandidates<T extends { assistantId: string | null; priority: number }>(
  sortedByPriorityDesc: T[],
  lastAssistantId: string | null
): T[] {
  if (sortedByPriorityDesc.length === 0) return [];
  const topP = sortedByPriorityDesc[0].priority;
  const tier = sortedByPriorityDesc.filter((t) => t.priority === topP);
  const tail = sortedByPriorityDesc.filter((t) => t.priority < topP);

  const withId = tier.filter((t): t is T & { assistantId: string } => t.assistantId != null);
  if (withId.length <= 1) return [...withId, ...tail];

  const sorted = [...withId].sort((a, b) => a.assistantId.localeCompare(b.assistantId));
  if (!lastAssistantId) return [...sorted, ...tail];

  const idx = sorted.findIndex((t) => t.assistantId === lastAssistantId);
  if (idx < 0) return [...sorted, ...tail];
  const start = (idx + 1) % sorted.length;
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  return [...rotated, ...tail];
}

/** 后台「逻辑设置」：P1 插单在可插断助理之间的排序策略 */
export type P1InterruptDispatchMode = "priority_tier_rr" | "flat_round_robin";

const P1_DISPATCH_MODE_KEY = "p1_interrupt_dispatch_mode";

export async function getP1InterruptDispatchMode(): Promise<P1InterruptDispatchMode> {
  const row = await prisma.systemConfig.findUnique({ where: { key: P1_DISPATCH_MODE_KEY } });
  return row?.value === "flat_round_robin" ? "flat_round_robin" : "priority_tier_rr";
}

/**
 * 全体可插断助理按 assistantId 排序后整表轮询，不按当前执行任务优先级分层。
 */
export function orderP1InterruptFlatRoundRobin<T extends { assistantId: string | null }>(
  candidates: T[],
  lastAssistantId: string | null
): T[] {
  const withId = candidates.filter((t): t is T & { assistantId: string } => t.assistantId != null);
  if (withId.length <= 1) return withId;
  const sorted = [...withId].sort((a, b) => a.assistantId.localeCompare(b.assistantId));
  if (!lastAssistantId) return sorted;
  const idx = sorted.findIndex((t) => t.assistantId === lastAssistantId);
  if (idx < 0) return sorted;
  const start = (idx + 1) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/**
 * 根据全局配置生成 P1 插单尝试顺序（POST /api/tasks 使用）。
 * - priority_tier_rr：先按当前任务 priority 从高到低（P5→P2），同档内轮询
 * - flat_round_robin：可插断者全体轮询，忽略任务优先级
 */
export async function buildP1InterruptCandidateOrderFromFiltered<
  T extends { assistantId: string | null; priority: number },
>(buildingId: number, filteredCandidates: T[]): Promise<T[]> {
  const mode = await getP1InterruptDispatchMode();
  const lastId = await getLastP1InterruptAssistant(buildingId);
  if (mode === "flat_round_robin") {
    return orderP1InterruptFlatRoundRobin(filteredCandidates, lastId);
  }
  const sortedByPriorityDesc = [...filteredCandidates].sort((a, b) => b.priority - a.priority);
  return orderP1InterruptCandidates(sortedByPriorityDesc, lastId);
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
      priority: { gte: PRIORITY.P2 }, // P2-P5
      createdAt: { lte: threshold },
      OR: [
        { escalatedAt: null },
        { escalatedAt: { lte: threshold } },
      ],
    },
  });

  let escalatedCount = 0;
  for (const task of tasksToEscalate) {
    if (task.priority > PRIORITY.P1) {
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

  const completeData = (() => {
    const flushed = flushExecutingSegment({
      effectiveWorkSeconds: task.effectiveWorkSeconds,
      workSegmentStartedAt: task.workSegmentStartedAt,
      startedAt: task.startedAt,
      status: task.status,
    });
    return {
      status: TaskStatus.completed,
      completedAt: new Date(),
      effectiveWorkSeconds: flushed.effectiveWorkSeconds,
      workSegmentStartedAt: null,
    };
  })();

  if (task.parentTaskId) {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: completeData,
      }),
      // 恢复父任务为 waiting（需重新就位），清除 pausedAt
      prisma.bookingTask.update({
        where: { id: task.parentTaskId },
        data: { status: TaskStatus.waiting, pausedAt: null },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.assigned },
      }),
    ]);
    return;
  }

  const pausedTask = await prisma.bookingTask.findFirst({
    where: { assistantId, status: TaskStatus.paused },
    orderBy: { priority: "asc" },
  });

  if (pausedTask) {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: completeData,
      }),
      // 恢复暂停任务为 waiting（需重新就位），清除 pausedAt
      prisma.bookingTask.update({
        where: { id: pausedTask.id },
        data: { status: TaskStatus.waiting, pausedAt: null },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.assigned },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: taskId },
        data: completeData,
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.idle },
      }),
    ]);

    // 全局扫描：将所有空闲助理与等待中的任务匹配
    await sweepWaitingTasks();
  }
}

/**
 * 每日自动清理：将昨天及更早的 waiting/paused 任��标记为已完成，释放助理
 * 使用日期标记确保每天只执行一次
 */
let _lastCleanupDate = "";
export async function cleanupStaleTasks(): Promise<number> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  if (_lastCleanupDate === todayStr) return 0;
  _lastCleanupDate = todayStr;

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // 查找昨天及更早的未完成任务（waiting / paused / executing）
  const staleTasks = await prisma.bookingTask.findMany({
    where: {
      createdAt: { lt: startOfToday },
      status: { in: [TaskStatus.waiting, TaskStatus.paused, TaskStatus.executing] },
    },
    select: { id: true, assistantId: true },
  });

  if (staleTasks.length === 0) return 0;

  // 收集需要释放的助理ID
  const assistantIds = staleTasks
    .map((t) => t.assistantId)
    .filter((id): id is string => id !== null);

  // 批量标记为已完成
  await prisma.bookingTask.updateMany({
    where: {
      id: { in: staleTasks.map((t) => t.id) },
    },
    data: { status: TaskStatus.completed, completedAt: startOfToday },
  });

  // 释放助理状态为 idle（仅当该助理没有今天的活跃任务时）
  if (assistantIds.length > 0) {
    // 找出今天仍有活跃任务的助理
    const busyToday = (await prisma.bookingTask.findMany({
      where: {
        assistantId: { in: assistantIds },
        createdAt: { gte: startOfToday },
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    })).map((t) => t.assistantId!);

    const toRelease = assistantIds.filter((id) => !busyToday.includes(id));
    if (toRelease.length > 0) {
      await prisma.profile.updateMany({
        where: { id: { in: toRelease } },
        data: { status: ProfileStatus.idle },
      });
    }
  }

  console.log(`[cleanupStaleTasks] 清理了 ${staleTasks.length} 条过期任务，释放了 ${assistantIds.length} 位助理`);
  return staleTasks.length;
}

/**
 * 同步助理 profile.status 与实际任务状态
 * 以任务表为真实来源，修正 profile 状态不一致的情况
 */
let _syncRunning = false;
export async function syncProfileStatus(): Promise<void> {
  if (_syncRunning) return;
  _syncRunning = true;

  try {
    const assistants = await prisma.profile.findMany({
      where: { role: { in: ["assistant", "assistant_leader"] } },
      select: { id: true, status: true },
    });

    if (assistants.length === 0) return;

    // 查每个助理当前的活跃任务（不限日期，确保跨天数据也能正确反映）
    const activeTasks = await prisma.bookingTask.findMany({
      where: {
        assistantId: { in: assistants.map((a) => a.id) },
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
      },
      select: { assistantId: true, status: true },
    });

    // 按助理聚合：取最高优先状态 executing > waiting > paused
    const taskStatusMap = new Map<string, string>();
    for (const t of activeTasks) {
      if (!t.assistantId) continue;
      const cur = taskStatusMap.get(t.assistantId);
      if (!cur || t.status === "executing" || (t.status === "waiting" && cur === "paused")) {
        taskStatusMap.set(t.assistantId, t.status);
      }
    }

    // 对比并修正
    for (const a of assistants) {
      const taskStatus = taskStatusMap.get(a.id);
      let expectedStatus: ProfileStatus;

      if (!taskStatus) {
        expectedStatus = ProfileStatus.idle;
      } else if (taskStatus === "executing") {
        expectedStatus = ProfileStatus.executing;
      } else if (taskStatus === "waiting") {
        expectedStatus = ProfileStatus.assigned;
      } else {
        expectedStatus = ProfileStatus.busy;
      }

      if (a.status !== expectedStatus) {
        await prisma.profile.update({
          where: { id: a.id },
          data: { status: expectedStatus },
        });
      }
    }
  } finally {
    _syncRunning = false;
  }
}
