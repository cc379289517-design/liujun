import { prisma } from "./prisma";
import { Prisma, TaskStatus, ProfileStatus, OnlineStatus, IroningTaskStage, PriorityUpgradeRequestStatus, Role } from "@/generated/prisma/client";
import { PRIORITY, SCHEDULER_CONFIG } from "@/types";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";
import { isIroningCategoryName } from "@/lib/ironingRules";
import { getIroningRuntimeConfig } from "@/lib/ironingRuntime";
import { getStandbyReassignRuntimeConfig } from "@/lib/standbyReassignRuntime";
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
const PASSIVE_IRONING_STAGES = [IroningTaskStage.waiting_machine, IroningTaskStage.notified] as const;
const NOT_PASSIVE_IRONING_WAIT_WHERE = {
  OR: [
    { status: { not: TaskStatus.waiting } },
    {
      AND: [
        { ironingStage: { notIn: [...PASSIVE_IRONING_STAGES] } },
        {
          OR: [
            { assistantId: null },
            { category: { name: { not: { contains: "熨" } } } },
          ],
        },
      ],
    },
  ],
};
const NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE = {
  OR: [
    { lockReason: null },
    { lockReason: { not: PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON } },
  ],
};
const SCHEDULER_DEBUG_LOG_ENABLED = process.env.SPAD_SCHEDULER_DEBUG === "1";

function schedulerDebugLog(message: string) {
  if (SCHEDULER_DEBUG_LOG_ENABLED) console.log(message);
}

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

export function isExternalModelFollowTask(task: {
  priority: number;
  category?: { name?: string | null } | null;
}): boolean {
  const categoryName = task.category?.name?.trim() ?? "";
  const isNamedExternalModelTask =
    categoryName.includes("外模") &&
    (categoryName.includes("协助") || categoryName.includes("跟拍") || categoryName.includes("拍摄"));
  return isNamedExternalModelTask || (task.priority === 6 && categoryName === "其他");
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
const ironingBuildingLocks = new Map<number, Promise<void>>();

async function withIroningBuildingLock<T>(buildingId: number, fn: () => Promise<T>): Promise<T> {
  const previous = ironingBuildingLocks.get(buildingId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);
  ironingBuildingLocks.set(buildingId, next);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (ironingBuildingLocks.get(buildingId) === next) {
      ironingBuildingLocks.delete(buildingId);
    }
  }
}

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

export async function dispatchableAssistantIds(assistantIds: string[]): Promise<Set<string>> {
  if (assistantIds.length === 0) return new Set();

  const [blockingTasks, blockingCollaborators] = await Promise.all([
    prisma.bookingTask.findMany({
      where: {
        assistantId: { in: assistantIds },
        status: { in: [...ACTIVE_TASK_STATUSES] },
        AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    }),
    prisma.taskCollaborator.findMany({
      where: {
        assistantId: { in: assistantIds },
        status: { in: ACTIVE_PARTICIPANT_STATUSES },
        task: {
          status: { in: [...ACTIVE_TASK_STATUSES] },
          AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
        },
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    }),
  ]);

  const blocked = new Set<string>();
  for (const row of blockingTasks) {
    if (row.assistantId) blocked.add(row.assistantId);
  }
  for (const row of blockingCollaborators) {
    blocked.add(row.assistantId);
  }

  return new Set(assistantIds.filter((id) => !blocked.has(id)));
}

async function dispatchableAssistantsForBuilding(buildingId: number) {
  const candidates = await prisma.profile.findMany({
    where: {
      role: { in: ["assistant", "assistant_leader"] },
      onlineStatus: OnlineStatus.online,
      subStatus: null,
      OR: [
        { status: ProfileStatus.idle },
        { status: ProfileStatus.assigned },
      ],
      AND: [
        {
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const dispatchableIds = await dispatchableAssistantIds(candidates.map((a) => a.id));
  return candidates.filter((a) => dispatchableIds.has(a.id));
}

async function activeCollaboratorAssistantIds(assistantIds?: string[]): Promise<string[]> {
  const rows = await prisma.taskCollaborator.findMany({
    where: {
      status: { in: ACTIVE_PARTICIPANT_STATUSES },
      ...(assistantIds ? { assistantId: { in: assistantIds } } : {}),
      task: {
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
        AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      },
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

function isPassiveIroningStage(stage: IroningTaskStage): boolean {
  return stage === IroningTaskStage.waiting_machine || stage === IroningTaskStage.notified;
}

function isPassiveUnstartedIroningWait(task: {
  status: TaskStatus;
  ironingStage: IroningTaskStage;
  assistantId?: string | null;
  category?: { name?: string | null } | null;
}): boolean {
  return task.status === TaskStatus.waiting &&
    isIroningTaskCategory(task.category) &&
    (isPassiveIroningStage(task.ironingStage) || (task.ironingStage === IroningTaskStage.none && !!task.assistantId));
}

async function assistantHasPassiveIroningWait(assistantId: string): Promise<boolean> {
  const task = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.waiting,
      OR: [
        { ironingStage: { in: [...PASSIVE_IRONING_STAGES] } },
        { ironingStage: IroningTaskStage.none, category: { name: { contains: "熨" } } },
      ],
    },
    select: { id: true },
  });
  return task != null;
}

async function assistantHasPendingIroningWait(assistantId: string): Promise<boolean> {
  const task = await prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: TaskStatus.waiting,
      OR: [
        { ironingStage: { in: [...PASSIVE_IRONING_STAGES] } },
        { ironingStage: IroningTaskStage.none, category: { name: { contains: "熨" } } },
      ],
    },
    select: { id: true },
  });
  return task != null;
}

async function assistantHasActiveNonPassiveWork(assistantId: string): Promise<boolean> {
  const [task, participant] = await Promise.all([
    prisma.bookingTask.findFirst({
      where: {
        assistantId,
        status: { in: [TaskStatus.executing, TaskStatus.paused] },
      },
      select: { id: true },
    }),
    prisma.taskCollaborator.findFirst({
      where: {
        assistantId,
        status: { in: [TaskStatus.executing, TaskStatus.paused] },
        task: {
          status: { in: [TaskStatus.executing, TaskStatus.paused] },
        },
      },
      select: { id: true },
    }),
  ]);
  return task != null || participant != null;
}

async function activeWorkingAssistantIds(assistantIds: string[]): Promise<Set<string>> {
  if (assistantIds.length === 0) return new Set();

  const [tasks, participants] = await Promise.all([
    prisma.bookingTask.findMany({
      where: {
        assistantId: { in: assistantIds },
        status: { in: [TaskStatus.executing, TaskStatus.paused] },
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    }),
    prisma.taskCollaborator.findMany({
      where: {
        assistantId: { in: assistantIds },
        status: { in: WORKING_PARTICIPANT_STATUSES },
        task: {
          status: { in: [TaskStatus.executing, TaskStatus.paused] },
        },
      },
      select: { assistantId: true },
      distinct: ["assistantId"],
    }),
  ]);

  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.assistantId) ids.add(task.assistantId);
  }
  for (const participant of participants) {
    ids.add(participant.assistantId);
  }
  return ids;
}

function isIroningTaskCategory(category: { name?: string | null } | null | undefined): boolean {
  return isIroningCategoryName(category?.name);
}

function taskEffectiveBuildingId(task: {
  locationBuildingId?: number | null;
  photographer?: { buildingId: number } | null;
}): number | null {
  return task.locationBuildingId ?? task.photographer?.buildingId ?? null;
}

function profileEffectiveBuildingId(profile: {
  activeBuildingId?: number | null;
  buildingId: number;
}): number {
  return profile.activeBuildingId ?? profile.buildingId;
}

export function ironingMachineSlotsForTask(task: {
  assistantId?: string | null;
  collaborators?: { assistantId: string; status: string }[] | null;
}): number {
  const activeAssistantIds = new Set<string>();
  const participants = task.collaborators ?? [];

  for (const participant of participants) {
    if (participant.status !== "left" && participant.status !== "completed") {
      activeAssistantIds.add(participant.assistantId);
    }
  }

  if (task.assistantId) {
    const primaryParticipant = participants.find((participant) => participant.assistantId === task.assistantId);
    if (!primaryParticipant || (primaryParticipant.status !== "left" && primaryParticipant.status !== "completed")) {
      activeAssistantIds.add(task.assistantId);
    }
  }

  return Math.max(1, activeAssistantIds.size);
}

function taskDurationSortMinutes(task: {
  category?: { minDuration?: number | null; estDuration?: number | null; maxDuration?: number | null } | null;
}): number {
  return task.category?.minDuration ?? task.category?.estDuration ?? task.category?.maxDuration ?? 9999;
}

function taskMaxDurationSortMinutes(task: {
  category?: { maxDuration?: number | null; estDuration?: number | null; minDuration?: number | null } | null;
}): number {
  return task.category?.maxDuration ?? task.category?.estDuration ?? task.category?.minDuration ?? 9999;
}

export async function hasIroningQueuePressure(buildingId: number): Promise<boolean> {
  const task = await prisma.bookingTask.findFirst({
    where: {
      status: TaskStatus.waiting,
      ironingStage: { in: [IroningTaskStage.waiting_machine, IroningTaskStage.notified] },
      category: { name: { contains: "熨" } },
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      OR: [
        { locationBuildingId: buildingId },
        { locationBuildingId: null, photographer: { buildingId } },
      ],
    },
    select: { id: true },
  });
  return task != null;
}

export async function isIroningInterruptProtected(task: {
  status: TaskStatus;
  ironingStage: IroningTaskStage;
  locationBuildingId?: number | null;
  photographer?: { buildingId: number } | null;
  category?: { name?: string | null } | null;
}): Promise<boolean> {
  if (task.status !== TaskStatus.executing) return false;
  if (!isIroningTaskCategory(task.category)) return false;

  const buildingId = taskEffectiveBuildingId(task);
  if (buildingId == null) return false;
  return hasIroningQueuePressure(buildingId);
}

type SchedulerTransaction = Prisma.TransactionClient;

async function normalIroningMachineCount(
  buildingId: number,
  client: typeof prisma | SchedulerTransaction = prisma
): Promise<number> {
  return client.ironingMachine.count({
    where: { buildingId, status: "normal" },
  });
}

async function executingIroningMachineSlotCount(
  buildingId: number,
  excludeTaskId?: string,
  client: typeof prisma | SchedulerTransaction = prisma
): Promise<number> {
  const tasks = await client.bookingTask.findMany({
    where: {
      id: excludeTaskId ? { not: excludeTaskId } : undefined,
      status: TaskStatus.executing,
      category: { name: { contains: "熨" } },
      OR: [
        { locationBuildingId: buildingId },
        { locationBuildingId: null, photographer: { buildingId } },
      ],
    },
    select: {
      assistantId: true,
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
  });

  return tasks.reduce((total, task) => total + ironingMachineSlotsForTask(task), 0);
}

async function availableIroningMachineSlots(
  buildingId: number,
  excludeTaskId?: string,
  client: typeof prisma | SchedulerTransaction = prisma
): Promise<number> {
  const [machines, occupiedSlots] = await Promise.all([
    normalIroningMachineCount(buildingId, client),
    executingIroningMachineSlotCount(buildingId, excludeTaskId, client),
  ]);
  return Math.max(0, machines - occupiedSlots);
}

async function notifiedIroningMachineSlotCount(
  buildingId: number,
  excludeTaskId?: string,
  client: typeof prisma | SchedulerTransaction = prisma
): Promise<number> {
  const tasks = await client.bookingTask.findMany({
    where: {
      id: excludeTaskId ? { not: excludeTaskId } : undefined,
      status: TaskStatus.waiting,
      ironingStage: IroningTaskStage.notified,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      OR: [
        { locationBuildingId: buildingId },
        { locationBuildingId: null, photographer: { buildingId } },
      ],
    },
    select: {
      assistantId: true,
      category: { select: { name: true } },
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
  });

  return tasks.reduce((total, task) => {
    if (!isIroningTaskCategory(task.category)) return total;
    return total + ironingMachineSlotsForTask(task);
  }, 0);
}

async function availableIroningMachineSlotsIncludingClaims(
  buildingId: number,
  excludeTaskId?: string,
  client: typeof prisma | SchedulerTransaction = prisma
): Promise<number> {
  const [machines, occupiedSlots, notifiedSlots] = await Promise.all([
    normalIroningMachineCount(buildingId, client),
    executingIroningMachineSlotCount(buildingId, excludeTaskId, client),
    notifiedIroningMachineSlotCount(buildingId, excludeTaskId, client),
  ]);
  return Math.max(0, machines - occupiedSlots - notifiedSlots);
}

export async function ironingMachineAvailabilityForTask(taskId: string): Promise<{
  ok: boolean;
  available: number;
  occupied: number;
  required: number;
}> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
  });
  if (!task || !isIroningTaskCategory(task.category)) {
    return { ok: true, available: 0, occupied: 0, required: 0 };
  }

  const buildingId = taskEffectiveBuildingId(task);
  if (buildingId == null) return { ok: false, available: 0, occupied: 0, required: 0 };

  const [available, occupied] = await Promise.all([
    normalIroningMachineCount(buildingId),
    executingIroningMachineSlotCount(buildingId, taskId),
  ]);
  const required = ironingMachineSlotsForTask(task);

  return {
    ok: Math.max(0, available - occupied) >= required,
    available,
    occupied,
    required,
  };
}

export async function hasAvailableIroningMachineForTask(taskId: string): Promise<boolean> {
  return (await ironingMachineAvailabilityForTask(taskId)).ok;
}

type AssistantStartCandidateTask = {
  id: string;
  assistantId: string | null;
  status: TaskStatus;
  priority: number;
  createdAt: Date;
  parentTaskId: string | null;
  isLocked: boolean;
  lockReason: string | null;
  ironingStage: IroningTaskStage;
  locationBuildingId: number | null;
  photographer: { buildingId: number };
  category: { name: string | null };
  collaborators: {
    assistantId: string;
    role: string;
    status: string;
    joinedAt: Date;
  }[];
};

async function isStartableNowForAssistant(
  task: AssistantStartCandidateTask,
  assistantId: string,
  buildingId: number
): Promise<boolean> {
  if (task.status !== TaskStatus.waiting) return false;
  const isOwnTask =
    task.assistantId === assistantId ||
    task.collaborators.some((participant) =>
      participant.assistantId === assistantId &&
      ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number])
    );

  if (!isIroningTaskCategory(task.category)) return isOwnTask;
  if (task.parentTaskId != null || isPhotographerLimitQueuedTask(task)) return false;
  if (!isOwnTask && task.isLocked) return false;
  if (task.collaborators.some((participant) =>
    participant.role === "helper" &&
    ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number])
  )) return false;
  if (task.ironingStage === IroningTaskStage.waiting_machine) return false;
  if (task.ironingStage === IroningTaskStage.notified) return isOwnTask || taskEffectiveBuildingId(task) === buildingId;
  return (await availableIroningMachineSlots(buildingId, task.id)) >= ironingMachineSlotsForTask(task);
}

