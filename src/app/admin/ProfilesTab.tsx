"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";

type Building = { id: number; name: string; floorPlanUrl: string | null; rooms: Room[] };
type Room = { id: number; buildingId: number; roomNumber: string; floor: number; xPosition: number; yPosition: number; fenceRadius: number };
type Profile = { id: string; employeeId: string | null; name: string; avatar: string | null; role: "photographer" | "assistant" | "assistant_leader" | "admin"; buildingId: number; currentRoom: string | null; status: string; onlineStatus: string; isOnline: boolean; department: string | null; group: string | null; building: { id: number; name: string } };

const ROLE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  photographer: { label: "摄影师", color: "text-orange-600", bg: "bg-orange-50" },
  assistant: { label: "助理", color: "text-green-600", bg: "bg-green-50" },
  assistant_leader: { label: "助理组长", color: "text-blue-600", bg: "bg-blue-50" },
  admin: { label: "管理", color: "text-purple-600", bg: "bg-purple-50" },
};

const ROLE_CN_MAP: Record<string, string> = {
  "摄影师": "photographer",
  "助理": "assistant",
  "助理组长": "assistant_leader",
  "管理": "admin",
};

const ONLINE_STATUS_MAP: Record<string, { label: string; color: string; bg: string; next: string }> = {
  online: { label: "在线", color: "text-green-600", bg: "bg-green-50", next: "offline" },
  offline: { label: "离线", color: "text-gray-500", bg: "bg-gray-100", next: "on_break" },
  on_break: { label: "休息中", color: "text-orange-600", bg: "bg-orange-50", next: "online" },
};

