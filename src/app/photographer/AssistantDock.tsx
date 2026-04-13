"use client";

import { useState, useCallback, useRef } from "react";

export interface DockAssistant {
  id: string;
  name: string;
  status: string;
  onlineStatus: string;
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
  /** 主标记进行中任务超过类别时段上限的超出分钟数，未超时为 null */
  executingOvertimeMin: number | null;
  /** 灰色暂停标记任务超过时段上限的超出分钟数 */
  pausedOvertimeMin: number | null;
  /** 被让行的待就位任务超过时段上限（与 pausedOvertimeMin 互斥场景） */
  preemptedOvertimeMin: number | null;
}

/** 状态色（Dock 状态点 / 地图头像描边等与文档一致） */
export const DOCK_DOT = {
  idle: "#22c55e",
  assigned: "#3b82f6",
  inProgress: "#f97316",
  overtime: "#dc2626",
  offline: "#9ca3af",
} as const;

/** 根据助理聚合状态与超时计算状态点颜色 */
export function assistantDockDotColor(a: DockAssistant): string {
  const isOffline = a.onlineStatus === "offline" || a.onlineStatus === "on_break";
  if (isOffline) return DOCK_DOT.offline;
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

const BASE = 50;
const MAX = 84;
const GAP = 10;
const RANGE = 170;
const LEGEND_H = 86;
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

export default function AssistantDock({ assistants }: { assistants: DockAssistant[] }) {
  const [mouseY, setMouseY] = useState(-1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (listRef.current) {
      const rect = listRef.current.getBoundingClientRect();
      setMouseY(e.clientY - rect.top);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMouseY(-1);
    setHoveredId(null);
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
          paddingBottom: LEGEND_H + 10,
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
            const hovered = hoveredId === a.id;
            const dotSize = 8 + (size - BASE) / (MAX - BASE) * 4;
            const isOffline = a.onlineStatus === "offline" || a.onlineStatus === "on_break";
            const dotColor = assistantDockDotColor(a);
            const headerColor = isOffline
              ? "#9ca3af"
              : a.executingOvertimeMin != null || a.pausedOvertimeMin != null || a.preemptedOvertimeMin != null
                ? DOCK_DOT.overtime
                : cfg.color;

            return (
              <div
                key={a.id}
                className="relative flex items-center justify-center shrink-0"
                style={{
                  width: size,
                  height: size,
                  transition: active
                    ? "width 0.08s linear, height 0.08s linear"
                    : "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  zIndex: hovered ? 20 : 1,
                  overflow: "visible",
                }}
                onMouseEnter={() => setHoveredId(a.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Tooltip */}
                <div
                  className="absolute right-full mr-3 whitespace-nowrap pointer-events-none"
                  style={{
                    opacity: hovered ? 1 : 0,
                    transform: hovered ? "translateX(0)" : "translateX(8px)",
                    transition: "all 0.2s ease-out",
                  }}
                >
                  <div className="px-3 py-1.5 rounded-xl glass text-right">
                    {(() => {
                      if (isOffline) {
                        const offLabel = a.onlineStatus === "on_break" ? "休假" : "下线";
                        return (
                          <>
                            <p className="text-xs font-semibold text-gray-400">{a.name} · {offLabel}</p>
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{a.currentRoom ? `${a.currentRoom}室` : "—"}</p>
                          </>
                        );
                      }
                      const tasks = a.currentTask ? a.currentTask.split("\n---\n") : [];
                      if (tasks.length === 0) {
                        return (
                          <>
                            <p className="text-xs font-semibold" style={{ color: headerColor }}>{a.name} · {cfg.label}</p>
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
                          <div key={i} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-white/20" : ""}>
                            <p className="text-xs font-semibold" style={{ color: headerColor }}>{a.name} · {cfg.label}{elapsedText}</p>
                            <p className="text-[10px] text-[--text-muted] mt-0.5">{detail}</p>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Avatar（超时不在此做脉冲，仅状态点与 tooltip 用红色强调） */}
                <div
                  className="relative z-[1] h-full w-full rounded-full overflow-hidden"
                  style={{
                    filter: isOffline ? "grayscale(1)" : "none",
                    boxShadow: hovered
                      ? "0 6px 24px rgba(0,0,0,0.18), 0 0 0 2px rgba(255,255,255,0.7)"
                      : "0 2px 8px rgba(0,0,0,0.1), 0 0 0 1.5px rgba(255,255,255,0.5)",
                    transition: "box-shadow 0.15s ease-out",
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

        {/* Legend */}
        <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center" style={{ paddingLeft: 4 }}>
          <div className="w-10 border-t border-gray-300/40 mb-2.5" />
          <div className="flex flex-col gap-2">
            {[
              { color: DOCK_DOT.idle, label: "空闲中" },
              { color: DOCK_DOT.assigned, label: "待就位" },
              { color: DOCK_DOT.inProgress, label: "进行中" },
              { color: DOCK_DOT.overtime, label: "已超时" },
              { color: DOCK_DOT.offline, label: "已下线" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="flex-shrink-0 rounded-full" style={{ width: 8, height: 8, backgroundColor: row.color }} />
                <span className="text-[9px] text-[--text-muted] leading-none whitespace-nowrap">{row.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
