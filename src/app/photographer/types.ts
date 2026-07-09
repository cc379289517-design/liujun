export type VenuePoint = { x: number; y: number };

export type ExtraVenueEntry = {
  name: string;
  type?: string;
  x?: number;
  y?: number;
  color?: string;
  polygon?: VenuePoint[];
};

export type IroningMachine = {
  id: number;
  buildingId: number;
  name: string;
  status: "normal" | "maintenance";
  xPosition: number;
  yPosition: number;
  sortRank: number;
};

export type WorkbenchBuilding = {
  id: number;
  name: string;
  floorPlanUrl: string | null;
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  extraVenues?: string | null;
  rooms: { id: number; roomNumber: string; xPosition: number; yPosition: number }[];
  ironingMachines?: IroningMachine[];
};

export type AssistantPresenceState = "online" | "eating" | "on_break";
export type MobileWorkbenchTab = "current" | "map" | "queue" | "me";
export type ThemeMode = "light" | "dark" | "auto";
export type TaskPublisherFeedback = "like" | "dislike";
export type IroningTaskStage = "none" | "waiting_machine" | "notified" | "using";

export type TaskCompletionRegistration = {
  id: string;
  taskId: string;
  assistantId: string;
  sku: string;
  imageUrls: string | string[];
  reasonType?: string | null;
  description: string | null;
  overtimeMinutesSnapshot: number | null;
  workSecondsSnapshot: number | null;
  createdAt: string;
  updatedAt: string;
  assistant?: { id: string; name: string } | null;
};

export type TaskFromAPI = {
  id: string;
  photographerId: string;
  assistantId: string | null;
  locationBuildingId?: number | null;
  roomNumber: string;
  categoryId: number;
  priority: number;
  status: "waiting" | "executing" | "paused" | "completed";
  isSpecified?: boolean;
  ironingStage?: IroningTaskStage;
  ironingQueuedAt?: string | null;
  ironingNotifiedAt?: string | null;
  ironingStartedAt?: string | null;
  note: string | null;
  publisherFeedback?: TaskPublisherFeedback | null;
  priorityUpgradeRequests?: {
    id: string;
    status: "pending" | "approved" | "rejected";
    fromPriority: number;
    targetPriority: number;
    reason: string;
    createdAt: string;
  }[];
  assistantTransferRequests?: {
    id: string;
    taskId: string;
    fromAssistantId: string;
    targetAssistantId: string;
    counterpartTaskId?: string | null;
    kind?: "handoff" | "swap" | string;
    responseMode?: "pause_and_go" | "after_complete" | string | null;
    status: string;
    reason: string | null;
    requestedAt: string;
    targetConfirmedAt?: string | null;
    completedAt: string | null;
    canceledAt: string | null;
  }[];
  completionRegistration?: TaskCompletionRegistration | null;
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
  specifiedAssistant?: { id: string; name: string; avatar?: string | null } | null;
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

export type StandbyReassignmentNoticeFromAPI = {
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
  reason: string;
  oldAssistantSetOffline: boolean;
  oldAssistantActiveTaskRoomNumber: string | null;
  oldAssistantActiveTaskCategoryName: string | null;
  oldAssistantActiveTaskStatus: string | null;
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

export type DisplayTask = {
  id: string;
  name: string;
  room: string;
  time: string;
  timePeriod: string;
  /** 任务类型配置的预估时长（摄影师下发所选类别），与优先级档文案无关 */
  estimatedLabel: string;
  /** 快捷预约所选 min-max 时段文案，与按钮标签一致 */
  durationSlotLabel: string;
  actualTime: string;
  progress: number | null;
  statusLabel: string;
  statusCls: string;
  tagCls: string;
  hasProgress: boolean;
  isSpecified: boolean;
  specifiedAssistantName: string | null;
  assistantName: string | null;
  photographerName: string | null;
  createdAt: string;
  estEndTime: string | null;
  publisherFeedback: TaskPublisherFeedback | null;
};

export type TaskParticipant = NonNullable<TaskFromAPI["collaborators"]>[number];

export type AssistantRankingContribution = {
  assistantId: string;
  assistantName: string;
  taskId: string;
  taskName: string;
  roomNumber: string;
  buildingId: number | null;
  completedAtMs: number;
  workSeconds: number;
};

export type AssistantRankingDetail = {
  taskId: string;
  taskTitle: string;
  serviceSeconds: number;
  scoreFactor: number;
  serviceScore: number;
  totalScore: number;
};

export type AssistantRankingRow = {
  assistantId: string;
  assistantName: string;
  avatar: string | null;
  score: number;
  completedCount: number;
  workSeconds: number;
  lastCompletedAtMs: number;
  details: AssistantRankingDetail[];
};

export type AreaTaskStats = {
  total: number;
  queued: number;
  assigned: number;
  executing: number;
  paused: number;
  completed: number;
  overtime: number;
};

export type AreaTaskTypeSummary = {
  name: string;
  count: number;
  color: string;
};

export type AreaCompletedTaskTypeSummary = AreaTaskTypeSummary & {
  assistants: { id: string; name: string; avatar: string | null; count: number }[];
};

export type WorkbenchAreaSummary = {
  taskStats: AreaTaskStats;
  publishedTaskTypes: AreaTaskTypeSummary[];
  completedTaskTypes: AreaCompletedTaskTypeSummary[];
  assistantRankingRows: AssistantRankingRow[];
};

export type AreaMetricKey = "executing" | "assigned" | "overtime" | "queue" | "offline";

export type AreaMetricBreakdown = {
  label: "任务超时" | "吃饭超时";
  count: number;
  unit: "项" | "人";
};

export type AreaMetricPerson = {
  id: string;
  name: string;
  avatar: string | null;
  count: number;
  queueSortIndex?: number;
  queueTaskTypes?: string[];
  breakdown?: AreaMetricBreakdown[];
};

export type AreaMetricBaseCard = {
  caption: string;
  value: number;
  span: string;
};

export type AreaMetricDetailCard = AreaMetricBaseCard & {
  detailKey: AreaMetricKey;
  people: AreaMetricPerson[];
  unit: string;
  emptyText: string;
  bubbleAnchorMode?: "card" | "value";
};

export type AreaMetricCard = AreaMetricBaseCard | AreaMetricDetailCard;

export type IroningWorkItem = {
  task: TaskFromAPI;
  assistantId: string;
  assistantName: string;
  assistantAvatar: string | null;
  slotKey?: string;
  elapsedMin: number;
  overtimeMin: number | null;
  remainingMin: number | null;
  durationLabel: string;
  elapsedLabel: string;
  taskLabel: string;
};

export type TaskPauseKind = "manual" | "interrupt";

export type DbCategory = {
  id: number;
  name: string;
  priorityLevel: number;
  minDuration: number;
  maxDuration: number;
};

export type BuiltCategoryDuration = {
  label: string;
  priority: string;
  cls: string;
  categoryId: number;
  sourceName?: string;
  priorityOverride?: number;
  quickBookSpecialType?: "external_model_follow";
};

export type BuiltCategorySpecialAction = BuiltCategoryDuration & {
  title: string;
  tone: "purple";
};

export type BuiltCategory = {
  name: string;
  bg: string;
  active: string;
  darkBg: string;
  darkActive: string;
  text: string;
  darkText: string;
  durations: BuiltCategoryDuration[];
  specialActions?: BuiltCategorySpecialAction[];
};

export type DockEntry = [number, { name: string; profiles: { id: string }[] }];
