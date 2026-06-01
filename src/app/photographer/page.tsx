"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import AssistantDock, { type DockAssistant, type NoteEditAnchor, assistantDockDotColor, DOCK_DOT } from "./AssistantDock";
import {
  effectiveWorkMinutesFromApi,
  overtimeMinutesBeyondSlot,
  taskSlotCapMinutes,
  totalEffectiveWorkSecondsFromApi,
  totalPausedSecondsFromApi,
} from "@/lib/taskEffectiveTime";
import {
  COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY,
  parseCollaborationEnabled,
  parseCollaborationMaxParticipants,
  parseCollaborationQueueAutoCloseLimit,
  taskCategoryAllowsCollaboration,
} from "@/lib/collaborationRules";
import {
  PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY,
  isPhotographerLimitQueuedTask,
  photographerLimitQueuePrompt,
  parsePhotographerMaxActiveTasks,
} from "@/lib/photographerTaskLimit";

/** 用时类展示：≤60 分钟显示「X分钟」，>60 按小时、最多一位小数（整数不写 .0） */
function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 60) return `${m}分钟`;
  const h = m / 60;
  const rounded = Math.round(h * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}小时`;
  return `${rounded.toFixed(1)}小时`;
}

type ExtraVenueEntry = { name: string; type?: string };
type WorkbenchBuilding = {
  id: number;
  name: string;
  floorPlanUrl: string | null;
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  extraVenues?: string | null;
  rooms: { id: number; roomNumber: string; xPosition: number; yPosition: number }[];
};

const NOTE_POPUP_WIDTH = 260;
const NOTE_POPUP_ESTIMATED_HEIGHT = 180;
const MANUAL_PAUSE_SLIDE_MS = 340;
const PAUSED_CARD_SOLID_BG = "#edeff3";
const MAP_AWAY_AVATAR_FILTER = "grayscale(1) saturate(0.2)";
const MAP_AWAY_AVATAR_OPACITY = 0.58;
const MAP_AWAY_AVATAR_BG = "rgba(229, 231, 235, 0.55)";
const MAP_AWAY_AVATAR_BORDER = "rgba(156, 163, 175, 0.45)";

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function notePopupPosition(anchor: NoteEditAnchor | null): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 80, top: 80 };

  const margin = 12;
  const gap = 14;
  const fallbackRightOffset = 84;
  const left = anchor
    ? anchor.left - NOTE_POPUP_WIDTH - gap
    : window.innerWidth - NOTE_POPUP_WIDTH - fallbackRightOffset;
  const top = anchor
    ? anchor.top + anchor.height / 2 - NOTE_POPUP_ESTIMATED_HEIGHT / 2
    : 96;

  return {
    left: Math.min(Math.max(margin, left), window.innerWidth - NOTE_POPUP_WIDTH - margin),
    top: Math.min(Math.max(margin, top), window.innerHeight - NOTE_POPUP_ESTIMATED_HEIGHT - margin),
  };
}

/** 解析楼座 extraVenues JSON，非法或空时返回 []，避免 hover 整页崩溃 */
function safeExtraVenueEntries(extraVenues: string | null | undefined): ExtraVenueEntry[] {
  if (!extraVenues || !extraVenues.trim()) return [];
  try {
    const raw = JSON.parse(extraVenues) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: ExtraVenueEntry[] = [];
    for (const v of raw) {
      if (typeof v === "string") {
        if (v) out.push({ name: v });
        continue;
      }
      if (v && typeof v === "object" && "name" in v) {
        const o = v as { name: string; type?: string };
        const name = String(o.name ?? "");
        if (name) out.push({ name, type: o.type });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function defaultBuildingVenue(building: WorkbenchBuilding | null | undefined): string | null {
  if (!building) return null;
  const venues = safeExtraVenueEntries(building.extraVenues);
  const realScene = venues.find((v) => v.type === "实景棚");
  if (realScene?.name) return realScene.name;
  if (venues[0]?.name) return venues[0].name;
  return building.rooms[0]?.roomNumber ?? null;
}

function formatRoomOrVenue(value: string | null | undefined): string {
  if (!value) return "";
  if (value.endsWith("室")) return value;
  return /^\d+$/.test(value) ? `${value}室` : value;
}

function venueBelongsToBuilding(building: WorkbenchBuilding | null | undefined, value: string | null | undefined): boolean {
  if (!building || !value) return false;
  const normalized = value.endsWith("室") ? value.slice(0, -1) : value;
  const isRoom = building.rooms.some((room) => room.roomNumber === normalized);
  const isPublicVenue = safeExtraVenueEntries(building.extraVenues).some((venue) => venue.name === value);
  return isRoom || isPublicVenue;
}

/** 助理任务状态区：总秒数 → HH:MM:SS（时可为三位以上） */
function formatSecondsAsHMS(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hh = h > 99 ? String(h) : String(h).padStart(2, "0");
  return `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type ThemeMode = "light" | "dark" | "auto";

type TaskFromAPI = {
  id: string;
  photographerId: string;
  assistantId: string | null;
  locationBuildingId?: number | null;
  roomNumber: string;
  categoryId: number;
  priority: number;
  status: "waiting" | "executing" | "paused" | "completed";
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  escalatedAt?: string | null;
  escalatedFromPriority?: number | null;
  estEndTime: string | null;
  effectiveWorkSeconds?: number | null;
  workSegmentStartedAt?: string | null;
  isLocked: boolean;
  lockReason: string | null;
  parentTaskId: string | null;
  photographer: { id: string; name: string; currentRoom: string | null; buildingId: number };
  assistant: { id: string; name: string; currentRoom: string | null } | null;
  collaborators?: {
    id: string;
    taskId: string;
    assistantId: string;
    role: string;
    status: string;
    joinedAt: string;
    leftAt: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    effectiveWorkSeconds?: number | null;
    workSegmentStartedAt?: string | null;
    assistant: { id: string; name: string; currentRoom: string | null; avatar: string | null; buildingId: number };
  }[];
  category: {
    id: number;
    name: string;
    priorityLevel: number;
    estDuration?: number;
    minDuration?: number;
    maxDuration?: number;
  };
};

type StandbyReassignmentNoticeFromAPI = {
  id: string;
  taskId: string;
  oldAssistantId: string;
  oldAssistantName: string;
  newAssistantId: string;
  newAssistantName: string;
  taskRoomNumber: string;
  taskCategoryName: string;
  taskPriority: number;
  waitedMinutes: number;
  thresholdMinutes: number;
  score: number;
  newAssistantAcknowledgedAt: string | null;
  oldAssistantAcknowledgedAt: string | null;
  createdAt: string;
  task?: {
    id: string;
    note: string | null;
    roomNumber: string;
    status: TaskFromAPI["status"];
  } | null;
};

type DisplayTask = {
  id: string;
  name: string;
  room: string;
  time: string;
  timePeriod: string;
  /** 任务类型配置的预估时长（摄影师下发所选类别），与优先级档文案无关 */
  estimatedLabel: string;
  /** 快捷预约所选 min–max 时段文案，与按钮标签一致 */
  durationSlotLabel: string;
  actualTime: string;
  progress: number | null;
  statusLabel: string;
  statusCls: string;
  tagCls: string;
  hasProgress: boolean;
  assistantName: string | null;
  photographerName: string | null;
  createdAt: string;
  estEndTime: string | null;
};

const STATUS_STYLE: Record<string, { statusLabel: string; statusCls: string; tagCls: string; hasProgress: boolean }> = {
  executing: { statusLabel: "进行中", statusCls: "bg-white/40 border-orange-200/50", tagCls: "bg-orange-100/60 text-orange-600", hasProgress: true },
  waiting:   { statusLabel: "等待中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/60 text-gray-500", hasProgress: false },
  queued:    { statusLabel: "队列中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/80 text-gray-500", hasProgress: false },
  assigned:  { statusLabel: "待就位", statusCls: "bg-white/35 border-blue-200/50", tagCls: "bg-blue-100/60 text-blue-600", hasProgress: false },
  completed: { statusLabel: "已完成", statusCls: "bg-white/30 border-white/40", tagCls: "bg-green-100/60 text-green-600", hasProgress: false },
  paused:    { statusLabel: "已暂停", statusCls: "bg-white/25 border-yellow-200/40", tagCls: "bg-yellow-100/60 text-yellow-600", hasProgress: false },
};

// 任务状态排序权重：超过上限后的个人队列优先提醒，其余按待就位 → 等待中 → 进行中 → 已暂停 → 已完成
const STATUS_ORDER: Record<string, number> = { "队列中": 0, "待就位": 1, "等待中": 2, "进行中": 3, "已暂停": 4, "已完成": 5, "已取消": 6 };
function sortTasksByStatus(tasks: DisplayTask[]): DisplayTask[] {
  return [...tasks].sort((a, b) => (STATUS_ORDER[a.statusLabel] ?? 99) - (STATUS_ORDER[b.statusLabel] ?? 99));
}

type TaskParticipant = NonNullable<TaskFromAPI["collaborators"]>[number];
const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"];

function taskParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return (task?.collaborators ?? []).filter((c) => c.status !== "left");
}

function helperParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return taskParticipants(task).filter((c) => c.role !== "primary" && c.assistantId !== task?.assistantId);
}

function activeTaskParticipants(task: TaskFromAPI | undefined | null): TaskParticipant[] {
  return taskParticipants(task).filter((c) => ACTIVE_PARTICIPANT_STATUSES.includes(c.status));
}

function taskParticipantForProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined
): TaskParticipant | null {
  if (!task || !profileId) return null;
  return taskParticipants(task).find((c) => c.assistantId === profileId) ?? null;
}

function taskStatusForProfile(
  task: TaskFromAPI | undefined | null,
  profileId: string | null | undefined
): string | null {
  return taskParticipantForProfile(task, profileId)?.status ?? task?.status ?? null;
}

function taskTimingForProfile(
  task: TaskFromAPI,
  profileId: string | null | undefined
): TaskFromAPI | TaskParticipant {
  return taskParticipantForProfile(task, profileId) ?? task;
}

function participantStatusText(status: string): string {
  if (status === "waiting") return "待就位";
  if (status === "executing") return "进行中";
  if (status === "paused") return "暂停中";
  if (status === "completed") return "已完成";
  return "已离开";
}

function taskAssigneeNames(task: TaskFromAPI | undefined | null, fallbackName?: string | null): string[] {
  const names = [
    task?.assistant?.name ?? fallbackName ?? null,
    ...helperParticipants(task).map((c) => c.assistant.name),
  ].filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

function resolveAssistantTasks(taskData: TaskFromAPI[], profileId?: string): {
  current: TaskFromAPI | null;
  paused: TaskFromAPI | null;
  pending: TaskFromAPI | null;
  deferredWaiting: TaskFromAPI | null;
} {
  const statusOf = (task: TaskFromAPI) => taskStatusForProfile(task, profileId) ?? task.status;
  const belongsToProfile = (task: TaskFromAPI) => !profileId || task.assistantId === profileId || !!taskParticipantForProfile(task, profileId);
  const executing = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "executing") || null;
  const paused = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "paused") || null;
  // waiting + parentTaskId = 插单待处理（pending）；waiting + no parentTaskId = 普通待就位
  const waitingWithParent = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "waiting" && t.parentTaskId) || null;
  const waitingNormal = taskData.find((t) => belongsToProfile(t) && statusOf(t) === "waiting" && !t.parentTaskId) || null;

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
  const current = executing || waitingNormal || waitingWithParent || null;
  return { current, paused, pending: null, deferredWaiting: null };
}

function apiTaskToDisplay(t: TaskFromAPI, profileId?: string): DisplayTask {
  // 已分配助理但未开始 → 待就位
  const viewerStatus = taskStatusForProfile(t, profileId) ?? t.status;
  const timingSource = taskTimingForProfile(t, profileId);
  const effectiveStatus = isPhotographerLimitQueuedTask(t)
    ? "queued"
    : (viewerStatus === "waiting" && (t.assistantId || taskParticipantForProfile(t, profileId))) ? "assigned" : viewerStatus;
  const style = STATUS_STYLE[effectiveStatus] || STATUS_STYLE.waiting;
  const PRIORITY_LABEL: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };
  const timePeriod = PRIORITY_LABEL[t.priority] || t.category?.name || "任务";
  const estMin = t.category?.estDuration;
  const estimatedLabel = estMin != null && estMin > 0 ? fmtMin(estMin) : "—";
  const durationSlotLabel = categoryDurationSlotLabel(t.category);
  let time = "";
  let actualTime = "";
  let progress: number | null = null;
  if (viewerStatus === "executing") {
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
  } else if (viewerStatus === "completed" && timingSource.startedAt && timingSource.completedAt) {
    const used = effectiveWorkMinutesFromApi(timingSource);
    time = `用时${fmtMin(used)}`;
    actualTime = fmtMin(used);
  } else if (viewerStatus === "paused") {
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
    assistantName: t.assistant?.name || null,
    photographerName: t.photographer?.name || null,
    createdAt: t.createdAt,
    estEndTime: t.estEndTime,
    ...style,
  };
}

/**
 * 任务列表「实际用时」列 / 卡片第二行右侧：进行中·已暂停→已超时/已进行；等待中·待就位→已等待（随 now 刷新）
 */
function taskListActualLine(
  d: DisplayTask,
  raw: TaskFromAPI | undefined,
  nowMs: number,
  forCard: boolean,
  profileId?: string
): string | null {
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
  if (d.statusLabel === "等待中" || d.statusLabel === "待就位") {
    const m = Math.max(0, Math.floor((nowMs - new Date(d.createdAt).getTime()) / 60000));
    return `已等待${fmtMin(m)}`;
  }
  if (d.statusLabel === "已完成" && d.actualTime) {
    return forCard ? `实际用时${d.actualTime}` : d.actualTime;
  }
  return null;
}

type TaskPauseKind = "manual" | "interrupt";

function taskPauseKind(task: TaskFromAPI | undefined, allTasks: TaskFromAPI[]): TaskPauseKind | null {
  if (!task || task.status !== "paused") return null;
  const hasActiveInterrupt = allTasks.some(
    (candidate) =>
      candidate.parentTaskId === task.id &&
      candidate.status !== "completed"
  );
  return hasActiveInterrupt ? "interrupt" : "manual";
}

function taskStatusLabelForList(d: DisplayTask, raw: TaskFromAPI | undefined, allTasks: TaskFromAPI[]): string {
  if (d.statusLabel !== "已暂停") return d.statusLabel;
  const kind = taskPauseKind(raw, allTasks);
  if (kind === "interrupt") return "插单暂停中";
  if (kind === "manual") return "手动暂停中";
  return d.statusLabel;
}

function publicQueueStatusInfo(task: TaskFromAPI, allTasks: TaskFromAPI[]) {
  if (task.status === "paused") {
    const kind = taskPauseKind(task, allTasks);
    return {
      label: kind === "interrupt" ? "插单暂停" : "暂停",
      cls: "bg-yellow-100/70 text-yellow-700",
      rank: 2,
    };
  }

  const assigned = !!task.assistantId || activeTaskParticipants(task).length > 0;
  return assigned
    ? { label: "待就位", cls: "bg-blue-100/70 text-blue-700", rank: 1 }
    : { label: "未分配", cls: "bg-gray-100/80 text-gray-600", rank: 0 };
}

function publicQueueRankCls(index: number): string {
  if (index === 0) return "bg-red-500 text-white shadow-red-200/80";
  if (index === 1) return "bg-orange-500 text-white shadow-orange-200/80";
  if (index === 2) return "bg-yellow-400 text-yellow-950 shadow-yellow-200/80";
  return "bg-gray-200/90 text-gray-600 shadow-gray-200/70";
}

function publicQueueRankLabel(index: number, priority: number): string {
  if (index < 3) return String(index + 1);
  const level = Math.min(5, Math.max(1, Math.round(Number(priority) || 5)));
  return `P${level}`;
}

function publicQueuePriorityLevelCls(priority: number): string {
  const level = Math.min(5, Math.max(1, Math.round(Number(priority) || 5)));
  const priorityCls: Record<number, string> = {
    1: "bg-red-50 text-red-600 shadow-red-100/70",
    2: "bg-orange-50 text-orange-600 shadow-orange-100/70",
    3: "bg-yellow-50 text-yellow-600 shadow-yellow-100/70",
    4: "bg-blue-50 text-blue-600 shadow-blue-100/70",
    5: "bg-gray-100/80 text-gray-500 shadow-gray-200/70",
  };
  return priorityCls[level];
}

function publicQueueRankShapeCls(index: number, priority: number): string {
  if (index < 3) return `h-5 w-5 rounded-full ${publicQueueRankCls(index)}`;
  const level = Math.min(5, Math.max(1, Math.round(Number(priority) || 5)));
  return `h-5 w-8 rounded-lg ${publicQueuePriorityLevelCls(level)}`;
}

