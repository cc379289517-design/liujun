import {
  effectiveWorkMinutesFromApi,
  overtimeMinutesBeyondSlot,
  taskSlotCapMinutes,
  totalEffectiveWorkSecondsFromApi,
} from "@/lib/taskEffectiveTime";
import { displayTaskCategoryName, isExternalModelAssistTaskName } from "@/lib/assistantScore";
import { isPhotographerLimitQueuedTask } from "@/lib/photographerTaskLimit";
import { taskLocationBuildingId } from "./locationDisplay";
import type {
  AreaMetricCard,
  AreaMetricDetailCard,
  AssistantRankingContribution,
  DisplayTask,
  TaskFromAPI,
  TaskParticipant,
  TaskPauseKind,
} from "./types";

export function isIncomingTransferForProfile(
  request: { targetAssistantId: string } | null | undefined,
  profileId: string | null | undefined,
): boolean {
  return Boolean(request && profileId && request.targetAssistantId === profileId);
}

export function transferResponseButtonsDisabled(responseSaving: string | null | undefined): boolean {
  return responseSaving != null;
}

export function outgoingConfirmingSwapForProfile(
  task: TaskFromAPI | null | undefined,
  profileId: string | null | undefined,
) {
  if (!task || !profileId || task.status === "completed" || task.completedAt) return null;
  return task.assistantTransferRequests?.find((request) =>
    request.kind === "swap" &&
    request.status === "confirming" &&
    request.fromAssistantId === profileId,
  ) ?? null;
}

export function taskTransferRequestForTask(
  task: TaskFromAPI | undefined | null,
  statuses: readonly string[],
): NonNullable<TaskFromAPI["assistantTransferRequests"]>[number] | null {
  if (!task || task.status === "completed") return null;
  return task.assistantTransferRequests?.find((request) =>
    request.taskId === task.id && statuses.includes(request.status)
  ) ?? null;
}

/** 用时类展示：<=60 分钟显示「X分钟」，>60 按小时、最多一位小数（整数不写 .0） */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 60) return `${m}分钟`;
  const h = m / 60;
  const rounded = Math.round(h * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}小时`;
  return `${rounded.toFixed(1)}小时`;
}

/** 助理任务状态区：总秒数 -> HH:MM:SS（时可为三位以上） */
export function formatSecondsAsHMS(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hh = h > 99 ? String(h) : String(h).padStart(2, "0");
  return `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const STATUS_STYLE: Record<string, { statusLabel: string; statusCls: string; tagCls: string; hasProgress: boolean }> = {
  executing: { statusLabel: "进行中", statusCls: "bg-white/40 border-orange-200/50", tagCls: "bg-orange-100/60 text-orange-600", hasProgress: true },
  waiting:   { statusLabel: "等待中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/60 text-gray-500", hasProgress: false },
  queued:    { statusLabel: "队列中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/80 text-gray-500", hasProgress: false },
  assigned:  { statusLabel: "待就位", statusCls: "bg-white/35 border-blue-200/50", tagCls: "bg-blue-100/60 text-blue-600", hasProgress: false },
  waitingMachine: { statusLabel: "等待熨烫机", statusCls: "bg-white/35 border-emerald-200/50", tagCls: "bg-emerald-100/70 text-emerald-700", hasProgress: false },
  ironingReady: { statusLabel: "准备熨烫", statusCls: "bg-white/40 border-lime-200/60", tagCls: "bg-lime-100/80 text-lime-700", hasProgress: false },
  transferConfirming: { statusLabel: "待确认交换", statusCls: "bg-white/40 border-purple-200/60", tagCls: "bg-purple-100/70 text-purple-700", hasProgress: false },
  transferAfterComplete: { statusLabel: "结束后接替", statusCls: "bg-white/40 border-purple-200/60", tagCls: "bg-purple-100/70 text-purple-700", hasProgress: false },
  completed: { statusLabel: "已完成", statusCls: "bg-white/30 border-white/40", tagCls: "bg-green-100/60 text-green-600", hasProgress: false },
  paused:    { statusLabel: "已暂停", statusCls: "bg-white/25 border-yellow-200/40", tagCls: "bg-yellow-100/60 text-yellow-600", hasProgress: false },
};

// 任务状态排序权重：超过上限后的个人队列优先提醒，其余按待就位 -> 等待中 -> 进行中 -> 已暂停 -> 已完成
const STATUS_ORDER: Record<string, number> = { "准备熨烫": 0, "忙后熨烫": 1, "等待熨烫机": 1, "待确认交换": 2, "待确认移交": 2, "结束后接替": 2, "队列中": 3, "待就位": 4, "插单等待中": 4, "让行中": 4, "等待中": 5, "进行中": 6, "已暂停": 7, "已完成": 8, "已取消": 9 };

export function sortTasksByStatus(tasks: DisplayTask[]): DisplayTask[] {
  return [...tasks].sort((a, b) => (STATUS_ORDER[a.statusLabel] ?? 99) - (STATUS_ORDER[b.statusLabel] ?? 99));
}

export const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"];

