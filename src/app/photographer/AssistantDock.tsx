"use client";

import { useState, useCallback, useEffect, useRef } from "react";

function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 60) return `${m}分钟`;
  const h = m / 60;
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}小时` : `${rounded.toFixed(1)}小时`;
}

export interface DockAssistant {
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
  currentRoom: string | null;   // 当前活跃任务的房间（主标记位置）
  avatar: string | null;
  group: string | null;
  currentTask: string | null;
  pausedRoom: string | null;    // 被暂停任务的房间（灰色标记位置）
  pausedTaskDesc: string | null;
  pausedTaskDetail: string | null;
  pausedElapsedMin: number;
  /** 待就位被更高优先插单时，原较低优先任务所在房间（灰头像 50%） */
  preemptedWaitingRoom: string | null;
  preemptedWaitingTaskDesc: string | null;
  preemptedWaitingTaskDetail: string | null;
  newTaskDesc: string | null;
  resumingFromPause: boolean;
  pendingRoom: string | null;   // 待执行插单任务的房间（蓝脉冲标记位置，旧任务未暂停时）
  /** 当前活跃任务的备注（用于地图 tooltip 和点击弹窗） */
  currentTaskNote: string | null;
  /** 当前活跃任务的 ID（用于地图点击弹窗保存备注） */
  currentTaskId: string | null;
  /** 主标记进行中任务超过类别时段上限的超出分钟数，未超时为 null */
  executingOvertimeMin: number | null;
  /** 灰色暂停标记任务超过时段上限的超出分钟数 */
  pausedOvertimeMin: number | null;
  /** 被让行的待就位任务超过时段上限（与 pausedOvertimeMin 互斥场景） */
  preemptedOvertimeMin: number | null;
  /** 吃饭中已离开分钟数 */
  eatingElapsedMin?: number | null;
  /** 吃饭中超过后台阈值的分钟数 */
  eatingOvertimeMin?: number | null;
}

/** 状态色（Dock 状态点 / 地图头像描边等与文档一致） */
export const DOCK_DOT = {
  idle: "#22c55e",
  eating: "#3b82f6",
  assigned: "#3b82f6",
  inProgress: "#f97316",
  overtime: "#dc2626",
  offline: "#9ca3af",
} as const;

/** 根据助理聚合状态与超时计算状态点颜色 */
export function assistantDockDotColor(a: DockAssistant): string {
  const isOffline = a.onlineStatus === "offline" || a.onlineStatus === "on_break";
  if (isOffline) return DOCK_DOT.offline;
  if (a.subStatus === "eating" && a.eatingOvertimeMin != null) return DOCK_DOT.overtime;
  if (a.subStatus === "eating") return DOCK_DOT.eating;
  if (a.executingOvertimeMin != null || a.pausedOvertimeMin != null || a.preemptedOvertimeMin != null) {
    return DOCK_DOT.overtime;
  }
  const st = a.status === "finishing" ? "executing" : a.status;
  if (st === "idle") return DOCK_DOT.idle;
  if (st === "assigned") return DOCK_DOT.assigned;
  return DOCK_DOT.inProgress;
}

const STATUS_ORDER: Record<string, number> = { idle: 0, assigned: 1, busy: 2, executing: 3 };

function dockStatusRank(status: string): number {
  const s = status === "finishing" ? "executing" : status;
  return STATUS_ORDER[s] ?? 9;
}

export const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: DOCK_DOT.idle, label: "空闲中" },
  assigned: { color: DOCK_DOT.assigned, label: "待就位" },
  busy: { color: DOCK_DOT.inProgress, label: "在忙" },
  executing: { color: DOCK_DOT.inProgress, label: "进行中" },
};

function formatRoomOrVenue(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.endsWith("室")) return value;
  return /^\d+$/.test(value) ? `${value}室` : value;
}

const BASE = 50;
const MAX = 84;
const GAP = 10;
const RANGE = 170;
const RAIL_PAD = 14;

function getSizes(count: number, mouseY: number): number[] {
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    if (mouseY < 0) {
      sizes.push(BASE);
    } else {
      let offset = 0;
      for (let j = 0; j < i; j++) offset += sizes[j] + GAP;
      const center = offset + BASE / 2;
      const dist = Math.abs(mouseY - center);
      if (dist > RANGE) {
        sizes.push(BASE);
      } else {
        const ratio = 1 - dist / RANGE;
        sizes.push(BASE + (MAX - BASE) * Math.cos((1 - ratio) * Math.PI / 2));
      }
    }
  }
  return sizes;
}

export type NoteEditAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type DockRankingCrown = { rank: 1 | 2 | 3 };

function dockCrownMeta(rank: 1 | 2 | 3, avatarSize: number): { color: string; size: number; left: number; top: number } {
  if (rank === 1) return { color: "#fde047", size: avatarSize * 0.52, left: -avatarSize * 0.2, top: -avatarSize * 0.23 };
  if (rank === 2) return { color: "#e2e8f0", size: avatarSize * 0.42, left: -avatarSize * 0.16, top: -avatarSize * 0.18 };
  return { color: "#f59e0b", size: avatarSize * 0.34, left: -avatarSize * 0.12, top: -avatarSize * 0.14 };
}

function DockRankingCrownBadge({ rank, avatarSize }: { rank: 1 | 2 | 3; avatarSize: number }) {
  const meta = dockCrownMeta(rank, avatarSize);
  return (
    <svg
      className="pointer-events-none absolute z-20 -rotate-[22deg] overflow-visible"
      viewBox="0 0 24 24"
      fill="none"
      stroke={meta.color}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        width: meta.size,
        height: meta.size,
        left: meta.left,
        top: meta.top,
        filter: "drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 1px 1px rgba(15,23,42,0.22))",
      }}
    >
      <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8Z" />
      <path d="M5 18h14" />
    </svg>
  );
}

export default function AssistantDock({
  assistants,
  onNoteEdit,
  rankingCrownByAssistantId = {},
}: {
  assistants: DockAssistant[];
  onNoteEdit?: (taskId: string, note: string, anchor: NoteEditAnchor) => void;
  rankingCrownByAssistantId?: Record<string, DockRankingCrown>;
}) {
  const [mouseY, setMouseY] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingMouseYRef = useRef(-1);
  const mouseFrameRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (listRef.current) {
      const rect = listRef.current.getBoundingClientRect();
      pendingMouseYRef.current = e.clientY - rect.top;
      if (mouseFrameRef.current != null) return;
      mouseFrameRef.current = window.requestAnimationFrame(() => {
        mouseFrameRef.current = null;
        const nextMouseY = pendingMouseYRef.current;
        setMouseY((prev) => (Math.abs(prev - nextMouseY) < 0.5 ? prev : nextMouseY));
      });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    pendingMouseYRef.current = -1;
    if (mouseFrameRef.current != null) {
      window.cancelAnimationFrame(mouseFrameRef.current);
      mouseFrameRef.current = null;
    }
    setMouseY(-1);
  }, []);

  useEffect(() => {
    return () => {
      if (mouseFrameRef.current != null) window.cancelAnimationFrame(mouseFrameRef.current);
    };
  }, []);

  const sorted = [...assistants].sort((a, b) => {
    const aOff = a.onlineStatus === "offline" || a.onlineStatus === "on_break" ? 1 : 0;
    const bOff = b.onlineStatus === "offline" || b.onlineStatus === "on_break" ? 1 : 0;
    if (aOff !== bOff) return aOff - bOff;
    return dockStatusRank(a.status) - dockStatusRank(b.status);
  });
  const sizes = getSizes(sorted.length, mouseY);
  const active = mouseY >= 0;

  if (sorted.length === 0) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-50 flex items-center pointer-events-none">
      <div
        ref={containerRef}
        className="relative glass mr-1.5 pointer-events-auto flex flex-col items-center"
        style={{
          borderRadius: 20,
          width: BASE + 14,
          padding: `${RAIL_PAD}px 0`,
          overflow: "visible",
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Avatars */}
        <div
          ref={listRef}
          className="relative flex flex-col items-end"
          style={{ gap: GAP, width: "100%", paddingRight: 5, overflow: "visible" }}
        >
          {sorted.map((a, i) => {
            const size = sizes[i] ?? BASE;
            const effectiveStatus = a.status === "finishing" ? "executing" : a.status;
            const cfg = STATUS[effectiveStatus] || STATUS.idle;
            const dotSize = 8 + (size - BASE) / (MAX - BASE) * 4;
            const isOffline = a.onlineStatus === "offline" || a.onlineStatus === "on_break";
            const isEating = !isOffline && a.subStatus === "eating";
	            const dotColor = assistantDockDotColor(a);
	            const rankingCrown = rankingCrownByAssistantId[a.id] ?? null;
	            const headerColor = isOffline
              ? "#9ca3af"
              : isEating
                ? DOCK_DOT.eating
              : a.executingOvertimeMin != null || a.pausedOvertimeMin != null || a.preemptedOvertimeMin != null
                ? DOCK_DOT.overtime
                : cfg.color;

            return (
              <div
                key={a.id}
                className="group/dock-avatar relative z-[1] flex shrink-0 items-center justify-center overflow-visible hover:z-20"
                style={{
                  width: size,
                  height: size,
                  transition: active
                    ? "width 0.08s linear, height 0.08s linear"
                    : "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  overflow: "visible",
                }}
              >
                {/* Tooltip */}
                <div
                  className="pointer-events-none absolute right-full mr-3 translate-x-2 whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/dock-avatar:translate-x-0 group-hover/dock-avatar:opacity-100"
                >
                  <div className="px-3 py-1.5 rounded-xl glass text-right">
                    {(() => {
                      if (isOffline) {
                        const offLabel = a.onlineStatus === "on_break" ? "今天有事不在～休假/下班 /离线" : "离线";
                        return (
                          <>
                            <p className="text-xs font-semibold text-gray-400">{a.name} · {offLabel}</p>
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{formatRoomOrVenue(a.currentRoom)}</p>
                          </>
                        );
                      }
                      if (isEating) {
                        const eatingOvertime = a.eatingOvertimeMin != null;
                        const eatingOvertimeMin = a.eatingOvertimeMin ?? 0;
                        return (
                          <>
                            <p className={`text-xs font-semibold ${eatingOvertime ? "text-red-600" : "text-blue-500"}`}>
                              {a.name} · {eatingOvertime ? `吃饭超时${eatingOvertimeMin === 0 ? "" : fmtMin(eatingOvertimeMin)}` : "吃饭中～稍后回来"}
                            </p>
                            {a.eatingElapsedMin != null && (
                              <p className={`text-[10px] mt-0.5 ${eatingOvertime ? "text-red-500" : "text-blue-500/70"}`}>
                                已离开{fmtMin(a.eatingElapsedMin)}
                              </p>
                            )}
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{formatRoomOrVenue(a.currentRoom)}</p>
                          </>
                        );
                      }
                      const tasks = a.currentTask ? a.currentTask.split("\n---\n") : [];
                      if (tasks.length === 0) {
                        return (
                          <>
                            <p className="text-xs font-semibold" style={{ color: headerColor }}>{a.name} · {cfg.label}</p>
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{formatRoomOrVenue(a.currentRoom)}</p>
                            {a.currentTaskNote && (
                              <p className="text-[10px] text-orange-500 mt-0.5 flex items-start gap-1 whitespace-normal text-left max-w-[190px]">
                                <svg className="shrink-0 mt-[1px]" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                <span className="note-two-line leading-[1.25]" style={{ maxHeight: "2.5em", overflow: "hidden" }}>
                                  {a.currentTaskNote}
                                </span>
                              </p>
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
                          <div key={i} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-white/20" : ""}>
                            <p className="text-xs font-semibold" style={{ color: headerColor }}>{a.name} · {cfg.label}{elapsedText}</p>
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{detail}</p>
                            {i === 0 && a.currentTaskNote && (
                              <p className="text-[10px] text-orange-500 mt-0.5 flex items-start gap-1 whitespace-normal text-left max-w-[190px]">
                                <svg className="shrink-0 mt-[1px]" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                <span className="note-two-line leading-[1.25]" style={{ maxHeight: "2.5em", overflow: "hidden" }}>
                                  {a.currentTaskNote}
                                </span>
                              </p>
                            )}
                          </div>
                        );
                      }).concat(
                        []
                      );
                    })()}
                  </div>
                </div>

                {/* Avatar（超时不在此做脉冲，仅状态点与 tooltip 用红色强调） */}
                <div
                  className="relative z-[1] h-full w-full overflow-hidden rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.1),0_0_0_1.5px_rgba(255,255,255,0.5)] transition-[box-shadow,transform] duration-150 ease-out group-hover/dock-avatar:scale-[1.03] group-hover/dock-avatar:shadow-[0_6px_24px_rgba(0,0,0,0.18),0_0_0_2px_rgba(255,255,255,0.7)]"
                  style={{
                    filter: isOffline ? "grayscale(1)" : "none",
                  }}
                  onClick={(e) => {
                    if (!a.currentTaskId || !onNoteEdit) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    onNoteEdit(a.currentTaskId, a.currentTaskNote ?? "", {
                      top: rect.top,
                      left: rect.left,
                      width: rect.width,
                      height: rect.height,
                    });
                  }}
                >
                  {a.avatar ? (
                    <img
                      src={a.avatar}
                      alt={a.name}
                      className="h-full w-full object-cover cursor-pointer"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full cursor-pointer items-center justify-center bg-gradient-to-br from-blue-200 to-blue-400 font-bold text-white"
                      style={{ fontSize: size * 0.35 }}
                    >
                      {a.name[0]}
                    </div>
	                  )}
	                </div>
	                {rankingCrown && (
	                  <DockRankingCrownBadge rank={rankingCrown.rank} avatarSize={size} />
	                )}

	                {/* Status dot */}
                <div
                  className="absolute z-10 rounded-full"
                  style={{
                    width: dotSize,
                    height: dotSize,
                    backgroundColor: dotColor,
                    bottom: 0,
                    right: 0,
                    boxShadow: "0 0 0 2px white",
                    transition: active ? "all 0.08s linear" : "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
