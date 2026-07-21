import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleWorkbenchSyncMaintenance } from "@/lib/scheduler";
import { Prisma, PriorityUpgradeRequestStatus } from "@/generated/prisma/client";
import {
  ASSISTANT_EATING_SUB_STATUS,
  EATING_OVERTIME_ALERT_CONFIG_KEY,
  eatingTotalElapsedSeconds,
  parseEatingOvertimeAlertMin,
} from "@/lib/eatingPresence";
import { effectiveWorkMinutesFromApi, overtimeMinutesBeyondSlot, taskSlotCapMinutes, totalEffectiveWorkSecondsFromApi } from "@/lib/taskEffectiveTime";
import {
  AVATAR_PROFILE_SELECT,
  PUBLIC_PROFILE_SELECT,
  serializeProfileForJson,
  serializeTaskAssistantAvatars,
} from "@/lib/profilePayload";
import {
  assistantTaskScoreFactor,
  assistantTaskScoreFromSeconds,
  displayTaskCategoryName,
  EXTERNAL_MODEL_ASSIST_DISPLAY_NAME,
  isExternalModelAssistTaskName,
} from "@/lib/assistantScore";

const VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES: PriorityUpgradeRequestStatus[] = [
  PriorityUpgradeRequestStatus.pending,
  PriorityUpgradeRequestStatus.approved,
];
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover", "completed"];
const AREA_TASK_LIMIT = 500;
const SCOPED_TASK_LIMIT = 200;
const RELATED_CHANGE_ID_LIMIT = 1000;
const AREA_SUMMARY_CACHE_TTL_MS = 1000;
const DISPLAY_TASK_TYPE_ORDER = ["手持", "服装穿戴", "手工DIY", "熨烫", EXTERNAL_MODEL_ASSIST_DISPLAY_NAME, "其他"];
const DISPLAY_TASK_TYPE_SOLID_HEX: Record<string, string> = {
  "手持": "#f87171",
  "服装穿戴": "#fb923c",
  "手工DIY": "#fbbf24",
  "熨烫": "#34d399",
  [EXTERNAL_MODEL_ASSIST_DISPLAY_NAME]: "#a855f7",
  "其他": "#60a5fa",
};
const TASK_CATEGORY_GROUP: Record<string, string> = {
  "短时手持": "手持",
  "手持": "手持",
  "服装穿戴": "服装穿戴",
  "穿戴对角度": "服装穿戴",
  "手工DIY协助": "手工DIY",
  "手工DIY制作": "手工DIY",
  "手工DIY": "手工DIY",
  "短时熨烫": "熨烫",
  "长时熨烫": "熨烫",
  "熨烫": "熨烫",
  "外模跟拍协助": "其他",
  "协助外模拍摄": "其他",
  "协助外模跟拍": "其他",
  "其他长时任务": "其他",
  "其他": "其他",
};

const ASSISTANT_TRANSFER_REQUEST_SELECT = {
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
      assistant: { select: AVATAR_PROFILE_SELECT },
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
    select: ASSISTANT_TRANSFER_REQUEST_SELECT,
  },
} as const;

const QUEUE_AVATAR_PROFILE_SELECT = {
  id: true,
  name: true,
  avatar: true,
  updatedAt: true,
} as const;

