"use client";

import { useState, useEffect, useCallback } from "react";
import ProfilesTab from "./ProfilesTab";
import SpaceTab from "./SpaceTab";
import TaskLogicTab from "./TaskLogicTab";
import ApprovalTab from "./ApprovalTab";

type TabKey = "profiles" | "spaces" | "tasks" | "approvals";

const TABS: { key: TabKey; label: string; bg: string; activeBg: string; text: string }[] = [
  { key: "profiles", label: "人员管理", bg: "bg-blue-100/70", activeBg: "bg-blue-50", text: "text-blue-600" },
  { key: "spaces", label: "空间管理", bg: "bg-amber-100/70", activeBg: "bg-amber-50", text: "text-amber-600" },
  { key: "approvals", label: "审批管理", bg: "bg-green-100/70", activeBg: "bg-green-50", text: "text-green-600" },
  { key: "tasks", label: "逻���设置", bg: "bg-purple-100/70", activeBg: "bg-purple-50", text: "text-purple-500" },
];

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
          <a href="/photographer" className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors shadow-sm" title="返回前台">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </a>
          <div>
            <h1 className="text-2xl font-bold text-[--text-primary]">后台管理</h1>
            <p className="text-sm text-[--text-muted] mt-0.5">人员 · 空间 · 审批 · 逻辑设置</p>
          </div>
        </div>

        {/* Folder-style tabs + content */}
        <div className="relative">
          {/* Tabs row */}
          <div className="flex w-full relative" style={{ marginBottom: "-1px", height: "72px" }}>
            {TABS.map((t, i) => {
              const isActive = tab === t.key;
              const zIndex = isActive ? 10 : TABS.length - i;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`absolute top-0 h-full cursor-pointer flex items-center ${t.bg}`}
                  style={{
                    left: `${i * 24}%`,
                    width: "30%",
                    zIndex,
                    clipPath: "polygon(0 0, 85% 0, 100% 100%, 0 100%)",
                    borderRadius: "16px 16px 0 0",
                    paddingLeft: "24px",
                  }}
                >
                  <span className={`font-extrabold text-xl ${t.text}`}>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content area */}
          <div className="bg-white rounded-b-2xl shadow-sm p-6" style={{ minHeight: "calc(100vh - 200px)" }}>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-[--text-muted]">加载中...</div>
            ) : (
              <>
                {tab === "profiles" && <ProfilesTab profiles={profiles} buildings={buildings} onRefresh={fetchData} />}
                {tab === "spaces" && <SpaceTab buildings={buildings} onRefresh={fetchData} />}
                {tab === "tasks" && <TaskLogicTab categories={categories} config={config} onRefresh={fetchData} />}
                {tab === "approvals" && <ApprovalTab config={config} onRefresh={fetchData} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
