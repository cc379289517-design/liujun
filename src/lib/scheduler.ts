import { prisma } from "./prisma";
import { TaskStatus, ProfileStatus, OnlineStatus } from "@/generated/prisma/client";
import { PRIORITY, SCHEDULER_CONFIG } from "@/types";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";
import {
  COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY,
  collaborationEnabledConfigKey,
  parseCollaborationEnabled,
  parseCollaborationQueueAutoCloseLimit,
} from "@/lib/collaborationRules";
import {
  PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
  PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY,
  isPhotographerLimitQueuedTask,
  parsePhotographerMaxActiveTasks,
} from "@/lib/photographerTaskLimit";

const ACTIVE_TASK_STATUSES = [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] as const;
const NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE = {
  OR: [
    { lockReason: null },
    { lockReason: { not: PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON } },
  ],
};

/**
 * 从数据库获取动态配置，回退到硬编码默认值
 */
export async function getSchedulerRuntimeConfig() {
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

export async function getPhotographerMaxActiveTasks(): Promise<number> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY },
    select: { value: true },
  });
  return parsePhotographerMaxActiveTasks(row?.value);
}

export async function countPhotographerActiveTasks(photographerId: string): Promise<number> {
  return prisma.bookingTask.count({
    where: {
      photographerId,
      status: { in: [...ACTIVE_TASK_STATUSES] },
      ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
    },
  });
}

export async function checkPhotographerActiveTaskLimit(
  photographerId: string
): Promise<{ allowed: boolean; activeCount: number; limit: number }> {
  const [activeCount, limit] = await Promise.all([
    countPhotographerActiveTasks(photographerId),
    getPhotographerMaxActiveTasks(),
  ]);

  return {
    allowed: activeCount < limit,
    activeCount,
    limit,
  };
}

export async function releasePhotographerLimitQueuedTasks(photographerId: string): Promise<number> {
  const [activeCount, limit] = await Promise.all([
    countPhotographerActiveTasks(photographerId),
    getPhotographerMaxActiveTasks(),
  ]);
  const slots = Math.max(0, limit - activeCount);
  if (slots === 0) return 0;

  const queuedTasks = await prisma.bookingTask.findMany({
    where: {
      photographerId,
      status: TaskStatus.waiting,
      assistantId: null,
      isLocked: true,
      lockReason: PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: slots,
  });

  for (const task of queuedTasks) {
    const releasedAt = new Date();
    await prisma.bookingTask.update({
      where: { id: task.id },
      data: {
        isLocked: false,
        lockReason: null,
        createdAt: releasedAt,
        escalatedAt: null,
      },
    });
  }

  return queuedTasks.length;
}

async function releaseAllEligiblePhotographerLimitQueuedTasks(): Promise<number> {
  const rows = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      assistantId: null,
      isLocked: true,
      lockReason: PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
    },
    select: { photographerId: true },
    distinct: ["photographerId"],
  });

  let released = 0;
  for (const row of rows) {
    released += await releasePhotographerLimitQueuedTasks(row.photographerId);
  }
  return released;
}

/** @deprecated 内部使用，请优先用 getSchedulerRuntimeConfig */
async function getConfig() {
  return getSchedulerRuntimeConfig();
}

/**
 * 当前执行中的任务类型允许「被插单离场」的上限（分钟）。
 * 取全局 interruption_max 与类型 maxInterruptMinutes 的较小值；类型未填时仅用全局。
 */
export function effectiveInterruptLeaveCapMinutes(
  globalMaxMinutes: number,
  executingCategoryMaxInterrupt: number | null | undefined
): number {
  if (executingCategoryMaxInterrupt != null && Number.isFinite(executingCategoryMaxInterrupt)) {
    return Math.min(globalMaxMinutes, executingCategoryMaxInterrupt);
  }
  return globalMaxMinutes;
}

export function taskCategoryCanBeInterrupted(category: {
  canBeInterrupted: boolean;
  maxDuration?: number | null;
}): boolean {
  if (!category.canBeInterrupted) return false;
  if (category.maxDuration != null && category.maxDuration > 0 && category.maxDuration <= 30) {
    return false;
  }
  return true;
}

export function taskLeaveUpperMinutes(category: {
  maxDuration?: number | null;
  estDuration?: number | null;
}): number {
  return category.maxDuration != null && category.maxDuration > 0
    ? category.maxDuration
    : Math.max(0, category.estDuration ?? 0);
}

async function assistantHasPendingInterruptTask(assistantId: string): Promise<boolean> {
  const pending = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: { in: [...ACTIVE_TASK_STATUSES] },
      parentTaskId: { not: null },
    },
    select: { id: true },
  });
  return pending != null;
}

export async function isCollaborationEnabledForBuilding(buildingId: number): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: collaborationEnabledConfigKey(buildingId) },
    select: { value: true },
  });
  return parseCollaborationEnabled(row?.value);
}

export async function getCollaborationQueueAutoCloseLimit(): Promise<number> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY },
    select: { value: true },
  });
  return parseCollaborationQueueAutoCloseLimit(row?.value);
}

