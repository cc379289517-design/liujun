import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWorkbenchSyncMaintenance } from "@/lib/scheduler";
import { Prisma, PriorityUpgradeRequestStatus } from "@/generated/prisma/client";
import {
  ASSISTANT_EATING_SUB_STATUS,
  EATING_OVERTIME_ALERT_CONFIG_KEY,
  eatingTotalElapsedSeconds,
  parseEatingOvertimeAlertMin,
} from "@/lib/eatingPresence";
import { effectiveWorkMinutesFromApi, overtimeMinutesBeyondSlot, taskSlotCapMinutes } from "@/lib/taskEffectiveTime";

const VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES: PriorityUpgradeRequestStatus[] = [
  PriorityUpgradeRequestStatus.pending,
  PriorityUpgradeRequestStatus.approved,
];
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover"];
const AREA_TASK_LIMIT = 500;
const SCOPED_TASK_LIMIT = 200;
const RELATED_CHANGE_ID_LIMIT = 1000;

const ASSISTANT_PROFILE_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  avatar: true,
  role: true,
  department: true,
  group: true,
  buildingId: true,
  currentRoom: true,
  activeBuildingId: true,
  activeRoom: true,
  status: true,
  subStatus: true,
  eatingStartedAt: true,
  eatingPausedAt: true,
  eatingEndedAt: true,
  eatingAccumulatedSeconds: true,
  onlineStatus: true,
  isOnline: true,
  updatedAt: true,
  building: { select: { id: true, name: true, extraVenues: true } },
} as const;

const ASSISTANT_AVATAR_SELECT = {
  id: true,
  name: true,
  currentRoom: true,
  avatar: true,
  buildingId: true,
  updatedAt: true,
} as const;

const FULL_TASK_INCLUDE = {
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: {
    select: {
      id: true,
      name: true,
      priorityLevel: true,
      estDuration: true,
      minDuration: true,
      maxDuration: true,
    },
  },
  collaborators: {
    where: { status: { not: "left" } },
    include: {
      assistant: { select: ASSISTANT_AVATAR_SELECT },
    },
  },
  priorityUpgradeRequests: {
    where: { status: { in: VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      fromPriority: true,
      targetPriority: true,
      reason: true,
      createdAt: true,
    },
  },
  completionRegistration: {
    select: {
      id: true,
      taskId: true,
      assistantId: true,
      sku: true,
      imageUrls: true,
      reasonType: true,
      description: true,
      overtimeMinutesSnapshot: true,
      workSecondsSnapshot: true,
      createdAt: true,
      updatedAt: true,
      assistant: { select: { id: true, name: true } },
    },
  },
  assistantTransferRequests: {
    where: { status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES } },
    orderBy: { requestedAt: "desc" },
    take: 3,
    select: {
      id: true,
      taskId: true,
      fromAssistantId: true,
      targetAssistantId: true,
      counterpartTaskId: true,
      kind: true,
      responseMode: true,
      status: true,
      reason: true,
      requestedAt: true,
      targetConfirmedAt: true,
      completedAt: true,
      canceledAt: true,
    },
  },
} as const;

const QUEUE_TASK_INCLUDE = {
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: {
    select: {
      id: true,
      name: true,
      priorityLevel: true,
      estDuration: true,
      minDuration: true,
      maxDuration: true,
    },
  },
  collaborators: {
    where: { status: { not: "left" } },
    select: {
      id: true,
      taskId: true,
      assistantId: true,
      role: true,
      status: true,
      joinedAt: true,
      leftAt: true,
      startedAt: true,
      completedAt: true,
      effectiveWorkSeconds: true,
      workSegmentStartedAt: true,
      assistant: { select: ASSISTANT_AVATAR_SELECT },
    },
  },
  priorityUpgradeRequests: {
    where: { status: { in: VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      fromPriority: true,
      targetPriority: true,
      reason: true,
      createdAt: true,
    },
  },
  assistantTransferRequests: {
    where: { status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES } },
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: {
      id: true,
      taskId: true,
      fromAssistantId: true,
      targetAssistantId: true,
      counterpartTaskId: true,
      kind: true,
      responseMode: true,
      status: true,
      reason: true,
      requestedAt: true,
      targetConfirmedAt: true,
      completedAt: true,
      canceledAt: true,
    },
  },
} as const;

