"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";

type Building = { id: number; name: string; floorPlanUrl: string | null; rooms: Room[] };
type Room = { id: number; buildingId: number; roomNumber: string; floor: number; xPosition: number; yPosition: number; fenceRadius: number };
type Profile = { id: string; employeeId: string | null; name: string; avatar: string | null; role: "photographer" | "assistant" | "leader"; buildingId: number; currentRoom: string | null; status: string; onlineStatus: string; isOnline: boolean; building: { id: number; name: string } };

const ROLE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  photographer: { label: "摄影师", color: "text-orange-600", bg: "bg-orange-50" },
  assistant: { label: "助理", color: "text-green-600", bg: "bg-green-50" },
  leader: { label: "组长", color: "text-blue-600", bg: "bg-blue-50" },
};

const ROLE_CN_MAP: Record<string, string> = {
  "摄影师": "photographer",
  "助理": "assistant",
  "组长": "leader",
};

const ONLINE_STATUS_MAP: Record<string, { label: string; color: string; bg: string; next: string }> = {
  online: { label: "在线", color: "text-green-600", bg: "bg-green-50", next: "offline" },
  offline: { label: "离线", color: "text-gray-500", bg: "bg-gray-100", next: "on_break" },
  on_break: { label: "休息中", color: "text-orange-600", bg: "bg-orange-50", next: "online" },
};

export default function ProfilesTab({
  profiles,
  buildings,
  onRefresh,
}: {
  profiles: Profile[];
  buildings: Building[];
  onRefresh: () => void;
}) {
  const [filterRole, setFilterRole] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const filteredProfiles = profiles.filter((p) => {
    if (filterRole && p.role !== filterRole) return false;
    if (filterBuilding && p.buildingId !== parseInt(filterBuilding)) return false;
    return true;
  });

  const stats = {
    photographers: profiles.filter((p) => p.role === "photographer").length,
    assistants: profiles.filter((p) => p.role === "assistant").length,
    leaders: profiles.filter((p) => p.role === "leader").length,
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
    await fetch(`/api/profiles/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlineStatus: info.next }),
    });
    onRefresh();
  }

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "摄影师数", value: stats.photographers, bg: "bg-orange-50", color: "text-orange-600", icon: "📷" },
          { label: "助理数", value: stats.assistants, bg: "bg-green-50", color: "text-green-600", icon: "🤝" },
          { label: "组长数", value: stats.leaders, bg: "bg-blue-50", color: "text-blue-600", icon: "👔" },
          { label: "总人数", value: stats.total, bg: "bg-purple-50", color: "text-purple-600", icon: "👥" },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[--text-muted] font-medium">{s.label}</span>
              <span className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center text-lg`}>{s.icon}</span>
            </div>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
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
            <option value="leader">组长</option>
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
        </div>
        <div className="flex gap-2">
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
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-3 px-3 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider">
            <span>姓名</span><span>工号</span><span>角色</span><span>所属楼座</span><span>当前房间</span><span>在线状态</span><span>操作</span>
          </div>
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-8 text-[--text-muted] text-sm">暂无数据</div>
          ) : (
            filteredProfiles.map((p) => {
              const r = ROLE_MAP[p.role];
              const os = ONLINE_STATUS_MAP[p.onlineStatus || "offline"] || ONLINE_STATUS_MAP.offline;
              return (
                <div key={p.id} className="grid grid-cols-7 gap-3 px-3 py-3 rounded-xl bg-[--bg-base] hover:bg-gray-100 transition-colors items-center">
                  <span className="text-sm font-medium text-[--text-primary]">{p.name}</span>
                  <span className="text-xs text-[--text-muted] font-mono">{p.employeeId || "—"}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md w-fit ${r.bg} ${r.color}`}>{r.label}</span>
                  <span className="text-xs text-[--text-secondary]">{p.building.name}</span>
                  <span className="text-xs text-[--text-secondary]">{p.currentRoom || "—"}</span>
                  <button
                    onClick={() => toggleOnlineStatus(p)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md w-fit cursor-pointer ${os.bg} ${os.color} hover:opacity-80 transition-opacity`}
                  >
                    {os.label}
                  </button>
                  <div className="flex gap-1.5">
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
      </div>

      {/* Modals */}
      {showProfileModal && (
        <ProfileModal
          profile={editingProfile}
          buildings={buildings}
          onClose={() => setShowProfileModal(false)}
          onSaved={onRefresh}
        />
      )}
      {showImportModal && (
        <ImportModal
          buildings={buildings}
          onClose={() => setShowImportModal(false)}
          onImported={onRefresh}
        />
      )}
    </>
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
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    employeeId: profile?.employeeId || "",
    name: profile?.name || "",
    role: profile?.role || "photographer",
    buildingId: profile?.buildingId?.toString() || (buildings[0]?.id?.toString() || ""),
    currentRoom: profile?.currentRoom || "",
    avatar: profile?.avatar || "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.buildingId) return;
    setSaving(true);

    const payload = { ...form, buildingId: parseInt(form.buildingId) };

    if (profile) {
      await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setSaving(false);
    onSaved();
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
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
            >
              <option value="photographer">摄影师</option>
              <option value="assistant">助理</option>
              <option value="leader">组长</option>
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
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">当前房间</label>
            <input
              value={form.currentRoom}
              onChange={(e) => setForm({ ...form, currentRoom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：101"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">头像URL</label>
            <input
              value={form.avatar}
              onChange={(e) => setForm({ ...form, avatar: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="可选"
            />
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
  const [rows, setRows] = useState<{ employeeId: string; name: string; role: string; building: string; room: string; error?: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: { index: number; name: string; error: string }[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["工号", "姓名", "角色", "所属楼座", "当前房间"],
      ["EMP001", "张三", "摄影师", "1号楼", "101"],
      ["EMP002", "李四", "助理", "2号楼", "202"],
    ]);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "人员信息");
    XLSX.writeFile(wb, "人员导入模板.xlsx");
  }

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

      const parsed = json.map((row) => {
        const employeeId = (row["工号"] || "").toString().trim();
        const name = (row["姓名"] || "").trim();
        const roleCn = (row["角色"] || "").trim();
        const building = (row["所属楼座"] || "").trim();
        const room = (row["当前房间"] || "").toString().trim();
        const role = ROLE_CN_MAP[roleCn];

        let error: string | undefined;
        if (!name) error = "缺少姓名";
        else if (!role) error = `无效角色: ${roleCn}`;
        else if (!building) error = "缺少楼座";
        else if (!buildings.find((b) => b.name === building)) error = `楼座不存在: ${building}`;

        return { employeeId, name, role: role || roleCn, building, room, error };
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
                <div className="grid grid-cols-6 gap-3 px-3 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider sticky top-0 bg-[--bg-card] py-1">
                  <span>#</span><span>工号</span><span>姓名</span><span>角色</span><span>楼座</span><span>房间</span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className={`grid grid-cols-6 gap-3 px-3 py-2 rounded-xl items-center ${r.error ? "bg-red-50" : "bg-[--bg-base]"}`}>
                    <span className="text-xs text-[--text-muted]">{i + 1}</span>
                    <span className="text-xs text-[--text-secondary] font-mono">{r.employeeId || "—"}</span>
                    <span className="text-xs font-medium text-[--text-primary]">{r.name || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.role}</span>
                    <span className="text-xs text-[--text-secondary]">{r.building || "—"}</span>
                    <span className="text-xs text-[--text-secondary]">{r.room || "—"}</span>
                    {r.error && <span className="col-span-6 text-[10px] text-red-500 -mt-1">{r.error}</span>}
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
