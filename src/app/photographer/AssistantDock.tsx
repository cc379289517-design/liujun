"use client";

import { useState, useCallback, useRef } from "react";

interface Assistant {
  id: string;
  name: string;
  status: "idle" | "busy" | "executing" | "finishing";
  room: string;
  avatar: string;
}

const STATUS_ORDER: Record<string, number> = { idle: 0, finishing: 1, busy: 2, executing: 3 };

const ASSISTANTS: Assistant[] = [
  { id: "1", name: "小红", status: "idle", room: "101", avatar: "/avatars/xiaohong.jpg" },
  { id: "5", name: "小强", status: "idle", room: "302", avatar: "/avatars/xiaoqiang.jpg" },
  { id: "6", name: "小芳", status: "idle", room: "306", avatar: "/avatars/xiaofang.jpg" },
  { id: "9", name: "小伟", status: "idle", room: "105", avatar: "/avatars/xiaowei.jpg" },
  { id: "4", name: "小丽", status: "finishing", room: "204", avatar: "/avatars/xiaoli.jpg" },
  { id: "10", name: "小雪", status: "finishing", room: "301", avatar: "/avatars/xiaoxue.jpg" },
  { id: "3", name: "小华", status: "busy", room: "202", avatar: "/avatars/xiaohua.jpg" },
  { id: "8", name: "小燕", status: "busy", room: "503", avatar: "/avatars/xiaoyan.jpg" },
  { id: "2", name: "小明", status: "executing", room: "103", avatar: "/avatars/xiaoming.jpg" },
  { id: "7", name: "小军", status: "executing", room: "402", avatar: "/avatars/xiaojun.jpg" },
];

const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: "#22c55e", label: "空闲中" },
  finishing: { color: "#86efac", label: "快结束" },
  busy: { color: "#fdba74", label: "长任务" },
  executing: { color: "#f97316", label: "进行中" },
};

const BASE = 50;
const MAX = 84;
const GAP = 10;
const RANGE = 170;
const LEGEND_H = 86;
const RAIL_PAD = 14;

function getSizes(mouseY: number): number[] {
  const sizes: number[] = [];
  for (let i = 0; i < ASSISTANTS.length; i++) {
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

export default function AssistantDock() {
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

  const sizes = getSizes(mouseY);
  const active = mouseY >= 0;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-50 flex items-center pointer-events-none">
      <div
        ref={containerRef}
        className="relative glass mr-1.5 pointer-events-auto flex flex-col items-center"
        style={{ borderRadius: 20, width: BASE + 14, padding: `${RAIL_PAD}px 0`, paddingBottom: LEGEND_H + 10 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Avatars */}
        <div
          ref={listRef}
          className="relative flex flex-col items-end"
          style={{ gap: GAP, width: "100%", paddingRight: 5 }}
        >
          {ASSISTANTS.map((a, i) => {
            const size = sizes[i];
            const cfg = STATUS[a.status];
            const hovered = hoveredId === a.id;
            const dotSize = 8 + (size - BASE) / (MAX - BASE) * 4;

            return (
              <div
                key={a.id}
                className="relative flex items-center justify-center"
                style={{
                  width: size,
                  height: size,
                  transition: active
                    ? "width 0.08s linear, height 0.08s linear"
                    : "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  zIndex: hovered ? 20 : 1,
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
                    <p className="text-xs font-semibold text-[--text-primary]">{a.name}</p>
                    <p className="text-[10px] text-[--text-muted]">{a.room}室 · {cfg.label}</p>
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
                  <img
                    src={a.avatar}
                    alt={a.name}
                    className="w-full h-full object-cover cursor-pointer"
                    draggable={false}
                  />
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
            {(["idle", "finishing", "busy", "executing"] as const).map((s) => (
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
