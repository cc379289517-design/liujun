"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type ThemeMode = "light" | "dark" | "auto";

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
  const [tasks, setTasks] = useState(() => [...mockTasks]);
  const [genie, setGenie] = useState<{
    sx: number; sy: number; sw: number; sh: number;
    tx: number; ty: number; tw: number; th: number;
    label: string; priority: string; cls: string; catName: string;
    phase: number;
  } | null>(null);
  const [enteringTaskId, setEnteringTaskId] = useState<number | null>(null);
  const [removingTaskId, setRemovingTaskId] = useState<number | null>(null);
  const [hoveredTagId, setHoveredTagId] = useState<number | null>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

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

  const cycleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const order: ThemeMode[] = ["light", "dark", "auto"];
      const next = order[(order.indexOf(prev) + 1) % 3];
      localStorage.setItem("themeMode", next);
      return next;
    });
  }, []);

  const handleCancelTask = useCallback((taskId: number) => {
    if (removingTaskId) return;
    setRemovingTaskId(taskId);
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setRemovingTaskId(null);
      setHoveredTagId(null);
    }, 450);
  }, [removingTaskId]);

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
      const timer = setTimeout(() => {
        const id = Date.now();
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        setTasks((prev) => [
          {
            id,
            name: genie.catName,
            room,
            time: genie.label,
            progress: null,
            statusLabel: "等待中",
            statusCls: "bg-white/30 border-white/40",
            tagCls: "bg-gray-100/60 text-gray-500",
          },
          ...prev,
        ]);
        setEnteringTaskId(id);
        setGenie(null);
        taskListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => setEnteringTaskId(null), 600);
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [genie]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* ====== STATIC BIRD'S-EYE MAP ====== */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{ background: resolvedTheme === "dark" ? "#0f1117" : "#f2f2f4" }}
      >
        <img
          src="/maps/building-1-birdseye.png"
          alt="1号楼鸟瞰图"
          className="w-full h-full object-contain transition-all duration-700"
          draggable={false}
          style={{ filter: `brightness(var(--map-brightness))` }}
        />
        {/* Night overlay */}
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-700"
          style={{ background: "var(--map-overlay)" }}
        />
      </div>

      {/* ====== UI OVERLAYS ====== */}
      <div>
        {/* 左侧三面板 */}
        <div className="absolute top-3 left-3 bottom-3 z-20 w-[250px] flex flex-col gap-2">
          {/* 面板1：摄影师信息 + 位置 + 天气 + 时间 */}
          <div className={`rounded-2xl px-4 py-3.5 ${glass}`}>
            <div className="relative mb-3">
              <img
                src="/avatars/zhang.jpg"
                alt="张三"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[95px] h-[95px] rounded-full object-cover shadow-md shadow-orange-200/40 ring-2 ring-white/60"
              />
              <div className="min-h-[52px] min-w-0 flex justify-end">
                <div className="w-[136px]">
                <p className="text-sm font-bold text-[--text-primary] leading-tight flex justify-end items-baseline text-right">
                  <span>张三</span>
                  <span>（摄影师）</span>
                </p>
                <p className="text-[11px] text-[--text-muted] mt-0.5 text-right">工号 PH-0042</p>
                <div className="flex items-center justify-end gap-1.5 text-[11px] text-[--text-secondary] mt-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>南座4楼</span>
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
              <a href="/photographer/stats" className="text-[10px] text-orange-500 font-semibold hover:text-orange-600">查看更多 →</a>
            </div>
            <div ref={taskListRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden task-scroll">
              <div className="space-y-1.5">
                {tasks.map((task) => {
                  const isRemoving = removingTaskId === task.id;
                  const isWaiting = task.statusLabel === "等待中";
                  const showCancel = isWaiting && hoveredTagId === task.id && !isRemoving;
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
                        <span className="text-[12px] font-medium text-[--text-primary]">{task.name}</span>
                        <span
                          className={`text-[8px] font-bold px-1.5 py-0.5 rounded transition-all duration-150 ${
                            showCancel
                              ? "bg-red-100/80 text-red-500 cursor-pointer hover:bg-red-200/80 scale-105"
                              : task.tagCls
                          }`}
                          onMouseEnter={() => isWaiting && setHoveredTagId(task.id)}
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
                      <p className="text-[10px] text-[--text-muted] mt-0.5">{task.room}室 · {task.time}</p>
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

        {/* 顶部中央：区域切换 */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
          <div className={`flex gap-0.5 px-1.5 py-1 rounded-xl ${glass}`}>
            {[
              { id: 1, label: "南座4楼", active: true },
              { id: 2, label: "东座3楼", active: false },
              { id: 3, label: "北座", active: false },
              { id: 4, label: "A座1楼", active: false },
              { id: 5, label: "B101", active: false },
            ].map((area) => (
              <button
                key={area.id}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  area.active
                    ? "bg-[--accent-orange] text-black shadow-md shadow-black/30 font-bold text-[13px]"
                    : "text-[--text-muted] hover:text-[--text-primary] hover:bg-white/60"
                }`}
              >
                {area.label}
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

        {/* 底部中央：图例 */}
        <div className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-5 px-5 py-2.5 rounded-2xl ${glass}`}>
          {[
            { label: "空闲", color: "bg-green-500" },
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
      <div className="absolute right-5 bottom-5 z-[60]">
        <button
          onClick={cycleTheme}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${glass} text-[--text-primary] hover:scale-105`}
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
    </div>
  );
}

/* ─── Mock tasks ─── */

const statusPool = [
  { statusLabel: "执行中", statusCls: "bg-white/40 border-orange-200/50", tagCls: "bg-orange-100/60 text-orange-600", hasProgress: true },
  { statusLabel: "等待中", statusCls: "bg-white/30 border-white/40", tagCls: "bg-gray-100/60 text-gray-500", hasProgress: false },
  { statusLabel: "已完成", statusCls: "bg-white/30 border-white/40", tagCls: "bg-green-100/60 text-green-600", hasProgress: false },
  { statusLabel: "已取消", statusCls: "bg-white/20 border-white/30", tagCls: "bg-red-100/60 text-red-500", hasProgress: false },
];

const taskNames = ["手持", "穿戴对角度", "手工DIY", "熨烫", "其他"];
const rooms = ["401", "402", "403", "405", "406", "407", "408", "409", "410", "411", "412", "413", "418", "419", "420", "421", "425", "426", "427", "431"];

const mockTasks = Array.from({ length: 20 }, (_, i) => {
  const s = statusPool[i % statusPool.length];
  const roomId = rooms[i % rooms.length];
  const name = taskNames[i % taskNames.length];
  const mins = [3, 5, 8, 12, 15, 20, 25, 30][i % 8];
  const total = mins + [2, 5, 7, 10, 15][i % 5];
  return {
    id: i + 1,
    name,
    room: roomId,
    time: s.hasProgress ? `${mins}:00/${total}:00` : s.statusLabel === "已完成" ? `用时${mins}分钟` : `预估${total}分钟`,
    progress: s.hasProgress ? Math.round((mins / total) * 100) : null,
    ...s,
  };
});