export async function assertAssistantCanStartTaskByPriority(taskId: string, assistantId: string): Promise<void> {
  const target = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { not: "left" } },
        select: { assistantId: true, role: true, status: true, joinedAt: true },
      },
    },
  });
  if (!target || target.status !== TaskStatus.waiting) return;

  const assistant = await prisma.profile.findUnique({
    where: { id: assistantId },
    select: { buildingId: true, activeBuildingId: true },
  });
  if (!assistant) return;
  const buildingId = assistant.activeBuildingId ?? assistant.buildingId;

  const targetCandidate = target as AssistantStartCandidateTask;
  const targetStartable = await isStartableNowForAssistant(targetCandidate, assistantId, buildingId);
  if (!targetStartable) return;

  const areaWhere = {
    OR: [
      { locationBuildingId: buildingId },
      { locationBuildingId: null, photographer: { buildingId } },
    ],
  };

  const candidates = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      AND: [
        areaWhere,
        NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        {
          OR: [
            { assistantId },
            { collaborators: { some: { assistantId, status: { not: "left" } } } },
            { category: { name: { contains: "熨" } } },
          ],
        },
      ],
    },
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { not: "left" } },
        select: { assistantId: true, role: true, status: true, joinedAt: true },
      },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  for (const candidate of candidates as AssistantStartCandidateTask[]) {
    if (candidate.id === taskId) continue;
    if (candidate.priority >= target.priority) continue;
    if (!(await isStartableNowForAssistant(candidate, assistantId, buildingId))) continue;
    throw new Error("当前有更高优先级任务可开始，请先处理更紧急任务");
  }
}

export async function prepareWaitingTaskForAssistantStart(taskId: string, assistantId: string): Promise<void> {
  const readyTransfer = await prisma.taskAssistantTransferRequest.findFirst({
    where: {
      taskId,
      targetAssistantId: assistantId,
      status: "ready_to_takeover",
    },
    orderBy: { targetConfirmedAt: "desc" },
  });
  if (readyTransfer) {
    await executePrimaryAssistantTransfer(
      readyTransfer.taskId,
      readyTransfer.fromAssistantId,
      readyTransfer.targetAssistantId,
      readyTransfer.id,
    );
    return;
  }

  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { not: "left" } },
        select: { assistantId: true, role: true, status: true },
      },
    },
  });
  if (!task || task.status !== TaskStatus.waiting) return;

  const actorParticipant = task.collaborators.find((participant) => participant.assistantId === assistantId);
  if (task.assistantId === assistantId || actorParticipant) return;

  if (!isIroningTaskCategory(task.category)) return;
  if (task.parentTaskId != null || isPhotographerLimitQueuedTask(task)) {
    throw new Error("该熨烫任务暂不能被当前助理接手");
  }
  if (await taskHasActiveHelperParticipants(taskId)) {
    throw new Error("多人协作任务不能被临时接手");
  }

  const assistant = await prisma.profile.findUnique({
    where: { id: assistantId },
    select: {
      role: true,
      onlineStatus: true,
      subStatus: true,
      buildingId: true,
      activeBuildingId: true,
    },
  });
  if (!assistant || (assistant.role !== "assistant" && assistant.role !== "assistant_leader")) {
    throw new Error("只有助理可以开始该任务");
  }
  if (assistant.onlineStatus !== OnlineStatus.online || assistant.subStatus) {
    throw new Error("当前助理暂不可接手该任务");
  }

  const buildingId = taskEffectiveBuildingId(task);
  const assistantBuildingId = assistant.activeBuildingId ?? assistant.buildingId;
  if (buildingId == null || assistantBuildingId !== buildingId) {
    throw new Error("当前助理不在该任务区域，不能接手熨烫任务");
  }

  const hasActiveWork = await assistantHasActiveNonPassiveWork(assistantId);
  if (hasActiveWork) {
    throw new Error("当前助理已有执行中或暂停中的任务，不能接手熨烫任务");
  }

  const activePrimary = task.collaborators.find((participant) =>
    participant.role === "primary" &&
    participant.status !== "left"
  );
  if (activePrimary && activePrimary.status !== "waiting") {
    throw new Error("该熨烫任务已被其他助理开始，不能接手");
  }

  const now = new Date();
  const claimed = await attachIroningTaskToAssistant(
    taskId,
    assistantId,
    IroningTaskStage.notified,
    true,
    now
  );
  if (!claimed) {
    await prisma.bookingTask.updateMany({
      where: {
        id: taskId,
        status: TaskStatus.waiting,
        ironingStage: { notIn: [IroningTaskStage.notified, IroningTaskStage.using] },
      },
      data: {
        ironingStage: IroningTaskStage.waiting_machine,
        ironingQueuedAt: task.ironingQueuedAt ?? now,
        ironingNotifiedAt: null,
      },
    });
    throw new Error("当前区域熨烫机正在使用，请等待上一位助理完成后再开始");
  }
  await syncProfileStatus();
}

async function notifiedIroningMachineClaimCountsByBuilding(): Promise<Map<number, number>> {
  const claimTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      ironingStage: IroningTaskStage.notified,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
    },
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
  });

  const counts = new Map<number, number>();
  for (const task of claimTasks) {
    if (!isIroningTaskCategory(task.category)) continue;
    const buildingId = taskEffectiveBuildingId(task);
    if (buildingId == null) continue;
    counts.set(buildingId, (counts.get(buildingId) ?? 0) + ironingMachineSlotsForTask(task));
  }
  return counts;
}

