"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type TaskFromAPI = {
  id: string;
  photographerId: string;
  assistantId: string | null;
  roomNumber: string;
  categoryId: number;
  priority: number;
  status: "waiting" | "executing" | "paused" | "completed";
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estEndTime: string | null;
  photographer: { id: string; name: string; currentRoom: string | null };
  assistant: { id: string; name: string; currentRoom: string | null } | null;
  category: { id: number; name: string; priorityLevel: number };
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  waiting: { label: "等待中", cls: "text-gray-500 bg-gray-100" },
  executing: { label: "进行中", cls: "text-orange-600 bg-orange-50" },
  paused: { label: "已暂停", cls: "text-yellow-600 bg-yellow-50" },
  completed: { label: "已完成", cls: "text-green-600 bg-green-50" },
};

const PRIORITY_LABEL: Record<number, { label: string; cls: string }> = {
  1: { label: "P1 紧急", cls: "text-red-600 bg-red-50" },
  2: { label: "P2 高", cls: "text-orange-600 bg-orange-50" },
  3: { label: "P3 中", cls: "text-amber-600 bg-amber-50" },
  4: { label: "P4 低", cls: "text-blue-600 bg-blue-50" },
};

const TYPE_COLORS: Record<string, string> = {
  "短时手持": "bg-red-400", "手持": "bg-red-400",
  "服装穿戴": "bg-orange-400", "穿戴对角度": "bg-orange-400",
  "手工DIY协助": "bg-amber-400", "手工DIY制作": "bg-amber-400", "手工DIY": "bg-amber-400",
  "短时熨烫": "bg-emerald-400", "长时熨烫": "bg-emerald-400", "熨烫": "bg-emerald-400",
  "其他长时任务": "bg-blue-400", "其他": "bg-blue-400",
};