const QUEUE_TASK_INCLUDE = {
  photographer: { select: { id: true, name: true, buildingId: true } },
  assistant: { select: { id: true, name: true } },
  category: {
    select: {
      id: true,
      name: true,
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
      assistant: { select: QUEUE_AVATAR_PROFILE_SELECT },
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
    select: ASSISTANT_TRANSFER_REQUEST_SELECT,
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

function minuteBucket(date: Date): number {
  return Math.floor(date.getTime() / 60_000);
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

type DateRange = { gte?: Date; lt?: Date };
type TransferEvent = Prisma.TaskAssistantTransferRequestGetPayload<{
  select: typeof ASSISTANT_TRANSFER_REQUEST_SELECT;
}>;

function dateInRange(value: Date | string | null | undefined, range: DateRange): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) &&
    (range.gte == null || time >= range.gte.getTime()) &&
    (range.lt == null || time < range.lt.getTime());
}

function completedContributionWhere(range: DateRange): Prisma.BookingTaskWhereInput {
  return {
    status: "completed",
    OR: [
      { completedAt: range },
      { collaborators: { some: { status: "completed", completedAt: range } } },
      { completedAt: null, createdAt: range },
    ],
  };
}

async function loadTransferEventsByTaskId(taskIds: string[]) {
  const ids = uniqueIds(taskIds);
  const eventsByTaskId = new Map<string, TransferEvent[]>();
  if (ids.length === 0) return eventsByTaskId;
  const idSet = new Set(ids);
  const events = await prisma.taskAssistantTransferRequest.findMany({
    where: {
      status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES },
      OR: [
        { taskId: { in: ids } },
        { counterpartTaskId: { in: ids } },
      ],
    },
    select: ASSISTANT_TRANSFER_REQUEST_SELECT,
    orderBy: { requestedAt: "desc" },
  });
  for (const event of events) {
    for (const taskId of new Set([event.taskId, event.counterpartTaskId])) {
      if (!taskId || !idSet.has(taskId)) continue;
      const current = eventsByTaskId.get(taskId) ?? [];
      current.push(event);
      eventsByTaskId.set(taskId, current);
    }
  }
  return eventsByTaskId;
}

function attachTransferEvents<T extends { id: string; assistantTransferRequests: TransferEvent[] }>(
  tasks: T[],
  eventsByTaskId: Map<string, TransferEvent[]>,
): T[] {
  return tasks.map((task) => ({
    ...task,
    assistantTransferRequests: eventsByTaskId.get(task.id) ?? [],
  }));
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

function noticeVisibleWhereForAssistant(assistantId: string): Prisma.StandbyReassignmentNoticeWhereInput {
  return {
    OR: [
      { newAssistantId: assistantId, newAssistantAcknowledgedAt: null },
      { oldAssistantId: assistantId, oldAssistantAcknowledgedAt: null },
    ],
  };
}

function noticeChangedWhereForAssistant(
  assistantId: string,
  since: Date | null,
): Prisma.StandbyReassignmentNoticeWhereInput | null {
  if (!since) return null;
  return {
    OR: [
      {
        newAssistantId: assistantId,
        OR: [
          { createdAt: { gte: since } },
          { newAssistantAcknowledgedAt: { gte: since } },
        ],
      },
      {
        oldAssistantId: assistantId,
        OR: [
          { createdAt: { gte: since } },
          { oldAssistantAcknowledgedAt: { gte: since } },
        ],
      },
    ],
  };
}

type AssistantProfileRow = Prisma.ProfileGetPayload<{
  select: typeof PUBLIC_PROFILE_SELECT;
}>;
type QueueTask = Prisma.BookingTaskGetPayload<{ include: typeof QUEUE_TASK_INCLUDE }>;
type QueueParticipant = QueueTask["collaborators"][number];
type AreaSummaryResult = {
  summary: ReturnType<typeof buildAreaSummary>;
  truncated: boolean;
};

const areaSummaryCache = new Map<number, { expiresAtMs: number; promise: Promise<AreaSummaryResult> }>();

const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"];
const FULL_QUEUE_FALSE_DEFAULT_KEYS = new Set(["isLocked", "isSpecified"]);

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

function taskTypeGroupName(name: string | null | undefined): string {
  if (!name) return "其他";
  return TASK_CATEGORY_GROUP[name] || "其他";
}

function displayTaskTypeGroupName(name: string | null | undefined, priority?: number | null): string {
  return isExternalModelAssistTaskName(name, priority)
    ? EXTERNAL_MODEL_ASSIST_DISPLAY_NAME
    : taskTypeGroupName(name);
}

function taskLocationBuildingId(task: QueueTask): number | null {
  return task.locationBuildingId ?? task.photographer?.buildingId ?? null;
}

function completedAtMsForRanking(task: QueueTask, participant?: QueueParticipant | null): number {
  const raw = participant?.completedAt ?? task.completedAt ?? task.createdAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function totalEffectiveWorkSecondsForRanking(
  task: QueueTask | QueueParticipant,
  nowMs: number,
): number {
  return totalEffectiveWorkSecondsFromApi(
    { ...task, status: "completed" },
    nowMs,
  );
}

function completedRankingContributions(task: QueueTask, nowMs: number, range?: DateRange) {
  const rows: Array<{
    assistantId: string;
    assistantName: string;
    taskId: string;
    taskName: string;
    roomNumber: string;
    buildingId: number | null;
    completedAtMs: number;
    workSeconds: number;
  }> = [];
  const seenAssistantIds = new Set<string>();
  const taskName = displayTaskCategoryName(task.category?.name, task.priority);

  if (task.assistantId && task.status === "completed") {
    const primary = taskParticipantForProfile(task, task.assistantId);
    rows.push({
      assistantId: task.assistantId,
      assistantName: task.assistant?.name ?? "未命名助理",
      taskId: task.id,
      taskName,
      roomNumber: task.roomNumber,
      buildingId: taskLocationBuildingId(task),
      completedAtMs: completedAtMsForRanking(task, primary),
      workSeconds: totalEffectiveWorkSecondsForRanking(primary ?? task, nowMs),
    });
    seenAssistantIds.add(task.assistantId);
  }

  for (const participant of taskParticipants(task)) {
    if (participant.status !== "completed") continue;
    if (seenAssistantIds.has(participant.assistantId)) continue;
    rows.push({
      assistantId: participant.assistantId,
      assistantName: participant.assistant.name,
      taskId: task.id,
      taskName,
      roomNumber: task.roomNumber,
      buildingId: taskLocationBuildingId(task),
      completedAtMs: completedAtMsForRanking(task, participant),
      workSeconds: totalEffectiveWorkSecondsForRanking(participant, nowMs),
    });
    seenAssistantIds.add(participant.assistantId);
  }

  return rows.filter((row) =>
    row.workSeconds > 0 && (!range || dateInRange(new Date(row.completedAtMs), range))
  );
}

function orderedTaskTypeSummary(counts: Map<string, number>) {
  return DISPLAY_TASK_TYPE_ORDER
    .map((name) => {
      const count = counts.get(name) ?? 0;
      if (count <= 0) return null;
      return {
        name,
        count,
        color: DISPLAY_TASK_TYPE_SOLID_HEX[name] ?? DISPLAY_TASK_TYPE_SOLID_HEX["其他"],
      };
    })
    .filter((item): item is { name: string; count: number; color: string } => item !== null);
}

function buildAreaSummary(
  profiles: AssistantProfileRow[],
  tasks: QueueTask[],
  contributionTasks: QueueTask[] = tasks,
  contributionRange?: DateRange,
) {
  const nowMs = Date.now();
  const profileById = new Map(
    profiles.map((profile) => {
      const jsonProfile = serializeProfileForJson(profile);
      return [profile.id, jsonProfile];
    }),
  );
  const areaAssistantIds = new Set(profiles.map((profile) => profile.id));
  const taskStats = { total: 0, queued: 0, assigned: 0, executing: 0, paused: 0, completed: 0, overtime: 0 };
  const publishedTypeCounts = new Map<string, number>();
  const completedTypeCounts = new Map<string, {
    count: number;
    assistants: Map<string, { id: string; name: string; avatar: string | null; count: number }>;
  }>();
  const areaCompletedAssistantIds = new Set<string>();
  const contributionMap = new Map<string, ReturnType<typeof completedRankingContributions>>();

  for (const task of tasks) {
    taskStats.total += 1;
    const participants = activeTaskParticipants(task);
    const hasAssignedPerson = !!task.assistantId || participants.length > 0;
    if (overtimeMinutesBeyondSlot(task, nowMs) != null) taskStats.overtime += 1;
    if (task.status === "completed") taskStats.completed += 1;
    else if (task.status === "executing") taskStats.executing += 1;
    else if (task.status === "paused") taskStats.paused += 1;
    else if (hasAssignedPerson) taskStats.assigned += 1;
    else taskStats.queued += 1;

    const publishedName = displayTaskTypeGroupName(task.category?.name, task.priority);
    publishedTypeCounts.set(publishedName, (publishedTypeCounts.get(publishedName) ?? 0) + 1);

    if (task.status === "completed" && task.assistantId) {
      const completedName = displayTaskTypeGroupName(task.category?.name, task.priority);
      const row = completedTypeCounts.get(completedName) ?? { count: 0, assistants: new Map<string, { id: string; name: string; avatar: string | null; count: number }>() };
      row.count += 1;
      const profile = profileById.get(task.assistantId);
      const assistant = row.assistants.get(task.assistantId) ?? {
        id: task.assistantId,
        name: profile?.name ?? task.assistant?.name ?? "未命名助理",
        avatar: profile?.avatar ?? null,
        count: 0,
      };
      assistant.count += 1;
      row.assistants.set(task.assistantId, assistant);
      completedTypeCounts.set(completedName, row);
    }

  }

  for (const task of contributionTasks) {
    for (const entry of completedRankingContributions(task, nowMs, contributionRange)) {
      areaCompletedAssistantIds.add(entry.assistantId);
      const current = contributionMap.get(entry.assistantId) ?? [];
      current.push(entry);
      contributionMap.set(entry.assistantId, current);
    }
  }

  const completedTaskTypes = DISPLAY_TASK_TYPE_ORDER
    .map((name) => {
      const row = completedTypeCounts.get(name);
      if (!row) return null;
      return {
        name,
        count: row.count,
        color: DISPLAY_TASK_TYPE_SOLID_HEX[name] ?? DISPLAY_TASK_TYPE_SOLID_HEX["其他"],
        assistants: Array.from(row.assistants.values())
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      };
    })
    .filter((item): item is {
      name: string;
      count: number;
      color: string;
      assistants: { id: string; name: string; avatar: string | null; count: number }[];
    } => item !== null);

  const assistantRankingRows = Array.from(contributionMap.entries())
    .filter(([assistantId]) => areaAssistantIds.has(assistantId) || areaCompletedAssistantIds.has(assistantId))
    .map(([assistantId, entries]) => {
      const orderedEntries = [...entries].sort((a, b) => a.completedAtMs - b.completedAtMs);
      const completedCount = orderedEntries.length;
      const workSeconds = orderedEntries.reduce((sum, entry) => sum + entry.workSeconds, 0);
      const details = orderedEntries.map((entry) => {
        const scoreFactor = assistantTaskScoreFactor(entry.taskName);
        const serviceScore = assistantTaskScoreFromSeconds(entry.workSeconds, entry.taskName);
        const buildingName = entry.buildingId == null ? "未知楼座" : `${entry.buildingId}号楼`;
        return {
          taskId: entry.taskId,
          taskTitle: `${buildingName} · ${entry.roomNumber} · ${entry.taskName}`,
          serviceSeconds: entry.workSeconds,
          scoreFactor,
          serviceScore,
          totalScore: serviceScore,
        };
      });
      const score = details.reduce((sum, detail) => sum + detail.totalScore, 0);
      const profile = profileById.get(assistantId);
      const assistantName = profile?.name ?? orderedEntries.at(-1)?.assistantName ?? "未命名助理";
      return {
        assistantId,
        assistantName,
        avatar: profile?.avatar ?? null,
        score,
        completedCount,
        workSeconds,
        lastCompletedAtMs: orderedEntries.at(-1)?.completedAtMs ?? 0,
        details,
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      b.completedCount - a.completedCount ||
      b.workSeconds - a.workSeconds ||
      a.lastCompletedAtMs - b.lastCompletedAtMs ||
      a.assistantName.localeCompare(b.assistantName)
    )
    .slice(0, 10);

  return {
    taskStats,
    publishedTaskTypes: orderedTaskTypeSummary(publishedTypeCounts),
    completedTaskTypes,
    assistantRankingRows,
  };
}

function areaSummaryFromTasks(
  profiles: AssistantProfileRow[],
  tasks: QueueTask[],
  contributionTasks: QueueTask[],
  contributionRange: DateRange,
): AreaSummaryResult {
  const visibleTasks = tasks.slice(0, AREA_TASK_LIMIT);
  const visibleContributionTasks = contributionTasks.slice(0, AREA_TASK_LIMIT);
  return {
    summary: buildAreaSummary(profiles, visibleTasks, visibleContributionTasks, contributionRange),
    truncated: tasks.length > AREA_TASK_LIMIT || contributionTasks.length > AREA_TASK_LIMIT,
  };
}

function serializeQueueTaskForJson(task: QueueTask, compactFull: boolean): Record<string, unknown> {
  const serialized = serializeTaskAssistantAvatars(task) as Record<string, unknown>;
  if (!compactFull) {
    const { updatedAt: _updatedAt, ...rest } = serialized;
    return rest;
  }
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(serialized)) {
    if (key === "updatedAt") continue;
    if (value == null) continue;
    if (FULL_QUEUE_FALSE_DEFAULT_KEYS.has(key) && value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    compact[key] = value;
  }
  return compact;
}

async function getCachedAreaSummary(
  buildingId: number,
  profiles: AssistantProfileRow[],
  areaTaskWhere: Prisma.BookingTaskWhereInput,
  contributionTaskWhere: Prisma.BookingTaskWhereInput,
  contributionRange: DateRange,
): Promise<AreaSummaryResult> {
  const nowMs = Date.now();
  const cached = areaSummaryCache.get(buildingId);
  if (cached && cached.expiresAtMs > nowMs) return cached.promise;
  const promise = Promise.all([
    prisma.bookingTask.findMany({
      where: areaTaskWhere,
      include: QUEUE_TASK_INCLUDE,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: AREA_TASK_LIMIT + 1,
    }),
    prisma.bookingTask.findMany({
      where: contributionTaskWhere,
      include: QUEUE_TASK_INCLUDE,
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take: AREA_TASK_LIMIT + 1,
    }),
  ]).then(([tasks, contributionTasks]) =>
    areaSummaryFromTasks(profiles, tasks, contributionTasks, contributionRange)
  );
  areaSummaryCache.set(buildingId, {
    expiresAtMs: nowMs + AREA_SUMMARY_CACHE_TTL_MS,
    promise,
  });
  promise.catch(() => {
    const existing = areaSummaryCache.get(buildingId);
    if (existing?.promise === promise) areaSummaryCache.delete(buildingId);
  });
  return promise;
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

    const maintenance = scheduleWorkbenchSyncMaintenance();
    const createdAt = todayRange();
    const areaWhere = taskBuildingWhere(buildingId);
    const contributionTaskWhere: Prisma.BookingTaskWhereInput = {
      AND: [areaWhere, completedContributionWhere(createdAt)],
    };

    const [profileTransferRequests, readyTransferRequests, changedAssistantProfile] = await Promise.all([
      profileId && (isAssistantRole(view) || isAssistantRole(role))
        ? prisma.taskAssistantTransferRequest.findMany({
            where: {
              status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES },
              OR: [
                { fromAssistantId: profileId },
                { targetAssistantId: profileId },
              ],
            },
            select: { taskId: true, counterpartTaskId: true },
          })
        : Promise.resolve([]),
      prisma.taskAssistantTransferRequest.findMany({
        where: { status: "ready_to_takeover", counterpartTaskId: { not: null } },
        select: { taskId: true, counterpartTaskId: true },
      }),
      since
        ? prisma.profile.findFirst({
            where: {
              role: { in: ["assistant", "assistant_leader"] },
              updatedAt: { gte: since },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const profileTransferTaskIds = uniqueIds(
      profileTransferRequests.flatMap((event) => [event.taskId, event.counterpartTaskId]),
    );
    const readyCounterpartTaskIds = uniqueIds(
      readyTransferRequests.map((event) => event.counterpartTaskId),
    );

    const taskFilters: Record<string, unknown>[] = [];
    if (profileId && (view === "photographer" || role === "photographer")) {
      taskFilters.push({ photographerId: profileId });
    } else if (profileId && (isAssistantRole(view) || isAssistantRole(role))) {
      taskFilters.push({
        OR: [
          { assistantId: profileId },
          { collaborators: { some: { assistantId: profileId, status: { not: "left" } } } },
          ...(profileTransferTaskIds.length > 0 ? [{ id: { in: profileTransferTaskIds } }] : []),
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
    const areaSummaryTaskWhere: Prisma.BookingTaskWhereInput = {
      AND: [
        areaWhere,
        {
          OR: [
            { createdAt },
            completedContributionWhere(createdAt),
          ],
        },
      ],
    };
    const areaDetailTaskWhere: Prisma.BookingTaskWhereInput = {
      createdAt,
      AND: [
        areaWhere,
        { status: { not: "completed" } },
      ],
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
            ...(readyCounterpartTaskIds.length > 0 ? [{ id: { in: readyCounterpartTaskIds } }] : []),
          ],
        },
      ],
    };
    const [areaRelatedChanges, scopedRelatedChanges, areaSummaryUpdatedTask] = await Promise.all([
      relatedChangedTaskIdsSince(since, areaSummaryTaskWhere),
      relatedChangedTaskIdsSince(since, scopedTaskWhere),
      since
        ? prisma.bookingTask.findFirst({
            where: {
              AND: [
                areaSummaryTaskWhere,
                { updatedAt: { gte: since } },
              ],
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const areaChangedWhere = taskDeltaWhere(areaDetailTaskWhere, since, areaRelatedChanges.ids);
    const scopedChangedWhere = taskDeltaWhere(scopedTaskWhere, since, scopedRelatedChanges.ids);
    const taskOrderBy = [{ priority: "asc" as const }, { createdAt: "asc" as const }];
    const changedTaskOrderBy = since
      ? [{ updatedAt: "asc" as const }, { id: "asc" as const }]
      : taskOrderBy;

    const shouldCheckNotices = Boolean(profileId && isAssistantRole(role));
    const noticeChangedWhere = profileId && isAssistantRole(role)
      ? noticeChangedWhereForAssistant(profileId, since)
      : null;
    const [profiles, areaTaskIds, rawAreaTasks, taskIds, rawTasks, noticeChanged] = await Promise.all([
      prisma.profile.findMany({
        where: {
          role: { in: ["assistant", "assistant_leader"] },
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
        select: PUBLIC_PROFILE_SELECT,
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      prisma.bookingTask.findMany({
        where: areaDetailTaskWhere,
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
      noticeChangedWhere
        ? prisma.standbyReassignmentNotice.findFirst({
            where: noticeChangedWhere,
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const transferEventsByTaskId = await loadTransferEventsByTaskId([
      ...rawAreaTasks.map((task) => task.id),
      ...rawTasks.map((task) => task.id),
    ]);
    const areaTasks = attachTransferEvents(rawAreaTasks, transferEventsByTaskId);
    const tasks = attachTransferEvents(rawTasks, transferEventsByTaskId);
    const shouldSendNotices = shouldCheckNotices && (!since || noticeChanged != null);
    const notices = shouldSendNotices && profileId
      ? await prisma.standbyReassignmentNotice.findMany({
          where: noticeVisibleWhereForAssistant(profileId),
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
      : undefined;
    const areaTaskIdsTruncated = areaTaskIds.length > AREA_TASK_LIMIT;
    const areaTasksTruncated = areaTasks.length > AREA_TASK_LIMIT;
    const scopedTaskIdsTruncated = taskIds.length > SCOPED_TASK_LIMIT;
    const scopedTasksTruncated = tasks.length > SCOPED_TASK_LIMIT;
    const visibleAreaTaskIds = areaTaskIds.slice(0, AREA_TASK_LIMIT);
    const visibleAreaTasks = areaTasks.slice(0, AREA_TASK_LIMIT);
    const visibleTaskIds = taskIds.slice(0, SCOPED_TASK_LIMIT);
    const visibleTasks = tasks.slice(0, SCOPED_TASK_LIMIT);
    const responseProfiles = since
      ? profiles.filter((profile) => profile.updatedAt >= since)
      : profiles;
    const shouldSendAssistantStatus =
      !since ||
      minuteBucket(since) !== minuteBucket(syncStartedAt) ||
      areaSummaryUpdatedTask != null ||
      areaRelatedChanges.ids.length > 0 ||
      areaRelatedChanges.truncated ||
      changedAssistantProfile != null ||
      responseProfiles.length > 0;
    const [assistantStatusTasks, eatingOvertimeConfig] = shouldSendAssistantStatus
      ? await Promise.all([
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
        ])
      : [[], null] as const;
    const assistantStatusTruncated = shouldSendAssistantStatus && assistantStatusTasks.length > AREA_TASK_LIMIT;
    let assistantStatus: ReturnType<typeof compactAssistantStatus> | null = null;
    if (shouldSendAssistantStatus && !assistantStatusTruncated) {
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
      const statusTaskEventsById = await loadTransferEventsByTaskId(
        [...assistantStatusTaskById.values()].map((task) => task.id),
      );
      const enrichedAssistantStatusTasks = attachTransferEvents(
        [...assistantStatusTaskById.values()],
        statusTaskEventsById,
      );
      assistantStatus = compactAssistantStatus(
        buildAssistantStatus(
          profiles,
          enrichedAssistantStatusTasks,
          parseEatingOvertimeAlertMin(eatingOvertimeConfig?.value),
        ),
      );
    }
    const shouldSendAreaSummary =
      !since ||
      areaSummaryUpdatedTask != null ||
      areaRelatedChanges.ids.length > 0 ||
      areaRelatedChanges.truncated;
    const areaSummaryResult = shouldSendAreaSummary
      ? await getCachedAreaSummary(
          buildingId,
          profiles,
          areaTaskWhere,
          contributionTaskWhere,
          createdAt,
        )
      : null;
    const shouldSendPublicQueueIds =
      !since ||
      areaSummaryUpdatedTask != null ||
      areaRelatedChanges.ids.length > 0 ||
      areaRelatedChanges.truncated ||
      areaTaskIdsTruncated ||
      areaTasksTruncated;
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
      profiles: responseProfiles.map(serializeProfileForJson),
      assistantStatus: shouldSendAssistantStatus ? assistantStatus : undefined,
      areaSummary: areaSummaryResult?.summary,
      tasks: visibleTasks.map(serializeTaskAssistantAvatars),
      taskIds: visibleTaskIds.map((task) => task.id),
      publicQueue: visibleAreaTasks.map((task) => serializeQueueTaskForJson(task, !since)),
      publicQueueIds: shouldSendPublicQueueIds ? visibleAreaTaskIds.map((task) => task.id) : undefined,
      publicQueueSummary: {
        total: visibleAreaTaskIds.length,
        changed: visibleAreaTasks.length,
        idListTruncated: areaTaskIdsTruncated,
        taskListTruncated: areaTasksTruncated,
        scopedIdListTruncated: scopedTaskIdsTruncated,
        scopedTaskListTruncated: scopedTasksTruncated,
        assistantStatusTruncated,
        areaSummaryTruncated: areaSummaryResult?.truncated ?? false,
      },
      notices,
    });
  } catch (error) {
    console.error("[GET /api/workbench/sync]", error);
    return Response.json({ error: "Failed to sync workbench" }, { status: 500 });
  }
}
