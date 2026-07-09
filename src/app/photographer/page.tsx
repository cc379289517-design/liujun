"use client";

import { startTransition, useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  assistantTaskScoreFactor,
  assistantTaskScoreFromSeconds,
  displayTaskCategoryName,
  EXTERNAL_MODEL_ASSIST_DISPLAY_NAME,
  isExternalModelAssistTaskName,
} from "@/lib/assistantScore";
import AssistantDock, { type DockAssistant, type NoteEditAnchor, assistantDockDotColor, DOCK_DOT } from "./AssistantDock";
import AssistantRankingAvatar from "./AssistantRankingAvatar";
import AvatarModal from "./AvatarModal";
import {
  CAT_SOLID_BG,
  CAT_SOLID_HEX,
  CAT_STYLES,
  buildCategories,
  polarPoint,
  queueTaskTypeShortLabel,
} from "./categoryDisplay";
import DockBuildingTabs from "./DockBuildingTabs";
import IroningMachineIcon from "./IroningMachineIcon";
import MobileQuickBookingPanel from "./MobileQuickBookingPanel";
import MobileTaskCard from "./MobileTaskCard";
import {
  mobileTaskStatusForProfile as deriveMobileTaskStatusForProfile,
  mobileTaskStatusMeta as deriveMobileTaskStatusMeta,
  mobileTaskSubtitle as deriveMobileTaskSubtitle,
  mobileTaskTimeLine as deriveMobileTaskTimeLine,
} from "./mobileWorkflows";
import {
  defaultBuildingVenue,
  formatRoomOrVenue,
  isAssistantRole,
  isPublicQueueTaskForBuilding,
  profileServiceBuildingId,
  profileServiceRoom,
  safeExtraVenueEntries,
  taskLocationBuildingId,
  venueBelongsToBuilding,
} from "./locationDisplay";
import {
  ACTIVE_PARTICIPANT_STATUSES,
  STATUS_STYLE,
  assistantStartCandidateTasksForProfile,
  activeTaskParticipants,
  apiTaskToDisplay,
  buildDurationLabel,
  canCancelTaskFromWorkbench,
  fmtMin,
  formatAssistantScore,
  formatMapTaskElapsedLine,
  formatSecondsAsHMS,
  formatStatsDateLabel,
  formatTaskDetailDateTime,
  hasAreaMetricDetail,
  helperParticipants,
  ironingQueueEstimateMinutes,
  ironingQueueOrderMs,
  isAssignedIroningReadyTask,
  isIroningTask,
  isMapDeferredIroningWaitingTask,
  isPassiveIroningWaitingTask,
  isExternalModelFollowTask,
  participantStatusText,
  priorityTransitionLabel,
  publicQueueEscalationKey,
  publicQueuePriorityLevelCls,
  publicQueueRankLabel,
  publicQueueRankShapeCls,
  publicQueueStatusInfo,
  resolveAssistantTasks,
  sortPublicQueueTasks,
  sortTasksByStatus,
  statsDayDate,
  statsWeekStart,
  taskAssigneeNames,
  taskCategoryDurationCaption,
  taskCompletedContributionsForRanking,
  taskListActualLine,
  taskParticipantForProfile,
  taskParticipants,
  taskStatusForProfile,
  taskStatusLabelForList,
  taskTimingForProfile,
  taskTypeGroupName,
} from "./taskDisplay";
import {
  buildSyntheticBeforePromotionIds,
  mergePublicQueueOrder,
  readPublicQueueLastOrder,
  readPublicQueueSeenEscalations,
  writePublicQueueLastOrder,
  writePublicQueueSeenEscalations,
} from "./publicQueueStorage";
import type {
  AssistantPresenceState,
  AssistantRankingContribution,
  AssistantRankingDetail,
  AssistantRankingRow,
  AreaMetricBreakdown,
  AreaMetricCard,
  AreaMetricDetailCard,
  AreaMetricKey,
  AreaMetricPerson,
  BuiltCategory,
  DbCategory,
  DisplayTask,
  IroningWorkItem,
  MobileWorkbenchTab,
  StandbyReassignmentNoticeFromAPI,
  TaskCompletionRegistration,
  TaskFromAPI,
  TaskParticipant,
  TaskPublisherFeedback,
  ThemeMode,
  VenuePoint,
  WorkbenchBuilding,
} from "./types";
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
} from "@/lib/collaborationRules";
import {
  PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY,
  isPhotographerLimitQueuedTask,
  photographerLimitQueuePrompt,
  parsePhotographerMaxActiveTasks,
} from "@/lib/photographerTaskLimit";
import {
  canPriorityRequestByConfig,
  priorityUpgradeRequestRuleForBuilding,
} from "@/lib/priorityUpgradeRules";
import { WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY } from "@/lib/workbenchBackground";
import {
  ASSISTANT_EATING_SUB_STATUS,
  DEFAULT_EATING_REENTRY_COOLDOWN_MIN,
  EATING_OVERTIME_ALERT_CONFIG_KEY,
  EATING_REENTRY_COOLDOWN_CONFIG_KEY,
  DEFAULT_EATING_OVERTIME_ALERT_MIN,
  eatingCurrentSegmentSeconds,
  eatingTotalElapsedSeconds,
  eatingReentryRemainingMs,
  normalizeEatingAccumulatedSeconds,
  parseEatingOvertimeAlertMin,
  parseEatingReentryCooldownMin,
} from "@/lib/eatingPresence";

const COMPLETION_REGISTRATION_REASON_OPTIONS = ["超时过长", "耗时异常", "其他反馈"] as const;
type CompletionRegistrationReasonType = typeof COMPLETION_REGISTRATION_REASON_OPTIONS[number];
const PAGE_NOW_REFRESH_MS = 60_000;
const LIVE_TIMER_REFRESH_MS = 1_000;
const RECENT_TASK_PATCH_TTL_MS = 8_000;
type WorkbenchPendingAction = "start" | "complete" | "pause" | "resume" | "cancel" | "create-mobile";
const DISPLAY_TASK_TYPE_ORDER = ["手持", "服装穿戴", "手工DIY", "熨烫", EXTERNAL_MODEL_ASSIST_DISPLAY_NAME, "其他"];
const DISPLAY_TASK_TYPE_SOLID_BG: Record<string, string> = {
  ...CAT_SOLID_BG,
  [EXTERNAL_MODEL_ASSIST_DISPLAY_NAME]: "bg-purple-400",
};
const DISPLAY_TASK_TYPE_SOLID_HEX: Record<string, string> = {
  ...CAT_SOLID_HEX,
  [EXTERNAL_MODEL_ASSIST_DISPLAY_NAME]: "#a855f7",
};

function displayTaskTypeGroupName(name: string | null | undefined, priority?: number | null): string {
  return isExternalModelAssistTaskName(name, priority) ? EXTERNAL_MODEL_ASSIST_DISPLAY_NAME : taskTypeGroupName(name);
}

function workbenchTaskActionKey(action: WorkbenchPendingAction, taskId: string, actorId?: string | null): string {
  return `${action}:${actorId ?? "unknown"}:${taskId}`;
}

function workbenchProfileActionKey(action: WorkbenchPendingAction, profileId?: string | null): string {
  return `${action}:${profileId ?? "unknown"}`;
}

function TransferArrowsIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M4 8.25c0-1.35 1.1-2.45 2.45-2.45h11.1"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M14.8 2.8 18.9 5.9 14.8 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 15.75c0 1.35-1.1 2.45-2.45 2.45H6.45"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M9.2 21.2 5.1 18.1 9.2 15"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function completionRegistrationImageUrls(registration: TaskCompletionRegistration | null | undefined): string[] {
  const raw = registration?.imageUrls;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function ironingSlotAssistantIds(task: TaskFromAPI): string[] {
  const ids = new Set<string>();
  for (const participant of taskParticipants(task)) {
    if (participant.status !== "completed") ids.add(participant.assistantId);
  }
  if (task.assistantId) {
    const primaryParticipant = taskParticipants(task).find((participant) => participant.assistantId === task.assistantId);
    if (!primaryParticipant || primaryParticipant.status !== "completed") ids.add(task.assistantId);
  }
  if (ids.size === 0 && task.assistantId) ids.add(task.assistantId);
  return [...ids];
}

function fmtIroningHoverTime(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 60) return `${m}分钟`;
  return `${(Math.round((m / 60) * 10) / 10).toFixed(1)}小时`;
}

const NOTE_POPUP_WIDTH = 260;
const NOTE_POPUP_ESTIMATED_HEIGHT = 180;
const MANUAL_PAUSE_SLIDE_MS = 340;
const PAUSED_CARD_SOLID_BG = "#edeff3";
const MAP_AWAY_AVATAR_FILTER = "grayscale(1) saturate(0.2)";
const MAP_AWAY_AVATAR_OPACITY = 0.58;
const MAP_AWAY_AVATAR_BG = "rgba(229, 231, 235, 0.55)";
const MAP_AWAY_AVATAR_BORDER = "rgba(156, 163, 175, 0.45)";

function assistantPresenceState(profile: { onlineStatus?: string | null; subStatus?: string | null } | null | undefined): AssistantPresenceState {
  if (profile?.onlineStatus === "on_break" || profile?.onlineStatus === "offline") return "on_break";
  if (profile?.subStatus === ASSISTANT_EATING_SUB_STATUS) return "eating";
  return "online";
}

function assistantPresenceMeta(state: AssistantPresenceState) {
  const meta = {
    online: { label: "在线", shortLabel: "在线", dot: "#22c55e", textCls: "text-green-600", bgCls: "bg-green-50", borderCls: "border-green-200" },
    eating: { label: "吃饭中", shortLabel: "吃饭", dot: "#3b82f6", textCls: "text-blue-600", bgCls: "bg-blue-50", borderCls: "border-blue-200" },
    on_break: { label: "休假/下班 /离线", shortLabel: "休假/下班 /离线", dot: "#9ca3af", textCls: "text-gray-500", bgCls: "bg-gray-50", borderCls: "border-gray-200" },
  } satisfies Record<AssistantPresenceState, { label: string; shortLabel: string; dot: string; textCls: string; bgCls: string; borderCls: string }>;
  return meta[state];
}

function assistantEatingStorageKey(profileId: string): string {
  return `assistant_eating_started_at_${profileId}`;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {}
}

function safeLocalStorageRemove(key: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {}
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function useLiveNowMs(enabled = true): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, LIVE_TIMER_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return nowMs;
}

function LiveClockText({ className }: { className?: string }) {
  const nowMs = useLiveNowMs();
  return (
    <span className={className} suppressHydrationWarning>
      {new Date(nowMs).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

type LiveTimingSource = Parameters<typeof totalEffectiveWorkSecondsFromApi>[0];

function LiveHMSBlock({
  source,
  mode,
  colorClassName,
}: {
  source: LiveTimingSource;
  mode: "effective" | "paused";
  colorClassName: string;
}) {
  const live = source.status === "executing" || source.status === "paused";
  const nowMs = useLiveNowMs(live);
  const seconds = mode === "effective"
    ? totalEffectiveWorkSecondsFromApi(source, nowMs)
    : totalPausedSecondsFromApi(source, nowMs);
  return (
    <div className={`flex justify-center items-center min-h-0 py-0 mt-1 w-full ${colorClassName}`}>
      <span className="font-mono font-semibold tabular-nums leading-none tracking-tight text-[clamp(0.95rem,2.9vmin,1.28rem)]">
        {formatSecondsAsHMS(seconds)}
      </span>
    </div>
  );
}

function LiveElapsedHMSBlock({
  startedAt,
  colorClassName,
}: {
  startedAt: string | Date | null | undefined;
  colorClassName: string;
}) {
  const nowMs = useLiveNowMs(Boolean(startedAt));
  const startMs = startedAt ? new Date(startedAt).getTime() : nowMs;
  const seconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0;
  return (
    <div className={`flex justify-center items-center min-h-0 py-0 mt-1 w-full ${colorClassName}`}>
      <span className="font-mono font-semibold tabular-nums leading-none tracking-tight text-[clamp(0.95rem,2.9vmin,1.28rem)]">
        {formatSecondsAsHMS(seconds)}
      </span>
    </div>
  );
}

function LiveEatingHMS({
  startedAt,
  accumulatedSeconds,
  mode,
  thresholdSeconds = 0,
}: {
  startedAt?: number | string | Date | null;
  accumulatedSeconds?: number | null;
  mode: "elapsed" | "paused" | "overtime";
  thresholdSeconds?: number;
}) {
  const nowMs = useLiveNowMs(Boolean(startedAt));
  const elapsedSeconds =
    mode === "paused"
      ? eatingCurrentSegmentSeconds(startedAt ?? null, nowMs)
      : eatingTotalElapsedSeconds(startedAt ?? null, accumulatedSeconds, nowMs);
  const seconds = mode === "overtime"
    ? Math.max(0, elapsedSeconds - thresholdSeconds)
    : elapsedSeconds;
  return <>{formatSecondsAsHMS(seconds)}</>;
}

type LiveEatingTimerSnapshot = {
  elapsedText: string;
  overtimeText: string;
  isOvertime: boolean;
};

function LiveEatingTimerState({
  startedAt,
  accumulatedSeconds,
  thresholdSeconds,
  children,
}: {
  startedAt?: number | string | Date | null;
  accumulatedSeconds?: number | null;
  thresholdSeconds: number;
  children: (snapshot: LiveEatingTimerSnapshot) => ReactNode;
}) {
  const nowMs = useLiveNowMs(Boolean(startedAt));
  const elapsedSeconds = eatingTotalElapsedSeconds(startedAt ?? null, accumulatedSeconds, nowMs);
  const overtimeSeconds = Math.max(0, elapsedSeconds - thresholdSeconds);
  return (
    <>
      {children({
        elapsedText: formatSecondsAsHMS(elapsedSeconds),
        overtimeText: formatSecondsAsHMS(overtimeSeconds),
        isOvertime: overtimeSeconds > 0,
      })}
    </>
  );
}

function LiveMobileTaskTimeLine({
  task,
  isAssistantProfile,
  profileId,
}: {
  task: TaskFromAPI;
  isAssistantProfile: boolean;
  profileId?: string | null;
}) {
  const viewerProfileId = isAssistantProfile ? profileId ?? undefined : undefined;
  const status = taskStatusForProfile(task, viewerProfileId) ?? task.status;
  const nowMs = useLiveNowMs(status === "executing" || status === "paused");
  const display = apiTaskToDisplay(task, viewerProfileId);
  return <>{taskListActualLine(display, task, nowMs, true, viewerProfileId)}</>;
}

function LivePresenceDot({
  className,
  baseColor,
  isEating,
  startedAt,
  accumulatedSeconds,
  thresholdSeconds,
}: {
  className: string;
  baseColor: string;
  isEating: boolean;
  startedAt?: number | string | Date | null;
  accumulatedSeconds?: number | null;
  thresholdSeconds: number;
}) {
  const nowMs = useLiveNowMs(isEating && Boolean(startedAt));
  const overtimeSeconds = isEating
    ? Math.max(0, eatingTotalElapsedSeconds(startedAt ?? null, accumulatedSeconds, nowMs) - thresholdSeconds)
    : 0;
  const color = overtimeSeconds > 0 ? "#dc2626" : baseColor;
  return <span className={className} style={{ backgroundColor: color }} />;
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

function taskAllowsCollaboration(task: TaskFromAPI | undefined, collaborationEnabled = true): boolean {
  return collaborationEnabled && task != null && task.status !== "completed";
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

function mergeIncrementalTasks(
  current: TaskFromAPI[],
  incoming: TaskFromAPI[],
  visibleIds: string[] | null,
  syncMode: "full" | "delta",
): TaskFromAPI[] {
  if (syncMode !== "delta") return incoming;

  const byId = new Map<string, TaskFromAPI>();
  for (const task of current) {
    byId.set(task.id, task);
  }
  for (const task of incoming) {
    const existing = byId.get(task.id);
    byId.set(task.id, existing ? { ...existing, ...task } : task);
  }

  if (visibleIds) {
    return visibleIds
      .map((id) => byId.get(id))
      .filter((task): task is TaskFromAPI => task != null);
  }

  return [...byId.values()];
}

function hasMissingVisibleTaskDetails(
  current: TaskFromAPI[],
  incoming: TaskFromAPI[],
  visibleIds: string[] | null,
): boolean {
  if (!visibleIds) return false;
  const knownIds = new Set<string>();
  for (const task of current) knownIds.add(task.id);
  for (const task of incoming) knownIds.add(task.id);
  return visibleIds.some((id) => !knownIds.has(id));
}

function getAutoTheme(): "light" | "dark" {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "light" : "dark";
}

function mapMarkerInverseScaleForZoom(zoom: number): number {
  return Math.round((1 / Math.pow(Math.max(0.01, zoom), 0.72)) * 1000) / 1000;
}

function canSpecifyQuickBookAssistant(assistant: DockAssistant): boolean {
  return assistant.onlineStatus === "online" &&
    !assistant.subStatus;
}

function profileToQuickBookAssistant(profile: {
  id: string;
  name: string;
  status: string;
  onlineStatus: string;
  subStatus?: string | null;
  updatedAt?: string;
  eatingStartedAt?: string | null;
  eatingPausedAt?: string | null;
  eatingEndedAt?: string | null;
  eatingAccumulatedSeconds?: number | null;
  currentRoom: string | null;
  activeRoom?: string | null;
  avatar: string | null;
  group: string | null;
}): DockAssistant {
  return {
    id: profile.id,
    name: profile.name,
    status: profile.status,
    onlineStatus: profile.onlineStatus,
    subStatus: profile.subStatus,
    updatedAt: profile.updatedAt,
    eatingStartedAt: profile.eatingStartedAt,
    eatingPausedAt: profile.eatingPausedAt,
    eatingEndedAt: profile.eatingEndedAt,
    eatingAccumulatedSeconds: profile.eatingAccumulatedSeconds,
    currentRoom: profile.activeRoom ?? profile.currentRoom,
    avatar: profile.avatar,
    group: profile.group,
    currentTask: null,
    pausedRoom: null,
    pausedTaskDesc: null,
    pausedTaskDetail: null,
    pausedElapsedMin: 0,
    preemptedWaitingRoom: null,
    preemptedWaitingTaskDesc: null,
    preemptedWaitingTaskDetail: null,
    newTaskDesc: null,
    resumingFromPause: false,
    pendingRoom: null,
    currentTaskNote: null,
    currentTaskId: null,
    executingOvertimeMin: null,
    pausedOvertimeMin: null,
    preemptedOvertimeMin: null,
  };
}

function quickBookAssistantStatusText(assistant: DockAssistant): string {
  if (assistant.onlineStatus !== "online") return "离线";
  if (assistant.subStatus === "eating") return "吃饭中";
  if (assistant.subStatus) return "暂不可接";
  if (assistant.status === "idle") return "空闲";
  if (assistant.status === "assigned") return "待就位";
  if (assistant.status === "executing" || assistant.status === "busy" || assistant.status === "finishing") return "忙碌中";
  return "在线";
}

const glass =
  "bg-white/25 backdrop-blur-xl border border-white/30 shadow-lg shadow-black/[0.03]";

export default function PhotographerPage() {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [now, setNow] = useState(() => new Date());
  const [tasks, setTasks] = useState<DisplayTask[]>([]);
  const [buildings, setBuildings] = useState<WorkbenchBuilding[]>([]);
  const [activeBuildingId, setActiveBuildingId] = useState<number | null>(null);
  const [photographerWorkbenchBuildingId, setPhotographerWorkbenchBuildingId] = useState<number | null>(null);
  const [assistants, setAssistants] = useState<DockAssistant[]>([]);
  const [specifiedQuickBookAssistantId, setSpecifiedQuickBookAssistantId] = useState<string | null>(null);
  const [quickBookAssistantPickerOpen, setQuickBookAssistantPickerOpen] = useState(false);
  const [mobileQuickBookAssistantPickerOpen, setMobileQuickBookAssistantPickerOpen] = useState(false);
  const quickBookAssistantPickerRef = useRef<HTMLDivElement | null>(null);
  const [genie, setGenie] = useState<{
    sx: number; sy: number; sw: number; sh: number;
    tx: number; ty: number; tw: number; th: number;
    label: string; priority: string; cls: string; catName: string; categoryId: number;
    priorityOverride?: number;
    quickBookSpecialType?: BuiltCategory["durations"][number]["quickBookSpecialType"];
    specifiedAssistantId: string | null;
    specifiedAssistantName: string | null;
    specifiedAssistantAvatar: string | null;
    phase: number;
  } | null>(null);
  const [enteringTaskId, setEnteringTaskId] = useState<string | null>(null);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [taskCreateNoticeTone, setTaskCreateNoticeTone] = useState<"error" | "info" | "success" | "transfer">("error");
  const [taskCreateLimitWarning, setTaskCreateLimitWarning] = useState(false);
  const [presenceSwitchConfirm, setPresenceSwitchConfirm] = useState<{
    profileId: string;
    nextState: AssistantPresenceState;
    eatingExitMode?: "pause" | "end";
    taskLabel: string;
  } | null>(null);
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null);
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const [hoveredSpecifiedTaskId, setHoveredSpecifiedTaskId] = useState<string | null>(null);
  const [cancelingSpecifiedTaskId, setCancelingSpecifiedTaskId] = useState<string | null>(null);
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
    subStatus?: string | null;
    updatedAt?: string;
    eatingStartedAt?: string | null;
    eatingPausedAt?: string | null;
    eatingEndedAt?: string | null;
    eatingAccumulatedSeconds?: number | null;
  } | null>(null);
  const [workbenchRoom, setWorkbenchRoom] = useState<string | null>(null);
  const [hoveredMapAssistant, setHoveredMapAssistant] = useState<string | null>(null);
  const [notePopupTaskId, setNotePopupTaskId] = useState<string | null>(null);
  const [notePopupValue, setNotePopupValue] = useState("");
  const [notePopupAnchor, setNotePopupAnchor] = useState<NoteEditAnchor | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [editingNoteTaskId, setEditingNoteTaskId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showAssistantPresenceMenu, setShowAssistantPresenceMenu] = useState(false);
  const [identityPresenceMenuId, setIdentityPresenceMenuId] = useState<string | null>(null);
  const [eatingReentryHintUntilByProfileId, setEatingReentryHintUntilByProfileId] = useState<Record<string, string>>({});
  const eatingReentryHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [eatingStartedAt, setEatingStartedAt] = useState<number | null>(null);
  const [showVenueMenu, setShowVenueMenu] = useState(false);
  const [showMapBuildingMenu, setShowMapBuildingMenu] = useState(false);
  const [areaDataPanelOpen, setAreaDataPanelOpen] = useState(false);
  const [ironingQueueMode, setIroningQueueMode] = useState<"auto" | "fixed">("auto");
  const [ironingQueueFixedOpen, setIroningQueueFixedOpen] = useState(false);
  const [ironingQueueHoverOpen, setIroningQueueHoverOpen] = useState(false);
  const ironingQueueHoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ironingQueueRef = useRef<HTMLDivElement | null>(null);
  const [locationMenu, setLocationMenu] = useState<"building" | "venue" | null>(null);
  const locationMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapBuildingMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalRoomRef = useRef<string | null>(null);
  const originalBuildingIdRef = useRef<number | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsHoveredDay, setStatsHoveredDay] = useState<number | null>(null);
  const [statsSelectedDay, setStatsSelectedDay] = useState<number | null>(null);
  const [statsWeekOffset, setStatsWeekOffset] = useState(0);
  const [showAreaCompletedStatsModal, setShowAreaCompletedStatsModal] = useState(false);
  const [areaCompletedStatsHoveredDay, setAreaCompletedStatsHoveredDay] = useState<number | null>(null);
  const [areaCompletedStatsSelectedDay, setAreaCompletedStatsSelectedDay] = useState<number | null>(null);
  const [areaCompletedStatsWeekOffset, setAreaCompletedStatsWeekOffset] = useState(0);
  const [publisherFeedbackSavingId, setPublisherFeedbackSavingId] = useState<string | null>(null);
  const [priorityUpgradeTask, setPriorityUpgradeTask] = useState<TaskFromAPI | null>(null);
  const [priorityUpgradeSku, setPriorityUpgradeSku] = useState("");
  const [priorityUpgradeReason, setPriorityUpgradeReason] = useState("");
  const [priorityUpgradeSaving, setPriorityUpgradeSaving] = useState(false);
  const [priorityUpgradeError, setPriorityUpgradeError] = useState<string | null>(null);
  const [ironingPreferenceConfirmTask, setIroningPreferenceConfirmTask] = useState<TaskFromAPI | null>(null);
  const [completionRegistrationTask, setCompletionRegistrationTask] = useState<TaskFromAPI | null>(null);
  const [completionRegistrationSku, setCompletionRegistrationSku] = useState("");
  const [completionRegistrationReasonType, setCompletionRegistrationReasonType] = useState<CompletionRegistrationReasonType | "">("");
  const [completionRegistrationDescription, setCompletionRegistrationDescription] = useState("");
  const [completionRegistrationExistingImages, setCompletionRegistrationExistingImages] = useState<string[]>([]);
  const [completionRegistrationFiles, setCompletionRegistrationFiles] = useState<File[]>([]);
  const [completionRegistrationFilePreviewUrls, setCompletionRegistrationFilePreviewUrls] = useState<string[]>([]);
  const [completionRegistrationSaving, setCompletionRegistrationSaving] = useState(false);
  const [completionRegistrationError, setCompletionRegistrationError] = useState<string | null>(null);
  const statsScrollRef = useRef<HTMLDivElement>(null);
  const [weeklyTasks, setWeeklyTasks] = useState<TaskFromAPI[]>([]);
  const [areaCompletedWeeklyTasks, setAreaCompletedWeeklyTasks] = useState<TaskFromAPI[]>([]);
  const [categories, setCategories] = useState<BuiltCategory[]>([]);
  const [endingAlertMin, setEndingAlertMin] = useState(2);
  const [upgradeThresholdMin, setUpgradeThresholdMin] = useState(25);
  const [eatingOvertimeAlertMin, setEatingOvertimeAlertMin] = useState(DEFAULT_EATING_OVERTIME_ALERT_MIN);
  const [eatingReentryCooldownMin, setEatingReentryCooldownMin] = useState(DEFAULT_EATING_REENTRY_COOLDOWN_MIN);
  const [workbenchPageBackground, setWorkbenchPageBackground] = useState("");
  const [photographerMaxActiveTasks, setPhotographerMaxActiveTasks] = useState(1);
  const [priorityUpgradeConfig, setPriorityUpgradeConfig] = useState<Record<string, { value: string; label: string | null }>>({});
  const [collaborationEnabledByBuilding, setCollaborationEnabledByBuilding] = useState<Record<number, boolean>>({});
  const [collaborationMaxByBuilding, setCollaborationMaxByBuilding] = useState<Record<number, number>>({});
  const [collaborationQueueAutoCloseLimit, setCollaborationQueueAutoCloseLimit] = useState(10);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [needsIdentitySelection, setNeedsIdentitySelection] = useState(false);
  const [identityUrlState, setIdentityUrlState] = useState<"unknown" | "present" | "absent">("unknown");
  const [identityBuildingFilter, setIdentityBuildingFilter] = useState<number | null>(null);
  const [identityBuildingOrder, setIdentityBuildingOrder] = useState<number[]>([]);
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string; role: string; employeeId: string | null; department: string | null; group: string | null; avatar: string | null; buildingId: number; currentRoom: string | null; activeBuildingId?: number | null; activeRoom?: string | null; status: string; subStatus?: string | null; onlineStatus: string; updatedAt?: string; eatingStartedAt?: string | null; eatingPausedAt?: string | null; eatingEndedAt?: string | null; eatingAccumulatedSeconds?: number | null; building: { id: number; name: string } }[]>([]);
  const [collabTaskId, setCollabTaskId] = useState<string | null>(null);
  const [collabSelectedIds, setCollabSelectedIds] = useState<string[]>([]);
  const [collabSaving, setCollabSaving] = useState(false);
  const [collabLimitWarning, setCollabLimitWarning] = useState(false);
  const [transferTask, setTransferTask] = useState<TaskFromAPI | null>(null);
  const [transferSavingAssistantId, setTransferSavingAssistantId] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferHoverAssistantId, setTransferHoverAssistantId] = useState<string | null>(null);
  const [transferConfirmTarget, setTransferConfirmTarget] = useState<{ assistantId: string; assistantName: string } | null>(null);
  const [transferResponseSaving, setTransferResponseSaving] = useState<"accept" | "pause_and_go" | "after_complete" | "reject" | null>(null);
  const [dismissedTransferRequestIds, setDismissedTransferRequestIds] = useState<string[]>([]);
  const transferPickerRef = useRef<HTMLDivElement | null>(null);
  // 助理当前任务（原始 API 数据）
  const [currentRawTask, setCurrentRawTask] = useState<TaskFromAPI | null>(null);
  const [pausedRawTask, setPausedRawTask] = useState<TaskFromAPI | null>(null);
  const [pendingRawTask, setPendingRawTask] = useState<TaskFromAPI | null>(null);
  const [acknowledgedAssistantNoteKeys, setAcknowledgedAssistantNoteKeys] = useState<string[]>([]);
  const [reassignmentNotices, setReassignmentNotices] = useState<StandbyReassignmentNoticeFromAPI[]>([]);
  const [reassignmentNoticeSavingId, setReassignmentNoticeSavingId] = useState<string | null>(null);
  const [dismissedReassignmentNoticeIds, setDismissedReassignmentNoticeIds] = useState<string[]>([]);
  const [manualPauseSlide, setManualPauseSlide] = useState<{ taskId: string; expanded: boolean } | null>(null);
  const [workbenchPendingActionKeys, setWorkbenchPendingActionKeys] = useState<string[]>([]);
  /** 待就位被插单时，被让行的原较低优先任务 */
  const [deferredWaitingRawTask, setDeferredWaitingRawTask] = useState<TaskFromAPI | null>(null);
  /** 助理视角下最近一次拉取到的原始任务列表（用于列表点击「待就位」与目标任务对齐） */
  const [assistantRawTasks, setAssistantRawTasks] = useState<TaskFromAPI[]>([]);
  /** 与「我的任务」展示同步的原始任务（摄影师/助理均填充，用于已进行/已等待实时文案） */
  const [taskListRaw, setTaskListRaw] = useState<TaskFromAPI[]>([]);
  /** 当前区域公共队列：供所有人查看未分配、待就位、暂停任务 */
  const [publicQueueRaw, setPublicQueueRaw] = useState<TaskFromAPI[]>([]);
  const [publicQueueOpen, setPublicQueueOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileWorkbenchTab>("current");
  const [mobileQuickBookCategory, setMobileQuickBookCategory] = useState<string | null>(null);
  const [publicQueueVisualOrderIds, setPublicQueueVisualOrderIds] = useState<string[] | null>(null);
  const [publicQueueAnimatingTaskId, setPublicQueueAnimatingTaskId] = useState<string | null>(null);
  const [publicQueueSeenVersion, setPublicQueueSeenVersion] = useState(0);
  const [expandedAssistantScoreId, setExpandedAssistantScoreId] = useState<string | null>(null);
  const [assistantScoreBubbleAnchor, setAssistantScoreBubbleAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [expandedTaskTypeDetailName, setExpandedTaskTypeDetailName] = useState<string | null>(null);
  const [taskTypeDetailBubbleAnchor, setTaskTypeDetailBubbleAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hoveredAreaTaskTypeName, setHoveredAreaTaskTypeName] = useState<string | null>(null);
  const [expandedAreaMetricKey, setExpandedAreaMetricKey] = useState<AreaMetricKey | null>(null);
  const [areaMetricBubbleAnchor, setAreaMetricBubbleAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [assistantRankingHelpOpen, setAssistantRankingHelpOpen] = useState<"center" | "legacy" | null>(null);
  const assistantRankingDragRef = useRef<{ pointerId: number; startY: number; scrollTop: number; moved: boolean } | null>(null);
  const assistantRankingScrollRef = useRef<HTMLDivElement>(null);
  const publicQueuePromotionTimersRef = useRef<number[]>([]);
  const publicQueuePromotionSignatureRef = useRef("");
  const publicQueuePromotionRunningRef = useRef(false);
  const pendingRawTaskRef = useRef<TaskFromAPI | null>(null);
  const assistantActionPendingRef = useRef<Set<string>>(new Set());
  const recentTaskPatchesRef = useRef<Map<string, { task: TaskFromAPI; appliedAt: number }>>(new Map());
  const recentHiddenTaskUntilRef = useRef<Map<string, { profileId: string; hiddenUntil: number }>>(new Map());
  const taskListRawRef = useRef<TaskFromAPI[]>([]);
  const assistantRawTasksRef = useRef<TaskFromAPI[]>([]);
  const publicQueueRawRef = useRef<TaskFromAPI[]>([]);
  const workbenchSyncTokenRef = useRef<string | null>(null);
  const workbenchLastFullSyncAtRef = useRef(0);
  const pollingProfileId = profile?.id ?? null;
  const pollingProfileRole = profile?.role ?? null;
  const pollingProfileBuildingId = profile?.buildingId ?? null;
  const pollingProfile = useMemo(
    () => {
      if (!pollingProfileId || !pollingProfileRole || pollingProfileBuildingId == null) return null;
      return { id: pollingProfileId, role: pollingProfileRole, buildingId: pollingProfileBuildingId };
    },
    [pollingProfileId, pollingProfileRole, pollingProfileBuildingId]
  );
  useEffect(() => {
    pendingRawTaskRef.current = pendingRawTask;
  }, [pendingRawTask]);
  useEffect(() => {
    taskListRawRef.current = taskListRaw;
  }, [taskListRaw]);
  useEffect(() => {
    assistantRawTasksRef.current = assistantRawTasks;
  }, [assistantRawTasks]);
  useEffect(() => {
    publicQueueRawRef.current = publicQueueRaw;
  }, [publicQueueRaw]);
  const beginWorkbenchPendingAction = useCallback((actionKey: string): boolean => {
    if (assistantActionPendingRef.current.has(actionKey)) return false;
    assistantActionPendingRef.current.add(actionKey);
    setWorkbenchPendingActionKeys((prev) => prev.includes(actionKey) ? prev : [...prev, actionKey]);
    return true;
  }, []);
  const endWorkbenchPendingAction = useCallback((actionKey: string) => {
    assistantActionPendingRef.current.delete(actionKey);
    setWorkbenchPendingActionKeys((prev) => prev.filter((key) => key !== actionKey));
  }, []);
  const isWorkbenchPendingAction = useCallback((actionKey: string) => (
    workbenchPendingActionKeys.includes(actionKey)
  ), [workbenchPendingActionKeys]);
  const assistantDockById = useMemo(
    () => new Map(assistants.map((assistant) => [assistant.id, assistant])),
    [assistants],
  );

  const quickBookBuildingId = profile && !isAssistantRole(profile.role)
    ? photographerWorkbenchBuildingId ?? profile.buildingId
    : activeBuildingId;
  const quickBookAreaAssistants = useMemo(
    () => {
      const source = quickBookBuildingId != null
        ? allProfiles
          .filter((p) => isAssistantRole(p.role) && (p.activeBuildingId ?? p.buildingId) === quickBookBuildingId)
          .map((p) => assistantDockById.get(p.id) ?? profileToQuickBookAssistant(p))
        : assistants;
      return [...source].sort((a, b) => {
      const aSelectable = canSpecifyQuickBookAssistant(a) ? 0 : 1;
      const bSelectable = canSpecifyQuickBookAssistant(b) ? 0 : 1;
      return aSelectable - bSelectable || a.name.localeCompare(b.name);
      });
    },
    [allProfiles, assistantDockById, assistants, quickBookBuildingId],
  );
  const quickBookOnlineAssistants = useMemo(
    () => quickBookAreaAssistants.filter((assistant) => assistant.onlineStatus === "online"),
    [quickBookAreaAssistants],
  );
  const selectedQuickBookAssistant = useMemo(
    () => quickBookAreaAssistants.find((assistant) => assistant.id === specifiedQuickBookAssistantId) ?? null,
    [quickBookAreaAssistants, specifiedQuickBookAssistantId],
  );
  const selectedQuickBookAssistantCanSubmit =
    !!selectedQuickBookAssistant && canSpecifyQuickBookAssistant(selectedQuickBookAssistant);

  useEffect(() => {
    setSpecifiedQuickBookAssistantId(null);
    setQuickBookAssistantPickerOpen(false);
    setMobileQuickBookAssistantPickerOpen(false);
  }, [quickBookBuildingId]);

  useEffect(() => {
    if (!specifiedQuickBookAssistantId || quickBookAreaAssistants.length === 0) return;
    if (!quickBookAreaAssistants.some((assistant) => assistant.id === specifiedQuickBookAssistantId)) {
      setSpecifiedQuickBookAssistantId(null);
      setQuickBookAssistantPickerOpen(false);
      setMobileQuickBookAssistantPickerOpen(false);
    }
  }, [quickBookAreaAssistants, specifiedQuickBookAssistantId]);

  useEffect(() => {
    if (!quickBookAssistantPickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && quickBookAssistantPickerRef.current?.contains(target)) return;
      setQuickBookAssistantPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [quickBookAssistantPickerOpen]);

  useEffect(() => {
    if (!assistantRankingHelpOpen) return;
    const closeHelp = () => setAssistantRankingHelpOpen(null);
    document.addEventListener("pointerdown", closeHelp);
    return () => document.removeEventListener("pointerdown", closeHelp);
  }, [assistantRankingHelpOpen]);

  useEffect(() => {
    if (ironingQueueMode !== "fixed" || !ironingQueueFixedOpen) return;
    const closeIroningQueue = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ironingQueueRef.current?.contains(target)) return;
      setIroningQueueMode("auto");
      setIroningQueueFixedOpen(false);
      setIroningQueueHoverOpen(false);
    };
    document.addEventListener("pointerdown", closeIroningQueue);
    return () => document.removeEventListener("pointerdown", closeIroningQueue);
  }, [ironingQueueFixedOpen, ironingQueueMode]);

  useEffect(() => () => {
    if (ironingQueueHoverCloseTimer.current) clearTimeout(ironingQueueHoverCloseTimer.current);
  }, []);

  const openIroningQueueHover = useCallback(() => {
    if (ironingQueueHoverCloseTimer.current) clearTimeout(ironingQueueHoverCloseTimer.current);
    if (ironingQueueMode === "auto") setIroningQueueHoverOpen(true);
  }, [ironingQueueMode]);

  const closeIroningQueueHoverSoon = useCallback(() => {
    if (ironingQueueHoverCloseTimer.current) clearTimeout(ironingQueueHoverCloseTimer.current);
    if (ironingQueueMode === "auto") {
      ironingQueueHoverCloseTimer.current = setTimeout(() => setIroningQueueHoverOpen(false), 900);
    }
  }, [ironingQueueMode]);

  const showAssistantScoreBubble = useCallback((assistantId: string, element: HTMLElement, detailCount = 0) => {
    const rect = element.getBoundingClientRect();
    const margin = 16;
    const gap = 1;
    const bubbleWidth = detailCount > 7 ? Math.min(560, window.innerWidth - margin * 2) : 300;
    const detailColumns = detailCount > 7 ? 2 : 1;
    const detailRows = Math.max(1, Math.ceil(Math.max(detailCount, 1) / detailColumns));
    const estimatedHeight = 82 + detailRows * 46;
    const maxTop = Math.max(margin, window.innerHeight - margin);
    const preferredLeft = rect.left - bubbleWidth - gap;
    const fallbackLeft = rect.right - bubbleWidth;
    const rawLeft = preferredLeft >= margin ? preferredLeft : fallbackLeft;
    const left = Math.min(Math.max(margin, rawLeft), Math.max(margin, window.innerWidth - bubbleWidth - margin));
    const hasRoomBelow = window.innerHeight - rect.bottom - margin >= estimatedHeight;
    const rawTop = hasRoomBelow ? rect.bottom + gap : rect.top - estimatedHeight - gap;
    const top = Math.min(Math.max(margin, rawTop), maxTop - 120);

    setExpandedAssistantScoreId(assistantId);
    setAssistantScoreBubbleAnchor({
      left,
      top,
      width: bubbleWidth,
    });
  }, []);

  const hideAssistantScoreBubble = useCallback(() => {
    setExpandedAssistantScoreId(null);
    setAssistantScoreBubbleAnchor(null);
  }, []);

  const renderAssistantScoreBubble = useCallback((row: AssistantRankingRow) => {
    if (!assistantScoreBubbleAnchor || typeof document === "undefined") return null;
    const useColumns = row.details.length > 7;
    return createPortal(
      <div
        className="fixed z-[9999] max-w-[calc(100vw-32px)]"
        style={{
          left: assistantScoreBubbleAnchor.left,
          top: assistantScoreBubbleAnchor.top,
          width: assistantScoreBubbleAnchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`rounded-2xl border px-3 py-2.5 text-left shadow-xl backdrop-blur-2xl ${
          resolvedTheme === "dark"
            ? "border-white/[0.12] bg-slate-950/70 text-slate-100 shadow-black/40"
            : "border-white/70 bg-white/66 text-slate-700 shadow-slate-300/60"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold text-[--text-primary]">综合分明细</span>
          </div>
          <div className={`my-2 h-px ${
            resolvedTheme === "dark" ? "bg-white/[0.12]" : "bg-slate-900/[0.10]"
          }`} />
          {row.details.length > 0 ? (
            <div className={useColumns ? "grid grid-cols-2 gap-x-4 gap-y-2" : "space-y-1.5"}>
              {row.details.map((detail, detailIndex) => (
                <div key={`${detail.taskId}-${detailIndex}`} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-[10px] font-extrabold leading-tight text-[--text-primary]">
                      {detailIndex + 1}. {detail.taskTitle}
                    </p>
                    <span className="shrink-0 text-[10px] font-extrabold text-orange-500">
                      {formatAssistantScore(detail.totalScore)}分
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-normal text-[9px] font-semibold leading-snug text-[--text-muted]">
                    服务 {fmtMin(detail.serviceSeconds / 60)}
                    {detail.scoreFactor !== 1 ? (
                      <span className="text-orange-500"> × {formatAssistantScore(detail.scoreFactor)}</span>
                    ) : null}
                    =
                    <span className="text-orange-500"> {formatAssistantScore(detail.serviceScore)}分</span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-[10px] font-semibold text-[--text-muted]">暂无可展开的任务明细</div>
          )}
          <div className={`my-2 h-px ${
            resolvedTheme === "dark" ? "bg-white/[0.12]" : "bg-slate-900/[0.10]"
          }`} />
          <div className="text-right text-[11px] font-extrabold text-[--text-primary]">
            合计：<span className="text-orange-500">{formatAssistantScore(row.score)}分</span>
          </div>
        </div>
      </div>,
      document.body,
    );
  }, [assistantScoreBubbleAnchor, resolvedTheme]);

  const showTaskTypeDetailBubble = useCallback((taskTypeName: string, element: HTMLElement, assistantCount = 0) => {
    const rect = element.getBoundingClientRect();
    const margin = 16;
    const gap = 6;
    const bubbleWidth = 190;
    const estimatedHeight = 58 + Math.max(1, assistantCount) * 34;
    const preferredLeft = rect.left - bubbleWidth - gap;
    const fallbackLeft = rect.right + gap;
    const rawLeft = preferredLeft >= margin ? preferredLeft : fallbackLeft;
    const left = Math.min(Math.max(margin, rawLeft), Math.max(margin, window.innerWidth - bubbleWidth - margin));
    const rawTop = rect.top + rect.height / 2 - estimatedHeight / 2;
    const top = Math.min(
      Math.max(margin, rawTop),
      Math.max(margin, window.innerHeight - Math.min(estimatedHeight, window.innerHeight - margin * 2) - margin),
    );

    setExpandedTaskTypeDetailName(taskTypeName);
    setTaskTypeDetailBubbleAnchor({ left, top, width: bubbleWidth });
  }, []);

  const hideTaskTypeDetailBubble = useCallback(() => {
    setExpandedTaskTypeDetailName(null);
    setTaskTypeDetailBubbleAnchor(null);
  }, []);

  const renderTaskTypeDetailBubble = useCallback((item: {
    name: string;
    count: number;
    assistants: { id: string; name: string; avatar: string | null; count: number }[];
  }) => {
    if (!taskTypeDetailBubbleAnchor || typeof document === "undefined") return null;
    return createPortal(
      <div
        className="fixed z-[9999] max-w-[calc(100vw-32px)]"
        style={{
          left: taskTypeDetailBubbleAnchor.left,
          top: taskTypeDetailBubbleAnchor.top,
          width: taskTypeDetailBubbleAnchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`rounded-2xl border px-3 py-2.5 text-left shadow-xl backdrop-blur-2xl ${
          resolvedTheme === "dark"
            ? "border-white/[0.12] bg-slate-950/72 text-slate-100 shadow-black/40"
            : "border-white/70 bg-white/68 text-slate-700 shadow-slate-300/60"
          }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-extrabold text-[--text-primary]">{item.name}完成助理</span>
          </div>
          {item.assistants.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {item.assistants.map((assistant) => (
                <div key={`${item.name}-${assistant.id}`} className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[9px] font-black text-white ring-1 ring-white/90">
                    {assistant.avatar ? (
                      <img src={assistant.avatar} alt={assistant.name} className="h-full w-full object-cover" />
                    ) : (
                      assistant.name.slice(0, 1)
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[--text-primary]">{assistant.name}</span>
                  <span className="shrink-0 text-[11px] font-extrabold text-orange-500">{assistant.count}单</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-[10px] font-semibold text-[--text-muted]">暂无完成助理</div>
          )}
        </div>
      </div>,
      document.body,
    );
  }, [resolvedTheme, taskTypeDetailBubbleAnchor]);

  const showAreaMetricBubble = useCallback((
    key: AreaMetricKey,
    element: HTMLElement,
    peopleCount = 0,
    anchorMode: "card" | "value" = "card",
  ) => {
    const metricValue = anchorMode === "value"
      ? element.querySelector<HTMLElement>("[data-area-metric-value]")
      : null;
    const elementRect = element.getBoundingClientRect();
    const rect = (metricValue ?? element).getBoundingClientRect();
    const margin = 16;
    const gap = anchorMode === "value" ? 10 : 8;
    const bubbleWidth = 224;
    const visibleRows = Math.max(1, peopleCount);
    const rowGap = 6;
    const estimatedHeight = 44 + visibleRows * 24 + Math.max(0, visibleRows - 1) * rowGap;
    const preferredLeft = rect.left + rect.width / 2 - bubbleWidth / 2;
    const left = Math.min(
      Math.max(margin, preferredLeft),
      Math.max(margin, window.innerWidth - bubbleWidth - margin),
    );
    const hasRoomBelow = window.innerHeight - rect.bottom - margin >= estimatedHeight;
    const rawTop = hasRoomBelow
      ? rect.bottom + gap
      : (anchorMode === "value" ? elementRect.top : rect.top) - estimatedHeight - gap;
    const top = Math.min(
      Math.max(margin, rawTop),
      Math.max(margin, window.innerHeight - Math.min(estimatedHeight, window.innerHeight - margin * 2) - margin),
    );

    setExpandedAreaMetricKey(key);
    setAreaMetricBubbleAnchor({ left, top, width: bubbleWidth });
  }, []);

  const hideAreaMetricBubble = useCallback(() => {
    setExpandedAreaMetricKey(null);
    setAreaMetricBubbleAnchor(null);
  }, []);

  const renderAreaMetricBubble = useCallback((item: {
    key: AreaMetricKey;
    caption: string;
    people: AreaMetricPerson[];
    unit: string;
    emptyText: string;
  }) => {
    if (!areaMetricBubbleAnchor || typeof document === "undefined") return null;
    const isAssistantView = isAssistantRole(profile?.role);
    const title = item.key === "offline"
      ? "离线助理"
      : item.key === "overtime"
        ? "超时明细"
        : item.key === "queue"
          ? `${item.caption}摄影师`
          : isAssistantView
            ? `${item.caption}助理`
            : `${item.caption}摄影师`;
    return createPortal(
      <div
        className="fixed z-[9999] max-w-[calc(100vw-32px)]"
        style={{
          left: areaMetricBubbleAnchor.left,
          top: areaMetricBubbleAnchor.top,
          width: areaMetricBubbleAnchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`rounded-2xl border px-3 py-2.5 text-left shadow-xl backdrop-blur-2xl ${
          resolvedTheme === "dark"
            ? "border-white/[0.12] bg-slate-950/72 text-slate-100 shadow-black/40"
            : "border-white/70 bg-white/68 text-slate-700 shadow-slate-300/60"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-extrabold text-[--text-primary]">{title}</span>
          </div>
          {item.people.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {item.people.map((person) => (
                <div
                  key={`${item.key}-${person.id}`}
                  className={item.key === "queue" || item.key === "executing"
                    ? "grid min-w-0 grid-cols-[24px_46px_minmax(0,1fr)_auto] items-center gap-x-1.5"
                    : "flex min-w-0 items-center gap-2"}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[9px] font-black text-white ring-1 ring-white/90">
                    {person.avatar ? (
                      <img src={person.avatar} alt={person.name} className="h-full w-full object-cover" />
                    ) : (
                      person.name.slice(0, 1)
                    )}
                  </span>
                  <span className={`min-w-0 truncate text-[11px] font-bold text-[--text-primary] ${item.key === "queue" || item.key === "executing" ? "" : "flex-1"}`}>
                    {person.name}
                  </span>
                  {(item.key === "queue" || item.key === "executing") && person.queueTaskTypes?.length ? (
                    <span className="flex min-w-0 items-center gap-1 pl-1.5">
                      <span className="h-3 w-px shrink-0 bg-slate-300/80" aria-hidden="true" />
                      {person.queueTaskTypes.map((type) => {
                        const fullType = type === "穿戴" ? "服装穿戴" : type === "手工" ? "手工DIY" : type;
                        const style = CAT_STYLES[fullType] ?? CAT_STYLES["其他"];
                        return (
                          <span
                            key={`${person.id}-${type}`}
                            className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${resolvedTheme === "dark" ? `${style.darkBg} ${style.darkText}` : `${style.bg} ${style.text}`}`}
                          >
                            {type}
                          </span>
                        );
                      })}
                    </span>
                  ) : null}
                  <span className={item.key === "queue" || item.key === "executing" ? "contents" : "contents"}>
                    {person.breakdown?.length ? (
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {person.breakdown.map((detail) => (
                          <span
                            key={`${item.key}-${person.id}-${detail.label}`}
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${
                              detail.label === "吃饭超时"
                                ? "bg-blue-500/12 text-blue-600"
                                : "bg-red-500/12 text-red-600"
                            }`}
                          >
                            {detail.label}{detail.count > 1 ? `${detail.count}${detail.unit}` : ""}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] font-extrabold text-orange-500">{person.count}{item.unit}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-[10px] font-semibold text-[--text-muted]">{item.emptyText}</div>
          )}
        </div>
      </div>,
      document.body,
    );
  }, [areaMetricBubbleAnchor, profile?.role, resolvedTheme]);

  useEffect(() => {
    if (!profile || !isAssistantRole(profile.role) || profile.subStatus !== ASSISTANT_EATING_SUB_STATUS) {
      setEatingStartedAt(null);
      return;
    }
    const key = assistantEatingStorageKey(profile.id);
    const profileEatingStartedAt = profile.eatingStartedAt ? new Date(profile.eatingStartedAt).getTime() : 0;
    const profileUpdatedAt = profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0;
    const stored = Number(safeLocalStorageGet(key));
    const startedAt = Number.isFinite(profileEatingStartedAt) && profileEatingStartedAt > 0
      ? profileEatingStartedAt
      : Number.isFinite(profileUpdatedAt) && profileUpdatedAt > 0
        ? profileUpdatedAt
      : Number.isFinite(stored) && stored > 0
        ? stored
        : Date.now();
    if (!stored || stored <= 0) {
      safeLocalStorageSet(key, String(startedAt));
    }
    setEatingStartedAt(startedAt);
  }, [profile?.id, profile?.role, profile?.subStatus, profile?.eatingStartedAt, profile?.updatedAt]);
  // 登录账号角色（区别于切换后的 profile.role）
  const [loginRole, setLoginRole] = useState<string | null>(null);

  const showTaskCreateError = useCallback((message: string, shake = false, tone: "error" | "info" | "success" | "transfer" = "error") => {
    setTaskCreateNoticeTone(tone);
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

  useEffect(() => {
    const urls = completionRegistrationFiles.map((file) => URL.createObjectURL(file));
    setCompletionRegistrationFilePreviewUrls(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [completionRegistrationFiles]);

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

  const applyTaskDataForProfile = useCallback((
    taskData: TaskFromAPI[],
    targetProfile: { id: string; role: string; buildingId: number },
    targetBuildingId = targetProfile.buildingId,
  ) => {
    const nowMs = Date.now();
    const visibleTaskData = taskData.filter((task) => {
      const hidden = recentHiddenTaskUntilRef.current.get(task.id);
      if (hidden == null) return true;
      if (hidden.hiddenUntil <= nowMs) {
        recentHiddenTaskUntilRef.current.delete(task.id);
        return true;
      }
      return hidden.profileId !== targetProfile.id;
    });
    const patchedIds = new Set<string>();
    const patchedTaskData = visibleTaskData.map((task) => {
      const patch = recentTaskPatchesRef.current.get(task.id);
      if (!patch) return task;
      if (nowMs - patch.appliedAt > RECENT_TASK_PATCH_TTL_MS) {
        recentTaskPatchesRef.current.delete(task.id);
        return task;
      }
      patchedIds.add(task.id);
      return { ...task, ...patch.task };
    });
    for (const [taskId, patch] of recentTaskPatchesRef.current) {
      if (nowMs - patch.appliedAt > RECENT_TASK_PATCH_TTL_MS) {
        recentTaskPatchesRef.current.delete(taskId);
        continue;
      }
      const hidden = recentHiddenTaskUntilRef.current.get(taskId);
      if (hidden != null && hidden.hiddenUntil > nowMs && hidden.profileId === targetProfile.id) continue;
      if (!patchedIds.has(taskId) && !patchedTaskData.some((task) => task.id === taskId)) {
        patchedTaskData.push(patch.task);
      }
    }

    const raw = visibleTasksForProfile(patchedTaskData, targetProfile, targetBuildingId);
    const assistantView = isAssistantRole(targetProfile.role);
    taskListRawRef.current = raw;
    setTaskListRaw(raw);
    setTasks(sortTasksByStatus(raw.map((t) => apiTaskToDisplay(t, assistantView ? targetProfile.id : undefined))));
    if (assistantView) {
      assistantRawTasksRef.current = raw;
      setAssistantRawTasks(raw);
      const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(raw, targetProfile.id);
      setCurrentRawTask(active);
      setPausedRawTask(paused);
      setPendingRawTask(pending);
      setDeferredWaitingRawTask(deferredWaiting);
    } else {
      assistantRawTasksRef.current = [];
      setAssistantRawTasks([]);
      setDeferredWaitingRawTask(null);
      setCurrentRawTask(null);
      setPausedRawTask(null);
      setPendingRawTask(null);
    }
  }, []);

  const updateLocalTaskSources = useCallback((
    taskId: string,
    updateRawTask: (task: TaskFromAPI) => TaskFromAPI,
    options?: {
      updateDisplay?: boolean | ((task: DisplayTask) => DisplayTask);
      updateWeekly?: boolean;
      updateAreaCompletedWeekly?: boolean;
    },
  ) => {
    const updateList = (list: TaskFromAPI[]): TaskFromAPI[] => {
      let changed = false;
      const next = list.map((task) => {
        if (task.id !== taskId) return task;
        changed = true;
        return updateRawTask(task);
      });
      return changed ? next : list;
    };
    const updateNullable = (task: TaskFromAPI | null): TaskFromAPI | null =>
      task?.id === taskId ? updateRawTask(task) : task;

    const nextTaskList = updateList(taskListRawRef.current);
    if (nextTaskList !== taskListRawRef.current) {
      taskListRawRef.current = nextTaskList;
      setTaskListRaw(nextTaskList);
    }

    const nextAssistantTasks = updateList(assistantRawTasksRef.current);
    if (nextAssistantTasks !== assistantRawTasksRef.current) {
      assistantRawTasksRef.current = nextAssistantTasks;
      setAssistantRawTasks(nextAssistantTasks);
    }

    const nextPublicQueue = updateList(publicQueueRawRef.current);
    if (nextPublicQueue !== publicQueueRawRef.current) {
      publicQueueRawRef.current = nextPublicQueue;
      setPublicQueueRaw(nextPublicQueue);
    }

    setCurrentRawTask((prev) => updateNullable(prev));
    setPausedRawTask((prev) => updateNullable(prev));
    setPendingRawTask((prev) => {
      const next = updateNullable(prev);
      pendingRawTaskRef.current = next;
      return next;
    });
    setDeferredWaitingRawTask((prev) => updateNullable(prev));

    if (options?.updateWeekly) {
      setWeeklyTasks((prev) => updateList(prev));
    }
    if (options?.updateAreaCompletedWeekly) {
      setAreaCompletedWeeklyTasks((prev) => updateList(prev));
    }

    if (options?.updateDisplay === true) {
      const assistantViewProfileId = isAssistantRole(profile?.role) ? profile?.id : undefined;
      setTasks(sortTasksByStatus(nextTaskList.map((task) => apiTaskToDisplay(task, assistantViewProfileId))));
    } else if (typeof options?.updateDisplay === "function") {
      const updateDisplayTask = options.updateDisplay;
      setTasks((prev) => prev.map((task) => task.id === taskId ? updateDisplayTask(task) : task));
    }
  }, [profile?.id, profile?.role]);

  const removeLocalTaskSources = useCallback((
    taskId: string,
    options?: {
      updateDisplay?: boolean;
      updatePublicQueue?: boolean;
    },
  ) => {
    const removeFromList = (list: TaskFromAPI[]) => {
      const next = list.filter((task) => task.id !== taskId);
      return next.length === list.length ? list : next;
    };

    const nextTaskList = removeFromList(taskListRawRef.current);
    if (nextTaskList !== taskListRawRef.current) {
      taskListRawRef.current = nextTaskList;
      setTaskListRaw(nextTaskList);
    }

    const nextAssistantTasks = removeFromList(assistantRawTasksRef.current);
    if (nextAssistantTasks !== assistantRawTasksRef.current) {
      assistantRawTasksRef.current = nextAssistantTasks;
      setAssistantRawTasks(nextAssistantTasks);
    }

    if (options?.updatePublicQueue) {
      const nextPublicQueue = removeFromList(publicQueueRawRef.current);
      if (nextPublicQueue !== publicQueueRawRef.current) {
        publicQueueRawRef.current = nextPublicQueue;
        setPublicQueueRaw(nextPublicQueue);
      }
    }

    const clearIfTarget = (task: TaskFromAPI | null) => task?.id === taskId ? null : task;
    setCurrentRawTask((prev) => clearIfTarget(prev));
    setPausedRawTask((prev) => clearIfTarget(prev));
    setPendingRawTask((prev) => {
      const next = clearIfTarget(prev);
      pendingRawTaskRef.current = next;
      return next;
    });
    setDeferredWaitingRawTask((prev) => clearIfTarget(prev));

    if (options?.updateDisplay) {
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    }
  }, []);

  const upsertLocalTaskSource = useCallback((
    task: TaskFromAPI,
    options?: {
      replaceDisplayId?: string;
      updatePublicQueue?: boolean;
    },
  ) => {
    const upsertList = (list: TaskFromAPI[]) => [
      ...list.filter((item) => item.id !== task.id),
      task,
    ];
    const nextTaskList = upsertList(taskListRawRef.current);
    taskListRawRef.current = nextTaskList;
    setTaskListRaw(nextTaskList);

    if (assistantRawTasksRef.current.some((item) => item.id === task.id)) {
      const nextAssistantTasks = upsertList(assistantRawTasksRef.current);
      assistantRawTasksRef.current = nextAssistantTasks;
      setAssistantRawTasks(nextAssistantTasks);
    }

    if (options?.updatePublicQueue) {
      const nextPublicQueue = upsertList(publicQueueRawRef.current);
      publicQueueRawRef.current = nextPublicQueue;
      setPublicQueueRaw(nextPublicQueue);
    }

    setTasks((prev) => {
      const display = apiTaskToDisplay(task, isAssistantRole(profile?.role) ? profile?.id : undefined);
      const replaceId = options?.replaceDisplayId ?? task.id;
      const withoutTask = prev.filter((item) => item.id !== task.id);
      const replaced = withoutTask.some((item) => item.id === replaceId)
        ? withoutTask.map((item) => item.id === replaceId ? display : item)
        : [display, ...withoutTask];
      return sortTasksByStatus(replaced);
    });
  }, [profile?.id, profile?.role]);

  const mergeAuthoritativeTaskForProfile = useCallback((
    updatedTask: TaskFromAPI,
    targetProfile = profile,
  ) => {
    if (!targetProfile) return;
    recentHiddenTaskUntilRef.current.delete(updatedTask.id);
    recentTaskPatchesRef.current.set(updatedTask.id, { task: updatedTask, appliedAt: Date.now() });
    const byId = new Map<string, TaskFromAPI>();
    for (const task of [...taskListRawRef.current, ...assistantRawTasksRef.current]) {
      byId.set(task.id, task);
    }
    const existing = byId.get(updatedTask.id);
    byId.set(updatedTask.id, existing ? { ...existing, ...updatedTask } : updatedTask);
    applyTaskDataForProfile([...byId.values()], targetProfile, activeBuildingId ?? targetProfile.buildingId);
  }, [activeBuildingId, applyTaskDataForProfile, profile]);

  const replaceVisibleTaskForProfile = useCallback((
    updatedTask: TaskFromAPI,
    keepTask: boolean,
    targetProfile: { id: string; role: string; buildingId: number },
  ) => {
    const nowMs = Date.now();
    if (keepTask) {
      recentHiddenTaskUntilRef.current.delete(updatedTask.id);
      recentTaskPatchesRef.current.set(updatedTask.id, { task: updatedTask, appliedAt: nowMs });
    } else {
      recentTaskPatchesRef.current.delete(updatedTask.id);
      recentHiddenTaskUntilRef.current.set(updatedTask.id, { profileId: targetProfile.id, hiddenUntil: nowMs + RECENT_TASK_PATCH_TTL_MS });
    }

    const replaceOrRemove = (list: TaskFromAPI[]): TaskFromAPI[] => {
      const withoutUpdated = list.filter((task) => task.id !== updatedTask.id);
      return keepTask ? [...withoutUpdated, updatedTask] : withoutUpdated;
    };

    const nextTaskList = replaceOrRemove(taskListRawRef.current);
    taskListRawRef.current = nextTaskList;
    setTaskListRaw(nextTaskList);
    setTasks(sortTasksByStatus(nextTaskList.map((task) => apiTaskToDisplay(task, isAssistantRole(targetProfile.role) ? targetProfile.id : undefined))));

    if (isAssistantRole(targetProfile.role)) {
      const assistantSource = assistantRawTasksRef.current.length > 0
        ? assistantRawTasksRef.current
        : taskListRawRef.current;
      const nextAssistantTasks = replaceOrRemove(assistantSource);
      assistantRawTasksRef.current = nextAssistantTasks;
      setAssistantRawTasks(nextAssistantTasks);
      const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(nextAssistantTasks, targetProfile.id);
      pendingRawTaskRef.current = pending;
      setCurrentRawTask(active);
      setPausedRawTask(paused);
      setPendingRawTask(pending);
      setDeferredWaitingRawTask(deferredWaiting);
    } else {
      assistantRawTasksRef.current = [];
      pendingRawTaskRef.current = null;
      setAssistantRawTasks([]);
      setCurrentRawTask(null);
      setPausedRawTask(null);
      setPendingRawTask(null);
      setDeferredWaitingRawTask(null);
    }
  }, []);

  const applyOptimisticAssistantTaskStatus = useCallback((task: TaskFromAPI, action: "start" | "complete") => {
    if (!profile || !isAssistantRole(profile.role)) return;
    const nowIso = new Date().toISOString();
    const nextStatus = action === "start" ? "executing" : "completed";
    const nextTask: TaskFromAPI = {
      ...task,
      assistantId: profile.id,
      assistant: task.assistant ?? { id: profile.id, name: profile.name, currentRoom: profile.currentRoom },
      status: nextStatus,
      startedAt: action === "start" ? task.startedAt ?? nowIso : task.startedAt,
      completedAt: action === "complete" ? nowIso : task.completedAt,
      pausedAt: null,
      workSegmentStartedAt: action === "start" ? nowIso : null,
      ironingStage: action === "start" && isIroningTask(task) ? "using" : task.ironingStage,
      collaborators: task.collaborators?.map((participant) =>
        participant.assistantId === profile.id
          ? {
            ...participant,
            status: nextStatus,
            startedAt: action === "start" ? participant.startedAt ?? nowIso : participant.startedAt,
            completedAt: action === "complete" ? nowIso : participant.completedAt,
            workSegmentStartedAt: action === "start" ? nowIso : null,
          }
          : participant
      ),
    };
    const mergeTask = (list: TaskFromAPI[]) => {
      const exists = list.some((item) => item.id === nextTask.id);
      return exists
        ? list.map((item) => item.id === nextTask.id ? { ...item, ...nextTask } : item)
        : [nextTask, ...list];
    };
    recentTaskPatchesRef.current.set(nextTask.id, { task: nextTask, appliedAt: Date.now() });
    const currentTaskList = taskListRawRef.current;
    const currentAssistantTasks = assistantRawTasksRef.current.length > 0
      ? assistantRawTasksRef.current
      : currentTaskList;
    const nextTaskList = mergeTask(currentTaskList);
    const nextAssistantTasks = mergeTask(currentAssistantTasks);
    taskListRawRef.current = nextTaskList;
    assistantRawTasksRef.current = nextAssistantTasks;
    setTaskListRaw(nextTaskList);
    setAssistantRawTasks(nextAssistantTasks);
    setTasks(sortTasksByStatus(nextTaskList.map((t) => apiTaskToDisplay(t, profile.id))));
    const { current: active, paused, pending, deferredWaiting } = resolveAssistantTasks(nextAssistantTasks, profile.id);
    setCurrentRawTask(active);
    setPausedRawTask(paused);
    setPendingRawTask(pending);
    setDeferredWaitingRawTask(deferredWaiting);
  }, [profile]);

  const applyWorkbenchProfile = useCallback((selected: typeof allProfiles[0]) => {
    originalRoomRef.current = selected.currentRoom;
    originalBuildingIdRef.current = selected.buildingId;
    const selectedServiceBuildingId = profileServiceBuildingId(selected);
    const selectedServiceRoom = profileServiceRoom(selected);
    const selectedForWorkbench = isAssistantRole(selected.role)
      ? {
        ...selected,
        buildingId: selectedServiceBuildingId,
        currentRoom: selectedServiceRoom,
      }
      : selected;
    setNeedsIdentitySelection(false);
    setShowIdentityModal(false);
    setProfile(selectedForWorkbench);
    setWorkbenchRoom(selectedServiceRoom);
    setActiveBuildingId(selectedServiceBuildingId);
    setPhotographerWorkbenchBuildingId(isAssistantRole(selectedForWorkbench.role) ? null : selectedServiceBuildingId);
    safeLocalStorageSet("currentProfileId", selectedForWorkbench.id);
    const url = new URL(window.location.href);
    if (url.searchParams.get("profileId") !== selectedForWorkbench.id || url.searchParams.has("employeeId")) {
      url.searchParams.set("profileId", selectedForWorkbench.id);
      url.searchParams.delete("employeeId");
      window.history.replaceState(null, "", url.toString());
    }
    if (isAssistantRole(selectedForWorkbench.role)) {
      refreshReassignmentNotices(selectedForWorkbench.id);
    } else {
      setReassignmentNotices([]);
    }
    fetch(taskListUrlForProfile(selectedForWorkbench))
      .then((r) => r.json())
      .then((taskData) => {
        if (Array.isArray(taskData)) {
          applyTaskDataForProfile(taskData as TaskFromAPI[], selectedForWorkbench, selectedServiceBuildingId);
        }
      })
      .catch(console.error);
  }, [applyTaskDataForProfile, refreshReassignmentNotices]);

  // Map pan & zoom state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInnerRef = useRef<HTMLDivElement>(null);
  const MAP_BASE_MIN_ZOOM = 1;
  const MAP_MAX_ZOOM = 5;
  const MAP_ZOOM_STEP = 0.15;

  // Legacy crop lock is disabled: map now switches between full overview and focused position views.
  const hasCrop = false;
  // Dynamic minimum zoom that covers the container fully (object-fit:cover style)
  const [mapCoverZoom, setMapCoverZoom] = useState(MAP_BASE_MIN_ZOOM);
  const [mapZoom, setMapZoom] = useState(MAP_BASE_MIN_ZOOM);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapViewportWidth, setMapViewportWidth] = useState(0);
  const [mapPanning, setMapPanning] = useState<{
    startX: number; startY: number; origPanX: number; origPanY: number;
  } | null>(null);
  const [mapTransformLive, setMapTransformLive] = useState(false);
  const mapZoomRef = useRef(mapZoom);
  const mapPanRef = useRef(mapPan);
  const mapCoverZoomRef = useRef(mapCoverZoom);
  const mapTransformLiveRef = useRef(false);
  const mapTransformFrameRef = useRef<number | null>(null);
  const mapWheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapUserInteractedRef = useRef(false);
  const mapAutoViewKeyRef = useRef("");
  const mapMarkerViewportScale = useMemo(
    () => Math.max(0.72, Math.min(1, (mapViewportWidth || 1180) / 1180)),
    [mapViewportWidth],
  );
  const mapLabelViewportScale = useMemo(
    () => Math.max(0.9, Math.min(1, (mapViewportWidth || 1180) / 1180)),
    [mapViewportWidth],
  );
  const mapMarkerInverseScale = mapMarkerInverseScaleForZoom(mapZoom);
  const mapMarkerSizePx = Math.round((30 * mapMarkerViewportScale) * 10) / 10;
  const mapSlotGapPx = Math.round((24 * mapMarkerViewportScale) * 10) / 10;
  const mapAreaLabelFontPx = Math.round((13 * mapLabelViewportScale) * 10) / 10;
  const mapAreaLabelPadXPx = Math.round((10 * mapLabelViewportScale) * 10) / 10;
  const mapAreaLabelPadYPx = Math.round((5 * mapLabelViewportScale) * 10) / 10;
  const applyMapTransformNow = useCallback((zoom: number, pan: { x: number; y: number }) => {
    const container = mapContainerRef.current;
    if (container) {
      container.style.setProperty("--map-zoom", String(zoom));
      container.style.setProperty("--map-marker-inverse-scale", String(mapMarkerInverseScaleForZoom(zoom)));
    }
    if (mapInnerRef.current) {
      mapInnerRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    }
  }, []);
  const queueMapTransform = useCallback((zoom: number, pan: { x: number; y: number }) => {
    mapZoomRef.current = zoom;
    mapPanRef.current = pan;
    if (mapTransformFrameRef.current != null) return;
    mapTransformFrameRef.current = window.requestAnimationFrame(() => {
      mapTransformFrameRef.current = null;
      applyMapTransformNow(mapZoomRef.current, mapPanRef.current);
    });
  }, [applyMapTransformNow]);
  const commitMapViewState = useCallback(() => {
    const nextZoom = mapZoomRef.current;
    const nextPan = mapPanRef.current;
    setMapZoom((prev) => (prev === nextZoom ? prev : nextZoom));
    setMapPan((prev) => (prev.x === nextPan.x && prev.y === nextPan.y ? prev : { ...nextPan }));
  }, []);
  const setCommittedMapView = useCallback((zoom: number, pan: { x: number; y: number }) => {
    mapZoomRef.current = zoom;
    mapPanRef.current = pan;
    applyMapTransformNow(zoom, pan);
    setMapZoom(zoom);
    setMapPan(pan);
  }, [applyMapTransformNow]);
  const beginMapTransformLive = useCallback(() => {
    if (mapTransformLiveRef.current) return;
    mapTransformLiveRef.current = true;
    setMapTransformLive(true);
  }, []);
  const endMapTransformLive = useCallback(() => {
    if (!mapTransformLiveRef.current) return;
    mapTransformLiveRef.current = false;
    setMapTransformLive(false);
  }, []);
  const scheduleMapViewCommit = useCallback((delayMs = 90) => {
    if (mapWheelCommitTimerRef.current) clearTimeout(mapWheelCommitTimerRef.current);
    mapWheelCommitTimerRef.current = setTimeout(() => {
      mapWheelCommitTimerRef.current = null;
      commitMapViewState();
      endMapTransformLive();
    }, delayMs);
  }, [commitMapViewState, endMapTransformLive]);
  useLayoutEffect(() => {
    applyMapTransformNow(mapZoomRef.current, mapPanRef.current);
  });
  useEffect(() => {
    mapCoverZoomRef.current = mapCoverZoom;
  }, [mapCoverZoom]);
  useEffect(() => {
    return () => {
      if (mapTransformFrameRef.current != null) window.cancelAnimationFrame(mapTransformFrameRef.current);
      if (mapWheelCommitTimerRef.current) clearTimeout(mapWheelCommitTimerRef.current);
    };
  }, []);
  const markMapUserInteracted = useCallback(() => {
    mapUserInteractedRef.current = true;
  }, []);
  const currentMapAssistant = useMemo(
    () => assistants.find((assistant) => assistant.id === profile?.id) ?? null,
    [assistants, profile?.id],
  );
  const profileCurrentWorkbenchRoom = isAssistantRole(profile?.role) && profile
    ? profileServiceRoom({
      role: profile.role,
      currentRoom: profile.currentRoom,
      activeRoom: profile.activeRoom,
    })
    : workbenchRoom ?? profile?.currentRoom ?? null;
  const mapFocusSignature = [
    profile?.id ?? "",
    profile?.role ?? "",
    profileCurrentWorkbenchRoom ?? "",
    profile?.activeRoom ?? "",
    activeBuildingId ?? "",
    profile?.activeBuildingId ?? "",
    currentMapAssistant?.currentRoom ?? "",
    currentMapAssistant?.pendingRoom ?? "",
    currentMapAssistant?.pausedRoom ?? "",
    currentMapAssistant?.preemptedWaitingRoom ?? "",
  ].join("|");

  const clampMapZoom = useCallback(
    (z: number) => Math.min(MAP_MAX_ZOOM, Math.max(mapCoverZoom, Math.round(z * 100) / 100)),
    [mapCoverZoom]
  );

  const targetMapHeightForMode = useCallback((mode: "global" | "focused") => {
    const container = mapContainerRef.current;
    const grid = container?.parentElement;
    if (!container || !grid) return undefined;
    if (mode === "global") return grid.clientHeight;
    return Math.max(0, (grid.clientHeight - 12) * 0.6);
  }, []);

  // Calculate cover zoom: minimum zoom so the image fills the container with no white edges
  const computeCoverZoom = useCallback((targetHeight?: number) => {
    const container = mapContainerRef.current;
    const inner = mapInnerRef.current;
    if (!container || !inner) return MAP_BASE_MIN_ZOOM;
    const img = inner.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return MAP_BASE_MIN_ZOOM;
    const cw = container.clientWidth;
    const ch = targetHeight ?? container.clientHeight;
    // At zoom=1 the image is w-full, so displayed size = cw x (cw * naturalH/naturalW)
    const displayedH = cw * (img.naturalHeight / img.naturalWidth);
    // Cover zoom = max ratio needed so both dimensions fill the container
    const cover = Math.max(1, ch / displayedH);
    return Math.round(cover * 100) / 100;
  }, []);

  const clampMapPan = useCallback(
    (px: number, py: number, z: number, targetHeight?: number) => {
      const container = mapContainerRef.current;
      const inner = mapInnerRef.current;
      if (!container || !inner) return { x: px, y: py };
      const cw = container.clientWidth;
      const ch = targetHeight ?? container.clientHeight;
      const iw = inner.scrollWidth * z;
      const ih = inner.scrollHeight * z;
      let x = px, y = py;
      if (iw <= cw) { x = (cw - iw) / 2; } else { x = Math.min(0, Math.max(cw - iw, x)); }
      if (ih <= ch) { y = (ch - ih) / 2; } else { y = Math.min(0, Math.max(ch - ih, y)); }
      return { x, y };
    },
    []
  );

  const computeCropLikeView = useCallback((crop: { cropX: number; cropY: number; cropW: number; cropH: number }, targetHeight?: number) => {
    const container = mapContainerRef.current;
    const inner = mapInnerRef.current;
    if (!container || !inner) return null;
    const img = inner.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;

    const cw = container.clientWidth;
    const ch = targetHeight ?? container.clientHeight;
    const imgW = inner.scrollWidth;
    const imgH = imgW * (img.naturalHeight / img.naturalWidth);
    const cropPxX = (crop.cropX / 100) * imgW;
    const cropPxY = (crop.cropY / 100) * imgH;
    const cropPxW = (crop.cropW / 100) * imgW;
    const cropPxH = (crop.cropH / 100) * imgH;
    if (cropPxW <= 0 || cropPxH <= 0) return null;

    const z = Math.round(Math.min(cw / cropPxW, ch / cropPxH, MAP_MAX_ZOOM) * 100) / 100;
    const pan = clampMapPan((cw - cropPxW * z) / 2 - cropPxX * z, (ch - cropPxH * z) / 2 - cropPxY * z, z, targetHeight);
    return { zoom: z, pan };
  }, [clampMapPan]);

  const computeGlobalMapView = useCallback((targetHeight?: number) => {
    const building = buildings.find((b) => b.id === activeBuildingId);
    const cropView =
      building?.cropX != null && building.cropY != null && building.cropW != null && building.cropH != null
        ? computeCropLikeView({
            cropX: Math.max(0, building.cropX - 1.5),
            cropY: Math.max(0, building.cropY - 1.5),
            cropW: Math.min(100, building.cropW + 3),
            cropH: Math.min(100, building.cropH + 3),
          }, targetHeight)
        : null;
    const z = cropView?.zoom ?? computeCoverZoom(targetHeight);
    return {
      coverZoom: z,
      zoom: z,
      pan: cropView?.pan ?? clampMapPan(0, 0, z, targetHeight),
    };
  }, [activeBuildingId, buildings, clampMapPan, computeCoverZoom, computeCropLikeView]);

  const resolveCurrentMapFocusPoint = useCallback(() => {
    if (!profile || !activeBuildingId) return null;
    const building = buildings.find((b) => b.id === activeBuildingId);
    if (!building) return null;

    const liveRoom = currentMapAssistant?.currentRoom
      ?? currentMapAssistant?.pendingRoom
      ?? currentMapAssistant?.pausedRoom
      ?? currentMapAssistant?.preemptedWaitingRoom
      ?? null;
    const serviceRoom = profileServiceRoom(profile);
    const target = liveRoom ?? serviceRoom;
    if (!target) return null;

    const normalizedRoom = target.endsWith("室") ? target.slice(0, -1) : target;
    const room = building.rooms.find((r) => r.roomNumber === target || r.roomNumber === normalizedRoom);
    if (room) {
      return {
        x: room.xPosition,
        y: room.yPosition,
        label: formatRoomOrVenue(room.roomNumber),
      };
    }

    const venue = safeExtraVenueEntries(building.extraVenues).find((item) => item.name === target || item.name === normalizedRoom);
    if (venue && typeof venue.x === "number" && typeof venue.y === "number") {
      return {
        x: venue.x,
        y: venue.y,
        label: venue.name,
      };
    }

    return null;
  }, [activeBuildingId, buildings, currentMapAssistant, profile]);

  const computeFocusedMapView = useCallback((targetHeight?: number) => {
    const container = mapContainerRef.current;
    const inner = mapInnerRef.current;
    const point = resolveCurrentMapFocusPoint();
    if (!container || !inner || !point) return null;
    const img = inner.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;

    const cw = container.clientWidth;
    const ch = targetHeight ?? container.clientHeight;
    const imgW = inner.scrollWidth;
    const imgH = imgW * (img.naturalHeight / img.naturalWidth);
    const coverZoom = computeCoverZoom(targetHeight);
    const focusZoom = Math.min(MAP_MAX_ZOOM, Math.max(coverZoom * 1.82, coverZoom + 0.9, 1.9));
    const z = Math.round(focusZoom * 100) / 100;
    const pointX = (point.x / 100) * imgW;
    const pointY = (point.y / 100) * imgH;
    const pan = clampMapPan(cw / 2 - pointX * z, ch / 2 - pointY * z, z, targetHeight);

    return {
      coverZoom,
      zoom: z,
      pan,
      label: point.label,
    };
  }, [clampMapPan, computeCoverZoom, resolveCurrentMapFocusPoint]);

  const applyMapViewMode = useCallback((mode: "global" | "focused", options?: { force?: boolean }) => {
    if (mapUserInteractedRef.current && !options?.force) return;
    const targetHeight = targetMapHeightForMode(mode);
    const view = mode === "focused"
      ? computeFocusedMapView(targetHeight) ?? computeGlobalMapView(targetHeight)
      : computeGlobalMapView(targetHeight);
    setMapCoverZoom(view.coverZoom);
    setCommittedMapView(view.zoom, view.pan);
  }, [computeFocusedMapView, computeGlobalMapView, setCommittedMapView, targetMapHeightForMode]);

  const resetMapView = useCallback(() => {
    mapUserInteractedRef.current = false;
    applyMapViewMode(areaDataPanelOpen ? "focused" : "global", { force: true });
  }, [applyMapViewMode, areaDataPanelOpen]);

  // Handle floor plan image load — recalculate cover zoom
  const handleFloorPlanLoad = resetMapView;

  // Recalculate cover zoom on window resize
  useEffect(() => {
    const onResize = () => {
      if (mapUserInteractedRef.current) {
        const z = computeCoverZoom();
        const nextZoom = Math.max(z, mapZoomRef.current);
        const nextPan = clampMapPan(mapPanRef.current.x, mapPanRef.current.y, nextZoom);
        setMapCoverZoom(z);
        setCommittedMapView(nextZoom, nextPan);
        return;
      }
      applyMapViewMode(areaDataPanelOpen ? "focused" : "global", { force: true });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyMapViewMode, areaDataPanelOpen, clampMapPan, computeCoverZoom, setCommittedMapView]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const updateSize = () => setMapViewportWidth(container.clientWidth);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Reset view when switching buildings
  useEffect(() => {
    setMapCoverZoom(MAP_BASE_MIN_ZOOM);
    setCommittedMapView(MAP_BASE_MIN_ZOOM, { x: 0, y: 0 });
  }, [activeBuildingId, setCommittedMapView]);

  // Switch between full-map and current-position focus when layout/data changes.
  useEffect(() => {
    const mode = areaDataPanelOpen ? "focused" : "global";
    const viewKey = `${activeBuildingId ?? "none"}:${mode}`;
    const viewModeChanged = mapAutoViewKeyRef.current !== viewKey;
    mapAutoViewKeyRef.current = viewKey;
    if (viewModeChanged) {
      mapUserInteractedRef.current = false;
    }
    if (mapUserInteractedRef.current) return;
    const frame = window.requestAnimationFrame(() => applyMapViewMode(mode, { force: viewModeChanged }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeBuildingId, areaDataPanelOpen, applyMapViewMode]);

  useEffect(() => {
    if (!areaDataPanelOpen || mapUserInteractedRef.current) return;
    const frame = window.requestAnimationFrame(() => applyMapViewMode("focused", { force: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [areaDataPanelOpen, applyMapViewMode, mapFocusSignature]);

  useEffect(() => {
    if (!showStatsModal || statsSelectedDay !== null) return;
    const dow = new Date().getDay();
    setStatsSelectedDay(dow === 0 ? 6 : dow - 1);
  }, [showStatsModal, statsSelectedDay]);

  useEffect(() => {
    if (!showAreaCompletedStatsModal || areaCompletedStatsSelectedDay !== null) return;
    const dow = new Date().getDay();
    setAreaCompletedStatsSelectedDay(dow === 0 ? 6 : dow - 1);
  }, [showAreaCompletedStatsModal, areaCompletedStatsSelectedDay]);

  // Fetch weekly tasks when stats modal opens or the viewed week changes
  useEffect(() => {
    if (!showStatsModal) return;
    const params = new URLSearchParams({ weekOnly: "true", weekOffset: String(statsWeekOffset) });
    if (profile?.role === "photographer") params.set("photographerId", profile.id);
    if (isAssistantRole(profile?.role)) params.set("assistantId", profile!.id);
    fetch(`/api/tasks?${params}`)
      .then((r) => r.json())
      .then((data: TaskFromAPI[]) => setWeeklyTasks(Array.isArray(data) ? data : []))
      .catch(() => setWeeklyTasks([]));
  }, [showStatsModal, profile, statsWeekOffset]);

  useEffect(() => {
    if (!showAreaCompletedStatsModal) return;
    const params = new URLSearchParams({ weekOnly: "true", weekOffset: String(areaCompletedStatsWeekOffset) });
    fetch(`/api/tasks?${params}`)
      .then((r) => r.json())
      .then((data: TaskFromAPI[]) => setAreaCompletedWeeklyTasks(Array.isArray(data) ? data : []))
      .catch(() => setAreaCompletedWeeklyTasks([]));
  }, [showAreaCompletedStatsModal, areaCompletedStatsWeekOffset]);

  // Fetch assistants + their active tasks for the active building
  const refreshAssistants = useCallback((snapshot?: { profiles?: unknown; tasks?: unknown; assistantStatus?: unknown }) => {
    if (!activeBuildingId) return;
    const source = snapshot
      ? Promise.resolve([snapshot.profiles, snapshot.tasks])
      : Promise.all([
        fetch(`/api/profiles?role=assistant&buildingId=${activeBuildingId}`, { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/tasks?todayOnly=true", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      ]);
    return source.then(async ([profilesData, tasksData]) => {
      const nowMs = Date.now();
      const profiles = Array.isArray(profilesData) ? profilesData : [];
      const allTasks: TaskFromAPI[] = Array.isArray(tasksData) ? tasksData : [];
      const assistantStatus = Array.isArray(snapshot?.assistantStatus)
        ? snapshot.assistantStatus as ({ id: string } & Partial<DockAssistant>)[]
        : null;
      if (profiles.length > 0) {
        const freshProfilesById = new Map(profiles.map((p) => [p.id, p]));
        setAllProfiles((prev) =>
          prev.map((item) => {
            const fresh = freshProfilesById.get(item.id);
            return fresh ? { ...item, ...fresh } : item;
          })
        );
        setProfile((prev) => {
          if (!prev) return prev;
          const fresh = freshProfilesById.get(prev.id);
          return fresh ? { ...prev, ...fresh } : prev;
        });
      }
      if (assistantStatus) {
        const statusById = new Map(
          assistantStatus
            .filter((row) => row && typeof row.id === "string")
            .map((row) => [row.id, row]),
        );
        type AssistantProfileForDock = DockAssistant & { activeRoom?: string | null };
        setAssistants((profiles as AssistantProfileForDock[]).map((p) => ({
          ...profileToQuickBookAssistant(p),
          ...statusById.get(p.id),
        })));
        return allTasks;
      }

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
        const eatingElapsedMin = p.subStatus === ASSISTANT_EATING_SUB_STATUS
          ? Math.max(0, Math.floor(eatingTotalElapsedSeconds(p.eatingStartedAt, p.eatingAccumulatedSeconds, nowMs) / 60))
          : null;
        const eatingOvertimeMin =
          eatingElapsedMin != null && eatingElapsedMin >= eatingOvertimeAlertMin
            ? eatingElapsedMin - eatingOvertimeAlertMin
            : null;
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
            eatingElapsedMin,
            eatingOvertimeMin,
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
        const plainWaitingTask = allTasks.find((t: typeof allTasks[0]) =>
          t.assistantId === p.id &&
          taskStatusForProfile(t, p.id) === "waiting" &&
          !isMapDeferredIroningWaitingTask(t)
        ) ?? null;

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
        } else if (plainWaitingTask) {
          // 仅有 waiting 任务（普通待就位）
          finalStatus = "assigned";
          currentRoom = plainWaitingTask.roomNumber;
          // 插单完成后，原任务从 paused 恢复为 waiting（通常仍保留 startedAt）
          // 这时地图应显示：正常饱和度头像 + 蓝色扩散脉冲外圈（代表等待就位）
          if (plainWaitingTask.startedAt) {
            resumingFromPause = true;
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
                : (executingTask || pausedTask || collaboratingTask || plainWaitingTask || null);
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
          eatingElapsedMin,
          eatingOvertimeMin,
        };
      }));
      return allTasks;
    }).catch((error) => {
      console.error(error);
      return null;
    });
  }, [activeBuildingId, eatingOvertimeAlertMin]);

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

  // 轻量轮询：由服务端集中节流维护，客户端只同步工作台快照
  useEffect(() => {
    if (!pollingProfile) return;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activeDelay = 3000;
    const hiddenDelay = 12000;
    const fullSyncIntervalMs = 60_000;
    workbenchSyncTokenRef.current = null;
    workbenchLastFullSyncAtRef.current = 0;
    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, delayMs);
    };
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const buildingId = activeBuildingId ?? pollingProfile.buildingId;
      const params = new URLSearchParams({
        profileId: pollingProfile.id,
        role: pollingProfile.role,
        buildingId: String(buildingId),
        view: isAssistantRole(pollingProfile.role)
          ? "assistant"
          : pollingProfile.role === "photographer"
            ? "photographer"
            : "building",
      });
      const lastSyncToken = workbenchSyncTokenRef.current;
      const shouldFullSync = !lastSyncToken || Date.now() - workbenchLastFullSyncAtRef.current >= fullSyncIntervalMs;
      if (shouldFullSync) {
        params.set("full", "1");
      } else {
        params.set("since", lastSyncToken);
      }
      let retryDelayMs: number | null = null;
      try {
        const response = await fetch(`/api/workbench/sync?${params.toString()}`, { cache: "no-store" });
        const syncData = await response.json().catch(() => null) as {
          profiles?: unknown;
          assistantStatus?: unknown;
          publicQueue?: unknown;
          tasks?: unknown;
          notices?: unknown;
          syncMode?: unknown;
          syncToken?: unknown;
          syncTruncated?: unknown;
          taskIds?: unknown;
          publicQueueIds?: unknown;
          nextPollMs?: number;
        } | null;
        if (cancelled || !response.ok || !syncData) return;

        const publicQueueData = Array.isArray(syncData.publicQueue) ? syncData.publicQueue as TaskFromAPI[] : [];
        const taskData = Array.isArray(syncData.tasks) ? syncData.tasks as TaskFromAPI[] : [];
        const noticeData = Array.isArray(syncData.notices) ? syncData.notices as StandbyReassignmentNoticeFromAPI[] : [];
        const serverSyncMode = syncData.syncMode === "delta" ? "delta" : "full";
        const taskIds = Array.isArray(syncData.taskIds)
          ? syncData.taskIds.filter((id): id is string => typeof id === "string")
          : null;
        const publicQueueIds = Array.isArray(syncData.publicQueueIds)
          ? syncData.publicQueueIds.filter((id): id is string => typeof id === "string")
          : null;
        const personalBase = isAssistantRole(pollingProfile.role) && assistantRawTasksRef.current.length > 0
          ? assistantRawTasksRef.current
          : taskListRawRef.current;
        const deltaNeedsFullRetry = serverSyncMode === "delta" && (
          syncData.syncTruncated === true ||
          !taskIds ||
          !publicQueueIds ||
          hasMissingVisibleTaskDetails(personalBase, taskData, taskIds) ||
          hasMissingVisibleTaskDetails(publicQueueRawRef.current, publicQueueData, publicQueueIds)
        );
        if (deltaNeedsFullRetry) {
          workbenchSyncTokenRef.current = null;
          workbenchLastFullSyncAtRef.current = 0;
          retryDelayMs = 0;
          return;
        }
        const mergedPublicQueue = mergeIncrementalTasks(
          publicQueueRawRef.current,
          publicQueueData,
          publicQueueIds,
          serverSyncMode,
        );
        const mergedTaskData = mergeIncrementalTasks(personalBase, taskData, taskIds, serverSyncMode);

        await refreshAssistants({
          profiles: syncData.profiles,
          assistantStatus: syncData.assistantStatus,
          tasks: mergedPublicQueue,
        });
        if (cancelled) return;
        const syncToken = typeof syncData.syncToken === "string" ? syncData.syncToken : null;
        if (syncToken) {
          workbenchSyncTokenRef.current = syncToken;
        } else {
          workbenchSyncTokenRef.current = null;
        }
        if (serverSyncMode === "full") {
          workbenchLastFullSyncAtRef.current = Date.now();
        }
        startTransition(() => {
          publicQueueRawRef.current = mergedPublicQueue;
          setPublicQueueRaw(mergedPublicQueue);
          setReassignmentNotices(isAssistantRole(pollingProfile.role) ? noticeData : []);
          applyTaskDataForProfile(mergedTaskData, pollingProfile, buildingId);
        });
      } catch (error) {
        console.error(error);
      } finally {
        inFlight = false;
        scheduleNext(retryDelayMs ?? (document.visibilityState === "visible" ? activeDelay : hiddenDelay));
      }
    };
    const onVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        timer = null;
        void poll();
      } else {
        scheduleNext(hiddenDelay);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // 首次立即执行一次，确保初始数据同步
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeBuildingId, applyTaskDataForProfile, pollingProfile, refreshAssistants]);

  // Map pan handlers
  const handleMapPanDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (hasCrop) return;
      e.preventDefault();
      markMapUserInteracted();
      beginMapTransformLive();
      const currentPan = mapPanRef.current;
      setMapPanning({
        startX: e.clientX, startY: e.clientY,
        origPanX: currentPan.x, origPanY: currentPan.y,
      });
    },
    [beginMapTransformLive, hasCrop, markMapUserInteracted]
  );

  useEffect(() => {
    if (!mapPanning) return;
    const handleMove = (e: MouseEvent) => {
      const currentZoom = mapZoomRef.current;
      const nextPan = clampMapPan(
        mapPanning.origPanX + e.clientX - mapPanning.startX,
        mapPanning.origPanY + e.clientY - mapPanning.startY,
        currentZoom
      );
      queueMapTransform(currentZoom, nextPan);
    };
    const handleUp = () => {
      commitMapViewState();
      endMapTransformLive();
      setMapPanning(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [mapPanning, clampMapPan, commitMapViewState, endMapTransformLive, queueMapTransform]);

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
      const currentPan = mapPanRef.current;
      const currentZoom = mapZoomRef.current;
      latestPan = currentPan;
      latestZoom = currentZoom;
      if (e.touches.length === 1) {
        markMapUserInteracted();
        beginMapTransformLive();
        const t = e.touches[0];
        touchRef.current = { startX: t.clientX, startY: t.clientY, origPanX: currentPan.x, origPanY: currentPan.y, dist: 0, origZoom: currentZoom };
      } else if (e.touches.length === 2) {
        e.preventDefault();
        markMapUserInteracted();
        beginMapTransformLive();
        const dist = getTouchDist(e.touches);
        touchRef.current = { startX: 0, startY: 0, origPanX: currentPan.x, origPanY: currentPan.y, dist, origZoom: currentZoom };
      }
    };

    let latestZoom = mapZoomRef.current;
    let latestPan = mapPanRef.current;

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
        queueMapTransform(latestZoom, newPan);
      } else if (e.touches.length === 2 && touchRef.current.dist > 0) {
        // Pinch zoom
        const newDist = getTouchDist(e.touches);
        const scale = newDist / touchRef.current.dist;
        const rawZoom = touchRef.current.origZoom * scale;
        const newZoom = Math.min(MAP_MAX_ZOOM, Math.max(mapCoverZoomRef.current, Math.round(rawZoom * 100) / 100));
        const center = getTouchCenter(e.touches, rect);
        const zoomScale = newZoom / latestZoom;
        const newPan = clampMapPan(
          center.x - zoomScale * (center.x - latestPan.x),
          center.y - zoomScale * (center.y - latestPan.y),
          newZoom
        );
        latestZoom = newZoom;
        latestPan = newPan;
        queueMapTransform(newZoom, newPan);
      }
    };

    const onTouchEnd = () => {
      touchRef.current = null;
      commitMapViewState();
      endMapTransformLive();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [beginMapTransformLive, clampMapPan, commitMapViewState, endMapTransformLive, hasCrop, markMapUserInteracted, queueMapTransform]);

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
      const oldZoom = mapZoomRef.current;
      const newZoom = clampMapZoom(oldZoom + (e.deltaY > 0 ? -MAP_ZOOM_STEP : MAP_ZOOM_STEP));
      if (newZoom === oldZoom) return;
      markMapUserInteracted();
      beginMapTransformLive();
      const scale = newZoom / oldZoom;
      const currentPan = mapPanRef.current;
      const nextPan = clampMapPan(mx - scale * (mx - currentPan.x), my - scale * (my - currentPan.y), newZoom);
      queueMapTransform(newZoom, nextPan);
      scheduleMapViewCommit();
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [beginMapTransformLive, clampMapZoom, clampMapPan, hasCrop, markMapUserInteracted, queueMapTransform, scheduleMapViewCommit]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIdentityUrlState(params.has("profileId") || params.has("employeeId") ? "present" : "absent");
  }, []);

  useEffect(() => {
    const saved = safeLocalStorageGet("themeMode") as ThemeMode | null;
    if (saved === "light" || saved === "dark" || saved === "auto") {
      setThemeMode(saved);
    }
  }, []);

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
    const timer = setInterval(tick, PAGE_NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [themeMode]);

  useEffect(() => {
    // 读取登录账号角色
    try {
      const loginUser = JSON.parse(safeLocalStorageGet("user") || "null");
      if (loginUser?.role) setLoginRole(loginUser.role);
    } catch {}
    // Fetch profiles, then pick current identity from URL or localStorage.
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllProfiles(data);
          const params = new URLSearchParams(window.location.search);
          const urlProfileId = params.get("profileId");
          const urlEmployeeId = params.get("employeeId")?.trim().toLowerCase();
          setIdentityUrlState(urlProfileId || urlEmployeeId ? "present" : "absent");
          const urlMatch = urlProfileId
            ? data.find((p: { id: string }) => p.id === urlProfileId)
            : urlEmployeeId
              ? data.find((p: { employeeId: string | null }) => p.employeeId?.toLowerCase() === urlEmployeeId)
              : null;
          const savedId = safeLocalStorageGet("currentProfileId");
          const match = savedId ? data.find((p: { id: string }) => p.id === savedId) : null;
          // fallback: 登录账号；没有身份时进入选择态，不默认选第一个用户。
          let loginMatch = null;
          try {
            const loginUser = JSON.parse(safeLocalStorageGet("user") || "null");
            if (loginUser?.id) loginMatch = data.find((p: { id: string }) => p.id === loginUser.id);
          } catch {}
          const selected = urlMatch || match || loginMatch;
          if (selected) {
            applyWorkbenchProfile(selected);
          } else {
            setNeedsIdentitySelection(true);
            setProfile(null);
            setTasks([]);
            setTaskListRaw([]);
            setAssistantRawTasks([]);
            setCurrentRawTask(null);
            setPausedRawTask(null);
            setPendingRawTask(null);
            setDeferredWaitingRawTask(null);
            setPhotographerWorkbenchBuildingId(null);
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
        setEatingOvertimeAlertMin(
          parseEatingOvertimeAlertMin(cfg?.[EATING_OVERTIME_ALERT_CONFIG_KEY]?.value)
        );
        setEatingReentryCooldownMin(
          parseEatingReentryCooldownMin(cfg?.[EATING_REENTRY_COOLDOWN_CONFIG_KEY]?.value)
        );
        setWorkbenchPageBackground(String(cfg?.[WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]?.value ?? ""));
        setPhotographerMaxActiveTasks(
          parsePhotographerMaxActiveTasks(cfg?.[PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY]?.value)
        );
        setPriorityUpgradeConfig(cfg && typeof cfg === "object" ? cfg : {});
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
  }, [applyWorkbenchProfile]);

  useEffect(() => {
    if (profile || allProfiles.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const urlProfileId = params.get("profileId");
    const urlEmployeeId = params.get("employeeId")?.trim().toLowerCase();
    if (!urlProfileId && !urlEmployeeId) return;
    const selected = urlProfileId
      ? allProfiles.find((p) => p.id === urlProfileId)
      : allProfiles.find((p) => p.employeeId?.toLowerCase() === urlEmployeeId);
    if (!selected) return;
    applyWorkbenchProfile(selected);
    params.set("profileId", selected.id);
    params.delete("employeeId");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [allProfiles, applyWorkbenchProfile, profile]);

  const activeBuilding = buildings.find((b) => b.id === activeBuildingId) || null;
  const photographerWorkbenchBuilding = profile && !isAssistantRole(profile.role)
    ? buildings.find((b) => b.id === (photographerWorkbenchBuildingId ?? profile.buildingId)) ?? null
    : null;
  const taskPublishBuilding = photographerWorkbenchBuilding ?? activeBuilding;
  const taskPublishBuildingId = taskPublishBuilding?.id ?? (
    profile && !isAssistantRole(profile.role)
      ? photographerWorkbenchBuildingId ?? profile.buildingId
      : activeBuildingId
  ) ?? null;
  const mapBuildingOptions = useMemo(
    () => buildings.filter((building) => building.id !== activeBuildingId),
    [buildings, activeBuildingId],
  );

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

  const cancelMapBuildingMenuClose = useCallback(() => {
    if (mapBuildingMenuCloseTimer.current) {
      clearTimeout(mapBuildingMenuCloseTimer.current);
      mapBuildingMenuCloseTimer.current = null;
    }
  }, []);

  const openMapBuildingMenu = useCallback(() => {
    cancelMapBuildingMenuClose();
    setShowMapBuildingMenu(true);
  }, [cancelMapBuildingMenuClose]);

  const closeMapBuildingMenuSoon = useCallback(() => {
    cancelMapBuildingMenuClose();
    mapBuildingMenuCloseTimer.current = setTimeout(() => {
      setShowMapBuildingMenu(false);
      mapBuildingMenuCloseTimer.current = null;
    }, 520);
  }, [cancelMapBuildingMenuClose]);

  useEffect(() => {
    return () => cancelMapBuildingMenuClose();
  }, [cancelMapBuildingMenuClose]);

  const cycleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const order: ThemeMode[] = ["light", "dark", "auto"];
      const next = order[(order.indexOf(prev) + 1) % 3];
      safeLocalStorageSet("themeMode", next);
      return next;
    });
  }, []);

  const switchVenue = useCallback(async (venue: string) => {
    if (!profile) return;
    setWorkbenchRoom(venue);
    setShowVenueMenu(false);
    setLocationMenu(null);
    cancelLocationMenuClose();
    if (!isAssistantRole(profile.role)) {
      return;
    }
    try {
      setProfile((p) => p ? { ...p, currentRoom: venue } : p);
      setAllProfiles((prev) => prev.map((p) => p.id === profile.id ? { ...p, activeRoom: venue } : p));
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeRoom: venue }),
      });
      if (res.ok) {
        const updated = await res.json();
        const updatedServiceRoom = updated.activeRoom ?? updated.currentRoom;
        setProfile((p) => p ? { ...p, currentRoom: updatedServiceRoom, activeRoom: updated.activeRoom } : p);
        setWorkbenchRoom(updatedServiceRoom);
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
    setWorkbenchRoom(nextVenue);
    setPhotographerWorkbenchBuildingId(bld.id);
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
    const nextVenue = null;
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
      const updatedServiceRoom = updated.activeRoom ?? null;
      setWorkbenchRoom(updatedServiceRoom);
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
        applyTaskDataForProfile(
          taskData as TaskFromAPI[],
          { ...profile, buildingId: updatedServiceBuildingId },
          updatedServiceBuildingId,
        );
      }
      refreshAssistants();
    } catch (err) {
      console.error("Failed to switch assistant building", err);
    }
  }, [applyTaskDataForProfile, buildings, currentRawTask?.status, profile, refreshAssistants]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    if (removingTaskId) return;
    if (profile?.role !== "photographer") {
      showTaskCreateError("只有任务发布摄影师可以取消未开始任务");
      return;
    }
    const actionKey = workbenchTaskActionKey("cancel", taskId, profile.id);
    if (!beginWorkbenchPendingAction(actionKey)) return;
    setRemovingTaskId(taskId);
    try {
      // 调用 API 删除任务
      if (!taskId.startsWith("temp-")) {
        const res = await fetch(`/api/tasks/${taskId}?actorProfileId=${encodeURIComponent(profile.id)}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: string } | null;
          showTaskCreateError(data?.error || "任务取消失败，请稍后重试");
          setRemovingTaskId(null);
          setHoveredTagId(null);
          endWorkbenchPendingAction(actionKey);
          return;
        }
        refreshAssistants();
      }
      setTimeout(() => {
        removeLocalTaskSources(taskId, { updateDisplay: true, updatePublicQueue: true });
        setRemovingTaskId(null);
        setHoveredTagId(null);
        endWorkbenchPendingAction(actionKey);
      }, 450);
    } catch (error) {
      console.error("Failed to cancel task", error);
      showTaskCreateError("任务取消失败，请检查网络后重试");
      setRemovingTaskId(null);
      setHoveredTagId(null);
      endWorkbenchPendingAction(actionKey);
    }
  }, [beginWorkbenchPendingAction, endWorkbenchPendingAction, profile, removingTaskId, refreshAssistants, removeLocalTaskSources, showTaskCreateError]);

  const canCancelSpecifiedAssistant = useCallback((task: TaskFromAPI | null | undefined) => {
    if (!task || !task.isSpecified || !task.assistantId) return false;
    if (!profile || (profile.role !== "admin" && profile.role !== "photographer")) return false;
    if (profile.role === "photographer" && task.photographerId !== profile.id) return false;
    if (task.status !== "waiting" || task.startedAt != null) return false;
    const specifiedParticipant = taskParticipants(task).find((participant) => participant.assistantId === task.assistantId);
    return !specifiedParticipant?.startedAt &&
      specifiedParticipant?.status !== "executing" &&
      specifiedParticipant?.status !== "paused" &&
      specifiedParticipant?.status !== "completed";
  }, [profile]);

  const handleCancelSpecifiedAssistant = useCallback(async (task: TaskFromAPI) => {
    if (cancelingSpecifiedTaskId || !canCancelSpecifiedAssistant(task)) return;
    setCancelingSpecifiedTaskId(task.id);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelSpecifiedAssistant", actorProfileId: profile?.id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        showTaskCreateError(data?.error || "取消指定失败，请稍后重试");
        return;
      }
      const updated = await response.json() as TaskFromAPI | null;
      if (updated) {
        updateLocalTaskSources(updated.id, () => updated, { updateDisplay: true, updateWeekly: true });
      }
      setHoveredSpecifiedTaskId(null);
      refreshAssistants();
    } catch (error) {
      console.error("Failed to cancel specified assistant", error);
      showTaskCreateError("取消指定失败，请检查网络后重试");
    } finally {
      setCancelingSpecifiedTaskId(null);
    }
  }, [canCancelSpecifiedAssistant, cancelingSpecifiedTaskId, profile?.id, refreshAssistants, showTaskCreateError, updateLocalTaskSources]);

  const switchIdentity = useCallback((p: typeof allProfiles[0]) => {
    safeLocalStorageSet("currentProfileId", p.id);
    const url = new URL(window.location.href);
    url.searchParams.set("profileId", p.id);
    url.searchParams.delete("employeeId");
    window.history.replaceState(null, "", url.toString());
    setShowIdentityModal(false);
    window.location.reload();
  }, []);

  const showEatingReentryHint = useCallback((profileId: string, untilIso: string) => {
    setEatingReentryHintUntilByProfileId((prev) => ({
      ...prev,
      [profileId]: untilIso,
    }));
    if (eatingReentryHintTimerRef.current) clearTimeout(eatingReentryHintTimerRef.current);
    eatingReentryHintTimerRef.current = setTimeout(() => {
      setEatingReentryHintUntilByProfileId((prev) => {
        const { [profileId]: _removed, ...rest } = prev;
        return rest;
      });
    }, 2600);
  }, []);

  const updateAssistantPresenceStatus = useCallback(async (
    profileId: string,
    nextState: AssistantPresenceState,
    options?: { eatingExitMode?: "pause" | "end"; skipActiveTaskConfirm?: boolean }
  ) => {
    const previousPresenceProfile = allProfiles.find((p) => p.id === profileId) ?? (profile?.id === profileId ? profile : null);
    const isSelfPresenceChange = profile?.id === profileId;
    if (!isSelfPresenceChange) {
      const statusLabel: Record<string, string> = {
        assigned: "待就位",
        busy: "在忙",
        executing: "进行中",
        finishing: "快结束",
      };
      const currentStatus = previousPresenceProfile?.status;
      const reason = currentStatus && currentStatus !== "idle"
        ? `该助理当前处于「${statusLabel[currentStatus] || currentStatus}」状态，`
        : "";
      showTaskCreateError(`${reason}请切换到该助理身份后再变更在线状态`);
      refreshAssistants();
      return;
    }
    const previousWasEating = previousPresenceProfile?.subStatus === ASSISTANT_EATING_SUB_STATUS;
    if (nextState === "eating" && previousPresenceProfile && !previousWasEating) {
      const remainingMs = eatingReentryRemainingMs(previousPresenceProfile.eatingEndedAt, new Date(), eatingReentryCooldownMin);
      if (remainingMs > 0) {
        showEatingReentryHint(profileId, new Date(Date.now() + remainingMs).toISOString());
        return;
      }
    }

    if (isSelfPresenceChange && nextState !== "online") {
      let targetCurrentTask: TaskFromAPI | null = profile?.id === profileId ? currentRawTask : null;
      let targetRawTasks: TaskFromAPI[] | null = null;
      if (!targetCurrentTask) {
        try {
          const taskRes = await fetch(`/api/tasks?assistantId=${profileId}&todayOnly=true`, { cache: "no-store" });
          const taskData = await taskRes.json();
          if (Array.isArray(taskData)) {
            targetRawTasks = taskData as TaskFromAPI[];
            targetCurrentTask = resolveAssistantTasks(targetRawTasks, profileId).current;
          }
        } catch (err) {
          console.error("切换状态前读取目标助理任务失败", err);
        }
      }
      const status = targetCurrentTask
        ? taskStatusForProfile(targetCurrentTask, profileId) ?? targetCurrentTask.status
        : null;
      if (targetCurrentTask && status === "executing") {
        if (!options?.skipActiveTaskConfirm) {
          setPresenceSwitchConfirm({
            profileId,
            nextState,
            eatingExitMode: options?.eatingExitMode,
            taskLabel: `${targetCurrentTask.roomNumber}室 · ${targetCurrentTask.category?.name ?? "当前任务"}`,
          });
          return;
        }
        const pauseRes = await fetch(`/api/tasks/${targetCurrentTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause", actorAssistantId: profileId }),
        });
        if (!pauseRes.ok) {
          console.error("切换状态前暂停任务失败", pauseRes.status, await pauseRes.text().catch(() => ""));
          return;
        }
	      if (profile?.id === profileId) {
          const taskRes = await fetch(`/api/tasks?assistantId=${profileId}&todayOnly=true`, { cache: "no-store" });
          const taskData = await taskRes.json();
          if (Array.isArray(taskData)) {
            applyTaskDataForProfile(taskData as TaskFromAPI[], profile, activeBuildingId ?? profile.buildingId);
          }
        } else if (targetRawTasks) {
          refreshAssistants();
        }
      }
    }

    const nextOnlineStatus = nextState === "on_break" ? "on_break" : "online";
    const nextSubStatus = nextState === "eating" ? ASSISTANT_EATING_SUB_STATUS : null;
    const leavingEatingExitMode =
      previousWasEating && nextState !== "eating"
        ? options?.eatingExitMode ?? (nextState === "online" ? "pause" : "end")
        : undefined;
    const patchBody = {
      onlineStatus: nextOnlineStatus,
      subStatus: nextSubStatus,
      ...(leavingEatingExitMode ? { eatingExitMode: leavingEatingExitMode } : {}),
    };
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const nextEatingAccumulatedSeconds =
      previousWasEating && nextState !== "eating"
        ? eatingTotalElapsedSeconds(
          previousPresenceProfile?.eatingStartedAt,
          previousPresenceProfile?.eatingAccumulatedSeconds,
          startedAt
        )
        : previousPresenceProfile?.eatingAccumulatedSeconds ?? 0;
    const enteringNewMealAfterEnded = nextState === "eating" && !previousWasEating && !!previousPresenceProfile?.eatingEndedAt;
    const nextEatingPausedAt =
      previousWasEating && nextState !== "eating"
        ? leavingEatingExitMode === "pause"
          ? startedAtIso
          : null
        : nextState === "eating"
          ? null
          : previousPresenceProfile?.eatingPausedAt ?? null;

    const key = assistantEatingStorageKey(profileId);
    if (nextState === "eating") {
      const existingStartedAt = previousWasEating && previousPresenceProfile?.eatingStartedAt
        ? new Date(previousPresenceProfile.eatingStartedAt).getTime()
        : Number(safeLocalStorageGet(key));
      const nextStartedAt = Number.isFinite(existingStartedAt) && existingStartedAt > 0 ? existingStartedAt : startedAt;
      safeLocalStorageSet(key, String(nextStartedAt));
      setEatingStartedAt(nextStartedAt);
    } else {
      safeLocalStorageRemove(key);
      if (profile?.id === profileId) setEatingStartedAt(null);
    }

    setAllProfiles((prev) => prev.map((p) => p.id === profileId ? {
	      ...p,
	      onlineStatus: nextOnlineStatus,
	      subStatus: nextSubStatus,
	      updatedAt: startedAtIso,
	      eatingStartedAt: nextState === "eating" ? (previousWasEating ? p.eatingStartedAt ?? startedAtIso : startedAtIso) : (previousWasEating ? null : p.eatingStartedAt),
	      eatingPausedAt: nextEatingPausedAt,
	      eatingEndedAt: nextState === "eating" ? null : (previousWasEating && leavingEatingExitMode === "end" ? startedAtIso : p.eatingEndedAt),
	      eatingAccumulatedSeconds: previousWasEating && nextState !== "eating"
	        ? nextEatingAccumulatedSeconds
	        : enteringNewMealAfterEnded
	          ? 0
	          : p.eatingAccumulatedSeconds,
	    } : p));
    if (profile?.id === profileId) {
      setProfile((prev) => prev ? {
        ...prev,
        onlineStatus: nextOnlineStatus,
	        subStatus: nextSubStatus,
	        updatedAt: startedAtIso,
	        eatingStartedAt: nextState === "eating" ? (previousWasEating ? prev.eatingStartedAt ?? startedAtIso : startedAtIso) : (previousWasEating ? null : prev.eatingStartedAt),
	        eatingPausedAt: nextEatingPausedAt,
	        eatingEndedAt: nextState === "eating" ? null : (previousWasEating && leavingEatingExitMode === "end" ? startedAtIso : prev.eatingEndedAt),
	        eatingAccumulatedSeconds: previousWasEating && nextState !== "eating"
	          ? nextEatingAccumulatedSeconds
	          : enteringNewMealAfterEnded
	            ? 0
	            : prev.eatingAccumulatedSeconds,
	      } : prev);
    }
    try {
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { code?: string; error?: string; remainingMinutes?: number; canRetryAt?: string } | null;
        if (previousPresenceProfile) {
          setAllProfiles((prev) => prev.map((p) => p.id === profileId ? {
            ...p,
            onlineStatus: previousPresenceProfile.onlineStatus,
            subStatus: previousPresenceProfile.subStatus,
            updatedAt: previousPresenceProfile.updatedAt,
            eatingStartedAt: previousPresenceProfile.eatingStartedAt,
            eatingPausedAt: previousPresenceProfile.eatingPausedAt,
            eatingEndedAt: previousPresenceProfile.eatingEndedAt,
            eatingAccumulatedSeconds: previousPresenceProfile.eatingAccumulatedSeconds,
          } : p));
          if (profile?.id === profileId) {
            setProfile((prev) => prev ? {
              ...prev,
              onlineStatus: previousPresenceProfile.onlineStatus,
              subStatus: previousPresenceProfile.subStatus,
              updatedAt: previousPresenceProfile.updatedAt,
              eatingStartedAt: previousPresenceProfile.eatingStartedAt,
              eatingPausedAt: previousPresenceProfile.eatingPausedAt,
              eatingEndedAt: previousPresenceProfile.eatingEndedAt,
              eatingAccumulatedSeconds: previousPresenceProfile.eatingAccumulatedSeconds,
            } : prev);
          }
          if (previousWasEating) {
            const restoredStartedAt = previousPresenceProfile.eatingStartedAt
              ? new Date(previousPresenceProfile.eatingStartedAt).getTime()
              : previousPresenceProfile.updatedAt
                ? new Date(previousPresenceProfile.updatedAt).getTime()
                : Date.now();
            safeLocalStorageSet(key, String(restoredStartedAt));
            if (profile?.id === profileId) setEatingStartedAt(restoredStartedAt);
          } else {
            safeLocalStorageRemove(key);
            if (profile?.id === profileId) setEatingStartedAt(null);
          }
        }
        if (data?.code === "EATING_REENTRY_COOLDOWN") {
          const remainingMinutes = Math.max(1, Math.ceil(Number(data.remainingMinutes) || 1));
          showEatingReentryHint(
            profileId,
            data.canRetryAt || new Date(Date.now() + remainingMinutes * 60 * 1000).toISOString()
          );
          refreshAssistants();
          return;
        }
        showTaskCreateError(data?.error || "状态切换失败，请稍后重试");
        refreshAssistants();
        return;
      }
      const updated = await res.json();
      setAllProfiles((prev) => prev.map((p) => p.id === profileId ? {
        ...p,
        onlineStatus: updated.onlineStatus,
        subStatus: updated.subStatus,
        updatedAt: updated.updatedAt,
        eatingStartedAt: updated.eatingStartedAt,
        eatingPausedAt: updated.eatingPausedAt,
        eatingEndedAt: updated.eatingEndedAt,
        eatingAccumulatedSeconds: updated.eatingAccumulatedSeconds,
      } : p));
      if (profile?.id === profileId) {
        setProfile((prev) => prev ? {
          ...prev,
          onlineStatus: updated.onlineStatus,
          subStatus: updated.subStatus,
	          updatedAt: updated.updatedAt,
	          eatingStartedAt: updated.eatingStartedAt,
	          eatingPausedAt: updated.eatingPausedAt,
	          eatingEndedAt: updated.eatingEndedAt,
	          eatingAccumulatedSeconds: updated.eatingAccumulatedSeconds,
	        } : prev);
        if (updated.subStatus === ASSISTANT_EATING_SUB_STATUS && updated.eatingStartedAt) {
          const serverStartedAt = new Date(updated.eatingStartedAt).getTime();
          safeLocalStorageSet(key, String(serverStartedAt));
          setEatingStartedAt(serverStartedAt);
        } else {
          safeLocalStorageRemove(key);
          setEatingStartedAt(null);
        }
	        }
	      if (nextState === "eating") {
        setEatingReentryHintUntilByProfileId((prev) => {
          const { [profileId]: _removed, ...rest } = prev;
          return rest;
	        });
	      }
	      if (Number(updated.releasedAssignedTaskCount) > 0) {
	        showTaskCreateError("未开始任务已释放回队列，系统会重新派发给其他在线助理", false, "success");
	      }
	      refreshAssistants();
    } catch (e) {
      console.error("Failed to update assistant presence status", e);
      if (previousPresenceProfile) {
        setAllProfiles((prev) => prev.map((p) => p.id === profileId ? {
          ...p,
          onlineStatus: previousPresenceProfile.onlineStatus,
          subStatus: previousPresenceProfile.subStatus,
          updatedAt: previousPresenceProfile.updatedAt,
          eatingStartedAt: previousPresenceProfile.eatingStartedAt,
          eatingPausedAt: previousPresenceProfile.eatingPausedAt,
          eatingEndedAt: previousPresenceProfile.eatingEndedAt,
          eatingAccumulatedSeconds: previousPresenceProfile.eatingAccumulatedSeconds,
        } : p));
        if (profile?.id === profileId) {
          setProfile((prev) => prev ? {
            ...prev,
            onlineStatus: previousPresenceProfile.onlineStatus,
            subStatus: previousPresenceProfile.subStatus,
            updatedAt: previousPresenceProfile.updatedAt,
            eatingStartedAt: previousPresenceProfile.eatingStartedAt,
            eatingPausedAt: previousPresenceProfile.eatingPausedAt,
            eatingEndedAt: previousPresenceProfile.eatingEndedAt,
            eatingAccumulatedSeconds: previousPresenceProfile.eatingAccumulatedSeconds,
          } : prev);
        }
      }
      showTaskCreateError("状态切换失败，请检查网络后重试");
      refreshAssistants();
    }
  }, [allProfiles, currentRawTask, eatingReentryCooldownMin, profile, refreshAssistants, showEatingReentryHint, showTaskCreateError]);

  // 在切换身份面板中更新助理的所属楼座
  const updateAssistantBuilding = useCallback(async (profileId: string, newBuildingId: number) => {
    const bld = buildings.find((b) => b.id === newBuildingId);
    if (!bld) return;
    const nextVenue = null;
    // 乐观更新本地
    setAllProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, activeBuildingId: newBuildingId, activeRoom: nextVenue } : p));
    if (profile?.id === profileId) {
      setWorkbenchRoom(nextVenue);
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
    if (!profile) return;
    setNoteSaving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateNote",
          note,
          actorProfileId: profile.id,
          actorAssistantId: isAssistantRole(profile.role) ? profile.id : undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        showTaskCreateError(data?.error || "备注保存失败，请稍后重试");
        return;
      }
      const nextNote = note.trim() || null;
      updateLocalTaskSources(taskId, (task) => ({ ...task, note: nextNote }), { updateDisplay: true });
    } finally {
      setNoteSaving(false);
    }
  }, [noteTaskIsExecuting, profile, showTaskCreateError, updateLocalTaskSources]);

  const handlePublisherFeedback = useCallback(async (
    task: DisplayTask,
    feedback: TaskPublisherFeedback
  ) => {
    if (publisherFeedbackSavingId) return;
    if (!profile) return;
    const nextFeedback = task.publisherFeedback === feedback ? null : feedback;
    setPublisherFeedbackSavingId(task.id);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updatePublisherFeedback", feedback: nextFeedback, actorProfileId: profile.id }),
      });
      if (!response.ok) return;

      const updateRawFeedback = (item: TaskFromAPI): TaskFromAPI =>
        item.id === task.id ? { ...item, publisherFeedback: nextFeedback } : item;
      updateLocalTaskSources(task.id, updateRawFeedback, { updateDisplay: true, updateWeekly: true });
    } finally {
      setPublisherFeedbackSavingId(null);
    }
  }, [profile, publisherFeedbackSavingId, updateLocalTaskSources]);

  const pendingPriorityUpgradeForTask = useCallback((task: TaskFromAPI | null | undefined) => (
    task?.priorityUpgradeRequests?.find((request) => request.status === "pending") ?? null
  ), []);

  const canRequestPriorityUpgrade = useCallback((task: TaskFromAPI | null | undefined) => (
    !!task &&
    profile?.role === "photographer" &&
    task.photographerId === profile.id &&
    task.priority > 1 &&
    priorityUpgradeRequestRuleForBuilding(
      priorityUpgradeConfig,
      task.locationBuildingId ?? task.photographer?.buildingId
    ).enabled &&
    canPriorityRequestByConfig(
      task.priority,
      priorityUpgradeRequestRuleForBuilding(
        priorityUpgradeConfig,
        task.locationBuildingId ?? task.photographer?.buildingId
      ).minPriority
    ) &&
    task.status !== "executing" &&
    task.status !== "completed" &&
    !pendingPriorityUpgradeForTask(task)
  ), [pendingPriorityUpgradeForTask, priorityUpgradeConfig, profile?.id, profile?.role]);

  const openPriorityUpgradeModal = useCallback((task: TaskFromAPI) => {
    setPriorityUpgradeTask(task);
    setPriorityUpgradeSku("");
    setPriorityUpgradeReason("");
    setPriorityUpgradeError(null);
  }, []);

  const closePriorityUpgradeModal = useCallback(() => {
    if (priorityUpgradeSaving) return;
    setPriorityUpgradeTask(null);
    setPriorityUpgradeSku("");
    setPriorityUpgradeReason("");
    setPriorityUpgradeError(null);
  }, [priorityUpgradeSaving]);

  const handleSubmitPriorityUpgrade = useCallback(async () => {
    if (!profile || !priorityUpgradeTask || priorityUpgradeSaving) return;
    const sku = priorityUpgradeSku.trim();
    const reason = priorityUpgradeReason.trim();
    if (!sku) {
      setPriorityUpgradeError("请填写 SKU");
      return;
    }
    if (!reason) {
      setPriorityUpgradeError("请填写提权申请理由");
      return;
    }
    setPriorityUpgradeSaving(true);
    setPriorityUpgradeError(null);
    try {
      const response = await fetch(`/api/tasks/${priorityUpgradeTask.id}/priority-upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterId: profile.id, sku, reason }),
      });
      const data = await response.json().catch(() => null) as {
        id?: string;
        status?: "pending" | "approved" | "rejected";
        fromPriority?: number;
        targetPriority?: number;
        reason?: string;
        createdAt?: string;
        error?: string;
        code?: string;
      } | null;
      if (!response.ok || !data?.id) {
        const errorMessage =
          data?.code === "SKU_REQUIRED" ? "请填写 SKU" :
          data?.code === "PRIORITY_UPGRADE_DISABLED" ? "提权申请入口已关闭" :
          data?.code === "PRIORITY_UPGRADE_BUILDING_NOT_ALLOWED" ? "当前任务楼座不在提权开放范围内" :
          data?.error ?? "提权申请提交失败";
        throw new Error(errorMessage);
      }
      const pendingRequest = {
        id: data.id,
        status: data.status ?? "pending",
        fromPriority: data.fromPriority ?? priorityUpgradeTask.priority,
        targetPriority: data.targetPriority ?? 1,
        reason: data.reason ?? reason,
        createdAt: data.createdAt ?? new Date().toISOString(),
      };
      const markPending = (task: TaskFromAPI): TaskFromAPI =>
        task.id === priorityUpgradeTask.id
          ? { ...task, priorityUpgradeRequests: [pendingRequest] }
          : task;
      updateLocalTaskSources(priorityUpgradeTask.id, markPending, { updateDisplay: true, updateWeekly: true });
      setPriorityUpgradeTask(null);
      setPriorityUpgradeSku("");
      setPriorityUpgradeReason("");
    } catch (error) {
      setPriorityUpgradeError(error instanceof Error ? error.message : "提权申请提交失败");
    } finally {
      setPriorityUpgradeSaving(false);
    }
  }, [priorityUpgradeReason, priorityUpgradeSaving, priorityUpgradeSku, priorityUpgradeTask, profile, updateLocalTaskSources]);

  const openCompletionRegistrationModal = useCallback((task: TaskFromAPI) => {
    const registration = task.completionRegistration;
    setCompletionRegistrationTask(task);
    setCompletionRegistrationSku(registration?.sku ?? "");
    setCompletionRegistrationReasonType(
      COMPLETION_REGISTRATION_REASON_OPTIONS.includes(registration?.reasonType as CompletionRegistrationReasonType)
        ? registration?.reasonType as CompletionRegistrationReasonType
        : ""
    );
    setCompletionRegistrationDescription((registration?.description ?? "").slice(0, 100));
    setCompletionRegistrationExistingImages(completionRegistrationImageUrls(registration));
    setCompletionRegistrationFiles([]);
    setCompletionRegistrationError(null);
  }, []);

  const closeCompletionRegistrationModal = useCallback(() => {
    setCompletionRegistrationTask(null);
    setCompletionRegistrationSku("");
    setCompletionRegistrationReasonType("");
    setCompletionRegistrationDescription("");
    setCompletionRegistrationExistingImages([]);
    setCompletionRegistrationFiles([]);
    setCompletionRegistrationError(null);
  }, []);

  const applyCompletionRegistration = useCallback((taskId: string, registration: TaskCompletionRegistration) => {
    const updateTask = (task: TaskFromAPI): TaskFromAPI =>
      task.id === taskId ? { ...task, completionRegistration: registration } : task;
    updateLocalTaskSources(taskId, updateTask, {
      updateDisplay: true,
      updateWeekly: true,
      updateAreaCompletedWeekly: true,
    });
  }, [updateLocalTaskSources]);

  const handleCompletionRegistrationFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const nextFiles = Array.from(files);
    setCompletionRegistrationFiles((prev) => [...prev, ...nextFiles]);
    setCompletionRegistrationError(null);
  }, []);

  const handleSubmitCompletionRegistration = useCallback(async () => {
    if (!profile?.id || !completionRegistrationTask || completionRegistrationSaving) return;
    const sku = completionRegistrationSku.trim();
    if (!sku) {
      setCompletionRegistrationError("请填写 SKU");
      return;
    }
    if (!completionRegistrationReasonType) {
      setCompletionRegistrationError("请选择异常原因");
      return;
    }
    setCompletionRegistrationSaving(true);
    setCompletionRegistrationError(null);
    try {
      const formData = new FormData();
      formData.append("assistantId", profile.id);
      formData.append("sku", sku);
      formData.append("reasonType", completionRegistrationReasonType);
      formData.append("description", completionRegistrationDescription.trim());
      for (const imageUrl of completionRegistrationExistingImages) {
        formData.append("existingImageUrls", imageUrl);
      }
      for (const file of completionRegistrationFiles) {
        formData.append("images", file);
      }
      const response = await fetch(`/api/tasks/${completionRegistrationTask.id}/completion-registration`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null) as (TaskCompletionRegistration & { error?: string }) | null;
      if (!response.ok || !data?.id) {
        throw new Error(data?.error ?? "登记保存失败");
      }
      applyCompletionRegistration(completionRegistrationTask.id, data);
      closeCompletionRegistrationModal();
    } catch (error) {
      setCompletionRegistrationError(error instanceof Error ? error.message : "登记保存失败");
    } finally {
      setCompletionRegistrationSaving(false);
    }
  }, [
    applyCompletionRegistration,
    closeCompletionRegistrationModal,
    completionRegistrationDescription,
    completionRegistrationExistingImages,
    completionRegistrationFiles,
    completionRegistrationReasonType,
    completionRegistrationSaving,
    completionRegistrationSku,
    completionRegistrationTask,
    profile?.id,
  ]);

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
        applyTaskDataForProfile(taskData as TaskFromAPI[], profile, activeBuildingId ?? profile.buildingId);
      }
      refreshAssistants();
    } catch (error) {
      console.error("Failed to acknowledge reassignment notice", error);
    } finally {
      setReassignmentNoticeSavingId(null);
    }
  }, [activeBuildingId, applyTaskDataForProfile, profile, reassignmentNoticeSavingId, refreshAssistants]);

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
      updateLocalTaskSources(updated.id, () => updated, { updateDisplay: true });
      refreshAssistants();
      setCollabTaskId(null);
      setCollabSelectedIds([]);
      setCollabLimitWarning(false);
    } finally {
      setCollabSaving(false);
    }
  }, [collabSelectedIds, collabTaskId, collaborationEnabledByBuilding, collaborationMaxByBuilding, collaborationQueueAutoCloseLimit, profile?.id, profile?.role, publicQueueCountByBuilding, refreshAssistants, taskListRaw, updateLocalTaskSources]);

  // 助理：手动暂停当前任务（插单场景）
  const handlePauseCurrentTask = useCallback(async () => {
    if (!currentRawTask || !profile || manualPauseSlide) return;
    const task = currentRawTask;
    const actionKey = workbenchTaskActionKey("pause", task.id, profile.id);
    if (!beginWorkbenchPendingAction(actionKey)) return;
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
        applyTaskDataForProfile(taskData as TaskFromAPI[], profile, activeBuildingId ?? profile.buildingId);
      }
      refreshAssistants();
    } catch (e) {
      console.error("Failed to pause task", e);
      return;
    } finally {
      setManualPauseSlide(null);
      endWorkbenchPendingAction(actionKey);
    }
  }, [activeBuildingId, applyTaskDataForProfile, beginWorkbenchPendingAction, currentRawTask, endWorkbenchPendingAction, manualPauseSlide, profile, refreshAssistants]);

  // 助理：切换任务状态（targetTask 优先，避免界面展示任务与 currentRawTask 短暂不一致时点击无效）
  const handleAssistantStatusChange = useCallback(async (action: "start" | "complete", targetTask?: TaskFromAPI | null) => {
    const task = targetTask ?? currentRawTask;
    if (!task || !profile) return;
    const actionKey = workbenchTaskActionKey(action, task.id, profile.id);
    if (!beginWorkbenchPendingAction(actionKey)) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorAssistantId: profile.id }),
      });
      if (!res.ok) {
        const data = await res.clone().json().catch(() => null) as { code?: string; error?: string } | null;
        const errText = data?.error ?? await res.text().catch(() => "");
        console.error("任务状态更新失败", res.status, errText);
        if (action === "start") {
          showTaskCreateError(
            data?.code === "ironing_machine_busy"
              ? "当前区域熨烫机正在使用，请等待上一位助理完成后再开始"
              : data?.error || "任务开始失败，请稍后重试",
            true,
          );
        }
        return;
      }
      const updatedTask = await res.json().catch(() => null) as TaskFromAPI | null;
      if (profile) {
        let appliedFreshTasks = updatedTask?.id === task.id;
        if (updatedTask?.id === task.id) {
          mergeAuthoritativeTaskForProfile(updatedTask, profile);
        } else if (action !== "complete") {
          applyOptimisticAssistantTaskStatus(task, action);
        }
        try {
          const taskRes = await fetch(taskListUrlForProfile(profile), { cache: "no-store" });
          const taskData = await taskRes.json().catch(() => null);
          if (Array.isArray(taskData)) {
            applyTaskDataForProfile(taskData as TaskFromAPI[], profile, activeBuildingId ?? profile.buildingId);
            appliedFreshTasks = true;
          }
        } catch (refreshError) {
          console.error("Failed to refresh assistant tasks", refreshError);
        }
        if (action === "complete" && !appliedFreshTasks && updatedTask?.id !== task.id) {
          applyOptimisticAssistantTaskStatus(task, action);
        }
        refreshAssistants();
      }
    } catch (e) {
      console.error("Failed to update task status", e);
    } finally {
      endWorkbenchPendingAction(actionKey);
    }
  }, [activeBuildingId, applyOptimisticAssistantTaskStatus, applyTaskDataForProfile, beginWorkbenchPendingAction, currentRawTask, endWorkbenchPendingAction, mergeAuthoritativeTaskForProfile, profile, refreshAssistants, showTaskCreateError]);

  const handleResumePausedTask = useCallback(async (task: TaskFromAPI) => {
    if (manualPauseSlide || !profile) return;
    const actionKey = workbenchTaskActionKey("resume", task.id, profile.id);
    if (!beginWorkbenchPendingAction(actionKey)) return;
    try {
      setManualPauseSlide({ taskId: task.id, expanded: true });
      await nextAnimationFrame();
      setManualPauseSlide({ taskId: task.id, expanded: false });
      await wait(MANUAL_PAUSE_SLIDE_MS);
      await handleAssistantStatusChange("start", task);
    } finally {
      setManualPauseSlide(null);
      endWorkbenchPendingAction(actionKey);
    }
  }, [beginWorkbenchPendingAction, endWorkbenchPendingAction, handleAssistantStatusChange, manualPauseSlide, profile]);

  const handleBook = useCallback(
    (catName: string, dur: BuiltCategory["durations"][number], e: React.MouseEvent) => {
      if (genie) return;
      if (selectedQuickBookAssistant && !selectedQuickBookAssistantCanSubmit) {
        showTaskCreateError("指定助理当前暂不可接单，请重新选择");
        setQuickBookAssistantPickerOpen(true);
        return;
      }
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
        priorityOverride: dur.priorityOverride,
        quickBookSpecialType: dur.quickBookSpecialType,
        specifiedAssistantId: selectedQuickBookAssistant?.id ?? null,
        specifiedAssistantName: selectedQuickBookAssistant?.name ?? null,
        specifiedAssistantAvatar: selectedQuickBookAssistant?.avatar ?? null,
      });
    },
    [genie, selectedQuickBookAssistant, selectedQuickBookAssistantCanSubmit, showTaskCreateError],
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
        const room = profileCurrentWorkbenchRoom || defaultBuildingVenue(taskPublishBuilding);
        const locationBuildingId = taskPublishBuildingId;
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
            isSpecified: Boolean(genie.specifiedAssistantId),
            specifiedAssistantName: genie.specifiedAssistantName,
            assistantName: null,
            photographerName: profile?.name || null,
            createdAt: new Date().toISOString(),
            estEndTime: null,
            publisherFeedback: null,
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
                priority: genie.priorityOverride ?? parseInt(genie.priority.replace("P", "")),
                quickBookSpecialType: genie.quickBookSpecialType,
                assistantId: genie.specifiedAssistantId ?? undefined,
                isSpecified: Boolean(genie.specifiedAssistantId),
              }),
            });
            if (res.ok) {
              const saved = await res.json() as TaskFromAPI;
              upsertLocalTaskSource(saved, { replaceDisplayId: tempId });
              setSpecifiedQuickBookAssistantId(null);
              setQuickBookAssistantPickerOpen(false);
              setMobileQuickBookAssistantPickerOpen(false);
              if (isPhotographerLimitQueuedTask(saved)) {
                showTaskCreateError(photographerLimitQueuePrompt(photographerMaxActiveTasks), true);
              }
              refreshAssistants();
            } else {
              const data = await res.json().catch(() => null) as { code?: string; error?: string } | null;
              removeLocalTaskSources(tempId, { updateDisplay: true });
              showTaskCreateError(
                data?.error || "任务创建失败，请稍后重试",
                data?.code === "PHOTOGRAPHER_ACTIVE_TASK_LIMIT_REACHED" ||
                  data?.code === "PHOTOGRAPHER_LIMIT_QUEUE_FULL"
              );
            }
          } catch (e) {
            removeLocalTaskSources(tempId, { updateDisplay: true });
            showTaskCreateError("任务创建失败，请检查网络后重试");
            console.error("Failed to create task", e);
          }
        }
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [genie, photographerMaxActiveTasks, profile, profileCurrentWorkbenchRoom, refreshAssistants, removeLocalTaskSources, showTaskCreateError, taskPublishBuilding, taskPublishBuildingId, upsertLocalTaskSource]);

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
        !notice.oldAssistantAcknowledgedAt &&
        !dismissedReassignmentNoticeIds.includes(notice.id) &&
        (notice.oldAssistantSetOffline !== false || notice.reason === "assistant_swap_after_complete_ready")
      ) ?? null
    : null;
  const newReassignmentNotice = isAssistantRole(profile?.role)
    ? reassignmentNotices.find((notice) =>
        notice.newAssistantId === profile?.id &&
        !notice.newAssistantAcknowledgedAt &&
        !dismissedReassignmentNoticeIds.includes(notice.id)
      ) ?? null
    : null;
  const activeReassignmentNotice = oldReassignmentNotice ?? newReassignmentNotice;
  const activeReassignmentNoticeRole = activeReassignmentNotice
    ? activeReassignmentNotice.oldAssistantId === profile?.id
      ? "old"
      : "new"
    : null;
  const activeReassignmentKeepsOldOnline = activeReassignmentNotice?.oldAssistantSetOffline === false;
  const activeReassignmentTaskLabel = activeReassignmentNotice
    ? `${activeReassignmentNotice.taskRoomNumber}室 · ${activeReassignmentNotice.taskCategoryName} · P${activeReassignmentNotice.taskPriority}`
    : "";
  const activeReassignmentOldWorkLabel = activeReassignmentNotice
    ? [
        activeReassignmentNotice.oldAssistantActiveTaskRoomNumber
          ? `${activeReassignmentNotice.oldAssistantActiveTaskRoomNumber}室`
          : null,
        activeReassignmentNotice.oldAssistantActiveTaskCategoryName,
      ].filter(Boolean).join(" · ") || "上一项任务"
    : "上一项任务";
  const activeReassignmentOldWorkStatusLabel =
    activeReassignmentNotice?.oldAssistantActiveTaskStatus === "paused" ? "暂停中" : "超时进行中";
  const activeReassignmentMessage = activeReassignmentNotice
    ? activeReassignmentNoticeRole === "old"
      ? activeReassignmentNotice.reason === "assistant_swap_after_complete_ready"
        ? `${activeReassignmentNotice.newAssistantName}助理原任务已完成，正在前往你此时所在地，系统已将「${activeReassignmentTaskLabel}」转入待就位接替流程。`
        : activeReassignmentKeepsOldOnline
        ? `因你上一项任务「${activeReassignmentOldWorkLabel}」仍在${activeReassignmentOldWorkStatusLabel}，已将「${activeReassignmentTaskLabel}」转派给${activeReassignmentNotice.newAssistantName}。你的在线状态未改变。`
        : "你因长时间未应答就位，现已将你状态切换为离线状态，点击下方确认窗口，状态切换为应接在线状态。"
      : activeReassignmentKeepsOldOnline
        ? `收到${activeReassignmentNotice.oldAssistantName}「${activeReassignmentTaskLabel}」接替/交换请求，是否经过协商确认。`
        : `因${activeReassignmentNotice.oldAssistantName}长时间未应答就位，现由你接替派发任务。`
    : "";
  const isAssistantProfile = isAssistantRole(profile?.role);
  const assistantPresence = assistantPresenceState(profile);
  const assistantPresenceInfo = assistantPresenceMeta(assistantPresence);
  const assistantCanChangePresence =
    isAssistantProfile && !!profile;
  const eatingReentryRemainingMinutesForProfile = useCallback((target: { id: string; onlineStatus?: string | null; subStatus?: string | null; eatingEndedAt?: string | null } | null | undefined) => {
    if (!target || assistantPresenceState(target) === "eating") return 0;
    const savedMs = eatingReentryRemainingMs(target.eatingEndedAt, now, eatingReentryCooldownMin);
    const hintedUntil = eatingReentryHintUntilByProfileId[target.id];
    const hintedMs = hintedUntil ? Math.max(0, new Date(hintedUntil).getTime() - now.getTime()) : 0;
    const remainingMs = Math.max(savedMs, hintedMs);
    return remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 60000)) : 0;
  }, [eatingReentryCooldownMin, eatingReentryHintUntilByProfileId, now]);
  const eatingPausedSeconds = normalizeEatingAccumulatedSeconds(profile?.eatingAccumulatedSeconds);
  const eatingIsPaused =
    isAssistantProfile &&
    assistantPresence !== "eating" &&
    (eatingPausedSeconds > 0 || !!profile?.eatingPausedAt) &&
    !profile?.eatingEndedAt;
  const assistantLocationTask = isAssistantProfile
    ? [currentRawTask, pausedRawTask].find((task) => {
      const status = taskStatusForProfile(task, profile?.id);
      return status === "executing" || status === "paused";
    }) ?? null
    : null;
  const profileDisplayBuildingId = profile
    ? isAssistantProfile
      ? profile.activeBuildingId ?? profile.buildingId
      : photographerWorkbenchBuildingId ?? profile.buildingId
    : null;
  const profileBuildingForDisplay = buildings.find((b) => b.id === profileDisplayBuildingId);
  const profileBuildingName = profileBuildingForDisplay?.name ?? profile?.building?.name ?? "—";
  const assistantLocationBuilding =
    assistantLocationTask
      ? buildings.find((b) => b.id === taskLocationBuildingId(assistantLocationTask))?.name ?? profile?.building?.name
      : profileBuildingName;
  const isAtRegisteredBuilding =
    originalBuildingIdRef.current == null ||
    profileDisplayBuildingId === originalBuildingIdRef.current;
  const currentRoomBelongsToDisplayBuilding = venueBelongsToBuilding(profileBuildingForDisplay, profileCurrentWorkbenchRoom);
  const idleDisplayVenue = isAssistantProfile
    ? null
    : isAtRegisteredBuilding
      ? currentRoomBelongsToDisplayBuilding
        ? profileCurrentWorkbenchRoom
        : profileCurrentWorkbenchRoom
          ? null
          : originalRoomRef.current && venueBelongsToBuilding(profileBuildingForDisplay, originalRoomRef.current)
            ? originalRoomRef.current
            : defaultBuildingVenue(profileBuildingForDisplay)
      : currentRoomBelongsToDisplayBuilding
        ? profileCurrentWorkbenchRoom
        : null;
  const workbenchLocationText =
    assistantLocationTask
      ? `${assistantLocationBuilding || "—"} ${formatRoomOrVenue(assistantLocationTask.roomNumber)}`
      : `${profileBuildingName}${idleDisplayVenue ? ` · ${formatRoomOrVenue(idleDisplayVenue)}` : ""}`;
  const photographerBuildingOptions =
    !isAssistantProfile && profile
      ? buildings.filter((b) => b.id !== profileDisplayBuildingId)
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
      profileDisplayBuildingId === registeredBuildingId && origRoom
        ? [{ name: `${origRoom}室`, value: origRoom, type: undefined, isOriginal: true }]
        : [];
    return [...publicVenues, ...ownRoomOption].filter((venue) => venue.value !== profileCurrentWorkbenchRoom);
  })();
  const canSwitchAssistantBuilding =
    isAssistantProfile &&
    profile?.status !== "executing" &&
    profile?.status !== "finishing" &&
    taskStatusForProfile(currentRawTask, profile?.id) !== "executing";
  const assistantBuildingOptions =
    isAssistantProfile && canSwitchAssistantBuilding
      ? buildings.filter((b) => b.id !== profileDisplayBuildingId)
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
  const publicQueueInteractionVisible = true;
  const publicQueuePendingPromotion = useMemo(() => {
    if (!publicQueueInteractionVisible || !profile?.id || publicQueueTasks.length === 0) return null;
    const seen = readPublicQueueSeenEscalations(profile.id);
    const unseenEscalated = publicQueueTasks
      .map((task) => ({ task, key: publicQueueEscalationKey(task) }))
      .filter((item): item is { task: TaskFromAPI; key: string } => item.key != null && !seen.has(item.key));
    if (unseenEscalated.length === 0) return null;

    const unseenIds = new Set(unseenEscalated.map((item) => item.task.id));
    const inferredBeforePromotion = sortPublicQueueTasks(
      publicQueueTasks,
      publicQueueRaw,
      (task) => unseenIds.has(task.id) ? Math.min(6, task.priority + 1) : task.priority
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
  }, [profile?.id, publicQueueBuildingId, publicQueueInteractionVisible, publicQueueRaw, publicQueueSeenVersion, publicQueueTasks]);
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
  const areaTasks = useMemo(
    () => publicQueueRaw
      .filter((task) => publicQueueBuildingId != null && taskLocationBuildingId(task) === publicQueueBuildingId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [publicQueueBuildingId, publicQueueRaw],
  );

  const closeTransferModal = useCallback(() => {
    setTransferTask(null);
    setTransferError(null);
    setTransferSavingAssistantId(null);
    setTransferHoverAssistantId(null);
    setTransferConfirmTarget(null);
  }, []);

  useEffect(() => {
    if (!transferTask) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (transferPickerRef.current?.contains(target)) return;
      if (target instanceof HTMLElement && target.closest("[data-transfer-control='true']")) return;
      if (target instanceof HTMLElement && target.closest("[data-transfer-confirm='true']")) return;
      closeTransferModal();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [closeTransferModal, transferTask]);

  const activeTransferForTask = useCallback((task: TaskFromAPI | null | undefined) => (
    task?.assistantTransferRequests?.find((request) =>
      request.status === "confirming" ||
      request.status === "pending" ||
      request.status === "pending_after_complete" ||
      request.status === "ready_to_takeover"
    ) ?? null
  ), []);

  const pendingTransferForTask = useCallback((task: TaskFromAPI | null | undefined) => (
    task?.assistantTransferRequests?.find((request) => request.status === "pending") ?? null
  ), []);

  const confirmingTransferForTask = useCallback((task: TaskFromAPI | null | undefined) => (
    task?.assistantTransferRequests?.find((request) => request.status === "confirming") ?? null
  ), []);

  const incomingConfirmingTransferTask = useMemo(() => {
    if (!profile || !isAssistantRole(profile.role)) return null;
    return taskListRaw.find((task) => {
      const request = confirmingTransferForTask(task);
      return request?.targetAssistantId === profile.id && !dismissedTransferRequestIds.includes(request.id);
    }) ?? null;
  }, [confirmingTransferForTask, dismissedTransferRequestIds, profile, taskListRaw]);

  const incomingConfirmingTransfer = incomingConfirmingTransferTask
    ? confirmingTransferForTask(incomingConfirmingTransferTask)
    : null;
  const incomingConfirmingTransferIsSwap = incomingConfirmingTransfer?.kind === "swap";

  const canOpenTransferForTask = useCallback((task: TaskFromAPI | null | undefined) => {
    if (!task || !profile || task.assistantId !== profile.id) return false;
    if (task.status === "completed" || !task.startedAt) return false;
    if (isIroningTask(task) || isExternalModelFollowTask(task)) return false;
    if (task.parentTaskId) return false;
    if (helperParticipants(task).length > 0) return false;
    return task.status === "executing" || task.status === "paused" || task.status === "waiting";
  }, [profile]);

  const transferCandidateInfo = useCallback((
    candidate: typeof allProfiles[number],
    task: TaskFromAPI | null,
  ): { selectable: boolean; mode: "immediate" | "reserved" | null; reason: string } => {
    if (!profile || !task) return { selectable: false, mode: null, reason: "当前身份无效" };
    if (candidate.id === profile.id) return { selectable: false, mode: null, reason: "不能移交给自己" };
    if (!isAssistantRole(candidate.role)) return { selectable: false, mode: null, reason: "只能移交给助理" };
    if (candidate.onlineStatus !== "online") return { selectable: false, mode: null, reason: "不在线" };
    if (candidate.subStatus) return { selectable: false, mode: null, reason: "吃饭/休假中" };
    if (activeTransferForTask(task)) return { selectable: false, mode: null, reason: "该任务已有移交请求" };
    const taskBuildingId = taskLocationBuildingId(task);
    if (taskBuildingId == null) return { selectable: false, mode: null, reason: "无法确认任务区域" };
    const candidateBuildingId = profileServiceBuildingId(candidate);
    if (candidateBuildingId !== taskBuildingId) return { selectable: false, mode: null, reason: "不在当前区域" };
    const activeTask = areaTasks.find((item) =>
      item.status !== "completed" &&
      (
        item.assistantId === candidate.id ||
        activeTaskParticipants(item).some((participant) => participant.assistantId === candidate.id)
      )
    );
    if (!activeTask) return { selectable: true, mode: "immediate", reason: "空闲，可立即移交" };
    const participant = taskParticipantForProfile(activeTask, candidate.id);
    const status = participant?.status ?? activeTask.status;
    if (status === "executing" || status === "paused") {
      return { selectable: true, mode: "reserved", reason: "正在任务中，可发起互换确认" };
    }
    return { selectable: false, mode: null, reason: "已有待就位任务" };
  }, [activeTransferForTask, areaTasks, profile]);

  const transferCandidates = useMemo(() => {
    if (!transferTask || !profile) return [];
    const taskBuildingId = taskLocationBuildingId(transferTask);
    return allProfiles
      .filter((candidate) => isAssistantRole(candidate.role) && candidate.id !== profile.id)
      .filter((candidate) => taskBuildingId == null || profileServiceBuildingId(candidate) === taskBuildingId)
      .map((candidate) => ({
        profile: candidate,
        info: transferCandidateInfo(candidate, transferTask),
      }))
      .sort((a, b) => {
        const rank = (mode: "immediate" | "reserved" | null) => mode === "immediate" ? 0 : mode === "reserved" ? 1 : 2;
        return rank(a.info.mode) - rank(b.info.mode) || a.profile.name.localeCompare(b.profile.name);
      });
  }, [allProfiles, profile, transferCandidateInfo, transferTask]);

  const handleTransferAssistant = useCallback(async (targetAssistantId: string) => {
    if (!transferTask || !profile || transferSavingAssistantId) return;
    setTransferSavingAssistantId(targetAssistantId);
    setTransferError(null);
    try {
      const response = await fetch(`/api/tasks/${transferTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transferPrimaryAssistant",
          actorAssistantId: profile.id,
          targetAssistantId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        setTransferError(data?.error ?? "交换/移交失败，请稍后重试");
        return;
      }
      const updated = await response.json() as TaskFromAPI & { transferResult?: { mode?: string } };
      const removeFromCurrentAssistant = updated.transferResult?.mode === "immediate" && updated.assistantId !== profile.id;
      replaceVisibleTaskForProfile(updated, !removeFromCurrentAssistant, profile);
      refreshAssistants();
      showTaskCreateError("已发送移交请求；目标助理确认并实际接手前，你仍负责当前任务", false, "transfer");
      closeTransferModal();
    } catch (error) {
      console.error("Failed to transfer assistant", error);
      setTransferError("交换/移交失败，请检查网络后重试");
    } finally {
      setTransferSavingAssistantId(null);
    }
  }, [closeTransferModal, profile, refreshAssistants, replaceVisibleTaskForProfile, showTaskCreateError, transferSavingAssistantId, transferTask]);

  const handleRespondTransferRequest = useCallback(async (
    accepted: boolean,
    responseMode?: "pause_and_go" | "after_complete",
  ) => {
    if (!profile || !incomingConfirmingTransferTask || !incomingConfirmingTransfer || transferResponseSaving) return;
    setTransferResponseSaving(accepted ? (responseMode ?? "accept") : "reject");
    try {
      const response = await fetch(`/api/tasks/${incomingConfirmingTransferTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "respondPrimaryAssistantTransfer",
          actorAssistantId: profile.id,
          accepted,
          responseMode,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        showTaskCreateError(data?.error ?? "移交请求处理失败，请稍后重试");
        return;
      }
      const updated = await response.json() as TaskFromAPI & { transferResult?: { mode?: string } };
      const updatedActiveTransfer = activeTransferForTask(updated);
      const shouldKeepForCurrentAssistant =
        updated.assistantId === profile.id ||
        activeTaskParticipants(updated).some((participant) => participant.assistantId === profile.id) ||
        confirmingTransferForTask(updated)?.targetAssistantId === profile.id ||
        (
          updatedActiveTransfer?.targetAssistantId === profile.id &&
          (updatedActiveTransfer.status === "pending_after_complete" || updatedActiveTransfer.status === "ready_to_takeover")
        );
      replaceVisibleTaskForProfile(updated, shouldKeepForCurrentAssistant, profile);
      setDismissedTransferRequestIds((prev) => [...prev, incomingConfirmingTransfer.id]);
      refreshAssistants();
      const successMessage = !accepted
        ? "已拒绝本次移交请求"
        : responseMode === "pause_and_go"
          ? "已确认暂停并前往，任务已互换为待就位"
          : responseMode === "after_complete"
            ? "已确认结束后前往，当前任务完成后系统会提醒原助理并转入待就位"
            : "已确认接替，请前往待就位任务";
      showTaskCreateError(successMessage, false, "transfer");
    } catch (error) {
      console.error("Failed to respond transfer request", error);
      showTaskCreateError("移交请求处理失败，请检查网络后重试");
    } finally {
      setTransferResponseSaving(null);
    }
  }, [
    activeTransferForTask,
    confirmingTransferForTask,
    incomingConfirmingTransfer,
    incomingConfirmingTransferTask,
    profile,
    refreshAssistants,
    replaceVisibleTaskForProfile,
    showTaskCreateError,
    transferResponseSaving,
  ]);

  const renderTransferPicker = () => {
    if (!transferTask) return null;
    return (
      <div
        ref={transferPickerRef}
        className={`absolute right-[-124px] top-0 z-[220] w-[100px] rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl ${
          resolvedTheme === "dark"
            ? "border-white/[0.16] bg-slate-900/58 shadow-black/25"
            : "border-white/70 bg-white/92 shadow-slate-300/40"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {transferCandidates.length === 0 ? (
          <div className={`rounded-xl px-2 py-4 text-center text-[11px] font-semibold ${resolvedTheme === "dark" ? "bg-white/[0.10] text-slate-200" : "bg-slate-100/70 text-slate-500"}`}>
            当前区域暂无其他助理
          </div>
        ) : (
          <div className="max-h-[286px] space-y-1 overflow-y-auto pr-0.5 task-scroll">
            {transferCandidates.map(({ profile: candidate, info }) => {
              const isSaving = transferSavingAssistantId === candidate.id;
              const showBubble = transferHoverAssistantId === candidate.id;
              const candidateDock = profileToQuickBookAssistant(candidate);
              const transferStatusText = isSaving
                ? "处理中"
	                : info.mode === "reserved"
	                  ? "需预约"
                  : info.mode === "immediate"
                    ? "空闲"
                    : quickBookAssistantStatusText(candidateDock);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={isSaving}
                  onMouseEnter={() => setTransferHoverAssistantId(candidate.id)}
                  onMouseLeave={() => setTransferHoverAssistantId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!info.selectable) {
                      setTransferHoverAssistantId(candidate.id);
                      return;
                    }
                    setTransferError(null);
                    setTransferConfirmTarget({ assistantId: candidate.id, assistantName: candidate.name });
                  }}
                  className={`group relative flex min-h-[44px] w-full items-center gap-1 rounded-xl px-1 py-1.5 text-left transition-colors ${
                    info.selectable
                      ? resolvedTheme === "dark"
                        ? "bg-white/[0.11] text-slate-50 hover:bg-white/[0.16]"
                        : "bg-white/60 text-slate-700 hover:bg-purple-50"
                      : resolvedTheme === "dark"
                        ? "bg-white/[0.075] text-slate-300"
                        : "bg-slate-100/70 text-slate-400"
                  } ${info.selectable ? "" : "cursor-not-allowed"} disabled:cursor-wait`}
                  title={info.reason}
                >
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-visible">
                    <span className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[10px] font-extrabold text-white ${info.selectable ? "" : "grayscale"}`}>
                      {candidate.avatar ? (
                        <img src={candidate.avatar} alt={candidate.name} className="h-full w-full object-cover" />
                      ) : candidate.name.slice(0, 1)}
                    </span>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: assistantDockDotColor(candidateDock) }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-extrabold leading-tight">{candidate.name}</span>
                    <span className={`block truncate text-[8px] font-bold leading-tight ${
                      info.mode === "reserved"
                        ? "text-purple-600"
                        : info.mode === "immediate"
                          ? "text-purple-600"
                          : resolvedTheme === "dark" ? "text-purple-100/80" : "text-purple-500/80"
                    }`}>
                      {transferStatusText}
                    </span>
                  </span>
                  {showBubble && (
                    <span className="pointer-events-none absolute left-full top-1/2 z-[5] ml-2 w-max max-w-[170px] -translate-y-1/2 rounded-xl bg-purple-950 px-2 py-1 text-[10px] font-semibold text-purple-50 shadow-lg shadow-purple-900/20">
                      {info.reason}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {transferError && (
          <div className="mt-1 rounded-xl bg-red-50 px-2 py-1.5 text-[10px] font-semibold leading-snug text-red-500">
            {transferError}
          </div>
        )}
      </div>
    );
  };

  const renderAssistantTransferHeaderControl = () => {
    const transferTaskWithRequest = [currentRawTask, pausedRawTask].find((task) => activeTransferForTask(task)) ?? null;
    const activeTransfer = activeTransferForTask(transferTaskWithRequest);
    const targetName = activeTransfer
      ? allProfiles.find((item) => item.id === activeTransfer.targetAssistantId)?.name ?? "目标助理"
      : null;
    if (activeTransfer) {
      const label = activeTransfer.status === "confirming" ? "待确认" : "已预约";
      return (
        <span className={`flex h-7 max-w-[138px] items-center gap-1.5 rounded-full px-2.5 text-[10px] font-extrabold shadow-sm backdrop-blur-xl ${
          resolvedTheme === "dark"
            ? "bg-white/[0.07] text-purple-200"
            : "bg-white/54 text-purple-600"
        }`}>
          <TransferArrowsIcon className="h-[11px] w-[11px] shrink-0" />
          <span className="min-w-0 truncate">{label} {targetName}</span>
        </span>
      );
    }

    const task = currentRawTask && canOpenTransferForTask(currentRawTask)
      ? currentRawTask
      : pausedRawTask && canOpenTransferForTask(pausedRawTask)
        ? pausedRawTask
        : null;
    if (!task) return null;
    return (
      <button
        type="button"
        data-transfer-control="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setTransferTask((current) => current?.id === task.id ? null : task);
          setTransferError(null);
        }}
        className={`flex h-7 max-w-[138px] items-center gap-1.5 rounded-full px-2.5 text-[10px] font-extrabold shadow-sm backdrop-blur-xl transition-all ${
          resolvedTheme === "dark"
            ? "bg-white/[0.07] text-purple-200 hover:bg-white/[0.12]"
            : "bg-white/54 text-purple-600 hover:bg-white/78"
        }`}
        title="交换/移交"
      >
        <TransferArrowsIcon className="h-[11px] w-[11px] shrink-0" />
        <span>交换/移交</span>
      </button>
    );
  };

  const availableIroningMachines = useMemo(
    () => (activeBuilding?.ironingMachines ?? [])
      .filter((machine) => machine.status === "normal")
      .sort((a, b) => a.sortRank - b.sortRank || a.id - b.id),
    [activeBuilding?.ironingMachines],
  );
  const displayIroningMachines = useMemo(
    () => [...(activeBuilding?.ironingMachines ?? [])].sort((a, b) => a.sortRank - b.sortRank || a.id - b.id),
    [activeBuilding?.ironingMachines],
  );
  const activeIroningWorkItems = useMemo(() => {
    const nowMs = now.getTime();
    const profileById = new Map(allProfiles.map((item) => [item.id, item]));
    const dockAssistantById = new Map(assistants.map((item) => [item.id, item]));

    return areaTasks
      .filter((task) => isIroningTask(task) && task.status === "executing" && !!task.assistantId)
      .flatMap((task): IroningWorkItem[] => {
        const durationLabel = taskCategoryDurationCaption(task.category, task.priority);
        const capMin = taskSlotCapMinutes(task.category);
        return ironingSlotAssistantIds(task).map((assistantId) => {
          const timingSource = taskTimingForProfile(task, assistantId);
          const elapsedMin = effectiveWorkMinutesFromApi(timingSource, nowMs);
          const overtimeMin = overtimeMinutesBeyondSlot(
            { ...timingSource, status: "executing", category: task.category },
            nowMs,
          );
          const participant = taskParticipantForProfile(task, assistantId);
          const profileAssistant = profileById.get(assistantId);
          const dockAssistant = dockAssistantById.get(assistantId);
          const remainingMin = capMin == null ? null : Math.max(0, capMin - elapsedMin);
          return {
            task,
            assistantId,
            slotKey: `${task.id}-${assistantId}`,
            assistantName: profileAssistant?.name ?? dockAssistant?.name ?? participant?.assistant.name ?? task.assistant?.name ?? "未命名助理",
            assistantAvatar: profileAssistant?.avatar ?? dockAssistant?.avatar ?? participant?.assistant.avatar ?? null,
            elapsedMin,
            overtimeMin,
            remainingMin,
            durationLabel,
            elapsedLabel: overtimeMin != null
              ? `已进行${fmtMin(elapsedMin)} · 超时${fmtMin(overtimeMin)}`
              : `已进行${fmtMin(elapsedMin)}`,
            taskLabel: `${task.category?.name ?? "熨烫"}任务`,
          };
        });
      });
  }, [allProfiles, areaTasks, assistants, now]);
  const waitingIroningWorkItems = useMemo(() => {
    const profileById = new Map(allProfiles.map((item) => [item.id, item]));
    const dockAssistantById = new Map(assistants.map((item) => [item.id, item]));

    return areaTasks
      .filter((task) =>
        isIroningTask(task) &&
        task.status === "waiting" &&
        (task.ironingStage === "waiting_machine" || isAssignedIroningReadyTask(task)) &&
        !!task.assistantId
      )
      .sort((a, b) =>
        ironingQueueOrderMs(a) - ironingQueueOrderMs(b) ||
        a.priority - b.priority ||
        a.id.localeCompare(b.id)
      )
      .flatMap((task): IroningWorkItem[] => {
        const durationLabel = taskCategoryDurationCaption(task.category, task.priority);
        return ironingSlotAssistantIds(task).map((assistantId) => {
          const participant = taskParticipantForProfile(task, assistantId);
          const profileAssistant = profileById.get(assistantId);
          const dockAssistant = dockAssistantById.get(assistantId);
          return {
            task,
            assistantId,
            slotKey: `${task.id}-${assistantId}`,
            assistantName: profileAssistant?.name ?? dockAssistant?.name ?? participant?.assistant.name ?? task.assistant?.name ?? "未命名助理",
            assistantAvatar: profileAssistant?.avatar ?? dockAssistant?.avatar ?? participant?.assistant.avatar ?? null,
            elapsedMin: 0,
            overtimeMin: null,
            remainingMin: null,
            durationLabel,
            elapsedLabel: isAssignedIroningReadyTask(task, assistantId) ? "准备熨烫" : "等待熨烫机",
            taskLabel: `${task.category?.name ?? "熨烫"}任务`,
          };
        });
      });
  }, [allProfiles, areaTasks, assistants]);
  const ironingAssistantCapacity = availableIroningMachines.length;
  const claimedIroningMachineCount = waitingIroningWorkItems.filter((item) => item.task.ironingStage === "notified").length;
  const freeIroningMachineCount = Math.max(0, ironingAssistantCapacity - activeIroningWorkItems.length - claimedIroningMachineCount);
  const sortedWaitingIroningWorkItems = useMemo(
    () => [...waitingIroningWorkItems].sort((a, b) =>
      ironingQueueOrderMs(a.task) - ironingQueueOrderMs(b.task) ||
      a.task.priority - b.task.priority ||
      a.task.id.localeCompare(b.task.id)
    ),
    [waitingIroningWorkItems],
  );
  const ironingMachineRows = useMemo(() => {
    let workIndex = 0;
    let readyIndex = 0;
    const rows = displayIroningMachines.map((machine) => {
      let workItem: IroningWorkItem | null = null;
      let readyItem: IroningWorkItem | null = null;
      if (machine.status === "normal") {
        workItem = activeIroningWorkItems[workIndex] ?? null;
        workIndex += 1;
        if (!workItem) {
          readyItem = sortedWaitingIroningWorkItems[readyIndex] ?? null;
          if (readyItem) readyIndex += 1;
        }
      }
      return { machine, workItem, readyItem, queuedItems: [] as IroningWorkItem[] };
    });
    const assignedReadySlotKeys = new Set(rows.map((row) => row.readyItem?.slotKey).filter((id): id is string => Boolean(id)));
    const remainingQueuedItems = [
      ...activeIroningWorkItems.slice(availableIroningMachines.length),
      ...sortedWaitingIroningWorkItems.filter((item) => !item.slotKey || !assignedReadySlotKeys.has(item.slotKey)),
    ].sort((a, b) =>
      ironingQueueOrderMs(a.task) - ironingQueueOrderMs(b.task) ||
      a.task.priority - b.task.priority ||
      a.task.id.localeCompare(b.task.id)
    );
    const normalRows = rows.filter((row) => row.machine.status === "normal");
    if (normalRows.length > 0) {
      const machineTimeline = normalRows.map((row) => ({
        row,
        availableInMinutes: row.workItem
          ? row.workItem.remainingMin ?? ironingQueueEstimateMinutes(row.workItem.task)
          : row.readyItem
            ? ironingQueueEstimateMinutes(row.readyItem.task)
            : 0,
      }));
      remainingQueuedItems.forEach((item) => {
        machineTimeline.sort((a, b) =>
          a.availableInMinutes - b.availableInMinutes ||
          a.row.machine.sortRank - b.row.machine.sortRank ||
          a.row.machine.id - b.row.machine.id
        );
        const target = machineTimeline[0];
        target.row.queuedItems.push(item);
        target.availableInMinutes += ironingQueueEstimateMinutes(item.task);
      });
    }
    const rowRank = ({ machine, workItem }: (typeof rows)[number]) => {
      if (workItem) return 0;
      if (machine.status === "normal") return 1;
      return 2;
    };
    return rows.sort((a, b) => rowRank(a) - rowRank(b) || a.machine.sortRank - b.machine.sortRank || a.machine.id - b.machine.id);
	  }, [activeIroningWorkItems, availableIroningMachines.length, displayIroningMachines, sortedWaitingIroningWorkItems]);
	  const queuedIroningWorkItems = useMemo(
	    () => ironingMachineRows.flatMap((row) => row.queuedItems),
	    [ironingMachineRows],
	  );
	  const ironingQueueOverview = useMemo(() => {
	    const totalNormalMachines = displayIroningMachines.filter((machine) => machine.status === "normal").length;
	    const activeCount = activeIroningWorkItems.length;
	    const waitingCount = waitingIroningWorkItems.length;
    const claimedCount = waitingIroningWorkItems.filter((item) => item.task.ironingStage === "notified").length;
    const freeMachines = Math.max(0, totalNormalMachines - activeCount - claimedCount);
    let tone: "busy" | "queue" | "moderate" | "idle" = "idle";
    if (totalNormalMachines > 0) {
      if (freeMachines > activeCount) tone = "idle";
      else if (freeMachines > 0) tone = "moderate";
      else if (waitingCount > 0) tone = "queue";
      else tone = "busy";
    }
    return {
      tone,
      label: tone === "busy" ? "繁忙" : tone === "queue" ? "拥挤" : tone === "moderate" ? "适中" : "空闲",
      totalMachines: totalNormalMachines,
      freeMachines,
      waitingCount,
	      activeCount,
	    };
	  }, [activeIroningWorkItems.length, displayIroningMachines.length, waitingIroningWorkItems]);
	  const workbenchFloatingSurfaceCls = resolvedTheme === "dark"
	    ? "border-white/[0.14] bg-slate-900/72 text-slate-100 shadow-black/40"
	    : "border-white/75 bg-white/84 text-slate-700 shadow-slate-900/10";
	  const workbenchSoftFloatingSurfaceCls = resolvedTheme === "dark"
	    ? "border-white/[0.16] bg-slate-900/58 text-slate-100 shadow-black/25"
	    : "border-white/70 bg-white/92 text-slate-700 shadow-slate-300/40";
	  const workbenchFloatingItemCls = resolvedTheme === "dark"
	    ? "text-slate-200/90 hover:bg-white/[0.10] hover:text-white"
	    : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-950";
	  const workbenchLocationMenuSurfaceCls = resolvedTheme === "dark"
	    ? "border-white/[0.18] bg-slate-700/68 text-slate-50 shadow-black/30 ring-1 ring-white/[0.08]"
	    : "border-white/75 bg-white/84 text-slate-700 shadow-slate-900/10";
	  const workbenchLocationMenuItemCls = resolvedTheme === "dark"
	    ? "text-slate-50/95 hover:bg-white/[0.13] hover:text-white"
	    : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-950";
	  const workbenchHoverTooltipCls = resolvedTheme === "dark"
	    ? "bg-slate-900/82 text-slate-100 ring-white/[0.14] shadow-black/40"
	    : "bg-white/94 text-slate-700 ring-slate-200/80 shadow-slate-900/10";
	  const workbenchSmallGlassCls = resolvedTheme === "dark"
	    ? "bg-slate-900/68 ring-white/[0.14] shadow-black/25"
	    : "bg-white/72 ring-white/80 shadow-slate-900/10";
	  const ironingWorkByAssistantId = useMemo(
	    () => new Map(activeIroningWorkItems.map((item) => [item.assistantId, item])),
	    [activeIroningWorkItems],
	  );
  const renderIroningQueueDetailPanel = useCallback(
    () => ironingMachineRows.map(({ machine, workItem, readyItem, queuedItems }) => {
        const tone = machine.status === "maintenance" ? "maintenance" : workItem ? "busy" : "idle";
        const machineStatusText = tone === "busy" ? "使用中" : tone === "maintenance" ? "维修不可用" : "空闲";
        const rowQueuedItems = [...queuedItems, ...(readyItem ? [readyItem] : [])].slice().reverse();
        const queuedStatusLabel = (queuedItem: IroningWorkItem) => {
          if (workItem) return "队列中";
          return isAssignedIroningReadyTask(queuedItem.task, queuedItem.assistantId) ? "准备熨烫" : "等待熨烫机";
        };
        return (
          <div key={machine.id} className="grid h-9 w-[184px] grid-cols-[1fr_36px] items-center gap-1.5">
            <div className="flex min-w-0 items-center justify-end gap-1.5">
              {rowQueuedItems.map((queuedItem) => (
                <span
                  key={`queued-ironing-${queuedItem.slotKey ?? queuedItem.task.id}`}
                  className="group relative z-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white transition-transform hover:z-[80] hover:scale-105"
                >
                  <span className="flex h-full w-full overflow-hidden rounded-full bg-slate-200 ring-2 ring-slate-300/90 shadow-sm">
                    {queuedItem.assistantAvatar ? (
                      <img src={queuedItem.assistantAvatar} alt={queuedItem.assistantName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-300 to-slate-500">
                        {queuedItem.assistantName.slice(0, 1)}
                      </span>
                    )}
                  </span>
	                  <span className={`pointer-events-none absolute right-full top-1/2 z-[90] mr-2 hidden min-w-[132px] -translate-y-1/2 rounded-xl px-3 py-2 text-left text-[11px] font-extrabold shadow-lg ring-1 backdrop-blur group-hover:block ${workbenchHoverTooltipCls}`}>
	                    <span className={resolvedTheme === "dark" ? "block text-slate-50" : "block text-slate-900"}>{queuedItem.durationLabel}熨烫任务</span>
	                    <span className="mt-0.5 block text-blue-600">{queuedStatusLabel(queuedItem)}</span>
	                  </span>
                </span>
              ))}
              {workItem && (
                <span className="group relative z-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white transition-transform hover:z-[80] hover:scale-105">
                  <span className="flex h-full w-full overflow-hidden rounded-full bg-slate-200 ring-2 ring-slate-300/90 shadow-sm">
                    {workItem.assistantAvatar ? (
                      <img src={workItem.assistantAvatar} alt={workItem.assistantName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-300 to-slate-500">
                        {workItem.assistantName.slice(0, 1)}
                      </span>
                    )}
                  </span>
	                  <span className={`pointer-events-none absolute right-full top-1/2 z-[90] mr-2 hidden min-w-[156px] -translate-y-1/2 rounded-xl px-3 py-2 text-left text-[11px] font-extrabold shadow-lg ring-1 backdrop-blur group-hover:block ${workbenchHoverTooltipCls}`}>
	                    <span className={resolvedTheme === "dark" ? "block text-slate-50" : "block text-slate-900"}>{workItem.durationLabel}熨烫任务</span>
	                    {workItem.overtimeMin == null && (
	                      <span className="mt-0.5 block text-orange-500">已进行{fmtIroningHoverTime(workItem.elapsedMin)}</span>
	                    )}
	                    <span className={workItem.overtimeMin != null ? "mt-0.5 block text-red-600" : resolvedTheme === "dark" ? "mt-0.5 block text-slate-100" : "mt-0.5 block text-slate-900"}>
                      {workItem.overtimeMin != null
                        ? `已超时${fmtIroningHoverTime(workItem.overtimeMin)}`
                        : workItem.remainingMin == null
                          ? "预计剩余时间--"
                          : `预计剩余时间${fmtIroningHoverTime(workItem.remainingMin)}`}
                    </span>
                  </span>
                </span>
              )}
            </div>
	            <span className={`group relative grid h-9 w-9 shrink-0 place-items-center justify-self-end rounded-xl shadow-sm ring-1 backdrop-blur transition-transform hover:scale-105 ${workbenchSmallGlassCls}`}>
	              <IroningMachineIcon className="h-6 w-6" tone={tone} />
	              {tone === "maintenance" && (
	                <span className={`pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 whitespace-nowrap rounded-xl px-3 py-2 text-[11px] font-extrabold shadow-lg ring-1 backdrop-blur group-hover:block ${workbenchHoverTooltipCls}`}>
	                  {machineStatusText}
	                </span>
              )}
            </span>
          </div>
        );
      }),
	    [ironingMachineRows, resolvedTheme, workbenchHoverTooltipCls, workbenchSmallGlassCls],
	  );
  const areaPublicQueueRows = useMemo(
    () => publicQueueDisplayTasks.slice(0, 10),
    [publicQueueDisplayTasks],
  );
  const areaTaskStats = useMemo(() => {
    const nowMs = now.getTime();
    return areaTasks.reduce(
      (acc, task) => {
        acc.total += 1;
        const participants = activeTaskParticipants(task);
        const hasAssignedPerson = !!task.assistantId || participants.length > 0;
        const isOvertime = overtimeMinutesBeyondSlot(task, nowMs) != null;
        if (isOvertime) acc.overtime += 1;
        if (task.status === "completed") acc.completed += 1;
        else if (task.status === "executing") acc.executing += 1;
        else if (task.status === "paused") acc.paused += 1;
        else if (hasAssignedPerson) acc.assigned += 1;
        else acc.queued += 1;
        return acc;
      },
      { total: 0, queued: 0, assigned: 0, executing: 0, paused: 0, completed: 0, overtime: 0 },
    );
  }, [areaTasks, now]);
  const assistantRankingRows = useMemo(() => {
    const nowMs = now.getTime();
    const areaAssistantIds = new Set(assistants.map((assistant) => assistant.id));
    const areaCompletedAssistantIds = new Set<string>();
    const buildingNameById = new Map(buildings.map((building) => [building.id, building.name]));
    const contributionMap = new Map<string, AssistantRankingContribution[]>();

	    const addContribution = (entry: AssistantRankingContribution, isAreaTask: boolean) => {
	      if (isAreaTask) areaCompletedAssistantIds.add(entry.assistantId);
	      const current = contributionMap.get(entry.assistantId) ?? [];
	      current.push(entry);
	      contributionMap.set(entry.assistantId, current);
	    };

    for (const task of publicQueueRaw) {
      const isAreaTask = publicQueueBuildingId != null && taskLocationBuildingId(task) === publicQueueBuildingId;
      for (const entry of taskCompletedContributionsForRanking(task, nowMs)) {
        addContribution(entry, isAreaTask);
      }
    }

    return Array.from(contributionMap.entries())
      .filter(([assistantId]) => areaAssistantIds.has(assistantId) || areaCompletedAssistantIds.has(assistantId))
      .map(([assistantId, entries]): AssistantRankingRow => {
        const orderedEntries = [...entries].sort((a, b) => a.completedAtMs - b.completedAtMs);
        const completedCount = orderedEntries.length;
        const workSeconds = orderedEntries.reduce((sum, entry) => sum + entry.workSeconds, 0);
        const details = orderedEntries.map((entry): AssistantRankingDetail => {
          const scoreFactor = assistantTaskScoreFactor(entry.taskName);
          const serviceScore = assistantTaskScoreFromSeconds(entry.workSeconds, entry.taskName);
	          const buildingName = entry.buildingId != null
	            ? buildingNameById.get(entry.buildingId) ?? "未知楼座"
	            : "未知楼座";
	          const displayTaskName = displayTaskCategoryName(entry.taskName);
	          return {
	            taskId: entry.taskId,
	            taskTitle: `${buildingName} · ${formatRoomOrVenue(entry.roomNumber)} · ${displayTaskName}`,
            serviceSeconds: entry.workSeconds,
            scoreFactor,
            serviceScore,
            totalScore: serviceScore,
          };
        });
	        const dockAssistant = assistants.find((assistant) => assistant.id === assistantId);
	        const profileAssistant = allProfiles.find((assistant) => assistant.id === assistantId);
	        const assistantName =
	          dockAssistant?.name ??
	          profileAssistant?.name ??
	          orderedEntries.at(-1)?.assistantName ??
	          "未命名助理";
	        const avatar = dockAssistant?.avatar ?? profileAssistant?.avatar ?? null;
	        const lastCompletedAtMs = orderedEntries.at(-1)?.completedAtMs ?? 0;
	        const score = details.reduce((sum, detail) => sum + detail.totalScore, 0);
	        return {
	          assistantId,
	          assistantName,
	          avatar,
	          score,
	          completedCount,
	          workSeconds,
          lastCompletedAtMs,
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
	  }, [allProfiles, assistants, buildings, now, publicQueueBuildingId, publicQueueRaw]);
	  const areaAssistantStats = useMemo(() => assistants.reduce(
	    (acc, assistant) => {
      if (assistant.onlineStatus === "offline") acc.offline += 1;
      else if (assistant.status === "executing" || assistant.status === "busy") acc.executing += 1;
      else if (assistant.status === "assigned") acc.assigned += 1;
      else acc.idle += 1;
      acc.total += 1;
      return acc;
    },
	    { total: 0, idle: 0, assigned: 0, executing: 0, offline: 0 },
	  ), [assistants]);
  const areaRealtimeStats = useMemo(() => assistants.reduce(
    (acc, assistant) => {
      if (assistant.status === "executing" || assistant.status === "busy") acc.executing += 1;
      else if (assistant.status === "assigned") acc.assigned += 1;
      if (
        assistant.executingOvertimeMin != null ||
        assistant.pausedOvertimeMin != null ||
        assistant.preemptedOvertimeMin != null ||
        assistant.eatingOvertimeMin != null
      ) {
        acc.overtime += 1;
      }
      return acc;
    },
    { assigned: 0, executing: 0, overtime: 0 },
  ), [assistants]);
  const areaMetricPeopleByKey = useMemo(() => {
    const empty = (): Record<AreaMetricKey, Map<string, AreaMetricPerson>> => ({
      executing: new Map(),
      assigned: new Map(),
      overtime: new Map(),
      queue: new Map(),
      offline: new Map(),
    });
    const maps = empty();
    const profileById = new Map(allProfiles.map((item) => [item.id, item]));
    const taskById = new Map(areaTasks.map((task) => [task.id, task]));
    const useAssistantPeople = isAssistantRole(profile?.role);

    const addPerson = (
      key: AreaMetricKey,
      person: { id: string; name: string; avatar?: string | null } | null | undefined,
      breakdown?: AreaMetricBreakdown,
    ) => {
      if (!person?.id) return;
      const current = maps[key].get(person.id) ?? {
        id: person.id,
        name: person.name || "未命名",
        avatar: person.avatar ?? null,
        count: 0,
      };
      current.count += breakdown?.count ?? 1;
      if (!current.avatar && person.avatar) current.avatar = person.avatar;
      if (breakdown) {
        const nextBreakdown = [...(current.breakdown ?? [])];
        const existing = nextBreakdown.find((item) => item.label === breakdown.label && item.unit === breakdown.unit);
        if (existing) existing.count += breakdown.count;
        else nextBreakdown.push({ ...breakdown });
        current.breakdown = nextBreakdown;
      }
      maps[key].set(person.id, current);
    };

    const taskPublisher = (task: TaskFromAPI) => {
      const publisher = profileById.get(task.photographerId);
      return {
        id: task.photographerId,
        name: publisher?.name ?? task.photographer?.name ?? "摄影师",
        avatar: publisher?.avatar ?? null,
      };
    };

    const addQueuePerson = (task: TaskFromAPI, index: number) => {
      const person = taskPublisher(task);
      const current = maps.queue.get(person.id) ?? {
        id: person.id,
        name: person.name || "未命名",
        avatar: person.avatar ?? null,
        count: 0,
      };
      current.count += 1;
      if (!current.avatar && person.avatar) current.avatar = person.avatar;
      current.queueSortIndex = Math.min(current.queueSortIndex ?? Number.POSITIVE_INFINITY, index);
      const taskType = queueTaskTypeShortLabel(task.category?.name);
      if (!current.queueTaskTypes?.includes(taskType)) {
        current.queueTaskTypes = [...(current.queueTaskTypes ?? []), taskType];
      }
      maps.queue.set(person.id, current);
    };

    const taskAssistantById = (assistantId: string, fallback?: { name?: string | null; avatar?: string | null }) => {
      const profileAssistant = profileById.get(assistantId);
      const dockAssistant = assistants.find((assistant) => assistant.id === assistantId);
      return {
        id: assistantId,
        name: profileAssistant?.name ?? dockAssistant?.name ?? fallback?.name ?? "未命名助理",
        avatar: profileAssistant?.avatar ?? dockAssistant?.avatar ?? fallback?.avatar ?? null,
      };
    };

    const addTaskAssistants = (key: AreaMetricKey, task: TaskFromAPI, statuses: string[]) => {
      const seen = new Set<string>();
      const addAssistantId = (assistantId: string, status: string | null | undefined, fallback?: { name?: string | null; avatar?: string | null }) => {
        if (!statuses.includes(status ?? "")) return;
        if (seen.has(assistantId)) return;
        seen.add(assistantId);
        addPerson(key, taskAssistantById(assistantId, fallback));
      };
      if (task.assistantId) {
        const primary = taskParticipantForProfile(task, task.assistantId);
        addAssistantId(task.assistantId, primary?.status ?? task.status, {
          name: task.assistant?.name,
          avatar: profileById.get(task.assistantId)?.avatar ?? null,
        });
      }
      for (const participant of taskParticipants(task)) {
        addAssistantId(participant.assistantId, participant.status, participant.assistant);
      }
    };

    const executingAssistants = assistants.filter((assistant) => assistant.status === "executing" || assistant.status === "busy");
    for (const assistant of executingAssistants) {
      if (useAssistantPeople) {
        const task = assistant.currentTaskId ? taskById.get(assistant.currentTaskId) : null;
        const current = maps.executing.get(assistant.id) ?? {
          id: assistant.id,
          name: assistant.name || "未命名",
          avatar: assistant.avatar ?? null,
          count: 0,
        };
        current.count += 1;
        if (!current.avatar && assistant.avatar) current.avatar = assistant.avatar;
        if (task) {
          const taskType = queueTaskTypeShortLabel(task.category?.name);
          if (!current.queueTaskTypes?.includes(taskType)) {
            current.queueTaskTypes = [...(current.queueTaskTypes ?? []), taskType];
          }
        }
        maps.executing.set(assistant.id, current);
      } else {
        const task = assistant.currentTaskId ? taskById.get(assistant.currentTaskId) : null;
        if (task) {
          const person = taskPublisher(task);
          const current = maps.executing.get(person.id) ?? {
            id: person.id,
            name: person.name || "未命名",
            avatar: person.avatar ?? null,
            count: 0,
          };
          current.count += 1;
          if (!current.avatar && person.avatar) current.avatar = person.avatar;
          const taskType = queueTaskTypeShortLabel(task.category?.name);
          if (!current.queueTaskTypes?.includes(taskType)) {
            current.queueTaskTypes = [...(current.queueTaskTypes ?? []), taskType];
          }
          maps.executing.set(person.id, current);
        }
      }
    }

    const assignedTasks = areaTasks.filter((task) => {
      const participants = activeTaskParticipants(task);
      const hasAssignedPerson = !!task.assistantId || participants.length > 0;
      return task.status !== "completed" && task.status !== "executing" && task.status !== "paused" && hasAssignedPerson;
    });
    for (const task of assignedTasks) {
      if (useAssistantPeople) addTaskAssistants("assigned", task, ["waiting"]);
      else addPerson("assigned", taskPublisher(task));
    }

    const nowMs = now.getTime();
    const isTaskOvertime = (task: TaskFromAPI) => overtimeMinutesBeyondSlot(task, nowMs) != null;
    if (useAssistantPeople) {
      for (const assistant of assistants) {
        const taskOvertimeCount = [
          assistant.executingOvertimeMin,
          assistant.pausedOvertimeMin,
          assistant.preemptedOvertimeMin,
        ].filter((value) => value != null).length;
        if (taskOvertimeCount > 0) {
          addPerson("overtime", assistant, { label: "任务超时", count: taskOvertimeCount, unit: "项" });
        }
        if (assistant.eatingOvertimeMin != null) {
          addPerson("overtime", assistant, { label: "吃饭超时", count: 1, unit: "人" });
        }
      }
    } else {
      for (const task of areaTasks) {
        if (isTaskOvertime(task)) {
          addPerson("overtime", taskPublisher(task), { label: "任务超时", count: 1, unit: "项" });
        }
      }
      for (const assistant of assistants) {
        if (assistant.eatingOvertimeMin != null) {
          addPerson("overtime", assistant, { label: "吃饭超时", count: 1, unit: "人" });
        }
      }
    }

    for (const [index, task] of publicQueueDisplayTasks.entries()) {
      addQueuePerson(task, index);
    }

    for (const assistant of assistants) {
      if (assistant.onlineStatus === "offline") addPerson("offline", assistant);
    }

    return Object.fromEntries(
      (Object.keys(maps) as AreaMetricKey[]).map((key) => [
        key,
        Array.from(maps[key].values()).sort((a, b) => {
          if (key === "queue") {
            return (
              (a.queueSortIndex ?? Number.POSITIVE_INFINITY) - (b.queueSortIndex ?? Number.POSITIVE_INFINITY) ||
              a.name.localeCompare(b.name)
            );
          }
          return b.count - a.count || a.name.localeCompare(b.name);
        }),
      ]),
    ) as Record<AreaMetricKey, AreaMetricPerson[]>;
  }, [allProfiles, areaTasks, assistants, now, profile?.role, publicQueueDisplayTasks]);
		  const rankingCrownByAssistantId = useMemo(() => {
		    const rows = assistantRankingRows.slice(0, 3);
		    return rows.reduce<Record<string, { rank: 1 | 2 | 3 }>>((acc, row, index) => {
		      acc[row.assistantId] = { rank: (index + 1) as 1 | 2 | 3 };
		      return acc;
		    }, {});
		  }, [assistantRankingRows]);
	  const areaPublishedTaskTypeBreakdown = useMemo(() => {
	    const counts = new Map<string, number>();
	    for (const task of areaTasks) {
	      const name = displayTaskTypeGroupName(task.category?.name, task.priority);
	      counts.set(name, (counts.get(name) ?? 0) + 1);
	    }
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
	  }, [areaTasks]);
	  const areaPublishedTaskTypeTotal = useMemo(
	    () => areaPublishedTaskTypeBreakdown.reduce((sum, item) => sum + item.count, 0),
	    [areaPublishedTaskTypeBreakdown],
	  );
		  const areaTaskTypeBreakdown = useMemo(() => {
    const counts = new Map<string, {
      count: number;
      assistants: Map<string, { id: string; name: string; avatar: string | null; count: number }>;
    }>();
    const profileById = new Map(allProfiles.map((p) => [p.id, p]));
    for (const task of areaTasks) {
      if (task.status !== "completed") continue;
      if (!task.assistantId) continue;
      const name = displayTaskTypeGroupName(task.category?.name, task.priority);
      const row = counts.get(name) ?? { count: 0, assistants: new Map<string, { id: string; name: string; avatar: string | null; count: number }>() };
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
      counts.set(name, row);
    }
    return DISPLAY_TASK_TYPE_ORDER
      .map((name) => {
        const row = counts.get(name);
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
  }, [allProfiles, areaTasks]);
  const areaTaskTypeCompletedTotal = useMemo(
    () => areaTaskTypeBreakdown.reduce((sum, item) => sum + item.count, 0),
    [areaTaskTypeBreakdown],
  );
  const areaTaskTypePieGradient = useMemo(() => {
    if (areaPublishedTaskTypeBreakdown.length === 0 || areaPublishedTaskTypeTotal === 0) {
      return "conic-gradient(#e5e7eb 0deg 360deg)";
    }
    let cursor = 0;
    const stops = areaPublishedTaskTypeBreakdown.map((item) => {
      const start = cursor;
      const angle = (item.count / areaPublishedTaskTypeTotal) * 360;
      cursor += angle;
      return `${item.color} ${start}deg ${cursor}deg`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [areaPublishedTaskTypeBreakdown, areaPublishedTaskTypeTotal]);
  const areaPublishedTaskTypeSlices = useMemo(() => {
    if (areaPublishedTaskTypeTotal <= 0) return [];
    let cursor = 0;
    return areaPublishedTaskTypeBreakdown.map((item) => {
      const angle = (item.count / areaPublishedTaskTypeTotal) * 360;
      const start = cursor;
      const end = cursor + angle;
      cursor = end;
      return {
        ...item,
        start,
        end,
        mid: start + angle / 2,
        pct: Math.round((item.count / areaPublishedTaskTypeTotal) * 100),
      };
    });
  }, [areaPublishedTaskTypeBreakdown, areaPublishedTaskTypeTotal]);
  const handleAreaTaskTypePieMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const size = Math.min(rect.width, rect.height);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const outerRadius = size / 2;
    const innerRadius = outerRadius * 0.28;

    if (distance < innerRadius || distance > outerRadius) {
      if (hoveredAreaTaskTypeName !== null) setHoveredAreaTaskTypeName(null);
      return;
    }

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const normalizedAngle = (angle + 450) % 360;
    const nextSlice = areaPublishedTaskTypeSlices.find((slice) => (
      normalizedAngle >= slice.start && normalizedAngle < slice.end
    )) ?? areaPublishedTaskTypeSlices[areaPublishedTaskTypeSlices.length - 1] ?? null;
    const nextName = nextSlice?.name ?? null;
    if (nextName !== hoveredAreaTaskTypeName) {
      setHoveredAreaTaskTypeName(nextName);
    }
  }, [areaPublishedTaskTypeSlices, hoveredAreaTaskTypeName]);
  const primaryTaskType = areaTaskTypeBreakdown[0] ?? null;
  useEffect(() => {
    if (!publicQueueInteractionVisible) {
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
  }, [profile?.id, publicQueueBuildingId, publicQueueInteractionVisible, publicQueuePendingPromotion]);

  useEffect(() => {
    if (!publicQueueInteractionVisible || !profile?.id || publicQueuePendingPromotion || publicQueuePromotionRunningRef.current) return;
    writePublicQueueLastOrder(profile.id, publicQueueBuildingId, publicQueueTasks.map((task) => task.id));
  }, [profile?.id, publicQueueBuildingId, publicQueueInteractionVisible, publicQueuePendingPromotion, publicQueueTasks]);

  const mobileGlassPanel = resolvedTheme === "dark"
    ? "border-white/[0.14] bg-slate-950/62 shadow-black/35"
    : "border-white/75 bg-white/62 shadow-[0_18px_52px_rgba(56,68,89,0.10)]";
  const mobileSoftPanel = resolvedTheme === "dark"
    ? "border-white/[0.10] bg-white/[0.06]"
    : "border-white/70 bg-white/48";

  const mobileRoleLabel =
    profile?.role === "photographer"
      ? "摄影师"
      : profile?.role === "assistant"
        ? "助理"
        : profile?.role === "assistant_leader"
          ? "助理组长"
          : profile?.role === "admin"
            ? "管理"
            : "";

  const mobileActionableWaitingTasks = isAssistantProfile && profile
    ? assistantStartCandidateTasksForProfile(taskListRaw, areaTasks, profile.id, freeIroningMachineCount)
    : [];
  const afterCompleteSwapTask = isAssistantProfile && profile
    ? taskListRaw.find((task) =>
        task.assistantTransferRequests?.some((request) =>
          request.targetAssistantId === profile.id &&
          (request.status === "pending_after_complete" || request.status === "ready_to_takeover") &&
          request.responseMode === "after_complete"
        )
      ) ?? null
    : null;
  const afterCompleteSwapRequest = afterCompleteSwapTask?.assistantTransferRequests?.find((request) =>
    profile &&
    request.targetAssistantId === profile.id &&
    (request.status === "pending_after_complete" || request.status === "ready_to_takeover") &&
    request.responseMode === "after_complete"
  ) ?? null;
  const mobileRecommendedIroningTaskId = isAssistantProfile && profile && freeIroningMachineCount > 0
    ? mobileActionableWaitingTasks.find((task) => isIroningTask(task))?.id ?? null
    : null;

  const createMobileTask = useCallback(async (
    catName: string,
    dur: BuiltCategory["durations"][number],
  ) => {
    if (!profile) return;
    if (selectedQuickBookAssistant && !selectedQuickBookAssistantCanSubmit) {
      showTaskCreateError("指定助理当前暂不可接单，请重新选择");
      setMobileQuickBookAssistantPickerOpen(true);
      return;
    }
    const room = profileCurrentWorkbenchRoom || defaultBuildingVenue(taskPublishBuilding);
    const locationBuildingId = taskPublishBuildingId;
    if (!room || !locationBuildingId) {
      showTaskCreateError("当前楼座没有可用场地，无法创建任务");
      return;
    }

    const actionKey = workbenchProfileActionKey("create-mobile", profile.id);
    if (!beginWorkbenchPendingAction(actionKey)) return;
    const priority = parseInt(dur.priority.replace("P", ""), 10);
    const tempId = `temp-mobile-${Date.now()}`;
    const createdAt = new Date().toISOString();
    setTasks((prev) => sortTasksByStatus([
      {
        id: tempId,
        name: catName,
        room,
        time: dur.label,
        timePeriod: dur.label,
        estimatedLabel: dur.label,
        durationSlotLabel: dur.label,
        actualTime: "",
        progress: null,
        hasProgress: false,
        statusLabel: "等待中",
        statusCls: "bg-white/30 border-white/40",
        tagCls: "bg-gray-100/60 text-gray-500",
        isSpecified: Boolean(selectedQuickBookAssistant),
        specifiedAssistantName: selectedQuickBookAssistant?.name ?? null,
        assistantName: null,
        photographerName: profile.name,
        createdAt,
        estEndTime: null,
        publisherFeedback: null,
      },
      ...prev,
    ]));
    setTaskListScrollY(0);
    setMobileQuickBookCategory(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photographerId: profile.id,
          locationBuildingId,
          roomNumber: room,
          categoryId: dur.categoryId,
          priority: dur.priorityOverride ?? priority,
          quickBookSpecialType: dur.quickBookSpecialType,
          assistantId: selectedQuickBookAssistant?.id ?? undefined,
          isSpecified: Boolean(selectedQuickBookAssistant),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { code?: string; error?: string } | null;
        removeLocalTaskSources(tempId, { updateDisplay: true });
        showTaskCreateError(
          data?.error || "任务创建失败，请稍后重试",
          data?.code === "PHOTOGRAPHER_ACTIVE_TASK_LIMIT_REACHED" ||
            data?.code === "PHOTOGRAPHER_LIMIT_QUEUE_FULL",
        );
        return;
      }
      const saved = await response.json() as TaskFromAPI;
      upsertLocalTaskSource(saved, { replaceDisplayId: tempId });
      setSpecifiedQuickBookAssistantId(null);
      setQuickBookAssistantPickerOpen(false);
      setMobileQuickBookAssistantPickerOpen(false);
      if (isPhotographerLimitQueuedTask(saved)) {
        showTaskCreateError(photographerLimitQueuePrompt(photographerMaxActiveTasks), true);
      }
      refreshAssistants();
    } catch (error) {
      removeLocalTaskSources(tempId, { updateDisplay: true });
      showTaskCreateError("任务创建失败，请检查网络后重试");
      console.error("Failed to create mobile task", error);
    } finally {
      endWorkbenchPendingAction(actionKey);
    }
  }, [beginWorkbenchPendingAction, endWorkbenchPendingAction, photographerMaxActiveTasks, profile, profileCurrentWorkbenchRoom, refreshAssistants, removeLocalTaskSources, selectedQuickBookAssistant, selectedQuickBookAssistantCanSubmit, showTaskCreateError, taskPublishBuilding, taskPublishBuildingId, upsertLocalTaskSource]);

  const mobileTaskStatusForProfile = useCallback((task: TaskFromAPI) => (
    deriveMobileTaskStatusForProfile(task, { isAssistantProfile, profileId: profile?.id })
  ), [isAssistantProfile, profile?.id]);

  const mobileTaskStatusMeta = useCallback((task: TaskFromAPI) => {
    return deriveMobileTaskStatusMeta(task, {
      isAssistantProfile,
      profileId: profile?.id,
      nowMs: now.getTime(),
      dots: DOCK_DOT,
    });
  }, [isAssistantProfile, now, profile?.id]);

  const mobileTaskSubtitle = useCallback((task: TaskFromAPI) => {
    return deriveMobileTaskSubtitle(task, { isAssistantProfile });
  }, [isAssistantProfile]);

  const mobileTaskTimeLine = useCallback((task: TaskFromAPI) => {
    return deriveMobileTaskTimeLine(task, {
      isAssistantProfile,
      profileId: profile?.id,
      nowMs: now.getTime(),
    });
  }, [isAssistantProfile, now, profile?.id]);

  const canCancelRawTask = useCallback((task: TaskFromAPI | null | undefined) => {
    return profile?.role === "photographer" && canCancelTaskFromWorkbench(task, taskListRaw);
  }, [profile?.role, taskListRaw]);

  const renderEscalationBadge = useCallback((
    task: TaskFromAPI | null | undefined,
    options?: { className?: string; compact?: boolean }
  ) => {
    const label = priorityTransitionLabel(task ?? undefined);
    if (!label) return null;
    const approvedByReview = task?.priorityUpgradeRequests?.some((request) => request.status === "approved") ?? false;
    return (
      <span
        title={approvedByReview ? "审批通过提权" : "已提权任务"}
        className={`shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 align-middle font-extrabold text-red-500 ring-1 ring-red-100 ${options?.compact ? "text-[8px]" : "text-[9px]"} ${options?.className ?? ""}`}
      >
        {label}
      </span>
    );
  }, []);

  const renderPriorityUpgradeControl = useCallback((task: TaskFromAPI | null | undefined, compact = false) => {
    if (!task || profile?.role !== "photographer") return null;
    const pendingRequest = pendingPriorityUpgradeForTask(task);
    if (pendingRequest) {
      return (
        <span className={`inline-flex items-center justify-center rounded-lg bg-red-50 px-2 py-1 font-extrabold text-red-500 ${compact ? "text-[10px]" : "text-[9px]"}`}>
          提权待审批
        </span>
      );
    }
    if (!canRequestPriorityUpgrade(task)) return null;
    return (
      <button
        type="button"
        className={`inline-flex items-center justify-center rounded-lg bg-red-500 font-extrabold text-white shadow-sm shadow-red-500/20 transition-colors hover:bg-red-600 active:scale-[0.98] ${compact ? "min-h-[36px] px-3 text-[12px]" : "h-5 px-2 text-[9px]"}`}
        onClick={(event) => {
          event.stopPropagation();
          openPriorityUpgradeModal(task);
        }}
      >
        申请提权
      </button>
    );
  }, [canRequestPriorityUpgrade, openPriorityUpgradeModal, pendingPriorityUpgradeForTask, profile?.role]);

  const canOpenCompletionRegistration = useCallback((task: TaskFromAPI | null | undefined) => {
    if (!task || !profile || !isAssistantRole(profile.role)) return false;
    return (taskStatusForProfile(task, profile.id) ?? task.status) === "completed";
  }, [profile]);

  const renderCompletionRegistrationControl = useCallback((task: TaskFromAPI | null | undefined, compact = false) => {
    if (!task || !canOpenCompletionRegistration(task)) return null;
    const registered = Boolean(task.completionRegistration);
    return (
      <button
        type="button"
        className={`inline-flex items-center justify-center rounded-lg font-extrabold transition-colors active:scale-[0.98] ${
          registered
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/16"
            : "bg-orange-500/10 text-orange-600 hover:bg-orange-500/16"
        } ${compact ? "min-h-[34px] px-3 text-[12px]" : "h-5 px-2 text-[9px]"}`}
        onClick={(event) => {
          event.stopPropagation();
          openCompletionRegistrationModal(task);
        }}
      >
        {registered ? "查看登记" : "异常登记"}
      </button>
    );
  }, [canOpenCompletionRegistration, openCompletionRegistrationModal]);

  const mobileIcon = useCallback((name: MobileWorkbenchTab | "admin" | "logout" | "stats" | "identity") => {
    const common = "h-5 w-5";
    if (name === "map") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6Z" /><path d="M9 4v14" /><path d="M15 6v14" />
      </svg>
    );
    if (name === "queue") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 7h10" /><path d="M7 12h10" /><path d="M7 17h7" />
      </svg>
    );
    if (name === "me" || name === "identity") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
    if (name === "admin") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.6 7l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.3a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </svg>
    );
    if (name === "logout") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
      </svg>
    );
    if (name === "stats") return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
      </svg>
    );
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 11h14v9H5z" /><path d="M8 4h8v7H8z" />
      </svg>
    );
  }, []);

  const renderMobileTaskCard = useCallback((task: TaskFromAPI, options?: {
    compact?: boolean;
    primaryAction?: "start" | "complete" | "resume" | null;
    showCancel?: boolean;
    liveTimeLine?: boolean;
  }) => {
    const status = mobileTaskStatusForProfile(task);
    const timeLine = options?.liveTimeLine ? (
      <LiveMobileTaskTimeLine
        task={task}
        isAssistantProfile={isAssistantProfile}
        profileId={profile?.id}
      />
    ) : mobileTaskTimeLine(task);
    const specifiedName = task.specifiedAssistant?.name ?? (task.isSpecified ? task.assistant?.name ?? null : null);
    const primaryAction = options?.primaryAction ?? null;
    const isStartableIroning = primaryAction === "start" && isIroningTask(task);
    const meta = isStartableIroning
      ? { ...mobileTaskStatusMeta(task), label: "准备熨烫", dot: "#84cc16", badge: "bg-lime-100/80 text-lime-700", panel: "bg-lime-400/14" }
      : mobileTaskStatusMeta(task);
    const subtitleHint = isStartableIroning && mobileRecommendedIroningTaskId === task.id
      ? "机器空闲建议优先"
      : null;
    const actionLabel =
      primaryAction === "complete"
        ? "完成任务"
        : primaryAction === "resume"
          ? "继续任务"
	            : primaryAction === "start"
	            ? isIroningTask(task) ? "开始熨烫" : "开始任务"
	            : "";
    const canStart = primaryAction === "start" && status === "waiting";
    const canComplete = primaryAction === "complete" && status === "executing";
    const canResume = primaryAction === "resume";
    const primaryActionPending = primaryAction === "resume"
      ? isWorkbenchPendingAction(workbenchTaskActionKey("resume", task.id, profile?.id)) ||
        isWorkbenchPendingAction(workbenchTaskActionKey("start", task.id, profile?.id))
      : primaryAction != null
        ? isWorkbenchPendingAction(workbenchTaskActionKey(primaryAction, task.id, profile?.id))
        : false;
    const pausePending = isWorkbenchPendingAction(workbenchTaskActionKey("pause", task.id, profile?.id));
    const cancelPending = isWorkbenchPendingAction(workbenchTaskActionKey("cancel", task.id, profile?.id));
    const priorityControl = renderPriorityUpgradeControl(task, true);
    const completionControl = renderCompletionRegistrationControl(task, true);
    const footerControls = priorityControl || completionControl
      ? <div className="flex flex-wrap gap-2">{priorityControl}{completionControl}</div>
      : null;
    return (
      <MobileTaskCard
        key={task.id}
        task={task}
        meta={meta}
        title={task.category?.name ?? "任务"}
        subtitle={mobileTaskSubtitle(task)}
        timeLine={timeLine}
        actionLabel={actionLabel}
        glassPanelClassName={mobileGlassPanel}
        compact={options?.compact}
        featured={mobileRecommendedIroningTaskId === task.id && primaryAction === "start"}
        note={task.note}
        specifiedName={specifiedName}
        subtitleHint={subtitleHint}
        escalationBadge={renderEscalationBadge(task)}
        footer={footerControls}
        primaryAction={primaryAction}
        showCancel={options?.showCancel}
        primaryActionPending={primaryActionPending}
        pausePending={pausePending}
        cancelPending={cancelPending}
        onPrimaryAction={() => {
          if (canStart || canComplete) void handleAssistantStatusChange(primaryAction, task);
          if (canResume) void handleResumePausedTask(task);
        }}
        onPause={handlePauseCurrentTask}
        onCancel={() => handleCancelTask(task.id)}
      />
    );
  }, [handleAssistantStatusChange, handleCancelTask, handlePauseCurrentTask, handleResumePausedTask, isAssistantProfile, isWorkbenchPendingAction, mobileGlassPanel, mobileRecommendedIroningTaskId, mobileTaskStatusForProfile, mobileTaskStatusMeta, mobileTaskSubtitle, mobileTaskTimeLine, profile?.id, renderCompletionRegistrationControl, renderEscalationBadge, renderPriorityUpgradeControl]);

  const mobileCreatePending = profile
    ? isWorkbenchPendingAction(workbenchProfileActionKey("create-mobile", profile.id))
    : false;

  const renderMobileCurrentView = useCallback(() => {
    if (isAssistantProfile) {
      const renderMobilePausedEatingStrip = () => (
        <div className={`flex min-h-[58px] items-center gap-3 rounded-[20px] border px-4 py-3 backdrop-blur-2xl ${mobileGlassPanel} bg-sky-400/12`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15">
            <span className="h-3.5 w-3.5 rounded-full bg-sky-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-extrabold text-sky-600">吃饭已暂停</p>
            <p className="mt-0.5 truncate font-mono text-[12px] font-semibold tabular-nums text-sky-600/75">
              暂停中 <LiveEatingHMS startedAt={profile?.eatingPausedAt} mode="paused" /> · 已吃饭 {formatSecondsAsHMS(eatingPausedSeconds)}
            </p>
          </div>
          <button
            type="button"
            disabled={!profile}
            onClick={() => profile && void updateAssistantPresenceStatus(profile.id, "eating")}
            className="min-h-[34px] shrink-0 rounded-full bg-sky-500 px-3 text-[12px] font-extrabold text-white shadow-lg shadow-sky-500/20 disabled:opacity-50"
          >
            继续
          </button>
        </div>
      );
      const withMobilePausedEatingStrip = (content: ReactNode) =>
        eatingIsPaused ? (
          <div className="space-y-3">
            {renderMobilePausedEatingStrip()}
            {content}
          </div>
        ) : content;

      if (assistantPresence === "eating") {
        return (
          <LiveEatingTimerState
            startedAt={eatingStartedAt}
            accumulatedSeconds={profile?.eatingAccumulatedSeconds}
            thresholdSeconds={eatingOvertimeAlertMin * 60}
          >
            {({ elapsedText, isOvertime }) => (
              <div className={`rounded-[24px] border p-5 text-center backdrop-blur-2xl ${mobileGlassPanel} ${isOvertime ? "bg-red-400/12" : "bg-blue-400/12"}`}>
                <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${isOvertime ? "bg-red-500/15" : "bg-blue-500/15"}`}>
                  <span className={`h-8 w-8 rounded-full ${isOvertime ? "bg-red-500" : "bg-blue-500"} pulse-dot`} />
                </div>
                <h2 className={`text-[28px] font-extrabold ${isOvertime ? "text-red-600" : "text-blue-600"}`}>
                  {isOvertime ? "吃饭超时" : "吃饭中"}
                </h2>
                <p className={`mt-2 font-mono text-[26px] font-semibold tabular-nums ${isOvertime ? "text-red-600" : "text-blue-600"}`}>
                  {elapsedText}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!profile}
                    onClick={() => profile && void updateAssistantPresenceStatus(profile.id, "online", { eatingExitMode: "pause" })}
                    className="min-h-[46px] rounded-2xl bg-blue-500 px-3 text-[13px] font-extrabold text-white shadow-lg shadow-blue-500/20 disabled:opacity-50"
                  >
                    暂停吃饭并回在线
                  </button>
                  <button
                    type="button"
                    disabled={!profile}
                    onClick={() => profile && void updateAssistantPresenceStatus(profile.id, "online", { eatingExitMode: "end" })}
                    className="min-h-[46px] rounded-2xl bg-emerald-500 px-3 text-[13px] font-extrabold text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    结束吃饭
                  </button>
                </div>
              </div>
            )}
          </LiveEatingTimerState>
        );
      }

      if (activeReassignmentNotice) {
        const activeReassignmentNoticeIsWarning = activeReassignmentNoticeRole === "old" && !activeReassignmentKeepsOldOnline;
        return withMobilePausedEatingStrip(
          <div className={`rounded-[24px] border p-5 backdrop-blur-2xl ${mobileGlassPanel} ${activeReassignmentNoticeIsWarning ? "bg-red-400/12" : "bg-purple-400/12"}`}>
            <p className={`text-[13px] font-extrabold leading-relaxed ${activeReassignmentNoticeIsWarning ? "text-red-600" : "text-purple-600"}`}>{activeReassignmentMessage}</p>
            <button
              type="button"
              disabled={reassignmentNoticeSavingId === activeReassignmentNotice.id}
              onClick={() => void handleAcknowledgeReassignmentNotice(
                activeReassignmentNotice,
                activeReassignmentNoticeRole === "old" ? "acknowledgeOld" : "acknowledgeNew",
              )}
              className={`mt-4 min-h-[44px] w-full rounded-2xl px-4 text-[14px] font-extrabold text-white shadow-lg disabled:opacity-60 ${activeReassignmentNoticeIsWarning ? "bg-red-500 shadow-red-500/20" : "bg-purple-500 shadow-purple-500/20"}`}
            >
              确认
            </button>
          </div>
        );
      }

      if (!currentRawTask && !pausedRawTask && mobileActionableWaitingTasks.length === 0) {
        const off = assistantPresence === "on_break";
        return withMobilePausedEatingStrip(
          <div className={`rounded-[24px] border p-6 text-center backdrop-blur-2xl ${mobileGlassPanel} ${off ? "bg-gray-400/12" : "bg-green-400/12"}`}>
            <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${off ? "bg-gray-500/15" : "bg-green-500/15"}`}>
              <span className={`h-8 w-8 rounded-full ${off ? "bg-gray-400" : "bg-green-500"}`} />
            </div>
            <h2 className={`text-[30px] font-extrabold ${off ? "text-gray-500" : "text-green-600"}`}>
              {off ? "休假/下班 /离线" : "空闲"}
            </h2>
            <p className={`mt-2 text-[12px] font-semibold ${off ? "text-gray-500/70" : "text-green-600/70"}`}>
              {off ? "当前不会接收新任务" : "等待系统派发任务"}
            </p>
          </div>
        );
      }

      if (!pausedRawTask && mobileActionableWaitingTasks.length > 1) {
        return withMobilePausedEatingStrip(
          <div className="space-y-3">
            <div className={`rounded-[20px] border px-4 py-3 backdrop-blur-2xl ${mobileGlassPanel}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-extrabold text-[--text-primary]">选择要开始的任务</h2>
                <span className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-extrabold text-orange-500">{mobileActionableWaitingTasks.length} 个可选</span>
              </div>
            </div>
            {mobileActionableWaitingTasks.map((task) => renderMobileTaskCard(task, { primaryAction: "start" }))}
          </div>
        );
      }

      if (currentRawTask) {
        const status = mobileTaskStatusForProfile(currentRawTask);
        const primaryAction = status === "executing" ? "complete" : status === "waiting" ? "start" : null;
        const currentCard = renderMobileTaskCard(currentRawTask, { primaryAction, showCancel: canCancelRawTask(currentRawTask), liveTimeLine: true });
        if (afterCompleteSwapTask && afterCompleteSwapTask.id !== currentRawTask.id) {
          return withMobilePausedEatingStrip(
            <div className="space-y-2">
              {currentCard}
              <div className={`rounded-[18px] border px-4 py-2 backdrop-blur-2xl ${mobileGlassPanel} bg-purple-400/10`}>
                <p className="truncate text-[12px] font-extrabold text-purple-600">
                  {afterCompleteSwapRequest?.status === "ready_to_takeover" ? "点击开始接替" : "结束后前往"} · {afterCompleteSwapTask.roomNumber}室 · {afterCompleteSwapTask.category?.name ?? "任务"}
                </p>
              </div>
            </div>
          );
        }
        return withMobilePausedEatingStrip(currentCard);
      }

      if (pausedRawTask) {
        return withMobilePausedEatingStrip(renderMobileTaskCard(pausedRawTask, { primaryAction: "resume", showCancel: canCancelRawTask(pausedRawTask), liveTimeLine: true }));
      }

      return eatingIsPaused ? renderMobilePausedEatingStrip() : null;
    }

    if (profile?.role === "photographer") {
      const selectedCategory = categories.find((cat) => cat.name === mobileQuickBookCategory) ?? null;
      return (
        <div className="space-y-4">
          <MobileQuickBookingPanel
            categories={categories}
            selectedCategory={selectedCategory}
            selectedAssistant={selectedQuickBookAssistant}
            selectedAssistantCanSubmit={selectedQuickBookAssistantCanSubmit}
            selectedAssistantId={specifiedQuickBookAssistantId}
            pickerOpen={mobileQuickBookAssistantPickerOpen}
            onlineAssistants={quickBookOnlineAssistants}
            workbenchLocationText={workbenchLocationText}
            glassPanelClassName={mobileGlassPanel}
            softPanelClassName={mobileSoftPanel}
            isDark={resolvedTheme === "dark"}
            createPending={mobileCreatePending}
            onTogglePicker={() => setMobileQuickBookAssistantPickerOpen((open) => !open)}
            onClearAssistant={() => setSpecifiedQuickBookAssistantId(null)}
            onSelectAssistant={(assistantId) => {
              setSpecifiedQuickBookAssistantId(assistantId);
              setMobileQuickBookAssistantPickerOpen(false);
            }}
            onToggleCategory={(categoryName) => setMobileQuickBookCategory((current) => current === categoryName ? null : categoryName)}
            onCreateTask={(categoryName, duration) => void createMobileTask(categoryName, duration)}
            canSpecifyAssistant={canSpecifyQuickBookAssistant}
            assistantStatusText={quickBookAssistantStatusText}
            assistantDotColor={assistantDockDotColor}
          />
          <div className={`rounded-[24px] border p-4 backdrop-blur-2xl ${mobileGlassPanel}`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-extrabold text-[--text-primary]">当前发布任务</h2>
              <span className="text-[11px] font-bold text-[--text-muted]">{tasks.filter((task) => task.statusLabel !== "已完成").length} 条进行中</span>
            </div>
            <div className="space-y-2">
              {taskListRaw.filter((task) => task.status !== "completed").slice(0, 4).map((task) => renderMobileTaskCard(task, {
                compact: true,
                showCancel: canCancelRawTask(task) || isPhotographerLimitQueuedTask(task),
              }))}
              {taskListRaw.filter((task) => task.status !== "completed").length === 0 && (
                <p className="rounded-2xl bg-white/42 px-4 py-6 text-center text-[12px] font-semibold text-[--text-muted]">暂无进行中的发布任务</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className={`rounded-[24px] border p-4 backdrop-blur-2xl ${mobileGlassPanel}`}>
          <h2 className="text-[17px] font-extrabold text-[--text-primary]">管理工作台</h2>
          <p className="mt-1 text-[12px] font-semibold text-[--text-muted]">手机端保留关键状态与后台入口</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["队列", publicQueueTasks.length, "text-orange-500"],
              ["执行", areaRealtimeStats.executing, "text-green-600"],
              ["超时", areaRealtimeStats.overtime, "text-red-600"],
            ].map(([label, value, cls]) => (
              <div key={label} className={`rounded-2xl border p-3 text-center ${mobileSoftPanel}`}>
                <p className={`text-[24px] font-extrabold ${cls}`}>{value}</p>
                <p className="mt-1 text-[11px] font-bold text-[--text-muted]">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <a href="/admin" className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 text-[14px] font-extrabold text-white shadow-lg shadow-orange-500/20">
          {mobileIcon("admin")}
          进入后台管理
        </a>
      </div>
    );
  }, [
    activeReassignmentMessage,
    activeReassignmentNotice,
    activeReassignmentNoticeRole,
    afterCompleteSwapRequest,
    afterCompleteSwapTask,
    areaRealtimeStats.executing,
    areaRealtimeStats.overtime,
    assistantPresence,
    canCancelRawTask,
    categories,
    createMobileTask,
    eatingIsPaused,
    eatingPausedSeconds,
    freeIroningMachineCount,
    handleAcknowledgeReassignmentNotice,
    isAssistantProfile,
    mobileActionableWaitingTasks,
    mobileGlassPanel,
    mobileIcon,
    mobileCreatePending,
    mobileQuickBookCategory,
    mobileQuickBookAssistantPickerOpen,
    mobileRecommendedIroningTaskId,
    mobileSoftPanel,
    mobileTaskStatusForProfile,
    pausedRawTask,
    profile,
    publicQueueTasks.length,
    reassignmentNoticeSavingId,
    renderMobileTaskCard,
    resolvedTheme,
    quickBookOnlineAssistants,
    selectedQuickBookAssistant,
    selectedQuickBookAssistantCanSubmit,
    specifiedQuickBookAssistantId,
    currentRawTask,
    taskListRaw,
    tasks,
    updateAssistantPresenceStatus,
    workbenchLocationText,
  ]);

  const renderMobileMapView = useCallback(() => {
    const venueCoords = new Map<string, { x: number; y: number }>();
    for (const venue of safeExtraVenueEntries(activeBuilding?.extraVenues)) {
      if (typeof venue.x === "number" && typeof venue.y === "number") {
        venueCoords.set(venue.name, { x: venue.x, y: venue.y });
      }
    }
    const visibleAssistants = assistants
      .filter((assistant) => assistant.currentRoom || assistant.pausedRoom || assistant.pendingRoom || assistant.preemptedWaitingRoom)
      .slice(0, 28);
    const markerForRoom = (roomName: string | null | undefined) => {
      if (!roomName || !activeBuilding) return null;
      const room = activeBuilding.rooms.find((item) => item.roomNumber === roomName || `${item.roomNumber}室` === roomName);
      const venue = room ? null : venueCoords.get(roomName);
      const x = room?.xPosition ?? venue?.x;
      const y = room?.yPosition ?? venue?.y;
      if (x == null || y == null) return null;
      return { x, y };
    };

    return (
      <div className="space-y-4">
        <div className={`rounded-[24px] border p-3 backdrop-blur-2xl ${mobileGlassPanel}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-extrabold text-[--text-primary]">区域平面图</h2>
              <p className="mt-1 text-[12px] font-semibold text-[--text-muted]">{activeBuilding?.name ?? "加载中"}</p>
            </div>
            <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-[11px] font-extrabold text-green-600">{areaAssistantStats.total}人</span>
          </div>
          {mapBuildingOptions.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {[activeBuilding, ...mapBuildingOptions].filter(Boolean).map((building) => (
                <button
                  type="button"
                  key={building!.id}
                  onClick={() => setActiveBuildingId(building!.id)}
                  className={`min-h-[36px] shrink-0 rounded-full px-3 text-[12px] font-extrabold ${
                    building!.id === activeBuildingId
                      ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                      : "bg-white/54 text-[--text-secondary]"
                  }`}
                >
                  {building!.name}
                </button>
              ))}
            </div>
          )}
          <div className={`relative aspect-[4/5] overflow-hidden rounded-[24px] border ${mobileSoftPanel}`}>
            {activeBuilding?.floorPlanUrl ? (
              <>
                <img
                  src={activeBuilding.floorPlanUrl}
                  alt={activeBuilding.name}
                  className="h-full w-full object-contain"
                  style={{ filter: "var(--map-filter)" }}
                />
                <div className="pointer-events-none absolute inset-0 opacity-70" style={{
                  backgroundImage:
                    resolvedTheme === "dark"
                      ? "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)"
                      : "linear-gradient(rgba(67,82,104,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(67,82,104,0.05) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }} />
                {visibleAssistants.map((assistant) => {
                  const pos = markerForRoom(assistant.currentRoom ?? assistant.pendingRoom ?? assistant.pausedRoom ?? assistant.preemptedWaitingRoom);
                  if (!pos) return null;
                  const dot = assistantDockDotColor(assistant);
                  return (
                    <div
                      key={`mobile-map-${assistant.id}`}
                      className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                      title={`${assistant.name} · ${formatRoomOrVenue(assistant.currentRoom)}`}
                    >
                      <span className="absolute -inset-1 rounded-full bg-white/70 blur-[2px]" />
                      <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[11px] font-extrabold text-white ring-2 ring-white shadow-sm">
                        {assistant.avatar ? <img src={assistant.avatar} alt={assistant.name} className="h-full w-full object-cover" /> : assistant.name.slice(0, 1)}
                      </span>
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: dot }} />
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[13px] font-semibold text-[--text-muted]">
                {activeBuilding ? `${activeBuilding.name} 暂无平面图` : "加载中..."}
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              ["空闲", areaAssistantStats.idle, DOCK_DOT.idle],
              ["待就位", areaAssistantStats.assigned, DOCK_DOT.assigned],
              ["进行", areaRealtimeStats.executing, DOCK_DOT.inProgress],
              ["超时", areaRealtimeStats.overtime, DOCK_DOT.overtime],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-2xl bg-white/44 px-2 py-2 text-center">
                <span className="mx-auto block h-2 w-2 rounded-full" style={{ backgroundColor: color as string }} />
                <p className="mt-1 text-[14px] font-extrabold text-[--text-primary]">{value}</p>
                <p className="text-[10px] font-bold text-[--text-muted]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }, [activeBuilding, activeBuildingId, areaAssistantStats.assigned, areaAssistantStats.idle, areaAssistantStats.total, areaRealtimeStats.executing, areaRealtimeStats.overtime, assistants, mapBuildingOptions, mobileGlassPanel, mobileSoftPanel, resolvedTheme]);

  const renderMobileQueueView = useCallback(() => (
    <div className="space-y-3">
      <div className={`rounded-[20px] border px-4 py-3 backdrop-blur-2xl ${mobileGlassPanel}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold text-[--text-primary]">公共队列</h2>
          <span className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-extrabold text-orange-500">{publicQueueDisplayTasks.length} 条</span>
        </div>
      </div>
      {publicQueueDisplayTasks.length === 0 ? (
        <p className={`rounded-[20px] border px-4 py-8 text-center text-[13px] font-semibold text-[--text-muted] ${mobileSoftPanel}`}>
          当前区域暂无公共队列
        </p>
      ) : publicQueueDisplayTasks.map((task, index) => {
        const display = apiTaskToDisplay(task);
        const statusInfo = publicQueueStatusInfo(task, publicQueueRaw);
        const timeLine = taskListActualLine(display, task, now.getTime(), true);
        return (
          <div key={`mobile-public-${task.id}`} className={`rounded-[20px] border p-4 backdrop-blur-2xl ${mobileGlassPanel}`}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex shrink-0 items-center justify-center text-[10px] font-extrabold shadow-sm ${publicQueueRankShapeCls(index, task.priority)}`}>
                {publicQueueRankLabel(index, task.priority)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-extrabold text-[--text-primary]">{display.name}</h3>
                    <p className="mt-1 truncate text-[12px] font-semibold text-[--text-muted]">
                      {formatRoomOrVenue(task.roomNumber)} · {task.photographer?.name ?? "摄影师"} · {display.durationSlotLabel}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold ${statusInfo.cls}`}>{statusInfo.label}</span>
                </div>
                {timeLine && <p className="mt-2 text-[11px] font-bold text-[--text-muted]">{timeLine}</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  ), [mobileGlassPanel, mobileSoftPanel, now, publicQueueDisplayTasks, publicQueueRaw]);

  const renderMobileMeView = useCallback(() => (
    <div className="space-y-4">
      <div className={`rounded-[24px] border p-4 backdrop-blur-2xl ${mobileGlassPanel}`}>
        <h2 className="text-[16px] font-extrabold text-[--text-primary]">我的任务</h2>
        <div className="mt-3 space-y-2">
          {taskListRaw.slice(0, 8).map((task) => renderMobileTaskCard(task, {
            compact: true,
            primaryAction: isAssistantProfile && mobileTaskStatusForProfile(task) === "waiting" ? "start" : null,
            showCancel: canCancelRawTask(task) || isPhotographerLimitQueuedTask(task),
          }))}
          {taskListRaw.length === 0 && (
            <p className="rounded-2xl bg-white/42 px-4 py-8 text-center text-[12px] font-semibold text-[--text-muted]">暂无任务</p>
          )}
        </div>
      </div>
      <div className={`rounded-[24px] border p-4 backdrop-blur-2xl ${mobileGlassPanel}`}>
        <h2 className="text-[16px] font-extrabold text-[--text-primary]">快捷入口</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(loginRole === "admin" || loginRole === "assistant_leader") && (
            <>
              <button
                type="button"
                onClick={() => setShowIdentityModal(true)}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-white/54 px-3 text-[13px] font-extrabold text-[--text-primary]"
              >
                {mobileIcon("identity")}
                切换身份
              </button>
              <a href="/admin" className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-white/54 px-3 text-[13px] font-extrabold text-[--text-primary]">
                {mobileIcon("admin")}
                后台管理
              </a>
            </>
          )}
          {(loginRole === "photographer" || loginRole === "assistant") && (
            <a href="/stats" className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-white/54 px-3 text-[13px] font-extrabold text-[--text-primary]">
              {mobileIcon("stats")}
              数据统计
            </a>
          )}
          <a
            href="/"
            onClick={() => { safeLocalStorageRemove("user"); safeLocalStorageRemove("currentProfileId"); }}
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-white/54 px-3 text-[13px] font-extrabold text-[--text-primary]"
          >
            {mobileIcon("logout")}
            返回登录
          </a>
        </div>
      </div>
    </div>
  ), [canCancelRawTask, isAssistantProfile, loginRole, mobileGlassPanel, mobileIcon, mobileTaskStatusForProfile, renderMobileTaskCard, taskListRaw]);

  const renderMobileWorkbench = () => {
    const mobileNavItems: { key: MobileWorkbenchTab; label: string }[] = [
      { key: "current", label: "当前" },
      { key: "map", label: "地图" },
      { key: "queue", label: "队列" },
      { key: "me", label: "我的" },
    ];
    const identityLoading = !profile && !needsIdentitySelection && identityUrlState !== "absent";
    const identityRequired = !identityLoading && (needsIdentitySelection || !profile);
    return (
      <div
        className="relative z-30 flex h-full flex-col overflow-hidden px-3 lg:hidden"
        style={{
          backgroundColor: resolvedTheme === "dark" ? "#0f1117" : "#eef1f5",
          backgroundImage: workbenchPageBackground ? `url(${workbenchPageBackground})` : undefined,
          backgroundSize: workbenchPageBackground ? "cover" : undefined,
          backgroundPosition: workbenchPageBackground ? "center" : undefined,
          paddingTop: "max(env(safe-area-inset-top), 12px)",
        }}
      >
        {workbenchPageBackground && <div className="readable-page-scrim" />}
        <div className="pointer-events-none absolute inset-0 z-0 opacity-80" style={{
          backgroundImage:
            resolvedTheme === "dark"
              ? "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)"
              : "linear-gradient(rgba(67,82,104,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(67,82,104,0.045) 1px, transparent 1px)",
          backgroundSize: "38px 38px",
        }} />
        <div className="relative z-[1] shrink-0">
          <div className={`relative rounded-[24px] border px-4 py-3 backdrop-blur-2xl ${mobileGlassPanel}`}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAvatarModal(true)}
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-orange-200 to-orange-400 text-[20px] font-extrabold text-white shadow-md shadow-orange-200/40 ring-2 ring-white/70"
                aria-label="更换头像"
              >
                {profile?.avatar ? <img src={profile.avatar} alt={profile.name} className="h-full w-full object-cover" /> : profile?.name?.slice(0, 1) || "?"}
                {isAssistantProfile && (
                  <LivePresenceDot
                    className="absolute bottom-1 right-1 h-3 w-3 rounded-full ring-2 ring-white"
                    baseColor={assistantPresenceInfo.dot}
                    isEating={assistantPresence === "eating"}
                    startedAt={eatingStartedAt}
                    accumulatedSeconds={profile?.eatingAccumulatedSeconds}
                    thresholdSeconds={eatingOvertimeAlertMin * 60}
                  />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-extrabold text-[--text-primary]">
                  {profile?.name || "加载中"}{mobileRoleLabel ? ` · ${mobileRoleLabel}` : ""}
                </p>
                <p className="mt-1 truncate text-[12px] font-semibold text-[--text-muted]">{workbenchLocationText}</p>
              </div>
              {isAssistantProfile ? (
                <div className="relative">
                  <button
                    type="button"
                    disabled={!assistantCanChangePresence}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAssistantPresenceMenu((open) => !open);
                    }}
                    className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[12px] font-extrabold ${assistantPresenceInfo.bgCls} ${assistantPresenceInfo.textCls} disabled:opacity-60`}
                  >
                    <LivePresenceDot
                      className="h-2 w-2 rounded-full"
                      baseColor={assistantPresenceInfo.dot}
                      isEating={assistantPresence === "eating"}
                      startedAt={eatingStartedAt}
                      accumulatedSeconds={profile?.eatingAccumulatedSeconds}
                      thresholdSeconds={eatingOvertimeAlertMin * 60}
                    />
                    {assistantPresenceInfo.shortLabel}
                  </button>
                  {showAssistantPresenceMenu && (
                    <div className={`absolute right-0 top-full z-40 mt-2 w-36 rounded-2xl border p-1.5 backdrop-blur-2xl ${mobileGlassPanel}`}>
                      {(["online", "eating", "on_break"] as AssistantPresenceState[]).map((state) => {
                        const meta = assistantPresenceMeta(state);
                        const selected = assistantPresence === state;
                        return (
                          <button
                            type="button"
                            key={state}
                            disabled={selected || !profile}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!profile || selected) return;
                              setShowAssistantPresenceMenu(false);
                              void updateAssistantPresenceStatus(profile.id, state);
                            }}
                            className={`mb-1 flex min-h-[38px] w-full items-center gap-2 rounded-xl px-3 text-left text-[12px] font-extrabold last:mb-0 disabled:opacity-60 ${
                              selected ? `${meta.bgCls} ${meta.textCls}` : "bg-white/44 text-[--text-secondary]"
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dot }} />
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <span className="rounded-full bg-orange-500/10 px-3 py-2 text-[12px] font-extrabold text-orange-500">{mobileRoleLabel}</span>
              )}
            </div>
            {assistantNoteTask?.note?.trim() && (
              <div className="mt-3 rounded-2xl bg-orange-500/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-orange-600">
                {assistantNoteTask.note.trim()}
              </div>
            )}
          </div>
        </div>
        <main
          className="relative z-[1] min-h-0 flex-1 overflow-y-auto px-1 pt-4 scrollbar-none"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}
        >
          {identityLoading ? (
            <div className={`rounded-[24px] border p-5 text-center backdrop-blur-2xl ${mobileGlassPanel}`}>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/12 text-[28px] font-black text-orange-500">
                ...
              </div>
              <h2 className="text-[22px] font-extrabold text-[--text-primary]">正在加载身份</h2>
              <p className="mt-2 text-[12px] font-semibold leading-relaxed text-[--text-muted]">
                正在同步手机端身份与任务数据。
              </p>
            </div>
          ) : identityRequired ? (
            <div className={`rounded-[24px] border p-5 text-center backdrop-blur-2xl ${mobileGlassPanel}`}>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/12 text-[28px] font-black text-orange-500">
                ?
              </div>
              <h2 className="text-[22px] font-extrabold text-[--text-primary]">选择身份继续</h2>
              <p className="mt-2 text-[12px] font-semibold leading-relaxed text-[--text-muted]">
                手机首次访问需要选择当前使用人，选择后页面、数据和电脑端手机预览会保持一致。
              </p>
              <button
                type="button"
                onClick={() => setShowIdentityModal(true)}
                className="mt-5 min-h-[48px] w-full rounded-2xl bg-orange-500 px-4 text-[14px] font-extrabold text-white shadow-lg shadow-orange-500/20 active:scale-[0.99]"
              >
                选择身份
              </button>
            </div>
          ) : (
            <>
              {mobileTab === "current" && renderMobileCurrentView()}
              {mobileTab === "map" && renderMobileMapView()}
              {mobileTab === "queue" && renderMobileQueueView()}
              {mobileTab === "me" && renderMobileMeView()}
            </>
          )}
        </main>
        <nav className={`fixed bottom-3 left-3 right-3 z-40 grid grid-cols-4 gap-1.5 rounded-[24px] border p-2 backdrop-blur-2xl lg:hidden ${mobileGlassPanel}`}>
          {mobileNavItems.map((item) => {
            const active = mobileTab === item.key;
            return (
              <button
                type="button"
                key={item.key}
                onClick={() => setMobileTab(item.key)}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[18px] text-[10px] font-extrabold transition-colors ${
                  active ? "bg-orange-500/12 text-orange-500" : "text-[--text-muted]"
                }`}
              >
                {mobileIcon(item.key)}
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    );
  };

  const taskCreateNoticeCls = taskCreateNoticeTone === "success"
    ? resolvedTheme === "dark"
      ? "border-emerald-300/25 bg-emerald-950/90 text-emerald-200 shadow-black/50"
      : "border-emerald-100 bg-white/94 text-emerald-600 shadow-emerald-200/35"
    : taskCreateNoticeTone === "transfer"
      ? resolvedTheme === "dark"
        ? "border-purple-300/25 bg-purple-950/90 text-purple-100 shadow-black/50"
        : "border-purple-100 bg-white/94 text-purple-600 shadow-purple-200/35"
    : taskCreateNoticeTone === "info"
      ? resolvedTheme === "dark"
        ? "border-blue-300/25 bg-slate-950/92 text-blue-200 shadow-black/50"
        : "border-blue-100 bg-white/94 text-blue-600 shadow-blue-200/35"
      : resolvedTheme === "dark"
        ? "border-red-300/25 bg-slate-950/92 text-red-200 shadow-black/50"
        : "border-red-100 bg-white/94 text-red-600 shadow-red-200/35";
  const taskCreateNoticeDotCls = taskCreateNoticeTone === "success"
    ? "bg-emerald-500"
    : taskCreateNoticeTone === "transfer"
      ? "bg-purple-500"
    : taskCreateNoticeTone === "info"
      ? "bg-blue-500"
      : "bg-red-500";

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {taskCreateError && (
        <div className="pointer-events-none fixed inset-0 z-[220] flex items-center justify-center px-4">
          <div className={`grid w-[min(460px,calc(100vw-32px))] grid-cols-[10px_minmax(0,1fr)] items-start gap-3 rounded-3xl border px-5 py-3 text-left text-[13px] font-extrabold leading-relaxed shadow-2xl backdrop-blur-2xl ${taskCreateNoticeCls} ${
	          taskCreateLimitWarning ? "collab-limit-shake" : ""
	        }`}>
            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${taskCreateNoticeDotCls}`} />
            <span className="min-w-0 text-pretty">{taskCreateError}</span>
          </div>
        </div>
      )}
      {presenceSwitchConfirm && (
        <div
          className="fixed inset-0 z-[221] flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
          onMouseDown={() => setPresenceSwitchConfirm(null)}
        >
          <div
            className={`w-full max-w-sm rounded-3xl border p-5 text-center shadow-2xl ${resolvedTheme === "dark" ? "border-white/[0.16] bg-slate-950/92 shadow-black/50" : "border-white/75 bg-white/92 shadow-slate-300/40"}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-600">
              <span className="h-5 w-5 rounded-full bg-orange-500" />
            </div>
            <h3 className="mt-4 text-[17px] font-extrabold text-[--text-primary]">当前任务正在进行</h3>
            <p className="mt-2 text-[12px] font-semibold leading-relaxed text-[--text-secondary]">
              {presenceSwitchConfirm.taskLabel} 正在工作中。切换状态前需要先暂停当前任务，确认继续吗？
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setPresenceSwitchConfirm(null)}
                className="min-h-[42px] flex-1 rounded-2xl bg-white/56 px-4 text-[13px] font-extrabold text-[--text-secondary] transition-colors hover:bg-white/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const pending = presenceSwitchConfirm;
                  setPresenceSwitchConfirm(null);
                  void updateAssistantPresenceStatus(pending.profileId, pending.nextState, {
                    eatingExitMode: pending.eatingExitMode,
                    skipActiveTaskConfirm: true,
                  });
                }}
                className="min-h-[42px] flex-1 rounded-2xl bg-orange-500 px-4 text-[13px] font-extrabold text-white shadow-lg shadow-orange-500/20 transition-colors hover:bg-orange-600"
              >
                暂停并切换
              </button>
            </div>
          </div>
        </div>
      )}
      {renderMobileWorkbench()}
      {/* ====== INTERACTIVE BIRD'S-EYE MAP ====== */}
      <div
        className="absolute inset-0 hidden overflow-hidden transition-colors duration-700 lg:block"
        style={{
          backgroundColor: resolvedTheme === "dark" ? "#0f1117" : "#f2f2f4",
          backgroundImage: workbenchPageBackground ? `url(${workbenchPageBackground})` : undefined,
          backgroundSize: workbenchPageBackground ? "cover" : undefined,
          backgroundPosition: workbenchPageBackground ? "center" : undefined,
          backgroundRepeat: workbenchPageBackground ? "no-repeat" : undefined,
        }}
      >
        {workbenchPageBackground && <div className="readable-page-scrim" />}
        <div
          className="absolute z-[8] grid min-h-0 transition-[grid-template-rows,row-gap] duration-[680ms] ease-[cubic-bezier(.22,1,.36,1)]"
          style={{
            left: "max(354px, calc(3vw + 321.5px))",
            right: "max(97px, calc(3vw + 42px))",
            top: 36,
            bottom: 36,
            gridTemplateRows: areaDataPanelOpen
              ? "minmax(0, 3fr) minmax(0, 2fr)"
              : "minmax(0, 1fr) minmax(0, 0fr)",
            rowGap: areaDataPanelOpen ? "12px" : "0px",
          }}
        >
          <div
            ref={mapContainerRef}
	            className={`relative min-h-0 overflow-hidden rounded-[48px] border ring-1 backdrop-blur-[26px] transition-all duration-700 ${
	              resolvedTheme === "dark"
	                ? "border-white/[0.18] bg-slate-950/45 shadow-[0_34px_100px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.20),inset_0_0_0_1px_rgba(255,255,255,0.08)] ring-white/[0.10]"
	                : "border-white/85 bg-white/50 shadow-[0_30px_90px_rgba(56,68,89,0.14),inset_0_1px_0_rgba(255,255,255,0.92),inset_0_0_0_1px_rgba(255,255,255,0.52)] ring-white/70"
	            }`}
            style={{
              cursor: hasCrop ? "default" : mapPanning ? "grabbing" : "grab",
              "--map-zoom": `${mapZoom}`,
              "--map-marker-inverse-scale": `${mapMarkerInverseScale}`,
              "--map-marker-size": `${mapMarkerSizePx}px`,
              "--map-slot-gap": `${mapSlotGapPx}px`,
              "--map-area-label-font": `${mapAreaLabelFontPx}px`,
              "--map-area-label-pad-x": `${mapAreaLabelPadXPx}px`,
              "--map-area-label-pad-y": `${mapAreaLabelPadYPx}px`,
              background: resolvedTheme === "dark"
                ? "radial-gradient(circle at 18% 16%, rgba(96, 165, 250, 0.18), transparent 34%), rgba(15, 23, 42, 0.52)"
                : "radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.74), transparent 34%), rgba(249, 252, 255, 0.50)",
            } as CSSProperties}
	            onMouseDown={handleMapPanDown}
	          >
	            <div
	              className="pointer-events-none absolute inset-0 z-[5] rounded-[48px]"
		              style={{
		                background:
		                  resolvedTheme === "dark"
		                    ? "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06) 2.5%, transparent 8%, transparent 92%, rgba(255,255,255,0.08)), radial-gradient(58% 36% at 0% 0%, rgba(255,255,255,0.10), transparent 10%), radial-gradient(48% 32% at 100% 100%, rgba(125,211,252,0.08), transparent 12%)"
		                    : "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,255,255,0.44) 2.5%, transparent 8%, transparent 92%, rgba(255,255,255,0.42)), radial-gradient(58% 36% at 0% 0%, rgba(255,255,255,0.42), transparent 11%), radial-gradient(48% 32% at 100% 100%, rgba(148,163,184,0.12), transparent 13%)",
		                boxShadow:
		                  resolvedTheme === "dark"
		                    ? "inset 0 0 0 2px rgba(255,255,255,0.09), inset 0 0 16px rgba(255,255,255,0.04), inset 10px 9px 16px rgba(255,255,255,0.035), inset -14px -12px 24px rgba(15,23,42,0.22)"
		                    : "inset 0 0 0 2px rgba(255,255,255,0.76), inset 0 0 16px rgba(255,255,255,0.36), inset 10px 9px 16px rgba(255,255,255,0.36), inset -14px -12px 24px rgba(100,116,139,0.10)",
		              }}
		            />
	            <div
	              className="pointer-events-none absolute inset-0 z-[1] opacity-70"
	              style={{
                backgroundImage:
                  resolvedTheme === "dark"
                    ? "linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)"
                    : "linear-gradient(rgba(67, 82, 104, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(67, 82, 104, 0.05) 1px, transparent 1px)",
                backgroundSize: "38px 38px",
                maskImage: "linear-gradient(to bottom, black, rgba(0,0,0,0.82) 72%, transparent 100%)",
              }}
            />
	            <div
		              className={`group/map-building pointer-events-auto absolute left-6 top-5 z-30 inline-flex w-max min-w-[112px] max-w-[calc(100%-3rem)] items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-bold ${
	              resolvedTheme === "dark"
	                ? "border-white/[0.16] bg-slate-900/58 text-slate-100 shadow-black/25 shadow-sm"
	                : "border-white/70 bg-white/92 text-slate-700 shadow-slate-300/40 shadow-sm"
	            } backdrop-blur-2xl`}
              onMouseEnter={mapBuildingOptions.length > 0 ? openMapBuildingMenu : undefined}
              onMouseLeave={mapBuildingOptions.length > 0 ? closeMapBuildingMenuSoon : undefined}
              onMouseDown={(e) => e.stopPropagation()}
	            >
	              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_0_5px_rgba(96,165,250,0.14)]" />
	              <span className="whitespace-nowrap">{activeBuilding?.name ?? "加载中"}</span>
	              {mapBuildingOptions.length > 0 && (
	                <span className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[--text-muted]">
	                  <svg
	                    viewBox="0 0 16 16"
	                    aria-hidden="true"
	                    className={`h-3.5 w-3.5 transition-transform duration-200 ${showMapBuildingMenu ? "rotate-180" : "rotate-0"}`}
	                  >
	                    <path
	                      d="M4 6.25L8 10.25L12 6.25"
	                      fill="none"
	                      stroke="currentColor"
	                      strokeWidth="1.8"
	                      strokeLinecap="round"
	                      strokeLinejoin="round"
	                    />
	                  </svg>
	                </span>
	              )}
              {mapBuildingOptions.length > 0 && (
                <div
		                  className={`absolute left-0 top-full z-50 w-full pt-1.5 transition-all duration-200 ${
                    showMapBuildingMenu
                      ? "pointer-events-auto translate-y-0 opacity-100"
                      : "pointer-events-none translate-y-[-6px] opacity-0"
                  }`}
                  onMouseEnter={openMapBuildingMenu}
                  onMouseLeave={closeMapBuildingMenuSoon}
                  onMouseDown={(e) => e.stopPropagation()}
                >
			                  <div className={`rounded-2xl border px-1.5 py-1.5 shadow-xl backdrop-blur-2xl ${workbenchSoftFloatingSurfaceCls}`}>
                    <div className="flex flex-col gap-1">
                      {mapBuildingOptions.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveBuildingId(b.id);
                            setShowMapBuildingMenu(false);
                          }}
		                          className={`flex w-full items-center justify-between gap-1 whitespace-nowrap rounded-xl px-2 py-2 text-left text-[12px] font-extrabold transition-colors ${workbenchFloatingItemCls}`}
                        >
                          {b.name}
                        </button>
                      ))}
	                    </div>
	                  </div>
	                </div>
              )}
            </div>
            {(ironingMachineRows.length > 0 || queuedIroningWorkItems.length > 0) && (
              <div
                ref={ironingQueueRef}
                className="pointer-events-auto absolute right-5 top-5 z-30 flex flex-col items-end gap-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="relative flex flex-col items-end"
                  onMouseLeave={closeIroningQueueHoverSoon}
                >
                  <button
                    type="button"
                    aria-expanded={ironingQueueMode === "fixed" ? ironingQueueFixedOpen : ironingQueueHoverOpen}
                    onMouseEnter={openIroningQueueHover}
                    onFocus={openIroningQueueHover}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ironingQueueHoverCloseTimer.current) clearTimeout(ironingQueueHoverCloseTimer.current);
                      if (ironingQueueMode === "fixed") {
                        setIroningQueueFixedOpen(!ironingQueueFixedOpen);
                        setIroningQueueHoverOpen(false);
                        return;
                      }
                      setIroningQueueMode("fixed");
                      setIroningQueueFixedOpen(true);
                      setIroningQueueHoverOpen(false);
                    }}
	                    className={`flex h-9 items-center justify-end gap-1.5 rounded-full border px-3.5 py-2 text-left text-[--text-primary] backdrop-blur-2xl transition-all duration-200 ${
	                      resolvedTheme === "dark"
	                        ? "border-white/[0.16] bg-slate-900/58 shadow-black/25 shadow-sm"
	                        : "border-white/70 bg-white/92 shadow-slate-300/40 shadow-sm"
	                    }`}
                  >
	                    <span className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[--text-muted]">
	                      <svg
	                        viewBox="0 0 16 16"
	                        aria-hidden="true"
	                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
	                          (ironingQueueMode === "fixed" ? ironingQueueFixedOpen : ironingQueueHoverOpen) ? "rotate-180" : "rotate-0"
	                        }`}
	                      >
                        <path
                          d="M4 6.25L8 10.25L12 6.25"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
            <span
              className="whitespace-nowrap text-[12px] font-black leading-none drop-shadow-sm"
            >
              <span>熨烫机状态 - </span>
              <span className={
                ironingQueueOverview.tone === "busy"
                  ? "text-red-500"
                  : ironingQueueOverview.tone === "queue"
                    ? "text-red-500"
                    : ironingQueueOverview.tone === "moderate"
                      ? "text-orange-500"
                      : "text-emerald-500"
              }>
                {ironingQueueOverview.label}
              </span>
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center">
              <IroningMachineIcon
                className="h-6 w-6"
                tone={ironingQueueOverview.tone}
              />
            </span>
                  </button>
                  <div
                    className={`pointer-events-auto absolute right-0 top-full z-40 mt-0.5 origin-top overflow-visible transition-all duration-300 ease-[cubic-bezier(.16,1.35,.3,1)] ${
                      (ironingQueueMode === "fixed" ? ironingQueueFixedOpen : ironingQueueHoverOpen)
                        ? "max-h-[520px] translate-y-0 scale-y-100 opacity-100"
                        : "max-h-0 -translate-y-1 scale-y-95 opacity-0"
                    }`}
                  >
                    <div className="flex w-[184px] flex-col items-end gap-1.5 pr-3.5 pt-1">
                      {renderIroningQueueDetailPanel()}
                    </div>
                  </div>
                </div>
              </div>
            )}
        {activeBuilding?.floorPlanUrl ? (
          <div
            ref={mapInnerRef}
            className={`relative z-[2] will-change-transform ${
              mapPanning || mapTransformLive ? "" : "transition-transform duration-[680ms] ease-[cubic-bezier(.22,1,.36,1)]"
            }`}
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
            {/* 公共区域范围 */}
            {(() => {
              const polygonVenues = safeExtraVenueEntries(activeBuilding.extraVenues).filter(
                (venue) => Array.isArray(venue.polygon) && venue.polygon.length >= 3
              );
              if (polygonVenues.length === 0) return null;
              const pointsText = (points: VenuePoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
              const centerOf = (points: VenuePoint[]) => ({
                x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
                y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
              });
              return (
                <div className="pointer-events-none absolute inset-0 z-[3]">
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {polygonVenues.map((venue) => {
                      const polygon = venue.polygon ?? [];
                      const color = venue.color || (venue.type === "无影棚" ? "#64748b" : "#3b82f6");
                      return (
                        <polygon
                          key={venue.name}
                          points={pointsText(polygon)}
                          fill={color}
                          fillOpacity={0.20}
                          stroke="none"
                        />
                      );
                    })}
                  </svg>
                  {polygonVenues.map((venue) => {
                    const polygon = venue.polygon ?? [];
                    const center = centerOf(polygon);
                    const color = venue.color || (venue.type === "无影棚" ? "#64748b" : "#3b82f6");
                    return (
                      <div
                        key={`${venue.name}-area-label`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/45 font-extrabold leading-none text-white/90 shadow-[0_4px_12px_rgba(15,23,42,0.10)] backdrop-blur-sm"
                        style={{
                          left: `${center.x}%`,
                          top: `${center.y}%`,
                          transform: "translate(-50%, -50%) scale(var(--map-marker-inverse-scale))",
                          padding: "var(--map-area-label-pad-y) var(--map-area-label-pad-x)",
                          fontSize: "var(--map-area-label-font)",
                          backgroundColor: `${color}99`,
                          textShadow: "0 1px 1px rgba(0,0,0,0.22)",
                        }}
                      >
                        {venue.name}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
              const slotLayout = new Map<string, { offsetPx: number; zBase: number }>();
              for (const [, slotList] of slotsByRoom) {
                const sorted = [...slotList].sort((x, y) => x.key.localeCompare(y.key));
                const n = sorted.length;
                sorted.forEach((s, i) => {
                  const offsetPx = n > 1 ? (i - (n - 1) / 2) * mapSlotGapPx : 0;
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
                      transform: `translate(calc(-50% + ${ox / Math.max(0.01, mapZoom)}px), -50%) scale(var(--map-marker-inverse-scale))`,
                      zIndex: preemptHovered ? 50 : zb,
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredMapAssistant(`${a.id}-preempted-wait`);
                    }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="map-avatar-marker relative overflow-visible">
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
                      transform: `translate(calc(-50% + ${oxP / Math.max(0.01, mapZoom)}px), -50%) scale(var(--map-marker-inverse-scale))`,
                      zIndex: pausedHovered ? 50 : zbP,
                    }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-paused`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="map-avatar-marker relative overflow-visible">
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
                      transform: `translate(calc(-50% + ${oxPen / Math.max(0.01, mapZoom)}px), -50%) scale(var(--map-marker-inverse-scale))`,
                      zIndex: penHovered ? 50 : zbPen,
                    }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-pending`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="map-avatar-marker relative overflow-visible">
                      <div className="pointer-events-none absolute -inset-2 rounded-full bg-blue-500/25 animate-ping" />
                      <div className="pointer-events-none absolute -inset-1 rounded-full bg-blue-500/15 animate-pulse" />
                      <div
                        className="relative z-[1] h-full w-full overflow-hidden rounded-full border-[2px] border-solid shadow-sm"
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
                        <div className="readable-glass-label px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                          <p className="text-xs font-extrabold text-blue-600">{a.name} · 紧急插单待处理</p>
                          {a.newTaskDesc && <p className="readable-muted-dark text-[10px] mt-0.5">{a.newTaskDesc}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : null;

              // 主标记（当前任务房间/待就位房间）
              const ironingWork = ironingWorkByAssistantId.get(a.id) ?? null;
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
              const dimMainAvatar = dimExecutingForPendingInterrupt;

              const mainMarker = (
                <div
                  key={a.id}
                  className="absolute overflow-visible"
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    transform: `translate(calc(-50% + ${offset / Math.max(0.01, mapZoom)}px), -50%) scale(var(--map-marker-inverse-scale))${isHovered ? " scale(1.35)" : ""}`,
                    zIndex: isHovered ? 50 : zMain,
                    transition: "transform .3s cubic-bezier(.34,1.56,.64,1)",
                  }}
                  onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(a.id); }}
                  onMouseLeave={() => setHoveredMapAssistant(null)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {isAssigned || a.resumingFromPause ? (
                    <div className="map-avatar-marker relative overflow-visible">
                      {/* 外圈脉冲：居中包裹头像，pointer-events-none 避免挡 hover */}
                      <div className="pointer-events-none absolute -inset-2 rounded-full bg-blue-500/25 animate-ping" />
                      <div className="pointer-events-none absolute -inset-1 rounded-full bg-blue-500/15 animate-pulse" />
                      <div
                        className="relative z-[1] h-full w-full overflow-hidden rounded-full border-[2px] border-solid shadow-sm"
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
                    <div className="map-avatar-marker relative overflow-visible">
                      {a.executingOvertimeMin != null && (
                        <>
                          <div className="pointer-events-none absolute -inset-2 rounded-full bg-red-500/35 animate-ping" />
                          <div className="pointer-events-none absolute -inset-1 rounded-full bg-red-500/25 animate-pulse" />
                        </>
                      )}
                      <div
                        className="relative z-[1] h-full w-full rounded-full overflow-hidden border-[2px] border-solid shadow-sm"
                        style={{
                          borderColor: dimMainAvatar
                            ? a.executingOvertimeMin != null
                              ? DOCK_DOT.overtime
                              : MAP_AWAY_AVATAR_BORDER
                            : assistantDockDotColor(a),
                          filter: dimMainAvatar ? MAP_AWAY_AVATAR_FILTER : "none",
                          opacity: dimMainAvatar ? MAP_AWAY_AVATAR_OPACITY : 1,
                          backgroundColor: dimMainAvatar ? MAP_AWAY_AVATAR_BG : undefined,
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
                      <div className="readable-glass-label px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                        {(() => {
                          const waitingOnMap = isAssigned || a.resumingFromPause;
                          const statusColor = waitingOnMap
                            ? "text-blue-600"
                            : ironingWork
                              ? ironingWork.overtimeMin != null ? "text-red-600" : "text-slate-600"
                            : a.executingOvertimeMin != null
                              ? "text-red-600"
                              : "text-orange-600";
                          const statusLabel = waitingOnMap ? "待就位" : ironingWork ? "熨烫中" : "进行中";
                          // Parse currentTask: each task block separated by "---", each block has optional elapsed line + detail line
                          const tasks = a.currentTask ? a.currentTask.split("\n---\n") : [];
                          if (tasks.length === 0) {
                            return (
                              <>
                                <p className={`text-xs font-extrabold ${statusColor}`}>{a.name} · {statusLabel}</p>
                                <p className="readable-muted-dark text-[10px] mt-0.5">{formatRoomOrVenue(a.currentRoom) || "—"}</p>
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
                                <p className={`text-xs font-extrabold ${statusColor}`}>{a.name} · {statusLabel}{elapsedText}</p>
                                <p className="readable-muted-dark text-[10px] mt-0.5">{detail}</p>
                              </div>
                            );
                          }).concat(
                            // 阶段A：执行中头像也应展示紧急插单信息（不只在蓝点 tooltip）
                            (a.pendingRoom && a.newTaskDesc && !isAssigned) ? [
                              <div key="pending-info" className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-xs font-extrabold text-blue-600">紧急插单待处理</p>
                                <p className="readable-muted-dark text-[10px] mt-0.5">{a.newTaskDesc}</p>
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
                                  <p className={`text-[10px] mt-0.5 ${pausedAlert ? "text-red-600" : "readable-muted-dark"}`}>
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
                                    <p className="readable-muted-dark text-[10px] mt-0.5">{a.preemptedWaitingTaskDetail}</p>
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
          <div className="relative z-[2] flex h-full w-full items-center justify-center text-sm font-semibold text-[--text-muted]">
            {activeBuilding ? `${activeBuilding.name} - 暂无平面图` : "加载中..."}
          </div>
        )}
            <div className={`map-status-legend absolute bottom-4 right-6 z-20 flex items-center gap-4 rounded-full border px-4 py-2.5 text-[11px] font-extrabold shadow-lg backdrop-blur-2xl max-[1740px]:hidden ${
	              resolvedTheme === "dark"
	                ? "border-white/[0.16] bg-slate-900/58 text-slate-100 shadow-black/25"
	                : "border-white/70 bg-white/78 text-slate-600 shadow-slate-300/30"
	            }`}>
              {[
                { label: "空闲中", color: DOCK_DOT.idle },
                { label: "待就位", color: DOCK_DOT.assigned },
                { label: "进行中", color: DOCK_DOT.inProgress },
                { label: "已超时", color: DOCK_DOT.overtime },
                { label: "已下线", color: DOCK_DOT.offline },
              ].map((l) => (
                <span key={l.label} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
            <button
              type="button"
              aria-label={areaDataPanelOpen ? "收起区域任务数据" : "展开区域任务数据"}
              aria-expanded={areaDataPanelOpen}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setAreaDataPanelOpen((open) => !open);
              }}
              className={`absolute bottom-4 z-30 flex items-center gap-3 rounded-full border px-3 py-2 text-[11px] font-extrabold backdrop-blur-2xl transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${
                areaDataPanelOpen
                  ? resolvedTheme === "dark"
                    ? "border-cyan-300/20 bg-cyan-300/[0.10] text-cyan-50 shadow-[0_18px_44px_rgba(8,145,178,0.18),inset_0_1px_0_rgba(255,255,255,0.12)]"
                    : "border-white/80 bg-white/72 text-slate-800 shadow-[0_18px_46px_rgba(56,68,89,0.16),inset_0_1px_0_rgba(255,255,255,0.85)]"
                  : resolvedTheme === "dark"
                    ? "border-white/[0.10] bg-slate-950/50 text-slate-100 shadow-[0_16px_42px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-cyan-300/25 hover:bg-cyan-300/[0.10]"
                    : "border-white/75 bg-white/52 text-slate-700 shadow-[0_16px_42px_rgba(56,68,89,0.12),inset_0_1px_0_rgba(255,255,255,0.78)] hover:bg-white/76"
              }`}
              style={{ left: "50%", transform: "translateX(-50%)" }}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-500 ${
                areaDataPanelOpen
                  ? resolvedTheme === "dark" ? "bg-cyan-300/18 text-cyan-100" : "bg-slate-950/80 text-white"
                  : resolvedTheme === "dark" ? "bg-white/[0.08] text-cyan-100" : "bg-slate-900/[0.08] text-slate-700"
              }`}>
                <svg className={`transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${areaDataPanelOpen ? "rotate-180" : "rotate-0"}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </span>
              <span className="flex items-center gap-2.5">
                <span className="tracking-wide">区域数据</span>
                <span className={`h-4 w-px ${resolvedTheme === "dark" ? "bg-white/[0.14]" : "bg-slate-900/[0.10]"}`} />
                <span className="tabular-nums text-orange-500">{publicQueueTasks.length}条</span>
                <span className="text-[--text-muted]">队列中</span>
              </span>
            </button>
          </div>

	          <div
	            aria-hidden={!areaDataPanelOpen}
	            className={`area-data-panel relative h-full min-h-0 overflow-visible rounded-[44px] border px-5 py-4 backdrop-blur-[26px] transition-all duration-[680ms] ease-[cubic-bezier(.22,1,.36,1)] ${
            resolvedTheme === "dark"
              ? "border-white/[0.12] bg-slate-950/73 shadow-[0_28px_90px_rgba(0,0,0,0.36)] ring-1 ring-white/[0.06]"
              : "border-white/70 bg-white/73 shadow-[0_28px_80px_rgba(56,68,89,0.12)] ring-1 ring-slate-900/[0.04]"
          } ${
            areaDataPanelOpen
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-8 scale-[0.985] opacity-0"
          }`}
          >
            <div className="area-data-layout grid h-full min-h-0 grid-cols-[30fr_minmax(0,70fr)] gap-[22px]">
              <div className={`area-public-queue min-h-0 rounded-[34px] border p-4 ${
                resolvedTheme === "dark"
                  ? "border-white/[0.10] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-white/75 bg-white/58 shadow-[0_18px_44px_rgba(56,68,89,0.08),inset_0_1px_0_rgba(255,255,255,0.70)]"
              }`}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-extrabold tracking-wide text-[--text-primary]">公共队列</h3>
                  <span className="rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-extrabold text-orange-500">{publicQueueTasks.length}条队列中</span>
                </div>
                <div className="h-[calc(100%-30px)] overflow-x-hidden overflow-y-auto pr-1">
                  {publicQueueTasks.length === 0 ? (
                    <div className={`flex h-full items-center justify-center rounded-[24px] text-[13px] font-semibold text-[--text-muted] ${
                      resolvedTheme === "dark"
                        ? "border border-white/[0.08] bg-white/[0.05]"
                        : "bg-slate-50/70"
                    }`}>
                      当前区域暂无公共队列任务
                    </div>
                  ) : (
                    <div className="area-public-queue-list space-y-2.5">
                      {areaPublicQueueRows.map((queueTask, index) => {
                        const display = apiTaskToDisplay(queueTask);
                        const statusInfo = publicQueueStatusInfo(queueTask, publicQueueRaw);
                        const compactStatusLabel = statusInfo.assignedWaiting ? "待就位" : statusInfo.label.replace("待派发", "待派");
                        const queuedWaitingMinutes = Math.floor((now.getTime() - new Date(queueTask.createdAt).getTime()) / 60000);
                        const actualLine = taskListActualLine(display, queueTask, now.getTime(), true) ?? `已等待${fmtMin(queuedWaitingMinutes)}`;
                        const assigneeNames = [
                          queueTask.assistant?.name,
                          ...helperParticipants(queueTask).map((c) => c.assistant.name),
                        ].filter(Boolean);
                        const escalated = Boolean(queueTask.escalatedAt);
                        const escalationLabel = priorityTransitionLabel(queueTask);
                        const isAssignedWaitingOverdue =
                          !escalated &&
                          queueTask.status === "waiting" &&
                          statusInfo.assignedWaiting &&
                          queuedWaitingMinutes >= upgradeThresholdMin;
                        const isOwnPhotographerQueueTask = profile?.role === "photographer" && queueTask.photographerId === profile.id;
                        const queuePhotographerLabel = isOwnPhotographerQueueTask ? "我" : queueTask.photographer?.name ?? "摄影师";
                        return (
                          <div
                            key={`area-public-${queueTask.id}`}
                            className="area-public-queue-card-wrap overflow-visible px-3"
                          >
                          <div
                            className={`area-public-queue-card flex origin-right gap-2 rounded-xl border py-3 pl-3 pr-4 shadow-sm transition-all duration-200 hover:translate-x-0.5 hover:scale-[1.012] hover:shadow-md ${
                              resolvedTheme === "dark"
                                ? isOwnPhotographerQueueTask
                                  ? "public-queue-own-task border-amber-200/18 bg-amber-200/[0.08] shadow-black/10 hover:bg-amber-200/[0.12]"
                                  : "border-white/[0.22] bg-white/[0.12] hover:bg-white/[0.17]"
                                : isOwnPhotographerQueueTask
                                  ? "public-queue-own-task border-transparent bg-white/55 shadow-amber-100/60 hover:bg-white/75"
                                  : "border-white/60 bg-white/55 hover:bg-white/75"
                            }${publicQueueAnimatingTaskId === queueTask.id ? " public-queue-promote-inserting" : ""}`}
                          >
                            <span className={`mt-0.5 flex shrink-0 items-center justify-center text-[10px] font-extrabold shadow-sm ${publicQueueRankShapeCls(index, queueTask.priority)}`}>
                              {publicQueueRankLabel(index, queueTask.priority)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="area-public-queue-card-top flex items-center justify-between gap-2">
                                <div className="area-public-queue-title min-w-0">
                                  <span className="area-public-queue-task-name text-[11px] font-extrabold text-[--text-primary]">{display.name}</span>
                                  <span className="area-public-queue-duration ml-1.5 text-[10px] font-medium text-[--text-muted]">{display.durationSlotLabel}</span>
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
                                <span
                                  className={`area-public-queue-status mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold ${statusInfo.cls}`}
                                  data-compact-label={compactStatusLabel}
                                >
                                  <span className="area-public-queue-status-text">{statusInfo.label}</span>
                                </span>
                              </div>
                              <div className="area-public-queue-detail-row mt-1.5 flex h-4 min-w-0 w-full items-baseline gap-1.5 overflow-hidden pr-1">
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
                                    {assigneeNames.length > 0 ? (
                                      <span className="area-public-queue-assignees"> · {assigneeNames.join("、")}</span>
                                    ) : null}
                                  </span>
                                </span>
                                <span className="area-public-queue-time mr-1 shrink-0 whitespace-nowrap text-[10px] font-medium leading-[16px] text-[--text-muted]">{actualLine}</span>
                              </div>
                            </div>
                          </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

	              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-y-3 overflow-visible">
	                <div aria-hidden="true" className="h-[16px]" />
	                <div className="area-data-main-grid relative grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(220px,0.78fr)] grid-rows-[136px_minmax(0,1fr)] gap-x-5 gap-y-3 max-[1228px]:block min-[1741px]:grid-cols-[minmax(0,30fr)_minmax(0,17fr)_minmax(0,23fr)] min-[1741px]:grid-rows-[minmax(0,1fr)]">
                    <div className="col-span-2 row-start-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-visible min-[1741px]:col-span-1 min-[1741px]:row-start-1">
                    <div className="area-data-title-row relative z-20 flex shrink-0 items-center justify-between gap-2 pl-[4.5rem]">
                      <h2 className="area-data-title whitespace-nowrap text-[12px] font-extrabold tracking-wide text-[--text-primary]">{activeBuilding?.name ?? "当前"}区域 任务数据</h2>
                    </div>
                    <div className="relative flex h-full items-center justify-center rounded-2xl px-5 py-3 min-[1741px]:px-6 min-[1741px]:py-5">
                      <div className={`area-metrics-grid group relative grid h-full w-full max-w-[460px] grid-cols-6 grid-rows-3 content-center gap-x-4 gap-y-2.5 rounded-[28px] border px-4 py-3 transition-all duration-200 min-[1741px]:max-w-[520px] min-[1741px]:gap-x-6 min-[1741px]:gap-y-5 min-[1741px]:px-5 min-[1741px]:py-5 ${
                        resolvedTheme === "dark"
                          ? "border-transparent hover:border-white/[0.10] hover:bg-white/[0.04]"
                          : "border-transparent hover:border-white/70 hover:bg-white/28 hover:shadow-[0_14px_34px_rgba(56,68,89,0.08)]"
                      }`}>
                        <span
                          className={`pointer-events-none absolute left-1/2 top-5 h-[calc(100%-40px)] w-px -translate-x-1/2 ${
                            resolvedTheme === "dark" ? "bg-white/[0.10]" : "bg-slate-900/[0.10]"
                          }`}
                          aria-hidden="true"
                        />
                        {([
                          { caption: "今日已完成", value: areaTaskStats.completed, span: "col-span-3" },
                          {
                            caption: "正在进行中",
                            value: areaRealtimeStats.executing,
                            span: "col-span-3",
                            detailKey: "executing" as AreaMetricKey,
                            people: areaMetricPeopleByKey.executing,
                            unit: isAssistantRole(profile?.role) ? "项" : "单",
                            emptyText: isAssistantRole(profile?.role) ? "暂无进行中助理" : "暂无进行中任务摄影师",
                          },
                          {
                            caption: "等待就位中",
                            value: areaTaskStats.assigned,
                            span: "col-span-3",
                            detailKey: "assigned" as AreaMetricKey,
                            people: areaMetricPeopleByKey.assigned,
                            unit: isAssistantRole(profile?.role) ? "项" : "单",
                            emptyText: isAssistantRole(profile?.role) ? "暂无待就位助理" : "暂无待就位任务摄影师",
                          },
                          {
                            caption: "当前已超时",
                            value: isAssistantRole(profile?.role) ? areaRealtimeStats.overtime : areaTaskStats.overtime,
                            span: "col-span-3",
                            detailKey: "overtime" as AreaMetricKey,
                            people: areaMetricPeopleByKey.overtime,
                            unit: isAssistantRole(profile?.role) ? "项" : "单",
                            emptyText: isAssistantRole(profile?.role) ? "暂无超时助理" : "暂无超时任务摄影师",
                          },
                          {
                            caption: "公共队列中",
                            value: publicQueueTasks.length,
                            span: "col-span-3",
                            detailKey: "queue" as AreaMetricKey,
                            people: areaMetricPeopleByKey.queue,
                            unit: "单",
                            emptyText: "暂无队列任务摄影师",
                            bubbleAnchorMode: "value",
                          },
                          {
                            caption: "离线人员",
                            value: areaAssistantStats.offline,
                            span: "col-span-3",
                            detailKey: "offline" as AreaMetricKey,
                            people: areaMetricPeopleByKey.offline,
                            unit: "人",
                            emptyText: "暂无离线助理",
                          },
                        ] as AreaMetricCard[]).map((item) => (
                          <div key={item.caption} className={`area-metric-card relative min-w-0 ${item.caption === "今日已完成" ? "z-[3]" : "z-[1]"} ${item.span}`}>
                            {hasAreaMetricDetail(item) ? (
                              <button
                                type="button"
                                className="area-metric-control relative mx-auto flex min-h-0 w-full max-w-[190px] flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 text-center outline-none transition-colors hover:bg-white/30 focus-visible:bg-white/36"
                                onMouseEnter={(e) => showAreaMetricBubble(item.detailKey, e.currentTarget, item.people.length, item.bubbleAnchorMode)}
                                onFocus={(e) => showAreaMetricBubble(item.detailKey, e.currentTarget, item.people.length, item.bubbleAnchorMode)}
                                onMouseLeave={hideAreaMetricBubble}
                                onBlur={hideAreaMetricBubble}
                                aria-expanded={expandedAreaMetricKey === item.detailKey}
                              >
                                <span className="whitespace-nowrap text-[10px] font-bold text-[--text-muted] min-[1741px]:text-[11px]">{item.caption}</span>
                                <span data-area-metric-value className="area-metric-value text-[24px] font-extrabold leading-none tabular-nums text-[--text-primary] min-[1741px]:text-[32px]">{item.value}</span>
                                {expandedAreaMetricKey === item.detailKey ? renderAreaMetricBubble({
                                  key: item.detailKey,
                                  caption: item.caption,
                                  people: item.people,
                                  unit: item.unit,
                                  emptyText: item.emptyText,
                                }) : null}
                              </button>
                            ) : (
                              <div className="area-metric-control flex min-h-0 w-full max-w-[190px] flex-col items-center justify-center gap-1 text-center">
                                <span className="whitespace-nowrap text-[10px] font-bold text-[--text-muted] min-[1741px]:text-[11px]">{item.caption}</span>
                                {item.caption === "今日已完成" ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const dow = new Date().getDay();
                                      setAreaCompletedStatsWeekOffset(0);
                                      setAreaCompletedStatsSelectedDay(dow === 0 ? 6 : dow - 1);
                                      setAreaCompletedStatsHoveredDay(null);
                                      setShowAreaCompletedStatsModal(true);
                                    }}
                                    className="area-metric-value rounded-xl px-2 text-[24px] font-extrabold leading-none tabular-nums text-[--text-primary] transition-colors hover:bg-white/34 focus-visible:bg-white/40 focus-visible:outline-none min-[1741px]:text-[32px]"
                                    aria-label="打开区域完成统计"
                                  >
                                    {item.value}
                                  </button>
                                ) : (
                                  <span className="area-metric-value text-[24px] font-extrabold leading-none tabular-nums text-[--text-primary] min-[1741px]:text-[32px]">{item.value}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

			                  <div
	                    className="area-assistant-rank relative z-[90] col-start-2 row-start-2 grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-y-2 overflow-visible px-0 py-0 max-[1740px]:hidden min-[1741px]:col-start-3 min-[1741px]:row-start-1"
			                    onWheelCapture={(e) => {
			                      const list = assistantRankingScrollRef.current;
			                      if (!list || list.scrollHeight <= list.clientHeight) return;
			                      e.stopPropagation();
			                      list.scrollTop += e.deltaY;
			                    }}
			                  >
	                    <div className="relative z-20 flex shrink-0 items-center justify-between gap-2">
	                      <div className="flex items-center gap-1.5">
	                        <h3 className="whitespace-nowrap text-[12px] font-extrabold tracking-wide text-[--text-primary]">助理排行</h3>
                        <button
                          type="button"
                          className={`relative flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black leading-none outline-none transition-colors ${
                            resolvedTheme === "dark"
                              ? "bg-white/[0.08] text-slate-300 hover:bg-white/[0.12] focus-visible:bg-white/[0.12]"
                              : "bg-slate-900/[0.06] text-slate-500 hover:bg-slate-900/[0.10] focus-visible:bg-slate-900/[0.10]"
                          }`}
                          aria-label="助理排行计算说明"
                          aria-expanded={assistantRankingHelpOpen === "center"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssistantRankingHelpOpen((open) => open === "center" ? null : "center");
                          }}
                        >
                          !
                          {assistantRankingHelpOpen === "center" && (
                            <span
                              className={`absolute right-0 top-full z-40 mt-2 w-[340px] whitespace-normal rounded-2xl border px-3 py-2 text-left text-[11px] font-semibold leading-relaxed shadow-xl backdrop-blur-2xl ${
                                resolvedTheme === "dark"
                                  ? "border-white/[0.12] bg-slate-950/66 text-slate-200 shadow-black/40"
                                  : "border-white/70 bg-white/66 text-slate-700 shadow-slate-300/60"
                              }`}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="block">综合分 = 实际服务时长，1小时=1分；「外模跟拍协助」按实际时长 ×0.8 计分。</span>
                              <span className="mt-1.5 block">举例：</span>
                              <span className="block">助理A：完成1个2小时普通任务=2分</span>
                              <span className="block">助理B：完成1个2小时外模跟拍协助任务=1.6分</span>
                              <span className="block">同分时再按完成单数、服务时长和完成时间辅助排序。</span>
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
		                    <div className="relative z-10 min-h-0 overflow-hidden">
	                      {assistantRankingRows.length === 0 ? (
		                        <div className={`relative z-30 flex h-full min-h-[120px] items-center justify-center rounded-2xl text-[12px] font-semibold text-[--text-muted] ${
		                          resolvedTheme === "dark" ? "bg-white/[0.06]" : "bg-white/34"
		                        }`}>
		                          今日暂无助理完成记录
		                        </div>
	                      ) : (
				                        <div
				                          ref={assistantRankingScrollRef}
				                          className="scrollbar-none relative z-[91] h-full max-h-full min-h-0 cursor-grab select-none overflow-y-auto overflow-x-hidden overscroll-contain pb-2 pr-1 pt-3 active:cursor-grabbing"
	                          style={{ maxHeight: "calc(100vh - 230px)", touchAction: "none" }}
	                          onWheel={(e) => {
	                            const list = e.currentTarget;
	                            if (list.scrollHeight <= list.clientHeight) return;
	                            e.stopPropagation();
	                            list.scrollTop += e.deltaY;
	                          }}
	                          onPointerDown={(e) => {
	                            if (e.button !== 0) return;
	                            const target = e.target as HTMLElement;
	                            if (target.closest("button")) return;
	                            const list = e.currentTarget;
	                            assistantRankingDragRef.current = {
	                              pointerId: e.pointerId,
	                              startY: e.clientY,
	                              scrollTop: list.scrollTop,
	                              moved: false,
	                            };
	                            list.setPointerCapture(e.pointerId);
	                          }}
	                          onPointerMove={(e) => {
	                            const dragState = assistantRankingDragRef.current;
	                            if (!dragState || dragState.pointerId !== e.pointerId) return;
	                            const dy = e.clientY - dragState.startY;
	                            if (Math.abs(dy) > 2) dragState.moved = true;
	                            e.currentTarget.scrollTop = dragState.scrollTop - dy;
	                          }}
	                          onPointerUp={(e) => {
	                            const dragState = assistantRankingDragRef.current;
	                            if (dragState?.pointerId === e.pointerId) {
	                              assistantRankingDragRef.current = null;
	                            }
	                          }}
	                          onPointerCancel={(e) => {
	                            const dragState = assistantRankingDragRef.current;
	                            if (dragState?.pointerId === e.pointerId) {
	                              assistantRankingDragRef.current = null;
	                            }
	                          }}
	                        >
		                        <div className="space-y-3 pb-1.5">
	                          {assistantRankingRows.map((row, index) => {
	                            const maxScore = assistantRankingRows[0]?.score || 1;
	                            const scorePct = Math.max(8, Math.round((row.score / maxScore) * 100));
	                            const scoreExpanded = expandedAssistantScoreId === row.assistantId;
	                            return (
	                              <div
	                                key={`telemetry-rank-${row.assistantId}`}
	                                className={`relative min-h-[74px] overflow-visible rounded-2xl px-2.5 py-2.5 transition-colors duration-150 ${
                                  resolvedTheme === "dark" ? "hover:bg-white/[0.07]" : "hover:bg-white/38"
                                }`}
                              >
	                                <div className="flex items-center gap-3">
	                                  <AssistantRankingAvatar row={row} index={index} sizeCls="h-7 w-7" />
	                                  <div className="min-w-0 flex-1">
		                                    <div className="flex min-h-[20px] items-center justify-between gap-2">
	                                      <p className="min-w-0 flex-1 truncate text-[12px] font-extrabold text-[--text-primary]">{row.assistantName}</p>
	                                      <div
	                                        className="relative shrink-0"
	                                        onMouseLeave={hideAssistantScoreBubble}
	                                      >
	                                        <button
	                                          type="button"
	                                          aria-expanded={scoreExpanded}
	                                          className="rounded-lg px-1.5 py-0.5 text-[13px] font-extrabold leading-none text-orange-500 transition-colors hover:bg-orange-500/10 focus:bg-orange-500/10 focus:outline-none"
	                                          onMouseEnter={(e) => showAssistantScoreBubble(row.assistantId, e.currentTarget, row.details.length)}
	                                          onFocus={(e) => showAssistantScoreBubble(row.assistantId, e.currentTarget, row.details.length)}
	                                          onBlur={hideAssistantScoreBubble}
	                                        >
	                                          {formatAssistantScore(row.score)}
	                                          <span className="ml-0.5 text-[9px]">分</span>
	                                        </button>
	                                        {scoreExpanded ? renderAssistantScoreBubble(row) : null}
                                      </div>
                                    </div>
                                    <p className="mt-0.5 truncate text-[10px] font-semibold text-[--text-muted]">
                                      完成 {row.completedCount}单 · 服务 {fmtMin(row.workSeconds / 60)}
                                    </p>
                                    <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${
                                      resolvedTheme === "dark" ? "bg-white/[0.10]" : "bg-slate-900/[0.08]"
                                    }`}>
                                      <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500" style={{ width: `${scorePct}%` }} />
                                    </div>
                                  </div>
                                </div>
	                              </div>
	                            );
	                          })}
	                        </div>
	                        </div>
	                      )}
	                    </div>
                  </div>

	                  <div className="area-task-types relative z-10 col-start-1 row-start-2 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-visible px-0 py-0 max-[1228px]:hidden min-[1741px]:col-start-2 min-[1741px]:row-start-1">
                    <div className="relative z-20 flex shrink-0 items-center justify-between gap-2">
                      <h3 className="whitespace-nowrap text-[12px] font-extrabold tracking-wide text-[--text-primary]">任务类型</h3>
                    </div>
                    <div className={`mt-2 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5 rounded-[28px] border px-3 py-3 transition-all duration-200 ${
                      resolvedTheme === "dark"
                        ? "border-transparent hover:border-white/[0.10] hover:bg-white/[0.04]"
                        : "border-transparent hover:border-white/70 hover:bg-white/28 hover:shadow-[0_14px_34px_rgba(56,68,89,0.08)]"
                    }`}>
	                      {areaPublishedTaskTypeBreakdown.length === 0 && areaTaskTypeBreakdown.length === 0 ? (
                        <div className={`flex items-center justify-center rounded-2xl text-[12px] font-semibold text-[--text-muted] ${
                          resolvedTheme === "dark" ? "border-white/[0.10]" : "border-slate-900/[0.10]"
                        }`}>
                          暂无任务类型数据
                        </div>
                      ) : (
                        <>
                          <div
                            data-area-task-type-pie
                            className="relative flex min-h-0 items-center justify-center overflow-visible"
                            onMouseLeave={() => setHoveredAreaTaskTypeName(null)}
                          >
                            <div
                              className="relative aspect-square h-[82%] max-h-[184px] min-h-[128px] overflow-visible"
                              onMouseMove={handleAreaTaskTypePieMove}
                            >
                              <div
                                className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(81,101,130,0.16)]"
                                style={{ background: areaTaskTypePieGradient }}
                              />
                              <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" viewBox="-24 -14 148 128" aria-hidden="true">
                                {areaPublishedTaskTypeSlices.map((slice) => {
                                  const circumference = 2 * Math.PI * 36;
                                  const dash = Math.max(0.5, (slice.end - slice.start) / 360 * circumference);
                                  const gap = Math.max(0, circumference - dash);
                                  const startPoint = polarPoint(50, 50, 34, slice.mid);
                                  const bendPoint = polarPoint(50, 50, 54, slice.mid);
                                  const isLeftSide = slice.mid > 180;
                                  const lineEndX = isLeftSide ? 10 : 90;
                                  const active = hoveredAreaTaskTypeName === slice.name;
                                  return (
                                    <g key={`area-type-slice-${slice.name}`}>
                                      <circle
                                        cx="50"
                                        cy="50"
                                        r="36"
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth="30"
                                        strokeDasharray={`${dash} ${gap}`}
                                        strokeDashoffset={-(slice.start / 360) * circumference}
                                        transform="rotate(-90 50 50)"
                                        className="pointer-events-none"
                                      />
                                      {active ? (
                                        <>
                                          <path
                                            d={`M ${startPoint.x} ${startPoint.y} L ${bendPoint.x} ${bendPoint.y} L ${lineEndX} ${bendPoint.y}`}
                                            fill="none"
                                            stroke={slice.color}
                                            strokeWidth="0.7"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity="0.9"
                                            className="pointer-events-none"
                                          />
                                          <circle cx={startPoint.x} cy={startPoint.y} r="1.1" fill={slice.color} className="pointer-events-none" />
                                        </>
                                      ) : null}
                                    </g>
                                  );
                                })}
                              </svg>
                              {areaPublishedTaskTypeSlices.map((slice) => {
                                const active = hoveredAreaTaskTypeName === slice.name;
                                const isLeftSide = slice.mid > 180;
                                const anchorPoint = polarPoint(50, 50, 54, slice.mid);
                                const topPct = Math.min(76, Math.max(12, anchorPoint.y));
                                return active ? (
                                  <div
                                    key={`area-type-label-${slice.name}`}
                                    className={`pointer-events-none absolute z-50 w-[86px] rounded-[10px] px-2.5 py-2 text-left shadow-[0_10px_24px_rgba(15,23,42,0.16)] backdrop-blur-xl ${isLeftSide ? "right-[72%]" : "left-[72%]"}`}
                                    style={{
                                      top: `${topPct}%`,
                                      transform: "translateY(-50%)",
                                      color: slice.color,
                                      background: resolvedTheme === "dark" ? "rgba(15,23,42,0.90)" : "rgba(255,255,255,0.94)",
                                      border: `1px solid ${slice.color}55`,
                                    }}
                                  >
                                    <div className="truncate text-[10px] font-black leading-none">{slice.name}</div>
                                    <div className="mt-1.5 whitespace-nowrap text-[9px] font-extrabold leading-none opacity-80">
                                      {slice.count}单，占比{slice.pct}%
                                    </div>
                                  </div>
                                ) : null;
                              })}
                              <div className={`absolute inset-[28%] z-10 flex flex-col items-center justify-center rounded-full text-center ${
                                resolvedTheme === "dark" ? "bg-slate-950/86" : "bg-white/92"
                              }`}>
	                                <span className="text-[26px] font-extrabold leading-none text-[--text-primary]">{areaPublishedTaskTypeTotal}</span>
	                                <span className="mt-1.5 text-[10px] font-bold text-[--text-muted]">总单</span>
                              </div>
                            </div>
                          </div>
                          <div data-area-task-type-list className="-mt-1 min-h-0 overflow-y-auto pr-1">
                            <div className="space-y-0.5">
                              <div className={`grid grid-cols-[1fr_52px] items-center gap-3 pb-0.5 text-[11px] font-extrabold ${
                                resolvedTheme === "dark" ? "text-slate-200" : "text-slate-700"
                              }`}>
		                                <span>已完成</span>
		                                <span className="flex items-center justify-end gap-0.5 tabular-nums text-[--text-primary]">
		                                  <span className="min-w-[3ch] text-right">{areaTaskTypeCompletedTotal}</span>
		                                  <span className="w-3 text-left">单</span>
		                                </span>
                              </div>
                            {areaTaskTypeBreakdown.map((item) => (
                              <div key={`telemetry-type-${item.name}`} className="grid grid-cols-[1fr_52px] items-center gap-3 pb-0.5 text-[11px] font-bold text-[--text-primary]">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                                  <span className="min-w-0 truncate">{item.name}</span>
                                </span>
                                <span className="relative text-right">
                                  <button
                                    type="button"
                                    className="inline-flex items-center justify-end rounded-md px-1 py-0.5 text-right text-[11px] font-extrabold leading-none tabular-nums text-[--text-primary] transition-colors hover:bg-orange-500/10 focus:bg-orange-500/10 focus:outline-none"
                                    onMouseEnter={(e) => showTaskTypeDetailBubble(item.name, e.currentTarget, item.assistants.length)}
                                    onFocus={(e) => showTaskTypeDetailBubble(item.name, e.currentTarget, item.assistants.length)}
                                    onMouseLeave={hideTaskTypeDetailBubble}
                                    onBlur={hideTaskTypeDetailBubble}
                                    aria-expanded={expandedTaskTypeDetailName === item.name}
                                  >
                                    <span className="min-w-[3ch] text-right">{item.count}</span>
                                    <span className="w-3 text-left">单</span>
                                  </button>
                                  {expandedTaskTypeDetailName === item.name ? renderTaskTypeDetailBubble(item) : null}
                                </span>
                              </div>
                            ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                </div>
              </div>

              <div className="hidden">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-[14px] font-extrabold text-[--text-primary]">助理排行</h3>
                    <button
                      type="button"
                      className="relative flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-black leading-none text-slate-600 outline-none transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:border-slate-500 focus-visible:text-slate-900"
                      aria-label="助理排行计算说明"
                      aria-expanded={assistantRankingHelpOpen === "legacy"}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssistantRankingHelpOpen((open) => open === "legacy" ? null : "legacy");
                      }}
                    >
                      !
                      {assistantRankingHelpOpen === "legacy" && (
                        <span
                          className="absolute right-0 top-full z-30 mt-2 w-[340px] whitespace-normal rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[10px] font-semibold leading-relaxed text-slate-600 shadow-xl"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="block">
                            综合分 = 实际服务时长，1小时=1分；「外模跟拍协助」按实际时长 ×0.8 计分。
                          </span>
                          <span className="mt-1.5 block">举例：</span>
                          <span className="block">
                            助理A：完成1个2小时普通任务=2分
                          </span>
                          <span className="block">
                            助理B：完成1个2小时外模跟拍协助任务=1.6分
                          </span>
                          <span className="block">
                            同分时再按完成单数、服务时长和完成时间辅助排序。
                          </span>
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <div className="h-[calc(100%-30px)] overflow-y-auto py-2 pl-3 pr-1 -ml-3">
                  {assistantRankingRows.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-xl bg-gray-50/70 text-[13px] font-semibold text-[--text-muted]">
                      今日暂无助理完成记录
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {assistantRankingRows.map((row, index) => {
                        const maxScore = assistantRankingRows[0]?.score || 1;
                        const scorePct = Math.max(8, Math.round((row.score / maxScore) * 100));
                        const scoreExpanded = expandedAssistantScoreId === row.assistantId;
                        return (
                          <div
                            key={row.assistantId}
                            className={`relative overflow-visible rounded-xl border border-gray-100 bg-white/80 px-3.5 py-3 shadow-sm ${
                              scoreExpanded ? "z-30" : "z-0"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <AssistantRankingAvatar row={row} index={index} sizeCls="h-8 w-8" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="truncate text-[13px] font-extrabold text-[--text-primary]">{row.assistantName}</p>
                                  <div
                                    className="relative shrink-0"
                                    onMouseEnter={() => setExpandedAssistantScoreId(row.assistantId)}
                                    onMouseLeave={() => setExpandedAssistantScoreId(null)}
                                  >
                                    <button
                                      type="button"
                                      aria-expanded={scoreExpanded}
                                      onFocus={() => setExpandedAssistantScoreId(row.assistantId)}
                                      onBlur={() => setExpandedAssistantScoreId(null)}
                                      className={`rounded-lg px-1.5 py-0.5 text-[15px] font-extrabold leading-none text-orange-600 transition-colors hover:bg-orange-50 focus:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-200 ${
                                        scoreExpanded ? "bg-orange-50 ring-1 ring-orange-100" : ""
                                      }`}
                                    >
                                      {formatAssistantScore(row.score)}
                                      <span className="ml-0.5 text-[10px] text-orange-600">分</span>
                                    </button>
                                    {scoreExpanded && (
                                      <div
                                        className="absolute right-0 top-full z-40 w-[260px] pt-2"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="rounded-xl border border-gray-300 bg-white p-3 text-left shadow-xl shadow-gray-200/70">
                                          <div className="mb-2 text-[13px] font-extrabold text-[--text-primary]">任务列表</div>
                                          <div className="space-y-1.5">
                                            {row.details.map((detail, detailIndex) => (
                                              <div key={`${detail.taskId}-${detailIndex}`} className="rounded-lg bg-gray-50/80 px-2.5 py-2">
                                                <div className="flex items-center justify-between gap-2">
                                                  <p className="min-w-0 truncate text-[10px] font-extrabold text-[--text-primary]">
                                                    {detailIndex + 1}. {detail.taskTitle}
                                                  </p>
                                                  <span className="shrink-0 text-[10px] font-extrabold text-orange-600">
                                                    {formatAssistantScore(detail.totalScore)}分
                                                  </span>
                                                </div>
                                                <p className="mt-1 text-[9px] font-semibold leading-relaxed text-[--text-primary]">
                                                  服务 {fmtMin(detail.serviceSeconds / 60)}
                                                  {detail.scoreFactor !== 1 ? (
                                                    <span className="text-orange-600"> ×{formatAssistantScore(detail.scoreFactor)}</span>
                                                  ) : null}
                                                  =<span className="text-orange-600">{formatAssistantScore(detail.serviceScore)}分</span>
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                          <div className="mt-2 border-t border-[--text-primary] pt-2 text-right text-[13px] font-extrabold text-[--text-primary]">
                                            合计：<span className="text-orange-600">{formatAssistantScore(row.score)}分</span>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <p className="mt-1 truncate text-[11px] font-semibold text-[--text-muted]">
                                  完成 {row.completedCount}单 · 服务 {fmtMin(row.workSeconds / 60)}
                                </p>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-orange-400" style={{ width: `${scorePct}%` }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="hidden">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-[--text-primary]">任务类型</h3>
                </div>
                <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3">
                  {areaTaskTypeBreakdown.length === 0 ? (
                    <div className="flex min-h-[260px] items-center justify-center rounded-xl bg-gray-50/70 text-[13px] font-semibold text-[--text-muted]">
                      暂无任务类型数据
                    </div>
                  ) : (
                    <div className="relative min-h-[260px] overflow-visible">
                      <div
                        className="absolute left-1/2 top-[46%] aspect-square h-[82%] max-h-[420px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
                        style={{ background: areaTaskTypePieGradient }}
                      >
                        <div className="absolute inset-0 rounded-full shadow-inner" />
                        <div className="pointer-events-none absolute inset-[26%] flex flex-col items-center justify-center rounded-full bg-white/95 text-center shadow-sm">
                          <span className="text-[26px] font-extrabold leading-none text-[--text-primary]">{areaTaskStats.total}</span>
                          <span className="mt-1.5 text-[11px] font-bold text-[--text-muted]">总任务</span>
                        </div>
                      </div>

                      <div className="absolute right-0 top-0 z-20 min-h-[126px] w-[170px] rounded-2xl border border-white/75 bg-white/78 px-3 py-3 shadow-sm backdrop-blur">
                        {primaryTaskType ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: primaryTaskType.color }} />
                              <p className="min-w-0 truncate text-[12px] font-black text-[--text-primary]">{primaryTaskType.name}</p>
                            </div>
                            <div className="mt-3 space-y-1.5">
                              {primaryTaskType.assistants.length > 0 ? primaryTaskType.assistants.map((assistant) => (
                                <div key={assistant.id} className="flex items-center gap-1.5">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[8px] font-black text-white ring-1 ring-white">
                                    {assistant.avatar ? (
                                      <img src={assistant.avatar} alt={assistant.name} className="h-full w-full object-cover" />
                                    ) : (
                                      assistant.name.slice(0, 1)
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-slate-600">{assistant.name}</span>
                                  <span className="shrink-0 text-[9px] font-black text-orange-500">{assistant.count}单</span>
                                </div>
                              )) : (
                                <p className="text-[10px] font-semibold leading-relaxed text-[--text-muted]">暂无完成助理</p>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full min-h-[108px] items-center justify-center text-center text-[11px] font-bold leading-relaxed text-[--text-muted]">
                            鼠标移到饼图色块查看明细
                          </div>
                        )}
                      </div>

                      <div className="absolute bottom-0 right-0 z-10 flex w-[170px] flex-col items-stretch gap-1.5">
                        {areaTaskTypeBreakdown.map((item) => {
                          return (
                            <div key={item.name} className="flex items-center gap-2 text-[11px] font-black text-[--text-primary]">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="min-w-0 flex-1 truncate">{item.name}</span>
                              <span className="shrink-0">{item.count}单</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="shrink-0 space-y-2">
                    <div className="grid grid-cols-6 gap-2">
                      {[
                        { label: "今日总单", value: areaTaskStats.total, dot: "#111827", cls: "bg-white/75", auxLabel: "已完成", auxValue: `${areaTaskStats.completed}单` },
                        { label: "公共队列", value: publicQueueTasks.length, dot: "#64748b", cls: "bg-slate-50/90", auxLabel: "占今日", auxValue: `${areaTaskStats.total > 0 ? Math.round((publicQueueTasks.length / areaTaskStats.total) * 100) : 0}%` },
                        { label: "待就位", value: areaTaskStats.assigned, dot: DOCK_DOT.assigned, cls: "bg-blue-50/90", auxLabel: "占今日", auxValue: `${areaTaskStats.total > 0 ? Math.round((areaTaskStats.assigned / areaTaskStats.total) * 100) : 0}%` },
                        { label: "进行中", value: areaRealtimeStats.executing, dot: DOCK_DOT.inProgress, cls: "bg-orange-50/90", auxLabel: "区域助理", auxValue: `${areaAssistantStats.total > 0 ? Math.round((areaRealtimeStats.executing / areaAssistantStats.total) * 100) : 0}%` },
                        { label: "暂停中", value: areaTaskStats.paused, dot: "#9ca3af", cls: "bg-gray-100/80", auxLabel: "占今日", auxValue: `${areaTaskStats.total > 0 ? Math.round((areaTaskStats.paused / areaTaskStats.total) * 100) : 0}%` },
                        { label: "已超时", value: areaRealtimeStats.overtime, dot: DOCK_DOT.overtime, cls: "bg-red-50/90", auxLabel: "区域助理", auxValue: `${areaAssistantStats.total > 0 ? Math.round((areaRealtimeStats.overtime / areaAssistantStats.total) * 100) : 0}%` },
                      ].map((item) => (
                        <div key={item.label} className={`min-h-[66px] rounded-xl border border-white/70 px-2.5 py-2 shadow-sm ${item.cls}`}>
                          <div className="mb-1.5 flex items-center justify-between gap-1">
                            <span className="block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.dot }} />
                            <span className="rounded-lg bg-white/55 px-1.5 py-1 text-[8px] font-extrabold leading-none text-[--text-muted]">{item.auxValue}</span>
                          </div>
                          <p className="truncate text-[9px] font-bold text-[--text-muted]">{item.label}</p>
                          <p className="mt-0.5 text-[18px] font-extrabold leading-none text-[--text-primary]">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-gray-50/70 p-2">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-[12px] font-extrabold text-[--text-primary]">助理状态</h4>
                        <span className="text-[10px] font-extrabold text-[--text-muted]">区域助理 {areaAssistantStats.total}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {[
                          { label: "区域助理", value: areaAssistantStats.total, color: "#111827", foot: "总数" },
                          { label: "空闲中", value: areaAssistantStats.idle, color: DOCK_DOT.idle, foot: `${areaAssistantStats.total > 0 ? Math.round((areaAssistantStats.idle / areaAssistantStats.total) * 100) : 0}%` },
                          { label: "待就位", value: areaAssistantStats.assigned, color: DOCK_DOT.assigned, foot: `${areaAssistantStats.total > 0 ? Math.round((areaAssistantStats.assigned / areaAssistantStats.total) * 100) : 0}%` },
                          { label: "进行中", value: areaAssistantStats.executing, color: DOCK_DOT.inProgress, foot: `${areaAssistantStats.total > 0 ? Math.round((areaAssistantStats.executing / areaAssistantStats.total) * 100) : 0}%` },
                          { label: "已下线", value: areaAssistantStats.offline, color: DOCK_DOT.offline, foot: `${areaAssistantStats.total > 0 ? Math.round((areaAssistantStats.offline / areaAssistantStats.total) * 100) : 0}%` },
                        ].map((item) => (
                          <div key={item.label} className="rounded-lg bg-white/75 px-2 py-1.5">
                            <span className="mb-1 block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                            <p className="truncate text-[9px] font-bold text-[--text-muted]">{item.label}</p>
                            <div className="mt-0.5 flex items-end justify-between gap-1">
                              <p className="text-[17px] font-extrabold leading-none text-[--text-primary]">{item.value}</p>
                              <p className="text-[9px] font-extrabold leading-none text-[--text-muted]">{item.foot}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
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
            <div className="relative w-full max-w-[510px] rounded-[36px] border border-white/70 bg-white/90 px-9 py-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <button
                type="button"
                aria-label="忽略这条消息"
                title="忽略这条消息"
                onClick={() => setDismissedReassignmentNoticeIds((prev) =>
                  prev.includes(activeReassignmentNotice.id) ? prev : [...prev, activeReassignmentNotice.id]
                )}
                className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-[20px] font-semibold leading-none text-slate-400 shadow-sm shadow-slate-200/50 transition-colors hover:bg-white/90 hover:text-slate-600"
              >
                ×
              </button>
              <div className="mb-6 flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full ${
                  activeReassignmentNoticeRole === "old" && !activeReassignmentKeepsOldOnline
                    ? "bg-red-500/15 text-red-600"
                    : "bg-purple-500/15 text-purple-600"
                }`}>
                  {activeReassignmentNoticeRole === "old" ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  ) : (
                    <TransferArrowsIcon className="h-7 w-7" />
                  )}
                </div>
		                <div>
		                  <p className={`text-[23px] font-bold leading-tight ${
                        activeReassignmentNoticeRole === "old" && !activeReassignmentKeepsOldOnline ? "text-[--text-primary]" : "text-purple-950"
                      }`}>
		                    {activeReassignmentNoticeRole === "old"
                        ? activeReassignmentKeepsOldOnline
                          ? "任务转派提醒"
                          : "待就位超时提醒"
                        : "任务接替/交换提醒"}
		                  </p>
	                  <p className="mt-1 text-[17px] leading-snug text-[--text-secondary]">
	                    {activeReassignmentTaskLabel}
	                  </p>
	                </div>
	              </div>
	              <div className={`rounded-3xl border px-6 py-5 ${
	                activeReassignmentNoticeRole === "old" && !activeReassignmentKeepsOldOnline
	                  ? "border-red-100 bg-red-50/75"
	                  : "border-purple-100 bg-purple-50/75"
	              }`}>
	                <p className={`whitespace-pre-wrap break-words text-[21px] leading-relaxed ${
	                  activeReassignmentNoticeRole === "old" && !activeReassignmentKeepsOldOnline ? "text-red-900" : "text-purple-950"
	                }`}>
	                  {activeReassignmentMessage}
	                </p>
	              </div>
              <button
                type="button"
                disabled={reassignmentNoticeSavingId === activeReassignmentNotice.id}
                className={`mt-8 w-full rounded-3xl px-6 py-4 text-[21px] font-bold text-white shadow-lg transition-colors active:scale-[0.99] disabled:opacity-70 ${
                  activeReassignmentNoticeRole === "old"
                    ? activeReassignmentKeepsOldOnline
                      ? "bg-purple-500 shadow-purple-500/20 hover:bg-purple-600"
                      : "bg-red-500 shadow-red-500/20 hover:bg-red-600"
                    : "bg-purple-500 shadow-purple-500/20 hover:bg-purple-600"
                }`}
                onClick={() => handleAcknowledgeReassignmentNotice(
                  activeReassignmentNotice,
                  activeReassignmentNoticeRole === "old" ? "acknowledgeOld" : "acknowledgeNew"
                )}
              >
	                {reassignmentNoticeSavingId === activeReassignmentNotice.id
	                  ? "确认中..."
	                  : activeReassignmentNoticeRole === "old"
	                    ? activeReassignmentKeepsOldOnline
                        ? "知道了"
                        : "确认并恢复在线"
	                    : "确认"}
              </button>
            </div>
          </div>
        )}

        {transferTask && transferConfirmTarget && (
          <div className="fixed inset-0 z-[240] flex items-center justify-center bg-white/25 px-6 backdrop-blur-md">
            <div data-transfer-confirm="true" className="relative w-full max-w-[510px] rounded-[36px] border border-white/70 bg-white/90 px-9 py-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <button
                type="button"
                aria-label="关闭转派提醒"
                title="关闭"
                disabled={transferSavingAssistantId === transferConfirmTarget.assistantId}
                onClick={() => setTransferConfirmTarget(null)}
                className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-[20px] font-semibold leading-none text-slate-400 shadow-sm shadow-slate-200/50 transition-colors hover:bg-white/90 hover:text-slate-600 disabled:cursor-wait disabled:opacity-50"
              >
                ×
              </button>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/15 text-purple-600">
                  <TransferArrowsIcon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-[23px] font-bold leading-tight text-purple-950">任务转派提醒</p>
                  <p className="mt-1 text-[17px] leading-snug text-[--text-secondary]">
                    {`${transferTask.roomNumber}室 · ${transferTask.category?.name ?? "任务"} · P${transferTask.priority}`}
                  </p>
                </div>
              </div>
              <div className="rounded-3xl border border-purple-100 bg-purple-50/75 px-6 py-5">
                <p className="whitespace-pre-wrap break-words text-[21px] leading-relaxed text-purple-950">
                  {`当前任务转派是否与「${transferConfirmTarget.assistantName}」沟通协商确认？`}
                </p>
                <p className="mt-3 whitespace-pre-wrap break-words text-[15px] font-semibold leading-relaxed text-purple-950/72">
                  点击确认后只会向目标助理发送接替确认请求；对方确认并实际接手前，你仍保持当前任务状态。
                </p>
              </div>
              <button
                type="button"
                disabled={transferSavingAssistantId === transferConfirmTarget.assistantId}
                className="mt-8 w-full rounded-3xl bg-purple-500 px-6 py-4 text-[21px] font-bold text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-600 active:scale-[0.99] disabled:opacity-70"
                onClick={() => void handleTransferAssistant(transferConfirmTarget.assistantId)}
              >
                {transferSavingAssistantId === transferConfirmTarget.assistantId ? "确认中..." : "确认"}
              </button>
            </div>
          </div>
        )}

        {incomingConfirmingTransferTask && incomingConfirmingTransfer && (
          <div className="fixed inset-0 z-[235] flex items-center justify-center bg-white/25 px-6 backdrop-blur-md">
            <div className="relative w-full max-w-[510px] rounded-[36px] border border-white/70 bg-white/90 px-9 py-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
              <button
                type="button"
                aria-label="稍后处理移交请求"
                title="稍后处理"
                disabled={transferResponseSaving != null}
                onClick={() => setDismissedTransferRequestIds((prev) => [...prev, incomingConfirmingTransfer.id])}
                className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-[20px] font-semibold leading-none text-slate-400 shadow-sm shadow-slate-200/50 transition-colors hover:bg-white/90 hover:text-slate-600 disabled:cursor-wait disabled:opacity-50"
              >
                ×
              </button>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/15 text-purple-600">
                  <TransferArrowsIcon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-[23px] font-bold leading-tight text-purple-950">收到移交请求</p>
                  <p className="mt-1 text-[17px] leading-snug text-[--text-secondary]">
                    {`${incomingConfirmingTransferTask.roomNumber}室 · ${incomingConfirmingTransferTask.category?.name ?? "任务"} · P${incomingConfirmingTransferTask.priority}`}
                  </p>
                </div>
              </div>
              <div className="rounded-3xl border border-purple-100 bg-purple-50/75 px-6 py-5">
                <p className="whitespace-pre-wrap break-words text-[21px] leading-relaxed text-purple-950">
                  {`是否确认接替「${allProfiles.find((item) => item.id === incomingConfirmingTransfer.fromAssistantId)?.name ?? "原助理"}」移交的当前任务？`}
                </p>
                <p className="mt-3 whitespace-pre-wrap break-words text-[15px] font-semibold leading-relaxed text-purple-950/72">
                  {incomingConfirmingTransferIsSwap
                    ? "你当前正在任务中，请选择立即暂停互换，或完成当前任务后再前往接替。"
                    : "确认后会立即接手，并进入该任务的待就位状态。"}
                </p>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  disabled={transferResponseSaving != null}
                  className="min-h-[54px] flex-1 rounded-3xl bg-white/70 px-5 text-[18px] font-bold text-[--text-secondary] shadow-sm shadow-slate-200/50 transition-colors hover:bg-white disabled:opacity-60"
                  onClick={() => void handleRespondTransferRequest(false)}
                >
                  {transferResponseSaving === "reject" ? "处理中..." : "拒绝"}
                </button>
                {incomingConfirmingTransferIsSwap ? (
                  <>
                    <button
                      type="button"
                      disabled={transferResponseSaving != null}
                      className="min-h-[54px] flex-1 rounded-3xl bg-purple-500 px-4 text-[17px] font-bold text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-600 active:scale-[0.99] disabled:opacity-70"
                      onClick={() => void handleRespondTransferRequest(true, "pause_and_go")}
                    >
                      {transferResponseSaving === "pause_and_go" ? "处理中..." : "暂停并前往"}
                    </button>
                    <button
                      type="button"
                      disabled={transferResponseSaving != null}
                      className="min-h-[54px] flex-1 rounded-3xl bg-purple-600 px-4 text-[17px] font-bold text-white shadow-lg shadow-purple-600/20 transition-colors hover:bg-purple-700 active:scale-[0.99] disabled:opacity-70"
                      onClick={() => void handleRespondTransferRequest(true, "after_complete")}
                    >
                      {transferResponseSaving === "after_complete" ? "处理中..." : "结束后前往"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={transferResponseSaving != null}
                    className="min-h-[54px] flex-1 rounded-3xl bg-purple-500 px-5 text-[18px] font-bold text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-600 active:scale-[0.99] disabled:opacity-70"
                    onClick={() => void handleRespondTransferRequest(true)}
                  >
                    {transferResponseSaving === "accept" ? "确认中..." : "确认接替"}
                  </button>
                )}
              </div>
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
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          setShowAssistantPresenceMenu(false);
          setIdentityPresenceMenuId(null);
        }}
      >
        {/* 左侧三面板 */}
        <div className="absolute top-3 left-3 bottom-3 z-20 hidden w-[330px] flex-col gap-2 lg:flex">
          {/* 面板1：摄影师信息 + 位置 + 天气 + 时间 */}
          <div className={`left-workbench-panel ${resolvedTheme === "dark" ? "left-workbench-panel-dark" : ""} relative z-[80] overflow-visible rounded-2xl px-4 py-3.5 ${glass}`}>
            <div className="relative mb-1" style={{ zIndex: 240 }}>
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[95px] h-[95px] overflow-visible"
                style={{ zIndex: 230 }}
              >
                <div
                  className="group relative h-full w-full cursor-pointer overflow-hidden rounded-full shadow-md shadow-orange-200/40 ring-2 ring-white/60"
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
                {isAssistantProfile && (
                  <div
                    className="absolute bottom-0 right-0"
                    style={{ zIndex: 260 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-[2px] border-white bg-white shadow-md shadow-black/10 transition-transform hover:scale-105 ${assistantPresenceInfo.textCls}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAssistantPresenceMenu((open) => !open);
                      }}
                    title={assistantPresenceInfo.label}
                  >
                      <LivePresenceDot
                        className="block h-[18px] w-[18px] rounded-full"
                        baseColor={assistantPresenceInfo.dot}
                        isEating={assistantPresence === "eating"}
                        startedAt={eatingStartedAt}
                        accumulatedSeconds={profile?.eatingAccumulatedSeconds}
                        thresholdSeconds={eatingOvertimeAlertMin * 60}
                      />
                    </button>
                    {showAssistantPresenceMenu && (
                      <div className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 rounded-xl border border-white/80 bg-white/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl" style={{ zIndex: 300 }}>
                        <div className="flex flex-col gap-1">
                          {(["online", "eating", "on_break"] as AssistantPresenceState[]).map((state) => {
                            const meta = assistantPresenceMeta(state);
                            const selected = assistantPresence === state;
                            const reentryMinutes = state === "eating" && !selected
                              ? eatingReentryRemainingMinutesForProfile(profile)
                              : 0;
                            const hintUntil = state === "eating" && profile ? eatingReentryHintUntilByProfileId[profile.id] : null;
                            const hintRemainingMs = hintUntil ? Math.max(0, new Date(hintUntil).getTime() - now.getTime()) : 0;
                            const hintMinutes = hintRemainingMs > 0 ? Math.max(1, Math.ceil(hintRemainingMs / 60000)) : 0;
                            const disabled = !assistantCanChangePresence && !selected;
                            return (
                              <button
                                key={state}
                                type="button"
                                disabled={disabled}
                                className={`relative flex min-w-[108px] items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[10px] font-extrabold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-65 ${
                                  selected ? `${meta.bgCls} ${meta.borderCls} ${meta.textCls}` : "border-gray-100 text-gray-500 hover:bg-gray-50"
                                }`}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (selected || disabled || !profile) return;
                                  if (state === "eating" && reentryMinutes > 0) {
                                    void updateAssistantPresenceStatus(profile.id, state);
                                    return;
                                  }
                                  setShowAssistantPresenceMenu(false);
                                  void updateAssistantPresenceStatus(profile.id, state);
                                }}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dot }} />
                                  <span>{meta.label}</span>
                                </span>
                                {hintMinutes > 0 && (
                                  <span className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-[320] -translate-y-1/2 whitespace-nowrap rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-[10px] font-black leading-none text-orange-500 shadow-lg shadow-orange-200/40">
                                    短时间内无法再次切换吃饭中状态
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="min-h-[52px] min-w-0 flex justify-end">
                <div className="w-[190px]">
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
              className="pointer-events-none relative flex items-center justify-end gap-1.5 mt-1"
              onMouseLeave={closeLocationMenuSoon}
            >
              <div className="pointer-events-auto flex min-w-0 items-center justify-end gap-1.5 text-[13px] font-semibold text-orange-500">
                {isAssistantProfile || assistantLocationTask ? (
                  <span
                    className="relative inline-flex min-w-0"
                    onMouseEnter={() => {
                      cancelLocationMenuClose();
                      if (assistantBuildingOptions.length > 0) setShowVenueMenu(true);
                    }}
                  >
                    <button
                      type="button"
                      disabled={assistantBuildingOptions.length === 0}
                      className={`inline-flex max-w-[230px] items-center gap-1.5 truncate rounded-md px-0.5 py-0.5 text-left transition-colors ${
                        assistantBuildingOptions.length > 0
                          ? "cursor-pointer hover:bg-orange-500/10 hover:text-orange-600"
                          : "cursor-default"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (assistantBuildingOptions.length === 0) return;
                        cancelLocationMenuClose();
                        setShowVenueMenu((prev) => !prev);
                      }}
                    >
                      <svg className="shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                      </svg>
                      <span className="truncate">{workbenchLocationText}</span>
                    </button>
                    {showVenueMenu && assistantBuildingOptions.length > 0 && (
                      <div
		                        className={`location-menu-drop absolute left-[18px] top-full z-[200] mt-1 w-fit rounded-xl border px-1.5 py-1.5 shadow-lg backdrop-blur-xl ${workbenchLocationMenuSurfaceCls}`}
                        onMouseEnter={cancelLocationMenuClose}
                        onMouseLeave={closeLocationMenuSoon}
                      >
                        <div className="flex flex-col items-start gap-1.5">
                          {assistantBuildingOptions.map((bld) => (
                            <button
                              key={bld.id}
                              onClick={() => switchAssistantBuilding(bld.id)}
		                              className={`w-auto whitespace-nowrap rounded-lg bg-transparent px-2 py-1 text-left text-[13px] font-semibold leading-tight shadow-none transition-all duration-150 hover:translate-x-1 active:scale-95 ${workbenchLocationMenuItemCls}`}
                            >
                              {bld.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        className="inline-flex max-w-[130px] items-center gap-1.5 truncate rounded-md px-0.5 py-0.5 transition-colors hover:bg-orange-500/10 hover:text-orange-600"
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
		                          className={`location-menu-drop absolute left-[18px] top-full z-[200] mt-1 w-fit rounded-xl border px-1 py-1 shadow-lg backdrop-blur-xl ${workbenchLocationMenuSurfaceCls}`}
                          onMouseEnter={cancelLocationMenuClose}
                          onMouseLeave={closeLocationMenuSoon}
                        >
                          <div className="flex flex-col items-start gap-1">
                            {photographerBuildingOptions.length === 0 ? (
	                              <span className="whitespace-nowrap px-2 py-1 text-left text-[13px] font-semibold leading-tight text-[--text-muted]">
                                暂无其它楼座
                              </span>
                            ) : (
                              photographerBuildingOptions.map((bld) => (
                                <button
                                  key={bld.id}
                                  onClick={() => switchPhotographerBuilding(bld.id)}
		                                  className={`w-auto whitespace-nowrap rounded-lg bg-transparent px-2 py-1 text-left text-[13px] font-semibold leading-tight shadow-none transition-all duration-150 hover:translate-x-1 active:scale-95 ${workbenchLocationMenuItemCls}`}
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
                      className="max-w-[120px] truncate rounded-md px-0.5 py-0.5 transition-colors hover:bg-orange-500/10 hover:text-orange-600"
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
                  return null;
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
		                      className={`absolute flex w-max flex-col items-stretch gap-1 rounded-2xl border px-1.5 py-1.5 shadow-xl backdrop-blur-2xl ${workbenchLocationMenuSurfaceCls}`}
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
	                      <span className="w-full whitespace-nowrap px-2.5 text-left text-[11px] font-bold text-[--text-muted]">切换场地</span>
	                      {isEmpty ? (
	                        <span className={`w-full whitespace-nowrap rounded-md px-2.5 py-1 text-left text-[10px] font-bold shadow ${
	                          resolvedTheme === "dark" ? "bg-white/[0.08] text-slate-400" : "bg-gray-100 text-gray-400"
	                        }`}>
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
	                                  ? resolvedTheme === "dark"
	                                    ? "border border-blue-300/35 bg-white/[0.09] text-blue-200 hover:bg-blue-300/[0.16]"
	                                    : "bg-white text-blue-500 border border-blue-400 hover:bg-blue-50"
	                                  : resolvedTheme === "dark"
	                                    ? "bg-blue-400/24 text-blue-100 hover:bg-blue-400/32"
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
              <LiveClockText className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[--text-secondary]" />
            </div>
          </div>

	          {/* 面板2：快捷预约（摄影师） / 当前任务状态（助理） */}
	          {isAssistantRole(profile?.role) ? (
	            <div className={`left-workbench-panel ${resolvedTheme === "dark" ? "left-workbench-panel-dark" : ""} relative overflow-visible rounded-2xl px-4 py-3 flex-1 min-h-0 flex flex-col ${glass}`}>
		              <div className="relative z-[120] mb-2.5 flex items-center justify-between gap-2">
		                <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide">当前任务状态</h3>
		                {renderAssistantTransferHeaderControl()}
		                {renderTransferPicker()}
		              </div>
		              <div className="flex-1 min-h-0 flex flex-col items-stretch justify-start gap-2 w-full pt-0.5">
	                {eatingIsPaused ? (
	                  <div className={`w-full shrink-0 rounded-xl border px-2.5 py-2 ${resolvedTheme === "dark" ? "border-sky-300/20 bg-sky-400/14" : "border-sky-200/70 bg-sky-400/12"}`}>
	                    <div className="flex items-center gap-2">
	                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${resolvedTheme === "dark" ? "bg-sky-300/18" : "bg-sky-500/14"}`}>
	                        <div className="h-3 w-3 rounded-full bg-sky-500" />
	                      </div>
	                      <div className="min-w-0 flex-1">
	                        <p className={`truncate text-[12px] font-extrabold leading-tight ${resolvedTheme === "dark" ? "text-sky-100" : "text-sky-700"}`}>
	                          吃饭已暂停
	                        </p>
	                        <p className={`mt-0.5 truncate font-mono text-[10px] font-semibold leading-tight tabular-nums ${resolvedTheme === "dark" ? "text-sky-100/76" : "text-sky-700/70"}`}>
		                          暂停中 <LiveEatingHMS startedAt={profile?.eatingPausedAt} mode="paused" /> · 已吃饭 {formatSecondsAsHMS(eatingPausedSeconds)}
	                        </p>
	                      </div>
	                      <button
	                        type="button"
	                        disabled={!profile}
	                        onClick={(e) => {
	                          e.preventDefault();
	                          e.stopPropagation();
	                          if (!profile) return;
	                          void updateAssistantPresenceStatus(profile.id, "eating");
	                        }}
	                        className="h-7 shrink-0 rounded-full bg-sky-500 px-2.5 text-[10px] font-extrabold text-white shadow-sm shadow-sky-500/20 transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
	                      >
	                        继续
	                      </button>
	                    </div>
	                  </div>
	                ) : null}
	                {(() => {
                  const renderEatingPresenceBlock = () => (
                    <LiveEatingTimerState
                      startedAt={eatingStartedAt}
                      accumulatedSeconds={profile?.eatingAccumulatedSeconds}
                      thresholdSeconds={eatingOvertimeAlertMin * 60}
                    >
                      {({ elapsedText, overtimeText, isOvertime }) => (
                        <div className={`w-full flex-1 rounded-xl flex flex-col items-center justify-center gap-3 ${isOvertime ? "bg-red-400/15" : "bg-blue-400/15"}`}>
                          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isOvertime ? "bg-red-500/15" : "bg-blue-500/15"}`}>
                            <div className={`w-8 h-8 rounded-full animate-pulse ${isOvertime ? "bg-red-500" : "bg-blue-500"}`} />
                          </div>
                          <span className={`text-[30px] font-extrabold ${isOvertime ? "text-red-600" : "text-blue-600"}`}>
                            {isOvertime ? "吃饭超时" : "吃饭中"}
                          </span>
                          <span className={`font-mono text-[24px] font-semibold leading-none tabular-nums ${isOvertime ? "text-red-600" : "text-blue-600"}`}>
                            {elapsedText}
                          </span>
                          <span className={`text-[11px] ${isOvertime ? "text-red-600/70" : "text-blue-600/70"}`}>
                            {isOvertime ? <>已超过提醒阈值 {overtimeText}</> : `超过 ${eatingOvertimeAlertMin} 分钟提醒`}
                          </span>
                          <div className="mt-1 grid w-full max-w-[260px] grid-cols-2 gap-2 px-2">
                            <button
                              type="button"
                              disabled={!profile}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!profile) return;
                                void updateAssistantPresenceStatus(profile.id, "online", { eatingExitMode: "pause" });
                              }}
                              className="rounded-full bg-blue-500 px-3 py-2 text-[11px] font-extrabold text-white shadow-lg shadow-blue-500/20 transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              暂停吃饭
                            </button>
                            <button
                              type="button"
                              disabled={!profile}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!profile) return;
                                void updateAssistantPresenceStatus(profile.id, "online", { eatingExitMode: "end" });
                              }}
                              className="rounded-full bg-emerald-500 px-3 py-2 text-[11px] font-extrabold text-white shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              结束吃饭
                            </button>
                          </div>
                        </div>
                      )}
                    </LiveEatingTimerState>
                  );

	                  if (assistantPresence === "eating") {
	                    return renderEatingPresenceBlock();
	                  }

	                  // 无任务 → 空闲
	                  if (!currentRawTask && !pausedRawTask) {
	                    if (assistantPresence === "on_break") {
	                      return (
	                        <div className={`left-status-card ${resolvedTheme === "dark" ? "left-status-card-dark" : ""} w-full flex-1 rounded-xl bg-gray-400/15 flex flex-col items-center justify-center gap-3`}>
                          <div className="w-16 h-16 rounded-full bg-gray-400/15 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-gray-400" />
                          </div>
                          <span className="text-[30px] font-extrabold text-gray-500">休假/下班 /离线</span>
                          <span className="text-[11px] text-gray-500/70">今天有事不在</span>
                        </div>
                      );
                    }
                    return (
                      <div className={`left-status-card left-status-card-idle ${resolvedTheme === "dark" ? "left-status-card-dark left-status-card-idle-dark" : ""} w-full flex-1 rounded-xl bg-green-400/20 flex flex-col items-center justify-center gap-3`}>
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
                  const myTaskStatus = (task: TaskFromAPI) => taskStatusForProfile(task, profile?.id) ?? task.status;
                  const myTaskTiming = (task: TaskFromAPI) => {
                    const status = myTaskStatus(task);
                    return { ...taskTimingForProfile(task, profile?.id), status };
                  };
                  const taskActionPending = (action: WorkbenchPendingAction, task: TaskFromAPI) => (
                    isWorkbenchPendingAction(workbenchTaskActionKey(action, task.id, profile?.id))
                  );
                  const actionableWaitingTasks = profile
                    ? assistantStartCandidateTasksForProfile(taskListRaw, areaTasks, profile.id, freeIroningMachineCount)
                    : [];
	                  const selectedActionableWaitingTasks = actionableWaitingTasks;
	                  const recommendedIroningTaskId = freeIroningMachineCount > 0
	                    ? selectedActionableWaitingTasks.find((task) => isIroningTask(task))?.id ?? null
	                    : null;
	                  const passiveIroningReadyTask = actionableWaitingTasks.find((task) =>
	                    isAssignedIroningReadyTask(task, profile?.id)
                  ) ?? null;
			                    const renderPausedBlock = (task: TaskFromAPI, flex: number, withResume = false) => {
                      const timing = myTaskTiming(task);
	                      const pauseSlideActive = manualPauseSlide?.taskId === task.id;
	                      const pauseSlideCollapsed = pauseSlideActive && !manualPauseSlide.expanded;
                      const resumePending = taskActionPending("resume", task) || taskActionPending("start", task);
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
	                              {renderEscalationBadge(task, { compact: true })}
	                              {lineRoomPhotoCategory(task, "text-gray-500")}
	                              <LiveHMSBlock source={timing} mode="paused" colorClassName="text-gray-600" />
	                            </div>
	                            <button
	                              type="button"
	                              onClick={() => handleResumePausedTask(task)}
	                              disabled={pauseSlideActive || resumePending}
                              aria-busy={resumePending}
	                              className={`absolute left-[24%] right-[24%] bottom-2.5 z-[2] h-[34px] rounded-lg border border-green-600 bg-green-500 text-[15px] font-extrabold text-white shadow-sm transition-[opacity,background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-default ${
	                                pauseSlideCollapsed ? "pointer-events-none opacity-0" : "opacity-100 hover:bg-green-600"
	                              }`}
	                            >
	                              {resumePending ? "继续中..." : "继续任务"}
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
	                        {renderEscalationBadge(task, { compact: true })}
	                        {lineRoomPhotoCategory(task, "text-gray-400")}
	                        <LiveHMSBlock source={timing} mode="paused" colorClassName="text-gray-500" />
	                      </div>
                    );
                  };

	                  /** 待就位被插单：原较低优先任务让行，样式与地图灰 50% 一致 */
	                  const renderDeferredWaitingBlock = (task: TaskFromAPI, flex: number) => {
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
	                        {renderEscalationBadge(task, { compact: true })}
	                        {lineRoomPhotoCategory(task, "text-gray-400")}
	                        <LiveElapsedHMSBlock startedAt={task.createdAt} colorClassName="text-gray-500" />
	                      </div>
                    );
                  };

	                  // 渲染执行中任务区块（有插单任务时：可完成当前任务，也可短暂离开）
		                  const renderExecutingWithPause = (task: TaskFromAPI, flex: number) => {
		                    const timing = myTaskTiming(task);
		                    const isExternalModelFollow = isExternalModelFollowTask(task);
                    const completePending = taskActionPending("complete", task);
                    const pausePending = taskActionPending("pause", task);
                    const bgCls = isExternalModelFollow ? "bg-purple-400/20" : "bg-orange-400/20";
                    const hoverCls = isExternalModelFollow ? "hover:bg-purple-400/10" : "hover:bg-orange-400/10";
                    const dotBg = isExternalModelFollow ? "bg-purple-500/20" : "bg-orange-500/20";
                    const dotColor = isExternalModelFollow ? "bg-purple-500" : "bg-orange-500";
                    const textColor = isExternalModelFollow ? "text-purple-600" : "text-orange-600";
                    const subColor = isExternalModelFollow ? "text-purple-600/80" : "text-orange-600/80";
                    const barFrom = isExternalModelFollow ? "from-purple-400" : "from-orange-400";
                    const barTo = isExternalModelFollow ? "to-purple-500" : "to-orange-500";
                    const pauseButtonCls = isExternalModelFollow
                      ? "border-purple-500 bg-purple-500 hover:bg-purple-600"
                      : "border-[#e55f5f] bg-[#ef6b6b] hover:bg-[#e85f5f]";
                    const pauseButtonLabel = isExternalModelFollow ? "吃饭/短暂离开" : "短暂离开";
                    return (
                      <div
                        key={task.id}
                        className={`w-full min-h-0 rounded-xl ${bgCls} relative overflow-hidden`}
                        style={flexStyle(flex)}
                      >
	                        <button
	                          type="button"
	                          onClick={() => handleAssistantStatusChange("complete", task)}
                          disabled={completePending}
                          aria-busy={completePending}
	                          className={`absolute inset-x-0 top-0 bottom-[42px] z-[1] flex cursor-pointer flex-col items-center justify-center gap-1 px-2 pt-1.5 pb-1 transition-colors ${hoverCls} active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70`}
	                        >
                          <div className={`w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full ${dotBg} flex items-center justify-center overflow-hidden`}>
                            <div className={`min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full ${dotColor} animate-pulse`} />
                          </div>
		                          <span className={`text-[13px] font-extrabold ${textColor}`}>{completePending ? "完成中..." : "完成当前任务"}</span>
	                          {renderEscalationBadge(task, { compact: true })}
	                          {lineRoomPhotoCategory(task, subColor)}
	                          <LiveHMSBlock source={timing} mode="effective" colorClassName={textColor} />
	                        </button>
	                        <button
	                          type="button"
	                          onClick={handlePauseCurrentTask}
                          disabled={pausePending}
                          aria-busy={pausePending}
	                          className={`absolute left-[24%] right-[24%] bottom-2.5 z-[2] h-[30px] rounded-lg border text-[13px] font-extrabold text-white shadow-sm transition-[background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${pauseButtonCls}`}
	                        >
	                          {pausePending ? "暂停中..." : pauseButtonLabel}
	                        </button>
                        <div className="absolute bottom-0 left-0 right-0 z-[3] h-1 overflow-hidden pointer-events-none">
                          <div className={`h-full w-[200%] bg-gradient-to-r ${barFrom} ${barTo} ${barFrom} animate-[shimmer_2s_linear_infinite]`} />
                        </div>
                      </div>
                    );
                  };

                  // 渲染待就位任务区块（只显示信息，无按钮）
	                  const renderPendingBlock = (task: TaskFromAPI, flex: number) => (
	                    <div key={task.id} className={`w-full min-h-0 rounded-xl flex flex-col items-center justify-center gap-1.5 pt-1.5 pb-1 ${resolvedTheme === "dark" ? "bg-blue-500/18" : "bg-blue-400/10"}`} style={flexStyle(flex)}>
	                      <div className={`w-8 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2rem,26%)] h-[min(2rem,26%)] rounded-full flex items-center justify-center overflow-hidden ${resolvedTheme === "dark" ? "bg-blue-300/20" : "bg-blue-500/20"}`}>
	                        <div className="min-w-0 min-h-0 w-[42%] h-[42%] max-w-[min(72%,1.1rem)] max-h-[min(72%,1.1rem)] rounded-full bg-blue-400" />
	                      </div>
	                      <span className={`text-[13px] font-extrabold ${resolvedTheme === "dark" ? "text-blue-100" : "text-blue-600"}`}>待就位</span>
	                      {renderEscalationBadge(task, { compact: true })}
	                      {lineRoomPhotoCategory(task, resolvedTheme === "dark" ? "text-blue-100/85" : "text-blue-600/80")}
	                      <p className={`text-[10px] text-center px-2 ${resolvedTheme === "dark" ? "text-blue-100/75" : "text-blue-600/70"}`}>
	                        {taskCategoryDurationCaption(task.category, task.priority)}
	                      </p>
	                    </div>
	                  );

	                  const startActionLabel = (task: TaskFromAPI) =>
	                    isIroningTask(task)
	                      ? "开始熨烫"
	                      : "开始任务";

	                  const waitingActionTone = (task: TaskFromAPI) => {
	                    const dark = resolvedTheme === "dark";
		                    if (isIroningTask(task)) {
	                      return dark
	                        ? {
	                          card: "border-lime-300/25 bg-lime-400/18 hover:bg-lime-400/26",
	                          dotWrap: "bg-lime-300/20",
	                          dot: "bg-lime-400",
	                          title: "text-lime-100",
	                          meta: "text-lime-100/82",
	                          tag: "bg-lime-300/20 text-lime-100 ring-1 ring-lime-200/20",
	                        }
	                        : {
	                          card: "border-lime-200/70 bg-lime-400/18 hover:bg-lime-400/28",
	                          dotWrap: "bg-lime-500/18",
	                          dot: "bg-lime-500",
	                          title: "text-lime-700",
	                          meta: "text-lime-700/80",
	                          tag: "bg-lime-100/80 text-lime-700",
	                        };
	                    }
	                    return dark
	                      ? {
	                        card: "border-blue-300/25 bg-blue-500/20 hover:bg-blue-500/28",
	                        dotWrap: "bg-blue-300/20",
	                        dot: "bg-blue-400",
	                        title: "text-blue-100",
	                        meta: "text-blue-100/82",
	                        tag: "bg-blue-300/20 text-blue-100 ring-1 ring-blue-200/20",
	                      }
	                      : {
	                        card: "border-blue-200/60 bg-blue-400/16 hover:bg-blue-400/26",
	                        dotWrap: "bg-blue-500/18",
	                        dot: "bg-blue-500",
	                        title: "text-blue-600",
	                        meta: "text-blue-600/80",
	                        tag: "bg-blue-100/70 text-blue-600",
	                      };
	                  };

	                  const handleWaitingChoiceStart = (task: TaskFromAPI) => {
	                    const shouldConfirm =
	                      recommendedIroningTaskId &&
	                      task.id !== recommendedIroningTaskId &&
	                      !isIroningTask(task) &&
	                      !task.escalatedAt;
	                    if (shouldConfirm) {
	                      setIroningPreferenceConfirmTask(task);
	                      return;
	                    }
	                    void handleAssistantStatusChange("start", task);
	                  };

	                  const waitingPriorityBadge = (task: TaskFromAPI, textColorCls: string) => (
	                    <span className={`shrink-0 text-[10px] font-black ${textColorCls}`}>
	                      P{Math.min(6, Math.max(1, Math.round(Number(task.priority) || 6)))}
	                    </span>
	                  );

		                  const renderWaitingChoiceBlock = (task: TaskFromAPI) => {
			                    const tone = waitingActionTone(task);
                    const showInlineIroningHint = recommendedIroningTaskId === task.id;
                    const isRecommendedIroning = showInlineIroningHint && isIroningTask(task);
                    const startPending = taskActionPending("start", task);
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={() => handleWaitingChoiceStart(task)}
                        disabled={startPending}
                        aria-busy={startPending}
		                        className={`flex min-h-0 w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left shadow-sm transition-all hover:translate-x-0.5 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${isRecommendedIroning ? "flex-[1.7]" : "flex-[0.82]"} ${tone.card}`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone.dotWrap}`}>
                          <div className={`h-4 w-4 rounded-full ${tone.dot}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
	                            <span className={`truncate text-[14px] font-extrabold leading-tight ${tone.title}`}>
	                              {startPending ? "开始中..." : startActionLabel(task)}
	                            </span>
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold leading-tight ${tone.tag}`}>
                              <span className="block">
                                {isIroningTask(task) ? "准备熨烫" : "待就位"}
                              </span>
	                            </span>
                            {renderEscalationBadge(task, { compact: true })}
                          </div>
                          <p className={`mt-0.5 truncate text-[11px] font-semibold ${tone.meta}`}>
                            {task.roomNumber}室 · {task.photographer?.name ?? "—"} · {assistantCatName(task)}
                          </p>
	                          <p className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] ${tone.meta}`}>
                              {waitingPriorityBadge(task, tone.meta)}
                              <span className="min-w-0 truncate">
	                              {taskCategoryDurationCaption(task.category, task.priority)}
                              {showInlineIroningHint && (
                                <span className="ml-1 font-extrabold text-lime-600">机器空闲建议优先</span>
                              )}
                              </span>
	                          </p>
                        </div>
                      </button>
                    );
                  };

                  const renderWaitingChoices = (tasks: TaskFromAPI[]) => (
                    <div className="flex-1 min-h-0 w-full rounded-xl bg-white/18 p-2 flex flex-col">
                      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                        <span className="text-[11px] font-extrabold text-[--text-primary]">选择要开始的任务</span>
                        <span className="rounded-md bg-white/55 px-1.5 py-0.5 text-[9px] font-extrabold text-[--text-muted]">
                          {tasks.length} 个可选
                        </span>
                      </div>
                      <div className="flex flex-1 min-h-0 flex-col gap-1.5">
                        {tasks.map(renderWaitingChoiceBlock)}
                      </div>
                    </div>
                  );

                  const renderPassiveIroningWaitingBlock = (task: TaskFromAPI, flex: number) => {
                    const cancelPending = taskActionPending("cancel", task);
                    return (
                      <div
                        key={task.id}
                        className="w-full min-h-0 rounded-xl bg-emerald-400/12 flex flex-col items-center justify-center gap-1.5 pt-2 pb-1.5 px-2"
                        style={flexStyle(flex)}
                      >
                        <div className="w-10 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2.5rem,28%)] h-[min(2.5rem,28%)] rounded-full bg-emerald-500/16 flex items-center justify-center overflow-hidden">
                          <div className="min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.35rem)] max-h-[min(72%,1.35rem)] rounded-full bg-emerald-500/80" />
                        </div>
                        <span className="text-[16px] font-extrabold text-emerald-700">
                          {task.ironingStage === "notified" ? "准备熨烫" : "等待熨烫机"}
                        </span>
                        {renderEscalationBadge(task, { compact: true })}
                        {lineRoomPhotoCategory(task, "text-emerald-700/80")}
                        <p className="text-[11px] text-emerald-700/70 text-center px-2">
                          当前无空余熨烫机，只能开始做其他任务
                        </p>
                        <button
                          type="button"
                          disabled={cancelPending}
                          aria-busy={cancelPending}
                          onClick={() => void handleCancelTask(task.id)}
                          className="mt-0.5 rounded-lg border border-red-200/80 bg-white/55 px-3 py-1 text-[11px] font-extrabold text-red-500 transition-colors hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {cancelPending ? "取消中..." : "取消任务"}
                        </button>
                      </div>
                    );
                  };

                  // 渲染单个任务区块（正常流程）
                  const renderTaskBlock = (task: TaskFromAPI, flex: number) => {
                    const status = myTaskStatus(task);
                    if (isPassiveIroningWaitingTask(task)) return renderPassiveIroningWaitingBlock(task, flex);
                    if (status === "paused") return renderPausedBlock(task, flex);
	                    if (status === "waiting") {
	                      const readyIroning = isIroningTask(task);
	                      const tone = waitingActionTone(task);
                      const startPending = taskActionPending("start", task);
	                      return (
	                        <button
	                          type="button"
	                          key={task.id}
	                          onClick={() => handleAssistantStatusChange("start", task)}
                            disabled={startPending}
                            aria-busy={startPending}
		                          className={`w-full min-h-0 rounded-xl border flex flex-col items-center justify-center gap-1.5 pt-2 pb-1.5 cursor-pointer transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 ${tone.card}`}
	                          style={flexStyle(flex)}
	                        >
                          <div className={`w-10 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2.5rem,28%)] h-[min(2.5rem,28%)] rounded-full ${tone.dotWrap} flex items-center justify-center overflow-hidden`}>
                            <div className={`min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.35rem)] max-h-[min(72%,1.35rem)] rounded-full ${tone.dot}`} />
                          </div>
	                          <span className={`text-[16px] font-extrabold ${tone.title}`}>
	                            {startPending ? "开始中..." : readyIroning ? "点击开始熨烫" : "点击开始任务"}
	                          </span>
                          {renderEscalationBadge(task, { compact: true })}
	                          {lineRoomPhotoCategory(task, tone.meta)}
	                          <p className={`flex items-center justify-center gap-1.5 px-2 text-center text-[11px] ${tone.meta}`}>
                            {waitingPriorityBadge(task, tone.meta)}
                            <span>
                              {taskCategoryDurationCaption(task.category, task.priority)} · {readyIroning ? "准备熨烫" : "待就位"}
                              {recommendedIroningTaskId === task.id ? " · 机器空闲建议优先" : ""}
                            </span>
	                          </p>
	                        </button>
                      );
                    }
                    if (status === "executing") {
                      const isLocked = task.isLocked;
                      const isExternalModelFollow = isExternalModelFollowTask(task);
                      const bgCls = isLocked
                        ? "bg-red-400/20 hover:bg-red-400/30"
                        : isExternalModelFollow
                          ? "bg-purple-400/20 hover:bg-purple-400/30"
                          : "bg-orange-400/20 hover:bg-orange-400/30";
                      const dotBg = isLocked ? "bg-red-500/20" : isExternalModelFollow ? "bg-purple-500/20" : "bg-orange-500/20";
                      const dotColor = isLocked ? "bg-red-500" : isExternalModelFollow ? "bg-purple-500" : "bg-orange-500";
                      const textColor = isLocked ? "text-red-600" : isExternalModelFollow ? "text-purple-600" : "text-orange-600";
                      const subColor = isLocked ? "text-red-600/70" : isExternalModelFollow ? "text-purple-600/75" : "text-orange-600/70";
                        const barFrom = isLocked ? "from-red-400" : isExternalModelFollow ? "from-purple-400" : "from-orange-400";
                        const barTo = isLocked ? "to-red-500" : isExternalModelFollow ? "to-purple-500" : "to-orange-500";
	                      const pauseButtonCls = isExternalModelFollow
	                        ? "border-purple-500 bg-purple-500 hover:bg-purple-600"
	                        : "border-[#e55f5f] bg-[#ef6b6b] hover:bg-[#e85f5f]";
	                      const pauseButtonLabel = isExternalModelFollow ? "吃饭/短暂离开" : "短暂离开";
		                      const timing = myTaskTiming(task);
		                      const pauseSlideActive = manualPauseSlide?.taskId === task.id;
                      const completePending = taskActionPending("complete", task);
                      const pausePending = taskActionPending("pause", task);
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
	                              disabled={pauseSlideActive || completePending}
                              aria-busy={completePending}
	                              className={`absolute inset-0 z-[1] flex cursor-pointer flex-col items-center justify-center gap-1 px-2 pb-[46px] pt-2 transition-opacity duration-150 active:scale-[0.98] disabled:cursor-default ${pauseSlideActive ? "opacity-0" : "opacity-100"} ${completePending ? "opacity-70" : ""}`}
	                            >
                              <div className={`w-10 max-w-full min-w-0 min-h-0 shrink-[2] max-h-[min(2.5rem,28%)] h-[min(2.5rem,28%)] rounded-full ${dotBg} flex items-center justify-center overflow-hidden`}>
                                <div className={`min-w-0 min-h-0 w-[45%] h-[45%] max-w-[min(72%,1.35rem)] max-h-[min(72%,1.35rem)] rounded-full ${dotColor} animate-pulse`} />
                            </div>
		                            <span className={`text-[16px] font-extrabold ${textColor}`}>{completePending ? "完成中..." : "点击完成任务"}</span>
	                            {renderEscalationBadge(task, { compact: true })}
	                            {lineRoomPhotoCategory(task, subColor)}
	                            <LiveHMSBlock source={timing} mode="effective" colorClassName={textColor} />
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
	                                {renderEscalationBadge(task, { compact: true })}
	                                {lineRoomPhotoCategory(task, "text-gray-500")}
	                                <LiveHMSBlock source={timing} mode="paused" colorClassName="text-gray-600" />
	                              </div>
                            </div>
	                            <button
	                              type="button"
	                              onClick={handlePauseCurrentTask}
	                              disabled={pauseSlideActive || pausePending}
	                              aria-busy={pauseSlideActive || pausePending}
	                              className={`absolute left-[24%] right-[24%] bottom-2.5 z-[3] flex h-[34px] items-center justify-center overflow-hidden rounded-lg border text-[15px] font-extrabold text-white shadow-sm transition-[opacity,background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-default ${pauseButtonCls} ${
	                                pauseSlideActive ? "pointer-events-none opacity-0" : "opacity-100"
	                              }`}
	                            >
	                              {pausePending ? "暂停中..." : pauseButtonLabel}
	                            </button>
                            <div className={`absolute bottom-0 left-0 right-0 z-[3] h-1 overflow-hidden pointer-events-none transition-opacity duration-200 ${pauseSlideActive ? "opacity-0" : "opacity-100"}`}>
                              <div className={`h-full w-[200%] bg-gradient-to-r ${barFrom} ${barTo} ${barFrom} animate-[shimmer_2s_linear_infinite]`} />
                            </div>
                        </div>
                      );
                    }
                    return null;
                  };

                  const renderAfterCompleteSwapBlock = (task: TaskFromAPI, flex: number) => (
                    <div
                      key={`after-complete-swap-${task.id}`}
                      className="w-full min-h-0 rounded-xl border border-purple-200/70 bg-purple-400/12 flex flex-col items-center justify-center gap-1 px-2 py-2"
                      style={flexStyle(flex)}
                    >
                      <span className="text-[14px] font-extrabold text-purple-600">
                        {afterCompleteSwapRequest?.status === "ready_to_takeover" ? "点击开始接替" : "结束后前往"}
                      </span>
                      {lineRoomPhotoCategory(task, "text-purple-600/75")}
                    </div>
                  );

                  // 场景1：执行中 + 插单待就位 → 点击暂停区 2/3，待就位信息 1/3
                  if (currentRawTask && myTaskStatus(currentRawTask) === "executing" && pendingRawTask) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderExecutingWithPause(currentRawTask, 2)}
                        {renderPendingBlock(pendingRawTask, 1)}
                      </div>
                    );
                  }

                  if (
                    currentRawTask &&
                    myTaskStatus(currentRawTask) === "executing" &&
                    afterCompleteSwapTask &&
                    afterCompleteSwapTask.id !== currentRawTask.id
                  ) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderTaskBlock(currentRawTask, 2)}
                        {renderAfterCompleteSwapBlock(afterCompleteSwapTask, 0.72)}
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

                  // 紧急单已接单后中途暂停：原任务继续让行，暂停卡应恢复紧急单本身
                  if (
                    deferredWaitingRawTask &&
                    pausedRawTask &&
                    myTaskStatus(pausedRawTask) === "paused" &&
                    pausedRawTask.parentTaskId === deferredWaitingRawTask.id
                  ) {
                    return (
                      <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
                        {renderDeferredWaitingBlock(deferredWaitingRawTask, 1)}
                        {renderPausedBlock(pausedRawTask, 2, true)}
                      </div>
                    );
                  }

                  if (!currentRawTask && !pausedRawTask && passiveIroningReadyTask && freeIroningMachineCount === 0) {
                    const otherWaitingTasks = selectedActionableWaitingTasks.filter((task) => task.id !== passiveIroningReadyTask.id);
                    const primaryWaitingTask = otherWaitingTasks[0] ?? null;
                    if (!primaryWaitingTask) {
                      return renderPassiveIroningWaitingBlock(passiveIroningReadyTask, 1);
                    }
                    return (
                      <div className="flex-1 min-h-0 w-full rounded-xl bg-white/18 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                          <span className="text-[11px] font-extrabold text-[--text-primary]">选择要开始的任务</span>
                          <span className="rounded-md bg-white/55 px-1.5 py-0.5 text-[9px] font-extrabold text-[--text-muted]">
                            {primaryWaitingTask ? "2 个可选" : "1 个可选"}
                          </span>
                        </div>
                        <div className="flex h-[calc(100%-1.375rem)] min-h-0 flex-col gap-1.5">
                          <div className="shrink-0" style={{ flex: "0 0 18%" }}>
                            {renderPassiveIroningWaitingBlock(passiveIroningReadyTask, 0.55)}
                          </div>
                          {primaryWaitingTask ? (
                            <div className="flex min-h-0 flex-[1.7]">
                              {renderTaskBlock(primaryWaitingTask, 1)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  if (!pausedRawTask && selectedActionableWaitingTasks.length > 1) {
                    return renderWaitingChoices(selectedActionableWaitingTasks);
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
          <div className={`left-workbench-panel ${resolvedTheme === "dark" ? "left-workbench-panel-dark" : ""} relative overflow-visible rounded-2xl px-4 py-3.5 flex-1 min-h-0 flex flex-col ${glass}`}>
            <div ref={quickBookAssistantPickerRef} className="relative z-[120] mb-2.5 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide">快捷预约</h3>
              <button
                type="button"
                onClick={() => setQuickBookAssistantPickerOpen((open) => !open)}
	                className={`flex h-7 max-w-[138px] items-center gap-1.5 rounded-full px-2.5 text-[10px] font-extrabold shadow-sm backdrop-blur-xl transition-all ${
	                  selectedQuickBookAssistant
	                    ? selectedQuickBookAssistantCanSubmit
	                      ? "bg-orange-500/12 text-orange-600"
	                      : "bg-gray-400/12 text-gray-500"
	                    : resolvedTheme === "dark"
	                      ? "bg-white/[0.07] text-orange-200 hover:bg-white/[0.12]"
	                      : "bg-white/54 text-orange-600 hover:bg-white/78"
	                }`}
                title={selectedQuickBookAssistant ? `本次指定：${selectedQuickBookAssistant.name}` : "为下一单指定助理"}
              >
                {selectedQuickBookAssistant ? (
                  <>
                    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-[8px] font-extrabold text-orange-600">
                      {selectedQuickBookAssistant.avatar ? (
                        <img src={selectedQuickBookAssistant.avatar} alt={selectedQuickBookAssistant.name} className="h-full w-full object-cover" />
                      ) : selectedQuickBookAssistant.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 truncate">{selectedQuickBookAssistant.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="ml-0.5 shrink-0 rounded-full px-1 text-[11px] leading-none text-current opacity-70 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSpecifiedQuickBookAssistantId(null);
                        setQuickBookAssistantPickerOpen(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        e.stopPropagation();
                        setSpecifiedQuickBookAssistantId(null);
                        setQuickBookAssistantPickerOpen(false);
                      }}
                      aria-label="清除指定助理"
                    >
                      ×
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] leading-none">+</span>
                    <span>指定助理</span>
                  </>
                )}
              </button>
              {quickBookAssistantPickerOpen && (
                <div className={`absolute right-[-124px] top-0 z-[220] w-[100px] rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl ${
                  resolvedTheme === "dark"
                    ? "border-white/[0.16] bg-slate-900/58 shadow-black/25"
                    : "border-white/70 bg-white/92 shadow-slate-300/40"
                }`}>
                  {quickBookOnlineAssistants.length === 0 ? (
                    <div className={`rounded-xl px-2 py-4 text-center text-[11px] font-semibold ${resolvedTheme === "dark" ? "bg-white/[0.10] text-slate-200" : "bg-slate-100/70 text-slate-500"}`}>
                      当前区域暂无在线助理
                    </div>
                  ) : (
                    <div className="max-h-[286px] space-y-1 overflow-y-auto pr-0.5 task-scroll">
                      {quickBookOnlineAssistants.map((assistant) => {
                        const selectable = canSpecifyQuickBookAssistant(assistant);
                        const selected = specifiedQuickBookAssistantId === assistant.id;
                        return (
                          <button
                            type="button"
                            key={`quick-assistant-${assistant.id}`}
                            disabled={!selectable}
                            onClick={() => {
                              setSpecifiedQuickBookAssistantId(assistant.id);
                              setQuickBookAssistantPickerOpen(false);
                            }}
                            className={`flex min-h-[44px] w-full items-center gap-1 rounded-xl px-1 py-1.5 text-left transition-colors ${
                              selected
                                ? "bg-orange-500 text-white"
                                : selectable
                                  ? resolvedTheme === "dark" ? "bg-white/[0.11] text-slate-50 hover:bg-white/[0.16]" : "bg-white/60 text-slate-700 hover:bg-orange-50"
                                  : resolvedTheme === "dark" ? "bg-white/[0.075] text-slate-300" : "bg-slate-100/70 text-slate-400"
                            } disabled:cursor-not-allowed`}
                          >
                            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-visible">
                              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[10px] font-extrabold text-white">
                                {assistant.avatar ? <img src={assistant.avatar} alt={assistant.name} className="h-full w-full object-cover" /> : assistant.name.slice(0, 1)}
                              </span>
                              <span className="absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: assistantDockDotColor(assistant) }} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10px] font-extrabold leading-tight">{assistant.name}</span>
                              <span className={`block truncate text-[8px] font-bold leading-tight ${selected ? "text-white/78" : resolvedTheme === "dark" ? "text-slate-200/80" : "text-[--text-muted]"}`}>
                                {quickBookAssistantStatusText(assistant)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
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
                      {cat.specialActions?.map((action) => (
                        <button
                          key={`special-${action.title}`}
                          onClick={(e) => handleBook(action.title, action, e)}
                          className="mt-1 flex min-w-[140px] items-center justify-between gap-2 whitespace-nowrap rounded-lg bg-purple-500 px-4 py-1.5 text-white shadow-lg shadow-purple-500/20 transition-all hover:brightness-110 active:scale-95"
                        >
                          <span className="text-[11px] font-extrabold">{action.title}</span>
                          <span className="text-[11px] font-extrabold">{action.priority}</span>
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
          <div className={`left-workbench-panel ${resolvedTheme === "dark" ? "left-workbench-panel-dark" : ""} relative rounded-2xl px-4 pb-3.5 pt-6 flex-1 min-h-0 flex flex-col overflow-visible ${glass}`}>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide">我的任务</h3>
              <button onClick={() => setShowStatsModal(true)} className="text-[10px] text-orange-500 font-semibold hover:text-orange-600 cursor-pointer">更多数据 →</button>
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
                ref={taskListContentRef}
                className="space-y-1.5 pb-1 pt-2"
                style={{
                  transform: `translateY(-${taskListScrollY}px)`,
                  transition: taskListDragRef.current.active ? "none" : "transform 0.12s ease-out",
                }}
              >
                {false ? (
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
                        statusInfo.assignedWaiting &&
                        queuedWaitingMinutes >= upgradeThresholdMin;
                      const isOwnPhotographerQueueTask = profile?.role === "photographer" && queueTask.photographerId === profile.id;
                      const queuePhotographerLabel = isOwnPhotographerQueueTask ? "我" : queueTask.photographer?.name ?? "摄影师";
                      const queueSpecifiedName = queueTask.specifiedAssistant?.name ?? (queueTask.isSpecified ? queueTask.assistant?.name ?? null : null);
                      return (
	                        <div
	                          key={`public-${queueTask.id}`}
	                          className={`flex gap-1.5 rounded-xl border px-1.5 py-2 shadow-sm transition-all duration-200 hover:translate-x-1 hover:scale-[1.02] hover:shadow-md ${
                              resolvedTheme === "dark"
                                ? isOwnPhotographerQueueTask
                                  ? "public-queue-own-task border-amber-200/18 bg-amber-200/[0.08] shadow-black/10 hover:bg-amber-200/[0.12]"
                                  : "border-white/[0.22] bg-white/[0.12] hover:bg-white/[0.17]"
                                : isOwnPhotographerQueueTask
                                  ? "public-queue-own-task border-transparent bg-white/55 shadow-amber-100/60 hover:bg-white/75"
                                  : "border-white/60 bg-white/55 hover:bg-white/75"
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
                                {queueTask.isSpecified && (
                                  <span
                                    className="ml-1.5 rounded bg-orange-50 px-1 py-0.5 align-middle text-[8px] font-extrabold text-orange-500"
                                    title={queueSpecifiedName ? `指定 ${queueSpecifiedName}` : "指定助理"}
                                  >
                                    指定
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
                  const cancelPending = isWorkbenchPendingAction(workbenchTaskActionKey("cancel", task.id, profile?.id));
                  const cancelInFlight = isRemoving || cancelPending;
	                  const rawForTask = taskListRaw.find((x) => x.id === task.id);
                  const isPhotographerQueueTask = rawForTask != null && isPhotographerLimitQueuedTask(rawForTask);
                  const isAssistantTaskList = isAssistantRole(profile?.role);
                  const isCancellable = !isAssistantTaskList && (canCancelRawTask(rawForTask) || isPhotographerQueueTask);
	                  const showCancel = isCancellable && hoveredTagId === task.id && !cancelInFlight;
	                  const canRegisterCompletion = canOpenCompletionRegistration(rawForTask);
	                  const showCompletionRegistration = canRegisterCompletion && hoveredTagId === task.id && !cancelInFlight;
                  const statusBadgeInteractive = isCancellable || canRegisterCompletion;
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
	                  const statusBadgeCls = cancelInFlight
                      ? "bg-red-100/80 text-red-500 cursor-default"
                      : showCancel
	                    ? "bg-red-100/80 text-red-500 cursor-pointer hover:bg-red-200/80 scale-105"
                    : showCompletionRegistration
                      ? rawForTask?.completionRegistration
                        ? "bg-emerald-100/80 text-emerald-600 cursor-pointer hover:bg-emerald-200/80 scale-105"
                        : "bg-orange-100/80 text-orange-600 cursor-pointer hover:bg-orange-200/80 scale-105"
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
                    collaboratorCount > 0;
                  const canOpenCollaboratorModal = canManageCollaborators || canEditExistingCollaborators;
                  const showCollaboratorEntry = !isCompletedCollaboration && (canOpenCollaboratorModal || collaboratorCount > 0) && rawForTask;
                  const collaboratorEntryButton = showCollaboratorEntry
                    ? canOpenCollaboratorModal
                      ? (
                        <button
                          type="button"
                          className="ml-1.5 inline-flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-transparent bg-transparent pl-1 pr-1.5 text-[9px] font-semibold leading-[18px] text-slate-500 transition-colors hover:border-blue-200/80 hover:bg-blue-50/55 hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCollaboratorModal(rawForTask);
                          }}
                        >
                          {canManageCollaborators && <span className="leading-[20px]">+</span>}
                          <span className="leading-[20px]">{collaboratorCount > 0 ? `协作 ${collaboratorCount}人` : "添加协作"}</span>
                        </button>
                      )
                      : (
                        <span className="ml-1.5 flex h-5 shrink-0 items-center whitespace-nowrap text-[9px] font-semibold leading-[20px] text-blue-500">
                          协作 {collaboratorCount}人
                        </span>
                      )
                    : null;
                  const isEndingSoon = task.statusLabel === "进行中" && task.estEndTime
                    ? (() => { const diff = (new Date(task.estEndTime).getTime() - Date.now()) / 60000; return diff > 0 && diff <= endingAlertMin; })()
                    : false;
                  const isExecutingOvertime =
                    task.statusLabel === "进行中" &&
                    rawForTask != null &&
                    overtimeMinutesBeyondSlot(rawForTask, now.getTime()) != null;
                  const taskPriorityLevel = Math.min(6, Math.max(1, Math.round(Number(rawForTask?.priority ?? 6) || 6)));
                  const pendingPriorityUpgrade = isAssistantRole(profile?.role) ? null : pendingPriorityUpgradeForTask(rawForTask);
                  const canOpenPriorityUpgradeFromBadge = rawForTask != null && canRequestPriorityUpgrade(rawForTask);
                  const isSpecifiedTask = task.isSpecified || Boolean(rawForTask?.isSpecified);
                  const specifiedAssistantName =
                    task.specifiedAssistantName ??
                    rawForTask?.specifiedAssistant?.name ??
                    (rawForTask?.isSpecified ? rawForTask.assistant?.name ?? null : null);
                  const canCancelSpecified = canCancelSpecifiedAssistant(rawForTask);
                  const showCancelSpecified = canCancelSpecified && hoveredSpecifiedTaskId === task.id;
                  const specifiedLabel = cancelingSpecifiedTaskId === task.id
                    ? "取消中"
                    : showCancelSpecified
                      ? "取消指定"
                      : "指定";
	                  return (
                    <div
                      key={task.id}
                      className={`px-3 py-2 rounded-xl border cursor-default ${task.statusCls} ${
                        resolvedTheme === "dark" ? "border-white/[0.22] bg-white/[0.12] backdrop-blur-xl shadow-sm shadow-black/10" : ""
                      }${
                        enteringTaskId === task.id ? " task-genie-enter" : ""
	                        }${cancelInFlight ? " task-slide-out" : ""}`}
	                      style={{
	                        transition: cancelInFlight ? "none" : "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s",
	                      }}
	                      onMouseEnter={(e) => {
	                        if (!cancelInFlight) {
	                          (e.currentTarget as HTMLElement).style.transform = "translateX(4px) scale(1.02)";
	                          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
	                        }
                        if (isCancellable) {
                          setHoveredTagId(task.id);
                        }
                      }}
                      onMouseLeave={(e) => {
	                        if (!cancelInFlight) {
	                          (e.currentTarget as HTMLElement).style.transform = "translateX(0) scale(1)";
	                          (e.currentTarget as HTMLElement).style.boxShadow = "";
                        }
                        setHoveredTagId(null);
                        setHoveredSpecifiedTaskId(null);
                      }}
                    >
	                      <div className="flex items-center justify-between gap-2">
	                        <span className="flex min-w-0 items-center text-[12px] font-medium text-[--text-primary]">
                            {canOpenPriorityUpgradeFromBadge ? (
                              <button
                                type="button"
                                title="申请提权"
                                className={`group/priority-upgrade relative mr-1.5 flex h-5 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-[10px] font-extrabold shadow-sm transition-all duration-200 ease-out hover:w-[58px] hover:scale-105 hover:bg-red-500 hover:text-white active:scale-95 ${publicQueuePriorityLevelCls(taskPriorityLevel)}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openPriorityUpgradeModal(rawForTask);
                                }}
                              >
                                <span className="transition-all duration-150 group-hover/priority-upgrade:-translate-x-1 group-hover/priority-upgrade:opacity-0">P{taskPriorityLevel}</span>
                                <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[9px] opacity-0 transition-opacity duration-150 group-hover/priority-upgrade:opacity-100">
                                  申请提权
                                </span>
                              </button>
                            ) : (
                              <span
                                title={pendingPriorityUpgrade ? "提权待审批" : undefined}
                                className={`group/priority-upgrade relative mr-1.5 flex h-5 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold shadow-sm ${pendingPriorityUpgrade ? "ring-1 ring-red-300/70" : ""} ${publicQueuePriorityLevelCls(taskPriorityLevel)}`}
                              >
                                <span className={pendingPriorityUpgrade ? "transition-opacity group-hover/priority-upgrade:opacity-0" : ""}>P{taskPriorityLevel}</span>
                                {pendingPriorityUpgrade && (
                                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-red-500 opacity-0 transition-opacity group-hover/priority-upgrade:opacity-100">
                                    待审
                                  </span>
                                )}
                              </span>
                            )}
	                          <span className="min-w-0 truncate">{task.name}</span>
	                          <span className="ml-1.5 shrink-0 text-[10px] font-normal text-[--text-muted]">{task.durationSlotLabel}</span>
	                          {renderEscalationBadge(rawForTask, { compact: true, className: "ml-1.5" })}
	                          {isEndingSoon && (
	                            <span className="ml-1.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-500 animate-pulse">快结束</span>
	                          )}
	                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 text-[10px] leading-none font-bold px-1.5 py-1 rounded transition-all duration-150 ${
                            statusBadgeCls
                          }`}
                          onMouseEnter={() => statusBadgeInteractive && setHoveredTagId(task.id)}
                          onMouseLeave={() => setHoveredTagId(null)}
                          onClick={(e) => {
	                            if (isCancellable && !cancelInFlight) {
	                              e.stopPropagation();
	                              handleCancelTask(task.id);
                            } else if (canRegisterCompletion && rawForTask) {
                              e.stopPropagation();
                              openCompletionRegistrationModal(rawForTask);
                            }
                          }}
                        >
	                          {cancelInFlight ? (
	                            "取消中"
	                          ) : showCancel ? (
	                            "取消"
                          ) : showCompletionRegistration ? (
                            rawForTask?.completionRegistration ? "查看登记" : "添加登记"
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
                            task.photographerName ? (
                              <>
                                <span className="truncate"> · {task.photographerName}</span>
                                {collaboratorEntryButton}
                              </>
                            ) : (
                              collaboratorEntryButton
                            )
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
                            <>
                              {task.assistantName ? <span className="truncate"> · {task.assistantName}</span> : null}
                              {collaboratorEntryButton}
                              {isSpecifiedTask && (
                                <button
                                  type="button"
                                  disabled={!canCancelSpecified || cancelingSpecifiedTaskId === task.id}
                                  className={`ml-1.5 shrink-0 rounded px-1 py-0.5 align-middle text-[8px] font-extrabold transition-all ${
                                    showCancelSpecified
                                      ? "bg-red-50 text-red-500 hover:bg-red-100"
                                      : "bg-orange-50 text-orange-500"
                                  } ${canCancelSpecified ? "cursor-pointer" : "cursor-default"} disabled:cursor-wait disabled:opacity-70`}
                                  title={
                                    canCancelSpecified
                                      ? "取消指定助理"
                                      : specifiedAssistantName
                                        ? `指定 ${specifiedAssistantName}`
                                        : "指定助理"
                                  }
                                  onMouseEnter={() => canCancelSpecified && setHoveredSpecifiedTaskId(task.id)}
                                  onMouseLeave={() => setHoveredSpecifiedTaskId(null)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (rawForTask && canCancelSpecified) {
                                      void handleCancelSpecifiedAssistant(rawForTask);
                                    }
                                  }}
                                >
                                  {specifiedLabel}
                                </button>
                              )}
                            </>
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
                      {showCollaboratorEntry && collaboratorCount > 0 && (
                        <div className="mt-1 flex h-5 min-w-0 items-center justify-between gap-2">
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

        {/* 右上按钮区域 */}
        <div
          className="absolute top-3 right-1.5 z-20 hidden flex-col items-end gap-1.5 lg:flex"
        >
          {/* 返回登录：非管理账号独立显示；管理账号收纳到后台管理菜单 */}
          {!(loginRole === "admin" || loginRole === "assistant_leader") && (
            <a
              href="/"
              onClick={() => { safeLocalStorageRemove("user"); safeLocalStorageRemove("currentProfileId"); }}
              className={`readable-glass-dark flex w-[88px] cursor-pointer items-center justify-start gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${glass}`}
            >
              <svg className="text-current opacity-90" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="text-[11px] font-extrabold">返回登录</span>
            </a>
          )}
          {/* 数据统计：仅摄影师/助理可见 */}
          {(loginRole === "photographer" || loginRole === "assistant") && (
          <a href="/stats" className={`readable-glass-dark flex w-[88px] cursor-pointer items-center justify-start gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${glass}`}>
            <svg className="text-current opacity-90" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span className="text-[11px] font-extrabold">数据统计</span>
          </a>
          )}
          {/* 后台管理集合：仅管理账号可见 */}
          {(loginRole === "admin" || loginRole === "assistant_leader") && (
            <div className="group/admin-menu relative">
              <a
                href="/admin"
                className={`readable-glass-dark flex w-[88px] cursor-pointer items-center justify-start gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${glass}`}
              >
                <svg className="text-current opacity-90" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
                <span className="text-[11px] font-extrabold">后台管理</span>
              </a>
	              <div className="pointer-events-none absolute right-0 top-full w-[88px] translate-y-[-6px] pt-2 opacity-0 transition-all duration-200 group-hover/admin-menu:pointer-events-auto group-hover/admin-menu:translate-y-0 group-hover/admin-menu:opacity-100">
	                <div className={`rounded-2xl border p-1.5 shadow-xl backdrop-blur-xl ${workbenchFloatingSurfaceCls}`}>
	                  <a
	                    href="/"
	                    onClick={() => { safeLocalStorageRemove("user"); safeLocalStorageRemove("currentProfileId"); }}
	                    className={`flex w-full items-center justify-start rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors ${workbenchFloatingItemCls}`}
	                  >
	                    返回登录
	                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
        {(loginRole === "admin" || loginRole === "assistant_leader") && (
          <div className={`absolute bottom-3 right-1.5 z-30 hidden items-center gap-[3px] rounded-full px-1.5 py-0.5 shadow-lg backdrop-blur-2xl lg:flex ${
            resolvedTheme === "dark"
              ? "bg-slate-950/54 text-slate-100 shadow-black/30"
              : "bg-white/62 text-slate-700 shadow-slate-300/35"
          }`}>
            <button
              type="button"
              onClick={() => setShowIdentityModal(true)}
              className="grid h-[27px] w-[27px] place-items-center rounded-full transition-colors hover:bg-white/18 focus:outline-none focus:ring-2 focus:ring-white/45"
              aria-label="切换身份"
              title="切换身份"
            >
              <svg className="text-current opacity-95" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </button>
            <span className="select-none text-[11px] font-bold leading-none text-[--text-muted] opacity-70">/</span>
            <button
              type="button"
              onClick={cycleTheme}
              className="grid h-[27px] w-[27px] place-items-center rounded-full transition-colors hover:bg-white/18 focus:outline-none focus:ring-2 focus:ring-white/45"
              aria-label="切换系统风格"
              title="系统风格"
            >
              <svg className="text-current opacity-95" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
            </button>
          </div>
        )}
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
          className={`fixed inset-0 z-[80] flex items-center justify-center px-6 ${
            resolvedTheme === "dark"
              ? "bg-slate-950/56 backdrop-blur-xl"
              : "bg-slate-900/24 backdrop-blur-[18px]"
          }`}
          onClick={() => setShowIdentityModal(false)}
        >
          <div
            className={`relative flex w-[min(94vw,680px)] max-h-[86vh] flex-col overflow-hidden rounded-[26px] border p-1 shadow-[0_32px_96px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-[32px] ring-1 sm:rounded-[34px] ${
              resolvedTheme === "dark"
                ? "border-white/12 bg-slate-950/62 ring-white/10"
                : "border-white/82 bg-white/58 ring-white/70"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[34px] opacity-80"
              style={{
                background:
                  "radial-gradient(68% 42% at 16% 0%, rgba(255,255,255,0.70), transparent 60%), radial-gradient(44% 36% at 100% 0%, rgba(249,115,22,0.10), transparent 58%), linear-gradient(135deg, rgba(255,255,255,0.34), transparent 44%)",
              }}
            />
            <div className="relative z-[1] flex items-center justify-between px-4 pt-5 pb-3 sm:px-6 sm:pt-6">
              <h2 className="text-[18px] font-extrabold tracking-wide text-[--text-primary] sm:text-[20px]">切换身份</h2>
              <button
                onClick={() => setShowIdentityModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/65 bg-white/36 text-[--text-secondary] shadow-sm backdrop-blur-xl transition-colors hover:bg-white/66 hover:text-[--text-primary]"
                aria-label="关闭切换身份"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="relative z-[1] px-4 pb-3 sm:px-6">
              <p className="text-[12px] font-semibold text-[--text-muted]">选择一个身份查看对应视角的页面，当前：<span className="font-extrabold text-[--text-primary]">{profile?.name}</span></p>
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
                    ? profile.activeBuildingId ?? profile.buildingId
                    : originalBuildingIdRef.current ?? profile.buildingId
                  : null) ??
                orderedEntries[0]?.[0] ??
                null;
              const activeEntry = activeBld != null ? buildingMap.get(activeBld) : null;
              const roles = ["photographer", "assistant", "assistant_leader", "admin"] as const;
              const roleLabel = (r: string) => r === "photographer" ? "摄影师" : r === "assistant" ? "助理" : r === "assistant_leader" ? "助理组长" : "管理";
              const roleColor = (r: string) => r === "photographer" ? "text-orange-600" : r === "assistant" ? "text-green-600" : r === "assistant_leader" ? "text-blue-600" : "text-purple-600";
              const roleBg = (r: string) => r === "photographer" ? "bg-orange-50" : r === "assistant" ? "bg-green-50" : r === "assistant_leader" ? "bg-blue-50" : "bg-purple-50";
              const identityPresenceText = (state: AssistantPresenceState) => {
                if (resolvedTheme !== "dark") return assistantPresenceMeta(state).textCls;
                if (state === "online") return "text-emerald-300";
                if (state === "eating") return "text-sky-300";
                return "text-slate-200";
              };
              const identityPresenceButtonSurface = (state: AssistantPresenceState) => {
                if (resolvedTheme !== "dark") return "border-white/70 bg-white/40";
                if (state === "online") return "border-emerald-300/35 bg-emerald-400/16 shadow-emerald-950/20";
                if (state === "eating") return "border-sky-300/35 bg-sky-400/16 shadow-sky-950/20";
                return "border-slate-300/30 bg-slate-400/18 shadow-black/20";
              };
              const identityFloatingPanelCls = resolvedTheme === "dark"
                ? "border-white/[0.16] bg-slate-900/92 shadow-2xl shadow-black/45"
                : "border-white/70 bg-white/82 shadow-xl shadow-slate-300/30";
              const identityFloatingButtonCls = resolvedTheme === "dark"
                ? "border-white/[0.14] bg-white/[0.10] shadow-black/20 hover:bg-white/[0.16] disabled:opacity-55"
                : "border-white/70 bg-white/54 shadow-sm hover:bg-white/80 disabled:opacity-60";
              const identityLocationButtonCls = resolvedTheme === "dark"
                ? "border-white/[0.18] bg-white/[0.12] text-slate-200 shadow-black/20 hover:border-white/[0.28] hover:bg-white/[0.18] hover:text-white"
                : "border-white/70 bg-white/40 text-gray-500 shadow-sm hover:bg-white/66 hover:border-white";

              return (
                <>
                  <DockBuildingTabs
                    entries={orderedEntries}
                    activeBld={activeBld}
                    onSelect={(id) => setIdentityBuildingFilter(id)}
                    onReorder={(newOrder) => setIdentityBuildingOrder(newOrder)}
                  />
                  <div className="relative z-[1] mx-1 mb-2 flex-1 overflow-y-auto px-2 pb-4 pt-1 [scrollbar-color:rgba(148,163,184,0.48)_transparent] [scrollbar-width:thin] sm:mx-2 sm:px-3">
                    {activeEntry && roles.map((role) => {
                      const roleProfiles = activeEntry.profiles.filter((p) => p.role === role);
                      if (roleProfiles.length === 0) return null;
                      return (
                        <div key={role} className="mb-3 first:mt-1.5">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${roleBg(role)} ${roleColor(role)}`}>{roleLabel(role)}</span>
                            <span className="text-[11px] font-bold text-[--text-muted]">{roleProfiles.length}人</span>
                          </div>
                          <div className="grid grid-cols-1 gap-x-2 gap-y-1 sm:grid-cols-2">
                            {roleProfiles.map((p) => {
                              const isCurrent = p.id === profile?.id;
                              const isAssistant = isAssistantRole(p.role);
                              const currentPresence = assistantPresenceState(p);
                              const currentPresenceMeta = assistantPresenceMeta(currentPresence);
                              const otherStatuses = (["online", "eating", "on_break"] as AssistantPresenceState[]).filter((s) => s !== currentPresence);
                              const identityAssistantDock = isAssistant
                                ? assistantDockById.get(p.id) ?? profileToQuickBookAssistant(p)
                                : null;
                              const assistantServiceBuildingId = isAssistant ? p.activeBuildingId ?? p.buildingId : p.buildingId;
                              const assistantServiceBuildingName =
                                buildings.find((b) => b.id === assistantServiceBuildingId)?.name ?? p.building.name;
                              const otherBuildings = buildings.filter((b) => b.id !== assistantServiceBuildingId);

                              return (
                                  <div
                                    key={p.id}
                                  className={`group/identity grid ${isAssistant ? "grid-cols-[32px_minmax(0,1fr)_82px]" : "grid-cols-[32px_minmax(0,1fr)]"} items-center gap-2.5 rounded-[16px] px-2.5 py-1.5 text-left transition-colors duration-150 ${
                                    isCurrent
                                      ? "bg-orange-500/[0.07]"
                                      : "hover:bg-white/24"
                                  }`}
                                >
                                  {/* 头像 */}
                                  <div
                                    className={`relative h-8 w-8 flex-shrink-0 ${!isCurrent ? "cursor-pointer" : ""}`}
                                    onClick={() => !isCurrent && switchIdentity(p)}
                                  >
                                    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-100 to-slate-300 shadow-inner ring-2 ring-white/70">
                                      {p.avatar ? (
                                        <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <span className="text-xs font-extrabold text-white">{p.name[0]}</span>
                                      )}
                                    </div>
                                    {identityAssistantDock && (
                                      <span
                                        className="absolute bottom-0 right-0 rounded-full"
                                        style={{
                                          width: 8,
                                          height: 8,
                                          backgroundColor: assistantDockDotColor(identityAssistantDock),
                                          boxShadow: "0 0 0 2px rgba(255,255,255,0.95)",
                                        }}
                                      />
                                    )}
                                  </div>
                                  {/* 名字+工号 */}
                                  <div
                                    className={`min-w-0 flex-1 ${!isCurrent ? "cursor-pointer" : ""}`}
                                    onClick={() => !isCurrent && switchIdentity(p)}
                                  >
                                    <p className="truncate text-xs font-extrabold text-[--text-primary]">
                                      {p.name}
                                      {isCurrent && <span className="ml-1.5 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-black text-orange-500">当前</span>}
                                    </p>
                                    <p className="truncate text-[10px] font-semibold text-[--text-muted]">{p.employeeId || ""}</p>
                                  </div>
                                  {/* 助理专属：状态按钮 + 场地按钮 */}
                                  {isAssistant && (
                                    <div className="flex w-[82px] shrink-0 items-center justify-end gap-1">
                                      {/* 状态按钮 — 文字标签 */}
                                      <div className="relative">
                                        <button
                                          type="button"
                                          disabled={!isCurrent}
                                          className={`flex h-6 w-[50px] items-center justify-center rounded-lg border px-1.5 text-[9px] font-extrabold shadow-sm backdrop-blur-xl transition-colors disabled:cursor-not-allowed ${identityPresenceButtonSurface(currentPresence)} ${isCurrent ? resolvedTheme === "dark" ? "cursor-pointer hover:bg-white/[0.20] hover:border-white/30" : "cursor-pointer hover:bg-white/66 hover:border-white" : ""} ${identityPresenceText(currentPresence)}`}
                                          onPointerDown={(e) => {
                                            e.stopPropagation();
                                          }}
                                          onMouseDown={(e) => {
                                            e.stopPropagation();
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!isCurrent) return;
                                            setIdentityPresenceMenuId((id) => id === p.id ? null : p.id);
                                          }}
                                        >
                                          {currentPresenceMeta.shortLabel}
                                        </button>
                                        {identityPresenceMenuId === p.id && (
                                        <div
                                          className="absolute top-full left-1/2 z-50 -translate-x-1/2 pt-1"
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div className={`flex flex-col items-center gap-1 rounded-2xl border px-1.5 py-1.5 backdrop-blur-2xl ${identityFloatingPanelCls}`}>
	                                            {otherStatuses.map((s) => {
	                                              const meta = assistantPresenceMeta(s);
	                                              const reentryMinutes = s === "eating"
	                                                ? eatingReentryRemainingMinutesForProfile(p)
	                                                : 0;
	                                              const hintUntil = s === "eating" ? eatingReentryHintUntilByProfileId[p.id] : null;
	                                              const hintRemainingMs = hintUntil ? Math.max(0, new Date(hintUntil).getTime() - now.getTime()) : 0;
	                                              const hintMinutes = hintRemainingMs > 0 ? Math.max(1, Math.ceil(hintRemainingMs / 60000)) : 0;
	                                              const statusLocked = p.id !== profile?.id;
	                                              const disabled = statusLocked;
	                                              return (
	                                                <button
                                                  key={s}
                                                  type="button"
                                                  disabled={disabled}
                                                  onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                  }}
                                                  onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                  }}
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (disabled) return;
                                                    if (s === "eating" && reentryMinutes > 0) {
                                                      void updateAssistantPresenceStatus(p.id, s);
                                                      return;
                                                    }
                                                    setIdentityPresenceMenuId(null);
                                                    void updateAssistantPresenceStatus(p.id, s);
                                                  }}
                                                  className={`relative flex h-7 min-w-[104px] items-center justify-between gap-1.5 rounded-xl border px-2 text-[10px] font-extrabold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${identityFloatingButtonCls} ${identityPresenceText(s)}`}
                                                >
                                                  <span>{meta.label}</span>
	                                                  {hintMinutes > 0 && (
	                                                    <span className={`pointer-events-none absolute left-[calc(100%+6px)] top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[8px] font-black leading-none shadow-lg ${resolvedTheme === "dark" ? "border-orange-300/30 bg-slate-950/96 text-orange-300 shadow-black/35" : "border-orange-200 bg-white text-orange-500 shadow-orange-200/40"}`}>
	                                                      短时间内无法再次切换吃饭中状态
	                                                    </span>
	                                                  )}
	                                                  {statusLocked && (
	                                                    <span className={`pointer-events-none absolute left-[calc(100%+6px)] top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[8px] font-black leading-none shadow-lg ${resolvedTheme === "dark" ? "border-white/[0.16] bg-slate-950/96 text-slate-300 shadow-black/35" : "border-gray-200 bg-white text-gray-500 shadow-gray-200/60"}`}>
	                                                      只能变更当前身份的在线状态
	                                                    </span>
	                                                  )}
	                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        )}
                                      </div>
                                      {/* 场地按钮 — 位置图标 */}
                                      <div className="relative group/bld">
                                        <div
                                          className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border shadow-sm backdrop-blur-xl transition-colors ${identityLocationButtonCls}`}
                                          title={assistantServiceBuildingName}
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                                          </svg>
                                        </div>
                                        {/* hover 下拉 */}
                                        {otherBuildings.length > 0 && (
                                          <div className="absolute top-full right-0 pt-1 opacity-0 pointer-events-none group-hover/bld:opacity-100 group-hover/bld:pointer-events-auto transition-opacity z-10">
                                            <div className={`min-w-[92px] rounded-2xl border py-1.5 backdrop-blur-2xl ${identityFloatingPanelCls}`}>
                                              <div className={`px-2.5 py-1 text-[9px] font-bold whitespace-nowrap ${resolvedTheme === "dark" ? "text-slate-400" : "text-gray-400"}`}>切换场地</div>
                                              {otherBuildings.map((b) => (
                                                <button
                                                  key={b.id}
                                                  onClick={(e) => { e.stopPropagation(); updateAssistantBuilding(p.id, b.id); }}
                                                  className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-extrabold transition-colors whitespace-nowrap ${resolvedTheme === "dark" ? "text-sky-300 hover:bg-white/[0.10]" : "text-blue-600 hover:bg-blue-50/80"}`}
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

      {/* ====== AREA COMPLETED STATS MODAL ====== */}
      {showAreaCompletedStatsModal && (
        (() => {
          const weekDays = ["周一","周二","周三","周四","周五","周六","周日"];
          const todayStatsIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
          const selectedStatsDay = areaCompletedStatsSelectedDay ?? todayStatsIdx;
          const selectedStatsDate = statsDayDate(areaCompletedStatsWeekOffset, selectedStatsDay, now);
          const selectedStatsDayStart = new Date(selectedStatsDate.getFullYear(), selectedStatsDate.getMonth(), selectedStatsDate.getDate());
          const selectedStatsDayEnd = new Date(selectedStatsDayStart.getTime() + 24 * 60 * 60 * 1000);
          const areaBuildingId = publicQueueBuildingId ?? activeBuildingId;
          const areaCompletedTodayTasks = areaTasks.filter((task) => task.status === "completed");
          const areaCompletedWeekTasks = areaCompletedWeeklyTasks.filter((task) => (
            areaBuildingId != null &&
            taskLocationBuildingId(task) === areaBuildingId &&
            task.status === "completed"
          ));
          const selectedStatsRawTasks = areaCompletedWeekTasks.filter((task) => {
            const created = new Date(task.createdAt);
            return created >= selectedStatsDayStart && created < selectedStatsDayEnd;
          });
          const selectedStatsTasks = selectedStatsRawTasks.map((task) => apiTaskToDisplay(task));
          const selectedStatsDateLabel = formatStatsDateLabel(selectedStatsDate);
          const selectedStatsDayIsToday = areaCompletedStatsWeekOffset === 0 && selectedStatsDay === todayStatsIdx;
          const statsWeekLabel = areaCompletedStatsWeekOffset === 0
            ? "本周"
            : areaCompletedStatsWeekOffset === -1
              ? "上周"
              : areaCompletedStatsWeekOffset === 1
                ? "下周"
                : `${selectedStatsDateLabel.slice(5)}所在周`;
          const statsTitle = `${activeBuilding?.name ?? "当前"}区域 任务数据`;
          const statsTrendTitle = `${statsWeekLabel}完成任务趋势`;
          const statsDetailTitle = `${selectedStatsDayIsToday ? "今日" : `${weekDays[selectedStatsDay]} ${selectedStatsDateLabel}`}完成任务明细`;
          return (
            <div
              className={`fixed inset-0 z-[82] flex items-center justify-center px-6 ${
                resolvedTheme === "dark" ? "bg-slate-950/52" : "bg-slate-900/22"
              }`}
              onClick={() => setShowAreaCompletedStatsModal(false)}
            >
              <div
                className={`relative w-full max-w-[min(92vw,826px)] max-h-[62vh] overflow-visible rounded-[32px] border p-5 shadow-2xl backdrop-blur-[30px] ring-1 ${
                  resolvedTheme === "dark"
                    ? "border-white/[0.12] bg-slate-950/62 shadow-black/45 ring-white/[0.06]"
                    : "border-white/75 bg-white/62 shadow-[0_34px_100px_rgba(56,68,89,0.22)] ring-slate-900/[0.04]"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-80"
                  style={{
                    background:
                      resolvedTheme === "dark"
                        ? "radial-gradient(circle at 16% 12%, rgba(96,165,250,0.16), transparent 32%), radial-gradient(circle at 84% 8%, rgba(34,211,238,0.10), transparent 30%)"
                        : "radial-gradient(circle at 16% 12%, rgba(255,255,255,0.82), transparent 34%), radial-gradient(circle at 86% 8%, rgba(96,165,250,0.11), transparent 32%)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowAreaCompletedStatsModal(false)}
                  className={`absolute -right-2 -top-2 z-[4] flex h-7 w-7 items-center justify-center rounded-full border text-[14px] font-black leading-none shadow-sm backdrop-blur-xl transition-colors ${
                    resolvedTheme === "dark"
                      ? "border-white/[0.10] bg-slate-900/70 text-slate-300 hover:bg-slate-800/85 hover:text-slate-100"
                      : "border-white/80 bg-white/80 text-slate-400 hover:bg-white hover:text-slate-600"
                  }`}
                  aria-label={`关闭${statsTitle}`}
                  title="关闭"
                >
                  x
                </button>
                <div className="relative z-[1] overflow-hidden rounded-[24px]">
                  <div className="-mr-3 max-h-[calc(62vh-40px)] overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
                    <div className="pr-3">
                      <div className="mb-6 flex items-center">
                        <div className="pl-2">
                          <h2 className="text-[16px] font-extrabold tracking-wide text-[--text-primary]">{statsTitle}</h2>
                        </div>
                      </div>

                      <div className="mb-4 grid grid-cols-2 gap-4">
                        <div className={`relative h-[236px] rounded-[34px] border px-8 py-3 backdrop-blur-2xl ${
                          resolvedTheme === "dark"
                            ? "border-white/[0.10] bg-white/[0.055]"
                            : "border-white/70 bg-white/38 shadow-[0_18px_52px_rgba(56,68,89,0.07)]"
                        }`}>
                          <div className="mb-2 flex min-h-[22px] items-center justify-between gap-3">
                            <h3 className="text-[14px] font-extrabold tracking-wide text-[--text-primary]">{statsTrendTitle}</h3>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold transition-opacity duration-150 ${
                              resolvedTheme === "dark" ? "bg-orange-400/12 text-orange-200" : "bg-orange-500/10 text-orange-600"
                            }`}>
                              {weekDays[areaCompletedStatsHoveredDay ?? selectedStatsDay]} · {formatStatsDateLabel(statsDayDate(areaCompletedStatsWeekOffset, areaCompletedStatsHoveredDay ?? selectedStatsDay, now))}
                            </span>
                          </div>
                          {(() => {
                            const monday = statsWeekStart(areaCompletedStatsWeekOffset, now);
                            const weekCounts = Array.from({ length: 7 }, (_, i) => {
                              const dayStart = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
                              const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                              return areaCompletedWeekTasks.filter((task) => {
                                const created = new Date(task.createdAt);
                                return created >= dayStart && created < dayEnd;
                              }).length;
                            });
                            const wMax = Math.max(...weekCounts, 1);
                            const previewIdx = areaCompletedStatsHoveredDay ?? selectedStatsDay;
                            const weekArrowCls = `mb-[24px] flex h-9 w-5 items-center justify-center rounded-full transition-colors ${
                              resolvedTheme === "dark"
                                ? "text-slate-400/90 hover:bg-white/[0.045] hover:text-slate-200"
                                : "text-slate-400 hover:bg-slate-900/[0.03] hover:text-slate-600"
                            }`;
                            return (
                              <div className="grid h-40 grid-cols-[20px_repeat(7,minmax(0,1fr))_20px] items-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setAreaCompletedStatsWeekOffset((value) => value - 1)}
                                  className={weekArrowCls}
                                  aria-label="查看上一周"
                                  title="上一周"
                                >
                                  <svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
                                    <path d="M7 3L3 9L7 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                {weekDays.map((day, i) => {
                                  const isSelected = i === selectedStatsDay;
                                  const isHovered = i === previewIdx;
                                  const barH = weekCounts[i] > 0 ? Math.max((weekCounts[i] / wMax) * 92, 6) : 0;
                                  return (
                                    <button
                                      type="button"
                                      key={day}
                                      className={`flex h-full flex-1 flex-col items-center justify-end rounded-2xl px-1 transition-colors duration-200 ${
                                        resolvedTheme === "dark" ? "hover:bg-white/[0.06]" : "hover:bg-white/20"
                                      }`}
                                      onMouseEnter={() => setAreaCompletedStatsHoveredDay(i)}
                                      onMouseLeave={() => setAreaCompletedStatsHoveredDay(null)}
                                      onClick={() => setAreaCompletedStatsSelectedDay(i)}
                                      aria-pressed={isSelected}
                                      aria-label={`查看${day}完成明细`}
                                    >
                                      <span className={`mb-2 text-[12px] font-extrabold tabular-nums ${isHovered || isSelected ? "text-orange-500" : "text-[--text-primary]"}`}>{weekCounts[i]}</span>
                                      <div
                                        className={`w-full max-w-[64px] rounded-t-[16px] transition-all duration-300 ${
                                          isHovered || isSelected
                                            ? "bg-gradient-to-t from-orange-600 to-orange-300 shadow-[0_10px_24px_rgba(249,115,22,0.26)]"
                                            : resolvedTheme === "dark"
                                              ? "bg-gradient-to-t from-orange-400/36 to-orange-200/20"
                                              : "bg-gradient-to-t from-orange-400/42 to-orange-100/62"
                                        }`}
                                        style={{ height: `${barH}px`, minWidth: "18px" }}
                                      />
                                      <span className={`mt-2 text-[11px] ${isHovered || isSelected ? "font-extrabold text-orange-500" : "font-bold text-[--text-muted]"}`}>{day}</span>
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setAreaCompletedStatsWeekOffset((value) => value + 1)}
                                  className={weekArrowCls}
                                  aria-label="查看下一周"
                                  title="下一周"
                                >
                                  <svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
                                    <path d="M3 3L7 9L3 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </div>
                            );
                          })()}
                        </div>

                        {(() => {
                          const typeCounts: Record<string, number> = {};
                          for (const task of areaCompletedTodayTasks) {
                            const group = displayTaskTypeGroupName(task.category?.name, task.priority);
                            typeCounts[group] = (typeCounts[group] || 0) + 1;
                          }
                          const total = areaCompletedTodayTasks.length || 1;
                          const typeBreakdown = DISPLAY_TASK_TYPE_ORDER
                            .filter((name) => typeCounts[name])
                            .map((name) => ({
                              name,
                              count: typeCounts[name],
                              pct: Math.round((typeCounts[name] / total) * 100),
                              color: DISPLAY_TASK_TYPE_SOLID_BG[name],
                            }));
                          return (
                            <div className={`grid h-[236px] grid-cols-[minmax(0,2fr)_minmax(118px,1fr)] overflow-hidden rounded-[34px] border backdrop-blur-2xl ${
                              resolvedTheme === "dark"
                                ? "border-white/[0.10] bg-white/[0.055]"
                                : "border-white/70 bg-white/38 shadow-[0_18px_52px_rgba(56,68,89,0.07)]"
                            }`}>
                              <div className="min-w-0 px-5 py-3">
                                <h3 className="mb-3 text-[14px] font-extrabold tracking-wide text-[--text-primary]">任务类型占比</h3>
                                {typeBreakdown.length === 0 ? (
                                  <div className={`flex h-[160px] items-center justify-center rounded-[24px] text-[12px] font-semibold text-[--text-muted] ${
                                    resolvedTheme === "dark" ? "border border-white/[0.08] bg-white/[0.04]" : "bg-white/34"
                                  }`}>暂无数据</div>
                                ) : (
                                  <div className="space-y-2.5">
                                    {typeBreakdown.map((item) => (
                                      <div key={item.name}>
                                        <div className="mb-1 flex items-center justify-between gap-3">
                                          <span className="min-w-0 truncate text-[12px] font-extrabold text-[--text-primary]">{item.name}</span>
                                          <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-[--text-primary]">{item.count}单 · {item.pct}%</span>
                                        </div>
                                        <div className={`h-1.5 overflow-hidden rounded-full ${
                                          resolvedTheme === "dark" ? "bg-white/[0.08]" : "bg-slate-900/[0.045]"
                                        }`}>
                                          <div className={`h-full rounded-full ${item.color} shadow-[0_0_18px_rgba(15,23,42,0.10)]`} style={{ width: `${item.pct}%` }} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className={`flex min-w-0 flex-col items-center justify-center border-l px-4 py-4 text-center ${
                                resolvedTheme === "dark" ? "border-white/[0.10]" : "border-slate-900/[0.06]"
                              }`}>
                                <p className="text-[13px] font-extrabold text-[--text-primary]">总完成任务</p>
                                <div className="mt-5 flex items-end justify-center gap-1">
                                  <span className="text-[38px] font-extrabold leading-none tabular-nums text-emerald-500">{areaTaskStats.completed}</span>
                                  <span className="pb-1.5 text-[13px] font-bold text-[--text-primary]">单</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className={`rounded-[34px] border backdrop-blur-2xl ${
                        resolvedTheme === "dark"
                          ? "border-white/[0.10] bg-white/[0.045]"
                          : "border-white/70 bg-white/38 shadow-[0_20px_54px_rgba(56,68,89,0.08)]"
                      }`}>
                        <h3 className={`px-5 pb-3 pt-4 text-[14px] font-extrabold tracking-wide text-[--text-primary] ${
                          resolvedTheme === "dark" ? "border-b border-white/[0.08]" : "border-b border-slate-900/[0.06]"
                        }`}>{statsDetailTitle}</h3>
                        <div>
                          {selectedStatsTasks.length === 0 ? (
                            <div className="py-10 text-center text-xs font-semibold text-[--text-muted]">暂无完成任务</div>
                          ) : (
                            <table className="w-full table-fixed border-collapse text-center text-[11px]">
                              <colgroup>
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "10%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "14%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "11%" }} />
                              </colgroup>
                              <thead className={`sticky top-0 z-20 backdrop-blur-2xl shadow-[0_10px_22px_rgba(15,23,42,0.06)] ${
                                resolvedTheme === "dark" ? "bg-slate-950/88" : "bg-white/88"
                              }`}>
                                <tr className={`border-b ${
                                  resolvedTheme === "dark" ? "border-white/[0.08] bg-white/[0.035]" : "border-slate-900/[0.06] bg-white/24"
                                }`}>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">日期时间</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">房间</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">摄影师</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">助理</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">类型</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">预估时间</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">实际用时</th>
                                  <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">状态</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedStatsTasks.map((task) => {
                                  const rawTask = selectedStatsRawTasks.find((raw) => raw.id === task.id);
                                  return (
                                    <tr key={task.id} className={`border-b transition-colors last:border-b-0 ${
                                      resolvedTheme === "dark"
                                        ? "border-white/[0.06] hover:bg-white/[0.06]"
                                        : "border-slate-900/[0.045] hover:bg-white/50"
                                    }`}>
                                      <td className="px-3 py-3 tabular-nums text-[--text-muted] align-middle whitespace-nowrap">{formatTaskDetailDateTime(task.createdAt)}</td>
                                      <td className="px-3 py-3 text-[--text-muted] align-middle tabular-nums">{task.room}室</td>
                                      <td className="px-3 py-3 font-bold text-[--text-primary] align-middle min-w-0">
                                        <span className="inline-block max-w-full truncate align-middle" title={task.photographerName || ""}>{task.photographerName || "—"}</span>
                                      </td>
                                      <td className="px-3 py-3 font-bold text-[--text-primary] align-middle min-w-0">
                                        <span className="inline-block max-w-full truncate align-middle" title={task.assistantName || ""}>{task.assistantName || "—"}</span>
                                      </td>
                                      <td className="px-3 py-3 font-semibold text-[--text-primary] align-middle min-w-0">
                                        <span className="inline-block max-w-full truncate align-middle" title={task.name}>{task.name}</span>
                                      </td>
                                      <td className="px-3 py-3 text-[--text-muted] align-middle min-w-0">
                                        <span className="inline-block max-w-full truncate align-middle" title={task.durationSlotLabel}>{task.durationSlotLabel}</span>
                                      </td>
                                      <td className="px-3 py-3 text-[--text-muted] align-middle min-w-0 tabular-nums">
                                        <span className="inline-block max-w-full truncate align-middle">
                                          {taskListActualLine(task, rawTask, now.getTime(), false) ?? "—"}
                                        </span>
                                      </td>
                                      <td className="px-3 py-3 align-middle">
                                        <div className="flex items-center justify-center gap-1">
                                          <span className={`inline-block rounded-full px-2.5 py-1 text-[9px] font-extrabold whitespace-nowrap ${task.tagCls}`}>{task.statusLabel}</span>
                                          {renderEscalationBadge(rawTask, { compact: true })}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* ====== STATS MODAL ====== */}
      {showStatsModal && (
        (() => {
          const isStatsAssistantView = isAssistantRole(profile?.role);
          const statsActionLabel = isStatsAssistantView ? "完成" : "发布";
          const weekDays = ["周一","周二","周三","周四","周五","周六","周日"];
          const todayStatsIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
          const selectedStatsDay = statsSelectedDay ?? todayStatsIdx;
          const selectedStatsDate = statsDayDate(statsWeekOffset, selectedStatsDay, now);
          const selectedStatsDayStart = new Date(selectedStatsDate.getFullYear(), selectedStatsDate.getMonth(), selectedStatsDate.getDate());
          const selectedStatsDayEnd = new Date(selectedStatsDayStart.getTime() + 24 * 60 * 60 * 1000);
          const selectedStatsRawTasks = weeklyTasks.filter((wt) => {
            const created = new Date(wt.createdAt);
            return created >= selectedStatsDayStart && created < selectedStatsDayEnd;
          });
          const selectedStatsTasks = selectedStatsRawTasks.map((t) => apiTaskToDisplay(t, isStatsAssistantView ? profile?.id : undefined));
          const selectedStatsDateLabel = formatStatsDateLabel(selectedStatsDate);
          const selectedStatsDayIsToday = statsWeekOffset === 0 && selectedStatsDay === todayStatsIdx;
          const statsWeekLabel = statsWeekOffset === 0
            ? "本周"
            : statsWeekOffset === -1
              ? "上周"
              : statsWeekOffset === 1
                ? "下周"
                : `${selectedStatsDateLabel.slice(5)}所在周`;
          const statsTitle = `我的任务${statsActionLabel}统计`;
          const statsTrendTitle = `${statsWeekLabel}任务${statsActionLabel}趋势`;
          const statsDetailTitle = `${selectedStatsDayIsToday ? "今日" : `${weekDays[selectedStatsDay]} ${selectedStatsDateLabel}`}任务${statsActionLabel}明细`;
          const statsFeedbackTitle = isStatsAssistantView ? "点赞" : "点赞/点踩";
          return (
        <div
          className={`fixed inset-0 z-[80] flex items-center justify-center px-6 ${
            resolvedTheme === "dark"
              ? "bg-slate-950/52"
              : "bg-slate-900/22"
          }`}
          onClick={() => setShowStatsModal(false)}
        >
          <div
            className={`relative w-full max-w-[min(92vw,826px)] max-h-[62vh] overflow-visible rounded-[32px] border p-5 shadow-2xl backdrop-blur-[30px] ring-1 ${
              resolvedTheme === "dark"
                ? "border-white/[0.12] bg-slate-950/62 shadow-black/45 ring-white/[0.06]"
                : "border-white/75 bg-white/62 shadow-[0_34px_100px_rgba(56,68,89,0.22)] ring-slate-900/[0.04]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-80"
              style={{
                background:
                  resolvedTheme === "dark"
                    ? "radial-gradient(circle at 16% 12%, rgba(96,165,250,0.16), transparent 32%), radial-gradient(circle at 84% 8%, rgba(34,211,238,0.10), transparent 30%)"
                    : "radial-gradient(circle at 16% 12%, rgba(255,255,255,0.82), transparent 34%), radial-gradient(circle at 86% 8%, rgba(96,165,250,0.11), transparent 32%)",
                }}
            />
            <button
              type="button"
              onClick={() => setShowStatsModal(false)}
              className={`absolute -right-2 -top-2 z-[4] flex h-7 w-7 items-center justify-center rounded-full border text-[14px] font-black leading-none shadow-sm backdrop-blur-xl transition-colors ${
                resolvedTheme === "dark"
                  ? "border-white/[0.10] bg-slate-900/70 text-slate-300 hover:bg-slate-800/85 hover:text-slate-100"
                  : "border-white/80 bg-white/80 text-slate-400 hover:bg-white hover:text-slate-600"
              }`}
              aria-label={`关闭${statsTitle}`}
              title="关闭"
            >
              x
            </button>
            <div className="relative z-[1] overflow-hidden rounded-[24px]">
              <div
                ref={statsScrollRef}
                className="-mr-3 max-h-[calc(62vh-40px)] overflow-y-auto"
              >
                <div className="pr-3">
            {/* Header */}
            <div className="mb-6 flex items-center">
              <div className="pl-2">
                <h2 className="text-[22px] font-extrabold tracking-wide text-[--text-primary]">{statsTitle}</h2>
              </div>
            </div>

            {/* Stat Cards */}
            {(() => {
              const completed = tasks.filter((t) => t.statusLabel === "已完成").length;
              const executing = tasks.filter((t) => t.statusLabel === "进行中").length;
              const waiting = tasks.filter((t) => t.statusLabel === "等待中").length;
              const assigned = tasks.filter((t) => t.statusLabel === "待就位").length;
              const summaries = [
                { label: "已完成", value: completed, color: "text-emerald-500", glow: "rgba(16,185,129,0.18)" },
                { label: "进行中", value: executing, color: "text-orange-500", glow: "rgba(249,115,22,0.18)" },
                { label: "待就位", value: assigned, color: "text-blue-500", glow: "rgba(59,130,246,0.18)" },
                { label: "等待中", value: waiting, color: resolvedTheme === "dark" ? "text-slate-300" : "text-slate-600", glow: "rgba(100,116,139,0.16)" },
              ];
              return (
                <div className="mb-5 grid grid-cols-4 gap-3">
                  {summaries.map((s) => (
                    <div
                      key={s.label}
                      className={`relative overflow-hidden rounded-[28px] border px-4 py-4 backdrop-blur-2xl transition-transform duration-200 hover:-translate-y-0.5 ${
                        resolvedTheme === "dark"
                          ? "border-white/[0.10] bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "border-white/75 bg-white/46 shadow-[0_18px_44px_rgba(56,68,89,0.08),inset_0_1px_0_rgba(255,255,255,0.72)]"
                      }`}
                    >
                      <span
                        className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full blur-2xl"
                        style={{ backgroundColor: s.glow }}
                      />
                      <p className="relative text-[12px] font-bold text-[--text-muted]">{s.label}</p>
                      <div className="relative mt-4 flex items-end gap-1">
                        <span className={`text-[30px] font-extrabold leading-none tabular-nums ${s.color}`}>{s.value}</span>
                        <span className="pb-1 text-[12px] font-bold text-[--text-muted]">单</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Charts row */}
            {(() => {
              // 任务类型占比 — 从真实 tasks 计算
              const typeCounts: Record<string, number> = {};
              for (const t of tasks) {
                const group = displayTaskTypeGroupName(t.name);
                typeCounts[group] = (typeCounts[group] || 0) + 1;
              }
              const total = tasks.length || 1;
              const typeBreakdown = DISPLAY_TASK_TYPE_ORDER
                .filter((name) => typeCounts[name])
                .map((name) => ({ name, count: typeCounts[name], pct: Math.round((typeCounts[name] / total) * 100), color: DISPLAY_TASK_TYPE_SOLID_BG[name] }));

              return (
                <div className="mb-4 grid grid-cols-2 gap-4">
                  {/* Weekly Chart — Interactive hover + click-to-filter */}
                  <div className={`relative h-[236px] rounded-[34px] border px-8 py-3 backdrop-blur-2xl ${
                    resolvedTheme === "dark"
                      ? "border-white/[0.10] bg-white/[0.055]"
                      : "border-white/70 bg-white/38 shadow-[0_18px_52px_rgba(56,68,89,0.07)]"
                  }`}>
                    <div className="mb-2 flex min-h-[22px] items-center justify-between gap-3">
                      <h3 className="text-[14px] font-extrabold tracking-wide text-[--text-primary]">{statsTrendTitle}</h3>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold transition-opacity duration-150 ${
                          resolvedTheme === "dark" ? "bg-orange-400/12 text-orange-200" : "bg-orange-500/10 text-orange-600"
                        }`}>
                        {weekDays[statsHoveredDay ?? selectedStatsDay]} · {formatStatsDateLabel(statsDayDate(statsWeekOffset, statsHoveredDay ?? selectedStatsDay, now))}
                      </span>
                    </div>
                    {(() => {
                      // 计算当前查看周每天的任务数（基于真实数据）
                      const monday = statsWeekStart(statsWeekOffset, now);
                      const weekCounts = Array.from({ length: 7 }, (_, i) => {
                        const dayStart = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
                        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                        return weeklyTasks.filter((wt) => {
                          const created = new Date(wt.createdAt);
                          return created >= dayStart && created < dayEnd;
                        }).length;
                      });
                      const wMax = Math.max(...weekCounts, 1);
                      const previewIdx = statsHoveredDay ?? selectedStatsDay;
                      const weekArrowCls = `mb-[24px] flex h-9 w-5 items-center justify-center rounded-full transition-colors ${
                        resolvedTheme === "dark"
                          ? "text-slate-400/90 hover:bg-white/[0.045] hover:text-slate-200"
                          : "text-slate-400 hover:bg-slate-900/[0.03] hover:text-slate-600"
                      }`;
                      return (
                        <div className="grid h-40 grid-cols-[20px_repeat(7,minmax(0,1fr))_20px] items-end gap-2">
                          <button
                            type="button"
                            onClick={() => setStatsWeekOffset((v) => v - 1)}
                            className={weekArrowCls}
                            aria-label="查看上一周"
                            title="上一周"
                          >
                            <svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
                              <path d="M7 3L3 9L7 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          {weekDays.map((day, i) => {
                            const isSelected = i === selectedStatsDay;
                            const isHovered = i === previewIdx;
                            const barH = weekCounts[i] > 0 ? Math.max((weekCounts[i] / wMax) * 92, 6) : 0;
                            return (
                              <button
                                type="button"
                                key={day}
                                className={`flex h-full flex-1 flex-col items-center justify-end rounded-2xl px-1 transition-colors duration-200 ${
                                  resolvedTheme === "dark" ? "hover:bg-white/[0.06]" : "hover:bg-white/20"
                                }`}
                                onMouseEnter={() => setStatsHoveredDay(i)}
                                onMouseLeave={() => setStatsHoveredDay(null)}
                                onClick={() => setStatsSelectedDay(i)}
                                aria-pressed={isSelected}
                                aria-label={`查看${day}任务明细`}
                              >
                                <span className={`mb-2 text-[12px] font-extrabold tabular-nums ${isHovered || isSelected ? "text-orange-500" : "text-[--text-primary]"}`}>{weekCounts[i]}</span>
                                <div
                                  className={`w-full max-w-[64px] rounded-t-[16px] transition-all duration-300 ${
                                    isHovered || isSelected
                                      ? "bg-gradient-to-t from-orange-600 to-orange-300 shadow-[0_10px_24px_rgba(249,115,22,0.26)]"
                                      : resolvedTheme === "dark"
                                        ? "bg-gradient-to-t from-orange-400/36 to-orange-200/20"
                                        : "bg-gradient-to-t from-orange-400/42 to-orange-100/62"
                                  }`}
                                  style={{ height: `${barH}px`, minWidth: "18px" }}
                                />
                                <span className={`mt-2 text-[11px] ${isHovered || isSelected ? "font-extrabold text-orange-500" : "font-bold text-[--text-muted]"}`}>{day}</span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setStatsWeekOffset((v) => v + 1)}
                            className={weekArrowCls}
                            aria-label="查看下一周"
                            title="下一周"
                          >
                            <svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
                              <path d="M3 3L7 9L3 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Type Breakdown — 真实数据 */}
                  <div className={`h-[236px] overflow-hidden rounded-[34px] border px-5 pb-5 pt-3 backdrop-blur-2xl ${
                    resolvedTheme === "dark"
                      ? "border-white/[0.10] bg-white/[0.055]"
                      : "border-white/70 bg-white/38 shadow-[0_18px_52px_rgba(56,68,89,0.07)]"
                  }`}>
                    <h3 className="mb-3 text-[14px] font-extrabold tracking-wide text-[--text-primary]">任务类型占比</h3>
                    {typeBreakdown.length === 0 ? (
                      <div className={`flex h-[160px] items-center justify-center rounded-[24px] text-[12px] font-semibold text-[--text-muted] ${
                        resolvedTheme === "dark" ? "border border-white/[0.08] bg-white/[0.04]" : "bg-white/34"
                      }`}>暂无数据</div>
                    ) : (
                      <div className="space-y-2.5">
                        {typeBreakdown.map((t) => (
                          <div key={t.name}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[12px] font-extrabold text-[--text-primary]">{t.name}</span>
                              <span className="text-[11px] font-bold text-[--text-muted]">{t.count}单 · {t.pct}%</span>
                            </div>
                            <div className={`h-1.5 overflow-hidden rounded-full ${
                              resolvedTheme === "dark" ? "bg-white/[0.08]" : "bg-slate-900/[0.045]"
                            }`}>
                              <div className={`h-full rounded-full ${t.color} shadow-[0_0_18px_rgba(15,23,42,0.10)]`} style={{ width: `${t.pct}%` }} />
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
            <div className={`overflow-hidden rounded-[34px] border backdrop-blur-2xl ${
              resolvedTheme === "dark"
                ? "border-white/[0.10] bg-white/[0.045]"
                : "border-white/70 bg-white/38 shadow-[0_20px_54px_rgba(56,68,89,0.08)]"
            }`}>
              <h3 className={`px-5 pb-3 pt-4 text-[14px] font-extrabold tracking-wide text-[--text-primary] ${
                resolvedTheme === "dark" ? "border-b border-white/[0.08]" : "border-b border-slate-900/[0.06]"
              }`}>{statsDetailTitle}</h3>
              <div className="overflow-x-auto">
                {selectedStatsTasks.length === 0 ? (
                  <div className="py-10 text-center text-xs font-semibold text-[--text-muted]">暂无任务</div>
                ) : (
                  <table className="w-full table-fixed border-collapse text-center text-[11px]">
                    <colgroup>
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "13%" }} />
                    </colgroup>
                    <thead>
                      <tr className={`border-b ${
                        resolvedTheme === "dark" ? "border-white/[0.08] bg-white/[0.035]" : "border-slate-900/[0.06] bg-white/24"
                      }`}>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">日期时间</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">房间</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">
                          {isAssistantRole(profile?.role) ? "摄影师" : "助理"}
                        </th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">类型</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">预估时间</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">实际用时</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">状态</th>
                        <th className="px-3 py-3 text-[11px] font-extrabold text-[--text-muted] align-middle">{statsFeedbackTitle}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStatsTasks.map((t) => (
                        <tr key={t.id} className={`border-b transition-colors last:border-b-0 ${
                          resolvedTheme === "dark"
                            ? "border-white/[0.06] hover:bg-white/[0.06]"
                            : "border-slate-900/[0.045] hover:bg-white/50"
                        }`}>
                          <td className="px-3 py-3 tabular-nums text-[--text-muted] align-middle whitespace-nowrap">
                            {formatTaskDetailDateTime(t.createdAt)}
                          </td>
                          <td className="px-3 py-3 text-[--text-muted] align-middle tabular-nums">{t.room}室</td>
                          <td className="px-3 py-3 font-bold text-[--text-primary] align-middle min-w-0">
                            <span
                              className="inline-block max-w-full truncate align-middle"
                              title={isAssistantRole(profile?.role) ? (t.photographerName || "") : (t.assistantName || "")}
                            >
                              {isAssistantRole(profile?.role) ? (t.photographerName || "—") : (t.assistantName || "—")}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-semibold text-[--text-primary] align-middle min-w-0">
                            <span className="inline-block max-w-full truncate align-middle" title={t.name}>{t.name}</span>
                          </td>
                          <td className="px-3 py-3 text-[--text-muted] align-middle min-w-0">
                            <span className="inline-block max-w-full truncate align-middle" title={t.durationSlotLabel}>{t.durationSlotLabel}</span>
                          </td>
                          <td
                            className={`px-3 py-3 text-[--text-muted] align-middle min-w-0 tabular-nums ${
                              t.statusLabel === "进行中" || t.statusLabel === "已暂停"
                                ? "font-semibold"
                                : "font-normal"
                            }`}
                          >
                            <span className="inline-block max-w-full truncate align-middle">
                              {taskListActualLine(t, selectedStatsRawTasks.find((x) => x.id === t.id), now.getTime(), false, isAssistantRole(profile?.role) ? profile?.id : undefined) ?? "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`inline-block rounded-full px-2.5 py-1 text-[9px] font-extrabold whitespace-nowrap ${t.tagCls}`}>{t.statusLabel}</span>
                              {renderEscalationBadge(selectedStatsRawTasks.find((x) => x.id === t.id), { compact: true })}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex items-center justify-center gap-1">
                              {isStatsAssistantView ? (
                                <span
                                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-200 ${
                                    t.publisherFeedback === "like"
                                      ? "border-emerald-300/70 bg-emerald-400/16 text-emerald-500 shadow-[0_8px_18px_rgba(16,185,129,0.13)]"
                                      : resolvedTheme === "dark"
                                        ? "border-white/[0.08] bg-white/[0.035] text-slate-500"
                                        : "border-white/60 bg-white/26 text-slate-300"
                                  }`}
                                  aria-label={t.publisherFeedback === "like" ? "摄影师已点赞" : "摄影师未点赞"}
                                  title={t.publisherFeedback === "like" ? "摄影师已点赞" : "摄影师未点赞"}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill={t.publisherFeedback === "like" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M7 10v11" />
                                    <path d="M15 5.5 14 10h5.2a2 2 0 0 1 1.9 2.5l-1.6 6A2 2 0 0 1 17.6 20H7" />
                                    <path d="M7 10H4.7A1.7 1.7 0 0 0 3 11.7v7.6A1.7 1.7 0 0 0 4.7 21H7" />
                                    <path d="M14 10V4.6A1.6 1.6 0 0 0 12.4 3h-.2L8 10" />
                                  </svg>
                                </span>
                              ) : (["like", "dislike"] as const).map((feedback) => {
                                const active = t.publisherFeedback === feedback;
                                const saving = publisherFeedbackSavingId === t.id;
                                const isLike = feedback === "like";
                                return (
                                  <button
                                    key={feedback}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void handlePublisherFeedback(t, feedback)}
                                    className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 ${
                                      active
                                        ? isLike
                                          ? "border-emerald-300/70 bg-emerald-400/16 text-emerald-500 shadow-[0_8px_18px_rgba(16,185,129,0.13)]"
                                          : "border-rose-300/70 bg-rose-400/14 text-rose-500 shadow-[0_8px_18px_rgba(244,63,94,0.12)]"
                                        : resolvedTheme === "dark"
                                          ? "border-white/[0.10] bg-white/[0.045] text-slate-300 hover:bg-white/[0.09]"
                                          : "border-white/70 bg-white/38 text-slate-500 hover:bg-white/70 hover:text-slate-700"
                                    } ${saving ? "cursor-wait opacity-60" : "hover:-translate-y-0.5"}`}
                                    aria-label={`${isLike ? "点赞" : "点踩"}${t.name}`}
                                    title={isLike ? "点赞" : "点踩"}
                                  >
                                    {isLike ? (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M7 10v11" />
                                        <path d="M15 5.5 14 10h5.2a2 2 0 0 1 1.9 2.5l-1.6 6A2 2 0 0 1 17.6 20H7" />
                                        <path d="M7 10H4.7A1.7 1.7 0 0 0 3 11.7v7.6A1.7 1.7 0 0 0 4.7 21H7" />
                                        <path d="M14 10V4.6A1.6 1.6 0 0 0 12.4 3h-.2L8 10" />
                                      </svg>
                                    ) : (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M17 14V3" />
                                        <path d="M9 18.5 10 14H4.8a2 2 0 0 1-1.9-2.5l1.6-6A2 2 0 0 1 6.4 4H17" />
                                        <path d="M17 14h2.3a1.7 1.7 0 0 0 1.7-1.7V4.7A1.7 1.7 0 0 0 19.3 3H17" />
                                        <path d="M10 14v5.4a1.6 1.6 0 0 0 1.6 1.6h.2L16 14" />
                                      </svg>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
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
            </div>
          </div>
        </div>
          );
        })()
      )}

      {ironingPreferenceConfirmTask && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
          onMouseDown={() => setIroningPreferenceConfirmTask(null)}
        >
          <div
            className={`w-full max-w-sm rounded-3xl border p-5 text-center shadow-2xl ${resolvedTheme === "dark" ? "border-white/[0.16] bg-slate-950/92 shadow-black/50" : "border-white/75 bg-white/92 shadow-slate-300/40"}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-500/15 text-lime-600">
              <span className="h-5 w-5 rounded-full bg-lime-500" />
            </div>
            <h3 className="mt-4 text-[17px] font-extrabold text-[--text-primary]">当前熨烫机空闲</h3>
            <p className="mt-2 text-[12px] font-semibold leading-relaxed text-[--text-secondary]">
              建议优先承接熨烫任务。你选择的是
              <span className="mx-1 font-extrabold text-[--text-primary]">
                {ironingPreferenceConfirmTask.roomNumber}室 · {ironingPreferenceConfirmTask.category?.name ?? "任务"}
              </span>
              ，确认先开始这个普通任务吗？
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setIroningPreferenceConfirmTask(null)}
                className="min-h-[42px] flex-1 rounded-2xl bg-white/56 px-4 text-[13px] font-extrabold text-[--text-secondary] transition-colors hover:bg-white/80"
              >
                先不开始
              </button>
              <button
                type="button"
                onClick={() => {
                  const task = ironingPreferenceConfirmTask;
                  setIroningPreferenceConfirmTask(null);
                  void handleAssistantStatusChange("start", task);
                }}
                className="min-h-[42px] flex-1 rounded-2xl bg-orange-500 px-4 text-[13px] font-extrabold text-white shadow-lg shadow-orange-500/20 transition-colors hover:bg-orange-600"
              >
                确认开始
              </button>
            </div>
          </div>
        </div>
      )}

      {completionRegistrationTask && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          onMouseDown={() => {
            if (!completionRegistrationSaving) closeCompletionRegistrationModal();
          }}
        >
          <div
            className={`w-full max-w-lg rounded-3xl border p-5 shadow-2xl ${resolvedTheme === "dark" ? "border-white/[0.16] bg-slate-950/94 shadow-black/50" : "border-white/75 bg-white/94 shadow-slate-300/40"}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
	              <div>
	                <h3 className="text-[17px] font-extrabold text-[--text-primary]">异常登记 / SKU 追踪</h3>
	                <p className="mt-1 text-[12px] font-semibold text-[--text-muted]">
		                  用于记录超时过长、耗时异常、摄影师其他反馈。
	                </p>
	              </div>
              <button
                type="button"
                onClick={closeCompletionRegistrationModal}
                disabled={completionRegistrationSaving}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/50 text-[18px] font-bold text-[--text-muted] transition-colors hover:bg-white/80 disabled:opacity-50"
                aria-label="关闭异常登记"
              >
                ×
              </button>
            </div>

	            <div className="mt-4 flex min-h-[48px] items-center gap-2 overflow-hidden rounded-2xl bg-white/46 px-3 py-2 text-[12px] font-semibold leading-relaxed text-[--text-secondary]">
	              <span className={`flex h-5 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 text-[10px] font-extrabold shadow-sm ${publicQueuePriorityLevelCls(completionRegistrationTask.priority)}`}>
	                P{completionRegistrationTask.priority}
	              </span>
	              <span className="min-w-0 truncate whitespace-nowrap">
	                {formatRoomOrVenue(completionRegistrationTask.roomNumber)} · {completionRegistrationTask.photographer?.name ?? "摄影师"} · {completionRegistrationTask.category?.name ?? "任务"} · {taskCategoryDurationCaption(completionRegistrationTask.category, completionRegistrationTask.priority)}
	              </span>
	            </div>

			            <div className="mt-4 grid gap-3 md:grid-cols-[0.84fr_1.16fr]">
		              <div>
		                <label className="block text-[12px] font-extrabold text-[--text-primary]">
		                  完成 SKU <span className="text-red-500">*</span>
	                </label>
	                <input
	                  value={completionRegistrationSku}
	                  onChange={(event) => {
	                    setCompletionRegistrationSku(event.target.value);
	                    if (completionRegistrationError) setCompletionRegistrationError(null);
	                  }}
	                  maxLength={80}
		                  className="mt-2 min-h-[48px] w-full rounded-2xl border border-orange-200/70 bg-white/72 px-3 text-[12px] font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white"
		                  placeholder="输入SKU,例如HAP2456"
			                />
			              </div>
	              <div>
	                <label className="block text-[12px] font-extrabold text-[--text-primary]">
	                  异常原因 <span className="text-red-500">*</span>
	                </label>
	                <div className="mt-2 grid grid-cols-3 gap-1.5">
	                  {COMPLETION_REGISTRATION_REASON_OPTIONS.map((reason) => {
	                    const selected = completionRegistrationReasonType === reason;
	                    return (
	                      <button
	                        key={reason}
	                        type="button"
	                        onClick={() => {
	                          setCompletionRegistrationReasonType(reason);
	                          if (completionRegistrationError) setCompletionRegistrationError(null);
	                        }}
	                        className={`flex min-h-[48px] items-center justify-center rounded-2xl border px-2 text-[11px] font-extrabold transition-colors ${
	                          selected
	                            ? "border-orange-300 bg-orange-50 text-orange-600"
	                            : "border-white/70 bg-white/56 text-[--text-secondary] hover:border-orange-200 hover:bg-orange-50/60 hover:text-orange-600"
	                        }`}
	                      >
	                        <span className={`mr-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ${
	                          selected ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 text-transparent"
	                        }`}>
	                          ✓
	                        </span>
	                        {reason}
	                      </button>
	                    );
	                  })}
	                </div>
	              </div>
		            </div>

	            <div className="mt-4">
	              <label className="block text-[12px] font-extrabold text-[--text-primary]">图片记录</label>
              {(() => {
                const previewItems = [
                  ...completionRegistrationExistingImages.map((url, index) => ({ key: `existing-${url}`, url, existing: true, index })),
                  ...completionRegistrationFilePreviewUrls.map((url, index) => ({ key: `file-${url}`, url, existing: false, index })),
                ];
			                const rotateCls = ["-rotate-6", "rotate-3", "-rotate-2"];
		                const zCls = ["z-10", "z-20", "z-30"];
		                return (
			                  <div className="group/image-tray mt-2 flex min-h-[104px] items-center rounded-2xl border border-orange-100/80 bg-white/52 px-4 py-2 transition-all duration-300 hover:border-orange-200 hover:bg-white/68">
			                    {previewItems.length > 0 ? (
				                      <div className="scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-visible pb-3 pl-1 pr-8 pt-5">
			                        {previewItems.map((item, index) => (
			                          <div
			                            key={item.key}
			                            className={`group/card relative h-[70px] w-[56px] shrink-0 overflow-visible rounded-lg transition-all duration-300 ease-out group-hover/image-tray:-translate-y-1 group-hover/image-tray:rotate-0 hover:z-[80] hover:!-translate-y-2 hover:translate-x-2 hover:scale-110 ${zCls[index % zCls.length]} ${rotateCls[index % rotateCls.length]} ${index === 0 ? "" : "-ml-7 group-hover/image-tray:ml-2"}`}
			                          >
			                            <div className="h-full w-full overflow-hidden rounded-lg border border-white bg-white shadow-md shadow-slate-300/35 transition-shadow duration-300 group-hover/image-tray:shadow-lg group-hover/image-tray:shadow-orange-200/30">
			                              <img src={item.url} alt="登记图片" className="h-full w-full object-cover" />
			                            </div>
			                            {index === previewItems.length - 1 && (
			                              <label className="absolute -bottom-3 -right-3 z-[70] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/80 bg-white text-[24px] font-light leading-none text-slate-700 shadow-md shadow-slate-300/40 transition-all duration-300 hover:border-orange-300 hover:text-orange-500 group-hover/image-tray:scale-95 group-hover/image-tray:opacity-0 group-hover/image-tray:pointer-events-none">
		                                +
		                                <input
		                                  type="file"
		                                  accept="image/*"
		                                  capture="environment"
		                                  multiple
		                                  className="hidden"
		                                  onChange={(event) => {
		                                    handleCompletionRegistrationFiles(event.currentTarget.files);
		                                    event.currentTarget.value = "";
		                                  }}
		                                />
		                              </label>
		                            )}
			                            <button
			                              type="button"
				                              className="absolute -right-1.5 -top-1.5 z-[120] flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[14px] font-bold leading-none text-white opacity-0 shadow-sm ring-1 ring-white/70 transition-opacity duration-150 group-hover/card:delay-500 group-hover/card:opacity-100"
		                              onClick={() => {
		                                if (item.existing) {
                                  setCompletionRegistrationExistingImages((prev) => prev.filter((_, itemIndex) => itemIndex !== item.index));
                                } else {
                                  setCompletionRegistrationFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== item.index));
                                }
                              }}
                              aria-label="移除图片"
                            >
                              ×
                            </button>
                          </div>
		                        ))}
				                        {
			                          <label className={`pointer-events-none relative mt-8 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/80 bg-white text-[26px] font-light text-slate-700 opacity-0 shadow-md shadow-slate-300/30 transition-all duration-300 hover:border-orange-300 hover:text-orange-500 group-hover/image-tray:pointer-events-auto group-hover/image-tray:mt-0 group-hover/image-tray:h-[70px] group-hover/image-tray:w-[58px] group-hover/image-tray:-translate-y-1 group-hover/image-tray:rounded-lg group-hover/image-tray:border-dashed group-hover/image-tray:border-slate-300 group-hover/image-tray:bg-white/70 group-hover/image-tray:text-slate-400 group-hover/image-tray:opacity-100 ${previewItems.length === 0 ? "" : "-ml-4 group-hover/image-tray:ml-3"}`}>
	                            +
	                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                handleCompletionRegistrationFiles(event.currentTarget.files);
                                event.currentTarget.value = "";
                              }}
			                            />
			                          </label>
	                        }
                      </div>
                    ) : (
                      <label className="flex min-h-[66px] w-full cursor-pointer items-center justify-center rounded-2xl border border-dashed border-orange-200 bg-orange-50/36 text-[12px] font-extrabold text-orange-600 transition-colors hover:bg-orange-50">
                        <span className="mr-2 text-[20px] leading-none">+</span>
                        拍摄或上传图片
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            handleCompletionRegistrationFiles(event.currentTarget.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })()}
            </div>

	            <label className="mt-4 block text-[12px] font-extrabold text-[--text-primary]">补充说明</label>
	            <div className="relative mt-2">
	              <textarea
	                value={completionRegistrationDescription}
	                onChange={(event) => setCompletionRegistrationDescription(event.target.value)}
	                rows={4}
	                maxLength={100}
	                className="min-h-[184px] w-full resize-none rounded-2xl border border-white/70 bg-white/70 px-3 py-3 pb-8 text-[13px] font-semibold leading-relaxed text-slate-700 outline-none transition focus:border-orange-200 focus:bg-white"
	                placeholder="记录异常原因，例如 SKU 配件复杂、等待样衣、返工、超时较长等。"
	              />
	              <span className="pointer-events-none absolute bottom-3 right-4 text-[11px] font-semibold text-[--text-muted]">
	                {completionRegistrationDescription.trim().length}/100
	              </span>
	            </div>
	            <div className="mt-1 min-h-[16px] text-[11px] font-semibold text-red-500">
	              {completionRegistrationError ?? ""}
	            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeCompletionRegistrationModal}
                disabled={completionRegistrationSaving}
                className="min-h-[42px] flex-1 rounded-2xl bg-white/56 px-4 text-[13px] font-extrabold text-[--text-secondary] transition-colors hover:bg-white/80 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitCompletionRegistration()}
                disabled={completionRegistrationSaving || completionRegistrationSku.trim().length === 0 || !completionRegistrationReasonType}
                className="min-h-[42px] flex-1 rounded-2xl bg-orange-500 px-4 text-[13px] font-extrabold text-white shadow-lg shadow-orange-500/20 transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {completionRegistrationSaving ? "保存中..." : completionRegistrationTask.completionRegistration ? "保存修改" : "保存登记"}
              </button>
            </div>
          </div>
        </div>
      )}

      {priorityUpgradeTask && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
          onMouseDown={closePriorityUpgradeModal}
        >
          <div
            className={`w-full max-w-md rounded-3xl border p-5 shadow-2xl ${resolvedTheme === "dark" ? "border-white/[0.16] bg-slate-950/92 shadow-black/50" : "border-white/75 bg-white/92 shadow-slate-300/40"}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[17px] font-extrabold text-[--text-primary]">申请任务提权</h3>
                <p className="mt-1 text-[12px] font-semibold text-[--text-muted]">
                  当前 P{priorityUpgradeTask.priority}，申请提升到 P1，后台可按实际情况批准为 P1/P2/P3。
                </p>
              </div>
              <button
                type="button"
                onClick={closePriorityUpgradeModal}
                disabled={priorityUpgradeSaving}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/50 text-[18px] font-bold text-[--text-muted] transition-colors hover:bg-white/80 disabled:opacity-50"
                aria-label="关闭提权申请"
              >
                ×
              </button>
            </div>
            <div className="mt-4 rounded-2xl bg-white/46 px-3 py-2 text-[12px] font-semibold text-[--text-secondary]">
              {priorityUpgradeTask.roomNumber}室 · {priorityUpgradeTask.category?.name ?? "任务"} · P{priorityUpgradeTask.priority}
            </div>
            <label className="mt-4 block text-[12px] font-extrabold text-[--text-primary]">
              SKU <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={priorityUpgradeSku}
              onChange={(event) => {
                setPriorityUpgradeSku(event.target.value);
                if (priorityUpgradeError) setPriorityUpgradeError(null);
              }}
              maxLength={80}
              className="mt-2 h-11 w-full rounded-2xl border border-white/70 bg-white/70 px-3 text-[13px] font-semibold text-slate-700 outline-none ring-0 transition focus:border-orange-200 focus:bg-white"
              placeholder="输入需要提权的 SKU"
            />
            <label className="mt-4 block text-[12px] font-extrabold text-[--text-primary]">
              申请理由 <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-2">
              <textarea
                value={priorityUpgradeReason}
                onChange={(event) => {
                  setPriorityUpgradeReason(event.target.value);
                  if (priorityUpgradeError) setPriorityUpgradeError(null);
                }}
                rows={5}
                maxLength={160}
                className="min-h-[190px] w-full resize-none rounded-2xl border border-white/70 bg-white/70 px-3 py-3 pb-8 text-[13px] font-semibold leading-relaxed text-slate-700 outline-none ring-0 transition focus:border-orange-200 focus:bg-white"
                placeholder="例如：客户临时加急，必须先完成熨烫后才能拍摄下一组。"
              />
              <span className="pointer-events-none absolute bottom-3 right-4 text-[11px] font-semibold text-[--text-muted]">
                {priorityUpgradeReason.trim().length}/160
              </span>
            </div>
            <div className="mt-1 min-h-[16px] text-[11px] font-semibold text-red-500">
              {priorityUpgradeError ?? ""}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closePriorityUpgradeModal}
                disabled={priorityUpgradeSaving}
                className="min-h-[42px] flex-1 rounded-2xl bg-white/56 px-4 text-[13px] font-extrabold text-[--text-secondary] transition-colors hover:bg-white/80 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitPriorityUpgrade()}
                disabled={priorityUpgradeSaving || priorityUpgradeSku.trim().length === 0 || priorityUpgradeReason.trim().length === 0}
                className="min-h-[42px] flex-1 rounded-2xl bg-red-500 px-4 text-[13px] font-extrabold text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {priorityUpgradeSaving ? "提交中..." : "提交申请"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hidden lg:block">
        <AssistantDock
          assistants={assistants}
          rankingCrownByAssistantId={rankingCrownByAssistantId}
          onNoteEdit={(taskId, note, anchor) => {
            if (noteTaskIsExecuting(taskId)) return;
            setNotePopupTaskId(taskId);
            setNotePopupValue(note);
            setNotePopupAnchor(anchor);
          }}
        />
      </div>
      </div>
    </div>
  );
}
