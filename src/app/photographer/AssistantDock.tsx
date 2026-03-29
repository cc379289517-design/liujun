"use client";

import { useState, useCallback, useRef } from "react";

export interface DockAssistant {
  id: string;
  name: string;
  status: string;
  onlineStatus: string;
  currentRoom: string | null;
  avatar: string | null;
  group: string | null;
  currentTask: string | null; // e.g. "手工DIY协助 · 418室"
}

const STATUS_ORDER: Record<string, number> = { idle: 0, assigned: 1, finishing: 2, busy: 3, executing: 4 };

const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: "#22c55e", label: "空闲" },
  assigned: { color: "#3b82f6", label: "待就位" },
  finishing: { color: "#86efac", label: "快结束" },
  busy: { color: "#fdba74", label: "在忙" },
  executing: { color: "#f97316", label: "进行中" },
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

  const sorted = [...assistants].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
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
            const cfg = STATUS[a.status] || STATUS.idle;
            const hovered = hoveredId === a.id;
            const dotSize = 8 + (size - BASE) / (MAX - BASE) * 4;

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
                    <p className="text-xs font-semibold text-[--text-primary]">
                      <span style={{ color: cfg.color }}>{cfg.label}</span>
                      <span className="mx-1">·</span>
                      {a.name}
                    </p>
                    <p className="text-[10px] text-[--text-muted] mt-0.5">
                      {a.currentTask || (a.currentRoom ? `${a.currentRoom}室` : "—")}
                    </p>
                  </div>
                </div>

                {/* Avatar */}
                <div
                  className="w-full h-full rounded-full overflow-hidden"
                  style={{
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
                      className="w-full h-full object-cover cursor-pointer"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="w-full h-full bg-gradient-to-br from-blue-200 to-blue-400 flex items-center justify-center text-white font-bold cursor-pointer"
                      style={{ fontSize: size * 0.35 }}
                    >
                      {a.name[0]}
                    </div>
                  )}
                </div>

                {/* Status dot */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: dotSize,
                    height: dotSize,
                    backgroundColor: cfg.color,
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
            {(["idle", "assigned", "finishing", "busy", "executing"] as const).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className="flex-shrink-0 rounded-full" style={{ width: 8, height: 8, backgroundColor: STATUS[s].color }} />
                <span className="text-[9px] text-[--text-muted] leading-none whitespace-nowrap">{STATUS[s].label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