export default function ProfilesTab({
  profiles: initialProfiles,
  buildings,
  onRefresh,
}: {
  profiles: Profile[];
  buildings: Building[];
  onRefresh: () => void;
}) {
  const [localProfiles, setLocalProfiles] = useState(initialProfiles);
  const [filterRole, setFilterRole] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // Sync when parent re-fetches
  const [prevProfiles, setPrevProfiles] = useState(initialProfiles);
  if (initialProfiles !== prevProfiles) {
    setPrevProfiles(initialProfiles);
    setLocalProfiles(initialProfiles);
  }

  const profiles = localProfiles;

  const departments = [...new Set(profiles.map((p) => p.department).filter(Boolean))] as string[];

  // Sort groups by department order: 摄影一部 → 摄影二部 → 全域优化组 → others
  const DEPT_ORDER = ["摄影一部", "摄影二部", "全域优化组"];
  const groupsByDept: { dept: string; group: string }[] = [];
  const seenGroups = new Set<string>();
  for (const dept of DEPT_ORDER) {
    profiles
      .filter((p) => p.department === dept && p.group)
      .forEach((p) => {
        if (!seenGroups.has(p.group!)) {
          seenGroups.add(p.group!);
          groupsByDept.push({ dept, group: p.group! });
        }
      });
  }
  // Append groups from other departments not in DEPT_ORDER
  profiles
    .filter((p) => p.group && (!p.department || !DEPT_ORDER.includes(p.department)))
    .forEach((p) => {
      if (!seenGroups.has(p.group!)) {
        seenGroups.add(p.group!);
        groupsByDept.push({ dept: p.department || "", group: p.group! });
      }
    });

  // Filter groupsByDept based on selected department
  const visibleGroups = filterDepartment
    ? groupsByDept.filter((g) => g.dept === filterDepartment)
    : groupsByDept;

  const filteredProfiles = profiles.filter((p) => {
    if (filterRole) {
      if (filterRole === "assistant") {
        // 助理筛选包含助理组长
        if (p.role !== "assistant" && p.role !== "assistant_leader") return false;
      } else if (filterRole === "admin") {
        // 管理筛选包含助理组长
        if (p.role !== "admin" && p.role !== "assistant_leader") return false;
      } else {
        if (p.role !== filterRole) return false;
      }
    }
    if (filterBuilding && p.buildingId !== parseInt(filterBuilding)) return false;
    if (filterDepartment && p.department !== filterDepartment) return false;
    if (filterGroup && p.group !== filterGroup) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = p.name.toLowerCase().includes(q)
        || (p.employeeId && p.employeeId.toLowerCase().includes(q))
        || (p.department && p.department.toLowerCase().includes(q))
        || (p.group && p.group.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const stats = {
    photographers: profiles.filter((p) => p.role === "photographer").length,
    assistants: profiles.filter((p) => p.role === "assistant" || p.role === "assistant_leader").length,
    admins: profiles.filter((p) => p.role === "admin" || p.role === "assistant_leader").length,
    total: profiles.length,
  };

  async function deleteProfile(id: string) {
    if (!confirm("确定删除此人员？")) return;
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    onRefresh();
  }

  async function toggleOnlineStatus(p: Profile) {
    const current = p.onlineStatus || "offline";
    const info = ONLINE_STATUS_MAP[current] || ONLINE_STATUS_MAP.offline;
    const nextStatus = info.next;
    // Optimistic local update
    setLocalProfiles((prev) =>
      prev.map((pr) => pr.id === p.id ? { ...pr, onlineStatus: nextStatus } : pr)
    );
    await fetch(`/api/profiles/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlineStatus: nextStatus }),
    });
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "摄影师数", value: stats.photographers, color: "text-orange-600", role: "photographer" },
          { label: "助理数", value: stats.assistants, color: "text-green-600", role: "assistant" },
          { label: "管理数", value: stats.admins, color: "text-purple-600", role: "admin" },
          { label: "总人数", value: stats.total, color: "text-purple-600", role: "" },
        ].map((s) => (
          <div
            key={s.label}
            onClick={() => setFilterRole(filterRole === s.role ? "" : s.role)}
            className={`card px-5 py-2.5 flex items-center justify-between cursor-pointer transition-all ${
              filterRole === s.role ? "ring-2 ring-purple-400 shadow-md" : "hover:shadow-md"
            }`}
          >
            <span className={`text-xl font-bold ${s.color}`}>{s.label}</span>
            <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters + Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[--bg-card] border border-gray-200 text-sm text-[--text-secondary] outline-none"
          >
            <option value="">全部角色</option>
            <option value="photographer">摄影师</option>
            <option value="assistant">助理</option>
            <option value="assistant_leader">助理组长</option>
            <option value="admin">管理</option>
          </select>
          <select
            value={filterBuilding}
            onChange={(e) => setFilterBuilding(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[--bg-card] border border-gray-200 text-sm text-[--text-secondary] outline-none"
          >
            <option value="">全部楼座</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select
            value={filterDepartment}
            onChange={(e) => { setFilterDepartment(e.target.value); setFilterGroup(""); }}
            className="px-3 py-2 rounded-xl bg-[--bg-card] border border-gray-200 text-sm text-[--text-secondary] outline-none"
          >
            <option value="">全部部门</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[--bg-card] border border-gray-200 text-sm text-[--text-secondary] outline-none"
          >
            <option value="">全部小组</option>
            {(() => {
              const items: React.ReactNode[] = [];
              let lastDept = "";
              for (const { dept, group } of visibleGroups) {
                if (dept && dept !== lastDept) {
                  items.push(<optgroup key={`dept-${dept}`} label={dept} />);
                  lastDept = dept;
                }
                items.push(<option key={group} value={group}>{group}</option>);
              }
              return items;
            })()}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-xl bg-[--bg-card] border border-gray-200 text-sm text-[--text-secondary] outline-none focus:border-purple-400 transition-colors w-48"
              placeholder="搜索姓名/工号/组..."
            />
          </div>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-semibold shadow-sm shadow-green-200 hover:shadow-green-300 transition-all active:scale-[0.98]"
          >
            批量导入
          </button>
          <button
            onClick={() => { setEditingProfile(null); setShowProfileModal(true); }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98]"
          >
            + 添加人员
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-5">
        <div className="space-y-1.5">
          <div className="grid grid-cols-9 gap-3 px-3 py-2.5 rounded-xl bg-gray-100 text-xs text-[--text-secondary] font-semibold tracking-wide">
            <span className="text-center">姓名</span><span className="text-center">工号</span><span className="text-center">角色</span><span className="text-center">部门</span><span className="text-center">小组</span><span className="text-center">所属楼座</span><span className="text-center">所属房间</span><span className="text-center">在线状态</span><span className="text-center">操作</span>
          </div>
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-8 text-[--text-muted] text-sm">暂无数据</div>
          ) : (
            filteredProfiles.map((p) => {
              const r = ROLE_MAP[p.role];
              const os = ONLINE_STATUS_MAP[p.onlineStatus || "offline"] || ONLINE_STATUS_MAP.offline;
              return (
                <div key={p.id} className="grid grid-cols-9 gap-3 px-3 py-2.5 rounded-xl bg-[--bg-base] hover:bg-gray-50 transition-colors items-center">
                  <span className="text-sm font-medium text-[--text-primary] text-center">{p.name}</span>
                  <span className="text-xs text-[--text-muted] font-mono text-center">{p.employeeId || "—"}</span>
                  <span className="flex justify-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${r.bg} ${r.color}`}>{r.label}</span></span>
                  <span className="text-xs text-[--text-secondary] text-center">{p.department || "—"}</span>
                  <span className="text-xs text-[--text-secondary] text-center">{p.group || "—"}</span>
                  <span className="text-xs text-[--text-secondary] text-center">{p.building.name}</span>
                  <span className="text-xs text-[--text-secondary] text-center">{p.currentRoom || "—"}</span>
                  <span className="flex justify-center">
                    <button
                      onClick={() => toggleOnlineStatus(p)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md cursor-pointer ${os.bg} ${os.color} hover:opacity-80 transition-opacity`}
                    >
                      {os.label}
                    </button>
                  </span>
                  <div className="flex gap-1.5 justify-center">
                    <button
                      onClick={() => { setEditingProfile(p); setShowProfileModal(true); }}
                      className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 text-blue-600 font-medium hover:bg-blue-100 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => deleteProfile(p.id)}
                      className="text-[10px] px-2 py-1 rounded-lg bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {/* Filtered count */}
        <div className="px-3 py-2 text-right">
          <span className="text-sm font-bold text-red-500">合计：{filteredProfiles.length} 人</span>
        </div>
      </div>
      {showProfileModal && createPortal(
        <ProfileModal
          profile={editingProfile}
          buildings={buildings}
          onClose={() => setShowProfileModal(false)}
          onSaved={(saved: Profile) => {
            if (editingProfile) {
              setLocalProfiles((prev) => prev.map((p) => p.id === saved.id ? saved : p));
            } else {
              setLocalProfiles((prev) => [...prev, saved]);
            }
          }}
        />,
        document.body
      )}
      {showImportModal && createPortal(
        <ImportModal
          buildings={buildings}
          onClose={() => setShowImportModal(false)}
          onImported={onRefresh}
        />,
        document.body
      )}
    </div>
  );
}

/* ============ Profile Modal ============ */
function ProfileModal({
  profile,
  buildings,
  onClose,
  onSaved,
}: {
  profile: Profile | null;
  buildings: Building[];
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const [form, setForm] = useState({
    employeeId: profile?.employeeId || "",
    name: profile?.name || "",
    role: profile?.role || "photographer",
    buildingId: profile?.buildingId?.toString() || (buildings[0]?.id?.toString() || ""),
    currentRoom: profile?.currentRoom || "",
    avatar: profile?.avatar || "",
    department: profile?.department || "",
    group: profile?.group || "",
  });
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarDragOver, setAvatarDragOver] = useState(false);

  const handleAvatarFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setForm((prev) => ({ ...prev, avatar: e.target?.result as string }));
    };
    reader.readAsDataURL(file);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.buildingId) return;
    setSaving(true);

    const payload = { ...form, buildingId: parseInt(form.buildingId) };

    let res: Response;
    if (profile) {
      res = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    const saved = await res.json();
    setSaving(false);
    onSaved(saved);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[--text-primary] mb-5">{profile ? "编辑人员" : "添加人员"}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">工号</label>
            <input
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：EMP001"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">姓名 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="请输入姓名"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">角色 *</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "photographer" | "assistant" | "assistant_leader" | "admin" })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
            >
              <option value="photographer">摄影师</option>
              <option value="assistant">助理</option>
              <option value="assistant_leader">助理组长</option>
              <option value="admin">管理</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">所属楼座 *</label>
            <select
              value={form.buildingId}
              onChange={(e) => setForm({ ...form, buildingId: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">部门</label>
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：摄影部"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">小组</label>
            <input
              value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：A组"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">所属房间</label>
            <input
              value={form.currentRoom}
              onChange={(e) => setForm({ ...form, currentRoom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：101"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">头像</label>
            <div
              className={`relative w-full rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                avatarDragOver ? "border-purple-400 bg-purple-50" : "border-gray-200 hover:border-purple-300"
              } ${form.avatar ? "p-2" : "p-6"}`}
              onClick={() => avatarInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setAvatarDragOver(true); }}
              onDragLeave={() => setAvatarDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setAvatarDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleAvatarFile(f); }}
            >
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f); }}
              />
              {form.avatar ? (
                <div className="flex items-center gap-3">
                  <img src={form.avatar} alt="头像预览" className="w-14 h-14 rounded-xl object-cover border border-gray-200" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[--text-secondary] truncate">已选择头像</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setForm({ ...form, avatar: "" }); }}
                      className="text-[10px] text-red-500 hover:text-red-600 mt-0.5"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" className="mx-auto mb-1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <p className="text-xs text-[--text-muted]">拖拽图片或点击上传</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-[--text-secondary] hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============ Import Modal ============ */
function ImportModal({
  buildings,
  onClose,
  onImported,
}: {
  buildings: Building[];
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ employeeId: string; name: string; role: string; building: string; room: string; department: string; group: string; error?: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: { index: number; name: string; error: string }[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function downloadTemplate() {
    const header = ["工号", "姓名", "角色", "部门", "小组", "所属楼座", "当前房间"];
    const examples = [
      ["WG0001", "张三", "摄影师", "摄影一部", "图片A0组", buildings[0]?.name || "南座四楼", "401"],
      ["WG0002", "李四", "助理", "摄影二部", "助理B1组", buildings[0]?.name || "南座四楼", "402"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...examples]);
    // Force all cells to text format so Excel won't strip leading characters
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr]) ws[addr].t = "s";
      }
    }
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "人员信息");
    XLSX.writeFile(wb, "人员导入模板.xlsx");
  }

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false });

      const parsed = json.map((row) => {
        const employeeId = String(row["工号"] ?? "").trim();
        const name = String(row["姓名"] ?? "").trim();
        const roleCn = String(row["角色"] ?? "").trim();
        const department = String(row["部门"] ?? "").trim();
        const group = String(row["小组"] ?? "").trim();
        const building = String(row["所属楼座"] ?? "").trim();
        const room = String(row["当前房间"] ?? "").trim();
        const role = ROLE_CN_MAP[roleCn];

        let error: string | undefined;
        if (!name) error = "缺少姓名";
        else if (!role) error = `无效角色: ${roleCn}`;
        else if (!building) error = "缺少楼座";
        else if (!buildings.find((b) => b.name === building)) error = `楼座不存在: ${building}`;

        return { employeeId, name, role: role || roleCn, building, room, department, group, error };
      });

      setRows(parsed);
      setResult(null);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  async function handleImport() {
    const valid = rows.filter((r) => !r.error);
    if (valid.length === 0) return;

    setImporting(true);
    const profiles = valid.map((r) => ({
      employeeId: r.employeeId || null,
      name: r.name,
      role: r.role,
      buildingId: buildings.find((b) => b.name === r.building)?.id,
      currentRoom: r.room || null,
      department: r.department || null,
      group: r.group || null,
    }));

    try {
      const res = await fetch("/api/profiles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles }),
      });
      const data = await res.json();
      setResult(data);
      onImported();
    } catch (err) {
      console.error("Import failed", err);
    }
    setImporting(false);
  }

  const validCount = rows.filter((r) => !r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[--text-primary]">批量导入人员</h2>
          <button onClick={downloadTemplate} className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-medium hover:bg-blue-100 transition-colors">
            下载模板
          </button>
        </div>

        {/* Upload Area */}
        {rows.length === 0 && !result && (
          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
              dragOver ? "border-purple-400 bg-purple-50" : "border-gray-200 hover:border-purple-300"
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelect} />
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="1.5" className="mx-auto mb-4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-sm font-medium text-[--text-primary]">拖拽 Excel 文件到此处，或点击选择</p>
            <p className="text-xs text-[--text-muted] mt-2">支持 .xlsx 格式</p>
          </div>
        )}

        {/* Preview Table */}
        {rows.length > 0 && !result && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-[--text-secondary]">
                共 {rows.length} 条，
                <span className="text-green-600 font-medium">{validCount} 条有效</span>
                {errorCount > 0 && <span className="text-red-500 font-medium">，{errorCount} 条错误</span>}
              </span>
              <button
                onClick={() => { setRows([]); if (fileRef.current) fileRef.current.value = ""; }}
                className="text-xs text-[--text-muted] hover:text-[--text-secondary] ml-auto"
              >
                重新选择
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <div className="space-y-1.5">
                <div className="grid grid-cols-8 gap-3 px-3 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider sticky top-0 bg-[--bg-card] py-1">
                  <span>#</span><span>工号</span><span>姓名</span><span>角色</span><span>部门</span><span>小组</span><span>楼座</span><span>房间</span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className={`grid grid-cols-8 gap-3 px-3 py-2 rounded-xl items-center ${r.error ? "bg-red-50" : "bg-[--bg-base]"}`}>
                    <span className="text-xs text-[--text-muted]">{i + 1}</span>
                    <span className="text-xs text-[--text-secondary] font-mono">{r.employeeId || "—"}</span>
                    <span className="text-xs font-medium text-[--text-primary]">{r.name || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.role}</span>
                    <span className="text-xs text-[--text-secondary]">{r.department || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.group || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.building || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.room || "—"}</span>
                    {r.error && <span className="col-span-8 text-[10px] text-red-500 -mt-1">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-4 mt-2 border-t border-gray-100">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-[--text-secondary] hover:bg-gray-50 transition-colors">
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validCount === 0}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {importing ? "导入中..." : `确认导入 ${validCount} 条`}
              </button>
            </div>
          </>
        )}

        {/* Result */}
        {result && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">{result.failed.length === 0 ? "✅" : "⚠️"}</div>
            <p className="text-lg font-bold text-[--text-primary] mb-2">
              成功导入 {result.success} 条
            </p>
            {result.failed.length > 0 && (
              <div className="mt-3 text-left">
                <p className="text-sm text-red-500 font-medium mb-2">失败 {result.failed.length} 条：</p>
                {result.failed.map((f, i) => (
                  <p key={i} className="text-xs text-[--text-muted]">第{f.index + 1}行 {f.name}：{f.error}</p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="mt-6 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 transition-all active:scale-[0.98]">
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
