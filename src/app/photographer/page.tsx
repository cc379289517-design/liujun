"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AssistantDock from "./AssistantDock";
import type { DockAssistant } from "./AssistantDock";

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
  estEndTime: string | null;
  photographer: { id: string; name: string; currentRoom: string | null };
  assistant: { id: string; name: string; currentRoom: string | null } | null;
  category: { id: number; name: string; priorityLevel: number };
};

type DisplayTask = {
  id: string;
  name: string;
  room: string;
  time: string;
  progress: number | null;
  statusLabel: string;
  statusCls: string;
  tagCls: string;
  hasProgress: boolean;
  assistantName: string | null;
};

const STATUS_STYLE: Record<string, { statusLabel: string; statusCls: string; tagCls: string; hasProgress: boolean }> = {
  executing: { statusLabel: "进行中", statusCls: "bg-white/40 border-orange-200/50", tagCls: "bg-orange-100/60 text-orange-600", hasProgress: true },
  waiting:   { statusLabel: "等待中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/60 text-gray-500", hasProgress: false },
  assigned:  { statusLabel: "待就位", statusCls: "bg-white/35 border-blue-200/50", tagCls: "bg-blue-100/60 text-blue-600", hasProgress: false },
  completed: { statusLabel: "已完成", statusCls: "bg-white/30 border-white/40", tagCls: "bg-green-100/60 text-green-600", hasProgress: false },
  paused:    { statusLabel: "已暂停", statusCls: "bg-white/25 border-yellow-200/40", tagCls: "bg-yellow-100/60 text-yellow-600", hasProgress: false },
};

function apiTaskToDisplay(t: TaskFromAPI): DisplayTask {
  // 已分配助理但未开始 → 待就位
  const effectiveStatus = (t.status === "waiting" && t.assistantId) ? "assigned" : t.status;
  const style = STATUS_STYLE[effectiveStatus] || STATUS_STYLE.waiting;
  let time = "";
  let progress: number | null = null;
  if (t.status === "executing" && t.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 60000);
    const est = t.estEndTime ? Math.floor((new Date(t.estEndTime).getTime() - new Date(t.startedAt).getTime()) / 60000) : null;
    time = est ? `已执行${elapsed}分/${est}分` : `已执行${elapsed}分钟`;
    progress = est ? Math.min(100, Math.round((elapsed / est) * 100)) : null;
  } else if (t.status === "completed" && t.startedAt && t.completedAt) {
    const used = Math.floor((new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / 60000);
    time = `用时${used}分钟`;
  } else if (t.status === "paused" && t.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 60000);
    time = `已执行${elapsed}分钟(暂停)`;
  } else {
    // 等待中/待就位：显示预约时间段
    const PRIORITY_LABEL: Record<number, string> = { 1: "1-5分钟", 2: "5-20分钟", 3: "30分钟以内", 4: "30分钟以上" };
    time = PRIORITY_LABEL[t.priority] || t.category.name;
  }
  return {
    id: t.id,
    name: t.category.name,
    room: t.roomNumber,
    time,
    progress,
    assistantName: t.assistant?.name || null,
    ...style,
  };
}

function getAutoTheme(): "light" | "dark" {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "light" : "dark";
}

const glass =
  "bg-white/25 backdrop-blur-xl border border-white/30 shadow-lg shadow-black/[0.03]";

