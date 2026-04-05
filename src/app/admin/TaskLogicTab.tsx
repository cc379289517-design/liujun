"use client";

import { useState, useRef } from "react";

type Category = {
  id: number;
  name: string;
  description: string | null;
  priorityLevel: number;
  minDuration: number;
  maxDuration: number;
  estDuration: number;
  hexColor: string;
  sortRank: number;
};

type SystemConfigMap = Record<string, { value: string; label: string | null }>;

interface Props {
  categories: Category[];
  config: SystemConfigMap;
  onRefresh: () => void;
}

const PRIORITY_STYLES: Record<number, string> = {
  1: "bg-red-50 text-red-600 border-red-200",
  2: "bg-orange-50 text-orange-600 border-orange-200",
  3: "bg-amber-50 text-amber-600 border-amber-200",
  4: "bg-blue-50 text-blue-600 border-blue-200",
  5: "bg-gray-100 text-gray-600 border-gray-200",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 紧急",
  2: "P2 高",
  3: "P3 中",
  4: "P4 低",
  5: "P5 最低",
};

const PRIORITY_TIPS: Record<number, string> = {
  1: "紧急",
  2: "高",
  3: "中",
  4: "低",
  5: "最低",
};

const PRIORITY_BADGE: Record<number, string> = {
  1: "bg-red-50 text-red-600",
  2: "bg-orange-50 text-orange-600",
  3: "bg-amber-50 text-amber-600",
  4: "bg-blue-50 text-blue-600",
  5: "bg-gray-100 text-gray-500",
};

const PRIORITY_HEADING: Record<number, string> = {
  1: "text-red-600",
  2: "text-orange-600",
  3: "text-amber-600",
  4: "text-blue-600",
  5: "text-gray-500",
};

const CAT_HEADING: Record<string, string> = {
  "手持": "text-red-600",
  "服装穿戴": "text-orange-600",
  "手工DIY": "text-amber-600",
  "熨烫": "text-emerald-600",
  "其他": "text-blue-600",
};

const CAT_NAME_OPTIONS = ["手持", "服装穿戴", "手工DIY", "熨烫", "其他"];

function durationLabel(min: number, max: number): string {
  const hasMin = min > 0;
  const hasMax = max > 0;
  if (hasMin && hasMax) return `${min}-${max}分钟`;
  if (hasMax) return `${max}分钟以内`;
  if (hasMin) return `${min}分钟以上`;
  return "未设置";
}

const PARAM_DEFS = [
  { key: "ending_alert_min", min: 1, max: 10, step: 1, label: "快结束提醒(分钟)" },
  { key: "auto_finish_min", min: 1, max: 15, step: 1, label: "自动释放延迟(分钟)" },
  { key: "interruption_max", min: 10, max: 60, step: 5, label: "插单最大离场时间(分钟)" },
] as const;

type EditForm = {
  name: string;
  minDuration: number;
  maxDuration: number;
  priorityLevel: number;
};