function sortPublicQueueTasks(
  tasks: TaskFromAPI[],
  allTasks: TaskFromAPI[],
  priorityOf: (task: TaskFromAPI) => number = (task) => task.priority
): TaskFromAPI[] {
  return [...tasks].sort((a, b) => {
    const statusA = publicQueueStatusInfo(a, allTasks).rank;
    const statusB = publicQueueStatusInfo(b, allTasks).rank;
    return (
      priorityOf(a) - priorityOf(b) ||
      statusA - statusB ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  });
}

function publicQueueEscalationKey(task: TaskFromAPI): string | null {
  if (!task.escalatedAt) return null;
  return `${task.id}:${task.escalatedAt}:${task.priority}`;
}

function priorityTransitionLabel(task: TaskFromAPI | undefined): string {
  if (!task?.escalatedAt) return "";
  const from = task.escalatedFromPriority;
  if (typeof from === "number" && Number.isFinite(from) && from > task.priority) {
    return `P${from}→P${task.priority}`;
  }
  return "提权";
}

function publicQueueSeenStorageKey(profileId: string): string {
  return `publicQueueEscalationSeen:v2:${profileId}`;
}

function publicQueueOrderStorageKey(profileId: string, buildingId: number | null): string {
  return `publicQueueLastOrder:v2:${profileId}:${buildingId ?? "all"}`;
}

function readPublicQueueSeenEscalations(profileId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(publicQueueSeenStorageKey(profileId)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writePublicQueueSeenEscalations(profileId: string, keys: string[]) {
  if (typeof window === "undefined" || keys.length === 0) return;
  const seen = readPublicQueueSeenEscalations(profileId);
  keys.forEach((key) => seen.add(key));
  localStorage.setItem(publicQueueSeenStorageKey(profileId), JSON.stringify([...seen].slice(-300)));
}

function readPublicQueueLastOrder(profileId: string, buildingId: number | null): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(publicQueueOrderStorageKey(profileId, buildingId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writePublicQueueLastOrder(profileId: string, buildingId: number | null, ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(publicQueueOrderStorageKey(profileId, buildingId), JSON.stringify(ids.slice(0, 80)));
}

function mergePublicQueueOrder(storedIds: string[], finalIds: string[]): string[] {
  const finalSet = new Set(finalIds);
  const ordered = storedIds.filter((id) => finalSet.has(id));
  const orderedSet = new Set(ordered);
  return [...ordered, ...finalIds.filter((id) => !orderedSet.has(id))];
}

function buildSyntheticBeforePromotionIds(finalIds: string[], promotedIds: string[]): string[] {
  const ids = [...finalIds];
  for (const id of promotedIds) {
    const index = ids.indexOf(id);
    if (index < 0 || index >= ids.length - 1) continue;
    ids.splice(index, 1);
    ids.splice(index + 1, 0, id);
  }
  return ids;
}

function taskAllowsCollaboration(task: TaskFromAPI | undefined, collaborationEnabled = true): boolean {
  return collaborationEnabled && task != null && task.status !== "completed" && taskCategoryAllowsCollaboration(task.category);
}

function isAssistantRole(role: string | undefined): boolean {
  return role === "assistant" || role === "assistant_leader";
}

function profileServiceBuildingId(profile: { role: string; buildingId: number; activeBuildingId?: number | null }): number {
  return isAssistantRole(profile.role) ? profile.activeBuildingId ?? profile.buildingId : profile.buildingId;
}

function profileServiceRoom(profile: { role: string; currentRoom: string | null; activeRoom?: string | null }): string | null {
  return isAssistantRole(profile.role) ? profile.activeRoom ?? profile.currentRoom : profile.currentRoom;
}

function taskListUrlForProfile(profile: { id: string; role: string }): string {
  const params = new URLSearchParams({ todayOnly: "true" });
  if (isAssistantRole(profile.role)) {
    params.set("assistantId", profile.id);
  } else if (profile.role === "photographer") {
    params.set("photographerId", profile.id);
  }
  return `/api/tasks?${params.toString()}`;
}

function visibleTasksForProfile(
  raw: TaskFromAPI[],
  profile: { role: string },
  activeBuildingId: number
): TaskFromAPI[] {
  if (profile.role === "admin") {
    return raw.filter((task) => taskLocationBuildingId(task) === activeBuildingId);
  }
  return raw;
}

function taskLocationBuildingId(task: TaskFromAPI | null | undefined): number | null {
  return task?.locationBuildingId ?? task?.photographer?.buildingId ?? null;
}

function isPublicQueueTaskForBuilding(task: TaskFromAPI, buildingId: number | null): boolean {
  return (
    buildingId != null &&
    taskLocationBuildingId(task) === buildingId &&
    !isPhotographerLimitQueuedTask(task) &&
    (task.status === "waiting" || task.status === "paused")
  );
}

function getAutoTheme(): "light" | "dark" {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "light" : "dark";
}

const glass =
  "bg-white/25 backdrop-blur-xl border border-white/30 shadow-lg shadow-black/[0.03]";

// Style config per category name (static visual properties)
const CAT_STYLES: Record<string, { bg: string; active: string; darkBg: string; darkActive: string; text: string; darkText: string }> = {
  "手持": { bg: "bg-red-400/20", active: "bg-red-400/35", darkBg: "bg-red-500/25", darkActive: "bg-red-500/40", text: "text-red-700", darkText: "text-red-300" },
  "服装穿戴": { bg: "bg-orange-400/20", active: "bg-orange-400/35", darkBg: "bg-orange-500/25", darkActive: "bg-orange-500/40", text: "text-orange-700", darkText: "text-orange-300" },
  "手工DIY": { bg: "bg-amber-400/20", active: "bg-amber-400/35", darkBg: "bg-amber-500/25", darkActive: "bg-amber-500/40", text: "text-amber-700", darkText: "text-amber-300" },
  "熨烫": { bg: "bg-emerald-400/20", active: "bg-emerald-400/35", darkBg: "bg-emerald-500/25", darkActive: "bg-emerald-500/40", text: "text-emerald-700", darkText: "text-emerald-300" },
  "其他": { bg: "bg-blue-400/20", active: "bg-blue-400/35", darkBg: "bg-blue-500/25", darkActive: "bg-blue-500/40", text: "text-blue-700", darkText: "text-blue-300" },
};
const CAT_ORDER = ["手持", "服装穿戴", "手工DIY", "熨烫", "其他"];
const PRIORITY_CLS: Record<number, string> = {
  1: "bg-red-500 text-white",
  2: "bg-orange-500 text-white",
  3: "bg-amber-500 text-white",
  4: "bg-blue-500 text-white",
  5: "bg-gray-500 text-white",
};

function buildDurationLabel(min: number, max: number): string {
  if (min > 0 && max > 0) return `${min}-${max}分钟`;
  if (max > 0) return `${max}分钟以内`;
  if (min > 0) return `${min}分钟以上`;
  return "未设置";
}

/** 与快捷预约按钮一致：优先类别 min/max 时段，否则退回 estDuration */
function categoryDurationSlotLabel(
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
function formatTaskDetailDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type DbCategory = { id: number; name: string; priorityLevel: number; minDuration: number; maxDuration: number };
type BuiltCategory = {
  name: string;
  bg: string; active: string; darkBg: string; darkActive: string; text: string; darkText: string;
  durations: { label: string; priority: string; cls: string; categoryId: number }[];
};

function buildCategories(dbCats: DbCategory[]): BuiltCategory[] {
  const result: BuiltCategory[] = [];
  for (const catName of CAT_ORDER) {
    const style = CAT_STYLES[catName];
    if (!style) continue;
    const items = dbCats
      .filter((c) => c.name === catName)
      .sort((a, b) => a.priorityLevel - b.priorityLevel);
    if (items.length === 0) continue;
    result.push({
      name: catName,
      ...style,
      durations: items.map((c) => ({
        label: buildDurationLabel(c.minDuration, c.maxDuration),
        priority: `P${c.priorityLevel}`,
        cls: PRIORITY_CLS[c.priorityLevel] || PRIORITY_CLS[5],
        categoryId: c.id,
      })),
    });
  }
  return result;
}

const PRIORITY_DUR: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };

/** 与快捷预约按钮一致：优先用任务类型的 min/max，避免 P 档固定文案与后台配置不一致 */
function taskCategoryDurationCaption(
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
function formatMapTaskElapsedLine(task: TaskFromAPI, nowMs: number): string | null {
  if (task.status !== "executing" && task.status !== "paused") return null;
  const elapsed = effectiveWorkMinutesFromApi(task, nowMs);
  const cap = taskSlotCapMinutes(task.category);
  if (cap != null && elapsed > cap) return `已超时${fmtMin(elapsed - cap)}`;
  if (elapsed > 0) return `已进行${fmtMin(elapsed)}`;
  return null;
}

/* ============ Dock-style draggable building tabs ============ */
type DockEntry = [number, { name: string; profiles: { id: string }[] }];

function DockBuildingTabs({
  entries,
  activeBld,
  onSelect,
  onReorder,
}: {
  entries: DockEntry[];
  activeBld: number | null;
  onSelect: (id: number) => void;
  onReorder: (order: number[]) => void;
}) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [drag, setDrag] = useState<{
    id: number;
    startX: number;
    currentX: number;
    pointerId: number;
  } | null>(null);
  // visualOrder: the logical order items should appear in (indices into entries)
  const [visualOrder, setVisualOrder] = useState<number[]>(() => entries.map(([id]) => id));
  const dragRef = useRef(drag);
  const visualOrderRef = useRef(visualOrder);
  const suppressClickRef = useRef(false);
  // snapshot of each item's left edge at drag start (keyed by id)
  const startRectsRef = useRef<Map<number, { left: number; width: number }>>(new Map());
  const [startRects, setStartRects] = useState<Map<number, { left: number; width: number }>>(new Map());
  // whether we're in the "settling" phase right after drop
  const [settling, setSettling] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup settle timer on unmount
  useEffect(() => () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current); }, []);

  // Keep refs in sync (avoid writing refs during render)
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  useEffect(() => {
    visualOrderRef.current = visualOrder;
  }, [visualOrder]);

  // Sync when entries change from parent
  useEffect(() => {
    setVisualOrder(entries.map(([id]) => id));
  }, [entries]);

  // Snapshot positions at drag start
  const snapshotPositions = useCallback(() => {
    const m = new Map<number, { left: number; width: number }>();
    for (const [id] of entries) {
      const el = itemRefs.current.get(id);
      if (el) {
        const r = el.getBoundingClientRect();
        m.set(id, { left: r.left, width: r.width });
      }
    }
    startRectsRef.current = m;
    setStartRects(m);
  }, [entries]);

  const handlePointerDown = useCallback((e: React.PointerEvent, id: number) => {
    const el = itemRefs.current.get(id);
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    snapshotPositions();
    setDrag({ id, startX: e.clientX, currentX: e.clientX, pointerId: e.pointerId });
    setVisualOrder(visualOrderRef.current);
    setSettling(false);
  }, [snapshotPositions]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const newX = e.clientX;
    setDrag((prev) => prev ? { ...prev, currentX: newX } : prev);

    // Where is the dragged item's center now?
    const dragEl = itemRefs.current.get(d.id);
    if (!dragEl) return;
    const startRect = startRectsRef.current.get(d.id);
    if (!startRect) return;
    const dx = newX - d.startX;
    const draggedCenter = startRect.left + startRect.width / 2 + dx;

    // Compute new visual order based on dragged center vs other items' resting centers
    const currentOrder = visualOrderRef.current;
    const ids = entries.map(([id]) => id);

    // Compute "resting" center for each slot in visual order
    // We need to know: if items were laid out in visualOrder, what center would each slot have?
    // Use the snapshot widths + gap(8px)
    const gap = 8;
    const slotPositions: { id: number; center: number }[] = [];
    let x = startRectsRef.current.get(currentOrder[0])?.left ?? 0;
    // Recalculate from the leftmost item's original position
    const firstOrigLeft = Math.min(...Array.from(startRectsRef.current.values()).map((r) => r.left));
    x = firstOrigLeft;
    for (const slotId of currentOrder) {
      const w = startRectsRef.current.get(slotId)?.width ?? 60;
      slotPositions.push({ id: slotId, center: x + w / 2 });
      x += w + gap;
    }

    // Remove dragged, find where to insert based on draggedCenter
    const others = currentOrder.filter((id) => id !== d.id);
    const otherSlots = slotPositions.filter((s) => s.id !== d.id);

    let insertIdx = others.length;
    for (let i = 0; i < otherSlots.length; i++) {
      if (draggedCenter < otherSlots[i].center) {
        insertIdx = i;
        break;
      }
    }

    const newOrder = [...others];
    newOrder.splice(insertIdx, 0, d.id);

    // Only update if changed
    if (newOrder.some((id, i) => currentOrder[i] !== id)) {
      setVisualOrder(newOrder);
    }
  }, [entries]);

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const wasDragged = Math.abs(d.currentX - d.startX) > 3;
    // Start settling animation
    setSettling(true);
    setDrag(null);
    // Commit order after settle animation
    const finalOrder = [...visualOrderRef.current];
    settleTimerRef.current = setTimeout(() => {
      startRectsRef.current = new Map();
      setStartRects(new Map());
      onReorder(finalOrder);
      setSettling(false);
    }, 320);
    if (wasDragged) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 100);
    }
  }, [onReorder]);

  // Compute translateX for each item based on visual order vs DOM order
  // DOM order = entries order (fixed), visual order = where they should appear
  const gap = 8;
  const entryIds = entries.map(([id]) => id);

  // Build slot X positions based on visual order
  const slotLefts: number[] = [];
  let xAccum = 0;
  for (const id of visualOrder) {
    slotLefts.push(xAccum);
    const w = startRects.get(id)?.width ?? 0;
    xAccum += w + gap;
  }

  // Build DOM-order X positions
  const domLefts: number[] = [];
  let xAccum2 = 0;
  for (const id of entryIds) {
    domLefts.push(xAccum2);
    const w = startRects.get(id)?.width ?? 0;
    xAccum2 += w + gap;
  }

  // For each item: find its slot index in visualOrder, compute offset from its DOM position
  const offsets = new Map<number, number>();
  for (let domIdx = 0; domIdx < entryIds.length; domIdx++) {
    const id = entryIds[domIdx];
    const slotIdx = visualOrder.indexOf(id);
    if (slotIdx !== -1 && startRects.size > 0) {
      offsets.set(id, slotLefts[slotIdx] - domLefts[domIdx]);
    } else {
      offsets.set(id, 0);
    }
  }

  const isDragging = drag !== null;

  return (
    <div
      className="px-5 pb-3 flex items-center gap-2 relative"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {/* Render in DOM (entries) order — always fixed */}
      {entries.map(([bId, data]) => {
        const isThisDragging = drag?.id === bId;
        const isActive = activeBld === bId;
        const offset = offsets.get(bId) ?? 0;

        let style: React.CSSProperties;
        if (isThisDragging && drag) {
          // Dragged item: follow cursor directly, no transition
          const dx = drag.currentX - drag.startX;
          style = {
            transform: `translateX(${dx}px) scale(1.06)`,
            zIndex: 50,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)",
            transition: "box-shadow 0.15s ease, transform 0s",
            cursor: "grabbing",
          };
        } else if (isDragging || settling) {
          // Other items: smooth slide to their visual slot
          style = {
            transform: offset ? `translateX(${offset}px)` : "none",
            transition: "transform 0.32s cubic-bezier(.2,1,.3,1)",
            cursor: "grab",
            zIndex: 1,
          };
        } else {
          // Idle
          style = {
            transform: "none",
            transition: "none",
            cursor: "grab",
          };
        }

        return (
          <button
            key={bId}
            ref={(el) => { if (el) itemRefs.current.set(bId, el); }}
            onPointerDown={(e) => handlePointerDown(e, bId)}
            onClick={() => { if (!suppressClickRef.current) onSelect(bId); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold select-none relative ${
              isActive
                ? "bg-orange-500 text-white shadow-sm shadow-orange-200"
                : "bg-gray-100 text-[--text-secondary] hover:bg-gray-200"
            }`}
            style={style}
          >
            {data.name} <span className={`ml-0.5 ${isActive ? "text-white/80" : "text-[--text-muted]"}`}>{data.profiles.length}人</span>
          </button>
        );
      })}
    </div>
  );
}

export default function PhotographerPage() {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("themeMode") as ThemeMode) || "light";
    }
    return "light";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [now, setNow] = useState(() => new Date());
  const [tasks, setTasks] = useState<DisplayTask[]>([]);
  const [buildings, setBuildings] = useState<WorkbenchBuilding[]>([]);
  const [activeBuildingId, setActiveBuildingId] = useState<number | null>(null);
  const [assistants, setAssistants] = useState<DockAssistant[]>([]);
  const [genie, setGenie] = useState<{
    sx: number; sy: number; sw: number; sh: number;
    tx: number; ty: number; tw: number; th: number;
    label: string; priority: string; cls: string; catName: string; categoryId: number;
    phase: number;
  } | null>(null);
  const [enteringTaskId, setEnteringTaskId] = useState<string | null>(null);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [taskCreateLimitWarning, setTaskCreateLimitWarning] = useState(false);
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null);
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const taskListContentRef = useRef<HTMLDivElement>(null);
  const taskListDragRef = useRef({ active: false, moved: false, startY: 0, scrollTop: 0 });
  const [taskListScrollY, setTaskListScrollY] = useState(0);
  const suppressTaskClickRef = useRef(false);

  // Current user profile
  const [profile, setProfile] = useState<{
    id: string; name: string; avatar: string | null; employeeId: string | null; role: string;
    currentRoom: string | null; department: string | null; group: string | null;
    activeBuildingId?: number | null; activeRoom?: string | null;
    status: string;
    buildingId: number; building: { id: number; name: string; extraVenues?: string | null };
    onlineStatus: string;
  } | null>(null);
  const [hoveredMapAssistant, setHoveredMapAssistant] = useState<string | null>(null);
  const [notePopupTaskId, setNotePopupTaskId] = useState<string | null>(null);
  const [notePopupValue, setNotePopupValue] = useState("");
  const [notePopupAnchor, setNotePopupAnchor] = useState<NoteEditAnchor | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [editingNoteTaskId, setEditingNoteTaskId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showVenueMenu, setShowVenueMenu] = useState(false);
  const [locationMenu, setLocationMenu] = useState<"building" | "venue" | null>(null);
  const locationMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalRoomRef = useRef<string | null>(null);
  const originalBuildingIdRef = useRef<number | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsHoveredDay, setStatsHoveredDay] = useState<number | null>(null);
  const [weeklyTasks, setWeeklyTasks] = useState<TaskFromAPI[]>([]);
  const [categories, setCategories] = useState<BuiltCategory[]>([]);
  const [endingAlertMin, setEndingAlertMin] = useState(2);
  const [upgradeThresholdMin, setUpgradeThresholdMin] = useState(25);
  const [photographerMaxActiveTasks, setPhotographerMaxActiveTasks] = useState(1);
  const [collaborationEnabledByBuilding, setCollaborationEnabledByBuilding] = useState<Record<number, boolean>>({});
  const [collaborationMaxByBuilding, setCollaborationMaxByBuilding] = useState<Record<number, number>>({});
  const [collaborationQueueAutoCloseLimit, setCollaborationQueueAutoCloseLimit] = useState(10);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [identityBuildingFilter, setIdentityBuildingFilter] = useState<number | null>(null);
  const [identityBuildingOrder, setIdentityBuildingOrder] = useState<number[]>([]);
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string; role: string; employeeId: string | null; department: string | null; group: string | null; avatar: string | null; buildingId: number; currentRoom: string | null; activeBuildingId?: number | null; activeRoom?: string | null; status: string; subStatus?: string | null; onlineStatus: string; building: { id: number; name: string } }[]>([]);
  const [collabTaskId, setCollabTaskId] = useState<string | null>(null);
  const [collabSelectedIds, setCollabSelectedIds] = useState<string[]>([]);
  const [collabSaving, setCollabSaving] = useState(false);
  const [collabLimitWarning, setCollabLimitWarning] = useState(false);
  // 助理当前任务（原始 API 数据）
  const [currentRawTask, setCurrentRawTask] = useState<TaskFromAPI | null>(null);
  const [pausedRawTask, setPausedRawTask] = useState<TaskFromAPI | null>(null);
  const [pendingRawTask, setPendingRawTask] = useState<TaskFromAPI | null>(null);
  const [acknowledgedAssistantNoteKeys, setAcknowledgedAssistantNoteKeys] = useState<string[]>([]);
  const [reassignmentNotices, setReassignmentNotices] = useState<StandbyReassignmentNoticeFromAPI[]>([]);
  const [reassignmentNoticeSavingId, setReassignmentNoticeSavingId] = useState<string | null>(null);
  const [manualPauseSlide, setManualPauseSlide] = useState<{ taskId: string; expanded: boolean } | null>(null);
  /** 待就位被插单时，被让行的原较低优先任务 */
  const [deferredWaitingRawTask, setDeferredWaitingRawTask] = useState<TaskFromAPI | null>(null);
  /** 助理视角下最近一次拉取到的原始任务列表（用于列表点击「待就位」与目标任务对齐） */
  const [assistantRawTasks, setAssistantRawTasks] = useState<TaskFromAPI[]>([]);
  /** 与「我的任务」展示同步的原始任务（摄影师/助理均填充，用于已进行/已等待实时文案） */
  const [taskListRaw, setTaskListRaw] = useState<TaskFromAPI[]>([]);
  /** 当前区域公共队列：供所有人查看未分配、待就位、暂停任务 */
  const [publicQueueRaw, setPublicQueueRaw] = useState<TaskFromAPI[]>([]);
  const [publicQueueOpen, setPublicQueueOpen] = useState(false);
  const [publicQueueVisualOrderIds, setPublicQueueVisualOrderIds] = useState<string[] | null>(null);
  const [publicQueueAnimatingTaskId, setPublicQueueAnimatingTaskId] = useState<string | null>(null);
  const [publicQueueSeenVersion, setPublicQueueSeenVersion] = useState(0);
  const publicQueuePromotionTimersRef = useRef<number[]>([]);
  const publicQueuePromotionSignatureRef = useRef("");
  const publicQueuePromotionRunningRef = useRef(false);
  const pendingRawTaskRef = useRef<TaskFromAPI | null>(null);
  useEffect(() => {
    pendingRawTaskRef.current = pendingRawTask;
  }, [pendingRawTask]);
  // 登录账号角色（区别于切换后的 profile.role）
  const [loginRole, setLoginRole] = useState<string | null>(null);

  const showTaskCreateError = useCallback((message: string, shake = false) => {
    setTaskCreateError(message);
    if (shake) {
      setTaskCreateLimitWarning(false);
      window.setTimeout(() => setTaskCreateLimitWarning(true), 0);
      window.setTimeout(() => setTaskCreateLimitWarning(false), 420);
    }
    window.setTimeout(() => {
      setTaskCreateError((current) => current === message ? null : current);
    }, 3500);
  }, []);

  const refreshReassignmentNotices = useCallback(async (assistantId: string) => {
    try {
      const response = await fetch(`/api/reassignment-notices?assistantId=${assistantId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch reassignment notices");
      const data = await response.json();
      setReassignmentNotices(Array.isArray(data) ? data as StandbyReassignmentNoticeFromAPI[] : []);
    } catch (error) {
      console.error("Failed to fetch reassignment notices", error);
      setReassignmentNotices([]);
    }
  }, []);

  // Map pan & zoom state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInnerRef = useRef<HTMLDivElement>(null);
  const MAP_BASE_MIN_ZOOM = 1;
  const MAP_MAX_ZOOM = 5;
  const MAP_ZOOM_STEP = 0.15;

  // Whether active building has a crop region set (computed early for use in handlers)
  const hasCrop = (() => {
    const ab = buildings.find((b) => b.id === activeBuildingId);
    return !!(ab && ab.cropX != null && ab.cropY != null && ab.cropW != null && ab.cropH != null);
  })();
  // Dynamic minimum zoom that covers the container fully (object-fit:cover style)
  const [mapCoverZoom, setMapCoverZoom] = useState(MAP_BASE_MIN_ZOOM);
  const [mapZoom, setMapZoom] = useState(MAP_BASE_MIN_ZOOM);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapPanning, setMapPanning] = useState<{
    startX: number; startY: number; origPanX: number; origPanY: number;
  } | null>(null);

  const clampMapZoom = useCallback(
    (z: number) => Math.min(MAP_MAX_ZOOM, Math.max(mapCoverZoom, Math.round(z * 100) / 100)),
    [mapCoverZoom]
  );

  // Calculate cover zoom: minimum zoom so the image fills the container with no white edges
  const computeCoverZoom = useCallback(() => {
    const container = mapContainerRef.current;
    const inner = mapInnerRef.current;
    if (!container || !inner) return MAP_BASE_MIN_ZOOM;
    const img = inner.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return MAP_BASE_MIN_ZOOM;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    // At zoom=1 the image is w-full, so displayed size = cw x (cw * naturalH/naturalW)
    const displayedH = cw * (img.naturalHeight / img.naturalWidth);
    // Cover zoom = max ratio needed so both dimensions fill the container
    const cover = Math.max(1, ch / displayedH);
    return Math.round(cover * 100) / 100;
  }, []);

  const clampMapPan = useCallback(
    (px: number, py: number, z: number) => {
      const container = mapContainerRef.current;
      const inner = mapInnerRef.current;
      if (!container || !inner) return { x: px, y: py };
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const iw = inner.scrollWidth * z;
      const ih = inner.scrollHeight * z;
      let x = px, y = py;
      if (iw <= cw) { x = (cw - iw) / 2; } else { x = Math.min(0, Math.max(cw - iw, x)); }
      if (ih <= ch) { y = (ch - ih) / 2; } else { y = Math.min(0, Math.max(ch - ih, y)); }
      return { x, y };
    },
    []
  );

  // Compute zoom & pan to center on a crop region (percentage-based)
  const computeCropView = useCallback((crop: { cropX: number; cropY: number; cropW: number; cropH: number }) => {
    const container = mapContainerRef.current;
    const inner = mapInnerRef.current;
    if (!container || !inner) return null;
    const img = inner.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    // At zoom=1, image displayed size
    const imgW = inner.scrollWidth; // = cw (w-full)
    const imgH = imgW * (img.naturalHeight / img.naturalWidth);

    // Crop region in pixels at zoom=1
    const cropPxX = (crop.cropX / 100) * imgW;
    const cropPxY = (crop.cropY / 100) * imgH;
    const cropPxW = (crop.cropW / 100) * imgW;
    const cropPxH = (crop.cropH / 100) * imgH;

    // Zoom to fill container with crop region
    const zoomX = cw / cropPxW;
    const zoomY = ch / cropPxH;
    const z = Math.min(zoomX, zoomY, MAP_MAX_ZOOM);

    // Pan to center the crop region
    const panX = (cw - cropPxW * z) / 2 - cropPxX * z;
    const panY = (ch - cropPxH * z) / 2 - cropPxY * z;

    return { zoom: Math.round(z * 100) / 100, pan: { x: panX, y: panY } };
  }, []);

  const resetMapView = useCallback(() => {
    // Try crop-based view first
    const ab = buildings.find((b) => b.id === activeBuildingId);
    if (ab && ab.cropX != null && ab.cropY != null && ab.cropW != null && ab.cropH != null) {
      const view = computeCropView({ cropX: ab.cropX, cropY: ab.cropY, cropW: ab.cropW, cropH: ab.cropH });
      if (view) {
        setMapCoverZoom(Math.min(view.zoom, MAP_MAX_ZOOM));
        setMapZoom(view.zoom);
        setMapPan(view.pan);
        return;
      }
    }
    const z = computeCoverZoom();
    setMapCoverZoom(z);
    setMapZoom(z);
    setMapPan(clampMapPan(0, 0, z));
  }, [clampMapPan, computeCoverZoom, buildings, activeBuildingId, computeCropView]);

  // Handle floor plan image load — recalculate cover zoom
  const handleFloorPlanLoad = resetMapView;

  // Recalculate cover zoom on window resize
  useEffect(() => {
    const onResize = () => {
      // If crop is set, recalculate crop-based view
      const ab = buildings.find((b) => b.id === activeBuildingId);
      if (ab && ab.cropX != null && ab.cropY != null && ab.cropW != null && ab.cropH != null) {
        const view = computeCropView({ cropX: ab.cropX, cropY: ab.cropY, cropW: ab.cropW, cropH: ab.cropH });
        if (view) {
          setMapCoverZoom(Math.min(view.zoom, MAP_MAX_ZOOM));
          setMapZoom(view.zoom);
          setMapPan(view.pan);
          return;
        }
      }
      const z = computeCoverZoom();
      setMapCoverZoom(z);
      setMapZoom((prev) => Math.max(z, prev));
      setMapPan((prev) => clampMapPan(prev.x, prev.y, Math.max(z, mapZoom)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [computeCoverZoom, clampMapPan, mapZoom, buildings, activeBuildingId, computeCropView]);

  // Reset view when switching buildings
  useEffect(() => {
    setMapCoverZoom(MAP_BASE_MIN_ZOOM);
    setMapZoom(MAP_BASE_MIN_ZOOM);
    setMapPan({ x: 0, y: 0 });
  }, [activeBuildingId]);

  // Re-center on crop area when buildings data arrives or changes
  useEffect(() => {
    const ab = buildings.find((b) => b.id === activeBuildingId);
    if (ab && ab.cropX != null && ab.cropY != null && ab.cropW != null && ab.cropH != null) {
      // Small delay to ensure the image has rendered and refs are measured
      const timer = setTimeout(() => {
        const view = computeCropView({ cropX: ab.cropX!, cropY: ab.cropY!, cropW: ab.cropW!, cropH: ab.cropH! });
        if (view) {
          setMapCoverZoom(Math.min(view.zoom, MAP_MAX_ZOOM));
          setMapZoom(view.zoom);
          setMapPan(view.pan);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [buildings, activeBuildingId, computeCropView]);

  // Fetch weekly tasks when stats modal opens
  useEffect(() => {
    if (!showStatsModal) return;
    const params = new URLSearchParams({ weekOnly: "true" });
    if (profile?.role === "photographer") params.set("photographerId", profile.id);
    if (isAssistantRole(profile?.role)) params.set("assistantId", profile!.id);
    fetch(`/api/tasks?${params}`)
      .then((r) => r.json())
      .then((data: TaskFromAPI[]) => setWeeklyTasks(Array.isArray(data) ? data : []))
      .catch(() => setWeeklyTasks([]));
  }, [showStatsModal, profile]);

  // Fetch assistants + their active tasks for the active building
  const refreshAssistants = useCallback(() => {
    if (!activeBuildingId) return;
    Promise.all([
      fetch(`/api/profiles?role=assistant&buildingId=${activeBuildingId}`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/tasks?todayOnly=true", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
    ]).then(async ([profilesData, tasksData]) => {
      const nowMs = Date.now();
      const profiles = Array.isArray(profilesData) ? profilesData : [];
      const allTasks: TaskFromAPI[] = Array.isArray(tasksData) ? tasksData : [];

      // todayOnly 列表常不含「父任务」行，导致无法解析 preemptedWaitingRoom。按需补拉 parentTaskId 指向的任务。
      const missingParentIds = new Set<string>();
      for (const t of allTasks) {
        if (t.parentTaskId && !allTasks.some((x) => x.id === t.parentTaskId)) {
          missingParentIds.add(t.parentTaskId);
        }
      }
      if (missingParentIds.size > 0) {
        const fetched = await Promise.all(
          [...missingParentIds].map((id) =>
            fetch(`/api/tasks/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          ),
        );
        for (const row of fetched) {
          if (
            row &&
            typeof row === "object" &&
            "id" in row &&
            typeof (row as { id: string }).id === "string" &&
            !allTasks.some((t) => t.id === (row as { id: string }).id)
          ) {
            allTasks.push(row as TaskFromAPI);
          }
        }
      }

      // 每个助理收集：executing任务、paused任务、waiting插单任务（parentTaskId存在）
      type TaskInfo = {
        executingTask: typeof allTasks[0] | null;
        pausedTask: typeof allTasks[0] | null;
        waitingInterruptTask: typeof allTasks[0] | null; // 未暂停时的待处理插单
        resumingTask: typeof allTasks[0] | null; // 插单完成后恢复待就位
        preemptedWaitingTask: typeof allTasks[0] | null; // 待就位被插单时让行的原任务（仍为 waiting）
        collaboratingTask: typeof allTasks[0] | null;
        collaboratingStatus: string | null;
      };
      const infoMap = new Map<string, TaskInfo>();
      const ensureInfo = (assistantId: string) => {
        if (!infoMap.has(assistantId)) {
          infoMap.set(assistantId, {
            executingTask: null,
            pausedTask: null,
            waitingInterruptTask: null,
            resumingTask: null,
            preemptedWaitingTask: null,
            collaboratingTask: null,
            collaboratingStatus: null,
          });
        }
        return infoMap.get(assistantId)!;
      };

      for (const t of allTasks) {
        if (!t.category) continue;
        if (t.assistantId) {
          const primaryStatus = taskStatusForProfile(t, t.assistantId) ?? t.status;
          if (ACTIVE_PARTICIPANT_STATUSES.includes(primaryStatus)) {
            const info = ensureInfo(t.assistantId);
            if (primaryStatus === "executing") info.executingTask = t;
            else if (primaryStatus === "paused") info.pausedTask = t;
            else if (primaryStatus === "waiting" && t.parentTaskId) {
            // 区分：插单完成后恢复（之前是paused，现在变回waiting）vs 旧任务还在executing时的pending
              if (!info.executingTask) info.resumingTask = t; // 先放resuming，executing来了再调整
              else info.waitingInterruptTask = t; // 旧任务还在executing，新任务waiting = pending
            }
          }
        }
        for (const collaborator of activeTaskParticipants(t)) {
          if (!collaborator.assistantId || collaborator.assistantId === t.assistantId) continue;
          const info = ensureInfo(collaborator.assistantId);
          if (!info.executingTask && !info.pausedTask && !info.waitingInterruptTask && !info.resumingTask) {
            info.collaboratingTask = t;
            info.collaboratingStatus = collaborator.status;
          }
        }
      }
      // 二次修正：同时有executing和waiting(parentTaskId)的，waiting是pending
      for (const [, info] of infoMap) {
        if (info.executingTask && info.resumingTask) {
          info.waitingInterruptTask = info.resumingTask;
          info.resumingTask = null;
        }
        // 三次修正：旧任务已暂停(paused) + 插单任务waiting(parentTaskId) 时，
        // waiting 代表“新插单待就位”，不应被当作“恢复待就位(resuming)”。
        if (info.pausedTask && info.resumingTask && !info.waitingInterruptTask) {
          info.waitingInterruptTask = info.resumingTask;
          info.resumingTask = null;
        }
      }

      // 四次：待就位被高优先插单 — 子任务 waiting+parent，父任务仍为 waiting（非暂停）
      for (const [, info] of infoMap) {
        const cand = info.resumingTask;
        if (!cand || info.executingTask) continue;
        const parent = allTasks.find((x) => x.id === cand.parentTaskId);
        if (
          parent &&
          taskStatusForProfile(parent, parent.assistantId) === "waiting" &&
          parent.assistantId === cand.assistantId
        ) {
          info.preemptedWaitingTask = parent;
          info.waitingInterruptTask = cand;
          info.resumingTask = null;
        }
      }

      // 五次：待就位插单后紧急单已开始执行 — 父任务仍为 waiting，须保留原（较低优先）坐标供灰头像
      for (const [, info] of infoMap) {
        const ex = info.executingTask;
        if (!ex?.parentTaskId) continue;
        const parent = allTasks.find((x) => x.id === ex.parentTaskId);
        if (
          parent &&
          taskStatusForProfile(parent, parent.assistantId) === "waiting" &&
          parent.assistantId === ex.assistantId
        ) {
          info.preemptedWaitingTask = parent;
        }
      }

      type AssistantProfileForDock = DockAssistant & { activeRoom?: string | null };
      setAssistants(profiles.map((p: AssistantProfileForDock) => {
        const info = infoMap.get(p.id);
        const idleRoom = p.activeRoom ?? p.currentRoom;
        if (!info) {
          return {
            ...p,
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
            executingOvertimeMin: null,
            pausedOvertimeMin: null,
            preemptedWaitingRoom: null,
            preemptedWaitingTaskDesc: null,
            preemptedWaitingTaskDetail: null,
            preemptedOvertimeMin: null,
          };
        }

        const { executingTask, pausedTask, waitingInterruptTask, resumingTask, preemptedWaitingTask, collaboratingTask, collaboratingStatus } = info;

        // 计算主任务状态和位置
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

        const buildDesc = (t: typeof allTasks[0]) =>
          t.category
            ? `${t.roomNumber}室 · ${t.category.name} · ${taskCategoryDurationCaption(t.category, t.priority)}`
            : `${t.roomNumber}室`;

        const pausedElapsedFor = (t: typeof allTasks[0]) =>
          effectiveWorkMinutesFromApi(
            { ...taskTimingForProfile(t, p.id), status: "paused" },
            nowMs
          );

        const pausedOvertimeFor = (t: typeof allTasks[0]) =>
          overtimeMinutesBeyondSlot(
            { ...taskTimingForProfile(t, p.id), status: "paused", category: t.category },
            nowMs
          );

        const setPausedMarker = (t: typeof allTasks[0], detailPrefix?: string) => {
          pausedRoom = t.roomNumber;
          const pe = pausedElapsedFor(t);
          pausedElapsedMin = pe;
          const pOver = pausedOvertimeFor(t);
          pausedTaskDesc =
            pOver != null
              ? `${t.category.name} · 已超时${fmtMin(pOver)}`
              : `${t.category.name} · 已进行${fmtMin(pe)}`;
          pausedTaskDetail = detailPrefix ? `${detailPrefix} · ${buildDesc(t)}` : buildDesc(t);
        };

        if (
          preemptedWaitingTask &&
          executingTask &&
          executingTask.parentTaskId === preemptedWaitingTask.id
        ) {
          // 待就位插单后紧急单已执行中：父任务坐标灰头像 + 当前执行房间主标记（余骐彤低优先房间 + 叶梦妮执行中）
          finalStatus = "executing";
          preemptedWaitingRoom = preemptedWaitingTask.roomNumber;
          currentRoom = executingTask.roomNumber;
          newTaskDesc = buildDesc(executingTask);
          const pOverPre = overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs);
          preemptedWaitingTaskDesc =
            pOverPre != null ? `已超时${fmtMin(pOverPre)}` : "已让行紧急单";
          preemptedWaitingTaskDetail = buildDesc(preemptedWaitingTask);
        } else if (executingTask && waitingInterruptTask) {
          // 旧任务进行中 + 新插单待处理：主标记在旧任务（橙色进行中），蓝脉冲标记在新任务
          finalStatus = "executing";
          currentRoom = executingTask.roomNumber;
          pendingRoom = waitingInterruptTask.roomNumber;
          newTaskDesc = buildDesc(waitingInterruptTask);
        } else if (preemptedWaitingTask && waitingInterruptTask) {
          // 待就位被更高优先插单：原任务房间灰 50%，紧急单房间蓝脉冲主标记
          finalStatus = "assigned";
          preemptedWaitingRoom = preemptedWaitingTask.roomNumber;
          currentRoom = waitingInterruptTask.roomNumber;
          newTaskDesc = buildDesc(waitingInterruptTask);
          const pOverPre = overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs);
          preemptedWaitingTaskDesc =
            pOverPre != null ? `已超时${fmtMin(pOverPre)}` : "已让行紧急单";
          preemptedWaitingTaskDetail = buildDesc(preemptedWaitingTask);
        } else if (pausedTask && waitingInterruptTask) {
          // 阶段B：旧任务已暂停 + 新插单待就位
          // - 旧任务房间：只保留灰色头像（pausedMarker）
          // - 新任务房间：只显示蓝色脉冲点（mainMarker）
          finalStatus = "assigned";
          currentRoom = waitingInterruptTask.roomNumber;
          setPausedMarker(pausedTask);

          // 避免同时渲染 pendingMarker 与 mainMarker 的双蓝点
          pendingRoom = null;
          newTaskDesc = buildDesc(waitingInterruptTask);
        } else if (pausedTask && executingTask) {
          // 旧任务已暂停 + 新任务进行中：灰色标记在旧任务，橙色标记在新任务
          finalStatus = "executing";
          currentRoom = executingTask.roomNumber;
          setPausedMarker(pausedTask);
          newTaskDesc = buildDesc(executingTask);
        } else if (resumingTask) {
          // 插单完成，原任务恢复待就位
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
        } else {
          // 仅有 waiting 任务（普通待就位）
          const waitTask = allTasks.find((t: typeof allTasks[0]) => t.assistantId === p.id && taskStatusForProfile(t, p.id) === "waiting");
          if (waitTask) {
            finalStatus = "assigned";
            currentRoom = waitTask.roomNumber;
            // 插单完成后，原任务从 paused 恢复为 waiting（通常仍保留 startedAt）
            // 这时地图应显示：正常饱和度头像 + 蓝色扩散脉冲外圈（代表等待就位）
            if (waitTask.startedAt) {
              resumingFromPause = true;
            }
          }
        }

        // 构建 currentTask 字符串（用于 Dock tooltip）
        const descTask =
          (!executingTask && pausedTask && waitingInterruptTask)
            ? waitingInterruptTask
            : (!executingTask && preemptedWaitingTask && waitingInterruptTask)
              ? waitingInterruptTask
              : preemptedWaitingTask &&
                  executingTask &&
                  executingTask.parentTaskId === preemptedWaitingTask.id
                ? executingTask
                : (executingTask || pausedTask || collaboratingTask || allTasks.find((t: typeof allTasks[0]) => t.assistantId === p.id && taskStatusForProfile(t, p.id) === "waiting") || null);
        let currentTask: string | null = null;
        if (descTask) {
          const line = formatMapTaskElapsedLine(descTask, nowMs);
          const desc = collaboratingTask?.id === descTask.id && !executingTask && !pausedTask
            ? `协作中 · ${buildDesc(descTask)}`
            : buildDesc(descTask);
          currentTask = line ? `${line}\n${desc}` : desc;
        }

        return {
          ...p,
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
          preemptedOvertimeMin: preemptedWaitingTask
            ? overtimeMinutesBeyondSlot(preemptedWaitingTask, nowMs)
            : null,
        };
      }));
    }).catch(console.error);
  }, [activeBuildingId]);

  /** 任务类型/时段：后台改 min/max 后需重新拉取，否则快捷预约选项一直为首次进入时的快照 */
  const refreshCategories = useCallback(() => {
    fetch("/api/categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setCategories(buildCategories(data as DbCategory[]));
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshCategories();
    const t = setInterval(refreshCategories, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshCategories();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshCategories]);

  useEffect(() => {
    refreshAssistants();
  }, [refreshAssistants]);

  // 8秒轮询：用同一份任务数据同步所有视图
  useEffect(() => {
    if (!profile) return;
    const poll = () => {
      // 刷新助理数据（状态栏 + 地图标记）
      refreshAssistants();
      Promise.all([
        fetch(taskListUrlForProfile(profile), { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/tasks?todayOnly=true", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
        isAssistantRole(profile.role)
          ? fetch(`/api/reassignment-notices?assistantId=${profile.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => [])
          : Promise.resolve([]),
      ])
        .then(([taskData, publicQueueData, noticeData]) => {
          if (Array.isArray(publicQueueData)) {
            setPublicQueueRaw(publicQueueData as TaskFromAPI[]);
          }
          if (isAssistantRole(profile.role)) {
            setReassignmentNotices(Array.isArray(noticeData) ? noticeData as StandbyReassignmentNoticeFromAPI[] : []);
          } else {
            setReassignmentNotices([]);
          }
          if (Array.isArray(taskData)) {
            const raw = visibleTasksForProfile(taskData as TaskFromAPI[], profile, activeBuildingId ?? profile.buildingId);
            setTaskListRaw(raw);
            setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, isAssistantRole(profile.role) ? profile.id : undefined))));
            if (isAssistantRole(profile.role)) {
              setAssistantRawTasks(raw);
              const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
              setCurrentRawTask(active);
              setPausedRawTask(paused);
              setPendingRawTask(pending);
              setDeferredWaitingRawTask(deferredWaiting);
            } else {
              setAssistantRawTasks([]);
            }
          }
        })
        .catch(console.error);
    };
    // 首次立即执行一次，确保初始数据同步
    poll();
    const timer = setInterval(poll, 8000);
    return () => clearInterval(timer);
  }, [activeBuildingId, profile, refreshAssistants]);

  // Map pan handlers
  const handleMapPanDown = useCallback(
    (e: React.MouseEvent) => {
      if (hasCrop) return;
      e.preventDefault();
      setMapPanning({
        startX: e.clientX, startY: e.clientY,
        origPanX: mapPan.x, origPanY: mapPan.y,
      });
    },
    [mapPan, hasCrop]
  );

  useEffect(() => {
    if (!mapPanning) return;
    const handleMove = (e: MouseEvent) => {
      setMapPan(clampMapPan(
        mapPanning.origPanX + e.clientX - mapPanning.startX,
        mapPanning.origPanY + e.clientY - mapPanning.startY,
        mapZoom
      ));
    };
    const handleUp = () => setMapPanning(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [mapPanning, mapZoom, clampMapPan]);

  // Touch pan & pinch-zoom for mobile
  const touchRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number; dist: number; origZoom: number } | null>(null);

  useEffect(() => {
    if (hasCrop) return;
    const container = mapContainerRef.current;
    if (!container) return;

    const getTouchDist = (t: TouchList) => {
      if (t.length < 2) return 0;
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const getTouchCenter = (t: TouchList, rect: DOMRect) => ({
      x: (t[0].clientX + (t.length > 1 ? t[1].clientX : t[0].clientX)) / (t.length > 1 ? 2 : 1) - rect.left,
      y: (t[0].clientY + (t.length > 1 ? t[1].clientY : t[0].clientY)) / (t.length > 1 ? 2 : 1) - rect.top,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchRef.current = { startX: t.clientX, startY: t.clientY, origPanX: mapPan.x, origPanY: mapPan.y, dist: 0, origZoom: mapZoom };
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches);
        touchRef.current = { startX: 0, startY: 0, origPanX: mapPan.x, origPanY: mapPan.y, dist, origZoom: mapZoom };
      }
    };

    let latestZoom = mapZoom;
    let latestPan = mapPan;

    const onTouchMove = (e: TouchEvent) => {
      if (!touchRef.current) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      if (e.touches.length === 1 && touchRef.current.dist === 0) {
        // Single finger pan
        const t = e.touches[0];
        const newPan = clampMapPan(
          touchRef.current.origPanX + t.clientX - touchRef.current.startX,
          touchRef.current.origPanY + t.clientY - touchRef.current.startY,
          latestZoom
        );
        latestPan = newPan;
        setMapPan(newPan);
      } else if (e.touches.length === 2 && touchRef.current.dist > 0) {
        // Pinch zoom
        const newDist = getTouchDist(e.touches);
        const scale = newDist / touchRef.current.dist;
        const rawZoom = touchRef.current.origZoom * scale;
        const newZoom = Math.min(MAP_MAX_ZOOM, Math.max(mapCoverZoom, Math.round(rawZoom * 100) / 100));
        const center = getTouchCenter(e.touches, rect);
        const zoomScale = newZoom / latestZoom;
        const newPan = clampMapPan(
          center.x - zoomScale * (center.x - latestPan.x),
          center.y - zoomScale * (center.y - latestPan.y),
          newZoom
        );
        latestZoom = newZoom;
        latestPan = newPan;
        setMapZoom(newZoom);
        setMapPan(newPan);
      }
    };

    const onTouchEnd = () => { touchRef.current = null; };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [mapZoom, mapPan, clampMapPan, mapCoverZoom, hasCrop]);

  // Map wheel zoom
  useEffect(() => {
    if (hasCrop) return;
    const container = mapContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = mapZoom;
      const newZoom = clampMapZoom(oldZoom + (e.deltaY > 0 ? -MAP_ZOOM_STEP : MAP_ZOOM_STEP));
      if (newZoom === oldZoom) return;
      const scale = newZoom / oldZoom;
      setMapZoom(newZoom);
      setMapPan(clampMapPan(mx - scale * (mx - mapPan.x), my - scale * (my - mapPan.y), newZoom));
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [mapZoom, mapPan, clampMapZoom, clampMapPan, hasCrop]);

  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      if (themeMode === "auto") {
        const t = getAutoTheme();
        setResolvedTheme(t);
        document.documentElement.setAttribute("data-theme", t);
      }
    };
    const apply = () => {
      const t = themeMode === "auto" ? getAutoTheme() : themeMode;
      setResolvedTheme(t);
      document.documentElement.setAttribute("data-theme", t);
    };
    apply();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [themeMode]);

  useEffect(() => {
    // 读取登录账号角色
    try {
      const loginUser = JSON.parse(localStorage.getItem("user") || "null");
      if (loginUser?.role) setLoginRole(loginUser.role);
    } catch {}
    // Fetch profiles, then pick current identity from localStorage or default
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllProfiles(data);
          const savedId = typeof window !== "undefined" ? localStorage.getItem("currentProfileId") : null;
          const match = savedId ? data.find((p: { id: string }) => p.id === savedId) : null;
          // fallback: 登录账号 → 第一个用户
          let loginMatch = null;
          try {
            const loginUser = JSON.parse(localStorage.getItem("user") || "null");
            if (loginUser?.id) loginMatch = data.find((p: { id: string }) => p.id === loginUser.id);
          } catch {}
          const selected = match || loginMatch || data[0];
          if (selected) {
            originalRoomRef.current = selected.currentRoom;
            originalBuildingIdRef.current = selected.buildingId;
            const selectedServiceBuildingId = profileServiceBuildingId(selected);
            const selectedForWorkbench = isAssistantRole(selected.role)
              ? {
                ...selected,
                buildingId: selectedServiceBuildingId,
                currentRoom: profileServiceRoom(selected),
              }
              : selected;
            setProfile(selectedForWorkbench);
            setActiveBuildingId(selectedServiceBuildingId);
            if (isAssistantRole(selectedForWorkbench.role)) {
              refreshReassignmentNotices(selectedForWorkbench.id);
            } else {
              setReassignmentNotices([]);
            }
            // Fetch tasks for this profile
            fetch(taskListUrlForProfile(selectedForWorkbench))
              .then((r) => r.json())
              .then((taskData) => {
                if (Array.isArray(taskData)) {
                  const raw = visibleTasksForProfile(taskData as TaskFromAPI[], selectedForWorkbench, selectedServiceBuildingId);
                  setTaskListRaw(raw);
                  setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, isAssistantRole(selectedForWorkbench.role) ? selectedForWorkbench.id : undefined))));
                  if (isAssistantRole(selectedForWorkbench.role)) {
                    setAssistantRawTasks(raw);
                    const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, selectedForWorkbench.id);
                    setCurrentRawTask(active);
                    setPausedRawTask(paused);
                    setPendingRawTask(pending);
                    setDeferredWaitingRawTask(deferredWaiting);
                  } else {
                    setAssistantRawTasks([]);
                    setDeferredWaitingRawTask(null);
                    setCurrentRawTask(null);
                    setPausedRawTask(null);
                    setPendingRawTask(null);
                  }
                }
              })
              .catch(console.error);
          }
        }
      })
      .catch(console.error);

    fetch("/api/buildings")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setBuildings(data);
        }
      })
      .catch(console.error);

    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg?.ending_alert_min?.value) {
          setEndingAlertMin(Number(cfg.ending_alert_min.value) || 2);
        }
        if (cfg?.upgrade_threshold?.value) {
          setUpgradeThresholdMin(Number(cfg.upgrade_threshold.value) || 25);
        }
        setPhotographerMaxActiveTasks(
          parsePhotographerMaxActiveTasks(cfg?.[PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY]?.value)
        );
        setCollaborationQueueAutoCloseLimit(
          parseCollaborationQueueAutoCloseLimit(cfg?.[COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY]?.value)
        );
        const nextCollaborationConfig: Record<number, boolean> = {};
        const nextCollaborationMaxConfig: Record<number, number> = {};
        if (cfg && typeof cfg === "object") {
          for (const [key, entry] of Object.entries(cfg)) {
            const match = key.match(/^collaboration_enabled_b(\d+)$/);
            const maxMatch = key.match(/^collaboration_max_participants_b(\d+)$/);
            if (match) {
              nextCollaborationConfig[Number(match[1])] = parseCollaborationEnabled(
                (entry as { value?: string } | undefined)?.value
              );
            }
            if (maxMatch) {
              nextCollaborationMaxConfig[Number(maxMatch[1])] = parseCollaborationMaxParticipants(
                (entry as { value?: string } | undefined)?.value
              );
            }
          }
        }
        setCollaborationEnabledByBuilding(nextCollaborationConfig);
        setCollaborationMaxByBuilding(nextCollaborationMaxConfig);
      })
      .catch(console.error);
  }, [refreshReassignmentNotices]);

  const activeBuilding = buildings.find((b) => b.id === activeBuildingId) || null;

  const cancelLocationMenuClose = useCallback(() => {
    if (locationMenuCloseTimer.current) {
      clearTimeout(locationMenuCloseTimer.current);
      locationMenuCloseTimer.current = null;
    }
  }, []);

  const closeLocationMenuSoon = useCallback(() => {
    cancelLocationMenuClose();
    locationMenuCloseTimer.current = setTimeout(() => {
      setShowVenueMenu(false);
      setLocationMenu(null);
      locationMenuCloseTimer.current = null;
    }, 420);
  }, [cancelLocationMenuClose]);

  useEffect(() => {
    return () => cancelLocationMenuClose();
  }, [cancelLocationMenuClose]);

  const cycleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const order: ThemeMode[] = ["light", "dark", "auto"];
      const next = order[(order.indexOf(prev) + 1) % 3];
      localStorage.setItem("themeMode", next);
      return next;
    });
  }, []);

  const switchVenue = useCallback(async (venue: string) => {
    if (!profile) return;
    setProfile((p) => p ? { ...p, currentRoom: venue } : p);
    setShowVenueMenu(false);
    setLocationMenu(null);
    cancelLocationMenuClose();
    if (!isAssistantRole(profile.role)) {
      return;
    }
    try {
      setAllProfiles((prev) => prev.map((p) => p.id === profile.id ? { ...p, activeRoom: venue } : p));
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeRoom: venue }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile((p) => p ? { ...p, currentRoom: updated.activeRoom ?? updated.currentRoom, activeRoom: updated.activeRoom } : p);
        setAllProfiles((prev) => prev.map((p) => p.id === profile.id ? { ...p, activeRoom: updated.activeRoom } : p));
      }
      if (isAssistantRole(profile.role)) {
        // 触发全局扫描自动派单
        await fetch("/api/tasks/sweep", { method: "POST" }).catch(() => {});
      }
      // 刷新助理列表
      refreshAssistants();
    } catch (err) {
      console.error("Failed to switch venue", err);
    }
  }, [cancelLocationMenuClose, profile, refreshAssistants]);

  const switchPhotographerBuilding = useCallback(async (newBuildingId: number) => {
    if (!profile || isAssistantRole(profile.role)) return;
    const bld = buildings.find((b) => b.id === newBuildingId);
    if (!bld) return;

    const registeredBuildingId = originalBuildingIdRef.current ?? profile.buildingId;
    const nextVenue = newBuildingId === registeredBuildingId
      ? originalRoomRef.current
      : defaultBuildingVenue(bld);

    setLocationMenu(null);
    setShowVenueMenu(false);
    cancelLocationMenuClose();
    setProfile((p) => p ? {
      ...p,
      buildingId: bld.id,
      building: { id: bld.id, name: bld.name, extraVenues: bld.extraVenues },
      currentRoom: nextVenue,
    } : p);
    setActiveBuildingId(bld.id);
  }, [buildings, cancelLocationMenuClose, profile]);

  const switchAssistantBuilding = useCallback(async (newBuildingId: number) => {
    if (!profile || !isAssistantRole(profile.role)) return;
    if (profile.status === "executing" || profile.status === "finishing" || taskStatusForProfile(currentRawTask, profile.id) === "executing") {
      setShowVenueMenu(false);
      return;
    }

    const bld = buildings.find((b) => b.id === newBuildingId);
    if (!bld) return;
    const registeredBuildingId = originalBuildingIdRef.current ?? profile.buildingId;
    const nextVenue = newBuildingId === registeredBuildingId ? originalRoomRef.current : defaultBuildingVenue(bld);
    setShowVenueMenu(false);

    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeBuildingId: newBuildingId, activeRoom: nextVenue }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("助理切换楼座失败", res.status, errText);
        return;
      }

      const updated = await res.json();
      const updatedServiceBuildingId = updated.activeBuildingId ?? updated.buildingId;
      const updatedServiceRoom = updated.activeRoom ?? updated.currentRoom;
      setProfile((p) => p ? {
        ...p,
        buildingId: updatedServiceBuildingId,
        building: { id: bld.id, name: bld.name, extraVenues: bld.extraVenues },
        currentRoom: updatedServiceRoom,
        activeBuildingId: updated.activeBuildingId,
        activeRoom: updated.activeRoom,
        status: updated.status,
      } : p);
      setAllProfiles((prev) => prev.map((p) => p.id === profile.id ? {
        ...p,
        activeBuildingId: updated.activeBuildingId,
        activeRoom: updated.activeRoom,
        status: updated.status,
      } : p));
      setActiveBuildingId(updatedServiceBuildingId);

      const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`, { cache: "no-store" });
      const taskData = await taskRes.json();
      if (Array.isArray(taskData)) {
        const raw = taskData as TaskFromAPI[];
        setTaskListRaw(raw);
        setAssistantRawTasks(raw);
        setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, profile.id))));
        const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
        setCurrentRawTask(active);
        setPausedRawTask(paused);
        setPendingRawTask(pending);
        setDeferredWaitingRawTask(deferredWaiting);
      }
      refreshAssistants();
    } catch (err) {
      console.error("Failed to switch assistant building", err);
    }
  }, [buildings, currentRawTask?.status, profile, refreshAssistants]);

  const handleCancelTask = useCallback((taskId: string) => {
    if (removingTaskId) return;
    setRemovingTaskId(taskId);
    // 调用 API 删除任务
    if (!taskId.startsWith("temp-")) {
      fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
        .then(() => refreshAssistants())
        .catch(console.error);
    }
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setTaskListRaw((prev) => prev.filter((t) => t.id !== taskId));
      setRemovingTaskId(null);
      setHoveredTagId(null);
    }, 450);
  }, [removingTaskId, refreshAssistants]);

  const switchIdentity = useCallback((p: typeof allProfiles[0]) => {
    localStorage.setItem("currentProfileId", p.id);
    setShowIdentityModal(false);
    window.location.reload();
  }, []);

  // 在切换身份面板中更新助理的在线状态
  const updateAssistantOnlineStatus = useCallback(async (profileId: string, newStatus: string) => {
    // 乐观更新本地
    setAllProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, onlineStatus: newStatus } : p));
    try {
      await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlineStatus: newStatus }),
      });
      refreshAssistants();
    } catch (e) {
      console.error("Failed to update online status", e);
    }
  }, [refreshAssistants]);

  // 在切换身份面板中更新助理的所属楼座
  const updateAssistantBuilding = useCallback(async (profileId: string, newBuildingId: number) => {
    const bld = buildings.find((b) => b.id === newBuildingId);
    if (!bld) return;
    const nextVenue = defaultBuildingVenue(bld);
    // 乐观更新本地
    setAllProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, activeBuildingId: newBuildingId, activeRoom: nextVenue } : p));
    if (profile?.id === profileId) {
      setProfile((p) => p ? {
        ...p,
        buildingId: newBuildingId,
        building: { id: bld.id, name: bld.name, extraVenues: bld.extraVenues },
        currentRoom: nextVenue,
        activeBuildingId: newBuildingId,
        activeRoom: nextVenue,
      } : p);
      setActiveBuildingId(newBuildingId);
    }
    try {
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeBuildingId: newBuildingId, activeRoom: nextVenue }),
      });
      if (!res.ok) {
        console.error("Failed to update building", res.status, await res.text().catch(() => ""));
      }
      refreshAssistants();
    } catch (e) {
      console.error("Failed to update building", e);
    }
  }, [buildings, profile?.id, refreshAssistants]);

  const noteTaskIsExecuting = useCallback((taskId: string) => {
    const task =
      currentRawTask?.id === taskId ? currentRawTask
        : pendingRawTask?.id === taskId ? pendingRawTask
          : pausedRawTask?.id === taskId ? pausedRawTask
            : deferredWaitingRawTask?.id === taskId ? deferredWaitingRawTask
              : taskListRaw.find((t) => t.id === taskId)
                ?? assistantRawTasks.find((t) => t.id === taskId)
                ?? null;
    if (!task) return false;
    const actorId = isAssistantRole(profile?.role) ? profile?.id : undefined;
    return (taskStatusForProfile(task, actorId) ?? task.status) === "executing";
  }, [
    assistantRawTasks,
    currentRawTask,
    deferredWaitingRawTask,
    pendingRawTask,
    pausedRawTask,
    profile?.id,
    profile?.role,
    taskListRaw,
  ]);

  const handleSaveNote = useCallback(async (taskId: string, note: string) => {
    if (noteTaskIsExecuting(taskId)) return;
    setNoteSaving(true);
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateNote", note }),
      });
      // 更新本地 taskListRaw 和 assistantRawTasks 中的 note
      setTaskListRaw((prev) => prev.map((t) => t.id === taskId ? { ...t, note: note.trim() || null } : t));
      setAssistantRawTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, note: note.trim() || null } : t));
      setCurrentRawTask((prev) => prev?.id === taskId ? { ...prev, note: note.trim() || null } : prev);
      setPausedRawTask((prev) => prev?.id === taskId ? { ...prev, note: note.trim() || null } : prev);
      setPendingRawTask((prev) => prev?.id === taskId ? { ...prev, note: note.trim() || null } : prev);
    } finally {
      setNoteSaving(false);
    }
  }, [noteTaskIsExecuting]);

  const handleAcknowledgeReassignmentNotice = useCallback(async (
    notice: StandbyReassignmentNoticeFromAPI,
    action: "acknowledgeNew" | "acknowledgeOld"
  ) => {
    if (!profile?.id || reassignmentNoticeSavingId) return;
    setReassignmentNoticeSavingId(notice.id);
    try {
      const response = await fetch(`/api/reassignment-notices/${notice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json() as {
        notice?: StandbyReassignmentNoticeFromAPI;
        profile?: typeof profile;
      };
      setReassignmentNotices((prev) => prev.filter((item) => item.id !== notice.id));
      if (action === "acknowledgeOld" && data.profile) {
        setProfile((prev) => prev ? {
          ...prev,
          status: data.profile!.status,
          onlineStatus: data.profile!.onlineStatus,
          activeBuildingId: data.profile!.activeBuildingId,
          activeRoom: data.profile!.activeRoom,
          buildingId: profileServiceBuildingId(data.profile!),
          currentRoom: profileServiceRoom(data.profile!),
          building: data.profile!.building,
        } : prev);
        setAllProfiles((prev) => prev.map((item) => item.id === data.profile!.id ? {
          ...item,
          status: data.profile!.status,
          onlineStatus: data.profile!.onlineStatus,
          activeBuildingId: data.profile!.activeBuildingId,
          activeRoom: data.profile!.activeRoom,
        } : item));
      }

      const taskResponse = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`, { cache: "no-store" });
      const taskData = await taskResponse.json();
      if (Array.isArray(taskData)) {
        const raw = taskData as TaskFromAPI[];
        setTaskListRaw(raw);
        setAssistantRawTasks(raw);
        setTasks(sortTasksByStatus(raw.map((task) => apiTaskToDisplay(task, profile.id))));
        const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
        setCurrentRawTask(active);
        setPausedRawTask(paused);
        setPendingRawTask(pending);
        setDeferredWaitingRawTask(deferredWaiting);
      }
      refreshAssistants();
    } catch (error) {
      console.error("Failed to acknowledge reassignment notice", error);
    } finally {
      setReassignmentNoticeSavingId(null);
    }
  }, [profile, reassignmentNoticeSavingId, refreshAssistants]);

  const openCollaboratorModal = useCallback((task: TaskFromAPI) => {
    setCollabTaskId(task.id);
    setCollabSelectedIds(helperParticipants(task).map((c) => c.assistantId));
    setCollabLimitWarning(false);
  }, []);

  const publicQueueCountByBuilding = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const task of publicQueueRaw) {
      const buildingId = taskLocationBuildingId(task);
      if (buildingId == null) continue;
      if (!isPublicQueueTaskForBuilding(task, buildingId)) continue;
      counts[buildingId] = (counts[buildingId] ?? 0) + 1;
    }
    return counts;
  }, [publicQueueRaw]);

  const saveCollaborators = useCallback(async () => {
    if (!collabTaskId) return;
    const task = taskListRaw.find((t) => t.id === collabTaskId);
    const taskBuildingId = taskLocationBuildingId(task);
    const currentHelperIds = helperParticipants(task).map((c) => c.assistantId);
    const addedIds = collabSelectedIds.filter((assistantId) => !currentHelperIds.includes(assistantId));
    const manuallyEnabled =
      taskBuildingId != null ? collaborationEnabledByBuilding[taskBuildingId] ?? true : true;
    const queueCount =
      taskBuildingId != null ? publicQueueCountByBuilding[taskBuildingId] ?? 0 : 0;
    if (addedIds.length > 0 && (!manuallyEnabled || queueCount >= collaborationQueueAutoCloseLimit)) {
      setCollabLimitWarning(false);
      window.setTimeout(() => setCollabLimitWarning(true), 0);
      return;
    }
    const maxParticipants =
      taskBuildingId != null
        ? collaborationMaxByBuilding[taskBuildingId] ?? 3
        : 3;
    const helperLimit = Math.max(0, maxParticipants - (task?.assistantId ? 1 : 0));
    if (collabSelectedIds.length > helperLimit) {
      setCollabLimitWarning(false);
      window.setTimeout(() => setCollabLimitWarning(true), 0);
      return;
    }
    setCollabSaving(true);
    try {
      const res = await fetch(`/api/tasks/${collabTaskId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantIds: collabSelectedIds,
          actorAssistantId: isAssistantRole(profile?.role) ? profile?.id : undefined,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.error("协作助理保存失败", res.status, errorText);
        setCollabLimitWarning(true);
        return;
      }
      const updated = await res.json() as TaskFromAPI;
      setTaskListRaw((prev) => prev.map((t) => t.id === updated.id ? updated : t));
      setAssistantRawTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
      setCurrentRawTask((prev) => prev?.id === updated.id ? updated : prev);
      setPausedRawTask((prev) => prev?.id === updated.id ? updated : prev);
      setPendingRawTask((prev) => prev?.id === updated.id ? updated : prev);
      refreshAssistants();
      setCollabTaskId(null);
      setCollabSelectedIds([]);
      setCollabLimitWarning(false);
    } finally {
      setCollabSaving(false);
    }
  }, [collabSelectedIds, collabTaskId, collaborationEnabledByBuilding, collaborationMaxByBuilding, collaborationQueueAutoCloseLimit, profile?.id, profile?.role, publicQueueCountByBuilding, refreshAssistants, taskListRaw]);

  // 助理：手动暂停当前任务（插单场景）
  const handlePauseCurrentTask = useCallback(async () => {
    if (!currentRawTask || !profile || manualPauseSlide) return;
    const task = currentRawTask;
    setManualPauseSlide({ taskId: task.id, expanded: false });
    try {
      await nextAnimationFrame();
      setManualPauseSlide({ taskId: task.id, expanded: true });
      await wait(MANUAL_PAUSE_SLIDE_MS);

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", actorAssistantId: profile.id }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("暂停任务失败", res.status, errText);
        setManualPauseSlide(null);
        return;
      }

      // 乐观更新：暂停成功后，旧任务房间立即显示灰头像
      //（避免等下一轮 refreshAssistants/轮询才变化）
      setAssistants((prev) => prev.map((a) => {
        if (a.id !== profile.id) return a;
        const pending = pendingRawTaskRef.current;
        const nextRoom = pending?.roomNumber ?? null;
        return {
          ...a,
          status: pending ? "assigned" : "busy",
          pausedRoom: task.roomNumber,
          pendingRoom: null,
          currentRoom: nextRoom,
          // 暂停阶段不应显示“恢复待就位”的样式；等插单完成后由后端状态驱动进入 resumingFromPause
          resumingFromPause: false,
          newTaskDesc: pending
            ? `${pending.roomNumber}室 · ${pending.category.name} · ${taskCategoryDurationCaption(pending.category, pending.priority)}`
            : a.newTaskDesc,
        };
      }));

      const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`);
      const taskData = await taskRes.json();
      if (Array.isArray(taskData)) {
        const raw = taskData as TaskFromAPI[];
        setTaskListRaw(raw);
        setAssistantRawTasks(raw);
        setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, profile.id))));
        const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
        setCurrentRawTask(active);
        setPausedRawTask(paused);
        setPendingRawTask(pending);
        setDeferredWaitingRawTask(deferredWaiting);
      }
      refreshAssistants();
    } catch (e) {
      console.error("Failed to pause task", e);
      setManualPauseSlide(null);
      return;
    }
    setManualPauseSlide(null);
  }, [currentRawTask, manualPauseSlide, profile, refreshAssistants]);

  // 助理：切换任务状态（targetTask 优先，避免界面展示任务与 currentRawTask 短暂不一致时点击无效）
  const handleAssistantStatusChange = useCallback(async (action: "start" | "complete", targetTask?: TaskFromAPI | null) => {
    const task = targetTask ?? currentRawTask;
    if (!task) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorAssistantId: profile?.id }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("任务状态更新失败", res.status, errText);
        return;
      }
      // 完成任务时，检查下一个待就位任务；顶部位置由任务/驻点派生，不再覆盖助理默认棚位
      if (action === "complete" && profile) {
        const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`);
        const taskData = await taskRes.json();
        if (Array.isArray(taskData)) {
          const raw = taskData as TaskFromAPI[];
          setTaskListRaw(raw);
          setAssistantRawTasks(raw);
          setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, profile.id))));
          const { current: next, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
          setCurrentRawTask(next);
          setPausedRawTask(paused);
          setPendingRawTask(pending);
          setDeferredWaitingRawTask(deferredWaiting);
        }
        refreshAssistants();
        return;
      }
      // 开始任务后：重新拉取任务
      if (profile) {
        const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`);
        const taskData = await taskRes.json();
        if (Array.isArray(taskData)) {
          const raw = taskData as TaskFromAPI[];
          setTaskListRaw(raw);
          setAssistantRawTasks(raw);
          setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, profile.id))));
          const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, profile.id);
          setCurrentRawTask(active);
          setPausedRawTask(paused);
          setPendingRawTask(pending);
          setDeferredWaitingRawTask(deferredWaiting);
        }
        refreshAssistants();
      }
    } catch (e) {
      console.error("Failed to update task status", e);
    }
  }, [currentRawTask, profile, refreshAssistants]);

  const handleResumePausedTask = useCallback(async (task: TaskFromAPI) => {
    if (manualPauseSlide) return;
    setManualPauseSlide({ taskId: task.id, expanded: true });
    await nextAnimationFrame();
    setManualPauseSlide({ taskId: task.id, expanded: false });
    await wait(MANUAL_PAUSE_SLIDE_MS);
    await handleAssistantStatusChange("start", task);
    setManualPauseSlide(null);
  }, [handleAssistantStatusChange, manualPauseSlide]);

  const handleBook = useCallback(
    (catName: string, dur: { label: string; priority: string; cls: string; categoryId: number }, e: React.MouseEvent) => {
      if (genie) return;
      const btn = e.currentTarget.getBoundingClientRect();
      const listEl = taskListRef.current;
      if (!listEl) return;
      const listRect = listEl.getBoundingClientRect();
      setHoveredCat(null);
      setGenie({
        sx: btn.left, sy: btn.top, sw: btn.width, sh: btn.height,
        tx: listRect.left, ty: listRect.top, tw: listRect.width, th: 38,
        label: dur.label, priority: dur.priority, cls: dur.cls,
        catName, categoryId: dur.categoryId, phase: 0,
      });
    },
    [genie],
  );

  const clampTaskListScroll = useCallback((next: number) => {
    const viewport = taskListRef.current;
    const content = taskListContentRef.current;
    if (!viewport || !content) return 0;
    const max = Math.max(0, content.scrollHeight - viewport.clientHeight);
    return Math.min(max, Math.max(0, next));
  }, []);

  useEffect(() => {
    setTaskListScrollY((prev) => clampTaskListScroll(prev));
  }, [clampTaskListScroll, publicQueueOpen, publicQueueRaw.length, tasks.length]);

  useEffect(() => {
    if (!genie) return;
    if (genie.phase === 0) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setGenie((g) => (g ? { ...g, phase: 1 } : null));
        });
      });
      return () => cancelAnimationFrame(raf);
    }
    if (genie.phase === 1) {
      const timer = setTimeout(async () => {
        // 任务地点就是摄影师当前所在的房间/公共区域；没有当前位置时退到当前楼座默认场地。
        const room = profile?.currentRoom || defaultBuildingVenue(activeBuilding);
        const locationBuildingId = activeBuilding?.id ?? profile?.buildingId ?? null;
        if (!room) {
          setGenie(null);
          showTaskCreateError("当前楼座没有可用场地，无法创建任务");
          return;
        }
        const categoryId = genie.categoryId;
        const tempId = `temp-${Date.now()}`;
        // Optimistic local insert
        setTasks((prev) => sortTasksByStatus([
          {
            id: tempId,
            name: genie.catName,
            room,
            time: genie.label,
            timePeriod: genie.label,
            estimatedLabel: genie.label,
            durationSlotLabel: genie.label,
            actualTime: "",
            progress: null,
            hasProgress: false,
            statusLabel: "等待中",
            statusCls: "bg-white/30 border-white/40",
            tagCls: "bg-gray-100/60 text-gray-500",
            assistantName: null,
            photographerName: profile?.name || null,
            createdAt: new Date().toISOString(),
            estEndTime: null,
          },
          ...prev,
        ]));
        setEnteringTaskId(tempId);
        setGenie(null);
        setTaskListScrollY(0);
        setTimeout(() => setEnteringTaskId(null), 600);
        // Persist to API
        if (profile) {
          try {
            const res = await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                photographerId: profile.id,
                locationBuildingId,
                roomNumber: room,
                categoryId,
                priority: parseInt(genie.priority.replace("P", "")),
              }),
            });
            if (res.ok) {
              const saved = await res.json() as TaskFromAPI;
              setTasks((prev) => sortTasksByStatus(prev.map((t) => t.id === tempId ? apiTaskToDisplay(saved) : t)));
              setTaskListRaw((prev) => [...prev.filter((t) => t.id !== tempId && t.id !== saved.id), saved]);
              if (isPhotographerLimitQueuedTask(saved)) {
                showTaskCreateError(photographerLimitQueuePrompt(photographerMaxActiveTasks), true);
              }
              refreshAssistants();
            } else {
              const data = await res.json().catch(() => null) as { code?: string; error?: string } | null;
              setTasks((prev) => prev.filter((t) => t.id !== tempId));
              showTaskCreateError(
                data?.error || "任务创建失败，请稍后重试",
                data?.code === "PHOTOGRAPHER_ACTIVE_TASK_LIMIT_REACHED" ||
                  data?.code === "PHOTOGRAPHER_LIMIT_QUEUE_FULL"
              );
            }
          } catch (e) {
            setTasks((prev) => prev.filter((t) => t.id !== tempId));
            showTaskCreateError("任务创建失败，请检查网络后重试");
            console.error("Failed to create task", e);
          }
        }
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [genie, activeBuilding, photographerMaxActiveTasks, profile, refreshAssistants, showTaskCreateError]);

  const notePopupStyle = notePopupPosition(notePopupAnchor);
  const notePopupTaskIsExecuting = notePopupTaskId ? noteTaskIsExecuting(notePopupTaskId) : false;
  const assistantNoteTask = isAssistantRole(profile?.role)
    ? [currentRawTask, pendingRawTask, pausedRawTask, deferredWaitingRawTask].find((task) => {
        const note = task?.note?.trim();
        return !!task && !!note && !acknowledgedAssistantNoteKeys.includes(`${task.id}:${note}`);
      }) ?? null
    : null;
  const assistantNoteKey = assistantNoteTask?.note?.trim()
    ? `${assistantNoteTask.id}:${assistantNoteTask.note.trim()}`
    : null;
  const oldReassignmentNotice = isAssistantRole(profile?.role)
    ? reassignmentNotices.find((notice) =>
        notice.oldAssistantId === profile?.id &&
        !notice.oldAssistantAcknowledgedAt
      ) ?? null
    : null;
  const newReassignmentNotice = isAssistantRole(profile?.role)
    ? reassignmentNotices.find((notice) =>
        notice.newAssistantId === profile?.id &&
        !notice.newAssistantAcknowledgedAt
      ) ?? null
    : null;
  const activeReassignmentNotice = oldReassignmentNotice ?? newReassignmentNotice;
  const activeReassignmentNoticeRole = activeReassignmentNotice
    ? activeReassignmentNotice.oldAssistantId === profile?.id
      ? "old"
      : "new"
    : null;
  const isAssistantProfile = isAssistantRole(profile?.role);
  const assistantLocationTask = isAssistantProfile
    ? currentRawTask ?? pendingRawTask ?? pausedRawTask ?? deferredWaitingRawTask
    : null;
  const assistantLocationBuilding =
    assistantLocationTask
      ? buildings.find((b) => b.id === taskLocationBuildingId(assistantLocationTask))?.name ?? profile?.building?.name
      : profile?.building?.name;
  const assistantDisplayedBuildingId =
    taskLocationBuildingId(assistantLocationTask) ?? profile?.buildingId;
  const profileBuildingForDisplay = buildings.find((b) => b.id === profile?.buildingId);
  const profileBuildingName = profileBuildingForDisplay?.name ?? profile?.building?.name ?? "—";
  const isAtRegisteredBuilding =
    originalBuildingIdRef.current == null ||
    profile?.buildingId === originalBuildingIdRef.current;
  const currentRoomBelongsToDisplayBuilding = venueBelongsToBuilding(profileBuildingForDisplay, profile?.currentRoom);
  const idleDisplayVenue = isAtRegisteredBuilding
    ? isAssistantProfile
      ? originalRoomRef.current ?? profile?.currentRoom ?? defaultBuildingVenue(profileBuildingForDisplay)
      : currentRoomBelongsToDisplayBuilding
        ? profile?.currentRoom
        : profile?.currentRoom
          ? null
          : originalRoomRef.current && venueBelongsToBuilding(profileBuildingForDisplay, originalRoomRef.current)
            ? originalRoomRef.current
            : defaultBuildingVenue(profileBuildingForDisplay)
    : currentRoomBelongsToDisplayBuilding
      ? profile?.currentRoom
      : null;
  const workbenchLocationText =
    assistantLocationTask
      ? `${assistantLocationBuilding || "—"} ${formatRoomOrVenue(assistantLocationTask.roomNumber)}`
      : `${profileBuildingName}${idleDisplayVenue ? ` · ${formatRoomOrVenue(idleDisplayVenue)}` : ""}`;
  const photographerBuildingOptions =
    !isAssistantProfile && profile
      ? buildings.filter((b) => b.id !== profile.buildingId)
      : [];
  const photographerVenueOptions = (() => {
    if (isAssistantProfile || !profile || !profileBuildingForDisplay) return [];
    const registeredBuildingId = originalBuildingIdRef.current ?? profile.buildingId;
    const origRoom = originalRoomRef.current;
    const publicVenues = safeExtraVenueEntries(profileBuildingForDisplay.extraVenues).map((venue) => ({
      name: venue.name,
      type: venue.type,
      value: venue.name,
      isOriginal: false,
    }));
    const ownRoomOption =
      profile.buildingId === registeredBuildingId && origRoom
        ? [{ name: `${origRoom}室`, value: origRoom, type: undefined, isOriginal: true }]
        : [];
    return [...publicVenues, ...ownRoomOption].filter((venue) => venue.value !== profile.currentRoom);
  })();
  const canSwitchAssistantBuilding =
    isAssistantProfile &&
    profile?.status !== "executing" &&
    profile?.status !== "finishing" &&
    taskStatusForProfile(currentRawTask, profile?.id) !== "executing";
  const assistantBuildingOptions =
    isAssistantProfile && canSwitchAssistantBuilding
      ? buildings.filter((b) => b.id !== assistantDisplayedBuildingId)
      : [];
  const publicQueueBuildingId = activeBuildingId ?? profile?.buildingId ?? null;
  const collabTask = collabTaskId ? taskListRaw.find((task) => task.id === collabTaskId) ?? null : null;
  const collabTaskBuildingId = taskLocationBuildingId(collabTask);
  const collabQueueCount =
    collabTaskBuildingId != null ? publicQueueCountByBuilding[collabTaskBuildingId] ?? 0 : 0;
  const collabAutoClosedByQueue = collabQueueCount >= collaborationQueueAutoCloseLimit;
  const collabManualDisabled =
    collabTaskBuildingId != null && !(collaborationEnabledByBuilding[collabTaskBuildingId] ?? true);
  const collabNewHelpersDisabled = collabManualDisabled || collabAutoClosedByQueue;
  const collabMaxParticipants =
    collabTaskBuildingId != null
      ? collaborationMaxByBuilding[collabTaskBuildingId] ?? 3
      : 3;
  const collabPrimaryParticipantCount = collabTask?.assistantId ? 1 : 0;
  const collabHelperLimit = Math.max(0, collabMaxParticipants - collabPrimaryParticipantCount);
  const collabOverLimit = collabSelectedIds.length > collabHelperLimit;
  const showCollabLimitWarning = collabLimitWarning || collabOverLimit;
  const collabCurrentIds = helperParticipants(collabTask ?? undefined).map((c) => c.assistantId);
  const collabCandidateProfiles = collabTask
    ? allProfiles.filter((p) => {
        if (!isAssistantRole(p.role)) return false;
        if (p.id === collabTask.assistantId) return false;
        const live = assistants.find((a) => a.id === p.id);
        const selected = collabSelectedIds.includes(p.id) || collabCurrentIds.includes(p.id);
        if (selected) return true;
        if (collabNewHelpersDisabled) return false;
        if (profileServiceBuildingId(p) !== collabTaskBuildingId) return false;
        if (p.onlineStatus !== "online" || p.subStatus) return false;
        const idle = (live?.status ?? p.status) === "idle";
        return idle;
      })
    : [];
  const publicQueueTasks = useMemo(
    () => {
      const queueTasks = publicQueueRaw.filter((task) => isPublicQueueTaskForBuilding(task, publicQueueBuildingId));
      return sortPublicQueueTasks(queueTasks, publicQueueRaw);
    },
    [publicQueueBuildingId, publicQueueRaw],
  );
  const publicQueuePendingPromotion = useMemo(() => {
    if (!publicQueueOpen || !profile?.id || publicQueueTasks.length === 0) return null;
    const seen = readPublicQueueSeenEscalations(profile.id);
    const unseenEscalated = publicQueueTasks
      .map((task) => ({ task, key: publicQueueEscalationKey(task) }))
      .filter((item): item is { task: TaskFromAPI; key: string } => item.key != null && !seen.has(item.key));
    if (unseenEscalated.length === 0) return null;

    const unseenIds = new Set(unseenEscalated.map((item) => item.task.id));
    const inferredBeforePromotion = sortPublicQueueTasks(
      publicQueueTasks,
      publicQueueRaw,
      (task) => unseenIds.has(task.id) ? Math.min(5, task.priority + 1) : task.priority
    );
    const finalIds = publicQueueTasks.map((task) => task.id);
    const storedBeforeIds = mergePublicQueueOrder(
      readPublicQueueLastOrder(profile.id, publicQueueBuildingId),
      finalIds
    );
    const inferredBeforeIds = inferredBeforePromotion.map((task) => task.id);
    const promotedIds = unseenEscalated.map((item) => item.task.id);
    const beforeIds =
      storedBeforeIds.length > 0
        ? storedBeforeIds
        : mergePublicQueueOrder(inferredBeforeIds, finalIds);
    let moving = unseenEscalated
      .map((item) => ({
        ...item,
        fromIndex: beforeIds.indexOf(item.task.id),
        toIndex: finalIds.indexOf(item.task.id),
      }))
      .filter((item) => item.fromIndex > item.toIndex)
      .sort((a, b) => a.toIndex - b.toIndex || a.fromIndex - b.fromIndex);

    if (moving.length === 0) {
      const syntheticBeforeIds = buildSyntheticBeforePromotionIds(finalIds, promotedIds);
      moving = unseenEscalated
        .map((item) => ({
          ...item,
          fromIndex: syntheticBeforeIds.indexOf(item.task.id),
          toIndex: finalIds.indexOf(item.task.id),
        }))
        .filter((item) => item.fromIndex > item.toIndex)
        .sort((a, b) => a.toIndex - b.toIndex || a.fromIndex - b.fromIndex);
      if (moving.length === 0) return null;
      return {
        beforeIds: syntheticBeforeIds,
        finalIds,
        moving,
        keys: moving.map((item) => item.key),
        signature: `${profile.id}:${publicQueueBuildingId ?? "all"}:${moving.map((item) => item.key).join("|")}:${finalIds.join(",")}:synthetic`,
      };
    }

    return {
      beforeIds,
      finalIds,
      moving,
      keys: moving.map((item) => item.key),
      signature: `${profile.id}:${publicQueueBuildingId ?? "all"}:${moving.map((item) => item.key).join("|")}:${finalIds.join(",")}`,
    };
  }, [profile?.id, publicQueueBuildingId, publicQueueOpen, publicQueueRaw, publicQueueSeenVersion, publicQueueTasks]);
  const publicQueueDisplayTasks = useMemo(() => {
    const orderIds = publicQueueVisualOrderIds ?? publicQueuePendingPromotion?.beforeIds ?? null;
    if (!orderIds) return publicQueueTasks;
    const byId = new Map(publicQueueTasks.map((task) => [task.id, task]));
    const ordered = orderIds
      .map((id) => byId.get(id))
      .filter((task): task is TaskFromAPI => task != null);
    const orderedIds = new Set(ordered.map((task) => task.id));
    return [
      ...ordered,
      ...publicQueueTasks.filter((task) => !orderedIds.has(task.id)),
    ];
  }, [publicQueuePendingPromotion?.beforeIds, publicQueueTasks, publicQueueVisualOrderIds]);

  useEffect(() => {
    if (!publicQueueOpen) {
      publicQueuePromotionTimersRef.current.forEach((timer) => clearTimeout(timer));
      publicQueuePromotionTimersRef.current = [];
      publicQueuePromotionRunningRef.current = false;
      publicQueuePromotionSignatureRef.current = "";
      setPublicQueueVisualOrderIds(null);
      setPublicQueueAnimatingTaskId(null);
      return;
    }
    if (!profile?.id || !publicQueuePendingPromotion) return;
    if (publicQueuePromotionRunningRef.current) return;
    if (publicQueuePromotionSignatureRef.current === publicQueuePendingPromotion.signature) return;

    publicQueuePromotionRunningRef.current = true;
    publicQueuePromotionSignatureRef.current = publicQueuePendingPromotion.signature;
    publicQueuePromotionTimersRef.current.forEach((timer) => clearTimeout(timer));
    publicQueuePromotionTimersRef.current = [];

    let currentIds = [...publicQueuePendingPromotion.beforeIds];
    setPublicQueueVisualOrderIds(currentIds);
    setPublicQueueAnimatingTaskId(null);

    const firstDelay = 520;
    const stepDelay = 880;
    publicQueuePendingPromotion.moving.forEach((item, index) => {
      const timer = window.setTimeout(() => {
        const targetIndex = publicQueuePendingPromotion.finalIds.indexOf(item.task.id);
        const nextIds = currentIds.filter((id) => id !== item.task.id);
        nextIds.splice(Math.max(0, Math.min(targetIndex, nextIds.length)), 0, item.task.id);
        currentIds = nextIds;
        setPublicQueueVisualOrderIds([...currentIds]);
        setPublicQueueAnimatingTaskId(item.task.id);
      }, firstDelay + index * stepDelay);
      publicQueuePromotionTimersRef.current.push(timer);
    });

    const finishTimer = window.setTimeout(() => {
      setPublicQueueVisualOrderIds(publicQueuePendingPromotion.finalIds);
      setPublicQueueAnimatingTaskId(null);
      writePublicQueueSeenEscalations(profile.id, publicQueuePendingPromotion.keys);
      writePublicQueueLastOrder(profile.id, publicQueueBuildingId, publicQueuePendingPromotion.finalIds);
      setPublicQueueSeenVersion((version) => version + 1);
      publicQueuePromotionRunningRef.current = false;
      const releaseTimer = window.setTimeout(() => {
        setPublicQueueVisualOrderIds(null);
      }, 180);
      publicQueuePromotionTimersRef.current.push(releaseTimer);
    }, firstDelay + publicQueuePendingPromotion.moving.length * stepDelay + 420);
    publicQueuePromotionTimersRef.current.push(finishTimer);
  }, [profile?.id, publicQueueBuildingId, publicQueueOpen, publicQueuePendingPromotion]);

  useEffect(() => {
    if (!publicQueueOpen || !profile?.id || publicQueuePendingPromotion || publicQueuePromotionRunningRef.current) return;
    writePublicQueueLastOrder(profile.id, publicQueueBuildingId, publicQueueTasks.map((task) => task.id));
  }, [profile?.id, publicQueueBuildingId, publicQueueOpen, publicQueuePendingPromotion, publicQueueTasks]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {taskCreateError && (
        <div className={`fixed left-1/2 top-5 z-[220] -translate-x-1/2 rounded-xl border border-red-100 bg-white/95 px-4 py-2 text-xs font-semibold text-red-600 shadow-xl backdrop-blur ${
          taskCreateLimitWarning ? "collab-limit-shake" : ""
        }`}>
          {taskCreateError}
        </div>
      )}
      {/* ====== INTERACTIVE BIRD'S-EYE MAP ====== */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 overflow-hidden transition-colors duration-700"
        style={{
          background: resolvedTheme === "dark" ? "#0f1117" : "#f2f2f4",
          cursor: hasCrop ? "default" : mapPanning ? "grabbing" : "grab",
        }}
        onMouseDown={handleMapPanDown}
      >
        {activeBuilding?.floorPlanUrl ? (
          <div
            ref={mapInnerRef}
            className="relative"
            style={{
              transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`,
              transformOrigin: "0 0",
            }}
          >
            <img
              src={activeBuilding.floorPlanUrl}
              alt={activeBuilding.name}
              className="block w-full h-auto transition-[filter] duration-700"
              draggable={false}
              style={{ filter: "var(--map-filter)" }}
              onLoad={handleFloorPlanLoad}
            />
            {/* 助理地图标记 */}
            {(() => {
              // 允许同一助理同时在多个坐标出现标记：
              // - currentRoom: 主标记（进行中头像 / 待就位蓝点 / 恢复待就位头像）
              // - pausedRoom:  暂停中的原任务灰头像
              // - preemptedWaitingRoom: 待就位被插单时让行的原任务灰头像（固定 50% 透明）
              // - pendingRoom: 执行中时的插单待处理蓝脉冲点
              // 注意：不能只用 currentRoom 过滤，否则 pausedRoom 会被误删
              const visible = assistants.filter((a) =>
                (a.currentRoom || a.pausedRoom || a.pendingRoom || a.preemptedWaitingRoom)
                && (
                  a.status === "assigned"
                  || a.status === "executing"
                  || a.resumingFromPause
                  || !!a.pausedRoom
                  || !!a.pendingRoom
                  || !!a.preemptedWaitingRoom
                )
              );
              // 解析额外场地坐标
              const venueCoords = new Map<string, { x: number; y: number }>();
              if (activeBuilding?.extraVenues) {
                try {
                  const raw = JSON.parse(activeBuilding.extraVenues);
                  for (const v of raw) {
                    const name = typeof v === "string" ? v : v.name;
                    const x = typeof v === "object" ? v.x : undefined;
                    const y = typeof v === "object" ? v.y : undefined;
                    if (name && x !== undefined && y !== undefined) venueCoords.set(name, { x, y });
                  }
                } catch {}
              }
              // 同房间所有标记（含不同助理）统一横向错开：避免叶梦妮灰头像与张钰函主标记叠在同一点被盖住
              const slotsByRoom = new Map<string, { key: string }[]>();
              const pushSlot = (room: string | null | undefined, key: string) => {
                if (!room) return;
                const arr = slotsByRoom.get(room) ?? [];
                arr.push({ key });
                slotsByRoom.set(room, arr);
              };
              for (const a of visible) {
                if (a.currentRoom) pushSlot(a.currentRoom, `main:${a.id}`);
                if (a.preemptedWaitingRoom) pushSlot(a.preemptedWaitingRoom, `preempt:${a.id}`);
                if (a.pausedRoom) pushSlot(a.pausedRoom, `paused:${a.id}`);
                if (a.pendingRoom) pushSlot(a.pendingRoom, `pending:${a.id}`);
              }
              const SLOT_GAP = 22;
              const slotLayout = new Map<string, { offsetPx: number; zBase: number }>();
              for (const [, slotList] of slotsByRoom) {
                const sorted = [...slotList].sort((x, y) => x.key.localeCompare(y.key));
                const n = sorted.length;
                sorted.forEach((s, i) => {
                  const offsetPx = n > 1 ? (i - (n - 1) / 2) * SLOT_GAP : 0;
                  slotLayout.set(s.key, { offsetPx, zBase: 8 + i });
                });
              }
              return visible.flatMap((a) => {
              // 待就位被插单：原较低优先任务坐标，灰头像 50%（与暂停让行区分 key）
              const preemptedMarker = a.preemptedWaitingRoom ? (() => {
                const pr = activeBuilding.rooms.find((r) => r.roomNumber === a.preemptedWaitingRoom);
                const pv = !pr ? venueCoords.get(a.preemptedWaitingRoom!) : undefined;
                const px = pr?.xPosition ?? pv?.x;
                const py = pr?.yPosition ?? pv?.y;
                if (px === undefined || py === undefined) return null;
                const slPre = slotLayout.get(`preempt:${a.id}`);
                const ox = slPre?.offsetPx ?? 0;
                const zb = slPre?.zBase ?? 8;
                const preemptHovered = hoveredMapAssistant === `${a.id}-preempted-wait`;
                return (
                  <div
                    key={`${a.id}-preempted-wait`}
                    className="absolute"
                    style={{
                      left: `${px}%`,
                      top: `${py}%`,
                      transform: `translate(calc(-50% + ${ox}px), -50%)`,
                      zIndex: preemptHovered ? 50 : zb,
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredMapAssistant(`${a.id}-preempted-wait`);
                    }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative h-[26px] w-[26px] overflow-visible">
                      {a.preemptedOvertimeMin != null && (
                        <>
                          <div className="pointer-events-none absolute -inset-2 rounded-full bg-red-500/35 animate-ping" />
                          <div className="pointer-events-none absolute -inset-1 rounded-full bg-red-500/25 animate-pulse" />
                        </>
                      )}
                      <div
                        className="relative z-[1] h-full w-full rounded-full overflow-hidden border-[2px] border-solid shadow-sm"
                        style={{
                          filter: MAP_AWAY_AVATAR_FILTER,
                          opacity: MAP_AWAY_AVATAR_OPACITY,
                          backgroundColor: MAP_AWAY_AVATAR_BG,
                          borderColor: a.preemptedOvertimeMin != null ? DOCK_DOT.overtime : MAP_AWAY_AVATAR_BORDER,
                        }}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-white text-[8px] font-bold">{a.name[0]}</div>
                        )}
                      </div>
                    </div>
                    {hoveredMapAssistant === `${a.id}-preempted-wait` && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none whitespace-nowrap z-50">
                        <div className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                          {a.preemptedWaitingTaskDesc && (
                            <p className="text-xs font-semibold text-[--text-primary]">{a.name} · {a.preemptedWaitingTaskDesc}</p>
                          )}
                          {a.preemptedWaitingTaskDetail && (
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{a.preemptedWaitingTaskDetail}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : null;

              // 额外：插单进行中时，旧房间显示灰色头像（即使当前房间坐标缺失也要显示）
              const pausedMarker = a.pausedRoom ? (() => {
                const pRoom = activeBuilding.rooms.find((r) => r.roomNumber === a.pausedRoom);
                const pVenuePos = !pRoom ? venueCoords.get(a.pausedRoom!) : undefined;
                const pX = pRoom?.xPosition ?? pVenuePos?.x;
                const pY = pRoom?.yPosition ?? pVenuePos?.y;
                if (pX === undefined || pY === undefined) return null;
                const slPaused = slotLayout.get(`paused:${a.id}`);
                const oxP = slPaused?.offsetPx ?? 0;
                const zbP = slPaused?.zBase ?? 8;
                const pausedHovered = hoveredMapAssistant === `${a.id}-paused`;
                return (
                  <div
                    key={`${a.id}-paused`}
                    className="absolute"
                    style={{
                      left: `${pX}%`,
                      top: `${pY}%`,
                      transform: `translate(calc(-50% + ${oxP}px), -50%)`,
                      zIndex: pausedHovered ? 50 : zbP,
                    }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-paused`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative h-[26px] w-[26px] overflow-visible">
                      {a.pausedOvertimeMin != null && (
                        <>
                          <div className="pointer-events-none absolute -inset-2 rounded-full bg-red-500/35 animate-ping" />
                          <div className="pointer-events-none absolute -inset-1 rounded-full bg-red-500/25 animate-pulse" />
                        </>
                      )}
                      <div
                        className="relative z-[1] h-full w-full rounded-full overflow-hidden border-[2px] border-solid shadow-sm"
                        style={{
                          filter: MAP_AWAY_AVATAR_FILTER,
                          opacity: MAP_AWAY_AVATAR_OPACITY,
                          backgroundColor: MAP_AWAY_AVATAR_BG,
                          borderColor: a.pausedOvertimeMin != null ? DOCK_DOT.overtime : MAP_AWAY_AVATAR_BORDER,
                        }}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-white text-[8px] font-bold">{a.name[0]}</div>
                        )}
                      </div>
                    </div>
                    {hoveredMapAssistant === `${a.id}-paused` && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none whitespace-nowrap z-50">
                        <div className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                          {a.pausedTaskDesc && (
                            <p className="text-xs font-semibold text-[--text-primary]">{a.name} · 暂停中 · 已进行{fmtMin(a.pausedElapsedMin)}</p>
                          )}
                          {a.pausedTaskDetail && (
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{a.pausedTaskDetail}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : null;

              // 待处理插单的蓝脉冲标记（旧任务还在 executing，新任务在 waiting）
              const pendingMarker = a.pendingRoom ? (() => {
                const pr = activeBuilding.rooms.find((r) => r.roomNumber === a.pendingRoom);
                const pvp = !pr ? venueCoords.get(a.pendingRoom!) : undefined;
                const px = pr?.xPosition ?? pvp?.x;
                const py = pr?.yPosition ?? pvp?.y;
                if (px === undefined || py === undefined) return null;
                const slPen = slotLayout.get(`pending:${a.id}`);
                const oxPen = slPen?.offsetPx ?? 0;
                const zbPen = slPen?.zBase ?? 9;
                const penHovered = hoveredMapAssistant === `${a.id}-pending`;
                return (
                  <div
                    key={`${a.id}-pending`}
                    className="absolute"
                    style={{
                      left: `${px}%`,
                      top: `${py}%`,
                      transform: `translate(calc(-50% + ${oxPen}px), -50%)`,
                      zIndex: penHovered ? 50 : zbPen,
                    }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-pending`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative h-[26px] w-[26px] overflow-visible">
                      <div className="pointer-events-none absolute -inset-2 rounded-full bg-blue-500/25 animate-ping" />
                      <div className="pointer-events-none absolute -inset-1 rounded-full bg-blue-500/15 animate-pulse" />
                      <div
                        className="relative z-[1] h-[26px] w-[26px] overflow-hidden rounded-full border-[2px] border-solid shadow-sm"
                        style={{ borderColor: DOCK_DOT.assigned }}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-[8px] font-bold text-white">{a.name[0]}</div>
                        )}
                      </div>
                    </div>
                    {hoveredMapAssistant === `${a.id}-pending` && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none whitespace-nowrap z-50">
                        <div className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                          <p className="text-xs font-semibold text-blue-600">{a.name} · 紧急插单待处理</p>
                          {a.newTaskDesc && <p className="text-[10px] text-[--text-muted] mt-0.5">{a.newTaskDesc}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : null;

              // 主标记（当前任务房间/待就位房间）
              const room = activeBuilding.rooms.find((r) => r.roomNumber === a.currentRoom);
              const venuePos = !room ? venueCoords.get(a.currentRoom!) : undefined;
              const posX = room?.xPosition ?? venuePos?.x;
              const posY = room?.yPosition ?? venuePos?.y;
              if (posX === undefined || posY === undefined) {
                // 当前房间没有坐标时，也不要清空灰头像/蓝点（尤其是暂停后需要保留旧坐标灰头像）
                return [preemptedMarker, pausedMarker, pendingMarker].filter(Boolean);
              }

              const isAssigned = a.status === "assigned";
              const isHovered = hoveredMapAssistant === a.id;
              const slMain = slotLayout.get(`main:${a.id}`);
              const offset = slMain?.offsetPx ?? 0;
              const zMain = slMain?.zBase ?? 10;
              // 执行中 + 紧急插单待处理：原（较低优先）进行中坐标用灰头像 50%，与 pending 蓝点并存
              const dimExecutingForPendingInterrupt =
                !isAssigned && !a.resumingFromPause && !!a.pendingRoom;

              const mainMarker = (
                <div
                  key={a.id}
                  className="absolute overflow-visible"
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    transform: `translate(calc(-50% + ${offset}px), -50%) scale(${isHovered ? 1.35 : 1})`,
                    zIndex: isHovered ? 50 : zMain,
                    transition: "transform .3s cubic-bezier(.34,1.56,.64,1)",
                  }}
                  onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(a.id); }}
                  onMouseLeave={() => setHoveredMapAssistant(null)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {isAssigned || a.resumingFromPause ? (
                    <div className="relative h-[26px] w-[26px] overflow-visible">
                      {/* 外圈脉冲：居中包裹头像，pointer-events-none 避免挡 hover */}
                      <div className="pointer-events-none absolute -inset-2 rounded-full bg-blue-500/25 animate-ping" />
                      <div className="pointer-events-none absolute -inset-1 rounded-full bg-blue-500/15 animate-pulse" />
                      <div
                        className="relative z-[1] h-[26px] w-[26px] overflow-hidden rounded-full border-[2px] border-solid shadow-sm"
                        style={{ borderColor: assistantDockDotColor(a) }}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-[8px] font-bold text-white">{a.name[0]}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="relative h-[26px] w-[26px] overflow-visible">
                      {a.executingOvertimeMin != null && (
                        <>
                          <div className="pointer-events-none absolute -inset-2 rounded-full bg-red-500/35 animate-ping" />
                          <div className="pointer-events-none absolute -inset-1 rounded-full bg-red-500/25 animate-pulse" />
                        </>
                      )}
                      <div
                        className="relative z-[1] h-full w-full rounded-full overflow-hidden border-[2px] border-solid shadow-sm"
                        style={{
                          borderColor: dimExecutingForPendingInterrupt
                            ? a.executingOvertimeMin != null
                              ? DOCK_DOT.overtime
                              : MAP_AWAY_AVATAR_BORDER
                            : assistantDockDotColor(a),
                          filter: dimExecutingForPendingInterrupt ? MAP_AWAY_AVATAR_FILTER : "none",
                          opacity: dimExecutingForPendingInterrupt ? MAP_AWAY_AVATAR_OPACITY : 1,
                          backgroundColor: dimExecutingForPendingInterrupt ? MAP_AWAY_AVATAR_BG : undefined,
                        }}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-orange-200 to-orange-400 flex items-center justify-center text-white text-[8px] font-bold">{a.name[0]}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Tooltip — hover 显示所有任务 */}
                  {isHovered && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none whitespace-nowrap z-50">
                      <div className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                        {(() => {
                          const waitingOnMap = isAssigned || a.resumingFromPause;
                          const statusColor = waitingOnMap
                            ? "text-blue-600"
                            : a.executingOvertimeMin != null
                              ? "text-red-600"
                              : "text-orange-600";
                          const statusLabel = waitingOnMap ? "待就位" : "进行中";
                          // Parse currentTask: each task block separated by "---", each block has optional elapsed line + detail line
                          const tasks = a.currentTask ? a.currentTask.split("\n---\n") : [];
                          if (tasks.length === 0) {
                            return (
                              <>
                                <p className={`text-xs font-semibold ${statusColor}`}>{a.name} · {statusLabel}</p>
                                <p className="text-[10px] text-[--text-muted] mt-0.5">{formatRoomOrVenue(a.currentRoom) || "—"}</p>
                                {a.currentTaskNote && (
                                  <div className="mt-1 pt-2 border-t border-gray-100">
                                    <p className="text-[8px] text-orange-500 flex items-start gap-1 whitespace-normal text-left max-w-[180px]">
                                      <svg className="shrink-0 mt-[1px]" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                      <span className="note-two-line leading-[1.25]" style={{ maxHeight: "2.5em", overflow: "hidden" }}>
                                        {a.currentTaskNote}
                                      </span>
                                    </p>
                                  </div>
                                )}
                              </>
                            );
                          }
                          return tasks.map((block, i) => {
                            const lines = block.split("\n");
                            const hasElapsed = lines.length > 1;
                            const elapsedText = hasElapsed ? ` · ${lines[0]}` : "";
                            const detail = hasElapsed ? lines[1] : lines[0];
                            return (
                              <div key={i} className={i > 0 ? "mt-1 pt-2 border-t border-gray-100" : ""}>
                                <p className={`text-xs font-semibold ${statusColor}`}>{a.name} · {statusLabel}{elapsedText}</p>
                                <p className="text-[10px] text-[--text-muted] mt-0.5">{detail}</p>
                              </div>
                            );
                          }).concat(
                            // 阶段A：执行中头像也应展示紧急插单信息（不只在蓝点 tooltip）
                            (a.pendingRoom && a.newTaskDesc && !isAssigned) ? [
                              <div key="pending-info" className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-xs font-semibold text-blue-600">紧急插单待处理</p>
                                <p className="text-[10px] text-[--text-muted] mt-0.5">{a.newTaskDesc}</p>
                              </div>
                            ] : []
                          ).concat(
                            a.pausedTaskDetail ? (() => {
                              const parts = a.pausedTaskDetail.split(" · ");
                              const locationAndType = parts.slice(0, 2).join(" · ");
                              const timeRange = parts[2] || "";
                              const pausedAlert = a.pausedOvertimeMin != null;
                              return [
                                <div key="paused-info" className="mt-2 pt-2 border-t border-gray-100">
                                  <p className={`text-xs font-semibold ${pausedAlert ? "text-red-600" : statusColor}`}>
                                    {locationAndType}（暂停中）
                                  </p>
                                  <p className={`text-[10px] mt-0.5 ${pausedAlert ? "text-red-600" : "text-[--text-muted]"}`}>
                                    {timeRange}
                                    {timeRange ? " · " : ""}
                                    {pausedAlert
                                      ? `已超时${fmtMin(a.pausedOvertimeMin!)}`
                                      : `已进行${fmtMin(a.pausedElapsedMin)}`}
                                  </p>
                                </div>
                              ];
                            })() : []
                          ).concat(
                            a.preemptedWaitingTaskDesc && a.preemptedWaitingTaskDetail
                              ? [
                                  <div key="preempted-wait-info" className="mt-2 pt-2 border-t border-gray-100">
                                    <p
                                      className={`text-xs font-semibold ${
                                        a.preemptedOvertimeMin != null ? "text-red-600" : "text-gray-600"
                                      }`}
                                    >
                                      {a.preemptedWaitingTaskDesc}
                                    </p>
                                    <p className="text-[10px] text-[--text-muted] mt-0.5">{a.preemptedWaitingTaskDetail}</p>
                                  </div>,
                                ]
                              : []
                          ).concat(
                            a.currentTaskNote ? [
                              <div key="note-info" className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-[8px] text-orange-500 flex items-start gap-1 whitespace-normal text-left max-w-[180px]">
                                  <svg className="shrink-0 mt-[1px]" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                  <span className="note-two-line leading-[1.25]" style={{ maxHeight: "2.5em", overflow: "hidden" }}>
                                    {a.currentTaskNote}
                                  </span>
                                </p>
                              </div>
                            ] : []
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
              return [preemptedMarker, pausedMarker, pendingMarker, mainMarker].filter(Boolean);
              });
            })()}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[--text-muted] text-sm">
            {activeBuilding ? `${activeBuilding.name} - 暂无平面图` : "加载中..."}
          </div>
        )}
        {/* Night overlay */}
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-700"
          style={{ background: "var(--map-overlay)" }}
        />
        {/* 备注弹窗 */}
        {notePopupTaskId && (
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => {
              setNotePopupTaskId(null);
              setNotePopupAnchor(null);
            }}
          >
            <div
              className="fixed bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 px-5 py-4 w-[260px]"
              style={{ left: notePopupStyle.left, top: notePopupStyle.top }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[12px] font-bold text-[--text-primary] mb-2">任务备注</p>
              <textarea
                autoFocus
                className="w-full text-[11px] px-3 py-2 rounded-xl border border-orange-200/60 bg-white/60 outline-none focus:border-orange-400/60 text-[--text-primary] placeholder:text-gray-400 resize-none disabled:cursor-not-allowed disabled:bg-gray-50/70 disabled:text-gray-400"
                placeholder="如，需要帮忙带一个道具..."
                rows={3}
                maxLength={100}
                value={notePopupValue}
                disabled={notePopupTaskIsExecuting}
                onChange={(e) => {
                  if (notePopupTaskIsExecuting) return;
                  setNotePopupValue(e.target.value);
                }}
              />
              <div className="flex gap-2 mt-2.5 justify-end">
                <button
                  className="text-[11px] px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                  onClick={() => {
                    setNotePopupTaskId(null);
                    setNotePopupAnchor(null);
                  }}
                >
                  取消
                </button>
                <button
                  disabled={noteSaving || notePopupTaskIsExecuting}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-60"
                  onClick={async () => {
                    if (notePopupTaskIsExecuting) return;
                    await handleSaveNote(notePopupTaskId, notePopupValue);
                    setNotePopupTaskId(null);
                    setNotePopupAnchor(null);
                  }}
                >
                  {noteSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeReassignmentNotice && activeReassignmentNoticeRole && (
          <div className="fixed inset-0 z-[92] flex items-center justify-center bg-white/25 backdrop-blur-md px-6">
            <div className="w-full max-w-[510px] rounded-[36px] border border-white/70 bg-white/90 px-9 py-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <div className="mb-6 flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full ${
                  activeReassignmentNoticeRole === "old"
                    ? "bg-red-500/15 text-red-600"
                    : "bg-amber-500/15 text-amber-600"
                }`}>
                  {activeReassignmentNoticeRole === "old" ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 3h5v5" />
                      <path d="M21 3 14 10" />
                      <path d="M8 21H3v-5" />
                      <path d="M3 21l7-7" />
                      <path d="M21 14v5a2 2 0 0 1-2 2h-5" />
                      <path d="M3 10V5a2 2 0 0 1 2-2h5" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-[23px] font-bold leading-tight text-[--text-primary]">
                    {activeReassignmentNoticeRole === "old" ? "待就位超时提醒" : "任务接替提醒"}
                  </p>
                  <p className="mt-1 text-[17px] leading-snug text-[--text-secondary]">
                    {activeReassignmentNotice.taskRoomNumber}室 · {activeReassignmentNotice.taskCategoryName} · P{activeReassignmentNotice.taskPriority}
                  </p>
                </div>
              </div>
              <div className={`rounded-3xl border px-6 py-5 ${
                activeReassignmentNoticeRole === "old"
                  ? "border-red-100 bg-red-50/75"
                  : "border-amber-100 bg-amber-50/75"
              }`}>
                <p className={`whitespace-pre-wrap break-words text-[21px] leading-relaxed ${
                  activeReassignmentNoticeRole === "old" ? "text-red-900" : "text-amber-900"
                }`}>
                  {activeReassignmentNoticeRole === "old"
                    ? "你因长时间未应答就位，现已将你状态切换为离线状态，点击下方确认窗口，状态切换为应接在线状态。"
                    : `因${activeReassignmentNotice.oldAssistantName}长时间未应答就位，现由你接替派发任务。`}
                </p>
              </div>
              <button
                type="button"
                disabled={reassignmentNoticeSavingId === activeReassignmentNotice.id}
                className={`mt-8 w-full rounded-3xl px-6 py-4 text-[21px] font-bold text-white shadow-lg transition-colors active:scale-[0.99] disabled:opacity-70 ${
                  activeReassignmentNoticeRole === "old"
                    ? "bg-red-500 shadow-red-500/20 hover:bg-red-600"
                    : "bg-amber-500 shadow-amber-500/20 hover:bg-amber-600"
                }`}
                onClick={() => handleAcknowledgeReassignmentNotice(
                  activeReassignmentNotice,
                  activeReassignmentNoticeRole === "old" ? "acknowledgeOld" : "acknowledgeNew"
                )}
              >
                {reassignmentNoticeSavingId === activeReassignmentNotice.id
                  ? "确认中..."
                  : activeReassignmentNoticeRole === "old"
                    ? "确认并恢复在线"
                    : "确认"}
              </button>
            </div>
          </div>
        )}

        {!activeReassignmentNotice && assistantNoteTask && assistantNoteKey && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/25 backdrop-blur-md px-6">
            <div className="w-full max-w-[510px] rounded-[36px] border border-white/70 bg-white/85 px-9 py-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-600">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[23px] font-bold leading-tight text-[--text-primary]">摄影师备注</p>
                  <p className="mt-1 text-[17px] leading-snug text-[--text-secondary]">
                    {assistantNoteTask.photographer?.name ?? "摄影师"} · {assistantNoteTask.roomNumber}室 · {assistantNoteTask.category?.name ?? "任务"} · {taskCategoryDurationCaption(assistantNoteTask.category, assistantNoteTask.priority)}
                  </p>
                </div>
              </div>
              <div className="max-h-[330px] overflow-y-auto rounded-3xl border border-green-100 bg-green-50/70 px-6 py-5">
                <p className="whitespace-pre-wrap break-words text-[21px] leading-relaxed text-green-900">
                  {assistantNoteTask.note}
                </p>
              </div>
              <button
                type="button"
                className="mt-8 w-full rounded-3xl bg-green-500 px-6 py-4 text-[21px] font-bold text-white shadow-lg shadow-green-500/20 transition-colors hover:bg-green-600 active:scale-[0.99]"
                onClick={() => {
                  setAcknowledgedAssistantNoteKeys((prev) => prev.includes(assistantNoteKey) ? prev : [...prev, assistantNoteKey]);
                }}
              >
                已知悉
              </button>
            </div>
          </div>
        )}

        {collabTask && (
          <div
            className="fixed inset-0 z-[88] flex items-center justify-center bg-white/25 px-6 backdrop-blur-md"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-[440px] rounded-3xl border border-white/70 bg-white/90 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-[--text-primary]">协作助理</p>
                  <p className="mt-1 text-[11px] text-[--text-muted]">
                    {collabTask.roomNumber}室 · {collabTask.category?.name ?? "任务"} · {taskCategoryDurationCaption(collabTask.category, collabTask.priority)}
                  </p>
                </div>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => {
                    setCollabTaskId(null);
                    setCollabSelectedIds([]);
                    setCollabLimitWarning(false);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div
                className={`max-h-[360px] overflow-y-auto pr-1 task-scroll ${
                  collabLimitWarning ? "collab-limit-shake" : ""
                }`}
              >
                {collabCandidateProfiles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center text-xs text-[--text-muted]">
                    当前楼座暂无可用协作助理
                  </div>
                ) : (
                  <div className="space-y-2">
                    {collabCandidateProfiles.map((candidate) => {
                      const selected = collabSelectedIds.includes(candidate.id);
                      const live = assistants.find((a) => a.id === candidate.id);
                      const statusLabel = selected
                        ? "已选择"
                        : live?.status === "idle"
                          ? "空闲中"
                          : "占用中";
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition-all ${
                            selected
                              ? "border-blue-300 bg-blue-50/90"
                              : "border-white/70 bg-white/70 hover:border-blue-200 hover:bg-blue-50/50"
                          }`}
                          onClick={() => {
	                            setCollabSelectedIds((prev) => {
	                              if (prev.includes(candidate.id)) {
	                                const next = prev.filter((id) => id !== candidate.id);
	                                setCollabLimitWarning(next.length > collabHelperLimit);
	                                return next;
	                              }
		                              if (collabNewHelpersDisabled) {
		                                setCollabLimitWarning(false);
		                                window.setTimeout(() => setCollabLimitWarning(true), 0);
		                                return prev;
	                              }
	                              if (prev.length >= collabHelperLimit) {
	                                setCollabLimitWarning(false);
                                window.setTimeout(() => setCollabLimitWarning(true), 0);
                                return prev;
                              }
                              const next = [...prev, candidate.id];
                              if (next.length > collabHelperLimit) {
                                setCollabLimitWarning(false);
                                window.setTimeout(() => setCollabLimitWarning(true), 0);
                              } else {
                                setCollabLimitWarning(false);
                              }
                              return next;
                            });
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-200 to-blue-400 text-xs font-bold text-white">
                              {candidate.avatar ? (
                                <img src={candidate.avatar} alt={candidate.name} className="h-full w-full object-cover" />
                              ) : (
                                candidate.name[0]
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-semibold text-[--text-primary]">{candidate.name}</span>
                              <span className="block truncate text-[10px] text-[--text-muted]">
                                {[candidate.department, candidate.group].filter(Boolean).join(" · ") || "助理"}
                              </span>
                            </span>
                          </span>
                          <span className={`ml-3 shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                            selected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"
                          }`}>
                            {statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

		              <div className="mt-4 flex items-center justify-between gap-3">
		                <p className={`text-[11px] ${showCollabLimitWarning || collabNewHelpersDisabled ? "font-bold text-red-500" : "text-[--text-muted]"}`}>
		                  {collabAutoClosedByQueue
		                    ? `当前区域队列 ${collabQueueCount}/${collaborationQueueAutoCloseLimit} 条，已关闭新增协作`
		                    : collabManualDisabled
		                    ? "当前区域已关闭新增协作"
		                    : showCollabLimitWarning
		                    ? `超过多人协作 ${collabMaxParticipants} 人上限`
	                    : `已选协作 ${collabSelectedIds.length} / 可选 ${collabHelperLimit} 人（总上限 ${collabMaxParticipants} 人）`}
	                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100"
                    onClick={() => {
                      setCollabTaskId(null);
                      setCollabSelectedIds([]);
                      setCollabLimitWarning(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={collabSaving}
                    className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-600 disabled:opacity-60"
                    onClick={() => void saveCollaborators()}
                  >
                    {collabSaving ? "确认中..." : "确认"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* ====== UI OVERLAYS ====== */}
      <div onMouseDown={(e) => e.stopPropagation()}>
        {/* 左侧三面板 */}
        <div className="absolute top-3 left-3 bottom-3 z-20 w-[275px] flex flex-col gap-2">
          {/* 面板1：摄影师信息 + 位置 + 天气 + 时间 */}
          <div className={`relative z-[80] overflow-visible rounded-2xl px-4 py-3.5 ${glass}`}>
            <div className="relative mb-1">
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[95px] h-[95px] rounded-full overflow-hidden shadow-md shadow-orange-200/40 ring-2 ring-white/60 cursor-pointer group"
                onClick={() => setShowAvatarModal(true)}
                title="点击更换头像"
              >
                {profile?.avatar ? (
                  <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-orange-200 to-orange-400 flex items-center justify-center text-white text-2xl font-bold">
                    {profile?.name?.[0] || "?"}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              </div>
              <div className="min-h-[52px] min-w-0 flex justify-end">
                <div className="w-[136px]">
                <p className="text-sm font-bold text-[--text-primary] leading-tight flex justify-end items-baseline text-right">
                  <span>{profile?.name || "加载中"}</span>
                  <span className="ml-0.5">- {profile?.role === "photographer" ? "摄影师" : profile?.role === "assistant" ? "助理" : profile?.role === "assistant_leader" ? "助理组长" : profile?.role === "admin" ? "管理" : ""}</span>
                </p>
                <p className="text-[10px] text-[--text-muted] mt-0.5 text-right">
                  {[profile?.department, profile?.group].filter(Boolean).join(" · ") || ""}
                </p>
                </div>
              </div>
            </div>
            <div
              className="relative flex items-center justify-end gap-1.5 mt-1"
              onMouseEnter={() => {
                cancelLocationMenuClose();
                if (isAssistantProfile) {
                  if (assistantBuildingOptions.length > 0) setShowVenueMenu(true);
                }
              }}
              onMouseLeave={closeLocationMenuSoon}
            >
              <div className="flex min-w-0 items-center justify-end gap-1.5 text-[13px] font-semibold text-orange-500">
                {isAssistantProfile || assistantLocationTask ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    <span>{workbenchLocationText}</span>
                  </>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        className="inline-flex max-w-[96px] items-center gap-1.5 truncate rounded-md px-0.5 py-0.5 transition-colors hover:bg-orange-500/10 hover:text-orange-600"
                        onMouseEnter={() => {
                          cancelLocationMenuClose();
                          setLocationMenu("building");
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelLocationMenuClose();
                          setLocationMenu((prev) => prev === "building" ? null : "building");
                        }}
                      >
                        <svg className="shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                        <span className="truncate">{profileBuildingName}</span>
                      </button>
                      {locationMenu === "building" && (
                        <div
                          className="location-menu-drop absolute left-[18px] top-full z-[200] mt-1 w-fit rounded-xl border border-white/60 bg-white/75 px-1 py-1 shadow-lg backdrop-blur-xl"
                          onMouseEnter={cancelLocationMenuClose}
                          onMouseLeave={closeLocationMenuSoon}
                        >
                          <div className="flex flex-col items-start gap-1">
                            {photographerBuildingOptions.length === 0 ? (
                              <span className="whitespace-nowrap pr-1.5 py-1 text-left text-[13px] font-semibold leading-tight text-gray-400">
                                暂无其它楼座
                              </span>
                            ) : (
                              photographerBuildingOptions.map((bld) => (
                                <button
                                  key={bld.id}
                                  onClick={() => switchPhotographerBuilding(bld.id)}
                                  className="w-auto whitespace-nowrap bg-transparent py-1 pr-1.5 text-left text-[13px] font-semibold leading-tight text-gray-900 shadow-none transition-all duration-150 hover:translate-x-1 hover:text-orange-600 active:scale-95"
                                >
                                  {bld.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </span>
                    <span className="text-orange-400">·</span>
                    <button
                      type="button"
                      className="max-w-[82px] truncate rounded-md px-0.5 py-0.5 transition-colors hover:bg-orange-500/10 hover:text-orange-600"
                      onMouseEnter={() => {
                        cancelLocationMenuClose();
                        setLocationMenu("venue");
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelLocationMenuClose();
                        setLocationMenu((prev) => prev === "venue" ? null : "venue");
                      }}
                    >
                      {idleDisplayVenue ? formatRoomOrVenue(idleDisplayVenue) : "未选择"}
                    </button>
                  </span>
                )}
              </div>
              {/* 透明桥接区域 + 向右弹出楼座/场地 */}
              {(() => {
                if (isAssistantProfile) {
                  if (assistantBuildingOptions.length === 0) return null;
                  return (
                    <>
                      <div
                        className="absolute top-0 bottom-0"
                        style={{
                          left: "100%",
                          width: "60px",
                          pointerEvents: showVenueMenu ? "auto" : "none",
                        }}
                        onMouseEnter={cancelLocationMenuClose}
                        onMouseLeave={closeLocationMenuSoon}
                      />
                      <div
                        className="absolute flex w-max flex-col items-stretch gap-1"
                        style={{
                          left: "calc(100% + 24px)",
                          top: "50%",
                          transform: showVenueMenu ? "translateX(0) translateY(-50%)" : "translateX(-16px) translateY(-50%)",
                          opacity: showVenueMenu ? 1 : 0,
                          transition: "opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                          pointerEvents: showVenueMenu ? "auto" : "none",
                        }}
                        onMouseEnter={cancelLocationMenuClose}
                        onMouseLeave={closeLocationMenuSoon}
                      >
                        <span className="w-full text-left text-[11px] text-gray-500 font-bold whitespace-nowrap">切换楼座</span>
                        {assistantBuildingOptions.map((bld) => {
                          return (
                            <button
                              key={bld.id}
                              onClick={() => switchAssistantBuilding(bld.id)}
                              className="w-full px-2.5 py-1 rounded-md active:scale-95 transition-all duration-150 flex items-center justify-start text-left shadow whitespace-nowrap text-[10px] font-bold bg-blue-500 text-white hover:translate-x-1 hover:scale-[1.02] hover:shadow-md"
                            >
                              {bld.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                }
                if (!locationMenu || locationMenu === "building") return null;
                const menuVisible = locationMenu != null;
                const isEmpty = photographerVenueOptions.length === 0;
                return (
                  <>
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: "100%",
                        width: "60px",
                        pointerEvents: menuVisible ? "auto" : "none",
                      }}
                      onMouseEnter={cancelLocationMenuClose}
                      onMouseLeave={closeLocationMenuSoon}
                    />
                    <div
                      className="absolute flex w-max flex-col items-stretch gap-1"
                      style={{
                        left: "calc(100% + 24px)",
                        top: "50%",
                        transform: menuVisible ? "translateX(0) translateY(-50%)" : "translateX(-16px) translateY(-50%)",
                        opacity: menuVisible ? 1 : 0,
                        transition: "opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        pointerEvents: menuVisible ? "auto" : "none",
                      }}
                      onMouseEnter={cancelLocationMenuClose}
                      onMouseLeave={closeLocationMenuSoon}
                    >
                      <span className="w-full text-left text-[11px] text-gray-500 font-bold whitespace-nowrap">切换场地</span>
                      {isEmpty ? (
                        <span className="w-full px-2.5 py-1 rounded-md bg-gray-100 text-gray-400 shadow whitespace-nowrap text-left text-[10px] font-bold">
                          暂无公共区域
                        </span>
                      ) : (
                        photographerVenueOptions.map((venue) => {
                          const isWhiteBg = venue.isOriginal || venue.type === "无影棚" || (!venue.type && (venue.name.includes("无影") || venue.name.includes("白棚")));
                          return (
                            <button
                              key={venue.value}
                              onClick={() => switchVenue(venue.value)}
                              className={`w-full px-2.5 py-1 rounded-md active:scale-95 transition-all duration-150 flex items-center justify-start text-left shadow whitespace-nowrap text-[10px] font-bold hover:translate-x-1 hover:scale-[1.02] hover:shadow-md ${
                                isWhiteBg
                                  ? "bg-white text-blue-500 border border-blue-400 hover:bg-blue-50"
                                  : "bg-blue-500 text-white hover:brightness-110"
                              }`}
                            >
                              {venue.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 mt-1.5 border-t border-white/20 text-[11px]">
              <div className="flex items-center gap-1.5 text-[--text-secondary] min-w-0">
                <span className="shrink-0">🌤</span>
                <span className="truncate">深圳 · 26°C 多云</span>
              </div>
              <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[--text-secondary]" suppressHydrationWarning>
                {now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
              </span>
            </div>
          </div>

          {/* 面板2：快捷预约（摄影师） / 当前任务状态（助理） */}
          {isAssistantRole(profile?.role) ? (
            <div className={`rounded-2xl px-4 py-3 flex-1 min-h-0 flex flex-col ${glass}`}>
              <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide mb-1.5">当前任务状态</h3>
              <div className="flex-1 min-h-0 flex flex-col items-stretch justify-start gap-2 w-full pt-0.5">
                {(() => {
                  // 无任务 → 空闲
                  if (!currentRawTask && !pausedRawTask) {
                    return (
                      <div className="w-full flex-1 rounded-xl bg-green-400/20 flex flex-col items-center justify-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full bg-green-500" />
                        </div>
                        <span className="text-[32px] font-extrabold text-green-600">空闲</span>
                        <span className="text-[11px] text-green-600/70">等待系统派发任务</span>
                      </div>
                    );
                  }

                  // 渲染暂停中的旧任务区块（灰色，不可点击）
                  const flexStyle = (grow: number) => ({ flexGrow: grow, flexShrink: 1, flexBasis: 0, minHeight: 0 } as const);

                  const assistantCatName = (t: TaskFromAPI) => t.category?.name ?? "任务";
                  const lineRoomPhotoCategory = (task: TaskFromAPI, textCls: string) => (
                    <p className={`text-[11px] ${textCls} text-center leading-snug px-1`}>
                      {task.roomNumber}室 · {task.photographer?.name ?? "—"} · {assistantCatName(task)}
                    </p>
                  );
                  const pixelHMSBlock = (totalSeconds: number, colorCls: string) => (
                    <div className={`flex justify-center items-center min-h-0 py-0 mt-1 w-full ${colorCls}`}>
                      <span className="font-mono font-semibold tabular-nums leading-none tracking-tight text-[clamp(0.95rem,2.9vmin,1.28rem)]">
                        {formatSecondsAsHMS(totalSeconds)}
                      </span>
                    </div>
                  );
                  const myTaskStatus = (task: TaskFromAPI) => taskStatusForProfile(task, profile?.id) ?? task.status;
                  const myTaskTiming = (task: TaskFromAPI) => {
                    const status = myTaskStatus(task);
                    return { ...taskTimingForProfile(task, profile?.id), status };
                  };

                    const renderPausedBlock = (task: TaskFromAPI, flex: number, withResume = false) => {
                      const leaveSec = totalPausedSecondsFromApi(myTaskTiming(task), now.getTime());
                      const pauseSlideActive = manualPauseSlide?.taskId === task.id;
                      const pauseSlideCollapsed = pauseSlideActive && !manualPauseSlide.expanded;
                      if (withResume) {
                        return (
                          <div
                            key={task.id}
                            className="relative w-full min-h-0 overflow-hidden rounded-xl"
                            style={{ ...flexStyle(flex), backgroundColor: PAUSED_CARD_SOLID_BG }}
                          >
                            <div
                              className={`absolute inset-x-0 bottom-0 z-0 h-full origin-bottom transform-gpu rounded-xl transition-transform duration-[340ms] ease-[cubic-bezier(0.2,0.9,0.2,1)] will-change-transform ${
                                pauseSlideCollapsed ? "scale-y-0" : "scale-y-100"
                              }`}
                              style={{ backgroundColor: PAUSED_CARD_SOLID_BG }}
                            />
                            <div className={`relative z-[1] flex h-full w-full flex-col items-center justify-center gap-2 px-2 pb-[46px] text-center transition-opacity duration-200 ${pauseSlideCollapsed ? "opacity-0" : "opacity-100"}`}>
                              <div className="w-14 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(3.5rem,24%)] h-[min(3.5rem,24%)] rounded-full bg-gray-400/20 flex items-center justify-center overflow-hidden">
                                <div className="min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.55rem)] max-h-[min(72%,1.55rem)] rounded-full bg-gray-400" />
                              </div>
                              <span className="text-[17px] font-extrabold text-gray-600 leading-tight">暂停中/已离开</span>
                              {lineRoomPhotoCategory(task, "text-gray-500")}
                              {pixelHMSBlock(leaveSec, "text-gray-600")}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleResumePausedTask(task)}
                              disabled={pauseSlideActive}
                              className={`absolute left-[24%] right-[24%] bottom-2.5 z-[2] h-[34px] rounded-lg border border-green-600 bg-green-500 text-[15px] font-extrabold text-white shadow-sm transition-[opacity,background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-default ${
                                pauseSlideCollapsed ? "pointer-events-none opacity-0" : "opacity-100 hover:bg-green-600"
                              }`}
                            >
                              继续任务
                            </button>
                          </div>
                        );
                    }
                    return (
                      <div
                        key={task.id}
                        className="w-full min-h-0 rounded-xl flex flex-col items-center justify-center gap-1 pt-1.5 pb-1 px-1"
                        style={{ ...flexStyle(flex), backgroundColor: PAUSED_CARD_SOLID_BG }}
                      >
                        <div className="w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full bg-gray-400/20 flex items-center justify-center overflow-hidden">
                          <div className="min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full bg-gray-400" />
                        </div>
                        <span className="text-[13px] font-extrabold text-gray-500 text-center leading-tight">暂停中/已离开</span>
                        {lineRoomPhotoCategory(task, "text-gray-400")}
                        {pixelHMSBlock(leaveSec, "text-gray-500")}
                      </div>
                    );
                  };

                  /** 待就位被插单：原较低优先任务让行，样式与地图灰 50% 一致 */
                  const renderDeferredWaitingBlock = (task: TaskFromAPI, flex: number) => {
                    const waitMs = Math.max(0, now.getTime() - new Date(task.createdAt).getTime());
                    const waitSec = Math.floor(waitMs / 1000);
                    return (
                      <div
                        key={task.id}
                        className="w-full min-h-0 rounded-xl bg-gray-400/15 flex flex-col items-center justify-center gap-1 pt-1.5 pb-1 px-1 opacity-50"
                        style={flexStyle(flex)}
                      >
                        <div className="w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full bg-gray-400/20 flex items-center justify-center overflow-hidden">
                          <div className="min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full bg-gray-400" />
                        </div>
                        <span className="text-[13px] font-extrabold text-gray-500 text-center leading-tight">已让行紧急单</span>
                        {lineRoomPhotoCategory(task, "text-gray-400")}
                        {pixelHMSBlock(waitSec, "text-gray-500")}
                      </div>
                    );
                  };

                  // 渲染执行中任务区块（点击暂停，有插单任务时）
                  const renderExecutingWithPause = (task: TaskFromAPI, flex: number) => {
                    const effSec = totalEffectiveWorkSecondsFromApi(myTaskTiming(task), now.getTime());
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={handlePauseCurrentTask}
                        className="w-full min-h-0 rounded-xl bg-orange-400/20 hover:bg-orange-400/30 flex flex-col items-center justify-center gap-1 pt-1.5 pb-1.5 cursor-pointer transition-colors active:scale-[0.98] relative overflow-hidden"
                        style={flexStyle(flex)}
                      >
                        <div className="w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full bg-orange-500/20 flex items-center justify-center overflow-hidden">
                          <div className="min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full bg-orange-500 animate-pulse" />
                        </div>
                        <span className="text-[13px] font-extrabold text-orange-600">点击暂停</span>
                        {lineRoomPhotoCategory(task, "text-orange-600/80")}
                        {pixelHMSBlock(effSec, "text-orange-600")}
                        <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden">
                          <div className="h-full w-[200%] bg-gradient-to-r from-orange-400 to-orange-500 from-orange-400 animate-[shimmer_2s_linear_infinite]" />
                        </div>
                      </button>
                    );
                  };

                  // 渲染待就位任务区块（只显示信息，无按钮）
                  const renderPendingBlock = (task: TaskFromAPI, flex: number) => (
                    <div key={task.id} className="w-full min-h-0 rounded-xl bg-blue-400/10 flex flex-col items-center justify-center gap-1.5 pt-1.5 pb-1" style={flexStyle(flex)}>
                      <div className="w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full bg-blue-500/20 flex items-center justify-center overflow-hidden">
                        <div className="min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full bg-blue-400" />
                      </div>
                      <span className="text-[13px] font-extrabold text-blue-600">待就位</span>
                      {lineRoomPhotoCategory(task, "text-blue-600/80")}
                      <p className="text-[10px] text-blue-600/70 text-center px-2">
                        {taskCategoryDurationCaption(task.category, task.priority)}
                      </p>
                    </div>
                  );

                  // 渲染单个任务区块（正常流程）
                  const renderTaskBlock = (task: TaskFromAPI, flex: number) => {
                    const status = myTaskStatus(task);
                    if (status === "paused") return renderPausedBlock(task, flex);
                    if (status === "waiting") {
                      return (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => handleAssistantStatusChange("start", task)}
                          className="w-full min-h-0 rounded-xl bg-blue-400/20 hover:bg-blue-400/30 flex flex-col items-center justify-center gap-1.5 pt-2 pb-1.5 cursor-pointer transition-colors active:scale-[0.98]"
                          style={flexStyle(flex)}
                        >
                          <div className="w-10 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2.5rem,28%)] h-[min(2.5rem,28%)] rounded-full bg-blue-500/20 flex items-center justify-center overflow-hidden">
                            <div className="min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.35rem)] max-h-[min(72%,1.35rem)] rounded-full bg-blue-500" />
                          </div>
                          <span className="text-[16px] font-extrabold text-blue-600">点击开始任务</span>
                          {lineRoomPhotoCategory(task, "text-blue-600/80")}
                          <p className="text-[11px] text-blue-600/70 text-center px-2">
                            {taskCategoryDurationCaption(task.category, task.priority)} · 待就位
                          </p>
                        </button>
                      );
                    }
                    if (status === "executing") {
                      const isLocked = task.isLocked;
                      const bgCls = isLocked ? "bg-red-400/20 hover:bg-red-400/30" : "bg-orange-400/20 hover:bg-orange-400/30";
                      const dotBg = isLocked ? "bg-red-500/20" : "bg-orange-500/20";
                      const dotColor = isLocked ? "bg-red-500" : "bg-orange-500";
                      const textColor = isLocked ? "text-red-600" : "text-orange-600";
                      const subColor = isLocked ? "text-red-600/70" : "text-orange-600/70";
                        const barFrom = isLocked ? "from-red-400" : "from-orange-400";
                        const barTo = isLocked ? "to-red-500" : "to-orange-500";
                      const effSec = totalEffectiveWorkSecondsFromApi(myTaskTiming(task), now.getTime());
                      const pausePreviewSec = totalPausedSecondsFromApi(myTaskTiming(task), now.getTime());
                      const pauseSlideActive = manualPauseSlide?.taskId === task.id;
                      const pauseSlideExpanded = pauseSlideActive && manualPauseSlide.expanded;
                      return (
                        <div
                          key={task.id}
                          className={`w-full min-h-0 rounded-xl ${bgCls} relative overflow-hidden`}
                          style={flexStyle(flex)}
                        >
                            <button
                              type="button"
                              onClick={() => handleAssistantStatusChange("complete", task)}
                              disabled={pauseSlideActive}
                              className={`absolute inset-0 z-[1] flex cursor-pointer flex-col items-center justify-center gap-1 px-2 pb-[46px] pt-2 transition-opacity duration-150 active:scale-[0.98] disabled:cursor-default ${pauseSlideActive ? "opacity-0" : "opacity-100"}`}
                            >
                              <div className={`w-10 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2.5rem,28%)] h-[min(2.5rem,28%)] rounded-full ${dotBg} flex items-center justify-center overflow-hidden`}>
                                <div className={`min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.35rem)] max-h-[min(72%,1.35rem)] rounded-full ${dotColor} animate-pulse`} />
                            </div>
                            <span className={`text-[16px] font-extrabold ${textColor}`}>点击完成任务</span>
                            {lineRoomPhotoCategory(task, subColor)}
                            {pixelHMSBlock(effSec, textColor)}
                          </button>
                            <div
                              aria-hidden={!pauseSlideActive}
                              className={`absolute inset-0 z-[2] flex origin-bottom transform-gpu flex-col items-center justify-center gap-2 rounded-xl px-2 pb-[46px] text-center text-gray-600 transition-transform duration-[340ms] ease-[cubic-bezier(0.2,0.9,0.2,1)] will-change-transform ${
                                pauseSlideExpanded ? "scale-y-100" : "scale-y-0"
                              }`}
                              style={{ backgroundColor: PAUSED_CARD_SOLID_BG }}
                            >
                              <div className={`flex flex-col items-center justify-center gap-2 transition-opacity duration-150 ${pauseSlideExpanded ? "opacity-100" : "opacity-0"}`}>
                                <div className="w-14 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(3.5rem,24%)] h-[min(3.5rem,24%)] rounded-full bg-gray-400/15 flex items-center justify-center overflow-hidden">
                                  <div className="min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.55rem)] max-h-[min(72%,1.55rem)] rounded-full bg-gray-400" />
                                </div>
                                <span className="text-[17px] font-extrabold leading-tight">暂停中/已离开</span>
                                {lineRoomPhotoCategory(task, "text-gray-500")}
                                {pixelHMSBlock(pausePreviewSec, "text-gray-600")}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handlePauseCurrentTask}
                              disabled={pauseSlideActive}
                              aria-busy={pauseSlideActive}
                              className={`absolute left-[24%] right-[24%] bottom-2.5 z-[3] flex h-[34px] items-center justify-center overflow-hidden rounded-lg border border-[#e55f5f] bg-[#ef6b6b] text-[15px] font-extrabold text-white shadow-sm transition-[opacity,background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-default ${
                                pauseSlideActive ? "pointer-events-none opacity-0" : "opacity-100 hover:bg-[#e85f5f]"
                              }`}
                            >
                              短暂离开
                            </button>
                            <div className={`absolute bottom-0 left-0 right-0 z-[3] h-1 overflow-hidden pointer-events-none transition-opacity duration-200 ${pauseSlideActive ? "opacity-0" : "opacity-100"}`}>
                              <div className={`h-full w-[200%] bg-gradient-to-r ${barFrom} ${barTo} ${barFrom} animate-[shimmer_2s_linear_infinite]`} />
                            </div>
                        </div>
                      );
                    }
                    return null;
                  };

                  // 场景1：执行中 + 插单待就位 → 点击暂停区 2/3，待就位信息 1/3
                  if (currentRawTask && myTaskStatus(currentRawTask) === "executing" && pendingRawTask) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderExecutingWithPause(currentRawTask, 2)}
                        {renderPendingBlock(pendingRawTask, 1)}
                      </div>
                    );
                  }

                  // 待就位插单后紧急单已执行中：父任务让行 1/3 + 当前执行 2/3（地图：余骐彤房间灰头像 + 执行房间主标记）
                  if (
                    deferredWaitingRawTask &&
                    currentRawTask &&
                    myTaskStatus(currentRawTask) === "executing" &&
                    currentRawTask.parentTaskId === deferredWaitingRawTask.id
                  ) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderDeferredWaitingBlock(deferredWaitingRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </div>
                    );
                  }

                  // 待就位被更高优先插单：让行任务 1/3（灰 50%），紧急单待就位 2/3
                  if (
                    deferredWaitingRawTask &&
                    currentRawTask &&
                    myTaskStatus(currentRawTask) === "waiting" &&
                    currentRawTask.parentTaskId === deferredWaitingRawTask.id
                  ) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderDeferredWaitingBlock(deferredWaitingRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </div>
                    );
                  }

                  // 场景2：已暂停 + 待就位插单 → 暂停 1/3，待就位（点击开始）2/3
                  if (pausedRawTask && currentRawTask && myTaskStatus(currentRawTask) === "waiting") {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderPausedBlock(pausedRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </div>
                    );
                  }

                  // 场景3：已暂停 + 执行中 → 1/3 + 2/3
                  if (pausedRawTask && currentRawTask) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderPausedBlock(pausedRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </div>
                    );
                  }

                  // 普通执行中：主卡片完成任务，底部提供临时离开的手动暂停
                  if (currentRawTask && myTaskStatus(currentRawTask) === "executing") {
                    return renderTaskBlock(currentRawTask, 1);
                  }

                  // 普通手动暂停：显示离开计时，并提供继续任务入口
                  if (!currentRawTask && pausedRawTask) {
                    return renderPausedBlock(pausedRawTask, 1, true);
                  }

                  // 正常单任务
                  const task = currentRawTask || pausedRawTask!;
                  return renderTaskBlock(task, 1);
                })()}
              </div>
            </div>
          ) : (
          <div className={`rounded-2xl px-4 py-3.5 flex-1 min-h-0 flex flex-col ${glass}`}>
            <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide mb-2.5">快捷预约</h3>
            <div className="flex-1 min-h-0 flex flex-col gap-1.5 relative">
              {categories.map((cat) => {
                const isHovered = hoveredCat === cat.name;
                return (
                  <div
                    key={cat.name}
                    className="flex-1 relative"
                    onMouseEnter={() => setHoveredCat(cat.name)}
                    onMouseLeave={() => setHoveredCat(null)}
                  >
                    {/* 主标签 */}
                    <button
                      className={`w-full h-full rounded-xl ${
                        isHovered
                          ? (resolvedTheme === "dark" ? cat.darkActive : cat.active)
                          : (resolvedTheme === "dark" ? cat.darkBg : cat.bg)
                      } flex items-center justify-center cursor-pointer`}
                      style={{
                        transform: isHovered ? "translateX(12px) scale(1.02)" : "translateX(0) scale(1)",
                        transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s",
                      }}
                    >
                      <span className={`font-extrabold text-[28px] ${resolvedTheme === "dark" ? cat.darkText : cat.text}`}>{cat.name}</span>
                    </button>

                    {/* 透明桥接区域 + 弹出时长选择 */}
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: "100%",
                        width: "40px",
                        pointerEvents: isHovered ? "auto" : "none",
                      }}
                    />
                    <div
                      className="absolute flex flex-col gap-1.5"
                      style={{
                        left: "calc(100% + 40px)",
                        top: 0,
                        opacity: isHovered ? 1 : 0,
                        transform: isHovered ? "translateX(0)" : "translateX(-20px)",
                        transition: "opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        pointerEvents: isHovered ? "auto" : "none",
                      }}
                    >
                      {cat.durations.map((d) => (
                        <button
                          key={d.priority}
                          onClick={(e) => handleBook(cat.name, d, e)}
                          className={`px-4 py-1.5 rounded-lg ${d.cls} hover:brightness-110 active:scale-95 transition-all flex items-center justify-between gap-2 shadow-lg whitespace-nowrap min-w-[140px]`}
                        >
                          <span className="text-[11px] font-bold opacity-90">{d.label}</span>
                          <span className="text-[11px] font-extrabold">{d.priority}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* 面板3：我的任务 */}
          <div className={`relative rounded-2xl px-4 pb-3.5 pt-6 flex-1 min-h-0 flex flex-col overflow-visible ${glass}`}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="group relative inline-flex items-start">
                <button
                  type="button"
                  className="text-[12px] font-bold text-[--text-primary] tracking-wide"
                >
                  {publicQueueOpen ? "公共队列" : "我的任务"}
                </button>
                <div className="pointer-events-none absolute left-0 top-full z-30 pt-1 opacity-0 -translate-y-2 scale-95 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPublicQueueOpen((v) => !v)}
                    className="whitespace-nowrap rounded-lg border border-white/70 bg-white/95 px-2.5 py-1 text-[11px] font-bold text-[--text-muted] shadow-lg shadow-gray-200/70 backdrop-blur transition-colors hover:text-orange-500"
                  >
                    {publicQueueOpen ? "我的任务" : "公共队列"}
                  </button>
                </div>
              </div>
              {publicQueueOpen ? (
                <span className="text-[9px] font-semibold text-orange-500">
                  {publicQueueTasks.length}条 队列中
                </span>
              ) : (
                <button onClick={() => setShowStatsModal(true)} className="text-[10px] text-orange-500 font-semibold hover:text-orange-600 cursor-pointer">更多数据 →</button>
              )}
            </div>
            <div
              ref={taskListRef}
              className="relative flex-1 min-h-0 cursor-grab active:cursor-grabbing"
              style={{ overflow: "clip", overflowClipMargin: "0px" }}
              onWheel={(e) => {
                e.preventDefault();
                setTaskListScrollY((prev) => clampTaskListScroll(prev + e.deltaY));
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                if (target.closest("button,a,input,textarea,select")) return;
                taskListDragRef.current = {
                  active: true,
                  moved: false,
                  startY: e.clientY,
                  scrollTop: taskListScrollY,
                };
              }}
              onMouseMove={(e) => {
                const drag = taskListDragRef.current;
                if (!drag.active) return;
                const dy = e.clientY - drag.startY;
                if (Math.abs(dy) > 3) drag.moved = true;
                e.preventDefault();
                setTaskListScrollY(clampTaskListScroll(drag.scrollTop - dy));
              }}
              onMouseUp={() => {
                const drag = taskListDragRef.current;
                if (drag.moved) {
                  suppressTaskClickRef.current = true;
                  window.setTimeout(() => { suppressTaskClickRef.current = false; }, 0);
                }
                taskListDragRef.current = { ...drag, active: false };
              }}
              onMouseLeave={() => {
                const drag = taskListDragRef.current;
                taskListDragRef.current = { ...drag, active: false };
              }}
            >
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-7"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(247, 248, 250, 0.96) 0%, rgba(247, 248, 250, 0.72) 45%, rgba(247, 248, 250, 0) 100%)",
                }}
              />
              <div
                ref={taskListContentRef}
                className="space-y-1.5 pb-1 pt-2"
                style={{
                  transform: `translateY(-${taskListScrollY}px)`,
                  transition: taskListDragRef.current.active ? "none" : "transform 0.12s ease-out",
                }}
              >
                {publicQueueOpen ? (
                  publicQueueTasks.length === 0 ? (
                    <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-gray-200/70 bg-white/35 px-3 py-8 text-center text-[10px] font-medium text-[--text-muted]">
                      {buildings.find((b) => b.id === publicQueueBuildingId)?.name ?? "当前区域"}暂无未开始队列
                    </div>
                  ) : (
                    publicQueueDisplayTasks.map((queueTask, index) => {
                      const display = apiTaskToDisplay(queueTask);
                      const statusInfo = publicQueueStatusInfo(queueTask, publicQueueRaw);
                      const actualLine = taskListActualLine(display, queueTask, now.getTime(), true);
                      const assigneeNames = [
                        queueTask.assistant?.name,
                        ...helperParticipants(queueTask).map((c) => c.assistant.name),
                      ].filter(Boolean);
                      const escalated = Boolean(queueTask.escalatedAt);
                      const escalationLabel = priorityTransitionLabel(queueTask);
                      const queuedWaitingMinutes = Math.floor((now.getTime() - new Date(queueTask.createdAt).getTime()) / 60000);
                      const isAssignedWaitingOverdue =
                        !escalated &&
                        queueTask.status === "waiting" &&
                        statusInfo.label === "待就位" &&
                        queuedWaitingMinutes >= upgradeThresholdMin;
                      const isOwnPhotographerQueueTask = profile?.role === "photographer" && queueTask.photographerId === profile.id;
                      const queuePhotographerLabel = isOwnPhotographerQueueTask ? "我" : queueTask.photographer?.name ?? "摄影师";
                      return (
	                        <div
	                          key={`public-${queueTask.id}`}
	                          className={`flex gap-1.5 rounded-xl border px-1.5 py-2 shadow-sm transition-all duration-200 hover:translate-x-1 hover:scale-[1.02] hover:shadow-md ${
                              isOwnPhotographerQueueTask
                                ? "public-queue-own-task border-transparent bg-white/55 shadow-amber-100/60"
                                : "border-white/60 bg-white/55"
                            }${publicQueueAnimatingTaskId === queueTask.id ? " public-queue-promote-inserting" : ""}`}
	                        >
                          <span className={`mt-0.5 flex shrink-0 items-center justify-center text-[10px] font-extrabold shadow-sm ${publicQueueRankShapeCls(index, queueTask.priority)}`}>
                            {publicQueueRankLabel(index, queueTask.priority)}
                          </span>
	                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-[11px] font-extrabold text-[--text-primary]">{display.name}</span>
                                <span className="ml-1.5 text-[10px] font-medium text-[--text-muted]">{display.durationSlotLabel}</span>
                                {escalated && (
                                  <span className="ml-1.5 rounded bg-red-50 px-1 py-0.5 align-middle text-[8px] font-extrabold text-red-500">
                                    {escalationLabel}
                                  </span>
                                )}
                                {isAssignedWaitingOverdue && (
                                  <span className="ml-1.5 rounded bg-orange-50 px-1 py-0.5 align-middle text-[8px] font-extrabold text-orange-500">
                                    超时等待
                                  </span>
                                )}
                              </div>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold ${statusInfo.cls}`}>
                                {statusInfo.label}
                              </span>
                            </div>
		                            <div className="mt-0.5 flex h-4 min-w-0 -ml-[26px] w-[calc(100%+26px)] items-baseline gap-1.5 overflow-visible">
	                              <span
	                                className="public-queue-detail-marquee-container min-w-0 flex-1 translate-y-[3px] text-[10px] text-[--text-muted]"
	                                onMouseEnter={(e) => {
	                                  const target = e.currentTarget.querySelector(".public-queue-detail-marquee") as HTMLElement | null;
	                                  if (!target) return;
                                  const distance = Math.max(0, target.scrollWidth - e.currentTarget.clientWidth);
                                  target.style.setProperty("--public-queue-detail-marquee-distance", `-${distance}px`);
                                }}
                              >
                                <span
                                  className="public-queue-detail-marquee"
                                  title={`${display.room}室 · ${queuePhotographerLabel}${assigneeNames.length > 0 ? ` · ${assigneeNames.join("、")}` : ""}`}
                                >
                                  {display.room}室 · <span className={isOwnPhotographerQueueTask ? "font-extrabold text-amber-600" : undefined}>{queuePhotographerLabel}</span>
	                                  {assigneeNames.length > 0 ? ` · ${assigneeNames.join("、")}` : ""}
	                                </span>
	                              </span>
		                              <span className="shrink-0 whitespace-nowrap text-[10px] font-medium leading-[16px] text-[--text-muted]">{actualLine}</span>
	                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : tasks.map((task) => {
                  const isRemoving = removingTaskId === task.id;
                  const rawForTask = taskListRaw.find((x) => x.id === task.id);
                  const isPhotographerQueueTask = rawForTask != null && isPhotographerLimitQueuedTask(rawForTask);
                  const isCancellable = task.statusLabel === "等待中" || task.statusLabel === "待就位" || isPhotographerQueueTask;
                  const showCancel = isCancellable && hoveredTagId === task.id && !isRemoving;
                  const displayStatusLabel = taskStatusLabelForList(task, rawForTask, taskListRaw);
                  const showPausedWaitingDots =
                    !isAssistantRole(profile?.role) && task.statusLabel === "已暂停";
                  const collaboratorCount = helperParticipants(rawForTask).length;
                  const completedAssigneeNames = taskAssigneeNames(rawForTask, task.assistantName);
                  const isCompletedCollaboration =
                    task.statusLabel === "已完成" &&
                    collaboratorCount > 0 &&
                    completedAssigneeNames.length > 1;
                  const statusBadgeLabel = isCompletedCollaboration ? "多人协作完成" : displayStatusLabel;
                  const statusBadgeCls = showCancel
                    ? "bg-red-100/80 text-red-500 cursor-pointer hover:bg-red-200/80 scale-105"
                    : isCompletedCollaboration
                      ? STATUS_STYLE.completed.tagCls
                      : task.tagCls;
                  const taskBuildingId = taskLocationBuildingId(rawForTask);
                  const collaborationEnabled =
                    taskBuildingId != null
                      ? (collaborationEnabledByBuilding[taskBuildingId] ?? true) &&
                        ((publicQueueCountByBuilding[taskBuildingId] ?? 0) < collaborationQueueAutoCloseLimit)
                      : true;
                  const isAssistantPrimaryForTask =
                    isAssistantRole(profile?.role) &&
                    rawForTask?.assistantId === profile?.id &&
                    taskStatusForProfile(rawForTask, profile?.id) !== "completed";
                  const canEditCollaboratorsForRole =
                    !isAssistantRole(profile?.role) || isAssistantPrimaryForTask;
                  const canManageCollaborators =
                    canEditCollaboratorsForRole && taskAllowsCollaboration(rawForTask, collaborationEnabled);
                  const canEditExistingCollaborators =
                    canEditCollaboratorsForRole &&
                    rawForTask != null &&
                    rawForTask.status !== "completed" &&
                    collaboratorCount > 0 &&
                    taskCategoryAllowsCollaboration(rawForTask.category);
                  const canOpenCollaboratorModal = canManageCollaborators || canEditExistingCollaborators;
                  const isEndingSoon = task.statusLabel === "进行中" && task.estEndTime
                    ? (() => { const diff = (new Date(task.estEndTime).getTime() - Date.now()) / 60000; return diff > 0 && diff <= endingAlertMin; })()
                    : false;
	                  const isExecutingOvertime =
	                    task.statusLabel === "进行中" &&
	                    rawForTask != null &&
	                    overtimeMinutesBeyondSlot(rawForTask, now.getTime()) != null;
	                  const isEscalatedTask = task.statusLabel !== "已完成" && Boolean(rawForTask?.escalatedAt);
                    const escalationLabel = priorityTransitionLabel(rawForTask);
                    const taskPriorityLevel = Math.min(5, Math.max(1, Math.round(Number(rawForTask?.priority ?? 5) || 5)));
	                  return (
                    <div
                      key={task.id}
                      onClick={() => {
                        if (suppressTaskClickRef.current) return;
                        if (!isAssistantRole(profile?.role) || task.statusLabel !== "待就位") return;
                        const raw = assistantRawTasks.find((t) => t.id === task.id);
                        if (raw && taskStatusForProfile(raw, profile?.id) === "waiting") {
                          void handleAssistantStatusChange("start", raw);
                        }
                      }}
                      className={`px-3 py-2 rounded-xl border cursor-pointer ${task.statusCls}${
                        enteringTaskId === task.id ? " task-genie-enter" : ""
                      }${isRemoving ? " task-slide-out" : ""}`}
                      style={{
                        transition: isRemoving ? "none" : "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isRemoving) {
                          (e.currentTarget as HTMLElement).style.transform = "translateX(4px) scale(1.02)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isRemoving) {
                          (e.currentTarget as HTMLElement).style.transform = "translateX(0) scale(1)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "";
                        }
                        setHoveredTagId(null);
                      }}
                    >
	                      <div className="flex items-center justify-between gap-2">
	                        <span className="flex min-w-0 items-center text-[12px] font-medium text-[--text-primary]">
                            <span className={`mr-1.5 flex h-5 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold shadow-sm ${publicQueuePriorityLevelCls(taskPriorityLevel)}`}>
                              P{taskPriorityLevel}
                            </span>
	                          <span className="min-w-0 truncate">{task.name}</span>
	                          <span className="ml-1.5 shrink-0 text-[10px] font-normal text-[--text-muted]">{task.durationSlotLabel}</span>
	                          {isEscalatedTask && (
	                            <span className="ml-1.5 shrink-0 rounded bg-red-50 px-1 py-0.5 align-middle text-[8px] font-extrabold text-red-500">
	                              {escalationLabel}
	                            </span>
	                          )}
	                          {isEndingSoon && (
	                            <span className="ml-1.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-500 animate-pulse">快结束</span>
	                          )}
	                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 text-[10px] leading-none font-bold px-1.5 py-1 rounded transition-all duration-150 ${
                            statusBadgeCls
                          }`}
                          onMouseEnter={() => isCancellable && setHoveredTagId(task.id)}
                          onMouseLeave={() => setHoveredTagId(null)}
                          onClick={(e) => {
                            if (showCancel) {
                              e.stopPropagation();
                              handleCancelTask(task.id);
                            }
                          }}
                        >
                          {showCancel ? (
                            "取消"
                          ) : (
                            <>
                              {showPausedWaitingDots && (
                                <span className="waiting-dots" aria-hidden="true">
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              )}
                              <span>{statusBadgeLabel}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                        <span className="flex min-w-0 items-center text-[10px] leading-[14px] text-[--text-muted]">
                          <span className="shrink-0">{task.room}室</span>
                          {isAssistantRole(profile?.role) ? (
                            task.photographerName ? <span className="truncate"> · {task.photographerName}</span> : null
                          ) : isCompletedCollaboration ? (
                            <>
                              <span className="shrink-0">&nbsp;·&nbsp;</span>
                              <span className="task-assignee-line task-assignee-marquee-container">
                                <span
                                  className={completedAssigneeNames.length > 2 ? "task-assignee-marquee" : "task-assignee-static truncate"}
                                  title={completedAssigneeNames.join("、")}
                                >
                                  {completedAssigneeNames.join("、")}
                                </span>
                              </span>
                            </>
                          ) : (
                            task.assistantName ? <span className="truncate"> · {task.assistantName}</span> : null
                          )}
                        </span>
                        {(() => {
                          const raw = taskListRaw.find((x) => x.id === task.id);
                          const line = taskListActualLine(task, raw, now.getTime(), true, isAssistantRole(profile?.role) ? profile?.id : undefined);
                          const overtimeWarn =
                            raw != null && overtimeMinutesBeyondSlot({
                              ...taskTimingForProfile(raw, isAssistantRole(profile?.role) ? profile?.id : undefined),
                              status: taskStatusForProfile(raw, isAssistantRole(profile?.role) ? profile?.id : undefined) ?? raw.status,
                              category: raw.category,
                            }, now.getTime()) != null;
                          const actualLineBold =
                            task.statusLabel === "进行中" || task.statusLabel === "已暂停";
                          return line ? (
                            <span
                              className={`shrink-0 whitespace-nowrap text-right text-[10px] leading-[14px] ${
                                actualLineBold ? "font-semibold" : "font-normal"
                              } ${overtimeWarn ? "text-red-600" : "text-[--text-muted]"}`}
                            >
                              {line}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      {!isCompletedCollaboration && (canOpenCollaboratorModal || collaboratorCount > 0) && rawForTask && (
                        <div className="mt-1 flex h-5 min-w-0 items-center justify-between gap-2">
                          {canOpenCollaboratorModal ? (
                            <button
                              type="button"
	                              className="inline-flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md bg-blue-50/70 pl-0 pr-1.5 text-[9px] font-semibold leading-[20px] text-blue-600 transition-colors hover:bg-blue-100"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                openCollaboratorModal(rawForTask);
	                              }}
                            >
                              {canManageCollaborators && <span className="leading-[20px]">+</span>}
                              <span className="leading-[20px]">{collaboratorCount > 0 ? `协作 ${collaboratorCount}人` : "添加协作"}</span>
                            </button>
                          ) : (
                            <span className="flex h-5 shrink-0 items-center whitespace-nowrap text-[9px] font-semibold leading-[20px] text-blue-500">协作 {collaboratorCount}人</span>
                          )}
                          {collaboratorCount > 0 && (
                            <span
                              className="task-assignee-marquee-container flex h-5 flex-1 items-center text-[9px] leading-[20px] text-blue-500/70"
                              onMouseEnter={(e) => {
                                const target = e.currentTarget.querySelector(".task-assignee-marquee") as HTMLElement | null;
                                if (!target) return;
                                const distance = Math.max(0, target.scrollWidth - e.currentTarget.clientWidth);
                                target.style.setProperty("--task-assignee-marquee-distance", `-${distance}px`);
                              }}
                            >
                              <span
                                className="task-assignee-marquee"
                                title={taskParticipants(rawForTask).map((c) => `${c.assistant.name}${participantStatusText(c.status)}`).join("、")}
                              >
                                {taskParticipants(rawForTask).map((c) => `${c.assistant.name}${participantStatusText(c.status)}`).join("、")}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      {task.progress != null && !isExecutingOvertime && (
                        <div className="mt-1 h-0.5 rounded-full bg-black/[0.04] overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500" style={{ width: `${task.progress}%` }} />
                        </div>
                      )}
                      {/* 备注区域 */}
                      {editingNoteTaskId === task.id ? (
                        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="w-full text-[10px] px-2 py-1 rounded-lg border border-orange-200/60 bg-white/60 outline-none focus:border-orange-400/60 text-[--text-primary] placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50/70 disabled:text-gray-400"
                            placeholder="如，需要帮忙带一个道具..."
                            value={editingNoteValue}
                            maxLength={100}
                            disabled={task.statusLabel === "进行中"}
                            onChange={(e) => {
                              if (task.statusLabel === "进行中") return;
                              setEditingNoteValue(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (task.statusLabel === "进行中") return;
                              if (e.key === "Enter") {
                                void handleSaveNote(task.id, editingNoteValue);
                                setEditingNoteTaskId(null);
                              } else if (e.key === "Escape") {
                                setEditingNoteTaskId(null);
                              }
                            }}
                            onBlur={() => {
                              if (task.statusLabel === "进行中") {
                                setEditingNoteTaskId(null);
                                return;
                              }
                              void handleSaveNote(task.id, editingNoteValue);
                              setEditingNoteTaskId(null);
                            }}
                          />
                        </div>
                      ) : (() => {
                        const rawNote = isPhotographerQueueTask
                          ? photographerLimitQueuePrompt(photographerMaxActiveTasks)
                          : taskListRaw.find((x) => x.id === task.id)?.note;
                        const isPhotographer = !isAssistantRole(profile?.role);
                        const canShowNote = task.statusLabel !== "已完成";
                        const canEditNote = isPhotographer && canShowNote && task.statusLabel !== "进行中" && !isPhotographerQueueTask;
                        if (rawNote && canShowNote) {
                          return (
                            <div
                              className="mt-0.5 flex items-center gap-1 group/note min-w-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isPhotographerQueueTask ? (
                                <svg className="shrink-0 text-yellow-500" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                                  <path d="M12 8v5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
                                  <circle cx="12" cy="16.7" r="1.2" fill="white" />
                                </svg>
                              ) : (
                                <svg className="shrink-0 text-orange-400" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                              )}
                              <div className="note-marquee-container">
                                <span
                                  className={`text-[10px] note-marquee leading-none ${
                                    isPhotographerQueueTask
                                      ? "font-semibold text-red-600"
                                      : "text-orange-500/80"
                                  } ${canEditNote ? "cursor-pointer" : ""}`}
                                  title={rawNote}
                                  onMouseEnter={(e) => {
                                    const parent = e.currentTarget.parentElement;
                                    if (!parent) return;
                                    const distance = Math.max(0, e.currentTarget.scrollWidth - parent.clientWidth);
                                    e.currentTarget.style.setProperty("--note-marquee-distance", `-${distance}px`);
                                  }}
                                  onClick={canEditNote ? () => { setEditingNoteValue(rawNote); setEditingNoteTaskId(task.id); } : undefined}
                                >
                                  {rawNote}
                                </span>
                              </div>
                              {canEditNote && (
                                <button
                                  className="shrink-0 opacity-0 group-hover/note:opacity-100 transition-opacity"
                                  title="删除备注"
                                  onClick={(e) => { e.stopPropagation(); void handleSaveNote(task.id, ""); }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ef4444"/><line x1="8" y1="12" x2="16" y2="12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
                                </button>
                              )}
                            </div>
                          );
                        }
                        if (canEditNote) {
                          return (
                            <button
                              className="mt-1 text-[9px] text-gray-400 hover:text-orange-500 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setEditingNoteValue(""); setEditingNoteTaskId(task.id); }}
                            >
                              + 添加备注
                            </button>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
                </div>
            </div>
          </div>
        </div>

        {/* 顶部：区域切换 — 居中于任务面板右侧与助理列表左侧之间 */}
        <div className="absolute top-3 z-20 flex justify-center" style={{ left: 293, right: 76 }}>
          <div className={`flex gap-0.5 px-1.5 py-1 rounded-xl ${glass}`}>
            {buildings.map((b) => (
              <button
                key={b.id}
                onClick={() => setActiveBuildingId(b.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeBuildingId === b.id
                    ? "bg-[--accent-orange] text-black shadow-md shadow-black/30 font-bold text-[13px]"
                    : "text-[--text-muted] hover:text-[--text-primary] hover:bg-white/60"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* 右上按钮区域 */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          {/* 返回登录：所有角色可见 */}
          <a
            href="/"
            onClick={() => { localStorage.removeItem("user"); localStorage.removeItem("currentProfileId"); }}
            className={`rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/70 transition-colors ${glass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="text-xs font-medium text-[--text-secondary]">返回登录</span>
          </a>
          {/* 数据统计：仅摄影师/助理可见 */}
          {(loginRole === "photographer" || loginRole === "assistant") && (
          <a href="/stats" className={`rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/70 transition-colors ${glass}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span className="text-xs font-medium text-[--text-secondary]">数据统计</span>
          </a>
          )}
          {/* 切换身份 + 后台管理：仅管理账号可见 */}
          {(loginRole === "admin" || loginRole === "assistant_leader") && (
          <>
          <button
            onClick={() => setShowIdentityModal(true)}
            className={`rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/70 transition-colors ${glass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            <span className="text-xs font-medium text-[--text-secondary]">切换身份</span>
          </button>
          <a href="/admin" className={`rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/70 transition-colors ${glass}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            <span className="text-xs font-medium text-[--text-secondary]">后台管理</span>
          </a>
          </>
          )}
        </div>

        {/* 底部：图例 — 居中于任务面板右侧与助理列表左侧之间 */}
        <div className={`absolute bottom-5 z-20 flex justify-center ${resolvedTheme === "dark" ? "" : ""}`}
          style={{ left: 293, right: 76 }}
        >
          <div className={`flex items-center gap-5 px-5 py-2.5 rounded-2xl ${resolvedTheme === "dark" ? glass : ""}`}>
          {[
            { label: "空闲中", color: DOCK_DOT.idle },
            { label: "待就位", color: DOCK_DOT.assigned },
            { label: "进行中", color: DOCK_DOT.inProgress },
            { label: "已超时", color: DOCK_DOT.overtime },
            { label: "已下线", color: DOCK_DOT.offline },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-xs text-[--text-secondary]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              {l.label}
            </span>
          ))}
          </div>
        </div>
      {/* ====== GENIE PHANTOM ====== */}
      {genie && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            left: genie.phase === 0 ? genie.sx : genie.tx,
            top: genie.phase === 0 ? genie.sy : genie.ty,
            width: genie.phase === 0 ? genie.sw : genie.tw,
            height: genie.phase === 0 ? genie.sh : genie.th,
            opacity: genie.phase === 0 ? 1 : 0,
            transition:
              genie.phase >= 1
                ? "left 0.5s cubic-bezier(0.4,0,0.2,1), top 0.5s cubic-bezier(0.4,0,0.2,1), width 0.5s cubic-bezier(0.4,0,0.2,1), height 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.5s ease-in, transform 0.5s cubic-bezier(0.4,0,0.2,1), border-radius 0.5s"
                : "none",
            transformOrigin: "center bottom",
            transform:
              genie.phase === 0
                ? "perspective(800px) rotateX(0deg) scaleX(1)"
                : "perspective(800px) rotateX(50deg) scaleX(0.15)",
            borderRadius: genie.phase === 0 ? "8px" : "14px",
          }}
        >
          <div
            className={`w-full h-full ${genie.cls} flex items-center justify-between px-4`}
            style={{
              borderRadius: "inherit",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25), 0 0 60px rgba(251,146,60,0.3)",
            }}
          >
            <span className="text-[11px] font-bold text-white opacity-90">{genie.label}</span>
            <span className="text-[11px] font-extrabold text-white">{genie.priority}</span>
          </div>
        </div>
      )}

      {/* ====== THEME SWITCH ====== */}
      <div className="absolute right-20 bottom-5 z-[60]">
        <button
          onClick={cycleTheme}
          className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 text-[--text-primary] hover:scale-105"
          title={themeMode === "light" ? "日光模式（点击切换暗夜）" : themeMode === "dark" ? "暗夜模式（点击切换自动）" : `自动模式（当前${resolvedTheme === "light" ? "日光" : "暗夜"}）`}
        >
          {themeMode === "light" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
          {themeMode === "dark" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
          {themeMode === "auto" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 0 20" fill="currentColor" opacity="0.3" />
              <line x1="12" y1="6" x2="12" y2="12" /><line x1="12" y1="12" x2="16" y2="14" />
            </svg>
          )}
        </button>
      </div>

      {/* ====== AVATAR UPLOAD MODAL ====== */}
      {showAvatarModal && profile && (
        <AvatarModal
          currentAvatar={profile.avatar}
          onClose={() => setShowAvatarModal(false)}
          onSave={async (dataUrl) => {
            const res = await fetch(`/api/profiles/${profile.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ avatar: dataUrl }),
            });
            if (res.ok) {
              setProfile((p) => p ? { ...p, avatar: dataUrl } : p);
            }
            setShowAvatarModal(false);
          }}
        />
      )}

      {/* ====== IDENTITY SWITCH MODAL ====== */}
      {showIdentityModal && (
        <div
          className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowIdentityModal(false)}
        >
          <div
            className="bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-base font-bold text-[--text-primary]">切换身份</h2>
              <button
                onClick={() => setShowIdentityModal(false)}
                className="w-7 h-7 rounded-lg hover:bg-black/5 flex items-center justify-center transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="px-5 pb-2">
              <p className="text-[11px] text-[--text-muted]">选择一个身份查看对应视角的页面，当前：<span className="font-medium text-[--text-primary]">{profile?.name}</span></p>
            </div>
            {/* Building tabs + filtered profiles */}
            {(() => {
              const buildingMap = new Map<number, { name: string; profiles: typeof allProfiles }>();
              for (const p of allProfiles) {
                const displayBuildingId = isAssistantRole(p.role)
                  ? p.activeBuildingId ?? p.buildingId
                  : p.buildingId;
                const displayBuildingName =
                  buildings.find((b) => b.id === displayBuildingId)?.name ?? p.building.name;
                if (!buildingMap.has(displayBuildingId)) {
                  buildingMap.set(displayBuildingId, { name: displayBuildingName, profiles: [] });
                }
                buildingMap.get(displayBuildingId)!.profiles.push(p);
              }
              const allEntries = Array.from(buildingMap.entries());
              const orderedEntries = identityBuildingOrder.length > 0
                ? identityBuildingOrder
                    .map((id) => allEntries.find(([bId]) => bId === id))
                    .filter(Boolean) as [number, { name: string; profiles: typeof allProfiles }][]
                : allEntries;
              for (const entry of allEntries) {
                if (!orderedEntries.some(([id]) => id === entry[0])) orderedEntries.push(entry);
              }
              const activeBld =
                identityBuildingFilter ??
                (profile
                  ? isAssistantRole(profile.role)
                    ? profile.buildingId
                    : originalBuildingIdRef.current ?? profile.buildingId
                  : null) ??
                orderedEntries[0]?.[0] ??
                null;
              const activeEntry = activeBld != null ? buildingMap.get(activeBld) : null;
              const roles = ["photographer", "assistant", "assistant_leader", "admin"] as const;
              const roleLabel = (r: string) => r === "photographer" ? "摄影师" : r === "assistant" ? "助理" : r === "assistant_leader" ? "助理组长" : "管理";
              const roleColor = (r: string) => r === "photographer" ? "text-orange-600" : r === "assistant" ? "text-green-600" : r === "assistant_leader" ? "text-blue-600" : "text-purple-600";
              const roleBg = (r: string) => r === "photographer" ? "bg-orange-50" : r === "assistant" ? "bg-green-50" : r === "assistant_leader" ? "bg-blue-50" : "bg-purple-50";

              return (
                <>
                  <DockBuildingTabs
                    entries={orderedEntries}
                    activeBld={activeBld}
                    onSelect={(id) => setIdentityBuildingFilter(id)}
                    onReorder={(newOrder) => setIdentityBuildingOrder(newOrder)}
                  />
                  <div className="flex-1 overflow-y-auto px-5 pb-5">
                    {activeEntry && roles.map((role) => {
                      const roleProfiles = activeEntry.profiles.filter((p) => p.role === role);
                      if (roleProfiles.length === 0) return null;
                      return (
                        <div key={role} className="mb-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${roleBg(role)} ${roleColor(role)}`}>{roleLabel(role)}</span>
                            <span className="text-[10px] text-[--text-muted]">{roleProfiles.length}人</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {roleProfiles.map((p) => {
                              const isCurrent = p.id === profile?.id;
                              const isAssistant = isAssistantRole(p.role);
                              const ONLINE_CFG: Record<string, { label: string; textCls: string }> = {
                                online: { label: "在线", textCls: "text-green-600" },
                                offline: { label: "下线", textCls: "text-gray-400" },
                                on_break: { label: "休假", textCls: "text-gray-400" },
                              };
                              const currentOnline = p.onlineStatus || "online";
                              const otherStatuses = Object.keys(ONLINE_CFG).filter((s) => s !== currentOnline);
                              const assistantServiceBuildingId = isAssistant ? p.activeBuildingId ?? p.buildingId : p.buildingId;
                              const assistantServiceBuildingName =
                                buildings.find((b) => b.id === assistantServiceBuildingId)?.name ?? p.building.name;
                              const otherBuildings = buildings.filter((b) => b.id !== assistantServiceBuildingId);
                              // 判断该助理是否有活跃任务（进行中/待就位）
                              const assistantDock = assistants.find((x) => x.id === p.id);
                              const isBusy = assistantDock ? (assistantDock.status === "executing" || assistantDock.status === "assigned" || assistantDock.status === "busy") : false;

                              return (
                                <div
                                  key={p.id}
                                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
                                    isCurrent
                                      ? "bg-orange-50 border border-orange-200"
                                      : "border border-transparent hover:bg-gray-50"
                                  }`}
                                >
                                  {/* 头像 */}
                                  <div
                                    className={`relative w-8 h-8 flex-shrink-0 ${!isCurrent ? "cursor-pointer" : ""}`}
                                    onClick={() => !isCurrent && switchIdentity(p)}
                                  >
                                    <div className="w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                                      {p.avatar ? (
                                        <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <span className="text-white text-xs font-bold">{p.name[0]}</span>
                                      )}
                                    </div>
                                    {isAssistant && (() => {
                                      const a = assistants.find((x) => x.id === p.id);
                                      return a ? (
                                        <span
                                          className="absolute bottom-0 right-0 rounded-full"
                                          style={{
                                            width: 8,
                                            height: 8,
                                            backgroundColor: assistantDockDotColor(a),
                                            boxShadow: "0 0 0 1.5px white",
                                          }}
                                        />
                                      ) : null;
                                    })()}
                                  </div>
                                  {/* 名字+工号 */}
                                  <div
                                    className={`min-w-0 flex-1 ${!isCurrent ? "cursor-pointer" : ""}`}
                                    onClick={() => !isCurrent && switchIdentity(p)}
                                  >
                                    <p className="text-xs font-medium text-[--text-primary] truncate">
                                      {p.name}
                                      {isCurrent && <span className="text-[9px] text-orange-500 ml-1">当前</span>}
                                    </p>
                                    <p className="text-[10px] text-[--text-muted] truncate">{p.employeeId || ""}</p>
                                  </div>
                                  {/* 助理专属：状态按钮 + 场地按钮 */}
                                  {isAssistant && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      {/* 状态按钮 — 文字标签 */}
                                      <div className="relative group/status">
                                        <div
                                          className={`h-6 px-1.5 rounded-md border border-gray-200 flex items-center justify-center cursor-pointer hover:border-gray-300 transition-colors text-[9px] font-bold ${ONLINE_CFG[currentOnline].textCls}`}
                                        >
                                          {ONLINE_CFG[currentOnline].label}
                                        </div>
                                        {/* hover 下拉 */}
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1 opacity-0 pointer-events-none group-hover/status:opacity-100 group-hover/status:pointer-events-auto transition-opacity z-10">
                                          <div className="bg-white rounded-lg shadow-lg border border-gray-100 py-1.5 px-1.5 flex flex-col gap-1 items-center">
                                            {isBusy && currentOnline === "online" ? (
                                              <div className="px-2 py-1.5 text-[11px] text-red-500 font-bold leading-relaxed whitespace-nowrap">
                                                需结束当前任务<br />才可变更状态
                                              </div>
                                            ) : (
                                              otherStatuses.map((s) => (
                                                <button
                                                  key={s}
                                                  onClick={(e) => { e.stopPropagation(); updateAssistantOnlineStatus(p.id, s); }}
                                                  className={`h-6 px-1.5 flex items-center justify-center rounded-md border border-gray-200 text-[9px] font-bold whitespace-nowrap hover:border-gray-300 transition-colors ${ONLINE_CFG[s].textCls}`}
                                                >
                                                  {ONLINE_CFG[s].label}
                                                </button>
                                              ))
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      {/* 场地按钮 — 位置图标 */}
                                      <div className="relative group/bld">
                                        <div
                                          className="w-6 h-6 rounded-md border border-gray-200 flex items-center justify-center cursor-pointer hover:border-gray-300 transition-colors"
                                          title={assistantServiceBuildingName}
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                                          </svg>
                                        </div>
                                        {/* hover 下拉 */}
                                        {otherBuildings.length > 0 && (
                                          <div className="absolute top-full right-0 pt-1 opacity-0 pointer-events-none group-hover/bld:opacity-100 group-hover/bld:pointer-events-auto transition-opacity z-10">
                                            <div className="bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[80px]">
                                              <div className="px-2 py-1 text-[9px] text-gray-400 font-medium whitespace-nowrap">切换场地</div>
                                              {otherBuildings.map((b) => (
                                                <button
                                                  key={b.id}
                                                  onClick={(e) => { e.stopPropagation(); updateAssistantBuilding(p.id, b.id); }}
                                                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap"
                                                >
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                                                  </svg>
                                                  {b.name}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ====== STATS MODAL ====== */}
      {showStatsModal && (
        <div
          className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowStatsModal(false)}
        >
          <div
            className="bg-white/90 backdrop-blur-2xl rounded-2xl shadow-2xl w-full max-w-[min(92vw,800px)] max-h-[85vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[--text-primary]">我的任务统计</h2>
              <button
                onClick={() => setShowStatsModal(false)}
                className="w-7 h-7 rounded-lg hover:bg-black/5 flex items-center justify-center transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Stat Cards */}
            {(() => {
              const completed = tasks.filter((t) => t.statusLabel === "已完成").length;
              const executing = tasks.filter((t) => t.statusLabel === "进行中").length;
              const waiting = tasks.filter((t) => t.statusLabel === "等待中").length;
              const assigned = tasks.filter((t) => t.statusLabel === "待就位").length;
              const summaries = [
                { label: "已完成", value: completed, color: "text-green-600", bg: "bg-green-50" },
                { label: "进行中", value: executing, color: "text-orange-600", bg: "bg-orange-50" },
                { label: "待就位", value: assigned, color: "text-blue-600", bg: "bg-blue-50" },
                { label: "等待中", value: waiting, color: "text-gray-600", bg: "bg-gray-100" },
              ];
              return (
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {summaries.map((s) => (
                    <div key={s.label} className={`rounded-xl px-3 py-2.5 ${s.bg}`}>
                      <p className="text-[9px] text-[--text-muted] mb-0.5">{s.label}</p>
                      <span className={`text-lg font-extrabold ${s.color}`}>{s.value}</span>
                      <span className="text-[9px] text-[--text-muted] ml-0.5">单</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Charts row */}
            {(() => {
              // 任务类型占比 — 从真实 tasks 计算
              const TYPE_COLORS: Record<string, string> = {
                "短时手持": "bg-red-400", "手持": "bg-red-400",
                "服装穿戴": "bg-orange-400", "穿戴对角度": "bg-orange-400",
                "手工DIY协助": "bg-amber-400", "手工DIY制作": "bg-amber-400", "手工DIY": "bg-amber-400",
                "短时熨烫": "bg-emerald-400", "长时熨烫": "bg-emerald-400", "熨烫": "bg-emerald-400",
                "其他长时任务": "bg-blue-400", "其他": "bg-blue-400",
              };
              // 归类到5大预约类型
              const CATEGORY_GROUP: Record<string, string> = {
                "短时手持": "手持", "手持": "手持",
                "服装穿戴": "服装穿戴", "穿戴对角度": "服装穿戴",
                "手工DIY协助": "手工DIY", "手工DIY制作": "手工DIY", "手工DIY": "手工DIY",
                "短时熨烫": "熨烫", "长时熨烫": "熨烫", "熨烫": "熨烫",
                "其他长时任务": "其他", "其他": "其他",
              };
              const GROUP_COLORS: Record<string, string> = {
                "手持": "bg-red-400", "服装穿戴": "bg-orange-400",
                "手工DIY": "bg-amber-400", "熨烫": "bg-emerald-400", "其他": "bg-blue-400",
              };
              const typeCounts: Record<string, number> = {};
              for (const t of tasks) {
                const group = CATEGORY_GROUP[t.name] || "其他";
                typeCounts[group] = (typeCounts[group] || 0) + 1;
              }
              const total = tasks.length || 1;
              const typeOrder = ["手持", "服装穿戴", "手工DIY", "熨烫", "其他"];
              const typeBreakdown = typeOrder
                .filter((name) => typeCounts[name])
                .map((name) => ({ name, count: typeCounts[name], pct: Math.round((typeCounts[name] / total) * 100), color: GROUP_COLORS[name] }));

              return (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Weekly Chart — Interactive hover */}
                  <div className="rounded-xl bg-gray-50/80 px-4 py-3">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-bold text-[--text-primary]">本周完成趋势</h3>
                      {statsHoveredDay !== null && (
                        <span className="text-[9px] text-orange-600 font-medium">
                          {["周一","周二","周三","周四","周五","周六","周日"][statsHoveredDay]} · {(() => {
                            const now = new Date();
                            const dow = now.getDay();
                            const mondayOffset = dow === 0 ? -6 : 1 - dow;
                            const d = new Date(now);
                            d.setDate(now.getDate() + mondayOffset + statsHoveredDay);
                            return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
                          })()}
                        </span>
                      )}
                    </div>
                    {(() => {
                      // 计算本周每天的任务数（基于真实数据）
                      const weekDays = ["周一","周二","周三","周四","周五","周六","周日"];
                      const now2 = new Date();
                      const dow2 = now2.getDay();
                      const mondayOff = dow2 === 0 ? -6 : 1 - dow2;
                      const monday = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() + mondayOff);
                      const weekCounts = Array.from({ length: 7 }, (_, i) => {
                        const dayStart = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
                        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                        return weeklyTasks.filter((wt) => {
                          const created = new Date(wt.createdAt);
                          return created >= dayStart && created < dayEnd;
                        }).length;
                      });
                      const wMax = Math.max(...weekCounts, 1);
                      const todayIdx = dow2 === 0 ? 6 : dow2 - 1;
                      const activeIdx = statsHoveredDay !== null ? statsHoveredDay : todayIdx;
                      return (
                        <div className="flex items-end gap-2 h-28">
                          {weekDays.map((day, i) => {
                            const isActive = i === todayIdx;
                            const barH = weekCounts[i] > 0 ? Math.max((weekCounts[i] / wMax) * 80, 6) : 0;
                            return (
                              <div
                                key={day}
                                className="flex-1 flex flex-col items-center justify-end h-full"
                              >
                                <span className={`text-[9px] font-bold mb-1 ${isActive ? "text-orange-600" : "text-[--text-primary]"}`}>{weekCounts[i]}</span>
                                <div
                                  className={`w-3/4 rounded-t-md ${
                                    isActive
                                      ? "bg-gradient-to-t from-orange-600 to-orange-400"
                                      : "bg-gradient-to-t from-orange-400/50 to-orange-200/50"
                                  }`}
                                  style={{ height: `${barH}px`, minWidth: "12px" }}
                                />
                                <span className={`text-[9px] mt-1 ${isActive ? "text-orange-600 font-bold" : "text-[--text-muted]"}`}>{day}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Type Breakdown — 真实数据 */}
                  <div className="rounded-xl bg-gray-50/80 px-4 py-3">
                    <h3 className="text-[11px] font-bold text-[--text-primary] mb-3">任务类型占比</h3>
                    {typeBreakdown.length === 0 ? (
                      <div className="text-center py-6 text-[--text-muted] text-[10px]">暂无数据</div>
                    ) : (
                      <div className="space-y-2">
                        {typeBreakdown.map((t) => (
                          <div key={t.name}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-medium text-[--text-primary]">{t.name}</span>
                              <span className="text-[9px] text-[--text-muted]">{t.count}单 · {t.pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-black/[0.04] overflow-hidden">
                              <div className={`h-full rounded-full ${t.color}`} style={{ width: `${t.pct}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Task detail table */}
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white/50">
              <h3 className="text-[11px] font-bold text-[--text-primary] px-4 pt-3 pb-2 border-b border-gray-100">今日任务明细</h3>
              <div className="overflow-x-auto">
                {tasks.length === 0 ? (
                  <div className="text-center py-8 text-[--text-muted] text-xs">暂无任务</div>
                ) : (
                  <table className="w-full table-fixed border-collapse text-[10px] text-center">
                    <colgroup>
                      {Array.from({ length: 7 }, (_, i) => (
                        <col key={i} style={{ width: `${100 / 7}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-gray-50/95 border-b border-gray-200">
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">日期时间</th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">房间</th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">
                          {isAssistantRole(profile?.role) ? "摄影师" : "助理"}
                        </th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">类型</th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">预估时间</th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">实际用时</th>
                        <th className="px-3 py-2.5 font-semibold text-[10px] text-[--text-muted] align-middle">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/70 transition-colors">
                          <td className="px-3 py-2.5 tabular-nums text-[--text-muted] align-middle whitespace-nowrap">
                            {formatTaskDetailDateTime(t.createdAt)}
                          </td>
                          <td className="px-3 py-2.5 text-[--text-muted] align-middle tabular-nums">{t.room}室</td>
                          <td className="px-3 py-2.5 font-medium text-[--text-primary] align-middle min-w-0">
                            <span
                              className="inline-block max-w-full truncate align-middle"
                              title={isAssistantRole(profile?.role) ? (t.photographerName || "") : (t.assistantName || "")}
                            >
                              {isAssistantRole(profile?.role) ? (t.photographerName || "—") : (t.assistantName || "—")}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[--text-primary] align-middle min-w-0">
                            <span className="inline-block max-w-full truncate align-middle" title={t.name}>{t.name}</span>
                          </td>
                          <td className="px-3 py-2.5 text-[--text-muted] align-middle min-w-0">
                            <span className="inline-block max-w-full truncate align-middle" title={t.durationSlotLabel}>{t.durationSlotLabel}</span>
                          </td>
                          <td
                            className={`px-3 py-2.5 text-[--text-muted] align-middle min-w-0 tabular-nums ${
                              t.statusLabel === "进行中" || t.statusLabel === "已暂停"
                                ? "font-semibold"
                                : "font-normal"
                            }`}
                          >
                            <span className="inline-block max-w-full truncate align-middle">
                              {taskListActualLine(t, taskListRaw.find((x) => x.id === t.id), now.getTime(), false, isAssistantRole(profile?.role) ? profile?.id : undefined) ?? "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${t.tagCls}`}>{t.statusLabel}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <AssistantDock
        assistants={assistants}
        onNoteEdit={(taskId, note, anchor) => {
          if (noteTaskIsExecuting(taskId)) return;
          setNotePopupTaskId(taskId);
          setNotePopupValue(note);
          setNotePopupAnchor(anchor);
        }}
      />
      </div>
    </div>
  );
}

/* ─── Avatar Upload & Crop Modal ─── */

function AvatarModal({
  currentAvatar,
  onClose,
  onSave,
}: {
  currentAvatar: string | null;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(currentAvatar);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [dragging, setDragging] = useState<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const VIEWPORT = 220;

  // Base scale: make image cover the viewport at zoom=1
  const baseScale = imgEl ? Math.max(VIEWPORT / imgEl.width, VIEWPORT / imgEl.height) : 1;
  const baseW = imgEl ? imgEl.width * baseScale : 0;
  const baseH = imgEl ? imgEl.height * baseScale : 0;

  // Load image element when src changes
  useEffect(() => {
    if (!imgSrc) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setView({ panX: 0, panY: 0, zoom: 1 });
    };
    img.src = imgSrc;
  }, [imgSrc]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  // Drag to reposition
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      setView((v) => ({
        ...v,
        panX: dragging.origPanX + e.clientX - dragging.startX,
        panY: dragging.origPanY + e.clientY - dragging.startY,
      }));
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [dragging]);

  function handleSave() {
    if (!imgEl) return;
    setSaving(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const ratio = size / VIEWPORT;
    // Compute where the image visually sits relative to the viewport
    const effScale = baseScale * view.zoom;
    const imgLeft = VIEWPORT / 2 + view.panX - (imgEl.width * effScale) / 2;
    const imgTop = VIEWPORT / 2 + view.panY - (imgEl.height * effScale) / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(imgEl, imgLeft * ratio, imgTop * ratio, imgEl.width * effScale * ratio, imgEl.height * effScale * ratio);
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-800">更换头像</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-black/5 flex items-center justify-center transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Circular preview */}
        <div className="flex justify-center mb-4">
          <div
            className="relative rounded-full overflow-hidden border-2 border-gray-200"
            style={{ width: VIEWPORT, height: VIEWPORT, cursor: imgEl ? "grab" : "default" }}
            onMouseDown={(e) => {
              if (!imgEl) return;
              e.preventDefault();
              setDragging({ startX: e.clientX, startY: e.clientY, origPanX: view.panX, origPanY: view.panY });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            {imgEl ? (
              <img
                src={imgSrc!}
                alt="preview"
                draggable={false}
                style={{
                  position: "absolute",
                  left: (VIEWPORT - baseW) / 2,
                  top: (VIEWPORT - baseH) / 2,
                  width: baseW,
                  height: baseH,
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  transformOrigin: "center center",
                  pointerEvents: "none",
                }}
              />
            ) : (
              <div
                className="w-full h-full bg-gray-50 flex flex-col items-center justify-center text-gray-400 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs">拖拽或点击上传图片</span>
              </div>
            )}
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {/* Scale slider */}
        {imgEl && (
          <div className="flex items-center gap-2 mb-4 px-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            <input
              type="range"
              min={100}
              max={400}
              value={Math.round(view.zoom * 100)}
              onChange={(e) => {
                const newZoom = parseInt(e.target.value) / 100;
                setView((v) => ({ ...v, zoom: newZoom }));
              }}
              className="flex-1 accent-purple-500"
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {imgEl ? "重新选择" : "选择图片"}
          </button>
          <button
            onClick={handleSave}
            disabled={!imgEl || saving}
            className="flex-1 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-xs font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