export function taskParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return (task?.collaborators ?? []).filter((c) => c.status !== "left");
}

export function helperParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return taskParticipants(task).filter((c) => c.role !== "primary" && c.assistantId !== task?.assistantId);
}

export function activeTaskParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return taskParticipants(task).filter((c) => ACTIVE_PARTICIPANT_STATUSES.includes(c.status));
}

export function ironingMachineSlotsForTask(task: TaskFromAPI | undefined | null): number {
  if (!task) return 1;
  const activeAssistantIds = new Set<string>();
  for (const participant of taskParticipants(task)) {
    if (participant.status !== "completed") {
      activeAssistantIds.add(participant.assistantId);
    }
  }
  if (task.assistantId) {
    const primaryParticipant = taskParticipants(task).find((participant) => participant.assistantId === task.assistantId);
    if (!primaryParticipant || primaryParticipant.status !== "completed") {
      activeAssistantIds.add(task.assistantId);
    }
  }
  return Math.max(1, activeAssistantIds.size);
}

export function taskParticipantForProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined
): TaskParticipant | null {
  if (!task || !profileId) return null;
  return taskParticipants(task).find((participant) => {
    if (participant.assistantId !== profileId) return false;
    if (participant.role === "primary") return task.assistantId === profileId || participant.status === "completed";
    return true;
  }) ?? null;
}

export function taskBelongsToProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined
): boolean {
  if (!task) return false;
  if (!profileId) return true;
  const readyTransfer = taskTransferRequestForTask(task, ["ready_to_takeover"]);
  const isReadyTransferTarget = readyTransfer?.targetAssistantId === profileId;
  if (isReadyTransferTarget) return true;
  return task.assistantId === profileId || taskParticipantForProfile(task, profileId) != null;
}

export function taskStatusForProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined
): string | null {
  if (
    profileId &&
    taskTransferRequestForTask(task, ["ready_to_takeover"])?.targetAssistantId === profileId
  ) {
    return "waiting";
  }
  return taskParticipantForProfile(task, profileId)?.status ?? task?.status ?? null;
}

export function removeStaleActiveTasksForIdleProfile(
  tasks: TaskFromAPI[],
  profileId: string,
  profileStatus: string | null | undefined,
): TaskFromAPI[] {
  if (profileStatus !== "idle") return tasks;
  return tasks.filter((task) => {
    if (!taskBelongsToProfile(task, profileId)) return true;
    const status = taskStatusForProfile(task, profileId) ?? task.status;
    return status !== "executing" && status !== "paused";
  });
}

export type IncomingTransferPresentation = {
  statusKey: "transferConfirming" | "transferAfterComplete";
  label: "待确认移交" | "待确认交换" | "结束后接替";
};

export function incomingTransferPresentationForProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined,
): IncomingTransferPresentation | null {
  if (!task || !profileId) return null;
  const request = taskTransferRequestForTask(task, ["confirming", "pending_after_complete"]);
  if (!request || request.targetAssistantId !== profileId) return null;
  if (request.status === "pending_after_complete") {
    return { statusKey: "transferAfterComplete", label: "结束后接替" };
  }
  return {
    statusKey: "transferConfirming",
    label: request.kind === "swap" ? "待确认交换" : "待确认移交",
  };
}

export function taskTimingForProfile(
  task: TaskFromAPI,
  profileId: string | null | undefined
): TaskFromAPI | TaskParticipant {
  return taskParticipantForProfile(task, profileId) ?? task;
}

export function taskWaitingStartedAt(task: TaskFromAPI, profileId: string | null | undefined): string {
  const participant = taskParticipantForProfile(task, profileId);
  if (participant?.status === "waiting") return participant.joinedAt;
  const primaryWaiting = taskParticipants(task).find((c) => c.role === "primary" && c.status === "waiting");
  if (primaryWaiting) return primaryWaiting.joinedAt;
  return task.createdAt;
}

export function hasAreaMetricDetail(item: AreaMetricCard): item is AreaMetricDetailCard {
  return "detailKey" in item;
}

export function participantStatusText(status: string): string {
  if (status === "waiting") return "待就位";
  if (status === "executing") return "进行中";
  if (status === "paused") return "暂停中";
  if (status === "completed") return "已完成";
  return "已离开";
}

export type TaskTransferDisplayRelation = {
  kind: "handoff" | "swap";
  status: "completed" | "ready_to_takeover";
  fromAssistantId: string;
  targetAssistantId: string;
};