export default function TaskLogicTab({ categories, config, onRefresh }: Props) {
  const [upgradeThreshold, setUpgradeThreshold] = useState(
    Number(config.upgrade_threshold?.value ?? 30)
  );
  const [params, setParams] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const d of PARAM_DEFS) {
      init[d.key] = Number(config[d.key]?.value ?? d.min);
    }
    return init;
  });
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", minDuration: 0, maxDuration: 0, priorityLevel: 3 });
  const [saving, setSaving] = useState(false);

  const [addingPriority, setAddingPriority] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<Omit<EditForm, "priorityLevel">>({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0 });

  const sorted = [...categories].sort((a, b) => a.priorityLevel - b.priorityLevel || a.sortRank - b.sortRank);

  const saveThreshold = async (val: number) => {
    setUpgradeThreshold(val);
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upgrade_threshold: val }),
      });
    } catch {}
  };

  const handleParamChange = (key: string, val: number) => {
    setParams((prev) => ({ ...prev, [key]: val }));
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      try {
        await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: val }),
        });
      } catch {}
    }, 500);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditForm({ name: cat.name, minDuration: cat.minDuration, maxDuration: cat.maxDuration, priorityLevel: cat.priorityLevel });
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    setSaving(true);
    const est = editForm.minDuration && editForm.maxDuration
      ? Math.round((editForm.minDuration + editForm.maxDuration) / 2)
      : editForm.maxDuration || editForm.minDuration || 10;
    try {
      await fetch(`/api/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, estDuration: est }),
      });
      setEditingId(null);
      onRefresh();
    } catch {} finally { setSaving(false); }
  };

  const deleteCategory = async (id: number) => {
    if (!confirm("确定删除此任务类型？")) return;
    try {
      await fetch(`/api/categories/${id}`, { method: "DELETE" });
      onRefresh();
    } catch {}
  };

  const saveAdd = async (priorityLevel: number) => {
    if (!addForm.name) return;
    setSaving(true);
    const est = addForm.minDuration && addForm.maxDuration
      ? Math.round((addForm.minDuration + addForm.maxDuration) / 2)
      : addForm.maxDuration || addForm.minDuration || 10;
    try {
      await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name,
          priorityLevel,
          minDuration: addForm.minDuration || 0,
          maxDuration: addForm.maxDuration || 0,
          estDuration: est,
          hexColor: "#3b82f6",
          sortRank: 0,
        }),
      });
      setAddingPriority(null);
      setAddForm({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0 });
      onRefresh();
    } catch {} finally { setSaving(false); }
  };

  const renderDurationFields = (
    form: { minDuration: number; maxDuration: number },
    setForm: (f: typeof form) => void
  ) => (
    <div className="grid grid-cols-2 gap-1.5">
      <div>
        <label className="text-[10px] text-gray-400">最短(分钟)</label>
        <input
          type="number"
          min={0}
          value={form.minDuration || ""}
          onChange={(e) => setForm({ ...form, minDuration: Number(e.target.value) || 0 })}
          className="w-full px-2 py-1 rounded border border-gray-300 text-xs outline-none focus:border-purple-400 text-center"
          placeholder="不限"
        />
      </div>
      <div>
        <label className="text-[10px] text-gray-400">最长(分钟)</label>
        <input
          type="number"
          min={0}
          value={form.maxDuration || ""}
          onChange={(e) => setForm({ ...form, maxDuration: Number(e.target.value) || 0 })}
          className="w-full px-2 py-1 rounded border border-gray-300 text-xs outline-none focus:border-purple-400 text-center"
          placeholder="不限"
        />
      </div>
    </div>
  );

  const [viewByCategory, setViewByCategory] = useState(false);
  const priorities = [1, 2, 3, 4, 5];

  return (
    <div className="grid grid-cols-2 gap-4 items-start">
      {/* Left: 任务优先级设定 */}
      <div className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[--text-primary]">任务优先级设定</h3>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewByCategory(false)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                !viewByCategory ? "bg-white text-[--text-primary] shadow-sm" : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              按优先级排列
            </button>
            <button
              onClick={() => setViewByCategory(true)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                viewByCategory ? "bg-white text-[--text-primary] shadow-sm" : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              按任务类型排列
            </button>
          </div>
        </div>
        <div className="card p-4 space-y-4">
          {viewByCategory ? (
            /* 按任务类型排列 */
            CAT_NAME_OPTIONS.map((catName) => {
              const items = sorted.filter((c) => c.name === catName);
              return (
                <div key={catName}>
                  <h4 className={`text-[11px] font-bold mb-1.5 ${CAT_HEADING[catName] || "text-[--text-secondary]"}`}>{catName}</h4>
                  <div className="space-y-1">
                    {items.length === 0 ? (
                      <div className="text-[10px] text-[--text-muted] text-center py-2">暂无</div>
                    ) : (
                      items.map((cat) => (
                        <div
                          key={cat.id}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200"
                        >
                          <span className="text-[11px] text-[--text-secondary]">{durationLabel(cat.minDuration, cat.maxDuration)}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md cursor-default ${PRIORITY_BADGE[cat.priorityLevel]}`} title={PRIORITY_TIPS[cat.priorityLevel]}>P{cat.priorityLevel}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            /* 按优先级排列 */
            priorities.map((p) => {
              const items = sorted.filter((c) => c.priorityLevel === p);
              return (
                <div key={p}>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className={`text-[11px] font-bold ${PRIORITY_HEADING[p]}`}>{PRIORITY_LABELS[p]}</h4>
                    <button
                      onClick={() => { setAddingPriority(p); setAddForm({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0 }); }}
                      className="text-[10px] text-purple-500 hover:text-purple-700 font-medium"
                    >
                      + 添加
                    </button>
                  </div>
                  <div className="space-y-1">
                    {items.map((cat) =>
                      editingId === cat.id ? (
                        <div key={cat.id} className={`px-3 py-2.5 rounded-lg border ${PRIORITY_STYLES[p]} space-y-2`}>
                          <div className="flex gap-2 items-center">
                            <select
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              className="flex-1 min-w-0 px-2 py-1 rounded border border-gray-300 text-xs outline-none focus:border-purple-400"
                            >
                              {CAT_NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <select
                              value={editForm.priorityLevel}
                              onChange={(e) => setEditForm({ ...editForm, priorityLevel: Number(e.target.value) })}
                              className="px-2 py-1 rounded border border-gray-300 text-xs outline-none"
                            >
                              {priorities.map((v) => <option key={v} value={v}>P{v}</option>)}
                            </select>
                          </div>
                          {renderDurationFields(editForm, (f) => setEditForm({ ...editForm, ...f }))}
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => setEditingId(null)} className="text-[10px] px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
                            <button onClick={saveEdit} disabled={saving} className="text-[10px] px-2.5 py-1 rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50">保存</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={cat.id}
                          className={`flex items-center px-3 py-2 rounded-lg border group ${PRIORITY_STYLES[p]}`}
                        >
                          <span className="text-xs font-medium flex-1 min-w-0 truncate">{cat.name}</span>
                          <span className="text-[11px] shrink-0">{durationLabel(cat.minDuration, cat.maxDuration)}</span>
                          <div className="flex gap-1.5 ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(cat)} className="text-[10px] text-purple-500 hover:text-purple-700">编辑</button>
                            <button onClick={() => deleteCategory(cat.id)} className="text-[10px] text-red-400 hover:text-red-600">删除</button>
                          </div>
                        </div>
                      )
                    )}
                    {items.length === 0 && addingPriority !== p && (
                      <div className="text-[10px] text-[--text-muted] text-center py-2">暂无任务类型</div>
                    )}
                    {addingPriority === p && (
                      <div className={`px-3 py-2.5 rounded-lg border ${PRIORITY_STYLES[p]} space-y-2`}>
                        <select
                          value={addForm.name}
                          onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                          className="w-full px-2 py-1 rounded border border-gray-300 text-xs outline-none focus:border-purple-400"
                          autoFocus
                        >
                          {CAT_NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        {renderDurationFields(addForm, (f) => setAddForm({ ...addForm, ...f }))}
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setAddingPriority(null)} className="text-[10px] px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
                          <button onClick={() => saveAdd(p)} disabled={saving} className="text-[10px] px-2.5 py-1 rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50">添加</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: 全局参数调整 */}
      <div>
        <h3 className="text-sm font-semibold text-[--text-primary] mb-3">全局参数调整</h3>
        <div className="space-y-2">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[--text-secondary]">队列中任务等待多久进行优先级提权</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={60}
                step={5}
                value={upgradeThreshold}
                onChange={(e) => saveThreshold(Number(e.target.value))}
                className="flex-1 accent-purple-500"
              />
              <span className="text-sm font-medium text-[--text-primary] w-14 text-right">{upgradeThreshold} 分钟</span>
            </div>
          </div>

          {PARAM_DEFS.map((def) => (
            <div key={def.key} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[--text-secondary]">{def.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={params[def.key]}
                  onChange={(e) => handleParamChange(def.key, Number(e.target.value))}
                  className="flex-1 accent-purple-500"
                />
                <span className="text-sm font-medium text-[--text-primary] w-14 text-right">{params[def.key]} 分钟</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