export default function StatsTab() {
  const [tasks, setTasks] = useState<TaskFromAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const filtered = useMemo(() => tasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== Number(filterPriority)) return false;
    if (filterCategory && t.category.name !== filterCategory) return false;
    return true;
  }), [tasks, filterStatus, filterPriority, filterCategory]);

  // --- 统计数据 ---
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const executing = tasks.filter((t) => t.status === "executing").length;
    const waiting = tasks.filter((t) => t.status === "waiting").length;
    const paused = tasks.filter((t) => t.status === "paused").length;

    // 平均完成时长
    const completedTasks = tasks.filter((t) => t.status === "completed" && t.startedAt && t.completedAt);
    const avgDuration = completedTasks.length > 0
      ? Math.round(completedTasks.reduce((sum, t) => sum + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60000, 0) / completedTasks.length)
      : 0;

    // 按类型统计（归类到5大预约类型）
    const CATEGORY_GROUP: Record<string, string> = {
      "短时手持": "手持", "手持": "手持",
      "服装穿戴": "服装穿戴", "穿戴对角度": "服装穿戴",
      "手工DIY协助": "手工DIY", "手工DIY制作": "手工DIY", "手工DIY": "手工DIY",
      "短时熨烫": "熨烫", "长时熨烫": "熨烫", "熨烫": "熨烫",
      "其他长时任务": "其他", "其他": "其他",
    };
    const byCategory: Record<string, number> = {};
    for (const t of tasks) {
      const group = CATEGORY_GROUP[t.category.name] || "其他";
      byCategory[group] = (byCategory[group] || 0) + 1;
    }
    const typeOrder = ["手持", "服装穿戴", "手工DIY", "熨烫", "其他"];
    const categoryBreakdown = typeOrder
      .filter((name) => byCategory[name])
      .map((name) => ({ name, count: byCategory[name], pct: total > 0 ? Math.round((byCategory[name] / total) * 100) : 0 }));

    // 按优先级统计
    const byPriority: Record<number, number> = {};
    for (const t of tasks) {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }

    // 按摄影师统计
    const byPhotographer: Record<string, { name: string; total: number; completed: number }> = {};
    for (const t of tasks) {
      if (!byPhotographer[t.photographerId]) {
        byPhotographer[t.photographerId] = { name: t.photographer.name, total: 0, completed: 0 };
      }
      byPhotographer[t.photographerId].total++;
      if (t.status === "completed") byPhotographer[t.photographerId].completed++;
    }
    const photographerRanking = Object.values(byPhotographer).sort((a, b) => b.total - a.total);

    // 按助理统计
    const byAssistant: Record<string, { name: string; total: number; completed: number }> = {};
    for (const t of tasks) {
      if (t.assistantId && t.assistant) {
        if (!byAssistant[t.assistantId]) {
          byAssistant[t.assistantId] = { name: t.assistant.name, total: 0, completed: 0 };
        }
        byAssistant[t.assistantId].total++;
        if (t.status === "completed") byAssistant[t.assistantId].completed++;
      }
    }
    const assistantRanking = Object.values(byAssistant).sort((a, b) => b.total - a.total);

    return { total, completed, executing, waiting, paused, avgDuration, categoryBreakdown, byPriority, photographerRanking, assistantRanking };
  }, [tasks]);

  const categories = useMemo(() => [...new Set(tasks.map((t) => t.category.name))], [tasks]);

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const getDuration = (t: TaskFromAPI) => {
    if (t.status === "completed" && t.startedAt && t.completedAt) {
      return `${Math.floor((new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / 60000)}分钟`;
    }
    if (t.status === "executing" && t.startedAt) {
      return `已${Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 60000)}分钟`;
    }
    return "—";
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-[--text-muted]">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "总任务", value: stats.total, color: "text-purple-600", bg: "bg-purple-50", icon: "📋" },
          { label: "已完成", value: stats.completed, color: "text-green-600", bg: "bg-green-50", icon: "✅" },
          { label: "进行中", value: stats.executing, color: "text-orange-600", bg: "bg-orange-50", icon: "🔥" },
          { label: "等待中", value: stats.waiting, color: "text-gray-600", bg: "bg-gray-100", icon: "⏳" },
          { label: "平均用时", value: `${stats.avgDuration}分`, color: "text-blue-600", bg: "bg-blue-50", icon: "⏱" },
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

      {/* Analysis row */}
      <div className="grid grid-cols-2 gap-4">
        {/* 左：任务类型占比 */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[--text-primary] mb-4">任务类型占比</h3>
          {stats.categoryBreakdown.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">暂无数据</div>
          ) : (
            <div className="space-y-3">
              {stats.categoryBreakdown.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-[--text-primary]">{c.name}</span>
                    <span className="text-xs text-[--text-muted]">{c.count}单 · {c.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${TYPE_COLORS[c.name] || "bg-gray-400"}`} style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右：优先���分布 + 完成率 */}
        <div className="flex flex-col gap-4">
          {/* 优先级分布 */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-[--text-primary] mb-4">优先级分布</h3>
            <div className="space-y-3">
              {[1, 2, 3, 4].map((p) => {
                const count = stats.byPriority[p] || 0;
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                const info = PRIORITY_LABEL[p];
                return (
                  <div key={p}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${info.cls}`}>{info.label}</span>
                      <span className="text-xs text-[--text-muted]">{count}单 · {pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 完成率 */}
          <div className="card p-5 flex-1">
            <h3 className="text-sm font-semibold text-[--text-primary] mb-4">任务完成率</h3>
            <div className="flex items-center justify-center py-2">
              <div className="relative w-28 h-28">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray={`${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}, 100`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-green-600">{stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%</span>
                <span className="text-[10px] text-[--text-muted]">{stats.completed}/{stats.total}</span>
              </div>
            </div>
          </div>
          {stats.paused > 0 && (
            <div className="text-center text-xs text-yellow-600 mt-2">暂停中: {stats.paused}单</div>
          )}
          </div>
        </div>
      </div>

      {/* Personnel ranking row */}
      <div className="grid grid-cols-2 gap-4">
        {/* 摄影师排行 */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[--text-primary] mb-3">摄影师任务排行</h3>
          {stats.photographerRanking.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">暂无数据</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center text-[10px] text-[--text-muted] font-medium px-2 py-1">
                <span className="w-[8%]">#</span>
                <span className="w-[32%]">摄影师</span>
                <span className="w-[20%] text-right">总任务</span>
                <span className="w-[20%] text-right">已完成</span>
                <span className="w-[20%] text-right">完成率</span>
              </div>
              {stats.photographerRanking.slice(0, 10).map((p, i) => (
                <div key={p.name} className="flex items-center text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className={`w-[8%] font-bold ${i < 3 ? "text-orange-500" : "text-[--text-muted]"}`}>{i + 1}</span>
                  <span className="w-[32%] font-medium text-[--text-primary]">{p.name}</span>
                  <span className="w-[20%] text-right text-[--text-muted]">{p.total}</span>
                  <span className="w-[20%] text-right text-green-600">{p.completed}</span>
                  <span className="w-[20%] text-right text-[--text-muted]">{p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 助理排行 */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[--text-primary] mb-3">助理任务排行</h3>
          {stats.assistantRanking.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">暂无数据</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center text-[10px] text-[--text-muted] font-medium px-2 py-1">
                <span className="w-[8%]">#</span>
                <span className="w-[32%]">助理</span>
                <span className="w-[20%] text-right">总��务</span>
                <span className="w-[20%] text-right">已完成</span>
                <span className="w-[20%] text-right">完成率</span>
              </div>
              {stats.assistantRanking.slice(0, 10).map((a, i) => (
                <div key={a.name} className="flex items-center text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className={`w-[8%] font-bold ${i < 3 ? "text-orange-500" : "text-[--text-muted]"}`}>{i + 1}</span>
                  <span className="w-[32%] font-medium text-[--text-primary]">{a.name}</span>
                  <span className="w-[20%] text-right text-[--text-muted]">{a.total}</span>
                  <span className="w-[20%] text-right text-green-600">{a.completed}</span>
                  <span className="w-[20%] text-right text-[--text-muted]">{a.total > 0 ? Math.round((a.completed / a.total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Task detail table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[--text-primary]">任务明细 ({filtered.length})</h3>
          <div className="flex gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[--bg-base] border border-gray-200 text-xs text-[--text-secondary] outline-none"
            >
              <option value="">全部状态</option>
              <option value="waiting">等待中</option>
              <option value="executing">进行中</option>
              <option value="paused">已暂停</option>
              <option value="completed">已完成</option>
            </select>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[--bg-base] border border-gray-200 text-xs text-[--text-secondary] outline-none"
            >
              <option value="">全部优先级</option>
              <option value="1">P1 紧急</option>
              <option value="2">P2 ��</option>
              <option value="3">P3 中</option>
              <option value="4">P4 低</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[--bg-base] border border-gray-200 text-xs text-[--text-secondary] outline-none"
            >
              <option value="">全部类型</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={fetchTasks}
              className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 text-xs font-medium hover:bg-purple-100 transition-colors"
            >
              刷新
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <div className="grid grid-cols-9 gap-2 px-3 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider">
            <span>类型</span><span>房间</span><span>优先级</span><span>摄影师</span><span>助理</span><span>创建时间</span><span>开始时间</span><span>用时</span><span>状态</span>
          </div>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-[--text-muted] text-sm">暂无数据</div>
          ) : (
            filtered.map((t) => {
              const st = STATUS_STYLE[t.status] || STATUS_STYLE.waiting;
              const pr = PRIORITY_LABEL[t.priority] || PRIORITY_LABEL[4];
              return (
                <div key={t.id} className="grid grid-cols-9 gap-2 px-3 py-2.5 rounded-xl bg-[--bg-base] hover:bg-gray-50 transition-colors items-center">
                  <span className="text-xs font-medium text-[--text-primary]">{t.category.name}</span>
                  <span className="text-xs text-[--text-secondary]">{t.roomNumber}室</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded w-fit ${pr.cls}`}>{pr.label}</span>
                  <span className="text-xs text-[--text-secondary]">{t.photographer.name}</span>
                  <span className="text-xs text-[--text-secondary]">{t.assistant?.name || "—"}</span>
                  <span className="text-xs text-[--text-muted] tabular-nums">{formatTime(t.createdAt)}</span>
                  <span className="text-xs text-[--text-muted] tabular-nums">{formatTime(t.startedAt)}</span>
                  <span className="text-xs text-[--text-muted]">{getDuration(t)}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded w-fit ${st.cls}`}>{st.label}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