function transferRequestTimeMs(request: NonNullable<TaskFromAPI["assistantTransferRequests"]>[number]): number {
  const raw = request.completedAt ?? request.targetConfirmedAt ?? request.requestedAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 展示层只认已经完成或已进入可接手阶段的关系。
 * confirming / pending / pending_after_complete 仍是协商过程，不能展示成已完成移交。
 */
export function taskTransferDisplayRelation(
  task: TaskFromAPI | undefined | null,
): TaskTransferDisplayRelation | null {
  const request = [...(task?.assistantTransferRequests ?? [])]
    .filter((item) => (
      (item.status === "completed" || item.status === "ready_to_takeover") &&
      (item.kind === "handoff" || item.kind === "swap")
    ))
    .sort((a, b) => transferRequestTimeMs(b) - transferRequestTimeMs(a))[0];
  if (!request || (request.kind !== "handoff" && request.kind !== "swap")) return null;
  return {
    kind: request.kind,
    status: request.status as TaskTransferDisplayRelation["status"],
    fromAssistantId: request.fromAssistantId,
    targetAssistantId: request.targetAssistantId,
  };
}

export function taskAssistantNameById(
  task: TaskFromAPI | undefined | null,
  assistantId: string,
): string | null {
  if (!task) return null;
  if (task.assistantId === assistantId && task.assistant?.name) return task.assistant.name;
  return task.collaborators?.find((participant) => participant.assistantId === assistantId)?.assistant.name ?? null;
}

export function taskHasCompletedTransferForAssistant(
  task: TaskFromAPI | undefined | null,
  assistantId: string,
): boolean {
  const relation = taskTransferDisplayRelation(task);
  return relation?.status === "completed" &&
    (relation.fromAssistantId === assistantId || relation.targetAssistantId === assistantId);
}

export function taskAssigneeNames(task: TaskFromAPI | undefined | null, fallbackName?: string | null): string[] {
  const names = [
    task?.assistant?.name ?? fallbackName ?? null,
    ...helperParticipants(task).map((c) => c.assistant.name),
    ...taskParticipants(task)
      .filter((participant) => participant.status === "completed")
      .map((participant) => participant.assistant.name),
  ].filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

export function formatAssistantScore(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function completedAtMsForRanking(task: TaskFromAPI, participant?: TaskParticipant | null): number {
  const raw = participant?.completedAt ?? task.completedAt ?? task.createdAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function completedContributionForRanking(
  task: TaskFromAPI,
  assistantId: string,
  assistantName: string,
  timingSource: TaskFromAPI | TaskParticipant,
  completedAtMs: number,
  nowMs: number
): AssistantRankingContribution {
  return {
    assistantId,
    assistantName,
    taskId: task.id,
    taskName: displayTaskCategoryName(task.category?.name, task.priority),
    roomNumber: task.roomNumber,
    buildingId: taskLocationBuildingId(task),
    completedAtMs,
    workSeconds: totalEffectiveWorkSecondsFromApi(
      { ...timingSource, status: "completed" },
      nowMs,
    ),
  };
}

export function taskCompletedContributionsForRanking(task: TaskFromAPI, nowMs: number): AssistantRankingContribution[] {
  const rows: AssistantRankingContribution[] = [];
  const seenAssistantIds = new Set<string>();

  if (task.assistantId && task.status === "completed") {
    const primary = taskParticipantForProfile(task, task.assistantId);
    rows.push(completedContributionForRanking(
      task,
      task.assistantId,
      task.assistant?.name ?? "未命名助理",
      primary ?? task,
      completedAtMsForRanking(task, primary),
      nowMs,
    ));
    seenAssistantIds.add(task.assistantId);
  }

  for (const participant of taskParticipants(task)) {
    if (participant.status !== "completed") continue;
    if (seenAssistantIds.has(participant.assistantId)) continue;
    rows.push(completedContributionForRanking(
      task,
      participant.assistantId,
      participant.assistant.name,
      participant,
      completedAtMsForRanking(task, participant),
      nowMs,
    ));
    seenAssistantIds.add(participant.assistantId);
  }

  return rows;
}

export function resolveAssistantTasks(taskData: TaskFromAPI[], profileId?: string): {
  current: TaskFromAPI | null;
  paused: TaskFromAPI | null;
  pending: TaskFromAPI | null;
  deferredWaiting: TaskFromAPI | null;
} {
  const statusOf = (task: TaskFromAPI) => taskStatusForProfile(task, profileId) ?? task.status;
  const belongsToProfile = (task: TaskFromAPI) => taskBelongsToProfile(task, profileId);
  const executing = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "executing") || null;
  const paused = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "paused") || null;
  // waiting + parentTaskId = 插单待处理（pending）；waiting + no parentTaskId = 普通待就位
  const waitingWithParent = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "waiting" && t.parentTaskId && !isPassiveIroningWaitingTask(t)) || null;
  const waitingNormal = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "waiting" && !t.parentTaskId && !isPassiveIroningWaitingTask(t)) || null;
  const passiveIroningWaiting = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "waiting" && isPassiveIroningWaitingTask(t)) || null;

  if (executing && waitingWithParent) {
    // 旧任务执行中，新插单任务待处理
    return { current: executing, paused: null, pending: waitingWithParent, deferredWaiting: null };
  }
  if (paused && waitingWithParent) {
    // 旧任务已暂停，新插单任务待就位
    return { current: waitingWithParent, paused, pending: null, deferredWaiting: null };
  }
  if (paused && executing) {
    // 旧任务已暂停，新插单任务执行中
    return { current: executing, paused, pending: null, deferredWaiting: null };
  }
  if (paused?.parentTaskId) {
    const parentOfPaused = taskData.find((t) => t.id === paused.parentTaskId);
    if (
      parentOfPaused &&
      statusOf(parentOfPaused) === "waiting" &&
      belongsToProfile(parentOfPaused)
    ) {
      // 紧急插单已接单后中途暂停：原任务仍让行，当前应恢复暂停中的紧急单。
      return { current: null, paused, pending: null, deferredWaiting: parentOfPaused };
    }
  }
  if (executing?.parentTaskId) {
    const parentOfExec = taskData.find((t) => t.id === executing.parentTaskId);
    if (
      parentOfExec &&
      statusOf(parentOfExec) === "waiting" &&
      belongsToProfile(parentOfExec)
    ) {
      // 待就位插单后已开始执行紧急单，父任务仍在 waiting（地图灰头像场景）
      return { current: executing, paused: null, pending: null, deferredWaiting: parentOfExec };
    }
  }
  if (waitingWithParent) {
    const parent = taskData.find((t) => t.id === waitingWithParent.parentTaskId);
    if (
      parent &&
      statusOf(parent) === "waiting" &&
      belongsToProfile(parent)
    ) {
      // 待就位被更高优先插单：当前为紧急单，原单让行（仍为 waiting）
      return { current: waitingWithParent, paused: null, pending: null, deferredWaiting: parent };
    }
  }
  // 普通单任务
  const current = executing || waitingNormal || waitingWithParent || passiveIroningWaiting || null;
  return { current, paused, pending: null, deferredWaiting: null };
}

