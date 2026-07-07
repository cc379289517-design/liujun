"use client";

import { useState, useRef, useEffect } from "react";
import {
  COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY,
  COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_OPTIONS,
  collaborationEnabledConfigKey,
  collaborationMaxParticipantsConfigKey,
  parseCollaborationEnabled,
  parseCollaborationMaxParticipants,
  parseCollaborationQueueAutoCloseLimit,
} from "@/lib/collaborationRules";
import {
  PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY,
  PHOTOGRAPHER_MAX_ACTIVE_TASK_OPTIONS,
  parsePhotographerMaxActiveTasks,
} from "@/lib/photographerTaskLimit";
import {
  DEFAULT_EATING_OVERTIME_ALERT_MIN,
  DEFAULT_EATING_REENTRY_COOLDOWN_MIN,
  EATING_OVERTIME_ALERT_CONFIG_KEY,
  EATING_REENTRY_COOLDOWN_CONFIG_KEY,
} from "@/lib/eatingPresence";
import {
  DEFAULT_IRONING_CONFIRM_TIMEOUT_SEC,
  DEFAULT_IRONING_MACHINE_CLAIM_TTL_MIN,
  DEFAULT_IRONING_PREP_WINDOW_MIN,
  IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY,
  IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY,
  IRONING_PREP_WINDOW_MIN_CONFIG_KEY,
} from "@/lib/ironingRules";
import {
  DEFAULT_STANDBY_REASSIGN_TIMEOUT_MIN,
  STANDBY_REASSIGN_TIMEOUT_MIN_CONFIG_KEY,
} from "@/lib/standbyReassignRules";
const P1_DISPATCH_CFG_KEY = "p1_interrupt_dispatch_mode";
type P1DispatchUi = "priority_tier_rr" | "flat_round_robin";

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="admin-modal fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="admin-dialog bg-white rounded-2xl shadow-xl px-7 py-6 w-72 flex flex-col items-center gap-4">
        <p className="text-sm text-[--text-primary] text-center font-medium">{message}</p>
        <div className="flex gap-3 w-full">
          <button onClick={onCancel} className="flex-1 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors">取消</button>
          <button onClick={onConfirm} className="flex-1 py-1.5 rounded-xl bg-red-500 text-white text-sm hover:bg-red-600 transition-colors">删除</button>
        </div>
      </div>
    </div>
  );
}

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
  canBeInterrupted: boolean;
  maxInterruptMinutes: number | null;
};

type SystemConfigMap = Record<string, { value: string; label: string | null }>;
type Building = { id: number; name: string };

interface Props {
  categories: Category[];
  buildings: Building[];
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
  { key: "ending_alert_min", min: 1, max: 10, step: 1, defaultValue: 2, label: "快结束提醒(分钟)" },
  { key: EATING_OVERTIME_ALERT_CONFIG_KEY, min: 5, max: 120, step: 5, defaultValue: DEFAULT_EATING_OVERTIME_ALERT_MIN, label: "吃饭累计时长上限/提醒(分钟)" },
  { key: EATING_REENTRY_COOLDOWN_CONFIG_KEY, min: 5, max: 180, step: 5, defaultValue: DEFAULT_EATING_REENTRY_COOLDOWN_MIN, label: "结束吃饭后再次切换冷却(分钟)" },
  {
    key: STANDBY_REASSIGN_TIMEOUT_MIN_CONFIG_KEY,
    min: 1,
    max: 120,
    step: 1,
    defaultValue: DEFAULT_STANDBY_REASSIGN_TIMEOUT_MIN,
    label: "待就位超时多久更换派发助理",
  },
] as const;

const IRONING_PARAM_DEFS = [
  {
    key: IRONING_PREP_WINDOW_MIN_CONFIG_KEY,
    min: 1,
    max: 30,
    step: 1,
    defaultValue: DEFAULT_IRONING_PREP_WINDOW_MIN,
    label: "熨烫机准备窗口",
    unit: "分钟",
  },
  {
    key: IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY,
    min: 15,
    max: 300,
    step: 15,
    defaultValue: DEFAULT_IRONING_CONFIRM_TIMEOUT_SEC,
    label: "熨烫机空出确认倒计时",
    unit: "秒",
  },
  {
    key: IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY,
    min: 1,
    max: 30,
    step: 1,
    defaultValue: DEFAULT_IRONING_MACHINE_CLAIM_TTL_MIN,
    label: "熨烫机使用权保护时间",
    unit: "分钟",
  },
] as const;

