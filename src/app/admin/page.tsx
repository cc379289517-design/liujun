"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import ProfilesTab from "./ProfilesTab";
import SpaceTab from "./SpaceTab";
import TaskLogicTab from "./TaskLogicTab";
import ApprovalTab from "./ApprovalTab";
import StatsTab from "./StatsTab";
import { WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY } from "@/lib/workbenchBackground";

type TabKey = "profiles" | "spaces" | "tasks" | "approvals" | "stats";

type Room = { id: number; buildingId: number; roomNumber: string; floor: number; xPosition: number; yPosition: number; fenceRadius: number };
type IroningMachine = { id: number; buildingId: number; name: string; status: "normal" | "maintenance"; xPosition: number; yPosition: number; sortRank: number };
type Building = { id: number; name: string; floorPlanUrl: string | null; cropX?: number | null; cropY?: number | null; cropW?: number | null; cropH?: number | null; extraVenues: string | null; rooms: Room[]; ironingMachines: IroningMachine[] };
type Profile = { id: string; employeeId: string | null; name: string; avatar: string | null; role: "photographer" | "assistant" | "assistant_leader" | "admin"; buildingId: number; currentRoom: string | null; status: string; onlineStatus: string; isOnline: boolean; department: string | null; group: string | null; building: { id: number; name: string } };
type Category = { id: number; name: string; description: string | null; priorityLevel: number; minDuration: number; maxDuration: number; estDuration: number; hexColor: string; sortRank: number; canBeInterrupted: boolean; maxInterruptMinutes: number | null };
type SystemConfigMap = Record<string, { value: string; label: string | null }>;
type ThemeMode = "light" | "dark" | "auto";

const TABS: { key: TabKey; label: string; color: string; bg: string; activeBg: string }[] = [
  { key: "profiles", label: "人员管理", color: "#3b82f6", bg: "#dbeafe", activeBg: "#eff6ff" },
  { key: "spaces", label: "空间管理", color: "#f59e0b", bg: "#fef3c7", activeBg: "#fffbeb" },
  { key: "approvals", label: "审批管理", color: "#22c55e", bg: "#dcfce7", activeBg: "#f0fdf4" },
  { key: "tasks", label: "逻辑设置", color: "#a855f7", bg: "#f3e8ff", activeBg: "#faf5ff" },
  { key: "stats", label: "数据统计", color: "#ef4444", bg: "#fee2e2", activeBg: "#fef2f2" },
];

/* Chrome-style tab SVG — bottom edge is a flat line so it seamlessly connects to content */
function getAutoTheme(): "light" | "dark" {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "light" : "dark";
}