export async function countBuildingPublicQueueTasks(buildingId: number): Promise<number> {
  return prisma.bookingTask.count({
    where: {
      status: { in: [TaskStatus.waiting, TaskStatus.paused] },
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      OR: [
        { locationBuildingId: buildingId },
        { locationBuildingId: null, photographer: { buildingId } },
      ],
    },
  });
}

export async function getCollaborationAvailabilityForBuilding(buildingId: number): Promise<{
  enabled: boolean;
  manuallyEnabled: boolean;
  autoClosed: boolean;
  queueCount: number;
  queueLimit: number;
}> {
  const [manuallyEnabled, queueLimit, queueCount] = await Promise.all([
    isCollaborationEnabledForBuilding(buildingId),
    getCollaborationQueueAutoCloseLimit(),
    countBuildingPublicQueueTasks(buildingId),
  ]);
  const autoClosed = queueCount >= queueLimit;
  return {
    enabled: manuallyEnabled && !autoClosed,
    manuallyEnabled,
    autoClosed,
    queueCount,
    queueLimit,
  };
}

export type ParticipantStatus = "waiting" | "executing" | "paused" | "completed" | "left";
const ACTIVE_PARTICIPANT_STATUSES: ParticipantStatus[] = ["waiting", "executing", "paused"];
const WORKING_PARTICIPANT_STATUSES: ParticipantStatus[] = ["executing", "paused"];

const IDLE_DISPATCH_RR_KEY = (buildingId: number) => `idle_dispatch_rr_b${buildingId}`;

async function getLastIdleDispatchAssistant(buildingId: number): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: IDLE_DISPATCH_RR_KEY(buildingId) },
  });
  return row?.value ?? null;
}

async function recordIdleDispatchRoundRobin(buildingId: number, assistantId: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: IDLE_DISPATCH_RR_KEY(buildingId) },
    create: {
      key: IDLE_DISPATCH_RR_KEY(buildingId),
      value: assistantId,
      label: "空闲助理同楼座轮询派发指针",
    },
    update: { value: assistantId },
  });
}

export function orderIdleDispatchCandidates<T extends { id: string }>(
  candidates: T[],
  lastAssistantId: string | null
): T[] {
  if (candidates.length <= 1) return candidates;
  if (!lastAssistantId) return candidates;
  const idx = candidates.findIndex((a) => a.id === lastAssistantId);
  if (idx < 0) return candidates;
  const start = (idx + 1) % candidates.length;
  return [...candidates.slice(start), ...candidates.slice(0, start)];
}

async function buildIdleDispatchOrder<T extends { id: string }>(
  buildingId: number,
  candidates: T[]
): Promise<T[]> {
  const lastId = await getLastIdleDispatchAssistant(buildingId);
  return orderIdleDispatchCandidates(candidates, lastId);
}

async function activeCollaboratorAssistantIds(assistantIds?: string[]): Promise<string[]> {
  const rows = await prisma.taskCollaborator.findMany({
    where: {
      status: { in: ACTIVE_PARTICIPANT_STATUSES },
      ...(assistantIds ? { assistantId: { in: assistantIds } } : {}),
      task: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
    },
    select: { assistantId: true },
    distinct: ["assistantId"],
  });
  return rows.map((row) => row.assistantId);
}

async function taskHasActiveHelperParticipants(taskId: string): Promise<boolean> {
  const helper = await prisma.taskCollaborator.findFirst({
    where: {
      taskId,
      role: "helper",
      status: { in: ACTIVE_PARTICIPANT_STATUSES },
    },
    select: { id: true },
  });
  return helper != null;
}

export function participantProfileStatus(status: string): ProfileStatus {
  if (status === "executing") return ProfileStatus.executing;
  if (status === "waiting") return ProfileStatus.assigned;
  if (status === "paused") return ProfileStatus.busy;
  return ProfileStatus.idle;
}

function participantStatusFromTaskStatus(status: TaskStatus): ParticipantStatus {
  return status === TaskStatus.completed ? "completed" : status;
}