const categories = [
  {
    name: "手持",
    bg: "bg-red-400/20", active: "bg-red-400/35",
    darkBg: "bg-red-500/25", darkActive: "bg-red-500/40",
    text: "text-red-700", darkText: "text-red-300",
    durations: [
      { label: "1-5分钟", priority: "P1", cls: "bg-red-500 text-white" },
      { label: "5-20分钟", priority: "P2", cls: "bg-orange-500 text-white" },
      { label: "30分钟以内", priority: "P3", cls: "bg-amber-500 text-white" },
      { label: "30分钟以上", priority: "P4", cls: "bg-blue-500 text-white" },
    ],
  },
  {
    name: "穿戴对角度",
    bg: "bg-orange-400/20", active: "bg-orange-400/35",
    darkBg: "bg-orange-500/25", darkActive: "bg-orange-500/40",
    text: "text-orange-700", darkText: "text-orange-300",
    durations: [
      { label: "1-5分钟", priority: "P1", cls: "bg-red-500 text-white" },
      { label: "5-20分钟", priority: "P2", cls: "bg-orange-500 text-white" },
      { label: "30分钟以内", priority: "P3", cls: "bg-amber-500 text-white" },
      { label: "30分钟以上", priority: "P4", cls: "bg-blue-500 text-white" },
    ],
  },
  {
    name: "手工DIY",
    bg: "bg-amber-400/20", active: "bg-amber-400/35",
    darkBg: "bg-amber-500/25", darkActive: "bg-amber-500/40",
    text: "text-amber-700", darkText: "text-amber-300",
    durations: [
      { label: "30分钟以内", priority: "P3", cls: "bg-amber-500 text-white" },
      { label: "30分钟以上", priority: "P4", cls: "bg-blue-500 text-white" },
    ],
  },
  {
    name: "熨烫",
    bg: "bg-emerald-400/20", active: "bg-emerald-400/35",
    darkBg: "bg-emerald-500/25", darkActive: "bg-emerald-500/40",
    text: "text-emerald-700", darkText: "text-emerald-300",
    durations: [
      { label: "5-15分钟", priority: "P2", cls: "bg-orange-500 text-white" },
      { label: "15-30分钟", priority: "P3", cls: "bg-amber-500 text-white" },
      { label: "30分钟以上", priority: "P4", cls: "bg-blue-500 text-white" },
    ],
  },
  {
    name: "其他",
    bg: "bg-blue-400/20", active: "bg-blue-400/35",
    darkBg: "bg-blue-500/25", darkActive: "bg-blue-500/40",
    text: "text-blue-700", darkText: "text-blue-300",
    durations: [
      { label: "1-5分钟", priority: "P1", cls: "bg-red-500 text-white" },
      { label: "5-20分钟", priority: "P2", cls: "bg-orange-500 text-white" },
      { label: "30分钟以内", priority: "P3", cls: "bg-amber-500 text-white" },
      { label: "30分钟以上", priority: "P4", cls: "bg-blue-500 text-white" },
    ],
  },
];

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
  const [buildings, setBuildings] = useState<{ id: number; name: string; floorPlanUrl: string | null; rooms: { id: number; roomNumber: string }[] }[]>([]);
  const [activeBuildingId, setActiveBuildingId] = useState<number | null>(null);
  const [assistants, setAssistants] = useState<DockAssistant[]>([]);
  const [genie, setGenie] = useState<{
    sx: number; sy: number; sw: number; sh: number;
    tx: number; ty: number; tw: number; th: number;
    label: string; priority: string; cls: string; catName: string;
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
    buildingId: number; building: { id: number; name: string };
    onlineStatus: string;
  } | null>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Map pan & zoom state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInnerRef = useRef<HTMLDivElement>(null);
  const MAP_MIN_ZOOM = 1;
  const MAP_MAX_ZOOM = 5;
  const MAP_ZOOM_STEP = 0.15;
  const [mapZoom, setMapZoom] = useState(MAP_MIN_ZOOM);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapPanning, setMapPanning] = useState<{
    startX: number; startY: number; origPanX: number; origPanY: number;
  } | null>(null);

  const clampMapZoom = useCallback(
    (z: number) => Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, Math.round(z * 100) / 100)),
    []
  );

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

  const resetMapView = useCallback(() => {
    setMapZoom(MAP_MIN_ZOOM);
    setMapPan(clampMapPan(0, 0, MAP_MIN_ZOOM));
  }, [clampMapPan]);

  // Reset view when switching buildings
  useEffect(() => {
    resetMapView();
  }, [activeBuildingId, resetMapView]);

  // Fetch assistants + their active tasks for the active building
  const refreshAssistants = useCallback(() => {
    if (!activeBuildingId) return;
    Promise.all([
      fetch(`/api/profiles?role=assistant&buildingId=${activeBuildingId}`).then((r) => r.json()),
      fetch("/api/tasks").then((r) => r.json()).catch(() => []),
    ]).then(([profilesData, tasksData]) => {
      const profiles = Array.isArray(profilesData) ? profilesData : [];
      const allTasks = Array.isArray(tasksData) ? tasksData : [];
      // Build a map: assistantId -> current task description (executing / waiting+assigned)
      const taskMap = new Map<string, string>();
      for (const t of allTasks) {
        if (t.assistantId && t.category && (t.status === "executing" || t.status === "waiting" || t.status === "paused")) {
          taskMap.set(t.assistantId, `${t.category.name} · ${t.roomNumber}室`);
        }
      }
      setAssistants(profiles.map((p: DockAssistant) => ({
        ...p,
        currentTask: taskMap.get(p.id) || null,
      })));
    }).catch(console.error);
  }, [activeBuildingId]);

  useEffect(() => {
    refreshAssistants();
  }, [refreshAssistants]);

  // Map pan handlers
  const handleMapPanDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setMapPanning({
        startX: e.clientX, startY: e.clientY,
        origPanX: mapPan.x, origPanY: mapPan.y,
      });
    },
    [mapPan]
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

  // Map wheel zoom
  useEffect(() => {
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
  }, [mapZoom, mapPan, clampMapZoom, clampMapPan]);

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
    // Fetch photographer profile (郑丹) first, then buildings & tasks
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const photographer = data.find((p: { name: string; role: string }) => p.name === "郑丹" && p.role === "photographer");
          if (photographer) {
            setProfile(photographer);
            // Default to photographer's building
            setActiveBuildingId(photographer.buildingId);
            // Fetch tasks
            fetch(`/api/tasks?photographerId=${photographer.id}`)
              .then((r) => r.json())
              .then((taskData) => {
                if (Array.isArray(taskData)) {
                  setTasks(taskData.map(apiTaskToDisplay));
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

  const handleBook = useCallback(
    (catName: string, dur: { label: string; priority: string; cls: string }, e: React.MouseEvent) => {
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
        catName, phase: 0,
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
        // Find matching category from DB categories list
        const catMap: Record<string, number> = { "手持": 1, "穿戴对角度": 2, "手工DIY": 3, "熨烫": 4, "其他": 7 };
        const categoryId = catMap[genie.catName] || 7;
        const tempId = `temp-${Date.now()}`;
        // Optimistic local insert
        setTasks((prev) => [
          {
            id: tempId,
            name: genie.catName,
            room,
            time: genie.label,
            progress: null,
            hasProgress: false,
            statusLabel: "等待中",
            statusCls: "bg-white/30 border-white/40",
            tagCls: "bg-gray-100/60 text-gray-500",
            assistantName: null,
          },
          ...prev,
        ]);
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
              body: JSON.stringify({ photographerId: profile.id, roomNumber: room, categoryId }),
            });
            if (res.ok) {
              const saved = await res.json();
              setTasks((prev) => prev.map((t) => t.id === tempId ? apiTaskToDisplay(saved) : t));
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
          cursor: mapPanning ? "grabbing" : "grab",
        }}
        onMouseDown={handleMapPanDown}
      >
        {activeBuilding?.floorPlanUrl ? (
          <div
            ref={mapInnerRef}
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
            />
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

      {/* Map zoom controls */}
      {activeBuilding?.floorPlanUrl && (
        <div
          className={`absolute right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1.5 rounded-xl p-1.5 ${glass}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const container = mapContainerRef.current;
              if (!container) return;
              const nz = clampMapZoom(mapZoom + MAP_ZOOM_STEP);
              if (nz === mapZoom) return;
              const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
              const s = nz / mapZoom;
              setMapZoom(nz);
              setMapPan(clampMapPan(cx - s * (cx - mapPan.x), cy - s * (cy - mapPan.y), nz));
            }}
            disabled={mapZoom >= MAP_MAX_ZOOM}
            className="w-7 h-7 rounded-lg bg-white/50 hover:bg-white/80 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            title="放大"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="relative h-28 w-7 flex items-center justify-center">
            <input
              type="range" min={0} max={100}
              value={((mapZoom - MAP_MIN_ZOOM) / (MAP_MAX_ZOOM - MAP_MIN_ZOOM)) * 100}
              onChange={(e) => {
                const container = mapContainerRef.current;
                if (!container) return;
                const nz = clampMapZoom(MAP_MIN_ZOOM + (parseInt(e.target.value) / 100) * (MAP_MAX_ZOOM - MAP_MIN_ZOOM));
                if (nz === mapZoom) return;
                const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
                const s = nz / mapZoom;
                setMapZoom(nz);
                setMapPan(clampMapPan(cx - s * (cx - mapPan.x), cy - s * (cy - mapPan.y), nz));
              }}
              className="absolute h-24 accent-purple-500 cursor-pointer"
              style={{ writingMode: "vertical-lr", direction: "rtl", width: "24px", appearance: "auto" }}
              title={`${Math.round(mapZoom * 100)}%`}
            />
          </div>
          <button
            onClick={() => {
              const container = mapContainerRef.current;
              if (!container) return;
              const nz = clampMapZoom(mapZoom - MAP_ZOOM_STEP);
              if (nz === mapZoom) return;
              const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
              const s = nz / mapZoom;
              setMapZoom(nz);
              setMapPan(clampMapPan(cx - s * (cx - mapPan.x), cy - s * (cy - mapPan.y), nz));
            }}
            disabled={mapZoom <= MAP_MIN_ZOOM}
            className="w-7 h-7 rounded-lg bg-white/50 hover:bg-white/80 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            title="缩小"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="text-[9px] text-[--text-muted] font-mono leading-none">{Math.round(mapZoom * 100)}%</span>
          <button
            onClick={resetMapView}
            className="w-7 h-7 rounded-lg bg-white/50 hover:bg-white/80 flex items-center justify-center transition-colors"
            title="重置视图"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 1 3 6.7" /><polyline points="3 22 3 16 9 16" />
            </svg>
          </button>
        </div>
      )}

      {/* ====== UI OVERLAYS ====== */}
      <div onMouseDown={(e) => e.stopPropagation()}>
        {/* 左侧三面板 */}
        <div className="absolute top-3 left-3 bottom-3 z-20 w-[250px] flex flex-col gap-2">
          {/* 面板1：摄影师信息 + 位置 + 天气 + 时间 */}
          <div className={`rounded-2xl px-4 py-3.5 ${glass}`}>
            <div className="relative mb-3">
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
                  <span>（{profile?.role === "photographer" ? "摄影师" : profile?.role === "assistant" ? "助理" : profile?.role === "leader" ? "组长" : ""}）</span>
                </p>
                <p className="text-[11px] text-[--text-muted] mt-0.5 text-right">工号 {profile?.employeeId || "—"}</p>
                <p className="text-[10px] text-[--text-muted] mt-0.5 text-right">
                  {[profile?.department, profile?.group].filter(Boolean).join(" · ") || ""}
                </p>
                <div className="flex items-center justify-end gap-1.5 text-[11px] text-[--text-secondary] mt-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{profile?.building?.name || "—"} {profile?.currentRoom ? `${profile.currentRoom}室` : ""}</span>
                </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-3 mt-1.5 border-t border-white/20 text-[11px]">
              <div className="flex items-center gap-1.5 text-[--text-secondary] min-w-0">
                <span className="shrink-0">🌤</span>
                <span className="truncate">深圳 · 26°C 多云</span>
              </div>
              <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[--text-secondary]">
                {now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
              </span>
            </div>
          </div>

          {/* 面板2：快捷预约 */}
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
                  return (
                    <div
                      key={task.id}
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
                          {task.assistantName && <span className="text-[10px] text-[--text-muted] font-normal ml-1.5">{task.assistantName}</span>}
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
                      <p className="text-[10px] text-[--text-muted] mt-0.5">
                        {task.room}室 · {task.time}
                      </p>
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

        {/* 右上：后台身份管理入口 */}
        <a href="/admin" className={`absolute top-3 right-3 z-20 rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/70 transition-colors ${glass}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          <span className="text-xs font-medium text-[--text-secondary]">后台管理</span>
        </a>

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
                "手持": "bg-red-400", "穿戴对角度": "bg-orange-400", "手工DIY": "bg-amber-400",
                "熨烫": "bg-emerald-400", "其他": "bg-blue-400", "服装穿戴": "bg-orange-400",
              };
              const typeCounts: Record<string, number> = {};
              for (const t of tasks) {
                typeCounts[t.name] = (typeCounts[t.name] || 0) + 1;
              }
              const total = tasks.length || 1;
              const typeBreakdown = Object.entries(typeCounts)
                .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100), color: TYPE_COLORS[name] || "bg-gray-400" }))
                .sort((a, b) => b.count - a.count);

              return (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Weekly Chart — 暂用静态示意 */}
                  <div className="rounded-xl bg-gray-50/80 px-4 py-3">
                    <h3 className="text-[11px] font-bold text-[--text-primary] mb-3">本周完成趋势</h3>
                    <div className="flex items-end gap-2 h-24">
                      {[
                        { day: "周一", count: 15 }, { day: "周二", count: 18 }, { day: "周三", count: 12 },
                        { day: "周四", count: 20 }, { day: "周五", count: 16 }, { day: "周六", count: 22 }, { day: "周日", count: 8 },
                      ].map((d) => (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                          <span className="text-[9px] font-bold text-[--text-primary]">{d.count}</span>
                          <div className="w-full rounded-t-md bg-gradient-to-t from-orange-500 to-orange-300" style={{ height: `${(d.count / 22) * 100}%` }} />
                          <span className="text-[9px] text-[--text-muted]">{d.day}</span>
                        </div>
                      ))}
                    </div>
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
                <span className="w-[20%]">类型</span>
                <span className="w-[12%]">房间</span>
                <span className="w-[23%]">时间信息</span>
                <span className="w-[20%]">助理</span>
                <span className="w-[13%]">用时</span>
                <span className="w-[12%]">状态</span>
              </div>
              {tasks.length === 0 ? (
                <div className="text-center py-6 text-[--text-muted] text-xs">暂无任务</div>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="flex items-center text-[10px] px-4 py-2 border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <span className="w-[20%] font-medium text-[--text-primary]">{t.name}</span>
                    <span className="w-[12%] text-[--text-muted]">{t.room}室</span>
                    <span className="w-[23%] text-[--text-muted]">{t.time}</span>
                    <span className="w-[20%] text-[--text-muted]">{t.assistantName || "—"}</span>
                    <span className="w-[13%] text-[--text-muted]">{t.statusLabel === "已完成" ? t.time : "—"}</span>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${t.tagCls}`}>{t.statusLabel}</span>
                  </div>
                ))
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
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const VIEWPORT = 220;

  // Load image element when src changes
  useEffect(() => {
    if (!imgSrc) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      const s = Math.max(VIEWPORT / img.width, VIEWPORT / img.height);
      setScale(s);
      setOffset({ x: (VIEWPORT - img.width * s) / 2, y: (VIEWPORT - img.height * s) / 2 });
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
      setOffset({
        x: dragging.origX + e.clientX - dragging.startX,
        y: dragging.origY + e.clientY - dragging.startY,
      });
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
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(imgEl, offset.x * ratio, offset.y * ratio, imgEl.width * scale * ratio, imgEl.height * scale * ratio);
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  }

  const minScale = imgEl ? Math.max(VIEWPORT / imgEl.width, VIEWPORT / imgEl.height) : 1;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-800 mb-4">更换头像</h3>

        {/* Circular preview */}
        <div className="flex justify-center mb-4">
          <div
            className="relative rounded-full overflow-hidden border-2 border-gray-200"
            style={{ width: VIEWPORT, height: VIEWPORT, cursor: imgEl ? "grab" : "default" }}
            onMouseDown={(e) => {
              if (!imgEl) return;
              e.preventDefault();
              setDragging({ startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y });
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
                  left: offset.x,
                  top: offset.y,
                  width: imgEl.width * scale,
                  height: imgEl.height * scale,
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
              min={Math.round(minScale * 100)}
              max={Math.round(minScale * 400)}
              value={Math.round(scale * 100)}
              onChange={(e) => {
                const newScale = parseInt(e.target.value) / 100;
                const cx = VIEWPORT / 2;
                const cy = VIEWPORT / 2;
                const r = newScale / scale;
                setOffset({ x: cx - r * (cx - offset.x), y: cy - r * (cy - offset.y) });
                setScale(newScale);
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
