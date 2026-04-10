"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AssistantDock from "./AssistantDock";
import type { DockAssistant } from "./AssistantDock";
import { effectiveWorkMinutesFromApi, totalEffectiveWorkSecondsFromApi } from "@/lib/taskEffectiveTime";

/** 格式化分钟数：<60显示X分钟，>=60显示X.X小时 */
function fmtMin(min: number): string {
  if (min < 60) return `${min}分钟`;
  const h = min / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}小时`;
}

type ExtraVenueEntry = { name: string; type?: string };

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

/** 有效执行时长（秒级展示，用于助理面板计时） */
function formatEffectiveDuration(task: TaskFromAPI, nowMs: number): string {
  const s = totalEffectiveWorkSecondsFromApi(task, nowMs);
  const em = Math.floor(s / 60);
  const es = Math.floor(s % 60);
  if (em < 60) return `${em}分${es.toString().padStart(2, "0")}秒`;
  return `${(em / 60).toFixed(1)}小时`;
}
import { STATUS as DOCK_STATUS } from "./AssistantDock";

type ThemeMode = "light" | "dark" | "auto";

type TaskFromAPI = {
  id: string;
  photographerId: string;
  assistantId: string | null;
  roomNumber: string;
  categoryId: number;
  priority: number;
  status: "waiting" | "executing" | "paused" | "completed";
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  estEndTime: string | null;
  effectiveWorkSeconds?: number | null;
  workSegmentStartedAt?: string | null;
  isLocked: boolean;
  parentTaskId: string | null;
  photographer: { id: string; name: string; currentRoom: string | null };
  assistant: { id: string; name: string; currentRoom: string | null } | null;
  category: { id: number; name: string; priorityLevel: number; estDuration?: number };
};

type DisplayTask = {
  id: string;
  name: string;
  room: string;
  time: string;
  timePeriod: string;
  /** 任务类型配置的预估时长（摄影师下发所选类别），与优先级档文案无关 */
  estimatedLabel: string;
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
  assigned:  { statusLabel: "待就位", statusCls: "bg-white/35 border-blue-200/50", tagCls: "bg-blue-100/60 text-blue-600", hasProgress: false },
  completed: { statusLabel: "已完成", statusCls: "bg-white/30 border-white/40", tagCls: "bg-green-100/60 text-green-600", hasProgress: false },
  paused:    { statusLabel: "已暂停", statusCls: "bg-white/25 border-yellow-200/40", tagCls: "bg-yellow-100/60 text-yellow-600", hasProgress: false },
};

// 任务状态排序权重：待就位 → 等待中 → 进行中 → 已完成 → 已取消/其他
const STATUS_ORDER: Record<string, number> = { "待就位": 0, "等待中": 1, "进行中": 2, "已完成": 3, "已取消": 4, "已暂停": 5 };
function sortTasksByStatus(tasks: DisplayTask[]): DisplayTask[] {
  return [...tasks].sort((a, b) => (STATUS_ORDER[a.statusLabel] ?? 99) - (STATUS_ORDER[b.statusLabel] ?? 99));
}

function resolveAssistantTasks(taskData: TaskFromAPI[]): { current: TaskFromAPI | null; paused: TaskFromAPI | null; pending: TaskFromAPI | null } {
  const executing = taskData.find((t) => t.status === "executing") || null;
  const paused = taskData.find((t) => t.status === "paused") || null;
  // waiting + parentTaskId = 插单待处理（pending）；waiting + no parentTaskId = 普通待就位
  const waitingWithParent = taskData.find((t) => t.status === "waiting" && t.assistantId && t.parentTaskId) || null;
  const waitingNormal = taskData.find((t) => t.status === "waiting" && t.assistantId && !t.parentTaskId) || null;

  if (executing && waitingWithParent) {
    // 旧任务执行中，新插单任务待处理
    return { current: executing, paused: null, pending: waitingWithParent };
  }
  if (paused && waitingWithParent) {
    // 旧任务已暂停，新插单任务待就位
    return { current: waitingWithParent, paused, pending: null };
  }
  if (paused && executing) {
    // 旧任务已暂停，新插单任务执行中
    return { current: executing, paused, pending: null };
  }
  // 普通单任务
  const current = executing || waitingNormal || waitingWithParent || null;
  return { current, paused, pending: null };
}

function apiTaskToDisplay(t: TaskFromAPI): DisplayTask {
  // 已分配助理但未开始 → 待就位
  const effectiveStatus = (t.status === "waiting" && t.assistantId) ? "assigned" : t.status;
  const style = STATUS_STYLE[effectiveStatus] || STATUS_STYLE.waiting;
  const PRIORITY_LABEL: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };
  const timePeriod = PRIORITY_LABEL[t.priority] || t.category?.name || "任务";
  const estMin = t.category?.estDuration;
  const estimatedLabel = estMin != null && estMin > 0 ? fmtMin(estMin) : "—";
  let time = "";
  let actualTime = "";
  let progress: number | null = null;
  if (t.status === "executing") {
    const elapsedMin = effectiveWorkMinutesFromApi(t);
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
  } else if (t.status === "completed" && t.startedAt && t.completedAt) {
    const used = effectiveWorkMinutesFromApi(t);
    time = `用时${fmtMin(used)}`;
    actualTime = fmtMin(used);
  } else if (t.status === "paused") {
    const elapsedMin = effectiveWorkMinutesFromApi(t);
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
    actualTime,
    progress,
    assistantName: t.assistant?.name || null,
    photographerName: t.photographer?.name || null,
    createdAt: t.createdAt,
    estEndTime: t.estEndTime,
    ...style,
  };
}

function isAssistantRole(role: string | undefined): boolean {
  return role === "assistant" || role === "assistant_leader";
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
  const [buildings, setBuildings] = useState<{ id: number; name: string; floorPlanUrl: string | null; cropX?: number | null; cropY?: number | null; cropW?: number | null; cropH?: number | null; extraVenues?: string | null; rooms: { id: number; roomNumber: string; xPosition: number; yPosition: number }[] }[]>([]);
  const [activeBuildingId, setActiveBuildingId] = useState<number | null>(null);
  const [assistants, setAssistants] = useState<DockAssistant[]>([]);
  const [genie, setGenie] = useState<{
    sx: number; sy: number; sw: number; sh: number;
    tx: number; ty: number; tw: number; th: number;
    label: string; priority: string; cls: string; catName: string; categoryId: number;
    phase: number;
  } | null>(null);
  const [enteringTaskId, setEnteringTaskId] = useState<string | null>(null);
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null);
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  // Current user profile
  const [profile, setProfile] = useState<{
    id: string; name: string; avatar: string | null; employeeId: string | null; role: string;
    currentRoom: string | null; department: string | null; group: string | null;
    buildingId: number; building: { id: number; name: string; extraVenues?: string | null };
    onlineStatus: string;
  } | null>(null);
  const [hoveredMapAssistant, setHoveredMapAssistant] = useState<string | null>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showVenueMenu, setShowVenueMenu] = useState(false);
  const originalRoomRef = useRef<string | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsHoveredDay, setStatsHoveredDay] = useState<number | null>(null);
  const [weeklyTasks, setWeeklyTasks] = useState<TaskFromAPI[]>([]);
  const [categories, setCategories] = useState<BuiltCategory[]>([]);
  const [endingAlertMin, setEndingAlertMin] = useState(2);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [identityBuildingFilter, setIdentityBuildingFilter] = useState<number | null>(null);
  const [identityBuildingOrder, setIdentityBuildingOrder] = useState<number[]>([]);
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string; role: string; employeeId: string | null; department: string | null; group: string | null; avatar: string | null; buildingId: number; onlineStatus: string; building: { id: number; name: string } }[]>([]);
  // 助理当前任务（原始 API 数据）
  const [currentRawTask, setCurrentRawTask] = useState<TaskFromAPI | null>(null);
  const [pausedRawTask, setPausedRawTask] = useState<TaskFromAPI | null>(null);
  const [pendingRawTask, setPendingRawTask] = useState<TaskFromAPI | null>(null);
  /** 助理视角下最近一次拉取到的原始任务列表（用于列表点击「待就位」与目标任务对齐） */
  const [assistantRawTasks, setAssistantRawTasks] = useState<TaskFromAPI[]>([]);
  const pendingRawTaskRef = useRef<TaskFromAPI | null>(null);
  useEffect(() => {
    pendingRawTaskRef.current = pendingRawTask;
  }, [pendingRawTask]);
  // 登录账号角色（区别于切换后的 profile.role）
  const [loginRole, setLoginRole] = useState<string | null>(null);

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
    ]).then(([profilesData, tasksData]) => {
      const profiles = Array.isArray(profilesData) ? profilesData : [];
      const allTasks = Array.isArray(tasksData) ? tasksData : [];

      // 每个助理收集：executing任务、paused任务、waiting插单任务（parentTaskId存在）
      type TaskInfo = {
        executingTask: typeof allTasks[0] | null;
        pausedTask: typeof allTasks[0] | null;
        waitingInterruptTask: typeof allTasks[0] | null; // 未暂停时的待处理插单
        resumingTask: typeof allTasks[0] | null; // 插单完成后恢复待就位
      };
      const infoMap = new Map<string, TaskInfo>();

      for (const t of allTasks) {
        if (!t.assistantId || !t.category) continue;
        if (!["executing", "paused", "waiting"].includes(t.status)) continue;
        if (!infoMap.has(t.assistantId)) {
          infoMap.set(t.assistantId, { executingTask: null, pausedTask: null, waitingInterruptTask: null, resumingTask: null });
        }
        const info = infoMap.get(t.assistantId)!;
        if (t.status === "executing") info.executingTask = t;
        else if (t.status === "paused") info.pausedTask = t;
        else if (t.status === "waiting" && t.parentTaskId) {
          // 区分：插单完成后恢复（之前是paused，现在变回waiting）vs 旧任务还在executing时的pending
          if (!info.executingTask) info.resumingTask = t; // 先放resuming，executing来了再调整
          else info.waitingInterruptTask = t; // 旧任务还在executing，新任务waiting = pending
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

      setAssistants(profiles.map((p: DockAssistant) => {
        const info = infoMap.get(p.id);
        if (!info) {
          return { ...p, status: "idle", currentTask: null, currentRoom: p.currentRoom, pausedRoom: null, pausedElapsedMin: 0, pausedTaskDesc: null, pausedTaskDetail: null, newTaskDesc: null, resumingFromPause: false, pendingRoom: null };
        }

        const { executingTask, pausedTask, waitingInterruptTask, resumingTask } = info;

        // 计算主任务状态和位置
        let finalStatus = "idle";
        let currentRoom = p.currentRoom;
        let pendingRoom: string | null = null;
        let pausedRoom: string | null = null;
        let pausedTaskDesc: string | null = null;
        let pausedTaskDetail: string | null = null;
        let pausedElapsedMin = 0;
        let newTaskDesc: string | null = null;
        let resumingFromPause = false;

        const buildDesc = (t: typeof allTasks[0]) => `${t.roomNumber}室 · ${t.category.name} · ${PRIORITY_DUR[t.priority] || ""}`;

        if (executingTask && waitingInterruptTask) {
          // 旧任务进行中 + 新插单待处理：主标记在旧任务（橙色进行中），蓝脉冲标记在新任务
          finalStatus = "executing";
          currentRoom = executingTask.roomNumber;
          pendingRoom = waitingInterruptTask.roomNumber;
          newTaskDesc = buildDesc(waitingInterruptTask);
        } else if (pausedTask && waitingInterruptTask) {
          // 阶段B：旧任务已暂停 + 新插单待就位
          // - 旧任务房间：只保留灰色头像（pausedMarker）
          // - 新任务房间：只显示蓝色脉冲点（mainMarker）
          finalStatus = "assigned";
          pausedRoom = pausedTask.roomNumber;
          currentRoom = waitingInterruptTask.roomNumber;

          const pe = effectiveWorkMinutesFromApi(pausedTask);
          pausedElapsedMin = pe;
          pausedTaskDesc = `${pausedTask.category.name} · 已进行${fmtMin(pe)}`;
          pausedTaskDetail = buildDesc(pausedTask);

          // 避免同时渲染 pendingMarker 与 mainMarker 的双蓝点
          pendingRoom = null;
          newTaskDesc = buildDesc(waitingInterruptTask);
        } else if (pausedTask && executingTask) {
          // 旧任务已暂停 + 新任务进行中：灰色标记在旧任务，橙色标记在新任务
          finalStatus = "executing";
          currentRoom = executingTask.roomNumber;
          pausedRoom = pausedTask.roomNumber;
          const pe = effectiveWorkMinutesFromApi(pausedTask);
          pausedElapsedMin = pe;
          pausedTaskDesc = `${pausedTask.category.name} · 已进行${fmtMin(pe)}`;
          pausedTaskDetail = buildDesc(pausedTask);
          const execElapsed = effectiveWorkMinutesFromApi(executingTask);
          newTaskDesc = `已前往${executingTask.roomNumber}室。进行${executingTask.category.name} · 进行中 · 已进行${fmtMin(execElapsed)}`;
        } else if (resumingTask) {
          // 插单完成，原任务恢复待就位
          finalStatus = "assigned";
          currentRoom = resumingTask.roomNumber;
          resumingFromPause = true;
        } else if (executingTask) {
          finalStatus = "executing";
          currentRoom = executingTask.roomNumber;
        } else if (pausedTask) {
          finalStatus = "busy";
          currentRoom = pausedTask.roomNumber;
        } else {
          // 仅有 waiting 任务（普通待就位）
          const waitTask = allTasks.find((t: typeof allTasks[0]) => t.assistantId === p.id && t.status === "waiting");
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
            : (executingTask || pausedTask);
        let currentTask: string | null = null;
        if (descTask) {
          const elapsed =
            descTask.status === "executing" || descTask.status === "paused"
              ? effectiveWorkMinutesFromApi(descTask)
              : 0;
          currentTask = elapsed > 0 ? `已进行${fmtMin(elapsed)}\n${buildDesc(descTask)}` : buildDesc(descTask);
        }

        return {
          ...p,
          status: finalStatus,
          currentTask,
          currentRoom,
          pausedRoom,
          pausedElapsedMin,
          pausedTaskDesc,
          pausedTaskDetail,
          newTaskDesc,
          resumingFromPause,
          pendingRoom,
        };
      }));
    }).catch(console.error);
  }, [activeBuildingId]);

  useEffect(() => {
    refreshAssistants();
  }, [refreshAssistants]);

  // 8秒轮询：用同一份任务数据同步所有视图
  useEffect(() => {
    if (!profile) return;
    const poll = () => {
      // 刷新助理数据（状态栏 + 地图标记）
      refreshAssistants();
      // 刷新当前用户的任务列表（复用 refreshAssistants 已请求的数据避免重复）
      const taskParam = isAssistantRole(profile.role) ? `assistantId=${profile.id}` : `photographerId=${profile.id}`;
      fetch(`/api/tasks?${taskParam}&todayOnly=true`, { cache: "no-store" })
        .then((r) => r.json())
        .then((taskData) => {
          if (Array.isArray(taskData)) {
            setTasks(sortTasksByStatus(taskData.map(apiTaskToDisplay)));
            if (isAssistantRole(profile.role)) {
              const raw = taskData as TaskFromAPI[];
              setAssistantRawTasks(raw);
              const { current: active, paused, pending } = resolveAssistantTasks(raw);
              setCurrentRawTask(active);
              setPausedRawTask(paused);
              setPendingRawTask(pending);
              // 同步位置：有活跃任务则跟随任务位置
              if (active && active.roomNumber !== profile.currentRoom) {
                setProfile((p) => p ? { ...p, currentRoom: active.roomNumber } : p);
              }
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
  }, [profile, refreshAssistants]);

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
            setProfile(selected);
            originalRoomRef.current = selected.currentRoom;
            setActiveBuildingId(selected.buildingId);
            // Fetch tasks for this profile
            const taskParam = isAssistantRole(selected.role) ? `assistantId=${selected.id}` : `photographerId=${selected.id}`;
            fetch(`/api/tasks?${taskParam}&todayOnly=true`)
              .then((r) => r.json())
              .then((taskData) => {
                if (Array.isArray(taskData)) {
                  setTasks(sortTasksByStatus(taskData.map(apiTaskToDisplay)));
                  if (isAssistantRole(selected.role)) {
                    const raw = taskData as TaskFromAPI[];
                    setAssistantRawTasks(raw);
                    const { current: active, paused, pending } = resolveAssistantTasks(raw);
                    setCurrentRawTask(active);
                    setPausedRawTask(paused);
                    setPendingRawTask(pending);
                  } else {
                    setAssistantRawTasks([]);
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

    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCategories(buildCategories(data));
        }
      })
      .catch(console.error);

    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg?.ending_alert_min?.value) {
          setEndingAlertMin(Number(cfg.ending_alert_min.value) || 2);
        }
      })
      .catch(console.error);
  }, []);

  const activeBuilding = buildings.find((b) => b.id === activeBuildingId) || null;

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
    // 助理切换位置：持久化到服务器，触发自动排单
    if (isAssistantRole(profile.role)) {
      try {
        const res = await fetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentRoom: venue }),
        });
        if (res.ok) {
          const updated = await res.json();
          setProfile((p) => p ? { ...p, currentRoom: updated.currentRoom } : p);
        }
        // 触发全局扫描自动派单
        await fetch("/api/tasks/sweep", { method: "POST" }).catch(() => {});
        // 刷新助理列表
        refreshAssistants();
      } catch (err) {
        console.error("Failed to switch venue for assistant", err);
      }
    }
  }, [profile, refreshAssistants]);

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
    // 乐观更新本地
    setAllProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, buildingId: newBuildingId, building: { id: bld.id, name: bld.name } } : p));
    try {
      await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: newBuildingId }),
      });
      refreshAssistants();
    } catch (e) {
      console.error("Failed to update building", e);
    }
  }, [buildings, refreshAssistants]);

  // 助理：手动暂停当前任务（插单场景）
  const handlePauseCurrentTask = useCallback(async () => {
    if (!currentRawTask || !profile) return;
    try {
      await fetch(`/api/tasks/${currentRawTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });

      // 乐观更新：暂停成功后，旧任务房间立即显示灰头像
      //（避免等下一轮 refreshAssistants/轮询才变化）
      setAssistants((prev) => prev.map((a) => {
        if (a.id !== profile.id) return a;
        const pending = pendingRawTaskRef.current;
        const nextRoom = pending?.roomNumber || a.currentRoom;
        return {
          ...a,
          status: "assigned",
          pausedRoom: currentRawTask.roomNumber,
          pendingRoom: null,
          currentRoom: nextRoom,
          // 暂停阶段不应显示“恢复待就位”的样式；等插单完成后由后端状态驱动进入 resumingFromPause
          resumingFromPause: false,
          newTaskDesc: pending
            ? `${pending.roomNumber}室 · ${pending.category.name} · ${PRIORITY_DUR[pending.priority] || ""}`
            : a.newTaskDesc,
        };
      }));

      const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`);
      const taskData = await taskRes.json();
      if (Array.isArray(taskData)) {
        const raw = taskData as TaskFromAPI[];
        setAssistantRawTasks(raw);
        setTasks(sortTasksByStatus(taskData.map(apiTaskToDisplay)));
        const { current: active, paused, pending } = resolveAssistantTasks(raw);
        setCurrentRawTask(active);
        setPausedRawTask(paused);
        setPendingRawTask(pending);
      }
      refreshAssistants();
    } catch (e) {
      console.error("Failed to pause task", e);
    }
  }, [currentRawTask, profile, refreshAssistants]);

  // 助理：切换任务状态（targetTask 优先，避免界面展示任务与 currentRawTask 短暂不一致时点击无效）
  const handleAssistantStatusChange = useCallback(async (action: "start" | "complete", targetTask?: TaskFromAPI | null) => {
    const task = targetTask ?? currentRawTask;
    if (!task) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("任务状态更新失败", res.status, errText);
        return;
      }
      // 开始任务时，将助理位置同步为任务所在房间
      if (action === "start" && profile) {
        const taskRoom = task.roomNumber;
        setProfile((p) => p ? { ...p, currentRoom: taskRoom } : p);
        fetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentRoom: taskRoom }),
        }).catch(console.error);
      }
      // 完成任务时，检查下一个待就位任务并同步位置，若无任务则恢复原始房间
      if (action === "complete" && profile) {
        const taskRes = await fetch(`/api/tasks?assistantId=${profile.id}&todayOnly=true`);
        const taskData = await taskRes.json();
        if (Array.isArray(taskData)) {
          const raw = taskData as TaskFromAPI[];
          setAssistantRawTasks(raw);
          setTasks(sortTasksByStatus(taskData.map(apiTaskToDisplay)));
          const { current: next, paused, pending } = resolveAssistantTasks(raw);
          setCurrentRawTask(next);
          setPausedRawTask(paused);
          setPendingRawTask(pending);
          const nextRoom = next ? next.roomNumber : originalRoomRef.current;
          if (nextRoom) {
            setProfile((p) => p ? { ...p, currentRoom: nextRoom } : p);
            fetch(`/api/profiles/${profile.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ currentRoom: nextRoom }),
            }).catch(console.error);
          }
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
          setAssistantRawTasks(raw);
          setTasks(sortTasksByStatus(taskData.map(apiTaskToDisplay)));
          const { current: active, paused, pending } = resolveAssistantTasks(raw);
          setCurrentRawTask(active);
          setPausedRawTask(paused);
          setPendingRawTask(pending);
        }
        refreshAssistants();
      }
    } catch (e) {
      console.error("Failed to update task status", e);
    }
  }, [currentRawTask, profile, refreshAssistants]);

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
        // 任务地点就是摄影师当前所在的房间
        const room = profile?.currentRoom || "418";
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
        taskListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => setEnteringTaskId(null), 600);
        // Persist to API
        if (profile) {
          try {
            const res = await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ photographerId: profile.id, roomNumber: room, categoryId, priority: parseInt(genie.priority.replace("P", "")) }),
            });
            if (res.ok) {
              const saved = await res.json();
              setTasks((prev) => sortTasksByStatus(prev.map((t) => t.id === tempId ? apiTaskToDisplay(saved) : t)));
              refreshAssistants();
            }
          } catch (e) {
            console.error("Failed to create task", e);
          }
        }
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [genie, activeBuilding, refreshAssistants]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
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
              style={{ filter: `brightness(var(--map-brightness))` }}
              onLoad={handleFloorPlanLoad}
            />
            {/* 助理地图标记 */}
            {(() => {
              // 允许同一助理同时在多个坐标出现标记：
              // - currentRoom: 主标记（进行中头像 / 待就位蓝点 / 恢复待就位头像）
              // - pausedRoom:  暂停中的原任务灰头像
              // - pendingRoom: 执行中时的插单待处理蓝脉冲点
              // 注意：不能只用 currentRoom 过滤，否则 pausedRoom 会被误删
              const visible = assistants.filter((a) =>
                (a.currentRoom || a.pausedRoom || a.pendingRoom)
                && (
                  a.status === "assigned"
                  || a.status === "executing"
                  || a.resumingFromPause
                  || !!a.pausedRoom
                  || !!a.pendingRoom
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
              // 计算同房间内的索引，用于水平偏移防重叠
              const roomCount = new Map<string, number>();
              const roomIdx = new Map<string, number>();
              for (const a of visible) {
                if (!a.currentRoom) continue;
                const r = a.currentRoom;
                roomIdx.set(a.id, roomCount.get(r) || 0);
                roomCount.set(r, (roomCount.get(r) || 0) + 1);
              }
              return visible.flatMap((a) => {
              // 额外：插单进行中时，旧房间显示灰色头像（即使当前房间坐标缺失也要显示）
              const pausedMarker = a.pausedRoom ? (() => {
                const pRoom = activeBuilding.rooms.find((r) => r.roomNumber === a.pausedRoom);
                const pVenuePos = !pRoom ? venueCoords.get(a.pausedRoom!) : undefined;
                const pX = pRoom?.xPosition ?? pVenuePos?.x;
                const pY = pRoom?.yPosition ?? pVenuePos?.y;
                if (pX === undefined || pY === undefined) return null;
                return (
                  <div
                    key={`${a.id}-paused`}
                    className="absolute"
                    style={{ left: `${pX}%`, top: `${pY}%`, transform: "translate(-50%, -50%)", zIndex: 8 }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-paused`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative w-[26px] h-[26px]">
                      <div className="w-full h-full rounded-full overflow-hidden border-[2px] border-gray-400 shadow-sm" style={{ filter: "grayscale(1)" }}>
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-white text-[8px] font-bold">{a.name[0]}</div>
                        )}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-gray-400 border border-white" />
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
                return (
                  <div
                    key={`${a.id}-pending`}
                    className="absolute"
                    style={{ left: `${px}%`, top: `${py}%`, transform: "translate(-50%, -50%)", zIndex: 9 }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredMapAssistant(`${a.id}-pending`); }}
                    onMouseLeave={() => setHoveredMapAssistant(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="relative w-5 h-5 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-blue-500/30 animate-ping" />
                      <div className="absolute inset-0.5 rounded-full bg-blue-500/20 animate-pulse" />
                      <div className="w-2 h-2 rounded-full bg-blue-500 relative z-10" />
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
                return [pausedMarker, pendingMarker].filter(Boolean);
              }

              const isAssigned = a.status === "assigned";
              const isHovered = hoveredMapAssistant === a.id;
              const idx = roomIdx.get(a.id) || 0;
              const total = roomCount.get(a.currentRoom!) || 1;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 22 : 0;

              const mainMarker = (
                <div
                  key={a.id}
                  className="absolute overflow-visible"
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    transform: `translate(calc(-50% + ${offset}px), -50%) scale(${isHovered ? 1.35 : 1})`,
                    zIndex: isHovered ? 50 : 10 + idx,
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
                      <div className="relative z-[1] h-[26px] w-[26px] overflow-hidden rounded-full border-[2px] border-blue-400 shadow-sm">
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-[8px] font-bold text-white">{a.name[0]}</div>
                        )}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 z-10 h-2 w-2 rounded-full border border-white bg-blue-500" />
                    </div>
                  ) : (
                    <div className="relative h-[26px] w-[26px]">
                      <div className="w-full h-full rounded-full overflow-hidden border-[2px] border-orange-500 shadow-sm">
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-orange-200 to-orange-400 flex items-center justify-center text-white text-[8px] font-bold">{a.name[0]}</div>
                        )}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500 border border-white" />
                    </div>
                  )}
                  {/* Tooltip — hover 显示所有任务 */}
                  {isHovered && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none whitespace-nowrap z-50">
                      <div className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl shadow-lg border border-gray-100 text-center">
                        {(() => {
                          const waitingOnMap = isAssigned || a.resumingFromPause;
                          const statusColor = waitingOnMap ? "text-blue-600" : "text-orange-600";
                          const statusLabel = waitingOnMap ? "待就位" : "进行中";
                          // Parse currentTask: each task block separated by "---", each block has optional elapsed line + detail line
                          const tasks = a.currentTask ? a.currentTask.split("\n---\n") : [];
                          if (tasks.length === 0) {
                            return (
                              <>
                                <p className={`text-xs font-semibold ${statusColor}`}>{a.name} · {statusLabel}</p>
                                <p className="text-[10px] text-[--text-muted] mt-0.5">{a.currentRoom ? `${a.currentRoom}室` : "—"}</p>
                              </>
                            );
                          }
                          return tasks.map((block, i) => {
                            const lines = block.split("\n");
                            const hasElapsed = lines.length > 1;
                            const elapsedText = hasElapsed ? ` · ${lines[0]}` : "";
                            const detail = hasElapsed ? lines[1] : lines[0];
                            return (
                              <div key={i} className={i > 0 ? "mt-2 pt-2 border-t border-gray-100" : ""}>
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
                              return [
                                <div key="paused-info" className="mt-2 pt-2 border-t border-gray-100">
                                  <p className={`text-xs font-semibold ${statusColor}`}>{locationAndType}（暂停中）</p>
                                  <p className="text-[10px] text-[--text-muted] mt-0.5">{timeRange}{timeRange ? " · " : ""}已进行{fmtMin(a.pausedElapsedMin)}</p>
                                </div>
                              ];
                            })() : []
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
              return [pausedMarker, pendingMarker, mainMarker].filter(Boolean);
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
      </div>


      {/* ====== UI OVERLAYS ====== */}
      <div onMouseDown={(e) => e.stopPropagation()}>
        {/* 左侧三面板 */}
        <div className="absolute top-3 left-3 bottom-3 z-20 w-[250px] flex flex-col gap-2">
          {/* 面板1：摄影师信息 + 位置 + 天气 + 时间 */}
          <div className={`rounded-2xl px-4 py-3.5 ${glass}`}>
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
                const venueNames = safeExtraVenueEntries(profile?.building?.extraVenues).map((e) => e.name);
                const origRoom = originalRoomRef.current;
                const isAtOriginal = profile?.currentRoom === origRoom;
                // 过滤掉当前所在位置后是否还有可选项
                const available = venueNames.filter((n) => n !== profile?.currentRoom);
                const hasOrigOption = !isAtOriginal && origRoom;
                if (available.length > 0 || hasOrigOption) setShowVenueMenu(true);
              }}
              onMouseLeave={() => setShowVenueMenu(false)}
            >
              <button
                className="flex items-center gap-1.5 text-[13px] font-semibold text-orange-500 hover:text-orange-600 transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
                <span>{profile?.building?.name || "—"} {profile?.currentRoom ? (profile.currentRoom === originalRoomRef.current ? `${profile.currentRoom}室` : profile.currentRoom) : ""}</span>
              </button>
              {/* 透明桥接区域 + 向右弹出额外场地 */}
              {(() => {
                const extraVenues = safeExtraVenueEntries(profile?.building?.extraVenues);
                // 判断当前是否在原始房间
                const origRoom = originalRoomRef.current;
                const isAtOriginal = profile?.currentRoom === origRoom;
                // 构建选项列表：额外场地 + 若不在原始房间则加入原始房间选项，过滤掉当前所在位置
                const allOptions: { name: string; type?: string; isOriginal?: boolean }[] = [
                  ...extraVenues,
                  ...(!isAtOriginal && origRoom ? [{ name: `${origRoom}室`, type: undefined, isOriginal: true }] : []),
                ];
                const venues = allOptions.filter((v) => {
                  const venueName = v.isOriginal ? origRoom! : v.name;
                  return venueName !== profile?.currentRoom;
                });
                if (venues.length === 0) return null;
                return (
                  <>
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: "100%",
                        width: "24px",
                        pointerEvents: showVenueMenu ? "auto" : "none",
                      }}
                    />
                    <div
                      className="absolute flex flex-col gap-1 items-center"
                      style={{
                        left: "calc(100% + 24px)",
                        top: "50%",
                        transform: showVenueMenu ? "translateX(0) translateY(-50%)" : "translateX(-16px) translateY(-50%)",
                        opacity: showVenueMenu ? 1 : 0,
                        transition: "opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        pointerEvents: showVenueMenu ? "auto" : "none",
                      }}
                    >
                      <span className="text-[11px] text-gray-500 font-bold whitespace-nowrap text-center w-full">切换位置</span>
                      {venues.map((venue) => {
                        const isWhiteBg = venue.isOriginal || venue.type === "无影棚" || (!venue.type && (venue.name.includes("无影") || venue.name.includes("白棚")));
                        return (
                          <button
                            key={venue.name}
                            onClick={() => switchVenue(venue.isOriginal ? origRoom! : venue.name)}
                            className={`px-3 py-1 rounded-md active:scale-95 transition-all flex items-center justify-center shadow whitespace-nowrap text-[10px] font-bold ${
                              isWhiteBg
                                ? "bg-white text-blue-500 border border-blue-400 hover:bg-blue-50"
                                : "bg-blue-500 text-white hover:brightness-110"
                            }`}
                          >
                            {venue.name}
                          </button>
                        );
                      })}
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
            <div className={`rounded-2xl px-4 py-3.5 flex-1 min-h-0 flex flex-col ${glass}`}>
              <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide mb-2.5">当前任务状态</h3>
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2">
                {(() => {
                  const PRIORITY_DUR: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30-60分钟", 5: "1小时以上" };

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
                  const renderPausedBlock = (task: TaskFromAPI, flex: number) => {
                    const leftMs = task.pausedAt
                      ? now.getTime() - new Date(task.pausedAt).getTime()
                      : 0;
                    const leftMin = Math.floor(leftMs / 60000);
                    const leftSec = Math.floor((leftMs % 60000) / 1000);
                    const leftText = leftMin < 60 ? `${leftMin}分${leftSec.toString().padStart(2, "0")}秒` : `${(leftMin / 60).toFixed(1)}小时`;
                    return (
                      <div key={task.id} className="w-full rounded-xl bg-gray-400/15 flex flex-col items-center justify-center gap-1.5 py-3" style={{ flex }}>
                        <div className="w-8 h-8 rounded-full bg-gray-400/20 flex items-center justify-center">
                          <div className="w-4 h-4 rounded-full bg-gray-400" />
                        </div>
                        <span className="text-[13px] font-extrabold text-gray-500">{task.category?.name ?? "任务"}（暂停中）</span>
                        <div className="text-[10px] text-gray-400 text-center space-y-0.5">
                          <p>{task.roomNumber}室 · {task.photographer?.name ?? "—"}</p>
                          <p>已离开 {leftText}</p>
                        </div>
                      </div>
                    );
                  };

                  // 渲染执行中任务区块（点击暂停，有插单任务时）
                  const renderExecutingWithPause = (task: TaskFromAPI, flex: number) => {
                    const effText = formatEffectiveDuration(task, now.getTime());
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={handlePauseCurrentTask}
                        className="w-full rounded-xl bg-orange-400/20 hover:bg-orange-400/30 flex flex-col items-center justify-center gap-2 py-3 cursor-pointer transition-colors active:scale-[0.98] relative overflow-hidden"
                        style={{ flex }}
                      >
                        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                          <div className="w-4 h-4 rounded-full bg-orange-500 animate-pulse" />
                        </div>
                        <span className="text-[13px] font-extrabold text-orange-600">{task.category?.name ?? "任务"}（点击暂停）</span>
                        <div className="text-[10px] text-orange-600/70 text-center space-y-0.5">
                          <p>{task.roomNumber}室 · {task.photographer?.name ?? "—"}</p>
                          <p>{effText}</p>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden">
                          <div className="h-full w-[200%] bg-gradient-to-r from-orange-400 to-orange-500 from-orange-400 animate-[shimmer_2s_linear_infinite]" />
                        </div>
                      </button>
                    );
                  };

                  // 渲染待就位任务区块（只显示信息，无按钮）
                  const renderPendingBlock = (task: TaskFromAPI, flex: number) => (
                    <div key={task.id} className="w-full rounded-xl bg-blue-400/10 flex flex-col items-center justify-center gap-1.5 py-3" style={{ flex }}>
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-blue-400" />
                      </div>
                      <span className="text-[13px] font-extrabold text-blue-600">紧急任务待处理</span>
                      <div className="text-[10px] text-blue-600/70 text-center space-y-0.5">
                        <p>{task.roomNumber}室 · {task.photographer?.name ?? "—"}</p>
                        <p>{task.category?.name ?? "任务"} · {PRIORITY_DUR[task.priority] || ""}</p>
                        <p className="text-[9px] text-blue-500/90 font-semibold pt-0.5">请先在上方点击「点击暂停」结束当前进行中的任务，再开始本单</p>
                      </div>
                    </div>
                  );

                  // 渲染单个任务区块（正常流程）
                  const renderTaskBlock = (task: TaskFromAPI, flex: number) => {
                    if (task.status === "paused") return renderPausedBlock(task, flex);
                    if (task.status === "waiting") {
                      return (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => handleAssistantStatusChange("start", task)}
                          className="w-full rounded-xl bg-blue-400/20 hover:bg-blue-400/30 flex flex-col items-center justify-center gap-2 py-4 cursor-pointer transition-colors active:scale-[0.98]"
                          style={{ flex }}
                        >
                          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-blue-500" />
                          </div>
                          <span className="text-[16px] font-extrabold text-blue-600">点击开始任务</span>
                          <div className="text-[11px] text-blue-600/70 text-center space-y-0.5">
                            <p>{task.roomNumber}室 · {task.photographer?.name ?? "—"}</p>
                            <p>{task.category?.name ?? "任务"} · {PRIORITY_DUR[task.priority] || ""} · 待就位</p>
                          </div>
                        </button>
                      );
                    }
                    if (task.status === "executing") {
                      const isLocked = task.isLocked;
                      const bgCls = isLocked ? "bg-red-400/20 hover:bg-red-400/30" : "bg-orange-400/20 hover:bg-orange-400/30";
                      const dotBg = isLocked ? "bg-red-500/20" : "bg-orange-500/20";
                      const dotColor = isLocked ? "bg-red-500" : "bg-orange-500";
                      const textColor = isLocked ? "text-red-600" : "text-orange-600";
                      const subColor = isLocked ? "text-red-600/70" : "text-orange-600/70";
                      const barFrom = isLocked ? "from-red-400" : "from-orange-400";
                      const barTo = isLocked ? "to-red-500" : "to-orange-500";
                      const effText = formatEffectiveDuration(task, now.getTime());
                      return (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => handleAssistantStatusChange("complete", task)}
                          className={`w-full rounded-xl ${bgCls} flex flex-col items-center justify-center gap-2 py-4 cursor-pointer transition-colors active:scale-[0.98] relative overflow-hidden`}
                          style={{ flex }}
                        >
                          <div className={`w-10 h-10 rounded-full ${dotBg} flex items-center justify-center`}>
                            <div className={`w-5 h-5 rounded-full ${dotColor} animate-pulse`} />
                          </div>
                          <span className={`text-[16px] font-extrabold ${textColor}`}>点击完成任务</span>
                          <div className={`text-[11px] ${subColor} text-center space-y-0.5`}>
                            <p>{task.roomNumber}室 · {task.photographer?.name ?? "—"}</p>
                            <p>{task.category?.name ?? "任务"} · {effText}</p>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden">
                            <div className={`h-full w-[200%] bg-gradient-to-r ${barFrom} ${barTo} ${barFrom} animate-[shimmer_2s_linear_infinite]`} />
                          </div>
                        </button>
                      );
                    }
                    return null;
                  };

                  // 场景1：执行中 + 待处理插单 → 50/50（上方点击暂停，下方显示插单信息）
                  if (currentRawTask?.status === "executing" && pendingRawTask) {
                    return (
                      <>
                        {renderExecutingWithPause(currentRawTask, 1)}
                        {renderPendingBlock(pendingRawTask, 1)}
                      </>
                    );
                  }

                  // 场景2：已暂停 + 待就位插单 → 1/3 + 2/3
                  if (pausedRawTask && currentRawTask?.status === "waiting") {
                    return (
                      <>
                        {renderPausedBlock(pausedRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </>
                    );
                  }

                  // 场景3：已暂停 + 执行中 → 1/3 + 2/3
                  if (pausedRawTask && currentRawTask) {
                    return (
                      <>
                        {renderPausedBlock(pausedRawTask, 1)}
                        {renderTaskBlock(currentRawTask, 2)}
                      </>
                    );
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
          <div className={`rounded-2xl px-4 py-3.5 flex-1 min-h-0 flex flex-col overflow-hidden ${glass}`}>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[12px] font-bold text-[--text-primary] tracking-wide">我的任务</h3>
              <button onClick={() => setShowStatsModal(true)} className="text-[10px] text-orange-500 font-semibold hover:text-orange-600 cursor-pointer">更多数据 →</button>
            </div>
            <div ref={taskListRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden task-scroll" style={{ paddingRight: 18 }}>
              <div className="space-y-1.5">
                {tasks.map((task) => {
                  const isRemoving = removingTaskId === task.id;
                  const isCancellable = task.statusLabel === "等待中" || task.statusLabel === "待就位";
                  const showCancel = isCancellable && hoveredTagId === task.id && !isRemoving;
                  const isEndingSoon = task.statusLabel === "进行中" && task.estEndTime
                    ? (() => { const diff = (new Date(task.estEndTime).getTime() - Date.now()) / 60000; return diff > 0 && diff <= endingAlertMin; })()
                    : false;
                  return (
                    <div
                      key={task.id}
                      onClick={() => {
                        if (!isAssistantRole(profile?.role) || task.statusLabel !== "待就位") return;
                        const raw = assistantRawTasks.find((t) => t.id === task.id);
                        if (raw?.status === "waiting" && raw.assistantId) {
                          void handleAssistantStatusChange("start", raw);
                        }
                      }}
                      className={`px-3 py-2 rounded-xl border cursor-pointer ${task.statusCls}${
                        enteringTaskId === task.id ? " task-genie-enter" : ""
                      }${isRemoving ? " task-slide-out" : ""}`}
                      style={{ transition: isRemoving ? "none" : "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s" }}
                      onMouseEnter={(e) => {
                        if (!isRemoving) {
                          (e.currentTarget as HTMLElement).style.transform = "translateX(4px) scale(1.02)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isRemoving) {
                          (e.currentTarget as HTMLElement).style.transform = "translateX(0) scale(1)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "none";
                        }
                        setHoveredTagId(null);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-[--text-primary]">
                          {task.name}
                          <span className="text-[10px] text-[--text-muted] font-normal ml-1.5">{task.estimatedLabel}</span>
                          {isEndingSoon && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-500 animate-pulse">快结束</span>
                          )}
                        </span>
                        <span
                          className={`text-[8px] font-bold px-1.5 py-0.5 rounded transition-all duration-150 ${
                            showCancel
                              ? "bg-red-100/80 text-red-500 cursor-pointer hover:bg-red-200/80 scale-105"
                              : task.tagCls
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
                          {showCancel ? "取消" : task.statusLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-[--text-muted]">
                          {task.room}室
                          {isAssistantRole(profile?.role)
                            ? task.photographerName ? ` · ${task.photographerName}` : ""
                            : task.assistantName ? ` · ${task.assistantName}` : ""
                          }
                        </span>
                        {task.actualTime && <span className="text-[10px] text-[--text-muted]">{task.actualTime}</span>}
                      </div>
                      {task.progress != null && (
                        <div className="mt-1 h-0.5 rounded-full bg-black/[0.04] overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500" style={{ width: `${task.progress}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 顶部：区域切换 — 居中于任务面板右侧与助理列表左侧之间 */}
        <div className="absolute top-3 z-20 flex justify-center" style={{ left: 268, right: 76 }}>
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
          style={{ left: 268, right: 76 }}
        >
          <div className={`flex items-center gap-5 px-5 py-2.5 rounded-2xl ${resolvedTheme === "dark" ? glass : ""}`}>
          {[
            { label: "空闲", color: "bg-green-500" },
            { label: "待就位", color: "bg-blue-500" },
            { label: "在忙", color: "bg-orange-300" },
            { label: "进行中", color: "bg-orange-500" },
            { label: "快结束", color: "bg-green-300" },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-xs text-[--text-secondary]">
              <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
              {l.label}
            </span>
          ))}
          </div>
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
                if (!buildingMap.has(p.buildingId)) {
                  buildingMap.set(p.buildingId, { name: p.building.name, profiles: [] });
                }
                buildingMap.get(p.buildingId)!.profiles.push(p);
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
              const activeBld = identityBuildingFilter ?? profile?.buildingId ?? orderedEntries[0]?.[0] ?? null;
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
                              const otherBuildings = buildings.filter((b) => b.id !== p.buildingId);
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
                                      const st = a ? (DOCK_STATUS[a.status] || DOCK_STATUS.idle) : null;
                                      return st ? (
                                        <span
                                          className="absolute bottom-0 right-0 rounded-full"
                                          style={{ width: 8, height: 8, backgroundColor: st.color, boxShadow: "0 0 0 1.5px white" }}
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
                                          title={p.building.name}
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
            className="bg-white/90 backdrop-blur-2xl rounded-2xl shadow-2xl w-[720px] max-h-[85vh] overflow-y-auto p-5"
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
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <h3 className="text-[11px] font-bold text-[--text-primary] px-4 pt-3 pb-1">今日任务明细</h3>
              <div className="flex items-center text-[9px] text-[--text-muted] font-semibold px-4 py-1.5 bg-gray-50/60">
                <span className="w-[12%]">日期</span>
                <span className="w-[10%]">房间</span>
                <span className="w-[14%]">{isAssistantRole(profile?.role) ? "摄影师" : "助理"}</span>
                <span className="w-[16%]">类型</span>
                <span className="w-[16%]">预估时间</span>
                <span className="w-[14%]">实际用时</span>
                <span className="w-[10%]">状态</span>
              </div>
              {tasks.length === 0 ? (
                <div className="text-center py-6 text-[--text-muted] text-xs">暂无任务</div>
              ) : (
                tasks.map((t) => {
                  const d = new Date(t.createdAt);
                  const shortDate = `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
                  return (
                    <div key={t.id} className="flex items-center text-[10px] px-4 py-2 border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <span className="w-[12%] text-[--text-muted] tabular-nums">{shortDate}</span>
                      <span className="w-[10%] text-[--text-muted]">{t.room}室</span>
                      <span className="w-[14%] font-medium text-[--text-primary]">{isAssistantRole(profile?.role) ? (t.photographerName || "—") : (t.assistantName || "—")}</span>
                      <span className="w-[16%] text-[--text-primary]">{t.name}</span>
                      <span className="w-[16%] text-[--text-muted]">{t.estimatedLabel}</span>
                      <span className="w-[14%] text-[--text-muted]">{t.statusLabel === "已完成" ? t.actualTime || "—" : "—"}</span>
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${t.tagCls}`}>{t.statusLabel}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <AssistantDock assistants={assistants} />
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