type EditForm = {
  name: string;
  minDuration: number;
  maxDuration: number;
  priorityLevel: number;
  canBeInterrupted: boolean;
  maxInterruptMinutes: number | null;
};

export default function TaskLogicTab({ categories: initCategories, buildings, config }: Props) {
  const p1DispatchModeConfigValue = config[P1_DISPATCH_CFG_KEY]?.value;
  const photographerMaxActiveTasksConfigValue = config[PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY]?.value;
  const collaborationQueueAutoCloseLimitConfigValue = config[COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY]?.value;
  const [localCats, setLocalCats] = useState<Category[]>(initCategories);
  const [upgradeThreshold, setUpgradeThreshold] = useState(
    Number(config.upgrade_threshold?.value ?? 30)
  );
  const [params, setParams] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const d of PARAM_DEFS) {
      init[d.key] = Number(config[d.key]?.value ?? d.defaultValue);
    }
    for (const d of IRONING_PARAM_DEFS) {
      init[d.key] = Number(config[d.key]?.value ?? d.defaultValue);
    }
    return init;
  });
  const [photographerMaxActiveTasks, setPhotographerMaxActiveTasks] = useState(() =>
    parsePhotographerMaxActiveTasks(photographerMaxActiveTasksConfigValue)
  );
  const [collaborationQueueAutoCloseLimit, setCollaborationQueueAutoCloseLimit] = useState(() =>
    parseCollaborationQueueAutoCloseLimit(collaborationQueueAutoCloseLimitConfigValue)
  );
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [collaborationEnabledByBuilding, setCollaborationEnabledByBuilding] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    for (const building of buildings) {
      init[building.id] = parseCollaborationEnabled(config[collaborationEnabledConfigKey(building.id)]?.value);
    }
    return init;
  });
  const [collaborationMaxByBuilding, setCollaborationMaxByBuilding] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const building of buildings) {
      init[building.id] = parseCollaborationMaxParticipants(config[collaborationMaxParticipantsConfigKey(building.id)]?.value);
    }
    return init;
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", minDuration: 0, maxDuration: 0, priorityLevel: 3, canBeInterrupted: true, maxInterruptMinutes: null });
  const [saving, setSaving] = useState(false);
  const [dupError, setDupError] = useState(false);

  const [addingPriority, setAddingPriority] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<Omit<EditForm, "priorityLevel">>({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0, canBeInterrupted: true, maxInterruptMinutes: null });
  const [addDupError, setAddDupError] = useState(false);

  const sorted = [...localCats].sort((a, b) => a.priorityLevel - b.priorityLevel || a.sortRank - b.sortRank);

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

  const savePhotographerMaxActiveTasks = async (value: number) => {
    const nextValue = parsePhotographerMaxActiveTasks(value);
    const previousValue = photographerMaxActiveTasks;
    setPhotographerMaxActiveTasks(nextValue);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY]: nextValue }),
      });
      if (!response.ok) throw new Error("Failed to save photographer task limit");
    } catch {
      setPhotographerMaxActiveTasks(previousValue);
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setDupError(false);
    const forceOff = cat.maxDuration > 0 && cat.maxDuration <= 30;
    setEditForm({ name: cat.name, minDuration: cat.minDuration, maxDuration: cat.maxDuration, priorityLevel: cat.priorityLevel, canBeInterrupted: forceOff ? false : cat.canBeInterrupted, maxInterruptMinutes: cat.maxInterruptMinutes });
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const isDup = localCats.some(
      (c) => c.id !== editingId && c.name === editForm.name && c.priorityLevel === editForm.priorityLevel
    );
    if (isDup) { setDupError(true); return; }
    setDupError(false);
    setSaving(true);
    const est = editForm.minDuration && editForm.maxDuration
      ? Math.round((editForm.minDuration + editForm.maxDuration) / 2)
      : editForm.maxDuration || editForm.minDuration || 10;
    const updated = { ...editForm, estDuration: est, maxInterruptMinutes: editForm.canBeInterrupted ? editForm.maxInterruptMinutes : null };
    try {
      await fetch(`/api/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setLocalCats((prev) => prev.map((c) => c.id === editingId ? { ...c, ...updated } : c));
      setEditingId(null);
    } catch {} finally { setSaving(false); }
  };

  const deleteCategory = async (id: number) => {
    try {
      await fetch(`/api/categories/${id}`, { method: "DELETE" });
      setLocalCats((prev) => prev.filter((c) => c.id !== id));
    } catch {}
  };

  const saveAdd = async (priorityLevel: number) => {
    if (!addForm.name) return;
    const isDup = localCats.some((c) => c.name === addForm.name && c.priorityLevel === priorityLevel);
    if (isDup) { setAddDupError(true); return; }
    setAddDupError(false);
    setSaving(true);
    const est = addForm.minDuration && addForm.maxDuration
      ? Math.round((addForm.minDuration + addForm.maxDuration) / 2)
      : addForm.maxDuration || addForm.minDuration || 10;
    const body = {
      name: addForm.name,
      priorityLevel,
      minDuration: addForm.minDuration || 0,
      maxDuration: addForm.maxDuration || 0,
      estDuration: est,
      hexColor: "#3b82f6",
      sortRank: 0,
      canBeInterrupted: addForm.canBeInterrupted,
      maxInterruptMinutes: addForm.canBeInterrupted ? addForm.maxInterruptMinutes : null,
    };
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const created: Category = await res.json();
        setLocalCats((prev) => [...prev, created]);
      }
      setAddingPriority(null);
      setAddForm({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0, canBeInterrupted: true, maxInterruptMinutes: null });
    } catch {} finally { setSaving(false); }
  };

  const renderDurationFields = (
    form: { minDuration: number; maxDuration: number; canBeInterrupted: boolean },
    setForm: (f: typeof form) => void
  ) => (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={form.minDuration || ""}
        onChange={(e) => setForm({ ...form, minDuration: Number(e.target.value) || 0 })}
        className="w-12 px-1.5 py-0.5 rounded border border-gray-300 text-xs outline-none focus:border-purple-400 text-center"
        placeholder="最短"
      />
      <span className="text-[10px] text-gray-400">~</span>
      <input
        type="number"
        min={0}
        value={form.maxDuration || ""}
        onChange={(e) => {
          const max = Number(e.target.value) || 0;
          const autoOff = max > 0 && max <= 30;
          setForm({ ...form, maxDuration: max, canBeInterrupted: autoOff ? false : form.canBeInterrupted });
        }}
        className="w-12 px-1.5 py-0.5 rounded border border-gray-300 text-xs outline-none focus:border-purple-400 text-center"
        placeholder="最长"
      />
      <span className="text-[10px] text-gray-400">分钟</span>
    </div>
  );

  const renderInterruptFields = (
    form: { canBeInterrupted: boolean; maxInterruptMinutes: number | null; maxDuration: number },
    setForm: (f: typeof form) => void
  ) => {
    const locked = form.maxDuration > 0 && form.maxDuration <= 30;
    return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-gray-400 shrink-0">可被插单</label>
        <button
          type="button"
          disabled={locked}
          onClick={() => !locked && setForm({ ...form, canBeInterrupted: !form.canBeInterrupted })}
          className={`relative w-8 h-4 rounded-full transition-colors ${form.canBeInterrupted ? "bg-purple-500" : "bg-gray-300"} ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${form.canBeInterrupted ? "left-[18px]" : "left-0.5"}`} />
        </button>
        {locked && <span className="text-[9px] text-gray-400">≤30分钟不可插单</span>}
        {!locked && form.canBeInterrupted && (
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-gray-400 shrink-0">最大离场</label>
            <input
              type="number"
              min={1}
              max={120}
              value={form.maxInterruptMinutes ?? ""}
              onChange={(e) => setForm({ ...form, maxInterruptMinutes: e.target.value ? Number(e.target.value) : null })}
              className="w-14 px-1.5 py-0.5 rounded border border-gray-300 text-[10px] outline-none focus:border-purple-400 text-center"
              placeholder="默认"
            />
            <span className="text-[10px] text-gray-400">分钟</span>
          </div>
        )}
      </div>
    </div>
    );
  };

  const [viewByCategory, setViewByCategory] = useState(false);
  const priorities = [1, 2, 3, 4, 5];

  const [p1DispatchMode, setP1DispatchMode] = useState<P1DispatchUi>(() =>
    p1DispatchModeConfigValue === "flat_round_robin" ? "flat_round_robin" : "priority_tier_rr"
  );

  useEffect(() => {
    setCollaborationEnabledByBuilding(() => {
      const next: Record<number, boolean> = {};
      for (const building of buildings) {
        next[building.id] = parseCollaborationEnabled(config[collaborationEnabledConfigKey(building.id)]?.value);
      }
      return next;
    });
    setCollaborationMaxByBuilding(() => {
      const next: Record<number, number> = {};
      for (const building of buildings) {
        next[building.id] = parseCollaborationMaxParticipants(config[collaborationMaxParticipantsConfigKey(building.id)]?.value);
      }
      return next;
    });
  }, [buildings, config]);

  useEffect(() => {
    setP1DispatchMode(
      p1DispatchModeConfigValue === "flat_round_robin" ? "flat_round_robin" : "priority_tier_rr"
    );
  }, [p1DispatchModeConfigValue]);

  useEffect(() => {
    setPhotographerMaxActiveTasks(
      parsePhotographerMaxActiveTasks(photographerMaxActiveTasksConfigValue)
    );
  }, [photographerMaxActiveTasksConfigValue]);

  useEffect(() => {
    setCollaborationQueueAutoCloseLimit(
      parseCollaborationQueueAutoCloseLimit(collaborationQueueAutoCloseLimitConfigValue)
    );
  }, [collaborationQueueAutoCloseLimitConfigValue]);

  const saveCollaborationEnabled = async (buildingId: number, enabled: boolean) => {
    const previousEnabled = collaborationEnabledByBuilding[buildingId] ?? true;
    setCollaborationEnabledByBuilding((prev) => ({ ...prev, [buildingId]: enabled }));
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [collaborationEnabledConfigKey(buildingId)]: enabled }),
      });
      if (!response.ok) throw new Error("Failed to save collaboration setting");
    } catch {
      setCollaborationEnabledByBuilding((prev) => ({ ...prev, [buildingId]: previousEnabled }));
    }
  };

  const saveCollaborationMax = async (buildingId: number, value: number) => {
    const maxParticipants = parseCollaborationMaxParticipants(String(value));
    const previousValue = collaborationMaxByBuilding[buildingId] ?? 3;
    setCollaborationMaxByBuilding((prev) => ({ ...prev, [buildingId]: maxParticipants }));
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [collaborationMaxParticipantsConfigKey(buildingId)]: maxParticipants }),
      });
      if (!response.ok) throw new Error("Failed to save collaboration max participants");
    } catch {
      setCollaborationMaxByBuilding((prev) => ({ ...prev, [buildingId]: previousValue }));
    }
  };

  const saveCollaborationQueueAutoCloseLimit = async (value: number) => {
    const nextValue = parseCollaborationQueueAutoCloseLimit(value);
    const previousValue = collaborationQueueAutoCloseLimit;
    setCollaborationQueueAutoCloseLimit(nextValue);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY]: nextValue }),
      });
      if (!response.ok) throw new Error("Failed to save collaboration queue auto close limit");
    } catch {
      setCollaborationQueueAutoCloseLimit(previousValue);
    }
  };

  const saveP1DispatchMode = async (mode: P1DispatchUi) => {
    setP1DispatchMode(mode);
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [P1_DISPATCH_CFG_KEY]: mode }),
      });
    } catch {}
  };

  return (
    <>
      {confirmDeleteId !== null && (
        <ConfirmDialog
          message="确定删除此任务类型？"
          onConfirm={() => { deleteCategory(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    <div className="grid grid-cols-2 gap-4 items-start">
      {/* Left: 任务优先级设定 */}
      <div className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[--text-primary]">任务优先级设定</h3>
          <div className="admin-segment flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewByCategory(false)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                !viewByCategory ? "bg-white/80 text-[--text-primary] shadow-sm" : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              按优先级排列
            </button>
            <button
              onClick={() => setViewByCategory(true)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                viewByCategory ? "bg-white/80 text-[--text-primary] shadow-sm" : "text-[--text-muted] hover:text-[--text-secondary]"
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
                          className="admin-table-row flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200"
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
                      onClick={() => { setAddingPriority(p); setAddForm({ name: CAT_NAME_OPTIONS[0], minDuration: 0, maxDuration: 0, canBeInterrupted: true, maxInterruptMinutes: null }); }}
                      className="text-[10px] text-purple-500 hover:text-purple-700 font-medium"
                    >
                      + 添加
                    </button>
                  </div>
                  <div className="space-y-1">
                    {items.map((cat) => {
                      const isOpen = editingId === cat.id;
                      return (
                        <div key={cat.id} className={`group rounded-lg border overflow-hidden transition-transform duration-150 hover:translate-x-1 ${PRIORITY_STYLES[p]}`}>
                          {/* 行头：点击展开/收起 */}
                          <div className="flex items-center px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => isOpen ? setEditingId(null) : startEdit(cat)}
                              className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                            >
                              <svg
                                className={`w-3 h-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                              >
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                              <span className="text-xs font-medium truncate">{cat.name}</span>
                            </button>
                            {cat.canBeInterrupted && cat.maxInterruptMinutes ? (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-500 shrink-0 mx-1"
                                title={`可插单离场 ${cat.maxInterruptMinutes} 分钟`}
                              >
                                <span className="text-[9px] leading-none">可插单离场</span>
                                <span className="text-[11px] font-semibold leading-none">⏱{cat.maxInterruptMinutes}m</span>
                              </span>
                            ) : null}
                            <span className="text-[11px] shrink-0 mr-1">{durationLabel(cat.minDuration, cat.maxDuration)}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(cat.id)}
                              className="text-[10px] font-bold text-red-500 bg-red-50 hover:bg-red-100 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded"
                              title="删除"
                            >
                              删除
                            </button>
                          </div>
                          {/* 展开区域：单行 */}
                          {isOpen && (
                            <div className="px-2 pb-1.5 pt-1 border-t border-current/10 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <select
                                  value={editForm.name}
                                  onChange={(e) => { setDupError(false); setEditForm({ ...editForm, name: e.target.value }); }}
                                  className="px-1.5 py-0.5 rounded border border-gray-300 text-xs outline-none focus:border-purple-400 bg-white"
                                >
                                  {CAT_NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                                <select
                                  value={editForm.priorityLevel}
                                  onChange={(e) => { setDupError(false); setEditForm({ ...editForm, priorityLevel: Number(e.target.value) }); }}
                                  className="px-1.5 py-0.5 rounded border border-gray-300 text-xs outline-none bg-white"
                                >
                                  {priorities.map((v) => <option key={v} value={v}>P{v}</option>)}
                                </select>
                                {renderDurationFields(editForm, (f) => setEditForm({ ...editForm, ...f }))}
                                {renderInterruptFields(editForm, (f) => setEditForm({ ...editForm, ...f }))}
                                <div className="flex gap-1 ml-auto">
                                  <button onClick={() => setEditingId(null)} className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
                                  <button onClick={saveEdit} disabled={saving || dupError} className="text-[10px] px-2 py-0.5 rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50">保存</button>
                                </div>
                              </div>
                              {dupError && (
                                <p className="text-[10px] text-red-500 font-medium">已有相同类型与优先级，请修改后保存</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {items.length === 0 && addingPriority !== p && (
                      <div className="text-[10px] text-[--text-muted] text-center py-2">暂无任务类型</div>
                    )}
                    {addingPriority === p && (
                      <div className={`px-3 py-2.5 rounded-lg border ${PRIORITY_STYLES[p]} space-y-2`}>
                        <select
                          value={addForm.name}
                          onChange={(e) => { setAddDupError(false); setAddForm({ ...addForm, name: e.target.value }); }}
                          className="w-full px-2 py-1 rounded border border-gray-300 text-xs outline-none focus:border-purple-400"
                          autoFocus
                        >
                          {CAT_NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        {renderDurationFields(addForm, (f) => setAddForm({ ...addForm, ...f }))}
                        {renderInterruptFields(addForm, (f) => setAddForm({ ...addForm, ...f }))}
                        {addDupError && (
                          <p className="text-[10px] text-red-500 font-medium">已有相同类型与优先级，请修改后添加</p>
                        )}
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setAddingPriority(null)} className="text-[10px] px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
                          <button onClick={() => saveAdd(p)} disabled={saving || addDupError} className="text-[10px] px-2.5 py-1 rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50">添加</button>
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
              <span className="text-xs text-[--text-secondary]">未分配队列任务等待多久进行优先级提权</span>
            </div>
            <p className="mb-2 text-[10px] leading-relaxed text-[--text-muted]">
              只作用于还没有派给助理的任务；已派发待就位任务不再参与普通队列提权。
            </p>
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

          <div className="card p-4 space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-[--text-primary]">熨烫机接续规则</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-[--text-muted]">
                用于控制熨烫机即将空出时提前多久锁定下一单、助理收到空出提示后的确认等待时间，以及机器空出后队首助理保留使用权多久。
              </p>
            </div>
            {IRONING_PARAM_DEFS.map((def) => (
              <div key={def.key}>
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
                  <span className="text-sm font-medium text-[--text-primary] w-14 text-right">
                    {params[def.key]} {def.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[--text-secondary]">摄影师最多同时下达任务数</span>
              <div className="group relative">
                <button
                  type="button"
                  className="flex h-8 min-w-16 items-center justify-center rounded-lg border border-gray-100 bg-white px-3 text-sm font-extrabold text-[--text-primary] shadow-sm shadow-gray-200/60 transition-colors hover:border-purple-200 focus:border-purple-300 focus:outline-none"
                >
                  {photographerMaxActiveTasks} 个
                </button>
                <div className="absolute right-0 top-full z-30 hidden pt-2 group-focus-within:block group-hover:block">
                  <div className="admin-popover flex w-20 flex-col gap-1 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl shadow-gray-200/80">
                    {PHOTOGRAPHER_MAX_ACTIVE_TASK_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => savePhotographerMaxActiveTasks(value)}
                        className={`h-8 rounded-lg text-xs font-extrabold transition-colors ${
                          value === photographerMaxActiveTasks
                            ? "bg-purple-500 text-white"
                            : "text-[--text-primary] hover:bg-purple-50 hover:text-purple-600"
                        }`}
                      >
                        {value}个
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="mb-3 text-[10px] leading-relaxed text-[--text-muted]">
              同一摄影师未完成任务达到上限时，将不能继续下达新任务，直到已有任务完成或被清理。
            </p>
          </div>

          <div className="card p-4 space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-[--text-primary]">插单派发策略</h4>
              <p className="text-[10px] text-[--text-muted] mt-1 leading-relaxed">
                无空闲助理时，向同楼座「正在执行、类型允许被打断、且新单更紧急」的助理插单（新单离场须在全局/类型离场上限内）。保存后立即对新建任务生效。
              </p>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="p1-dispatch"
                  className="mt-0.5 accent-purple-500"
                  checked={p1DispatchMode === "priority_tier_rr"}
                  onChange={() => saveP1DispatchMode("priority_tier_rr")}
                />
                <span>
                  <span className="text-xs font-medium text-[--text-primary] group-hover:text-purple-700">
                    优先更「不急」的助理（推荐）
                  </span>
                  <span className="block text-[10px] text-[--text-muted] mt-0.5 leading-relaxed">
                    按当前执行任务优先级 P5→P4→P3… 依次尝试；同一优先级档位内再按人轮询，避免总插给同一人。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="p1-dispatch"
                  className="mt-0.5 accent-purple-500"
                  checked={p1DispatchMode === "flat_round_robin"}
                  onChange={() => saveP1DispatchMode("flat_round_robin")}
                />
                <span>
                  <span className="text-xs font-medium text-[--text-primary] group-hover:text-purple-700">
                    全体轮询（不按任务优先级）
                  </span>
                  <span className="block text-[10px] text-[--text-muted] mt-0.5 leading-relaxed">
                    凡满足可插断条件的助理均进入同一轮询队列，不再先看 P5/P4…，仅按轮询顺序公平派发。
                  </span>
                </span>
              </label>
            </div>
          </div>

	          <div className="card p-4 space-y-3">
	            <h4 className="text-xs font-semibold text-[--text-primary]">多人协作规则</h4>
	            <p className="text-[10px] leading-4 text-[--text-muted]">
	              按大区控制任务协作；队列达阈值后自动关闭新增协作，已有协作仍可展示和移除。
	            </p>
            <div className="space-y-1.5">
              {buildings.length === 0 ? (
                <p className="text-[10px] text-[--text-muted]">暂无大区数据</p>
              ) : (
                buildings.map((building) => {
                  const enabled = collaborationEnabledByBuilding[building.id] ?? true;
                  const maxParticipants = collaborationMaxByBuilding[building.id] ?? 3;
                  return (
                    <div key={building.id} className="admin-table-row flex min-h-10 items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <p className="shrink-0 text-xs font-semibold text-[--text-secondary]">{building.name}</p>
                        <p className="truncate text-[10px] font-medium text-gray-600">
                          {enabled ? "允许多人协作" : "关闭多人协作"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="group relative">
                          <button
                            type="button"
                            disabled={!enabled}
                            className="flex h-7 w-16 items-center justify-center gap-0.5 rounded-lg border border-gray-200 bg-white text-[10px] font-semibold text-[--text-muted] shadow-sm transition-colors disabled:bg-gray-100 disabled:text-gray-400"
                            title="鼠标移入选择人数上限"
                          >
                            <span>最多</span>
                            <span className="text-xs font-extrabold text-[--text-primary] group-disabled:text-gray-400">{maxParticipants}</span>
                            <span>人</span>
                          </button>
                          {enabled && (
                            <div className="absolute right-0 top-full z-20 hidden pt-1 group-hover:block">
                              <div className="admin-popover flex w-14 flex-col gap-1 rounded-xl border border-gray-100 bg-white p-1.5 shadow-lg">
                                {[2, 3, 4].map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => saveCollaborationMax(building.id, value)}
                                    className={`flex h-6 items-center justify-center rounded-md px-2 text-[10px] font-bold transition-colors ${
                                      value === maxParticipants
                                        ? "bg-purple-500 text-white"
                                        : "text-[--text-secondary] hover:bg-purple-50 hover:text-purple-600"
                                    }`}
                                  >
                                    {value}人
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => saveCollaborationEnabled(building.id, !enabled)}
                          className={`relative h-5 w-10 shrink-0 overflow-hidden rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-gray-300"}`}
                          title={enabled ? "关闭多人协作规则" : "开启多人协作规则"}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
	            <div className="ml-3 flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold text-[--text-secondary]">
	              <span>队列任务达</span>
	              <div className="group relative">
	                <button
	                  type="button"
	                  className="flex h-7 min-w-12 items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-xs font-extrabold text-[--text-primary] shadow-sm transition-colors hover:border-purple-200 hover:text-purple-600"
	                  title="鼠标移入选择自动关闭阈值"
	                >
	                  {collaborationQueueAutoCloseLimit}条
	                </button>
	                <div className="absolute left-0 bottom-full z-20 hidden pb-1 group-hover:block">
	                  <div className="admin-popover flex w-20 flex-col gap-1 rounded-xl border border-gray-100 bg-white p-1.5 shadow-lg">
	                    {COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_OPTIONS.map((value) => (
	                      <button
	                        key={value}
	                        type="button"
	                        onClick={() => saveCollaborationQueueAutoCloseLimit(value)}
	                        className={`flex h-6 items-center justify-center rounded-md px-2 text-[10px] font-bold transition-colors ${
	                          value === collaborationQueueAutoCloseLimit
	                            ? "bg-purple-500 text-white"
	                            : "text-[--text-secondary] hover:bg-purple-50 hover:text-purple-600"
	                        }`}
	                      >
	                        {value}条
	                      </button>
	                    ))}
	                  </div>
	                </div>
	              </div>
	              <span>自动关闭多人协作逻辑</span>
	            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
