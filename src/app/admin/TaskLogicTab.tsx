"use client";

import { useState, useRef, useCallback } from "react";

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

const COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#64748b",
];

const PRIORITY_STYLES: Record<number, string> = {
  1: "bg-red-50 text-red-600",
  2: "bg-orange-50 text-orange-600",
  3: "bg-amber-50 text-amber-600",
  4: "bg-blue-50 text-blue-600",
};

const emptyCategory = {
  name: "",
  description: "",
  priorityLevel: 3,
  minDuration: 5,
  maxDuration: 30,
  estDuration: 15,
  hexColor: "#3b82f6",
  sortRank: 0,
};

export default function TaskLogicTab({ categories, config, onRefresh }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Category>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...emptyCategory });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [upgradeThreshold, setUpgradeThreshold] = useState(
    Number(config.upgrade_threshold?.value ?? 30)
  );
  const [saving, setSaving] = useState(false);
  const sorted = [...categories].sort((a, b) => a.sortRank - b.sortRank);
  const dragOverIdx = useRef<number | null>(null);

  // ---- Drag & Drop ----
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    dragOverIdx.current = idx;
  };
  const handleDrop = async () => {
    if (dragIdx === null || dragOverIdx.current === null || dragIdx === dragOverIdx.current) {
      setDragIdx(null);
      return;
    }
    const reordered = [...sorted];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dragOverIdx.current, 0, moved);
    const payload = reordered.map((c, i) => ({ id: c.id, sortRank: i }));
    setDragIdx(null);
    try {
      await fetch("/api/categories/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onRefresh();
    } catch {}
  };

  // ---- Edit ----
  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditForm({ ...cat });
  };
  const saveEdit = async () => {
    if (editingId === null) return;
    setSaving(true);
    try {
      await fetch(`/api/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      setEditingId(null);
      onRefresh();
    } catch {} finally {
      setSaving(false);
    }
  };

  // ---- Add ----
  const saveAdd = async () => {
    setSaving(true);
    try {
      await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      setShowAdd(false);
      setAddForm({ ...emptyCategory });
      onRefresh();
    } catch {} finally {
      setSaving(false);
    }
  };

  // ---- Escalation config ----
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

  // ---- Color picker component ----
  const ColorPicker = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (c: string) => void;
  }) => (
    <div>
      <div className="flex gap-2 flex-wrap mb-2">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className="w-7 h-7 rounded-full border-2 transition-transform"
            style={{
              backgroundColor: c,
              borderColor: value === c ? "#000" : "transparent",
              transform: value === c ? "scale(1.15)" : undefined,
            }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#hex"
        className="border rounded px-2 py-1 text-sm w-24"
      />
    </div>
  );

  // ---- Form fields ----
  const renderFields = (
    form: Record<string, any>,
    setForm: (f: any) => void
  ) => (
    <div className="grid grid-cols-2 gap-3 mt-3">
      <div className="col-span-2">
        <label className="text-xs text-gray-500">名称</label>
        <input
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="col-span-2">
        <label className="text-xs text-gray-500">描述</label>
        <input
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-gray-500">优先级</label>
        <select
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.priorityLevel}
          onChange={(e) =>
            setForm({ ...form, priorityLevel: Number(e.target.value) })
          }
        >
          {[1, 2, 3, 4].map((p) => (
            <option key={p} value={p}>
              P{p}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500">预估时长 (min)</label>
        <input
          type="number"
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.estDuration}
          onChange={(e) =>
            setForm({ ...form, estDuration: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label className="text-xs text-gray-500">最短 (min)</label>
        <input
          type="number"
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.minDuration}
          onChange={(e) =>
            setForm({ ...form, minDuration: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label className="text-xs text-gray-500">最长 (min)</label>
        <input
          type="number"
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.maxDuration}
          onChange={(e) =>
            setForm({ ...form, maxDuration: Number(e.target.value) })
          }
        />
      </div>
      <div className="col-span-2">
        <label className="text-xs text-gray-500 mb-1 block">颜色</label>
        <ColorPicker
          value={form.hexColor}
          onChange={(c) => setForm({ ...form, hexColor: c })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Category list header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[--text-primary]">
          任务类型管理
        </h3>
        <button
          className="px-3 py-1.5 text-sm rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition"
          onClick={() => setShowAdd(true)}
        >
          + 添加类型
        </button>
      </div>

      {/* Category cards */}
      <div className="space-y-2">
        {sorted.map((cat, idx) => (
          <div
            key={cat.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
            className={`card p-5 transition ${
              dragIdx === idx ? "opacity-50" : ""
            }`}
          >
            {editingId === cat.id ? (
              <div>
                {renderFields(editForm, setEditForm)}
                <div className="flex gap-2 mt-3">
                  <button
                    className="px-3 py-1 text-sm rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
                    onClick={saveEdit}
                    disabled={saving}
                  >
                    保存
                  </button>
                  <button
                    className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
                    onClick={() => setEditingId(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {/* Drag handle */}
                <span className="cursor-grab text-gray-300 hover:text-gray-500 select-none">
                  ⠿
                </span>
                {/* Color dot */}
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.hexColor }}
                />
                {/* Name */}
                <span className="font-medium text-sm flex-1">{cat.name}</span>
                {/* Priority badge */}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    PRIORITY_STYLES[cat.priorityLevel] ?? ""
                  }`}
                >
                  P{cat.priorityLevel}
                </span>
                {/* Duration */}
                <span className="text-xs text-gray-400">
                  {cat.estDuration}min
                </span>
                {/* Edit button */}
                <button
                  className="text-xs text-purple-500 hover:text-purple-700"
                  onClick={() => startEdit(cat)}
                >
                  编辑
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[90vw] max-w-md shadow-xl">
            <h3 className="text-sm font-semibold text-[--text-primary] mb-2">
              添加任务类型
            </h3>
            {renderFields(addForm, setAddForm)}
            <div className="flex gap-2 mt-4">
              <button
                className="px-4 py-1.5 text-sm rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
                onClick={saveAdd}
                disabled={saving}
              >
                创建
              </button>
              <button
                className="px-4 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200"
                onClick={() => setShowAdd(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic escalation config */}
      <div>
        <h3 className="text-sm font-semibold text-[--text-primary] mb-3">
          动态提权设置
        </h3>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm">upgrade_threshold</span>
            <span className="text-sm font-medium">{upgradeThreshold} min</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              value={upgradeThreshold}
              onChange={(e) => saveThreshold(Number(e.target.value))}
              className="flex-1 accent-purple-500"
            />
            <input
              type="number"
              min={10}
              max={60}
              step={5}
              value={upgradeThreshold}
              onChange={(e) => saveThreshold(Number(e.target.value))}
              className="w-16 border rounded px-2 py-1 text-sm text-center"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