async function restoreInterruptedParentIfNeeded(taskId: string, assistantId: string | null): Promise<void> {
  if (!assistantId) return;

  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    select: { parentTaskId: true },
  });
  if (!task) return;

  if (task.parentTaskId) {
    await prisma.$transaction([
      prisma.bookingTask.update({
        where: { id: task.parentTaskId },
        data: { status: TaskStatus.waiting, pausedAt: null, workSegmentStartedAt: null },
      }),
      prisma.taskCollaborator.updateMany({
        where: { taskId: task.parentTaskId, assistantId, status: { not: "left" } },
        data: { status: "waiting", leftAt: null, workSegmentStartedAt: null },
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
  if (!pausedTask) return;

  await prisma.$transaction([
    prisma.bookingTask.update({
      where: { id: pausedTask.id },
      data: { status: TaskStatus.waiting, pausedAt: null, workSegmentStartedAt: null },
    }),
    prisma.taskCollaborator.updateMany({
      where: { taskId: pausedTask.id, assistantId, status: { not: "left" } },
      data: { status: "waiting", leftAt: null, workSegmentStartedAt: null },
    }),
    prisma.profile.update({
      where: { id: assistantId },
      data: { status: ProfileStatus.assigned },
    }),
  ]);
}

export async function ensurePrimaryParticipant(
  taskId: string,
  assistantId: string,
  status: string = "waiting"
): Promise<void> {
  await prisma.taskCollaborator.upsert({
    where: { taskId_assistantId: { taskId, assistantId } },
    create: { taskId, assistantId, role: "primary", status },
    update: { role: "primary", status, leftAt: null },
  });
}

export async function syncTaskAggregateFromParticipants(taskId: string): Promise<TaskStatus | null> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      assistantId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      effectiveWorkSeconds: true,
      workSegmentStartedAt: true,
    },
  });
  if (!task) return null;

  if (task.assistantId) {
    await prisma.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId, assistantId: task.assistantId } },
      create: {
        taskId,
        assistantId: task.assistantId,
        role: "primary",
        status: participantStatusFromTaskStatus(task.status),
        startedAt: task.startedAt,
        completedAt: task.status === TaskStatus.completed ? task.completedAt ?? new Date() : null,
      },
      update: { role: "primary", leftAt: null },
    });
  }

  const participants = await prisma.taskCollaborator.findMany({
    where: { taskId, status: { not: "left" } },
  });
  if (participants.length === 0) return task.status;

  const allCompleted = participants.every((p) => p.status === "completed");
  const hasExecuting = participants.some((p) => p.status === "executing");
  const hasWaiting = participants.some((p) => p.status === "waiting");
  const nextStatus = allCompleted
    ? TaskStatus.completed
    : hasExecuting
      ? TaskStatus.executing
      : hasWaiting
        ? TaskStatus.waiting
      : TaskStatus.paused;

  const shouldFlushTaskSegment = task.status === TaskStatus.executing && nextStatus !== TaskStatus.executing;
  const flushed = shouldFlushTaskSegment
    ? flushExecutingSegment({
        effectiveWorkSeconds: task.effectiveWorkSeconds,
        workSegmentStartedAt: task.workSegmentStartedAt,
        startedAt: task.startedAt,
        status: task.status,
      })
    : null;

  await prisma.bookingTask.update({
    where: { id: taskId },
    data: {
      status: nextStatus,
      startedAt: nextStatus === TaskStatus.executing && !task.startedAt ? new Date() : undefined,
      completedAt: nextStatus === TaskStatus.completed ? task.completedAt ?? new Date() : null,
      pausedAt: nextStatus === TaskStatus.paused ? new Date() : nextStatus === TaskStatus.executing ? null : undefined,
      effectiveWorkSeconds: flushed?.effectiveWorkSeconds,
      workSegmentStartedAt: nextStatus === TaskStatus.executing ? (task.status === TaskStatus.executing ? undefined : new Date()) : null,
    },
  });

  for (const p of participants) {
    await prisma.profile.update({
      where: { id: p.assistantId },
      data: { status: participantProfileStatus(p.status) },
    });
  }

  if (nextStatus === TaskStatus.completed) {
    await restoreInterruptedParentIfNeeded(taskId, task.assistantId);
  }

  return nextStatus;
}