export function actionableWaitingTasksForProfile(taskData: TaskFromAPI[], profileId?: string): TaskFromAPI[] {
  const statusOf = (task: TaskFromAPI) => taskStatusForProfile(task, profileId) ?? task.status;
  const belongsToProfile = (task: TaskFromAPI) => taskBelongsToProfile(task, profileId);
  const waitingTasks = taskData.filter((task) =>
    belongsToProfile(task) &&
    statusOf(task) === "waiting" &&
    !isPassiveIroningWaitingTask(task)
  );

  return waitingTasks.sort((a, b) => {
    const aIroningReady = isAssignedIroningReadyTask(a, profileId) ? 0 : 1;
    const bIroningReady = isAssignedIroningReadyTask(b, profileId) ? 0 : 1;
    return a.priority - b.priority ||
      aIroningReady - bIroningReady ||
      taskDurationSortMinutes(a) - taskDurationSortMinutes(b) ||
      taskMaxDurationSortMinutes(a) - taskMaxDurationSortMinutes(b) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function hasWorkingTaskForProfile(taskData: TaskFromAPI[], profileId?: string): boolean {
  if (!profileId) return false;
  return taskData.some((task) => {
    if (!taskBelongsToProfile(task, profileId)) return false;
    const status = taskStatusForProfile(task, profileId) ?? task.status;
    return status === "executing" || status === "paused";
  });
}

function taskDurationSortMinutes(task: TaskFromAPI): number {
  return task.category?.minDuration ?? task.category?.estDuration ?? task.category?.maxDuration ?? 9999;
}

function taskMaxDurationSortMinutes(task: TaskFromAPI): number {
  return task.category?.maxDuration ?? task.category?.estDuration ?? task.category?.minDuration ?? 9999;
}

export function taskTypeGroupName(name: string | null | undefined): string {
  if (!name) return "其他";
  return TASK_CATEGORY_GROUP[name] || "其他";
}

export function isIroningTask(task: TaskFromAPI | null | undefined): boolean {
  if (!task) return false;
  const name = task.category?.name ?? "";
  return taskTypeGroupName(name) === "熨烫" || name.includes("熨");
}

export function isPassiveIroningWaitingTask(task: TaskFromAPI | null | undefined): boolean {
  return !!task &&
    isIroningTask(task) &&
    task.status === "waiting" &&
    task.ironingStage === "waiting_machine";
}

export type PassiveIroningWaitingPresentation = {
  label: "等待熨烫机" | "忙后熨烫";
  description: string;
};

export function passiveIroningWaitingPresentation(
  task: TaskFromAPI | null | undefined,
  options?: {
    freeIroningMachineCount?: number;
    hasWorkingTaskForProfile?: boolean;
  },
): PassiveIroningWaitingPresentation {
  const machineHasFreeSlot = (options?.freeIroningMachineCount ?? 0) > 0;
  const shouldShowBusyAfter =
    isPassiveIroningWaitingTask(task) &&
    machineHasFreeSlot &&
    options?.hasWorkingTaskForProfile === true;

  if (shouldShowBusyAfter) {
    return {
      label: "忙后熨烫",
      description: "熨烫机有空，完成当前任务后再熨烫",
    };
  }

  return {
    label: "等待熨烫机",
    description: "当前无空余熨烫机，只能开始做其他任务",
  };
}

export function isUnstartedTask(task: TaskFromAPI | null | undefined): boolean {
  return !!task && task.status === "waiting" && !task.startedAt;
}

export function canCancelTaskFromWorkbench(
  task: TaskFromAPI | null | undefined,
  _allTasks: TaskFromAPI[]
): boolean {
  return isUnstartedTask(task);
}

export function isAssignedIroningReadyTask(task: TaskFromAPI | null | undefined, profileId?: string): boolean {
  if (!task || !isIroningTask(task) || task.status !== "waiting") return false;
  if (task.ironingStage === "waiting_machine") return false;
  if (task.ironingStage === "notified") return true;
  if (!profileId) return !!task.assistantId || activeTaskParticipants(task).length > 0;
  return task.assistantId === profileId || !!taskParticipantForProfile(task, profileId);
}

export function canStartWaitingTaskWithIroningCapacity(
  task: TaskFromAPI,
  profileId: string | null | undefined,
  freeIroningMachineCount: number,
): boolean {
  if (!isIroningTask(task)) return true;
  if (task.ironingStage === "notified") return true;
  return freeIroningMachineCount >= ironingMachineSlotsForTask(task);
}

export function assistantStartCandidateTasksForProfile(
  ownTaskData: TaskFromAPI[],
  areaTaskData: TaskFromAPI[],
  profileId: string,
  freeIroningMachineCount: number,
  options?: { blockRootStartWhenWorking?: boolean },
): TaskFromAPI[] {
  const blockRootStart = options?.blockRootStartWhenWorking === true &&
    hasWorkingTaskForProfile([...ownTaskData, ...areaTaskData], profileId);
  const canOfferStart = (task: TaskFromAPI) =>
    !(blockRootStart && !task.parentTaskId) &&
    canStartWaitingTaskWithIroningCapacity(task, profileId, freeIroningMachineCount);

  const ownCandidates = actionableWaitingTasksForProfile(ownTaskData, profileId)
    .filter(canOfferStart);
  const seen = new Set(ownCandidates.map((task) => task.id));
  const areaIroningCandidates = areaTaskData.filter((task) => {
    if (seen.has(task.id)) return false;
    if (!isIroningTask(task) || task.status !== "waiting") return false;
    if (task.parentTaskId != null || task.isLocked) return false;
    if (helperParticipants(task).length > 0) return false;
    return canOfferStart(task);
  });

  const sortedCandidates = [...ownCandidates, ...areaIroningCandidates].sort((a, b) => {
    const aIroning = isIroningTask(a) && canStartWaitingTaskWithIroningCapacity(a, profileId, freeIroningMachineCount) ? 0 : 1;
    const bIroning = isIroningTask(b) && canStartWaitingTaskWithIroningCapacity(b, profileId, freeIroningMachineCount) ? 0 : 1;
    if (aIroning === 0 && bIroning === 0) {
      return taskDurationSortMinutes(a) - taskDurationSortMinutes(b) ||
        taskMaxDurationSortMinutes(a) - taskMaxDurationSortMinutes(b) ||
        a.priority - b.priority ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return aIroning - bIroning ||
      a.priority - b.priority ||
      taskDurationSortMinutes(a) - taskDurationSortMinutes(b) ||
      taskMaxDurationSortMinutes(a) - taskMaxDurationSortMinutes(b) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const highestStartablePriority = sortedCandidates.length > 0
    ? Math.min(...sortedCandidates.map((task) => task.priority))
    : null;
  const priorityFilteredCandidates = highestStartablePriority == null
    ? sortedCandidates
    : sortedCandidates.filter((task) => task.priority === highestStartablePriority);

  let keptIroningTaskId: string | null = null;
  return priorityFilteredCandidates.filter((task) => {
    const isStartableIroning = isIroningTask(task) && canStartWaitingTaskWithIroningCapacity(task, profileId, freeIroningMachineCount);
    if (!isStartableIroning) return true;
    if (keptIroningTaskId) return false;
    keptIroningTaskId = task.id;
    return true;
  });
}

export function apiTaskToDisplay(t: TaskFromAPI, profileId?: string): DisplayTask {
  // waiting 的两种业务含义：未分配=队列中；已分配但未开始=待就位。
  const viewerStatus = taskStatusForProfile(t, profileId) ?? t.status;
  const timingSource = taskTimingForProfile(t, profileId);
  const incomingTransferPresentation = incomingTransferPresentationForProfile(t, profileId);
  const hasAssignedPerson = !!t.assistantId || activeTaskParticipants(t).length > 0;
  const effectiveStatus = incomingTransferPresentation?.statusKey
    ?? (isPhotographerLimitQueuedTask(t)
    ? "queued"
    : isIroningTask(t) && t.status === "waiting" && t.ironingStage === "waiting_machine"
      ? "waitingMachine"
    : isAssignedIroningReadyTask(t, profileId)
      ? "ironingReady"
    : viewerStatus === "waiting"
      ? hasAssignedPerson ? "assigned" : "queued"
      : viewerStatus);
  const style = STATUS_STYLE[effectiveStatus] || STATUS_STYLE.waiting;
  const PRIORITY_LABEL: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };
  const timePeriod = PRIORITY_LABEL[t.priority] || t.category?.name || "任务";
  const estMin = t.category?.estDuration;
  const estimatedLabel = estMin != null && estMin > 0 ? fmtMin(estMin) : "—";
  const durationSlotLabel = categoryDurationSlotLabel(t.category);
  let time = "";
  let actualTime = "";
  let progress: number | null = null;
  if (effectiveStatus === "executing") {
    const elapsedMin = effectiveWorkMinutesFromApi(timingSource);
    const estDur = t.category?.estDuration;
    const estWall =
      t.estEndTime && t.startedAt
        ? Math.floor(
            (new Date(t.estEndTime).getTime() - new Date(t.startedAt).getTime()) / 60000
          )
        : null;
    const estMin = estDur != null && estDur > 0 ? estDur : estWall;
    if (estMin != null && estMin > 0) {
      time = `已执行${fmtMin(elapsedMin)}/${fmtMin(estMin)}`;
      progress = Math.min(100, Math.round((elapsedMin / estMin) * 100));
    } else {
      time = `已执行${fmtMin(elapsedMin)}`;
      progress = null;
    }
    actualTime = `已进行${fmtMin(elapsedMin)}`;
  } else if (effectiveStatus === "completed" && timingSource.startedAt && timingSource.completedAt) {
    const used = effectiveWorkMinutesFromApi(timingSource);
    time = `用时${fmtMin(used)}`;
    actualTime = fmtMin(used);
  } else if (effectiveStatus === "paused") {
    const elapsedMin = effectiveWorkMinutesFromApi(timingSource);
    time = `已执行${fmtMin(elapsedMin)}(暂停)`;
    actualTime = `已进行${fmtMin(elapsedMin)}`;
  } else {
    time = timePeriod;
    actualTime = "";
  }
  return {
    id: t.id,
    name: t.category?.name ?? "任务",
    room: t.roomNumber,
    time,
    timePeriod,
    estimatedLabel,
    durationSlotLabel,
    actualTime,
    progress,
    isSpecified: Boolean(t.isSpecified),
    specifiedAssistantName: t.specifiedAssistant?.name ?? (t.isSpecified ? t.assistant?.name ?? null : null),
    assistantName: t.assistant?.name || null,
    photographerName: t.photographer?.name || null,
    createdAt: t.createdAt,
    estEndTime: t.estEndTime,
    publisherFeedback: t.publisherFeedback ?? null,
    ...style,
  };
}

/**
 * 任务列表「实际用时」列 / 卡片第二行右侧：进行中·已暂停→已超时/已进行；等待中·待就位→已等待（随 now 刷新）
 */
export function taskListActualLine(
  d: DisplayTask,
  raw: TaskFromAPI | undefined,
  nowMs: number,
  forCard: boolean,
  profileId?: string
): string | null {
  if (d.statusLabel === "待确认交换" || d.statusLabel === "待确认移交" || d.statusLabel === "结束后接替") {
    return null;
  }
  if (d.statusLabel === "进行中" || d.statusLabel === "已暂停") {
    if (raw) {
      const timingSource = taskTimingForProfile(raw, profileId);
      const status = taskStatusForProfile(raw, profileId) ?? raw.status;
      const over = overtimeMinutesBeyondSlot({ ...timingSource, status, category: raw.category }, nowMs);
      if (over != null) return `已超时${fmtMin(over)}`;
    }
    const m = raw ? effectiveWorkMinutesFromApi(taskTimingForProfile(raw, profileId), nowMs) : 0;
    return `已进行${fmtMin(m)}`;
  }
  if (d.statusLabel === "队列中" || d.statusLabel === "等待中" || d.statusLabel === "待就位" || d.statusLabel === "忙后熨烫") {
    const startedAt = raw ? taskWaitingStartedAt(raw, profileId) : d.createdAt;
    const m = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 60000));
    return `已等待${fmtMin(m)}`;
  }
  if (d.statusLabel === "已完成" && d.actualTime) {
    return forCard ? `实际用时${d.actualTime}` : d.actualTime;
  }
  return null;
}

export function taskPauseKind(task: TaskFromAPI | undefined, allTasks: TaskFromAPI[]): TaskPauseKind | null {
  return taskPauseKindFromLookup(task, buildTaskPauseLookup(allTasks));
}

export type TaskPauseLookup = {
  activeInterruptedParentIds: ReadonlySet<string>;
};

export function buildTaskPauseLookup(allTasks: TaskFromAPI[]): TaskPauseLookup {
  const activeInterruptedParentIds = new Set<string>();
  for (const candidate of allTasks) {
    if (candidate.parentTaskId && candidate.status !== "completed") {
      activeInterruptedParentIds.add(candidate.parentTaskId);
    }
  }
  return { activeInterruptedParentIds };
}

export function taskPauseKindFromLookup(
  task: TaskFromAPI | undefined,
  lookup: TaskPauseLookup,
): TaskPauseKind | null {
  if (!task || task.status !== "paused") return null;
  return lookup.activeInterruptedParentIds.has(task.id) ? "interrupt" : "manual";
}

export function taskStatusLabelForList(
  d: DisplayTask,
  raw: TaskFromAPI | undefined,
  allTasks: TaskFromAPI[],
  options?: {
    profileId?: string | null;
    freeIroningMachineCount?: number;
  },
): string {
  const incomingTransferPresentation = incomingTransferPresentationForProfile(raw, options?.profileId ?? undefined);
  if (incomingTransferPresentation) return incomingTransferPresentation.label;
  if (raw && isPassiveIroningWaitingTask(raw)) {
    return passiveIroningWaitingPresentation(raw, {
      freeIroningMachineCount: options?.freeIroningMachineCount,
      hasWorkingTaskForProfile: hasWorkingTaskForProfile(allTasks, options?.profileId ?? undefined),
    }).label;
  }
  if (raw && raw.status === "waiting" && raw.parentTaskId) return "插单等待中";
  if (raw && raw.status === "waiting" && raw.startedAt) {
    const hasActiveInterrupt = allTasks.some(
      (candidate) =>
        candidate.parentTaskId === raw.id &&
        candidate.status !== "completed"
    );
    if (hasActiveInterrupt) return "让行中";
  }
  if (d.statusLabel !== "已暂停") return d.statusLabel;
  const kind = taskPauseKind(raw, allTasks);
  if (kind === "interrupt") return "插单暂停中";
  if (kind === "manual") return "手动暂停中";
  return d.statusLabel;
}

export type PublicQueueStatusInfo = {
  label: string;
  cls: string;
  rank: number;
  assignedWaiting: boolean;
};

export function publicQueueStatusInfoFromLookup(
  task: TaskFromAPI,
  lookup: TaskPauseLookup,
): PublicQueueStatusInfo {
  if (task.status === "paused") {
    const kind = taskPauseKindFromLookup(task, lookup);
    return {
      label: kind === "interrupt" ? "插单暂停" : "暂停",
      cls: "bg-yellow-100/70 text-yellow-700",
      rank: 2,
      assignedWaiting: false,
    };
  }

  const assigned = !!task.assistantId || activeTaskParticipants(task).length > 0;
  return assigned
    ? { label: "已分配待就位", cls: "bg-blue-100/70 text-blue-700", rank: 0, assignedWaiting: true }
    : { label: "未分配待派发", cls: "bg-gray-100/80 text-gray-600", rank: 1, assignedWaiting: false };
}

export function publicQueueStatusInfo(task: TaskFromAPI, allTasks: TaskFromAPI[]): PublicQueueStatusInfo {
  return publicQueueStatusInfoFromLookup(task, buildTaskPauseLookup(allTasks));
}

export function publicQueueRankCls(index: number): string {
  if (index === 0) return "bg-red-500 text-white shadow-red-200/80";
  if (index === 1) return "bg-orange-500 text-white shadow-orange-200/80";
  if (index === 2) return "bg-yellow-400 text-yellow-950 shadow-yellow-200/80";
  return "bg-gray-200/90 text-gray-600 shadow-gray-200/70";
}

export function publicQueueRankLabel(index: number, priority: number): string {
  if (index < 3) return String(index + 1);
  const level = Math.min(6, Math.max(1, Math.round(Number(priority) || 6)));
  return `P${level}`;
}

export function publicQueuePriorityLevelCls(priority: number): string {
  const level = Math.min(6, Math.max(1, Math.round(Number(priority) || 6)));
  const priorityCls: Record<number, string> = {
    1: "bg-red-50 text-red-600 shadow-red-100/70",
    2: "bg-orange-50 text-orange-600 shadow-orange-100/70",
    3: "bg-yellow-50 text-yellow-600 shadow-yellow-100/70",
    4: "bg-blue-50 text-blue-600 shadow-blue-100/70",
    5: "bg-gray-100/80 text-gray-500 shadow-gray-200/70",
    6: "bg-purple-50 text-purple-600 shadow-purple-100/70",
  };
  return priorityCls[level];
}

export function priorityTextColorCls(priority: number): string {
  const level = Math.min(6, Math.max(1, Math.round(Number(priority) || 6)));
  const priorityCls: Record<number, string> = {
    1: "text-red-600",
    2: "text-orange-600",
    3: "text-yellow-600",
    4: "text-blue-600",
    5: "text-gray-500",
    6: "text-purple-600",
  };
  return priorityCls[level];
}

export function publicQueueRankShapeCls(index: number, priority: number): string {
  if (index < 3) return `h-5 w-5 rounded-full ${publicQueueRankCls(index)}`;
  const level = Math.min(6, Math.max(1, Math.round(Number(priority) || 6)));
  return `h-5 w-8 rounded-lg ${publicQueuePriorityLevelCls(level)}`;
}

export function sortPublicQueueTasks(
  tasks: TaskFromAPI[],
  allTasks: TaskFromAPI[],
  priorityOf: (task: TaskFromAPI) => number = (task) => task.priority,
  statusInfoOf?: (task: TaskFromAPI) => PublicQueueStatusInfo,
): TaskFromAPI[] {
  let resolveStatusInfo = statusInfoOf;
  if (!resolveStatusInfo) {
    const fallbackLookup = buildTaskPauseLookup(allTasks);
    resolveStatusInfo = (task: TaskFromAPI) => publicQueueStatusInfoFromLookup(task, fallbackLookup);
  }
  return [...tasks].sort((a, b) => {
    const statusA = resolveStatusInfo(a).rank;
    const statusB = resolveStatusInfo(b).rank;
    const createdA = new Date(a.createdAt).getTime();
    const createdB = new Date(b.createdAt).getTime();
    return (
      statusA - statusB ||
      priorityOf(a) - priorityOf(b) ||
      createdA - createdB
    );
  });
}

export function publicQueueEscalationKey(task: TaskFromAPI): string | null {
  if (!task.escalatedAt) return null;
  return `${task.id}:${task.escalatedAt}:${task.priority}`;
}

export function priorityTransitionLabel(task: TaskFromAPI | undefined): string {
  if (!task?.escalatedAt) return "";
  const from = task.escalatedFromPriority;
  if (typeof from === "number" && Number.isFinite(from) && from > task.priority) {
    return `P${from}→P${task.priority} 提权`;
  }
  return "提权";
}

export function ironingQueueOrderMs(task: TaskFromAPI): number {
  const raw = task.ironingQueuedAt ?? task.ironingNotifiedAt ?? task.createdAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function ironingQueueEstimateMinutes(task: TaskFromAPI): number {
  return taskSlotCapMinutes(task.category) ?? task.category?.estDuration ?? 30;
}

export function isMapDeferredIroningWaitingTask(task: TaskFromAPI | null | undefined): boolean {
  return !!task &&
    isIroningTask(task) &&
    task.status === "waiting" &&
    task.ironingStage === "waiting_machine";
}

export function buildDurationLabel(min: number, max: number): string {
  if (min > 0 && max > 0) return `${min}-${max}分钟`;
  if (max > 0) return `${max}分钟以内`;
  if (min > 0) return `${min}分钟以上`;
  return "未设置";
}

/** 与快捷预约按钮一致：优先类别 min/max 时段，否则退回 estDuration */
export function categoryDurationSlotLabel(
  cat: { minDuration?: number; maxDuration?: number; estDuration?: number } | undefined
): string {
  if (!cat) return "—";
  const min = cat.minDuration;
  const max = cat.maxDuration;
  if (typeof min === "number" && typeof max === "number" && (min > 0 || max > 0)) {
    return buildDurationLabel(min, max);
  }
  if (typeof cat.estDuration === "number" && cat.estDuration > 0) return fmtMin(cat.estDuration);
  return "—";
}

/** 统计明细等：月/日 + 时:分（本地） */
export function formatTaskDetailDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function statsWeekStart(weekOffset = 0, base = new Date()): Date {
  const dow = base.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + mondayOffset + weekOffset * 7);
}

export function statsDayDate(weekOffset: number, dayIndex: number, base = new Date()): Date {
  const monday = statsWeekStart(weekOffset, base);
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIndex);
}

export function formatStatsDateLabel(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

const PRIORITY_DUR: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };

/** 与快捷预约按钮一致：优先用任务类型的 min/max，避免 P 档固定文案与后台配置不一致 */
export function taskCategoryDurationCaption(
  category: { minDuration?: number; maxDuration?: number; estDuration?: number } | undefined,
  priority: number
): string {
  const min = category?.minDuration;
  const max = category?.maxDuration;
  if (typeof min === "number" && typeof max === "number" && (min > 0 || max > 0)) {
    return buildDurationLabel(min, max);
  }
  const est = category?.estDuration;
  if (typeof est === "number" && est > 0) return fmtMin(est);
  return PRIORITY_DUR[priority] || "";
}

/** 地图 tooltip 首行：超时显示「已超时X」，否则「已进行X」 */
export function formatMapTaskElapsedLine(task: TaskFromAPI, nowMs: number): string | null {
  if (task.status !== "executing" && task.status !== "paused") return null;
  const elapsed = effectiveWorkMinutesFromApi(task, nowMs);
  const cap = taskSlotCapMinutes(task.category);
  if (cap != null && elapsed > cap) return `已超时${fmtMin(elapsed - cap)}`;
  if (elapsed > 0) return `已进行${fmtMin(elapsed)}`;
  return null;
}

const TASK_CATEGORY_GROUP: Record<string, string> = {
  "短时手持": "手持", "手持": "手持",
  "服装穿戴": "服装穿戴", "穿戴对角度": "服装穿戴",
  "手工DIY协助": "手工DIY", "手工DIY制作": "手工DIY", "手工DIY": "手工DIY",
  "短时熨烫": "熨烫", "长时熨烫": "熨烫", "熨烫": "熨烫",
  "外模跟拍协助": "其他", "协助外模拍摄": "其他", "协助外模跟拍": "其他", "其他长时任务": "其他", "其他": "其他",
};

export function isExternalModelFollowTask(task: TaskFromAPI | undefined | null): boolean {
  const name = task?.category?.name ?? "";
  if (isExternalModelAssistTaskName(name, task?.priority)) {
    return true;
  }
  return task?.priority === 6 && taskTypeGroupName(name) === "其他";
}
