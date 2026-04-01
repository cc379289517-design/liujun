"use client";

import { useState, useEffect, useCallback } from "react";
import ProfilesTab from "./ProfilesTab";
import SpaceTab from "./SpaceTab";
import TaskLogicTab from "./TaskLogicTab";
import ApprovalTab from "./ApprovalTab";
import StatsTab from "./StatsTab";

type TabKey = "profiles" | "spaces" | "tasks" | "approvals" | "stats";

type Room = { id: number; buildingId: number; roomNumber: string; floor: number; xPosition: number; yPosition: number; fenceRadius: number };
type Building = { id: number; name: string; floorPlanUrl: string | null; cropX?: number | null; cropY?: number | null; cropW?: number | null; cropH?: number | null; rooms: Room[] };
type Profile = { id: string; employeeId: string | null; name: string; avatar: string | null; role: "photographer" | "assistant" | "leader"; buildingId: number; currentRoom: string | null; status: string; onlineStatus: string; isOnline: boolean; department: string | null; group: string | null; building: { id: number; name: string } };
type Category = { id: number; name: string; description: string | null; priorityLevel: number; minDuration: number; maxDuration: number; estDuration: number; hexColor: string; sortRank: number };
type SystemConfigMap = Record<string, { value: string; label: string | null }>;

const TABS: { key: TabKey; label: string; color: string; bg: string; activeBg: string }[] = [
  { key: "profiles", label: "人员管理", color: "#3b82f6", bg: "#dbeafe", activeBg: "#eff6ff" },
  { key: "spaces", label: "空间管理", color: "#f59e0b", bg: "#fef3c7", activeBg: "#fffbeb" },
  { key: "approvals", label: "审批管理", color: "#22c55e", bg: "#dcfce7", activeBg: "#f0fdf4" },
  { key: "tasks", label: "逻辑设置", color: "#a855f7", bg: "#f3e8ff", activeBg: "#faf5ff" },
  { key: "stats", label: "数据统计", color: "#ef4444", bg: "#fee2e2", activeBg: "#fef2f2" },
];

/* Chrome-style tab SVG — bottom edge is a flat line so it seamlessly connects to content */
function ChromeTab({ fill }: { fill: string }) {
  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
    >
      <path
        d="M 0 40 L 0 40 C 4 40, 8 36, 12 10 C 14 2, 18 0, 24 0 L 176 0 C 182 0, 186 2, 188 10 C 192 36, 196 40, 200 40 L 200 40 Z"
        fill={fill}
      />
    </svg>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>("profiles");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [config, setConfig] = useState<SystemConfigMap>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, cRes, cfgRes] = await Promise.all([
        fetch("/api/profiles"),
        fetch("/api/buildings"),
        fetch("/api/categories"),
        fetch("/api/config"),
      ]);
      const pData = await pRes.json();
      const bData = await bRes.json();
      const cData = await cRes.json();
      const cfgData = await cfgRes.json().catch(() => ({}));
      setProfiles(Array.isArray(pData) ? pData : []);
      setBuildings(Array.isArray(bData) ? bData : []);
      setCategories(Array.isArray(cData) ? cData : []);
      setConfig(cfgData && typeof cfgData === "object" ? cfgData : {});
    } catch (e) {
      console.error("Failed to fetch data", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="h-screen overflow-y-scroll bg-gray-50/50 px-8 py-6">
      <div className="flex flex-col max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <a href="/photographer" className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors" title="返回工作台">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            <span className="text-sm font-semibold">返回工作台</span>
          </a>
        </div>

        {/* Chrome-style tabs + content */}
        <div className="relative">
          {/* Tabs row */}
          <div className="relative flex items-end" style={{ height: "72px", zIndex: 1 }}>
            {TABS.map((t, i) => {
              const isActive = tab === t.key;
              const zIndex = isActive ? 20 : TABS.length - i;
              const TAB_WIDTH = 240;
              const OVERLAP = 20;
              const left = i * (TAB_WIDTH - OVERLAP);

              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute bottom-0 cursor-pointer flex items-center justify-center"
                  style={{
                    left,
                    width: TAB_WIDTH,
                    height: 72,
                    zIndex,
                    transform: isActive ? "translateX(12px) scale(1.02)" : "translateX(0) scale(1)",
                    transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s",
                    transformOrigin: "bottom center",
                  }}
                >
                  <ChromeTab fill={isActive ? "#ffffff" : t.bg} />
                  <span
                    className="relative z-10 font-extrabold select-none whitespace-nowrap"
                    style={{
                      color: t.color,
                      opacity: isActive ? 1 : 0.65,
                      fontSize: "28px",
                    }}
                  >
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Content area */}
          <div
            className="relative bg-white rounded-2xl shadow-sm p-6"
            style={{ minHeight: "calc(100vh - 200px)" }}
          >
            {loading ? (
              <div className="flex items-center justify-center py-20 text-[--text-muted]">加载中...</div>
            ) : (
              <>
                {tab === "profiles" && <ProfilesTab profiles={profiles} buildings={buildings} onRefresh={fetchData} />}
                {tab === "spaces" && <SpaceTab buildings={buildings} onRefresh={fetchData} />}
                {tab === "tasks" && <TaskLogicTab categories={categories} config={config} onRefresh={fetchData} />}
                {tab === "approvals" && <ApprovalTab config={config} onRefresh={fetchData} />}
                {tab === "stats" && <StatsTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