export async function updateTaskParticipantStatus(
  taskId: string,
  assistantId: string,
  nextStatus: "executing" | "paused" | "completed",
  estMinutes?: number
): Promise<void> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    select: { id: true, assistantId: true, estEndTime: true, status: true },
  });
  if (!task) throw new Error("Task not found");

  let participant = await prisma.taskCollaborator.findUnique({
    where: { taskId_assistantId: { taskId, assistantId } },
  });
  if (!participant && task.assistantId === assistantId) {
    await ensurePrimaryParticipant(taskId, assistantId, participantStatusFromTaskStatus(task.status));
    participant = await prisma.taskCollaborator.findUnique({
      where: { taskId_assistantId: { taskId, assistantId } },
    });
  }
  if (!participant || participant.status === "left") {
    throw new Error("Assistant is not a participant of this task");
  }
  if (participant.status === "completed" && nextStatus !== "completed") {
    throw new Error("Participant already completed this task");
  }

  const now = new Date();
  const estEndTime = estMinutes ? new Date(Date.now() + estMinutes * 60 * 1000) : task.estEndTime;

  if (nextStatus === "executing") {
    await prisma.$transaction([
      prisma.taskCollaborator.update({
        where: { taskId_assistantId: { taskId, assistantId } },
        data: {
          status: "executing",
          startedAt: participant.startedAt ?? now,
          completedAt: null,
          leftAt: null,
          workSegmentStartedAt: now,
        },
      }),
      prisma.bookingTask.update({
        where: { id: taskId },
        data: { estEndTime, pausedAt: null },
      }),
      prisma.profile.update({
        where: { id: assistantId },
        data: { status: ProfileStatus.executing },
      }),
    ]);
  } else if (nextStatus === "paused") {
    const flushed = flushExecutingSegment({
      effectiveWorkSeconds: participant.effectiveWorkSeconds,
      workSegmentStartedAt: participant.workSegmentStartedAt,
      startedAt: participant.startedAt,
      status: participant.status,
    });
    await prisma.taskCollaborator.update({
      where: { taskId_assistantId: { taskId, assistantId } },
      data: {
        status: "paused",
        effectiveWorkSeconds: flushed.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
  } else {
    const flushed = flushExecutingSegment({
      effectiveWorkSeconds: participant.effectiveWorkSeconds,
      workSegmentStartedAt: participant.workSegmentStartedAt,
      startedAt: participant.startedAt,
      status: participant.status,
    });
    await prisma.taskCollaborator.update({
      where: { taskId_assistantId: { taskId, assistantId } },
      data: {
        status: "completed",
        completedAt: now,
        leftAt: now,
        effectiveWorkSeconds: flushed.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
  }

  await syncTaskAggregateFromParticipants(taskId);
  await syncProfileStatus();
  if (nextStatus === "completed") {
    await sweepWaitingTasks();
  }
}

/**
 * 自动分配最优空闲助理
 * 优先匹配同楼座、状态空闲的助理；同楼座内按轮询指针派发，避免总给同一个人
 */
export async function assignTask(taskId: string, buildingId?: number): Promise<string | null> {
  let effectiveBuildingId = buildingId;
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: { photographer: true },
  });
  if (!task || isPhotographerLimitQueuedTask(task)) return null;

  if (effectiveBuildingId == null) {
    effectiveBuildingId = task.locationBuildingId ?? task.photographer.buildingId;
  }

  // 查找同楼座的空闲助理（按姓名稳定排序，避免派单结果飘忽）
  const availableAssistants = await prisma.profile.findMany({
    where: {
      role: { in: ["assistant", "assistant_leader"] },
      status: ProfileStatus.idle,
      onlineStatus: OnlineStatus.online,
      subStatus: null,
      OR: [
        { activeBuildingId: effectiveBuildingId },
        { activeBuildingId: null, buildingId: effectiveBuildingId },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const collaboratorIds = await activeCollaboratorAssistantIds(availableAssistants.map((a) => a.id));
  const dispatchableAssistants = availableAssistants.filter((a) => !collaboratorIds.includes(a.id));

  if (dispatchableAssistants.length === 0) return null;

  const [selected] = await buildIdleDispatchOrder(effectiveBuildingId, dispatchableAssistants);

  // 分配任务（助理状态设为待就位，等待助理确认开始）
  await prisma.$transaction([
    prisma.bookingTask.update({
      where: { id: taskId },
      data: { assistantId: selected.id },
    }),
    prisma.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId, assistantId: selected.id } },
      create: { taskId, assistantId: selected.id, role: "primary", status: "waiting" },
      update: { role: "primary", status: "waiting", leftAt: null },
    }),
    prisma.profile.update({
      where: { id: selected.id },
      data: { status: ProfileStatus.assigned },
    }),
  ]);
  await recordIdleDispatchRoundRobin(effectiveBuildingId, selected.id);

  return selected.id;
}

/**
 * 自动认领等待中的任务
 * 助理变为 idle 时调用，按优先级从高到低找第一个未分配的等待任务并分配
 */
export async function autoClaimWaitingTask(assistantId: string): Promise<string | null> {
  const assistant = await prisma.profile.findUnique({ where: { id: assistantId } });
  if (!assistant || assistant.status !== ProfileStatus.idle || assistant.onlineStatus !== OnlineStatus.online || assistant.subStatus) return null;

  const activeCollabs = await activeCollaboratorAssistantIds([assistantId]);
  if (activeCollabs.length > 0) return null;
  const assistantBuildingId = assistant.activeBuildingId ?? assistant.buildingId;

  // 确认该助理确实没有活跃参与记录；协作任务里个人完成后应可释放接新单。
  const existingTask = await prisma.taskCollaborator.findFirst({
    where: {
      assistantId,
      status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
      task: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
    },
  });
  if (existingTask) return null;

  // 查找同楼座、未分配助理的等待任务（按优先级升序、创建时间升序）
  const waitingTask = await prisma.bookingTask.findFirst({
    where: {
      status: TaskStatus.waiting,
      assistantId: null,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      OR: [
        { locationBuildingId: assistantBuildingId },
        { locationBuildingId: null, photographer: { buildingId: assistantBuildingId } },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  if (!waitingTask) return null;

  await prisma.$transaction([
    prisma.bookingTask.update({
      where: { id: waitingTask.id },
      data: { assistantId },
    }),
    prisma.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId: waitingTask.id, assistantId } },
      create: { taskId: waitingTask.id, assistantId, role: "primary", status: "waiting" },
      update: { role: "primary", status: "waiting", leftAt: null },
    }),
    prisma.profile.update({
      where: { id: assistantId },
      data: { status: ProfileStatus.assigned },
    }),
  ]);
  await recordIdleDispatchRoundRobin(assistantBuildingId, assistantId);

  console.log(`[autoClaimWaitingTask] 助理 ${assistantId} 自动认领任务 ${waitingTask.id} (P${waitingTask.priority})`);
  return waitingTask.id;
}

function standbyReassignmentScore(priority: number, waitedMinutes: number, thresholdMinutes: number): number {
  const boundedPriority = Math.min(5, Math.max(1, Math.round(priority)));
  const priorityScore = (6 - boundedPriority) * thresholdMinutes;
  const overtimeScore = Math.max(0, waitedMinutes - thresholdMinutes);
  return priorityScore + overtimeScore;
}

export async function reassignOverdueStandbyTasks(): Promise<number> {
  const cfg = await getSchedulerRuntimeConfig();
  const thresholdMinutes = cfg.ESCALATION_THRESHOLD_MINUTES;
  const now = new Date();
  const thresholdAt = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

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

  const collaboratorIds = await activeCollaboratorAssistantIds(idleAssistants.map((a) => a.id));
  const trulyIdle = idleAssistants.filter((a) => !collaboratorIds.includes(a.id));
  if (trulyIdle.length === 0) return 0;

  const assistantsByBuilding = new Map<number, typeof trulyIdle>();
  for (const assistant of trulyIdle) {
    const buildingId = assistant.activeBuildingId ?? assistant.buildingId;
    const list = assistantsByBuilding.get(buildingId) || [];
    list.push(assistant);
    assistantsByBuilding.set(buildingId, list);
  }

  const availableByBuilding = new Map<number, string[]>();
  for (const [buildingId, assistants] of assistantsByBuilding) {
    const ordered = await buildIdleDispatchOrder(buildingId, assistants);
    availableByBuilding.set(buildingId, ordered.map((assistant) => assistant.id));
  }

  const overdueTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      assistantId: { not: null },
      parentTaskId: null,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      collaborators: {
        some: {
          role: "primary",
          status: "waiting",
          joinedAt: { lte: thresholdAt },
        },
      },
    },
    include: {
      photographer: { select: { buildingId: true } },
      assistant: { select: { id: true, name: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { role: "primary", status: "waiting" },
        select: { assistantId: true, joinedAt: true },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  const candidates = overdueTasks.flatMap((task) => {
    if (!task.assistantId || !task.assistant) return [];
    const primary = task.collaborators.find((participant) => participant.assistantId === task.assistantId);
    if (!primary) return [];
    const waitedMinutes = Math.floor((now.getTime() - primary.joinedAt.getTime()) / 60000);
    if (waitedMinutes < thresholdMinutes) return [];
    const buildingId = task.locationBuildingId ?? task.photographer.buildingId;
    return [{
      task,
      buildingId,
      waitingSince: primary.joinedAt,
      waitedMinutes,
      score: standbyReassignmentScore(task.priority, waitedMinutes, thresholdMinutes),
    }];
  }).sort((a, b) =>
    b.score - a.score ||
    a.task.priority - b.task.priority ||
    b.waitedMinutes - a.waitedMinutes ||
    a.waitingSince.getTime() - b.waitingSince.getTime()
  );

  let reassignedCount = 0;
  for (const candidate of candidates) {
    const available = availableByBuilding.get(candidate.buildingId);
    if (!available || available.length === 0) continue;

    const newAssistantId = available.shift()!;
    const newAssistant = trulyIdle.find((assistant) => assistant.id === newAssistantId);
    const oldAssistantId = candidate.task.assistantId;
    if (!newAssistant || !oldAssistantId || newAssistant.id === oldAssistantId || !candidate.task.assistant) continue;
    const oldAssistantName = candidate.task.assistant.name;

    await prisma.$transaction(async (tx) => {
      await tx.bookingTask.update({
        where: { id: candidate.task.id },
        data: { assistantId: newAssistant.id },
      });
      await tx.taskCollaborator.updateMany({
        where: {
          taskId: candidate.task.id,
          assistantId: oldAssistantId,
          role: "primary",
          status: { not: "left" },
        },
        data: { status: "left", leftAt: now },
      });
      await tx.taskCollaborator.upsert({
        where: { taskId_assistantId: { taskId: candidate.task.id, assistantId: newAssistant.id } },
        create: {
          taskId: candidate.task.id,
          assistantId: newAssistant.id,
          role: "primary",
          status: "waiting",
          joinedAt: now,
        },
        update: {
          role: "primary",
          status: "waiting",
          joinedAt: now,
          startedAt: null,
          completedAt: null,
          effectiveWorkSeconds: 0,
          workSegmentStartedAt: null,
          leftAt: null,
        },
      });
      const [oldAssistantOtherParticipants, oldAssistantOtherTasks] = await Promise.all([
        tx.taskCollaborator.findMany({
          where: {
            assistantId: oldAssistantId,
            taskId: { not: candidate.task.id },
            status: { in: WORKING_PARTICIPANT_STATUSES },
            task: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
          },
          select: {
            status: true,
            task: {
              select: {
                roomNumber: true,
                category: { select: { name: true } },
              },
            },
          },
        }),
        tx.bookingTask.findMany({
          where: {
            id: { not: candidate.task.id },
            assistantId: oldAssistantId,
            status: { in: [TaskStatus.executing, TaskStatus.paused] },
          },
          select: {
            status: true,
            roomNumber: true,
            category: { select: { name: true } },
          },
        }),
      ]);
      const oldAssistantActiveWork =
        oldAssistantOtherParticipants.find((participant) => participant.status === "executing") ||
        oldAssistantOtherTasks.find((task) => task.status === TaskStatus.executing) ||
        oldAssistantOtherParticipants.find((participant) => participant.status === "paused") ||
        oldAssistantOtherTasks.find((task) => task.status === TaskStatus.paused) ||
        null;
      const hasOtherExecutingWork =
        oldAssistantOtherParticipants.some((participant) => participant.status === "executing") ||
        oldAssistantOtherTasks.some((task) => task.status === TaskStatus.executing);
      const hasOtherPausedWork =
        oldAssistantOtherParticipants.some((participant) => participant.status === "paused") ||
        oldAssistantOtherTasks.some((task) => task.status === TaskStatus.paused);
      const oldAssistantSetOffline = !hasOtherExecutingWork && !hasOtherPausedWork;

      if (hasOtherExecutingWork || hasOtherPausedWork) {
        await tx.profile.update({
          where: { id: oldAssistantId },
          data: { status: hasOtherExecutingWork ? ProfileStatus.executing : ProfileStatus.busy },
        });
      } else {
        await tx.profile.update({
          where: { id: oldAssistantId },
          data: { status: ProfileStatus.idle, onlineStatus: OnlineStatus.offline, isOnline: false },
        });
      }
      await tx.profile.update({
        where: { id: newAssistant.id },
        data: { status: ProfileStatus.assigned },
      });
      await tx.standbyReassignmentNotice.create({
        data: {
          taskId: candidate.task.id,
          oldAssistantId,
          oldAssistantName,
          newAssistantId: newAssistant.id,
          newAssistantName: newAssistant.name,
          taskRoomNumber: candidate.task.roomNumber,
          taskCategoryName: candidate.task.category.name,
          taskPriority: candidate.task.priority,
          waitedMinutes: candidate.waitedMinutes,
          thresholdMinutes,
          score: candidate.score,
          reason: oldAssistantSetOffline
            ? "standby_timeout_offline"
            : hasOtherExecutingWork
              ? "standby_timeout_old_assistant_executing"
              : "standby_timeout_old_assistant_paused",
          oldAssistantSetOffline,
          oldAssistantActiveTaskRoomNumber:
            oldAssistantActiveWork && "task" in oldAssistantActiveWork
              ? oldAssistantActiveWork.task.roomNumber
              : oldAssistantActiveWork?.roomNumber ?? null,
          oldAssistantActiveTaskCategoryName:
            oldAssistantActiveWork && "task" in oldAssistantActiveWork
              ? oldAssistantActiveWork.task.category.name
              : oldAssistantActiveWork?.category.name ?? null,
          oldAssistantActiveTaskStatus:
            oldAssistantActiveWork?.status ?? null,
        },
      });
    });
    await recordIdleDispatchRoundRobin(candidate.buildingId, newAssistant.id);
    reassignedCount++;
    console.log(
      `[reassignOverdueStandbyTasks] ${candidate.task.id} ${oldAssistantName} → ${newAssistant.name}, score=${candidate.score}`
    );
  }

  return reassignedCount;
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
	    let assignedCount = 0;
	    await releaseAllEligiblePhotographerLimitQueuedTasks();
	    assignedCount += await reassignOverdueStandbyTasks();

	    // —— 阶段 A：空闲助理 ↔ 未派单 waiting（原逻辑）——
    const idleAssistants = await prisma.profile.findMany({
      where: {
        role: { in: ["assistant", "assistant_leader"] },
        status: ProfileStatus.idle,
        onlineStatus: OnlineStatus.online,
        subStatus: null,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    if (idleAssistants.length > 0) {
      const collaboratorIds = await activeCollaboratorAssistantIds(idleAssistants.map((a) => a.id));
      const trulyIdle = idleAssistants.filter((a) => !collaboratorIds.includes(a.id));
      if (trulyIdle.length > 0) {
        const waitingTasks = await prisma.bookingTask.findMany({
          where: {
            status: TaskStatus.waiting,
            assistantId: null,
            ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
          },
          include: { photographer: { select: { buildingId: true } } },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        });

        if (waitingTasks.length > 0) {
          const assistantsByBuilding = new Map<number, typeof trulyIdle>();
          for (const a of trulyIdle) {
            const assistantBuildingId = a.activeBuildingId ?? a.buildingId;
            if (assistantBuildingId == null) continue;
            const list = assistantsByBuilding.get(assistantBuildingId) || [];
            list.push(a);
            assistantsByBuilding.set(assistantBuildingId, list);
          }

          const dispatchQueuesByBuilding = new Map<number, string[]>();
          for (const [buildingId, list] of assistantsByBuilding) {
            const ordered = await buildIdleDispatchOrder(buildingId, list);
            dispatchQueuesByBuilding.set(buildingId, ordered.map((a) => a.id));
          }

          for (const task of waitingTasks) {
            const buildingId = task.locationBuildingId ?? task.photographer.buildingId;
            if (buildingId == null) continue;
            const available = dispatchQueuesByBuilding.get(buildingId);
            if (!available || available.length === 0) continue;

            const assistantId = available.shift()!;

            await prisma.$transaction([
              prisma.bookingTask.update({
                where: { id: task.id },
                data: { assistantId },
              }),
              prisma.taskCollaborator.upsert({
                where: { taskId_assistantId: { taskId: task.id, assistantId } },
                create: { taskId: task.id, assistantId, role: "primary", status: "waiting" },
                update: { role: "primary", status: "waiting", leftAt: null },
              }),
              prisma.profile.update({
                where: { id: assistantId },
                data: { status: ProfileStatus.assigned },
              }),
            ]);
            await recordIdleDispatchRoundRobin(buildingId, assistantId);

            console.log(`[sweepWaitingTasks] 助理 ${assistantId} 分配任务 ${task.id} (P${task.priority})`);
            assignedCount++;
          }
        }
      }
    }

    // —— 阶段 B：仍无助理的 waiting → 待就位插单（与 POST /api/tasks 一致；修复「全楼无 idle 时 sweep 直接返回」导致永不插单）——
    const stillOrphans = await prisma.bookingTask.findMany({
      where: {
        status: TaskStatus.waiting,
        assistantId: null,
        ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
      },
      include: {
        photographer: { select: { buildingId: true } },
        category: { select: { maxDuration: true, estDuration: true } },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    for (const task of stillOrphans) {
      const bid = task.locationBuildingId ?? task.photographer.buildingId;
      if (bid == null) continue;
      const ok = await interruptWaitingPreempt(bid, task.id, task.priority, taskLeaveUpperMinutes(task.category));
      if (ok) {
        console.log(`[sweepWaitingTasks] 待就位插单 任务 ${task.id} (P${task.priority}) → 楼座 ${bid}`);
        assignedCount++;
      }
    }

    return assignedCount;
  } finally {
    _sweepRunning = false;
  }
}

/**
 * 判断是否可以插单
 * 新任务须比当前执行单更紧急（priority 数值更小）；当前单须为 P2+、类型允许被打断、未锁定。
 * 新任务离场时长是否合规由路由层在筛选候选时校验（全局+类型 maxInterrupt）。
 */
export async function canInterrupt(
  assistantId: string,
  newPriority: number,
  newTaskLeaveUpperMin?: number
): Promise<boolean> {
  const currentTask = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.executing,
    },
    include: { category: true },
  });

  if (!currentTask) return false;

  if (currentTask.parentTaskId) return false;

  if (await assistantHasPendingInterruptTask(assistantId)) return false;

  if (await taskHasActiveHelperParticipants(currentTask.id)) return false;

  if (!taskCategoryCanBeInterrupted(currentTask.category)) return false;

  // 执行中 P1 不可被插断
  if (currentTask.priority <= PRIORITY.P1) return false;

  // 新单须更紧急（数值更小），同级或更低优先不可插
  if (newPriority >= currentTask.priority) return false;

  if (currentTask.isLocked) return false;

  if (newTaskLeaveUpperMin != null) {
    const cfg = await getSchedulerRuntimeConfig();
    const cap = effectiveInterruptLeaveCapMinutes(cfg.INTERRUPT_MAX_MINUTES, currentTask.category.maxInterruptMinutes);
    if (newTaskLeaveUpperMin > cap) return false;
  }

  return true;
}

/**
 * 执行插单操作
 * 将新任务分配给助理并记录 parentTaskId，不立即暂停当前任务。
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

  if (currentTask.parentTaskId) return false;

  if (await assistantHasPendingInterruptTask(assistantId)) return false;

  // 只分配新任务 + 记录父任务，不改变旧任务状态，不改变助理状态
  await prisma.$transaction(async (tx) => {
    await tx.bookingTask.update({
      where: { id: newTaskId },
      data: { assistantId, parentTaskId: currentTask.id },
    });
    await tx.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId: newTaskId, assistantId } },
      create: { taskId: newTaskId, assistantId, role: "primary", status: "waiting" },
      update: { role: "primary", status: "waiting", leftAt: null },
    });
  });

  return true;
}

/**
 * 待就位让行：助理已分配到较低优先任务且尚未开始，新单更紧急时把新单挂到该助理下，
 * parentTaskId 指向原等待任务；原任务保持 waiting + assistantId（让行），完成后走 completeTask 恢复父任务待就位。
 * 新单最长时长必须落在原任务允许离场上限内，且同一助理不能叠加多个未完成临时接派任务。
 */
export async function interruptWaitingPreempt(
  buildingId: number,
  newTaskId: string,
  newPriority: number,
  newTaskLeaveUpperMin: number
): Promise<boolean> {
  const cfg = await getSchedulerRuntimeConfig();
  const globalInterruptCap = cfg.INTERRUPT_MAX_MINUTES;
  const assignedAssistants = await prisma.profile.findMany({
    where: {
      role: { in: ["assistant", "assistant_leader"] },
      status: ProfileStatus.assigned,
      onlineStatus: OnlineStatus.online,
      subStatus: null,
      OR: [
        { activeBuildingId: buildingId },
        { activeBuildingId: null, buildingId },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  type Row = { assistantId: string; priority: number; waitingTaskId: string };
  const rows: Row[] = [];

  for (const a of assignedAssistants) {
    const activeTasks = await prisma.bookingTask.findMany({
      where: {
        assistantId: a.id,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
      include: {
        category: {
          select: {
            canBeInterrupted: true,
            maxDuration: true,
            maxInterruptMinutes: true,
          },
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    if (activeTasks.some((task) => task.parentTaskId != null)) continue;
    if (activeTasks.length !== 1) continue;

    const waitingTask = activeTasks.find((task) =>
      task.status === TaskStatus.waiting &&
      task.parentTaskId == null &&
      !task.isLocked
    );
    if (!waitingTask) continue;
    if (await taskHasActiveHelperParticipants(waitingTask.id)) continue;
    if (!taskCategoryCanBeInterrupted(waitingTask.category)) continue;
    const cap = effectiveInterruptLeaveCapMinutes(globalInterruptCap, waitingTask.category.maxInterruptMinutes);
    if (newTaskLeaveUpperMin > cap) continue;
    // 新单更紧急（数值更小）才可抢占待就位
    if (waitingTask.priority <= newPriority) continue;
    rows.push({
      assistantId: a.id,
      priority: waitingTask.priority,
      waitingTaskId: waitingTask.id,
    });
  }

  if (rows.length === 0) return false;

  const filtered = rows.map((r) => ({ assistantId: r.assistantId, priority: r.priority }));
  const order = await buildP1InterruptCandidateOrderFromFiltered(buildingId, filtered);

  for (const item of order) {
    const row = rows.find((r) => r.assistantId === item.assistantId);
    if (!row) continue;
    await prisma.$transaction(async (tx) => {
      await tx.bookingTask.update({
        where: { id: newTaskId },
        data: { assistantId: row.assistantId, parentTaskId: row.waitingTaskId },
      });
      await tx.taskCollaborator.upsert({
        where: { taskId_assistantId: { taskId: newTaskId, assistantId: row.assistantId } },
        create: { taskId: newTaskId, assistantId: row.assistantId, role: "primary", status: "waiting" },
        update: { role: "primary", status: "waiting", leftAt: null },
      });
    });
    await recordP1InterruptRoundRobin(buildingId, row.assistantId);
    return true;
  }

  return false;
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
 * 仅对未分配助理的队列任务生效；已派发待就位任务不参与普通队列提权。
 * P2/P3/P4/P5 任务等待超过阈值后，优先级自动向上提一级。
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
      assistantId: null,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
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
          escalatedFromPriority: task.escalatedFromPriority ?? task.priority,
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

  if (!task) return;
  if (task.assistantId) {
    await ensurePrimaryParticipant(taskId, task.assistantId, participantStatusFromTaskStatus(task.status));
  }

  const now = new Date();
  const completeData = (() => {
    const flushed = flushExecutingSegment({
      effectiveWorkSeconds: task.effectiveWorkSeconds,
      workSegmentStartedAt: task.workSegmentStartedAt,
      startedAt: task.startedAt,
      status: task.status,
    });
    return {
      status: TaskStatus.completed,
      completedAt: now,
      effectiveWorkSeconds: flushed.effectiveWorkSeconds,
      workSegmentStartedAt: null,
    };
  })();

  const participants = await prisma.taskCollaborator.findMany({
    where: { taskId, status: { not: "left" } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.bookingTask.update({
      where: { id: taskId },
      data: completeData,
    });

    for (const participant of participants) {
      const flushed = flushExecutingSegment({
        effectiveWorkSeconds: participant.effectiveWorkSeconds,
        workSegmentStartedAt: participant.workSegmentStartedAt,
        startedAt: participant.startedAt,
        status: participant.status,
      });
      await tx.taskCollaborator.update({
        where: { id: participant.id },
        data: {
          status: "completed",
          completedAt: now,
          leftAt: now,
          effectiveWorkSeconds: flushed.effectiveWorkSeconds,
          workSegmentStartedAt: null,
        },
      });
    }
  });

  await syncTaskAggregateFromParticipants(taskId);
  await syncProfileStatus();

  // 全局扫描：将所有空闲助理与等待中的任务匹配
  await sweepWaitingTasks();
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
      select: {
        assistantId: true,
        status: true,
        collaborators: {
          where: { status: { not: "left" } },
          select: { assistantId: true },
        },
      },
    });

    const activeCollaborations = await prisma.taskCollaborator.findMany({
      where: {
        assistantId: { in: assistants.map((a) => a.id) },
        status: { in: ACTIVE_PARTICIPANT_STATUSES },
        task: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
      },
      select: {
        assistantId: true,
        status: true,
      },
    });

    // 按助理聚合：取最高优先状态 executing > waiting > paused
    const taskStatusMap = new Map<string, string>();
    const rememberStatus = (assistantId: string | null, status: string) => {
      if (!assistantId) return;
      const cur = taskStatusMap.get(assistantId);
      if (!cur || status === "executing" || (status === "waiting" && cur === "paused")) {
        taskStatusMap.set(assistantId, status);
      }
    };
    for (const t of activeTasks) {
      if (t.collaborators.some((c) => c.assistantId === t.assistantId)) continue;
      rememberStatus(t.assistantId, t.status);
    }
    for (const c of activeCollaborations) {
      rememberStatus(c.assistantId, c.status);
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