async function earliestAvailableAssistant(buildingId: number): Promise<string | null> {
  const activeTasks = await prisma.bookingTask.findMany({
    where: {
      status: { in: [TaskStatus.executing, TaskStatus.paused, TaskStatus.waiting] },
      AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      assistantId: { not: null },
      assistant: {
        role: { in: ["assistant", "assistant_leader"] },
        onlineStatus: OnlineStatus.online,
        subStatus: null,
        OR: [
          { activeBuildingId: buildingId },
          { activeBuildingId: null, buildingId },
        ],
      },
    },
    include: {
      assistant: { select: { id: true } },
      category: { select: { maxDuration: true, estDuration: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  const ranked = activeTasks
    .filter((task) => task.assistantId)
    .map((task) => {
      const fallbackMinutes = task.category.maxDuration || task.category.estDuration || 30;
      const startedAtMs = task.startedAt?.getTime();
      const expectedAt = task.estEndTime?.getTime()
        ?? (startedAtMs != null ? startedAtMs + fallbackMinutes * 60 * 1000 : Date.now() + fallbackMinutes * 60 * 1000);
      return { assistantId: task.assistantId!, expectedAt };
    })
    .sort((a, b) => a.expectedAt - b.expectedAt || a.assistantId.localeCompare(b.assistantId));

  return ranked[0]?.assistantId ?? null;
}

async function selectIdleAssistantForBuilding(buildingId: number): Promise<string | null> {
  const availableAssistants = await dispatchableAssistantsForBuilding(buildingId);
  if (availableAssistants.length === 0) return null;

  const [selected] = await buildIdleDispatchOrder(buildingId, availableAssistants);
  return selected?.id ?? null;
}

async function attachIroningTaskToAssistant(
  taskId: string,
  assistantId: string,
  stage: IroningTaskStage,
  occupyAssistant: boolean,
  now = new Date()
): Promise<boolean> {
  const taskForLock = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    select: {
      locationBuildingId: true,
      photographer: { select: { buildingId: true } },
    },
  });
  const lockBuildingId = taskForLock ? taskEffectiveBuildingId(taskForLock) : null;

  const claim = async (): Promise<boolean> => {
    try {
    await prisma.$transaction(async (tx) => {
      const task = await tx.bookingTask.findUnique({
        where: { id: taskId },
        include: {
          photographer: { select: { buildingId: true } },
          category: { select: { name: true } },
          collaborators: {
            where: { status: { notIn: ["left", "completed"] } },
            select: { assistantId: true, role: true, status: true },
          },
        },
      });
      if (
        !task ||
        task.status !== TaskStatus.waiting ||
        task.parentTaskId != null ||
        isPhotographerLimitQueuedTask(task) ||
        !isIroningTaskCategory(task.category)
      ) {
        throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);
      }

      const buildingId = taskEffectiveBuildingId(task);
      if (buildingId == null) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const assistant = await tx.profile.findFirst({
        where: {
          id: assistantId,
          role: { in: ["assistant", "assistant_leader"] },
          onlineStatus: OnlineStatus.online,
          subStatus: null,
          status: { in: [ProfileStatus.idle, ProfileStatus.assigned] },
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
        select: { id: true },
      });
      if (!assistant) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const blockingPrimary = await tx.bookingTask.findFirst({
        where: {
          assistantId,
          status: { in: [...ACTIVE_TASK_STATUSES] },
          AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
          id: { not: taskId },
        },
        select: { id: true },
      });
      if (blockingPrimary) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const blockingCollaboration = await tx.taskCollaborator.findFirst({
        where: {
          assistantId,
          status: { in: ACTIVE_PARTICIPANT_STATUSES },
          task: {
            id: { not: taskId },
            status: { in: [...ACTIVE_TASK_STATUSES] },
            AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
          },
        },
        select: { id: true },
      });
      if (blockingCollaboration) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      if (stage === IroningTaskStage.notified || stage === IroningTaskStage.using) {
        const freeSlots = await availableIroningMachineSlotsIncludingClaims(buildingId, taskId, tx);
        const requiredSlots = ironingMachineSlotsForTask({
          ...task,
          assistantId,
          collaborators: task.collaborators,
        });
        if (freeSlots < requiredSlots) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);
      }

      const previous = await tx.bookingTask.findUnique({
        where: { id: taskId },
        select: { assistantId: true },
      });

      if (previous?.assistantId && previous.assistantId !== assistantId) {
        await tx.taskCollaborator.updateMany({
          where: {
            taskId,
            assistantId: { not: assistantId },
            role: "primary",
            status: { not: "left" },
          },
          data: { status: "left", leftAt: now },
        });
      }

      const taskClaim = await tx.bookingTask.updateMany({
        where: {
          id: taskId,
          status: TaskStatus.waiting,
          assistantId: task.assistantId,
          parentTaskId: null,
          ironingStage: task.ironingStage,
          ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        },
        data: {
          assistantId,
          ironingStage: stage,
          ironingQueuedAt: stage === IroningTaskStage.waiting_machine ? now : undefined,
          ironingNotifiedAt: stage === IroningTaskStage.notified ? now : null,
        },
      });
      if (taskClaim.count !== 1) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      await tx.taskCollaborator.upsert({
        where: { taskId_assistantId: { taskId, assistantId } },
        create: { taskId, assistantId, role: "primary", status: "waiting", joinedAt: now },
        update: {
          role: "primary",
          status: "waiting",
          ...(previous?.assistantId === assistantId
            ? {}
            : {
              joinedAt: now,
              startedAt: null,
              completedAt: null,
              effectiveWorkSeconds: 0,
              workSegmentStartedAt: null,
            }),
          leftAt: null,
        },
      });
      if (occupyAssistant) {
        await tx.profile.update({
          where: { id: assistantId },
          data: { status: ProfileStatus.assigned },
        });
      }
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === CLAIM_ASSISTANT_UNAVAILABLE) return false;
    throw error;
  }
  };

  return lockBuildingId == null ? claim() : withIroningBuildingLock(lockBuildingId, claim);
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
      ironingStage: true,
      startedAt: true,
      completedAt: true,
      effectiveWorkSeconds: true,
      workSegmentStartedAt: true,
    },
  });
  if (!task) return null;

  if (task.assistantId && !isPassiveIroningStage(task.ironingStage)) {
    await prisma.taskCollaborator.updateMany({
      where: {
        taskId,
        role: "primary",
        assistantId: { not: task.assistantId },
        status: { not: "left" },
      },
      data: { status: "left", leftAt: new Date() },
    });
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
      ironingStage: nextStatus === TaskStatus.completed ? IroningTaskStage.none : undefined,
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
    include: {
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
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
  if (participant.role === "primary" && task.assistantId && task.assistantId !== assistantId) {
    throw new Error("该任务已转派给其他助理，当前助理不能继续操作");
  }
  if (participant.status === "completed" && nextStatus !== "completed") {
    throw new Error("Participant already completed this task");
  }

  const now = new Date();
  const estEndTime = estMinutes ? new Date(Date.now() + estMinutes * 60 * 1000) : task.estEndTime;

  if (nextStatus === "executing") {
    const isIroning = isIroningTaskCategory(task.category);
    const buildingId = isIroning ? taskEffectiveBuildingId(task) : null;
    const startParticipant = async () => {
      await prisma.$transaction(async (tx) => {
        const currentTask = await tx.bookingTask.findUnique({
          where: { id: taskId },
          include: {
            photographer: { select: { buildingId: true } },
            category: { select: { name: true } },
            collaborators: {
              where: { status: { notIn: ["left", "completed"] } },
              select: { assistantId: true, status: true },
            },
          },
        });
        if (!currentTask) throw new Error("Task not found");

        const currentParticipant = await tx.taskCollaborator.findUnique({
          where: { taskId_assistantId: { taskId, assistantId } },
        });
        if (!currentParticipant || currentParticipant.status === "left") {
          throw new Error("Assistant is not a participant of this task");
        }
        if (currentParticipant.role === "primary" && currentTask.assistantId && currentTask.assistantId !== assistantId) {
          throw new Error("该任务已转派给其他助理，当前助理不能继续操作");
        }
        if (currentParticipant.status === "completed") {
          throw new Error("Participant already completed this task");
        }

        const currentIsIroning = isIroningTaskCategory(currentTask.category);
        if (!currentTask.parentTaskId) {
          const blockingPrimary = await tx.bookingTask.findFirst({
            where: {
              id: { not: taskId },
              assistantId,
              status: { in: [TaskStatus.executing, TaskStatus.paused] },
            },
            select: { id: true },
          });
          if (blockingPrimary) {
            throw new Error("当前助理已有执行中或暂停中的任务，不能开始新的任务");
          }

          const blockingCollaboration = await tx.taskCollaborator.findFirst({
            where: {
              assistantId,
              status: { in: WORKING_PARTICIPANT_STATUSES },
              task: {
                id: { not: taskId },
                status: { in: [TaskStatus.executing, TaskStatus.paused] },
              },
            },
            select: { id: true },
          });
          if (blockingCollaboration) {
            throw new Error("当前助理已有执行中或暂停中的任务，不能开始新的任务");
          }
        }

        if (currentIsIroning && currentTask.ironingStage !== IroningTaskStage.using) {
          const currentBuildingId = taskEffectiveBuildingId(currentTask);
          if (currentBuildingId == null) throw new Error("Cannot resolve ironing task building");

          const slots = await availableIroningMachineSlotsIncludingClaims(currentBuildingId, taskId, tx);
          const requiredSlots = ironingMachineSlotsForTask(currentTask);
          if (slots < requiredSlots) {
            throw new Error("熨烫机暂时没有空位，请等待系统通知");
          }
        }

        await tx.taskCollaborator.update({
          where: { taskId_assistantId: { taskId, assistantId } },
          data: {
            status: "executing",
            startedAt: currentParticipant.startedAt ?? now,
            completedAt: null,
            leftAt: null,
            workSegmentStartedAt: now,
          },
        });
        await tx.bookingTask.update({
          where: { id: taskId },
          data: {
            estEndTime,
            pausedAt: null,
            ironingStage: currentIsIroning ? IroningTaskStage.using : undefined,
            ironingStartedAt: currentIsIroning ? currentTask.ironingStartedAt ?? now : undefined,
          },
        });
        await tx.profile.update({
          where: { id: assistantId },
          data: { status: ProfileStatus.executing },
        });
      });
    };

    if (buildingId == null) {
      await startParticipant();
    } else {
      await withIroningBuildingLock(buildingId, startParticipant);
    }
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
}

type ManualTransferMode = "immediate" | "reserved";
type AssistantTransferKind = "handoff" | "swap";
type AssistantTransferResponseMode = "pause_and_go" | "after_complete";

type ManualTransferTargetEligibility = {
  ok: boolean;
  mode?: ManualTransferMode;
  reason?: string;
};

async function manualTransferTargetEligibility(
  targetAssistantId: string,
  taskBuildingId: number,
): Promise<ManualTransferTargetEligibility> {
  const target = await prisma.profile.findUnique({
    where: { id: targetAssistantId },
    select: {
      id: true,
      role: true,
      status: true,
      onlineStatus: true,
      subStatus: true,
      buildingId: true,
      activeBuildingId: true,
    },
  });
  if (!target) return { ok: false, reason: "目标助理不存在" };
  if (target.role !== Role.assistant && target.role !== Role.assistant_leader) {
    return { ok: false, reason: "只能移交给助理或助理组长" };
  }
  if (target.onlineStatus !== OnlineStatus.online) return { ok: false, reason: "目标助理不在线" };
  if (target.subStatus) return { ok: false, reason: "目标助理当前处于吃饭/休假等状态" };
  if (profileEffectiveBuildingId(target) !== taskBuildingId) {
    return { ok: false, reason: "目标助理不在当前任务区域" };
  }

  const dispatchable = await dispatchableAssistantIds([targetAssistantId]);
  if (dispatchable.has(targetAssistantId)) return { ok: true, mode: "immediate" };

  const working = await activeWorkingAssistantIds([targetAssistantId]);
  if (working.has(targetAssistantId)) return { ok: true, mode: "reserved" };

  return { ok: false, reason: "目标助理已有待就位任务，暂不能接手" };
}

async function validateManualTransferTask(
  taskId: string,
  fromAssistantId: string,
) {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    include: {
      photographer: { select: { buildingId: true } },
      assistant: { select: { id: true, name: true } },
      category: { select: { name: true } },
      collaborators: { where: { status: { not: "left" } } },
      interruptTasks: {
        where: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
        select: { id: true },
      },
    },
  });
  if (!task) throw new Error("任务不存在");
  if (task.assistantId !== fromAssistantId) throw new Error("只有当前主助理可以发起移交");
  if (task.status === TaskStatus.completed) throw new Error("已完成任务不能移交");
  if (!task.startedAt) throw new Error("任务尚未开始，不能使用交换/移交");
  if (isIroningTaskCategory(task.category)) throw new Error("熨烫任务暂不支持交换/移交");
  if (isExternalModelFollowTask(task)) throw new Error("外模协助跟拍任务暂不支持交换/移交");
  if (task.parentTaskId || task.interruptTasks.length > 0) throw new Error("插单流程中的任务暂不支持交换/移交");
  if (task.collaborators.some((participant) => participant.role !== "primary")) {
    throw new Error("多人协作任务暂不支持交换/移交");
  }
  const taskBuildingId = taskEffectiveBuildingId(task);
  if (taskBuildingId == null) throw new Error("无法确认任务区域，不能移交");
  return { task, taskBuildingId };
}

async function activePrimaryWorkingTaskForAssistant(assistantId: string) {
  return prisma.bookingTask.findFirst({
    where: {
      assistantId,
      status: { in: [TaskStatus.executing, TaskStatus.paused] },
      collaborators: {
        some: {
          assistantId,
          role: "primary",
          status: { in: WORKING_PARTICIPANT_STATUSES },
        },
      },
    },
    include: {
      photographer: { select: { buildingId: true } },
      assistant: { select: { id: true, name: true } },
      category: { select: { name: true } },
      collaborators: { where: { status: { not: "left" } } },
      interruptTasks: {
        where: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
        select: { id: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

function flushPrimaryParticipant(
  task: Awaited<ReturnType<typeof validateManualTransferTask>>["task"],
  assistantId: string,
) {
  const participant = task.collaborators.find(
    (item) => item.role === "primary" && item.assistantId === assistantId
  );
  if (!participant) return { effectiveWorkSeconds: 0 };
  return flushExecutingSegment({
    effectiveWorkSeconds: participant.effectiveWorkSeconds,
    workSegmentStartedAt: participant.workSegmentStartedAt,
    startedAt: participant.startedAt,
    status: participant.status,
  });
}

function flushTaskWorkSegment(task: Awaited<ReturnType<typeof validateManualTransferTask>>["task"]) {
  return flushExecutingSegment({
    effectiveWorkSeconds: task.effectiveWorkSeconds,
    workSegmentStartedAt: task.workSegmentStartedAt,
    startedAt: task.startedAt,
    status: task.status,
  });
}

async function executePrimaryAssistantTransfer(
  taskId: string,
  fromAssistantId: string,
  targetAssistantId: string,
  transferRequestId?: string,
): Promise<"immediate"> {
  if (fromAssistantId === targetAssistantId) throw new Error("不能移交给自己");
  const { task, taskBuildingId } = await validateManualTransferTask(taskId, fromAssistantId);
  const targetEligibility = await manualTransferTargetEligibility(targetAssistantId, taskBuildingId);
  if (!targetEligibility.ok || targetEligibility.mode !== "immediate") {
    throw new Error(targetEligibility.reason ?? "目标助理当前不能立即接手");
  }

  const now = new Date();
  const flushedTask = flushTaskWorkSegment(task);
  const flushedPrimary = flushPrimaryParticipant(task, fromAssistantId);

  await prisma.$transaction(async (tx) => {
    await tx.taskCollaborator.updateMany({
      where: {
        taskId,
        assistantId: fromAssistantId,
        role: "primary",
        status: { in: ACTIVE_PARTICIPANT_STATUSES },
      },
      data: {
        status: "completed",
        completedAt: now,
        leftAt: now,
        effectiveWorkSeconds: flushedPrimary.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    await tx.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId, assistantId: targetAssistantId } },
      create: {
        taskId,
        assistantId: targetAssistantId,
        role: "primary",
        status: "waiting",
        joinedAt: now,
      },
      update: {
        role: "primary",
        status: "waiting",
        joinedAt: now,
        leftAt: null,
        completedAt: null,
        workSegmentStartedAt: null,
      },
    });
    await tx.bookingTask.update({
      where: { id: taskId },
      data: {
        assistantId: targetAssistantId,
        status: TaskStatus.waiting,
        pausedAt: null,
        effectiveWorkSeconds: flushedTask.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    if (transferRequestId) {
      await tx.taskAssistantTransferRequest.update({
        where: { id: transferRequestId },
        data: { status: "completed", completedAt: now },
      });
    }
    await tx.taskAssistantTransferRequest.updateMany({
      where: {
        taskId,
        status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] },
        ...(transferRequestId ? { id: { not: transferRequestId } } : {}),
      },
      data: { status: "canceled", canceledAt: now, reason: "任务已完成其他移交" },
    });
    await tx.profile.update({
      where: { id: targetAssistantId },
      data: { status: ProfileStatus.assigned },
    });
  });

  await syncProfileStatus();
  return "immediate";
}

async function executeImmediateAssistantSwap(
  taskId: string,
  fromAssistantId: string,
  targetAssistantId: string,
  counterpartTaskId: string,
  transferRequestId: string,
): Promise<"swap_immediate"> {
  if (fromAssistantId === targetAssistantId) throw new Error("不能和自己互换任务");
  if (taskId === counterpartTaskId) throw new Error("互换任务无效");

  const { task: sourceTask, taskBuildingId } = await validateManualTransferTask(taskId, fromAssistantId);
  const { task: counterpartTask, taskBuildingId: counterpartBuildingId } = await validateManualTransferTask(
    counterpartTaskId,
    targetAssistantId,
  );
  if (taskBuildingId !== counterpartBuildingId) throw new Error("互换任务不在同一区域");

  const targetEligibility = await manualTransferTargetEligibility(targetAssistantId, taskBuildingId);
  if (!targetEligibility.ok || targetEligibility.mode !== "reserved") {
    throw new Error(targetEligibility.reason ?? "目标助理当前不能互换任务");
  }

  const now = new Date();
  const flushedSourceTask = flushTaskWorkSegment(sourceTask);
  const flushedSourcePrimary = flushPrimaryParticipant(sourceTask, fromAssistantId);
  const flushedCounterpartTask = flushTaskWorkSegment(counterpartTask);
  const flushedCounterpartPrimary = flushPrimaryParticipant(counterpartTask, targetAssistantId);

  await prisma.$transaction(async (tx) => {
    await tx.taskCollaborator.updateMany({
      where: {
        taskId,
        assistantId: fromAssistantId,
        role: "primary",
        status: { in: ACTIVE_PARTICIPANT_STATUSES },
      },
      data: {
        status: "completed",
        completedAt: now,
        leftAt: now,
        effectiveWorkSeconds: flushedSourcePrimary.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    await tx.taskCollaborator.updateMany({
      where: {
        taskId: counterpartTaskId,
        assistantId: targetAssistantId,
        role: "primary",
        status: { in: ACTIVE_PARTICIPANT_STATUSES },
      },
      data: {
        status: "completed",
        completedAt: now,
        leftAt: now,
        effectiveWorkSeconds: flushedCounterpartPrimary.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    await tx.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId, assistantId: targetAssistantId } },
      create: { taskId, assistantId: targetAssistantId, role: "primary", status: "waiting", joinedAt: now },
      update: {
        role: "primary",
        status: "waiting",
        joinedAt: now,
        startedAt: null,
        completedAt: null,
        leftAt: null,
        workSegmentStartedAt: null,
      },
    });
    await tx.taskCollaborator.upsert({
      where: { taskId_assistantId: { taskId: counterpartTaskId, assistantId: fromAssistantId } },
      create: {
        taskId: counterpartTaskId,
        assistantId: fromAssistantId,
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
        leftAt: null,
        workSegmentStartedAt: null,
      },
    });
    await tx.bookingTask.update({
      where: { id: taskId },
      data: {
        assistantId: targetAssistantId,
        status: TaskStatus.waiting,
        pausedAt: null,
        effectiveWorkSeconds: flushedSourceTask.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    await tx.bookingTask.update({
      where: { id: counterpartTaskId },
      data: {
        assistantId: fromAssistantId,
        status: TaskStatus.waiting,
        pausedAt: null,
        effectiveWorkSeconds: flushedCounterpartTask.effectiveWorkSeconds,
        workSegmentStartedAt: null,
      },
    });
    await tx.taskAssistantTransferRequest.update({
      where: { id: transferRequestId },
      data: {
        status: "completed",
        responseMode: "pause_and_go",
        targetConfirmedAt: now,
        completedAt: now,
      },
    });
    await tx.taskAssistantTransferRequest.updateMany({
      where: {
        id: { not: transferRequestId },
        status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] },
        OR: [
          { taskId },
          { taskId: counterpartTaskId },
          { counterpartTaskId: taskId },
          { counterpartTaskId },
        ],
      },
      data: { status: "canceled", canceledAt: now, reason: "任务已互换，其他移交请求取消" },
    });
    await tx.profile.updateMany({
      where: { id: { in: [fromAssistantId, targetAssistantId] } },
      data: { status: ProfileStatus.assigned },
    });
  });

  await syncProfileStatus();
  return "swap_immediate";
}

export async function requestPrimaryAssistantTransfer(
  taskId: string,
  fromAssistantId: string,
  targetAssistantId: string,
): Promise<{ mode: ManualTransferMode; kind: AssistantTransferKind; requestId?: string; counterpartTaskId?: string | null }> {
  if (fromAssistantId === targetAssistantId) throw new Error("不能移交给自己");
  const { taskBuildingId } = await validateManualTransferTask(taskId, fromAssistantId);
  const existing = await prisma.taskAssistantTransferRequest.findFirst({
    where: { taskId, status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] } },
    select: { id: true },
  });
  if (existing) throw new Error("该任务已有移交请求，请等待目标助理处理后再操作");

  const targetEligibility = await manualTransferTargetEligibility(targetAssistantId, taskBuildingId);
  if (!targetEligibility.ok || !targetEligibility.mode) {
    throw new Error(targetEligibility.reason ?? "目标助理当前不能接手");
  }

  let kind: AssistantTransferKind = "handoff";
  let counterpartTaskId: string | null = null;
  if (targetEligibility.mode === "reserved") {
    const counterpartTask = await activePrimaryWorkingTaskForAssistant(targetAssistantId);
    if (!counterpartTask) throw new Error("未找到目标助理当前可互换的进行中任务");
    await validateManualTransferTask(counterpartTask.id, targetAssistantId);
    kind = "swap";
    counterpartTaskId = counterpartTask.id;
  }

  const request = await prisma.taskAssistantTransferRequest.create({
    data: {
      taskId,
      fromAssistantId,
      targetAssistantId,
      counterpartTaskId,
      kind,
      status: "confirming",
      reason: kind === "swap" ? "assistant_swap_confirming" : "assistant_handoff_confirming",
    },
  });
  return { mode: targetEligibility.mode, kind, requestId: request.id, counterpartTaskId };
}

export async function respondPrimaryAssistantTransfer(
  taskId: string,
  targetAssistantId: string,
  accepted: boolean,
  responseMode?: AssistantTransferResponseMode,
): Promise<{
  mode: "accepted" | "rejected";
  requestId: string;
  kind: AssistantTransferKind;
  responseMode?: AssistantTransferResponseMode | null;
}> {
  const request = await prisma.taskAssistantTransferRequest.findFirst({
    where: {
      taskId,
      targetAssistantId,
      status: "confirming",
    },
    include: {
      task: { select: { id: true, assistantId: true, status: true, completedAt: true } },
    },
    orderBy: { requestedAt: "desc" },
  });
  if (!request) throw new Error("未找到待确认的移交请求");
  if (!request.task || request.task.status === TaskStatus.completed || request.task.completedAt) {
    await prisma.taskAssistantTransferRequest.update({
      where: { id: request.id },
      data: { status: "expired", canceledAt: new Date(), reason: "任务已完成，移交请求失效" },
    });
    throw new Error("任务已完成，移交请求已失效");
  }
  if (request.task.assistantId !== request.fromAssistantId) {
    await prisma.taskAssistantTransferRequest.update({
      where: { id: request.id },
      data: { status: "expired", canceledAt: new Date(), reason: "任务负责人已变化，移交请求失效" },
    });
    throw new Error("任务负责人已变化，移交请求已失效");
  }

  const now = new Date();
  if (!accepted) {
    await prisma.taskAssistantTransferRequest.update({
      where: { id: request.id },
      data: { status: "rejected", canceledAt: now, reason: "目标助理拒绝接替" },
    });
    return { mode: "rejected", requestId: request.id, kind: request.kind as AssistantTransferKind };
  }

  const kind = request.kind as AssistantTransferKind;
  if (kind === "handoff") {
    await prisma.$transaction(async (tx) => {
      await tx.taskAssistantTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "ready_to_takeover",
          responseMode: null,
          targetConfirmedAt: now,
          reason: "target_assistant_confirmed_handoff_ready_to_takeover",
        },
      });
      await tx.profile.update({
        where: { id: request.targetAssistantId },
        data: { status: ProfileStatus.assigned },
      });
    });
    return { mode: "accepted", requestId: request.id, kind, responseMode: null };
  }

  if (!request.counterpartTaskId) {
    await prisma.taskAssistantTransferRequest.update({
      where: { id: request.id },
      data: { status: "expired", canceledAt: now, reason: "互换任务不存在，交换请求失效" },
    });
    throw new Error("互换任务不存在，交换请求已失效");
  }
  if (responseMode !== "pause_and_go" && responseMode !== "after_complete") {
    throw new Error("请选择暂停并前往或结束后前往");
  }

  if (responseMode === "pause_and_go") {
    await executeImmediateAssistantSwap(
      request.taskId,
      request.fromAssistantId,
      request.targetAssistantId,
      request.counterpartTaskId,
      request.id,
    );
    return { mode: "accepted", requestId: request.id, kind, responseMode };
  }

  await prisma.taskAssistantTransferRequest.update({
    where: { id: request.id },
    data: {
      status: "pending_after_complete",
      responseMode,
      targetConfirmedAt: now,
      reason: "target_assistant_confirmed_after_complete",
    },
  });
  return { mode: "accepted", requestId: request.id, kind, responseMode };
}

export async function processPendingTaskAssistantTransfers(): Promise<number> {
  const requests = await prisma.taskAssistantTransferRequest.findMany({
    where: { status: { in: ["pending", "pending_after_complete", "ready_to_takeover"] } },
    include: {
      task: {
        select: {
          id: true,
          assistantId: true,
          status: true,
          completedAt: true,
          roomNumber: true,
          priority: true,
          category: { select: { name: true } },
          assistant: { select: { name: true } },
        },
      },
      targetAssistant: { select: { name: true } },
    },
    orderBy: { requestedAt: "asc" },
    take: 20,
  });

  let completed = 0;
  for (const request of requests) {
    if (!request.task || request.task.status === TaskStatus.completed || request.task.completedAt) {
      await prisma.taskAssistantTransferRequest.update({
        where: { id: request.id },
        data: { status: "expired", canceledAt: new Date(), reason: "任务已完成，预约移交失效" },
      });
      continue;
    }
    if (request.task.assistantId !== request.fromAssistantId) {
      await prisma.taskAssistantTransferRequest.update({
        where: { id: request.id },
        data: { status: "expired", canceledAt: new Date(), reason: "任务负责人已变化，预约移交失效" },
      });
      continue;
    }

    if (request.status === "pending_after_complete") {
      const counterpartTask = request.counterpartTaskId
        ? await prisma.bookingTask.findUnique({
            where: { id: request.counterpartTaskId },
            select: { id: true, status: true, completedAt: true },
          })
        : null;
      if (!counterpartTask) {
        await prisma.taskAssistantTransferRequest.update({
          where: { id: request.id },
          data: { status: "expired", canceledAt: new Date(), reason: "候选助理原任务不存在，交换请求失效" },
        });
        continue;
      }
      if (counterpartTask.status !== TaskStatus.completed && !counterpartTask.completedAt) {
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.taskAssistantTransferRequest.update({
          where: { id: request.id },
          data: {
            status: "ready_to_takeover",
            reason: "target_assistant_completed_counterpart_ready_to_takeover",
          },
        });
        await tx.standbyReassignmentNotice.create({
          data: {
            taskId: request.taskId,
            oldAssistantId: request.fromAssistantId,
            oldAssistantName: request.task.assistant?.name ?? "原助理",
            newAssistantId: request.targetAssistantId,
            newAssistantName: request.targetAssistant.name,
            taskRoomNumber: request.task.roomNumber,
            taskCategoryName: request.task.category?.name ?? "任务",
            taskPriority: request.task.priority,
            waitedMinutes: 0,
            thresholdMinutes: 0,
            score: 0,
            reason: "assistant_swap_after_complete_ready",
            oldAssistantSetOffline: false,
            newAssistantAcknowledgedAt: new Date(),
          },
        });
      });
      completed++;
      continue;
    }

    if (request.status === "ready_to_takeover") {
      continue;
    }

    const task = await prisma.bookingTask.findUnique({
      where: { id: request.taskId },
      include: { photographer: { select: { buildingId: true } } },
    });
    const taskBuildingId = task ? taskEffectiveBuildingId(task) : null;
    if (taskBuildingId == null) continue;
    const targetEligibility = await manualTransferTargetEligibility(request.targetAssistantId, taskBuildingId);
    if (!targetEligibility.ok || targetEligibility.mode !== "immediate") continue;

    try {
      await executePrimaryAssistantTransfer(
        request.taskId,
        request.fromAssistantId,
        request.targetAssistantId,
        request.id,
      );
      completed++;
    } catch (error) {
      console.warn("[processPendingTaskAssistantTransfers]", error);
    }
  }

  return completed;
}

const CLAIM_ASSISTANT_UNAVAILABLE = "CLAIM_ASSISTANT_UNAVAILABLE";

async function claimWaitingTaskForAssistant(
  taskId: string,
  assistantId: string,
  buildingId: number
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const blockingPrimary = await tx.bookingTask.findFirst({
        where: {
          assistantId,
          status: { in: [...ACTIVE_TASK_STATUSES] },
          AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
        },
        select: { id: true },
      });
      if (blockingPrimary) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const blockingCollaboration = await tx.taskCollaborator.findFirst({
        where: {
          assistantId,
          status: { in: ACTIVE_PARTICIPANT_STATUSES },
          task: {
            status: { in: [...ACTIVE_TASK_STATUSES] },
            AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
          },
        },
        select: { id: true },
      });
      if (blockingCollaboration) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const assistantClaim = await tx.profile.updateMany({
        where: {
          id: assistantId,
          role: { in: ["assistant", "assistant_leader"] },
          onlineStatus: OnlineStatus.online,
          subStatus: null,
          status: { in: [ProfileStatus.idle, ProfileStatus.assigned] },
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
        data: { status: ProfileStatus.assigned },
      });
      if (assistantClaim.count !== 1) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      const taskClaim = await tx.bookingTask.updateMany({
        where: {
          id: taskId,
          status: TaskStatus.waiting,
          assistantId: null,
          parentTaskId: null,
          ironingStage: IroningTaskStage.none,
          ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        },
        data: { assistantId },
      });
      if (taskClaim.count !== 1) throw new Error(CLAIM_ASSISTANT_UNAVAILABLE);

      await tx.taskCollaborator.upsert({
        where: { taskId_assistantId: { taskId, assistantId } },
        create: { taskId, assistantId, role: "primary", status: "waiting" },
        update: { role: "primary", status: "waiting", leftAt: null },
      });
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === CLAIM_ASSISTANT_UNAVAILABLE) return false;
    throw error;
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
    include: {
      photographer: true,
      category: { select: { name: true } },
      collaborators: {
        where: { status: { notIn: ["left", "completed"] } },
        select: { assistantId: true, status: true },
      },
    },
  });
  if (!task || isPhotographerLimitQueuedTask(task)) return null;

  if (effectiveBuildingId == null) {
    effectiveBuildingId = task.locationBuildingId ?? task.photographer.buildingId;
  }

  const isIroning = isIroningTaskCategory(task.category);
  const requiredIroningSlots = isIroning ? ironingMachineSlotsForTask(task) : 0;

  // 查找同楼座可派发助理：真正空闲，或只挂着未开始熨烫等待的助理。
  const dispatchableAssistants = await dispatchableAssistantsForBuilding(effectiveBuildingId);

  if (dispatchableAssistants.length === 0) return null;

  const orderedAssistants = await buildIdleDispatchOrder(effectiveBuildingId, dispatchableAssistants);
  if (isIroning) {
    for (const assistant of orderedAssistants) {
      const ironingSlots = await availableIroningMachineSlotsIncludingClaims(effectiveBuildingId, taskId);
      const stage = ironingSlots >= requiredIroningSlots
        ? IroningTaskStage.notified
        : IroningTaskStage.waiting_machine;
      let claimed = await attachIroningTaskToAssistant(
        taskId,
        assistant.id,
        stage,
        stage === IroningTaskStage.notified
      );
      if (!claimed && stage === IroningTaskStage.notified) {
        claimed = await attachIroningTaskToAssistant(
          taskId,
          assistant.id,
          IroningTaskStage.waiting_machine,
          false
        );
      }
      if (!claimed) continue;
      await recordIdleDispatchRoundRobin(effectiveBuildingId, assistant.id);
      return assistant.id;
    }
  } else {
    for (const assistant of orderedAssistants) {
      const claimed = await claimWaitingTaskForAssistant(taskId, assistant.id, effectiveBuildingId);
      if (!claimed) continue;
      await recordIdleDispatchRoundRobin(effectiveBuildingId, assistant.id);
      return assistant.id;
    }
  }
  return null;
}

/**
 * 自动认领等待中的任务
 * 助理变为 idle 时调用，按优先级从高到低找第一个未分配的等待任务并分配
 */
export async function autoClaimWaitingTask(assistantId: string): Promise<string | null> {
  const assistant = await prisma.profile.findUnique({ where: { id: assistantId } });
  if (!assistant || assistant.onlineStatus !== OnlineStatus.online || assistant.subStatus) return null;
  if (assistant.status !== ProfileStatus.idle && assistant.status !== ProfileStatus.assigned) return null;

  const dispatchableIds = await dispatchableAssistantIds([assistantId]);
  if (!dispatchableIds.has(assistantId)) return null;
  const assistantBuildingId = assistant.activeBuildingId ?? assistant.buildingId;

  // 确认该助理确实没有活跃参与记录；协作任务里个人完成后应可释放接新单。
  const existingTask = await prisma.taskCollaborator.findFirst({
    where: {
      assistantId,
      status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
      task: {
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
        AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      },
    },
  });
  if (existingTask) return null;

  // 查找同楼座、未分配助理的等待任务（按优先级升序、创建时间升序）。
  // 实际落库仍走条件认领，避免多个入口同时把同一助理/任务抢到手。
  const waitingTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      assistantId: null,
      parentTaskId: null,
      ironingStage: IroningTaskStage.none,
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
      OR: [
        { locationBuildingId: assistantBuildingId },
        { locationBuildingId: null, photographer: { buildingId: assistantBuildingId } },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: 20,
  });

  for (const waitingTask of waitingTasks) {
    const claimed = await claimWaitingTaskForAssistant(waitingTask.id, assistantId, assistantBuildingId);
    if (!claimed) continue;
    await recordIdleDispatchRoundRobin(assistantBuildingId, assistantId);
    schedulerDebugLog(`[autoClaimWaitingTask] 助理 ${assistantId} 自动认领任务 ${waitingTask.id} (P${waitingTask.priority})`);
    return waitingTask.id;
  }

  return null;
}

function standbyReassignmentScore(priority: number, waitedMinutes: number, thresholdMinutes: number): number {
  const boundedPriority = Math.min(6, Math.max(1, Math.round(priority)));
  const priorityScore = (7 - boundedPriority) * thresholdMinutes;
  const overtimeScore = Math.max(0, waitedMinutes - thresholdMinutes);
  return priorityScore + overtimeScore;
}

export async function reassignOverdueStandbyTasks(): Promise<number> {
  const cfg = await getStandbyReassignRuntimeConfig();
  const thresholdMinutes = cfg.timeoutMinutes;
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

  const collaboratorIds = await activeCollaboratorAssistantIds(idleAssistants.map((a) => a.id));
  const trulyIdle = idleAssistants.filter((a) => !collaboratorIds.includes(a.id));

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
      AND: [
        NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        { ironingStage: { not: IroningTaskStage.waiting_machine } },
      ],
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
    if (isIroningTaskCategory(task.category) && task.ironingStage !== IroningTaskStage.notified) return [];
    const primary = task.collaborators.find((participant) => participant.assistantId === task.assistantId);
    if (!primary) return [];
    const waitingSince = isIroningTaskCategory(task.category) && task.ironingStage === IroningTaskStage.notified
      ? task.ironingNotifiedAt ?? primary.joinedAt
      : primary.joinedAt;
    const waitedMinutes = Math.floor((now.getTime() - waitingSince.getTime()) / 60000);
    if (waitedMinutes < thresholdMinutes) return [];
    const buildingId = task.locationBuildingId ?? task.photographer.buildingId;
    return [{
      task,
      buildingId,
      waitingSince,
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
    const oldAssistantId = candidate.task.assistantId;
    if (!oldAssistantId || !candidate.task.assistant) continue;
    if (!available || available.length === 0) {
      const isNotifiedIroning = isIroningTaskCategory(candidate.task.category) &&
        candidate.task.ironingStage === IroningTaskStage.notified;
      if (!isNotifiedIroning && await assistantHasPendingIroningWait(oldAssistantId)) {
        continue;
      }
      const hasActiveWork = await assistantHasActiveNonPassiveWork(oldAssistantId);
      if (hasActiveWork) continue;

      await prisma.$transaction(async (tx) => {
        if (!isNotifiedIroning) {
          await tx.bookingTask.update({
            where: { id: candidate.task.id },
            data: { assistantId: null },
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
        }
        await tx.profile.update({
          where: { id: oldAssistantId },
          data: { status: ProfileStatus.idle, onlineStatus: OnlineStatus.offline, isOnline: false },
        });
        await tx.standbyReassignmentNotice.create({
          data: {
            taskId: candidate.task.id,
            oldAssistantId,
            oldAssistantName: candidate.task.assistant!.name,
            newAssistantId: oldAssistantId,
            newAssistantName: candidate.task.assistant!.name,
            taskRoomNumber: candidate.task.roomNumber,
            taskCategoryName: candidate.task.category.name,
            taskPriority: candidate.task.priority,
            waitedMinutes: candidate.waitedMinutes,
            thresholdMinutes,
            score: candidate.score,
            reason: "standby_timeout_no_replacement_offline",
            oldAssistantSetOffline: true,
            newAssistantAcknowledgedAt: now,
          },
        });
      });
      reassignedCount++;
      schedulerDebugLog(
        `[reassignOverdueStandbyTasks] ${candidate.task.id} ${candidate.task.assistant.name} 待就位超时且无可替换助理，已离线`
      );
      continue;
    }

    const newAssistantId = available.shift()!;
    const newAssistant = trulyIdle.find((assistant) => assistant.id === newAssistantId);
    if (!newAssistant || newAssistant.id === oldAssistantId) continue;
    if (!isIroningTaskCategory(candidate.task.category) && await assistantHasPendingIroningWait(oldAssistantId)) {
      continue;
    }
    const oldAssistantName = candidate.task.assistant.name;

    await prisma.$transaction(async (tx) => {
      await tx.bookingTask.update({
        where: { id: candidate.task.id },
        data: {
          assistantId: newAssistant.id,
          ironingNotifiedAt: candidate.task.ironingStage === IroningTaskStage.notified ? now : undefined,
        },
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
            status: { in: ACTIVE_PARTICIPANT_STATUSES },
            task: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } },
          },
          select: {
            status: true,
            task: {
              select: {
                roomNumber: true,
                ironingStage: true,
                category: { select: { name: true } },
              },
            },
          },
        }),
        tx.bookingTask.findMany({
          where: {
            id: { not: candidate.task.id },
            assistantId: oldAssistantId,
            status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
          },
          select: {
            status: true,
            ironingStage: true,
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
      const oldAssistantHasPassiveIroningWait =
        oldAssistantOtherParticipants.some((participant) => isPassiveIroningStage(participant.task.ironingStage)) ||
        oldAssistantOtherTasks.some((task) => isPassiveIroningStage(task.ironingStage));
      const oldAssistantSetOffline = !hasOtherExecutingWork && !hasOtherPausedWork && !oldAssistantHasPassiveIroningWait;

      if (hasOtherExecutingWork || hasOtherPausedWork) {
        await tx.profile.update({
          where: { id: oldAssistantId },
          data: { status: hasOtherExecutingWork ? ProfileStatus.executing : ProfileStatus.busy },
        });
      } else if (oldAssistantHasPassiveIroningWait) {
        await tx.profile.update({
          where: { id: oldAssistantId },
          data: { status: ProfileStatus.assigned },
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
              : hasOtherPausedWork
                ? "standby_timeout_old_assistant_paused"
                : "standby_timeout_old_assistant_waiting_ironing",
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
    schedulerDebugLog(
      `[reassignOverdueStandbyTasks] ${candidate.task.id} ${oldAssistantName} → ${newAssistant.name}, score=${candidate.score}`
    );
  }

  return reassignedCount;
}

export async function balanceIroningWaitAssignments(): Promise<number> {
  const now = new Date();
  const ironingWaitTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      assistantId: { not: null },
      parentTaskId: null,
      OR: [
        { ironingStage: { in: [...PASSIVE_IRONING_STAGES] } },
        { ironingStage: IroningTaskStage.none, category: { name: { contains: "熨" } } },
      ],
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
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
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  if (ironingWaitTasks.length === 0) return 0;

  const tasksByBuilding = new Map<number, typeof ironingWaitTasks>();
  for (const task of ironingWaitTasks) {
    if (!task.assistantId || !task.assistant) continue;
    if (!isIroningTaskCategory(task.category)) continue;
    const buildingId = taskEffectiveBuildingId(task);
    if (buildingId == null) continue;
    const list = tasksByBuilding.get(buildingId) || [];
    list.push(task);
    tasksByBuilding.set(buildingId, list);
  }

  let movedCount = 0;
  for (const [buildingId, tasks] of tasksByBuilding) {
    const dispatchable = await dispatchableAssistantsForBuilding(buildingId);
    if (dispatchable.length === 0) continue;

    const waitCountByAssistant = new Map<string, number>();
    for (const task of tasks) {
      if (!task.assistantId) continue;
      waitCountByAssistant.set(task.assistantId, (waitCountByAssistant.get(task.assistantId) ?? 0) + 1);
    }

    const availableTargets = (await buildIdleDispatchOrder(
      buildingId,
      dispatchable.filter((assistant) => (waitCountByAssistant.get(assistant.id) ?? 0) === 0)
    )).map((assistant) => assistant.id);
    if (availableTargets.length === 0) continue;

    const transferableTasks = [...tasks]
      .filter((task) => task.assistantId && (waitCountByAssistant.get(task.assistantId) ?? 0) > 1)
      .filter((task) => task.ironingStage !== IroningTaskStage.notified)
      .sort((a, b) =>
        b.priority - a.priority ||
        (b.ironingQueuedAt ?? b.createdAt).getTime() - (a.ironingQueuedAt ?? a.createdAt).getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime()
      );

    for (const task of transferableTasks) {
      if (availableTargets.length === 0) break;
      const oldAssistantId = task.assistantId;
      if (!oldAssistantId || (waitCountByAssistant.get(oldAssistantId) ?? 0) <= 1) continue;

      const newAssistantId = availableTargets.shift()!;
      const newAssistant = dispatchable.find((assistant) => assistant.id === newAssistantId);
      if (!newAssistant || newAssistant.id === oldAssistantId || !task.assistant) continue;
      const oldAssistantName = task.assistant.name;

      const oldPrimary = task.collaborators.find((participant) => participant.assistantId === oldAssistantId);
      const waitedMinutes = oldPrimary
        ? Math.floor((now.getTime() - oldPrimary.joinedAt.getTime()) / 60000)
        : Math.floor((now.getTime() - task.createdAt.getTime()) / 60000);

      await prisma.$transaction(async (tx) => {
        await tx.bookingTask.update({
          where: { id: task.id },
          data: {
            assistantId: newAssistant.id,
            ironingQueuedAt: task.ironingStage === IroningTaskStage.waiting_machine ? task.ironingQueuedAt ?? now : task.ironingQueuedAt,
          },
        });
        await tx.taskCollaborator.updateMany({
          where: {
            taskId: task.id,
            assistantId: oldAssistantId,
            role: "primary",
            status: { not: "left" },
          },
          data: { status: "left", leftAt: now },
        });
        await tx.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: task.id, assistantId: newAssistant.id } },
          create: {
            taskId: task.id,
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
        await tx.profile.update({
          where: { id: newAssistant.id },
          data: { status: ProfileStatus.assigned },
        });
        await tx.standbyReassignmentNotice.create({
          data: {
            taskId: task.id,
            oldAssistantId,
            oldAssistantName,
            newAssistantId: newAssistant.id,
            newAssistantName: newAssistant.name,
            taskRoomNumber: task.roomNumber,
            taskCategoryName: task.category.name,
            taskPriority: task.priority,
            waitedMinutes,
            thresholdMinutes: 0,
            score: 0,
            reason: "ironing_wait_load_balance",
            oldAssistantSetOffline: false,
          },
        });
      });

      waitCountByAssistant.set(oldAssistantId, (waitCountByAssistant.get(oldAssistantId) ?? 1) - 1);
      waitCountByAssistant.set(newAssistant.id, 1);
      await recordIdleDispatchRoundRobin(buildingId, newAssistant.id);
      movedCount++;
      schedulerDebugLog(
        `[balanceIroningWaitAssignments] 熨烫等待均衡 ${task.id} ${oldAssistantName} → ${newAssistant.name}`
      );
    }
  }

  if (movedCount > 0) {
    await syncProfileStatus();
  }

  return movedCount;
}

export async function releaseUnselectedStandbyTasks(): Promise<number> {
  const now = new Date();
  const standbyTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      assistantId: { not: null },
      parentTaskId: null,
      ironingStage: IroningTaskStage.none,
      AND: [
        NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        { category: { name: { not: { contains: "熨" } } } },
      ],
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
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  if (standbyTasks.length === 0) return 0;

  const ownerIds = Array.from(new Set(standbyTasks.map((task) => task.assistantId).filter((id): id is string => Boolean(id))));
  const busyOwners = await activeWorkingAssistantIds(ownerIds);
  if (busyOwners.size === 0) return 0;

  const releasableByBuilding = new Map<number, typeof standbyTasks>();
  for (const task of standbyTasks) {
    if (!task.assistantId || !task.assistant || !busyOwners.has(task.assistantId)) continue;
    const buildingId = taskEffectiveBuildingId(task);
    if (buildingId == null) continue;
    const list = releasableByBuilding.get(buildingId) || [];
    list.push(task);
    releasableByBuilding.set(buildingId, list);
  }
  if (releasableByBuilding.size === 0) return 0;

  let movedCount = 0;
  for (const [buildingId, tasks] of releasableByBuilding) {
    const dispatchable = await dispatchableAssistantsForBuilding(buildingId);
    const availableTargets = (await buildIdleDispatchOrder(
      buildingId,
      dispatchable.filter((assistant) => !busyOwners.has(assistant.id))
    )).map((assistant) => assistant.id);
    if (availableTargets.length === 0) continue;

    for (const task of tasks) {
      if (availableTargets.length === 0) break;
      const oldAssistantId = task.assistantId;
      if (!oldAssistantId || !task.assistant || !busyOwners.has(oldAssistantId)) continue;

      const newAssistantId = availableTargets.shift()!;
      const newAssistant = dispatchable.find((assistant) => assistant.id === newAssistantId);
      if (!newAssistant || newAssistant.id === oldAssistantId) continue;

      const oldPrimary = task.collaborators.find((participant) => participant.assistantId === oldAssistantId);
      const waitedMinutes = oldPrimary
        ? Math.floor((now.getTime() - oldPrimary.joinedAt.getTime()) / 60000)
        : Math.floor((now.getTime() - task.createdAt.getTime()) / 60000);

      await prisma.$transaction(async (tx) => {
        await tx.bookingTask.update({
          where: { id: task.id },
          data: { assistantId: newAssistant.id },
        });
        await tx.taskCollaborator.updateMany({
          where: {
            taskId: task.id,
            assistantId: oldAssistantId,
            role: "primary",
            status: { not: "left" },
          },
          data: { status: "left", leftAt: now },
        });
        await tx.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: task.id, assistantId: newAssistant.id } },
          create: {
            taskId: task.id,
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
        await tx.profile.update({
          where: { id: newAssistant.id },
          data: { status: ProfileStatus.assigned },
        });
        await tx.standbyReassignmentNotice.create({
          data: {
            taskId: task.id,
            oldAssistantId,
            oldAssistantName: task.assistant!.name,
            newAssistantId: newAssistant.id,
            newAssistantName: newAssistant.name,
            taskRoomNumber: task.roomNumber,
            taskCategoryName: task.category.name,
            taskPriority: task.priority,
            waitedMinutes,
            thresholdMinutes: 0,
            score: 0,
            reason: "unselected_standby_release",
            oldAssistantSetOffline: false,
            oldAssistantActiveTaskStatus: "executing_or_paused",
          },
        });
      });

      await recordIdleDispatchRoundRobin(buildingId, newAssistant.id);
      movedCount++;
      schedulerDebugLog(
        `[releaseUnselectedStandbyTasks] 未选待就位释放 ${task.id} ${task.assistant.name} → ${newAssistant.name}`
      );
    }
  }

  if (movedCount > 0) {
    await syncProfileStatus();
  }

  return movedCount;
}

export async function sweepIroningMachineQueue(): Promise<number> {
  const now = new Date();
  const cfg = await getIroningRuntimeConfig();
  const claimExpiresAt = new Date(now.getTime() - cfg.machineClaimTtlMinutes * 60 * 1000);
  const expiredClaims = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      ironingStage: IroningTaskStage.notified,
      ironingNotifiedAt: { lte: claimExpiresAt },
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
    },
    select: { id: true, assistantId: true, ironingNotifiedAt: true },
  });
  if (expiredClaims.length > 0) {
    await prisma.bookingTask.updateMany({
      where: { id: { in: expiredClaims.map((task) => task.id) } },
      data: {
        ironingStage: IroningTaskStage.waiting_machine,
        ironingQueuedAt: now,
        ironingNotifiedAt: null,
      },
    });
    await syncProfileStatus();
    for (const task of expiredClaims) {
      schedulerDebugLog(
        `[sweepIroningMachineQueue] 熨烫机使用权超时释放 task=${task.id} assistant=${task.assistantId ?? "-"} ttl=${cfg.machineClaimTtlMinutes}m notifiedAt=${task.ironingNotifiedAt?.toISOString() ?? "-"}`
      );
    }
  }

  const expiredClaimIds = new Set(expiredClaims.map((task) => task.id));
  const reservedSlotsByBuilding = await notifiedIroningMachineClaimCountsByBuilding();
  const candidateTasks = await prisma.bookingTask.findMany({
    where: {
      status: TaskStatus.waiting,
      ironingStage: { in: [IroningTaskStage.waiting_machine, IroningTaskStage.none] },
      AND: [NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE],
    },
	    include: {
	      photographer: { select: { buildingId: true } },
	      category: { select: { name: true, minDuration: true, maxDuration: true, estDuration: true } },
	      collaborators: {
	        where: { status: { notIn: ["left", "completed"] } },
	        select: { assistantId: true, status: true },
	      },
	    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  if (candidateTasks.length === 0) return 0;

  let touched = 0;
  const tasksByBuilding = new Map<number, typeof candidateTasks>();
  for (const task of candidateTasks) {
    if (expiredClaimIds.has(task.id)) continue;
    if (!isIroningTaskCategory(task.category)) continue;
    const buildingId = taskEffectiveBuildingId(task);
    if (buildingId == null) continue;
    const list = tasksByBuilding.get(buildingId) || [];
    list.push(task);
    tasksByBuilding.set(buildingId, list);
  }

  for (const [buildingId, tasks] of tasksByBuilding) {
    let slots = await availableIroningMachineSlots(buildingId);
    slots = Math.max(0, slots - (reservedSlotsByBuilding.get(buildingId) ?? 0));
    if (slots <= 0) continue;

	    const sortedTasks = [...tasks].sort((a, b) =>
	      a.priority - b.priority ||
	      taskDurationSortMinutes(a) - taskDurationSortMinutes(b) ||
	      taskMaxDurationSortMinutes(a) - taskMaxDurationSortMinutes(b) ||
	      (a.ironingQueuedAt ?? a.createdAt).getTime() - (b.ironingQueuedAt ?? b.createdAt).getTime() ||
	      a.createdAt.getTime() - b.createdAt.getTime()
	    );

    for (const task of sortedTasks) {
      if (slots <= 0) break;
      const requiredSlots = ironingMachineSlotsForTask(task);
      if (slots < requiredSlots) continue;
      const ownerId = task.assistantId;
      let targetAssistantId: string | null = null;

      if (ownerId) {
        const owner = await prisma.profile.findUnique({
          where: { id: ownerId },
          select: { id: true, status: true, onlineStatus: true, subStatus: true },
        });
        const ownerHasActiveWork = owner ? await assistantHasActiveNonPassiveWork(owner.id) : true;
        if (owner?.onlineStatus === OnlineStatus.online && !owner.subStatus && !ownerHasActiveWork) {
          targetAssistantId = owner.id;
        }
      }

      if (!targetAssistantId) {
        targetAssistantId = await selectIdleAssistantForBuilding(buildingId);
      }

      if (!targetAssistantId) {
        targetAssistantId = await earliestAvailableAssistant(buildingId);
      }

      if (!targetAssistantId) continue;

      const claimed = await attachIroningTaskToAssistant(task.id, targetAssistantId, IroningTaskStage.notified, true, now);
      if (!claimed) continue;
      await recordIdleDispatchRoundRobin(buildingId, targetAssistantId);
      touched++;
      slots -= requiredSlots;
      schedulerDebugLog(
        `[sweepIroningMachineQueue] 熨烫机空档 ${buildingId} → 任务 ${task.id} 分配/通知助理 ${targetAssistantId}, prep=${cfg.prepWindowMinutes}m timeout=${cfg.confirmTimeoutSeconds}s claimTtl=${cfg.machineClaimTtlMinutes}m`
      );
    }
  }

  return touched + expiredClaims.length;
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
	    assignedCount += await processPendingTaskAssistantTransfers();
	    assignedCount += await reassignOverdueStandbyTasks();
      assignedCount += await sweepIroningMachineQueue();
      assignedCount += await balanceIroningWaitAssignments();
      assignedCount += await releaseUnselectedStandbyTasks();

	    // —— 阶段 A：空闲助理 ↔ 未派单 waiting（原逻辑）——
    const waitingTasks = await prisma.bookingTask.findMany({
      where: {
        status: TaskStatus.waiting,
        assistantId: null,
        ironingStage: IroningTaskStage.none,
        ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
      },
      include: { photographer: { select: { buildingId: true } } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    if (waitingTasks.length > 0) {
      const buildingIds = Array.from(new Set(
        waitingTasks
          .map((task) => task.locationBuildingId ?? task.photographer.buildingId)
          .filter((id): id is number => id != null)
      ));
      const dispatchQueuesByBuilding = new Map<number, string[]>();
      for (const buildingId of buildingIds) {
        const candidates = await dispatchableAssistantsForBuilding(buildingId);
        if (candidates.length === 0) continue;
        const ordered = await buildIdleDispatchOrder(buildingId, candidates);
        dispatchQueuesByBuilding.set(buildingId, ordered.map((a) => a.id));
      }

      for (const task of waitingTasks) {
        const buildingId = task.locationBuildingId ?? task.photographer.buildingId;
        if (buildingId == null) continue;
        const available = dispatchQueuesByBuilding.get(buildingId);
        if (!available || available.length === 0) continue;

        const assistantId = available.shift()!;
        const claimed = await claimWaitingTaskForAssistant(task.id, assistantId, buildingId);
        if (!claimed) continue;
        await recordIdleDispatchRoundRobin(buildingId, assistantId);

        schedulerDebugLog(`[sweepWaitingTasks] 助理 ${assistantId} 分配任务 ${task.id} (P${task.priority})`);
        assignedCount++;
      }
    }

    // —— 阶段 B：仍无助理的 waiting → 待就位插单（与 POST /api/tasks 一致；修复「全楼无 idle 时 sweep 直接返回」导致永不插单）——
    const stillOrphans = await prisma.bookingTask.findMany({
      where: {
        status: TaskStatus.waiting,
        assistantId: null,
        ironingStage: IroningTaskStage.none,
        ...NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
      },
      include: {
        photographer: { select: { buildingId: true } },
        category: { select: { name: true, maxDuration: true, estDuration: true } },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    for (const task of stillOrphans) {
      const bid = task.locationBuildingId ?? task.photographer.buildingId;
      if (bid == null) continue;
      const taskLeaveUpperMin = taskLeaveUpperMinutes(task.category);
      const waitingPreempted = await interruptWaitingPreempt(bid, task.id, task.priority, taskLeaveUpperMin);
      if (waitingPreempted) {
        schedulerDebugLog(`[sweepWaitingTasks] 待就位插单 任务 ${task.id} (P${task.priority}) → 楼座 ${bid}`);
        assignedCount++;
        continue;
      }

      if (isIroningCategoryName(task.category.name)) continue;

      const executingPreempted = await interruptExecutingPreempt(bid, task.id, task.priority, taskLeaveUpperMin);
      if (executingPreempted) {
        schedulerDebugLog(`[sweepWaitingTasks] 执行中插单 任务 ${task.id} (P${task.priority}) → 楼座 ${bid}`);
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
    include: {
      category: true,
      photographer: { select: { buildingId: true } },
    },
  });

  if (!currentTask) return false;

  if (currentTask.parentTaskId) return false;

  if (await assistantHasPendingInterruptTask(assistantId)) return false;

  if (await taskHasActiveHelperParticipants(currentTask.id)) return false;

  if (await isIroningInterruptProtected(currentTask)) return false;

  if (isExternalModelFollowTask(currentTask)) return false;

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
    include: { category: { select: { name: true } } },
  });

  if (!currentTask) return false;

  if (currentTask.parentTaskId) return false;

  if (await assistantHasPendingInterruptTask(assistantId)) return false;

  if (isExternalModelFollowTask(currentTask)) return false;

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
 * 对同楼座执行中任务尝试插单。供新建任务即时派发与公共队列 sweep 共用，避免两条路径规则分叉。
 */
export async function interruptExecutingPreempt(
  buildingId: number,
  newTaskId: string,
  newPriority: number,
  newTaskLeaveUpperMin: number
): Promise<boolean> {
  const busyAssistants = await prisma.profile.findMany({
    where: {
      role: { in: ["assistant", "assistant_leader"] },
      status: { in: [ProfileStatus.executing, ProfileStatus.busy] },
      onlineStatus: OnlineStatus.online,
      OR: [
        { activeBuildingId: buildingId },
        { activeBuildingId: null, buildingId },
      ],
    },
    select: { id: true },
  });

  const busyAssistantIds = busyAssistants.map((assistant) => assistant.id);
  if (busyAssistantIds.length === 0) return false;

  const runtimeCfg = await getSchedulerRuntimeConfig();
  const globalInterruptCap = runtimeCfg.INTERRUPT_MAX_MINUTES;

  const pendingInterrupts = await prisma.bookingTask.findMany({
    where: {
      assistantId: { in: busyAssistantIds },
      status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
      parentTaskId: { not: null },
    },
    select: { assistantId: true },
    distinct: ["assistantId"],
  });
  const pendingInterruptAssistantIds = new Set(pendingInterrupts.map((task) => task.assistantId).filter(Boolean));

  const assistantCurrentTasks = await prisma.bookingTask.findMany({
    where: {
      assistantId: { in: busyAssistantIds },
      status: TaskStatus.executing,
    },
    include: {
      category: { select: { name: true, canBeInterrupted: true, maxDuration: true, maxInterruptMinutes: true } },
      photographer: { select: { buildingId: true } },
      collaborators: {
        where: { role: "helper", status: { in: ["waiting", "executing", "paused"] } },
        select: { id: true },
      },
    },
  });

  const filteredCandidates: typeof assistantCurrentTasks = [];
  for (const task of assistantCurrentTasks) {
    if (!task.assistantId || pendingInterruptAssistantIds.has(task.assistantId) || task.parentTaskId) continue;
    if (task.collaborators.length > 0) continue;
    if (await isIroningInterruptProtected(task)) continue;
    if (isExternalModelFollowTask(task)) continue;
    if (task.isLocked || !taskCategoryCanBeInterrupted(task.category)) continue;
    // 当前执行单须比新单更低优先（数值更大），同级或更高优先不被插。
    if (task.priority <= newPriority) continue;
    const cap = effectiveInterruptLeaveCapMinutes(globalInterruptCap, task.category.maxInterruptMinutes);
    if (newTaskLeaveUpperMin > cap) continue;
    filteredCandidates.push(task);
  }

  const interruptOrder = await buildP1InterruptCandidateOrderFromFiltered(buildingId, filteredCandidates);

  for (const candidate of interruptOrder) {
    if (!candidate.assistantId) continue;
    const ok = await canInterrupt(candidate.assistantId, newPriority, newTaskLeaveUpperMin);
    if (!ok) continue;
    await interruptAssistant(candidate.assistantId, newTaskId);
    await recordP1InterruptRoundRobin(buildingId, candidate.assistantId);
    return true;
  }

  return false;
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
        AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      },
      include: {
        category: {
          select: {
            maxDuration: true,
            maxInterruptMinutes: true,
          },
        },
        priorityUpgradeRequests: {
          where: { status: PriorityUpgradeRequestStatus.approved },
          select: { id: true },
          take: 1,
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
    if (waitingTask.escalatedFromPriority != null || waitingTask.priorityUpgradeRequests.length > 0) continue;
    if (await taskHasActiveHelperParticipants(waitingTask.id)) continue;
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

function taskWaitingSinceForEscalation(task: {
  createdAt: Date;
  assistantId: string | null;
  collaborators: { assistantId: string; joinedAt: Date }[];
}): Date {
  if (!task.assistantId) return task.createdAt;
  return task.collaborators.find((participant) => participant.assistantId === task.assistantId)?.joinedAt ?? task.createdAt;
}

/**
 * 动态提权
 * 等待中的任务超过阈值后自动升一级；未分配任务和已分配但尚未就位的任务都参与。
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
      AND: [
        NOT_PHOTOGRAPHER_LIMIT_QUEUE_WHERE,
        {
          OR: [
            { createdAt: { lte: threshold } },
            {
              collaborators: {
                some: {
                  role: "primary",
                  status: "waiting",
                  joinedAt: { lte: threshold },
                },
              },
            },
          ],
        },
        {
          OR: [
            { escalatedAt: null },
            { escalatedAt: { lte: threshold } },
          ],
        },
      ],
      priority: { gte: PRIORITY.P2 }, // P2-P5
      parentTaskId: null,
    },
    include: {
      collaborators: {
        where: { role: "primary", status: "waiting" },
        select: { assistantId: true, joinedAt: true },
      },
    },
  });

  let escalatedCount = 0;
  for (const task of tasksToEscalate) {
    if (taskWaitingSinceForEscalation(task) > threshold) continue;
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

type TaskMaintenanceResult = {
  cleaned: number;
  escalated: number;
  assigned: number;
  skipped: boolean;
  scheduled?: boolean;
  running?: boolean;
};

let _maintenanceRunning: Promise<TaskMaintenanceResult> | null = null;
let _lastMaintenanceAt = 0;
const TASK_MAINTENANCE_THROTTLE_MS = 2_000;
const WORKBENCH_SYNC_MAINTENANCE_THROTTLE_MS = 15_000;

/**
 * 统一任务维护入口。
 * 用于写入型操作或显式扫描接口，避免高频列表读取反复触发调度写入。
 */
export async function runTaskMaintenance(
  options: { force?: boolean; minIntervalMs?: number } = {}
): Promise<TaskMaintenanceResult> {
  if (_maintenanceRunning) return _maintenanceRunning;

  const now = Date.now();
  const minIntervalMs = options.minIntervalMs ?? TASK_MAINTENANCE_THROTTLE_MS;
  if (!options.force && now - _lastMaintenanceAt < minIntervalMs) {
    return { cleaned: 0, escalated: 0, assigned: 0, skipped: true };
  }

  _maintenanceRunning = (async () => {
    try {
      const cleaned = await cleanupStaleTasks();
      await reconcileCompletedParticipantTasks();
      await syncProfileStatus();
      const escalated = await escalatePriorities();
      const assigned = await sweepWaitingTasks();
      _lastMaintenanceAt = Date.now();
      return { cleaned, escalated, assigned, skipped: false };
    } finally {
      _maintenanceRunning = null;
    }
  })();

  return _maintenanceRunning;
}

export async function runWorkbenchSyncMaintenance(): Promise<TaskMaintenanceResult> {
  return runTaskMaintenance({ minIntervalMs: WORKBENCH_SYNC_MAINTENANCE_THROTTLE_MS });
}

export function scheduleTaskMaintenance(): TaskMaintenanceResult {
  if (_maintenanceRunning) {
    return { cleaned: 0, escalated: 0, assigned: 0, skipped: true, running: true };
  }
  const now = Date.now();
  if (now - _lastMaintenanceAt < TASK_MAINTENANCE_THROTTLE_MS) {
    return { cleaned: 0, escalated: 0, assigned: 0, skipped: true };
  }

  void runTaskMaintenance().catch((error) => {
    console.error("[scheduleTaskMaintenance]", error);
  });
  return { cleaned: 0, escalated: 0, assigned: 0, skipped: false, scheduled: true };
}

export function scheduleWorkbenchSyncMaintenance(): TaskMaintenanceResult {
  if (_maintenanceRunning) {
    return { cleaned: 0, escalated: 0, assigned: 0, skipped: true, running: true };
  }
  const now = Date.now();
  if (now - _lastMaintenanceAt < WORKBENCH_SYNC_MAINTENANCE_THROTTLE_MS) {
    return { cleaned: 0, escalated: 0, assigned: 0, skipped: true };
  }

  void runWorkbenchSyncMaintenance().catch((error) => {
    console.error("[scheduleWorkbenchSyncMaintenance]", error);
  });
  return { cleaned: 0, escalated: 0, assigned: 0, skipped: false, scheduled: true };
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
      data: { ...completeData, ironingStage: IroningTaskStage.none },
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

  schedulerDebugLog(`[cleanupStaleTasks] 清理了 ${staleTasks.length} 条过期任务，释放了 ${assistantIds.length} 位助理`);
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
      where: {
        role: { in: ["assistant", "assistant_leader"] },
        onlineStatus: OnlineStatus.online,
      },
      select: { id: true, status: true },
    });

    if (assistants.length === 0) return;

    // 查每个助理当前的活跃任务（不限日期，确保跨天数据也能正确反映）
    const activeTasks = await prisma.bookingTask.findMany({
      where: {
        assistantId: { in: assistants.map((a) => a.id) },
        status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
        AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
      },
      select: {
        assistantId: true,
        status: true,
        ironingStage: true,
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
        task: {
          status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
          AND: [NOT_PASSIVE_IRONING_WAIT_WHERE],
        },
      },
      select: {
        assistantId: true,
        status: true,
      },
    });

    const readyTransferTargets = await prisma.taskAssistantTransferRequest.findMany({
      where: {
        targetAssistantId: { in: assistants.map((a) => a.id) },
        status: "ready_to_takeover",
        task: {
          status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] },
        },
      },
      select: { targetAssistantId: true },
      distinct: ["targetAssistantId"],
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
      if (isPassiveUnstartedIroningWait(t)) continue;
      if (t.collaborators.some((c) => c.assistantId === t.assistantId)) continue;
      rememberStatus(t.assistantId, t.status);
    }
    for (const c of activeCollaborations) {
      rememberStatus(c.assistantId, c.status);
    }
    for (const transfer of readyTransferTargets) {
      rememberStatus(transfer.targetAssistantId, "waiting");
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

async function reconcileCompletedParticipantTasks(): Promise<number> {
  const tasks = await prisma.bookingTask.findMany({
    where: {
      status: { not: TaskStatus.completed },
      collaborators: {
        some: { status: "completed" },
        none: { status: { in: ACTIVE_PARTICIPANT_STATUSES } },
      },
    },
    select: { id: true },
    take: 100,
  });

  for (const task of tasks) {
    await syncTaskAggregateFromParticipants(task.id);
  }

  return tasks.length;
}