function ChromeTab({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
    >
      <path
        d="M 0 40 L 0 40 C 4 40, 8 36, 12 10 C 14 2, 18 0, 24 0 L 176 0 C 182 0, 186 2, 188 10 C 192 36, 196 40, 200 40 L 200 40 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
      />
    </svg>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>("profiles");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [hasFullBuildings, setHasFullBuildings] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [config, setConfig] = useState<SystemConfigMap>({});
  const [loading, setLoading] = useState(true);
  const isDark = resolvedTheme === "dark";
  const adminPageBackground = String(config[WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]?.value ?? "");
  const adminShellStyle: CSSProperties | undefined = adminPageBackground
    ? {
        backgroundColor: isDark ? "#0f1117" : "#eef1f5",
        backgroundImage: isDark
          ? `linear-gradient(135deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.56) 48%, rgba(2, 6, 23, 0.72)), url("${adminPageBackground}")`
          : `linear-gradient(135deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.18) 48%, rgba(255, 250, 244, 0.28)), url("${adminPageBackground}")`,
        backgroundSize: "auto, cover",
        backgroundPosition: "center, center",
        backgroundRepeat: "no-repeat, no-repeat",
      }
    : undefined;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, cRes, cfgRes] = await Promise.all([
        fetch("/api/profiles?view=admin"),
        fetch("/api/buildings?view=summary"),
        fetch("/api/categories"),
        fetch("/api/config"),
      ]);
      const pData = await pRes.json();
      const bData = await bRes.json();
      const cData = await cRes.json();
      const cfgData = await cfgRes.json().catch(() => ({}));
      setProfiles(Array.isArray(pData) ? pData : []);
      setBuildings(Array.isArray(bData) ? bData : []);
      setHasFullBuildings(false);
      setCategories(Array.isArray(cData) ? cData : []);
      setConfig(cfgData && typeof cfgData === "object" ? cfgData : {});
    } catch (e) {
      console.error("Failed to fetch data", e);
    }
    setLoading(false);
  }, []);

  const fetchSpaceData = useCallback(async () => {
    try {
      const [buildingRes, cfgRes] = await Promise.all([
        fetch("/api/buildings?view=full"),
        fetch("/api/config"),
      ]);
      if (buildingRes.ok) {
        const data = await buildingRes.json();
        setBuildings(Array.isArray(data) ? data : []);
        setHasFullBuildings(true);
      }
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json().catch(() => ({}));
        setConfig(cfgData && typeof cfgData === "object" ? cfgData : {});
      }
    } catch (e) {
      console.error("Failed to fetch space data", e);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("themeMode") as ThemeMode | null;
      if (saved === "light" || saved === "dark" || saved === "auto") {
        setThemeMode(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const apply = () => {
      const next = themeMode === "auto" ? getAutoTheme() : themeMode;
      setResolvedTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    apply();
    const timer = window.setInterval(apply, 1000);
    return () => window.clearInterval(timer);
  }, [themeMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (tab === "spaces" && !hasFullBuildings) {
      void fetchSpaceData();
    }
  }, [fetchSpaceData, hasFullBuildings, tab]);

  return (
    <div className={`admin-shell ${adminPageBackground ? "admin-shell--custom-bg" : ""} h-screen overflow-y-scroll px-8 py-6`} style={adminShellStyle}>
      <div className="relative z-10 flex flex-col max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <a href="/photographer" className="admin-back-link flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors" title="返回工作台">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            <span>返回工作台</span>
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
                  className="admin-tab absolute bottom-0 cursor-pointer flex items-center justify-center"
                  style={{
                    left,
                    width: TAB_WIDTH,
                    height: 72,
                    zIndex,
                    "--tab-color": t.color,
                    transform: isActive ? "translateX(12px) scale(1.02)" : "translateX(0) scale(1)",
                    transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s",
                    transformOrigin: "bottom center",
                  } as CSSProperties}
                >
	                  <ChromeTab
	                    fill={isDark
	                      ? isActive
	                        ? "rgba(30,41,59,0.82)"
	                        : "rgba(15,23,42,0.62)"
	                      : isActive ? "rgba(255,255,255,0.66)" : t.bg}
	                    stroke={isDark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.72)"}
	                  />
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
            className="admin-surface relative p-6"
            style={{ minHeight: "calc(100vh - 200px)" }}
          >
            {loading ? (
              <div className="flex items-center justify-center py-20 text-[--text-muted]">加载中...</div>
            ) : (
              <>
                {tab === "profiles" && <ProfilesTab profiles={profiles} buildings={buildings} onRefresh={fetchData} />}
                {tab === "spaces" && (
                  hasFullBuildings ? (
                    <SpaceTab buildings={buildings} config={config} onRefresh={fetchSpaceData} />
                  ) : (
                    <div className="flex items-center justify-center py-20 text-[--text-muted]">正在加载空间数据...</div>
                  )
                )}
                {tab === "tasks" && <TaskLogicTab categories={categories} buildings={buildings} config={config} onRefresh={fetchData} />}
                {tab === "approvals" && <ApprovalTab config={config} profiles={profiles} buildings={buildings} onRefresh={fetchData} />}
                {tab === "stats" && <StatsTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