function parsePositiveInt(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSince(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function taskBuildingWhere(buildingId: number) {
  return {
    OR: [
      { locationBuildingId: buildingId },
      { locationBuildingId: null, photographer: { buildingId } },
    ],
  };
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function isAssistantRole(role: string | null): boolean {
  return role === "assistant" || role === "assistant_leader";
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

type AvatarProfileLike = { id: string; avatar: string | null; updatedAt?: Date | string | null };

function avatarValueForJson(profile: AvatarProfileLike): string | null {
  const avatar = profile.avatar?.trim();
  if (!avatar) return null;
  if (/^data:/i.test(avatar)) {
    const updatedAtMs = profile.updatedAt
      ? new Date(profile.updatedAt).getTime()
      : 0;
    const version = Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? `?v=${updatedAtMs}`
      : "";
    return `/api/profiles/${encodeURIComponent(profile.id)}/avatar${version}`;
  }
  return avatar;
}

function withAvatarUrl<T extends AvatarProfileLike>(profile: T): T {
  return {
    ...profile,
    avatar: avatarValueForJson(profile),
  };
}

function withTaskAvatarUrls<T extends {
  collaborators?: Array<{ assistant?: AvatarProfileLike | null }>;
}>(task: T): T {
  if (!Array.isArray(task.collaborators)) return task;
  return {
    ...task,
    collaborators: task.collaborators.map((collaborator) => ({
      ...collaborator,
      assistant: collaborator.assistant ? withAvatarUrl(collaborator.assistant) : collaborator.assistant,
    })),
  };
}

function taskDeltaWhere(
  baseWhere: Prisma.BookingTaskWhereInput,
  since: Date | null,
  relatedChangedTaskIds: string[],
): Prisma.BookingTaskWhereInput {
  if (!since) return baseWhere;
  const changedFilters: Prisma.BookingTaskWhereInput[] = [{ updatedAt: { gte: since } }];
  if (relatedChangedTaskIds.length > 0) {
    changedFilters.push({ id: { in: relatedChangedTaskIds } });
  }
  return {
    AND: [
      baseWhere,
      { OR: changedFilters },
    ],
  };
}

async function relatedChangedTaskIdsSince(
  since: Date | null,
  taskWhere: Prisma.BookingTaskWhereInput,
): Promise<{ ids: string[]; truncated: boolean }> {
  if (!since) return { ids: [], truncated: false };
  const take = RELATED_CHANGE_ID_LIMIT + 1;
  const [completionRegistrations, priorityRequests, transferRequests, collaborators] = await Promise.all([
    prisma.taskCompletionRegistration.findMany({
      where: {
        updatedAt: { gte: since },
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
    prisma.taskPriorityUpgradeRequest.findMany({
      where: {
        updatedAt: { gte: since },
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
    prisma.taskAssistantTransferRequest.findMany({
      where: {
        OR: [
          { requestedAt: { gte: since } },
          { targetConfirmedAt: { gte: since } },
          { completedAt: { gte: since } },
          { canceledAt: { gte: since } },
        ],
        task: { is: taskWhere },
      },
      select: { taskId: true, counterpartTaskId: true },
      take,
    }),
    prisma.taskCollaborator.findMany({
      where: {
        OR: [
          { joinedAt: { gte: since } },
          { startedAt: { gte: since } },
          { completedAt: { gte: since } },
          { leftAt: { gte: since } },
        ],
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
  ]);

  const truncated = [
    completionRegistrations,
    priorityRequests,
    transferRequests,
    collaborators,
  ].some((rows) => rows.length > RELATED_CHANGE_ID_LIMIT);
  return {
    ids: uniqueIds([
      ...completionRegistrations.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
      ...priorityRequests.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
      ...transferRequests.slice(0, RELATED_CHANGE_ID_LIMIT).flatMap((row) => [row.taskId, row.counterpartTaskId]),
      ...collaborators.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
    ]),
    truncated,
  };
}

type AssistantProfileRow = Prisma.ProfileGetPayload<{
  select: typeof ASSISTANT_PROFILE_SELECT;
}>;
type QueueTask = Prisma.BookingTaskGetPayload<{ include: typeof QUEUE_TASK_INCLUDE }>;
type QueueParticipant = QueueTask["collaborators"][number];

const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"];

function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 60) return `${m}分钟`;
  const h = m / 60;
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}小时` : `${rounded.toFixed(1)}小时`;
}

function buildDurationLabel(min: number, max: number): string {
  if (min > 0 && max > 0) return `${min}-${max}分钟`;
  if (max > 0) return `${max}分钟以内`;
  if (min > 0) return `${min}分钟以上`;
  return "未设置";
}

function taskCategoryDurationCaption(
  category: QueueTask["category"] | undefined,
  priority: number,
): string {
  const min = category?.minDuration;
  const max = category?.maxDuration;
  if (typeof min === "number" && typeof max === "number" && (min > 0 || max > 0)) {
    return buildDurationLabel(min, max);
  }
  const est = category?.estDuration;
  if (typeof est === "number" && est > 0) return fmtMin(est);
  return ({ 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" } as Record<number, string>)[priority] || "";
}

function taskParticipants(task: QueueTask | undefined | null): QueueParticipant[] {
  return (task?.collaborators ?? []).filter((participant) => participant.status !== "left");
}

function activeTaskParticipants(task: QueueTask | undefined | null): QueueParticipant[] {
  return taskParticipants(task).filter((participant) => ACTIVE_PARTICIPANT_STATUSES.includes(participant.status));
}

function taskParticipantForProfile(task: QueueTask | undefined | null, profileId: string | null | undefined): QueueParticipant | null {
  if (!task || !profileId) return null;
  return taskParticipants(task).find((participant) => {
    if (participant.assistantId !== profileId) return false;
    if (participant.role === "primary") return task.assistantId === profileId || participant.status === "completed";
    return true;
  }) ?? null;
}

function taskStatusForProfile(task: QueueTask | undefined | null, profileId: string | null | undefined): string | null {
  if (
    profileId &&
    task?.assistantTransferRequests?.some((request) =>
      request.targetAssistantId === profileId && request.status === "ready_to_takeover"
    )
  ) {
    return "waiting";
  }
  return taskParticipantForProfile(task, profileId)?.status ?? task?.status ?? null;
}

function taskTimingForProfile(task: QueueTask, profileId: string | null | undefined): QueueTask | QueueParticipant {
  return taskParticipantForProfile(task, profileId) ?? task;
}

function isIroningTask(task: QueueTask | null | undefined): boolean {
  const name = task?.category?.name ?? "";
  return name.includes("熨");
}

function isMapDeferredIroningWaitingTask(task: QueueTask | null | undefined): boolean {
  return !!task &&
    isIroningTask(task) &&
    task.status === "waiting" &&
    task.ironingStage === "waiting_machine";
}

function formatMapTaskElapsedLine(task: QueueTask, nowMs: number): string | null {
  if (task.status !== "executing" && task.status !== "paused") return null;
  const elapsed = effectiveWorkMinutesFromApi(task, nowMs);
  const cap = taskSlotCapMinutes(task.category);
  if (cap != null && elapsed > cap) return `已超时${fmtMin(elapsed - cap)}`;
  if (elapsed > 0) return `已进行${fmtMin(elapsed)}`;
  return null;
}

type AssistantTaskInfo = {
  executingTask: QueueTask | null;
  pausedTask: QueueTask | null;
  waitingInterruptTask: QueueTask | null;
  resumingTask: QueueTask | null;
  preemptedWaitingTask: QueueTask | null;
  collaboratingTask: QueueTask | null;
  collaboratingStatus: string | null;
};

function buildAssistantStatus(
  profiles: AssistantProfileRow[],
  tasks: QueueTask[],
  eatingOvertimeAlertMin: number,
) {
  const nowMs = Date.now();
  const infoMap = new Map<string, AssistantTaskInfo>();
  const ensureInfo = (assistantId: string) => {
    const existing = infoMap.get(assistantId);
    if (existing) return existing;
    const created: AssistantTaskInfo = {
      executingTask: null,
      pausedTask: null,
      waitingInterruptTask: null,
      resumingTask: null,
      preemptedWaitingTask: null,
      collaboratingTask: null,
      collaboratingStatus: null,
    };
    infoMap.set(assistantId, created);
    return created;
  };

  for (const task of tasks) {
    if (!task.category) continue;
    if (task.assistantId) {
      const primaryStatus = taskStatusForProfile(task, task.assistantId) ?? task.status;
      if (ACTIVE_PARTICIPANT_STATUSES.includes(primaryStatus)) {
        const info = ensureInfo(task.assistantId);
        if (primaryStatus === "executing") info.executingTask = task;
        else if (primaryStatus === "paused") info.pausedTask = task;
        else if (primaryStatus === "waiting" && task.parentTaskId) {
          if (!info.executingTask) info.resumingTask = task;
          else info.waitingInterruptTask = task;
        }
      }
    }
    for (const collaborator of activeTaskParticipants(task)) {
      if (!collaborator.assistantId || collaborator.assistantId === task.assistantId) continue;
      const info = ensureInfo(collaborator.assistantId);
      if (!info.executingTask && !info.pausedTask && !info.waitingInterruptTask && !info.resumingTask) {
        info.collaboratingTask = task;
        info.collaboratingStatus = collaborator.status;
      }
    }
  }

  for (const [, info] of infoMap) {
    if (info.executingTask && info.resumingTask) {
      info.waitingInterruptTask = info.resumingTask;
      info.resumingTask = null;
    }
    if (info.pausedTask && info.resumingTask && !info.waitingInterruptTask) {
      info.waitingInterruptTask = info.resumingTask;
      info.resumingTask = null;
    }
  }

  for (const [, info] of infoMap) {
    const candidate = info.resumingTask;
    if (!candidate || info.executingTask) continue;
    const parent = tasks.find((task) => task.id === candidate.parentTaskId);
    if (
      parent &&
      taskStatusForProfile(parent, parent.assistantId) === "waiting" &&
      parent.assistantId === candidate.assistantId
    ) {
      info.preemptedWaitingTask = parent;
      info.waitingInterruptTask = candidate;
      info.resumingTask = null;
    }
  }

  for (const [, info] of infoMap) {
    const executingTask = info.executingTask;
    if (!executingTask?.parentTaskId) continue;
    const parent = tasks.find((task) => task.id === executingTask.parentTaskId);
    if (
      parent &&
      taskStatusForProfile(parent, parent.assistantId) === "waiting" &&
      parent.assistantId === executingTask.assistantId
    ) {
      info.preemptedWaitingTask = parent;
    }
  }

  return profiles.map((profile) => {
    const info = infoMap.get(profile.id);
    const idleRoom = profile.activeRoom ?? profile.currentRoom;
    const eatingElapsedMin = profile.subStatus === ASSISTANT_EATING_SUB_STATUS
      ? Math.max(0, Math.floor(eatingTotalElapsedSeconds(profile.eatingStartedAt, profile.eatingAccumulatedSeconds, nowMs) / 60))
      : null;
    const eatingOvertimeMin =
      eatingElapsedMin != null && eatingElapsedMin >= eatingOvertimeAlertMin
        ? eatingElapsedMin - eatingOvertimeAlertMin
        : null;
    const idleStatus = {
      id: profile.id,
      status: "idle",
      currentTask: null,
      currentRoom: idleRoom,
      pausedRoom: null,
      pausedElapsedMin: 0,
      pausedTaskDesc: null,
      pausedTaskDetail: null,
      newTaskDesc: null,
      resumingFromPause: false,
      pendingRoom: null,
      currentTaskNote: null,
      currentTaskId: null,
      executingOvertimeMin: null,
      pausedOvertimeMin: null,
      eatingElapsedMin,
      eatingOvertimeMin,
      preemptedWaitingRoom: null,
      preemptedWaitingTaskDesc: null,
      preemptedWaitingTaskDetail: null,
      preemptedOvertimeMin: null,
    };
    if (!info) return idleStatus;

    const { executingTask, pausedTask, waitingInterruptTask, resumingTask, preemptedWaitingTask, collaboratingTask, collaboratingStatus } = info;
    let finalStatus = "idle";
    let currentRoom = idleRoom;
    let pendingRoom: string | null = null;
    let pausedRoom: string | null = null;
    let pausedTaskDesc: string | null = null;
    let pausedTaskDetail: string | null = null;
    let pausedElapsedMin = 0;
    let preemptedWaitingRoom: string | null = null;
    let preemptedWaitingTaskDesc: string | null = null;
    let preemptedWaitingTaskDetail: string | null = null;
    let newTaskDesc: string | null = null;
    let resumingFromPause = false;

    const buildDesc = (task: QueueTask) =>
      task.category
        ? `${task.roomNumber}室 · ${task.category.name} · ${taskCategoryDurationCaption(task.category, task.priority)}`
        : `${task.roomNumber}室`;
    const plainWaitingTask = tasks.find((task) =>
      task.assistantId === profile.id &&
      taskStatusForProfile(task, profile.id) === "waiting" &&
      !isMapDeferredIroningWaitingTask(task)
    ) ?? null;
    const pausedElapsedFor = (task: QueueTask) =>
      effectiveWorkMinutesFromApi({ ...taskTimingForProfile(task, profile.id), status: "paused" }, nowMs);
    const pausedOvertimeFor = (task: QueueTask) =>
      overtimeMinutesBeyondSlot({ ...taskTimingForProfile(task, profile.id), status: "paused", category: task.category }, nowMs);
    const setPausedMarker = (task: QueueTask, detailPrefix?: string) => {
      pausedRoom = task.roomNumber;
      const elapsed = pausedElapsedFor(task);
      pausedElapsedMin = elapsed;
      const overtime = pausedOvertimeFor(task);
      pausedTaskDesc =
        overtime != null
          ? `${task.category.name} · 已超时${fmtMin(overtime)}`
          : `${task.category.name} · 已进行${fmtMin(elapsed)}`;
      pausedTaskDetail = detailPrefix ? `${detailPrefix} · ${buildDesc(task)}` : buildDesc(task);
    };

    if (preemptedWaitingTask && executingTask && executingTask.parentTaskId === preemptedWaitingTask.id) {
      finalStatus = "executing";
      preemptedWaitingRoom = preemptedWaitingTask.roomNumber;
      currentRoom = executingTask.roomNumber;
      newTaskDesc = buildDesc(executingTask);
      const overtime = overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs);
      preemptedWaitingTaskDesc = overtime != null ? `已超时${fmtMin(overtime)}` : "已让行紧急单";
      preemptedWaitingTaskDetail = buildDesc(preemptedWaitingTask);
    } else if (executingTask && waitingInterruptTask) {
      finalStatus = "executing";
      currentRoom = executingTask.roomNumber;
      pendingRoom = waitingInterruptTask.roomNumber;
      newTaskDesc = buildDesc(waitingInterruptTask);
    } else if (preemptedWaitingTask && waitingInterruptTask) {
      finalStatus = "assigned";
      preemptedWaitingRoom = preemptedWaitingTask.roomNumber;
      currentRoom = waitingInterruptTask.roomNumber;
      newTaskDesc = buildDesc(waitingInterruptTask);
      const overtime = overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs);
      preemptedWaitingTaskDesc = overtime != null ? `已超时${fmtMin(overtime)}` : "已让行紧急单";
      preemptedWaitingTaskDetail = buildDesc(preemptedWaitingTask);
    } else if (pausedTask && waitingInterruptTask) {
      finalStatus = "assigned";
      currentRoom = waitingInterruptTask.roomNumber;
      setPausedMarker(pausedTask);
      pendingRoom = null;
      newTaskDesc = buildDesc(waitingInterruptTask);
    } else if (pausedTask && executingTask) {
      finalStatus = "executing";
      currentRoom = executingTask.roomNumber;
      setPausedMarker(pausedTask);
      newTaskDesc = buildDesc(executingTask);
    } else if (resumingTask) {
      finalStatus = "assigned";
      currentRoom = resumingTask.roomNumber;
      resumingFromPause = true;
    } else if (collaboratingTask) {
      if (collaboratingStatus === "paused") {
        finalStatus = "busy";
        currentRoom = null;
        setPausedMarker(collaboratingTask, "协作中");
      } else {
        finalStatus = collaboratingStatus === "executing"
          ? "executing"
          : collaboratingStatus === "waiting"
            ? "assigned"
            : "busy";
        currentRoom = collaboratingTask.roomNumber;
        newTaskDesc = `协作中 · ${buildDesc(collaboratingTask)}`;
      }
    } else if (executingTask) {
      finalStatus = "executing";
      currentRoom = executingTask.roomNumber;
    } else if (pausedTask) {
      finalStatus = "busy";
      currentRoom = null;
      setPausedMarker(pausedTask);
    } else if (plainWaitingTask) {
      finalStatus = "assigned";
      currentRoom = plainWaitingTask.roomNumber;
      if (plainWaitingTask.startedAt) resumingFromPause = true;
    }

    const descTask =
      (!executingTask && pausedTask && waitingInterruptTask)
        ? waitingInterruptTask
        : (!executingTask && preemptedWaitingTask && waitingInterruptTask)
          ? waitingInterruptTask
          : preemptedWaitingTask && executingTask && executingTask.parentTaskId === preemptedWaitingTask.id
            ? executingTask
            : (executingTask || pausedTask || collaboratingTask || plainWaitingTask || null);
    const currentTask = descTask
      ? (() => {
          const line = formatMapTaskElapsedLine(descTask, nowMs);
          const desc = collaboratingTask?.id === descTask.id && !executingTask && !pausedTask
            ? `协作中 · ${buildDesc(descTask)}`
            : buildDesc(descTask);
          return line ? `${line}\n${desc}` : desc;
        })()
      : null;

    return {
      id: profile.id,
      status: finalStatus,
      currentTask,
      currentRoom,
      currentTaskNote: descTask?.note ?? null,
      currentTaskId: descTask?.id ?? null,
      pausedRoom,
      pausedElapsedMin,
      pausedTaskDesc,
      pausedTaskDetail,
      newTaskDesc,
      resumingFromPause,
      pendingRoom,
      preemptedWaitingRoom,
      preemptedWaitingTaskDesc,
      preemptedWaitingTaskDetail,
      executingOvertimeMin: executingTask ? overtimeMinutesBeyondSlot(executingTask, nowMs) : null,
      pausedOvertimeMin: pausedRoom
        ? pausedTask
          ? pausedOvertimeFor(pausedTask)
          : collaboratingTask && collaboratingStatus === "paused"
            ? pausedOvertimeFor(collaboratingTask)
            : null
        : null,
      preemptedOvertimeMin: preemptedWaitingTask ? overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs) : null,
      eatingElapsedMin,
      eatingOvertimeMin,
    };
  });
}

function compactAssistantStatus(
  rows: ReturnType<typeof buildAssistantStatus>,
): Array<{ id: string; [key: string]: unknown }> {
  return rows.map((row) => {
    const compact: { id: string; [key: string]: unknown } = { id: row.id };
    for (const [key, value] of Object.entries(row)) {
      if (key === "id") continue;
      if (value == null && key !== "currentRoom") continue;
      if (value === false) continue;
      if (key === "pausedElapsedMin" && value === 0) continue;
      compact[key] = value;
    }
    return compact;
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const profileId = searchParams.get("profileId");
    const role = searchParams.get("role");
    const buildingId = parsePositiveInt(searchParams.get("buildingId"));
    const view = searchParams.get("view") || role || "building";
    const forceFull = searchParams.get("full") === "1";
    const since = forceFull ? null : parseSince(searchParams.get("since"));
    const syncStartedAt = new Date();

    if (!buildingId) {
      return Response.json({ error: "buildingId is required" }, { status: 400 });
    }

    const maintenance = await runWorkbenchSyncMaintenance();
    const createdAt = todayRange();
    const areaWhere = taskBuildingWhere(buildingId);

    const taskFilters: Record<string, unknown>[] = [];
    if (profileId && (view === "photographer" || role === "photographer")) {
      taskFilters.push({ photographerId: profileId });
    } else if (profileId && (isAssistantRole(view) || isAssistantRole(role))) {
      taskFilters.push({
        OR: [
          { assistantId: profileId },
          { collaborators: { some: { assistantId: profileId, status: { not: "left" } } } },
          {
            assistantTransferRequests: {
              some: {
                targetAssistantId: profileId,
                status: { in: ["confirming", "pending_after_complete", "ready_to_takeover"] },
              },
            },
          },
          {
            assistantTransferRequests: {
              some: {
                fromAssistantId: profileId,
                status: "pending_after_complete",
              },
            },
          },
        ],
      });
    } else {
      taskFilters.push(areaWhere);
    }

    const areaTaskWhere: Prisma.BookingTaskWhereInput = {
      createdAt,
      AND: [areaWhere],
    };
    const scopedTaskWhere: Prisma.BookingTaskWhereInput = {
      createdAt,
      AND: taskFilters,
    };
    const assistantStatusTaskWhere: Prisma.BookingTaskWhereInput = {
      AND: [
        areaWhere,
        { status: { not: "completed" } },
        {
          OR: [
            { assistantId: { not: null } },
            { collaborators: { some: { status: { in: ACTIVE_PARTICIPANT_STATUSES } } } },
            { assistantTransferRequests: { some: { status: "ready_to_takeover" } } },
          ],
        },
      ],
    };
    const [areaRelatedChanges, scopedRelatedChanges] = await Promise.all([
      relatedChangedTaskIdsSince(since, areaTaskWhere),
      relatedChangedTaskIdsSince(since, scopedTaskWhere),
    ]);
    const areaChangedWhere = taskDeltaWhere(areaTaskWhere, since, areaRelatedChanges.ids);
    const scopedChangedWhere = taskDeltaWhere(scopedTaskWhere, since, scopedRelatedChanges.ids);
    const taskOrderBy = [{ priority: "asc" as const }, { createdAt: "asc" as const }];
    const changedTaskOrderBy = since
      ? [{ updatedAt: "asc" as const }, { id: "asc" as const }]
      : taskOrderBy;

    const [profiles, areaTaskIds, areaTasks, taskIds, tasks, notices, assistantStatusTasks, eatingOvertimeConfig] = await Promise.all([
      prisma.profile.findMany({
        where: {
          role: { in: ["assistant", "assistant_leader"] },
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
        select: ASSISTANT_PROFILE_SELECT,
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      prisma.bookingTask.findMany({
        where: areaTaskWhere,
        select: { id: true },
        orderBy: taskOrderBy,
        take: AREA_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: areaChangedWhere,
        include: QUEUE_TASK_INCLUDE,
        orderBy: changedTaskOrderBy,
        take: AREA_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: scopedTaskWhere,
        select: { id: true },
        orderBy: taskOrderBy,
        take: SCOPED_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: scopedChangedWhere,
        include: FULL_TASK_INCLUDE,
        orderBy: changedTaskOrderBy,
        take: SCOPED_TASK_LIMIT + 1,
      }),
      profileId && isAssistantRole(role)
        ? prisma.standbyReassignmentNotice.findMany({
            where: {
              OR: [
                { newAssistantId: profileId, newAssistantAcknowledgedAt: null },
                { oldAssistantId: profileId, oldAssistantAcknowledgedAt: null },
              ],
            },
            include: {
              task: {
                select: {
                  id: true,
                  note: true,
                  roomNumber: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
            take: 5,
          })
        : Promise.resolve([]),
      prisma.bookingTask.findMany({
        where: assistantStatusTaskWhere,
        include: QUEUE_TASK_INCLUDE,
        orderBy: taskOrderBy,
        take: AREA_TASK_LIMIT + 1,
      }),
      prisma.systemConfig.findUnique({
        where: { key: EATING_OVERTIME_ALERT_CONFIG_KEY },
        select: { value: true },
      }),
    ]);
    const areaTaskIdsTruncated = areaTaskIds.length > AREA_TASK_LIMIT;
    const areaTasksTruncated = areaTasks.length > AREA_TASK_LIMIT;
    const scopedTaskIdsTruncated = taskIds.length > SCOPED_TASK_LIMIT;
    const scopedTasksTruncated = tasks.length > SCOPED_TASK_LIMIT;
    const visibleAreaTaskIds = areaTaskIds.slice(0, AREA_TASK_LIMIT);
    const visibleAreaTasks = areaTasks.slice(0, AREA_TASK_LIMIT);
    const visibleTaskIds = taskIds.slice(0, SCOPED_TASK_LIMIT);
    const visibleTasks = tasks.slice(0, SCOPED_TASK_LIMIT);
    const assistantStatusTruncated = assistantStatusTasks.length > AREA_TASK_LIMIT;
    let assistantStatus: ReturnType<typeof compactAssistantStatus> | null = null;
    if (!assistantStatusTruncated) {
      const assistantStatusTaskById = new Map(
        assistantStatusTasks.map((task) => [task.id, task]),
      );
      const missingParentIds = uniqueIds(
        assistantStatusTasks
          .map((task) => task.parentTaskId)
          .filter((id) => id && !assistantStatusTaskById.has(id)),
      );
      if (missingParentIds.length > 0) {
        const parentTasks = await prisma.bookingTask.findMany({
          where: { id: { in: missingParentIds } },
          include: QUEUE_TASK_INCLUDE,
        });
        for (const parentTask of parentTasks) {
          assistantStatusTaskById.set(parentTask.id, parentTask);
        }
      }
      assistantStatus = compactAssistantStatus(
        buildAssistantStatus(
          profiles,
          [...assistantStatusTaskById.values()],
          parseEatingOvertimeAlertMin(eatingOvertimeConfig?.value),
        ),
      );
    }
    const syncTruncated = Boolean(since) && (
      areaTasksTruncated ||
      scopedTasksTruncated ||
      areaRelatedChanges.truncated ||
      scopedRelatedChanges.truncated
    );

    return Response.json({
      serverTime: new Date().toISOString(),
      syncMode: since ? "delta" : "full",
      syncToken: syncStartedAt.toISOString(),
      syncTruncated,
      nextPollMs: 3000,
      maintenance,
      profiles: profiles.map(withAvatarUrl),
      assistantStatus,
      tasks: visibleTasks.map(withTaskAvatarUrls),
      taskIds: visibleTaskIds.map((task) => task.id),
      publicQueue: visibleAreaTasks.map(withTaskAvatarUrls),
      publicQueueIds: visibleAreaTaskIds.map((task) => task.id),
      publicQueueSummary: {
        total: visibleAreaTaskIds.length,
        changed: visibleAreaTasks.length,
        idListTruncated: areaTaskIdsTruncated,
        taskListTruncated: areaTasksTruncated,
        scopedIdListTruncated: scopedTaskIdsTruncated,
        scopedTaskListTruncated: scopedTasksTruncated,
        assistantStatusTruncated,
      },
      notices,
    });
  } catch (error) {
    console.error("[GET /api/workbench/sync]", error);
    return Response.json({ error: "Failed to sync workbench" }, { status: 500 });
  }
}
