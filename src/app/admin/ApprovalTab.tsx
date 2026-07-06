"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_OPTIONS,
  priorityUpgradeRequestEnabledConfigKey,
  priorityUpgradeRequestMinPriorityConfigKey,
  priorityUpgradeRequestRuleForBuilding,
  type PriorityUpgradeRequestRule,
} from "@/lib/priorityUpgradeRules";

const DEPARTMENTS = ["摄影一部", "摄影二部", "全域优化组"] as const;

type DepartmentName = (typeof DEPARTMENTS)[number];

type PriorityUpgradeRequest = {
  id: string;
  fromPriority: number;
  targetPriority: number;
  approvedPriority?: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt?: string | null;
  sku?: string | null;
  requestedBy: { id: string; name: string };
  reviewedBy?: { id: string; name: string } | null;
  task: {
    id: string;
    roomNumber: string;
    locationBuildingId?: number | null;
    priority: number;
    status: "waiting" | "executing" | "paused" | "completed";
    photographer: { id: string; name: string; department?: string | null; group?: string | null; buildingId?: number | null };
    assistant: { id: string; name: string } | null;
    category: {
      name: string;
      minDuration?: number | null;
      maxDuration?: number | null;
      estDuration?: number | null;
    };
  };
};

type ApprovalProfile = {
  id: string;
  name: string;
  department: string | null;
  group: string | null;
  buildingId: number;
};

type ApprovalBuilding = {
  id: number;
  name: string;
};

type BuildingPriorityUpgradeDraft = Record<number, PriorityUpgradeRequestRule>;

function approvalPriorityLevelCls(priority: number): string {
  const level = Math.min(5, Math.max(1, Math.round(Number(priority) || 5)));
  const priorityCls: Record<number, string> = {
    1: "approval-priority-pill-p1 bg-red-50 text-red-600 shadow-red-100/70",
    2: "approval-priority-pill-p2 bg-orange-50 text-orange-600 shadow-orange-100/70",
    3: "approval-priority-pill-p3 bg-yellow-50 text-yellow-600 shadow-yellow-100/70",
    4: "approval-priority-pill-p4 bg-blue-50 text-blue-600 shadow-blue-100/70",
    5: "approval-priority-pill-p5 bg-gray-100/80 text-gray-500 shadow-gray-200/70",
  };
  return priorityCls[level];
}

interface Props {
  config: Record<string, { value: string; label: string | null }>;
  profiles?: ApprovalProfile[];
  buildings?: ApprovalBuilding[];
  onRefresh: () => void;
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "时间待补充";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "时间待补充";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function previousBusinessDay(base = new Date()) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function previousWeekRange(base = new Date()) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - day + 1);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function previousMonthRange(base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const end = new Date(base.getFullYear(), base.getMonth(), 0);
  return { start, end };
}

function durationLabel(category: PriorityUpgradeRequest["task"]["category"]) {
  if (typeof category.minDuration === "number" && typeof category.maxDuration === "number") {
    return `${category.minDuration}-${category.maxDuration}分钟`;
  }
  if (typeof category.estDuration === "number") return `${category.estDuration}分钟`;
  return "未设置时长";
}

function pendingApprovalPriorityOptions(currentPriority: number) {
  return [1, 2, 3, 4].filter((priority) => priority < currentPriority);
}

function requestSku(request: PriorityUpgradeRequest) {
  return request.sku?.trim() || "SKU 待补充";
}

function requestReviewTime(request: PriorityUpgradeRequest) {
  return request.reviewedAt ?? request.createdAt;
}

function buildBuildingPriorityUpgradeDraft(
  buildings: ApprovalBuilding[],
  config: Record<string, { value: string; label: string | null }>
): BuildingPriorityUpgradeDraft {
  const draft: BuildingPriorityUpgradeDraft = {};
  for (const building of buildings) {
    draft[building.id] = priorityUpgradeRequestRuleForBuilding(config, building.id);
  }
  return draft;
}

export default function ApprovalTab({ config, profiles = [], buildings = [], onRefresh }: Props) {
  const [allPendingRequests, setAllPendingRequests] = useState<PriorityUpgradeRequest[]>([]);
  const [requests, setRequests] = useState<PriorityUpgradeRequest[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<PriorityUpgradeRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exitingRequestIds, setExitingRequestIds] = useState<Set<string>>(() => new Set());
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentName | null>(null);
  const [approvedPriorityById, setApprovedPriorityById] = useState<Record<string, number>>({});
  const [buildingRulesDraft, setBuildingRulesDraft] = useState<BuildingPriorityUpgradeDraft>(() =>
    buildBuildingPriorityUpgradeDraft(buildings, config)
  );
  const [openRangeBuildingId, setOpenRangeBuildingId] = useState<number | null>(null);
  const [approvedStart, setApprovedStart] = useState("");
  const [approvedEnd, setApprovedEnd] = useState("");

  const profileById = useMemo(() => {
    const map = new Map<string, ApprovalProfile>();
    for (const profile of profiles) map.set(profile.id, profile);
    return map;
  }, [profiles]);

  const buildingNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const building of buildings) map.set(building.id, building.name);
    return map;
  }, [buildings]);

  const departmentForRequest = useCallback((request: PriorityUpgradeRequest): DepartmentName | null => {
    const profile = profileById.get(request.task.photographer.id) ?? profileById.get(request.requestedBy.id);
    const label = [
      request.task.photographer.department,
      request.task.photographer.group,
      profile?.department,
      profile?.group,
    ].filter(Boolean).join(" ");
    return DEPARTMENTS.find((department) => label.includes(department)) ?? null;
  }, [profileById]);

  const fetchRequests = useCallback(async (showLoading = true) => {
    if (showLoading) setPendingLoading(true);
    try {
      const params = new URLSearchParams({ status: "pending" });
      if (selectedDepartment) params.set("department", selectedDepartment);
      const res = await fetch(`/api/task-priority-upgrade-requests?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch priority upgrade requests");
      const data = await res.json();
      const rows = Array.isArray(data) ? data as PriorityUpgradeRequest[] : [];
      setRequests(rows);
      setApprovedPriorityById((current) => {
        const next = { ...current };
        for (const item of rows) {
          if (!next[item.id]) next[item.id] = item.targetPriority;
        }
        return next;
      });
    } catch (error) {
      console.error("Failed to fetch priority upgrade requests", error);
      setRequests([]);
    } finally {
      if (showLoading) setPendingLoading(false);
    }
  }, [selectedDepartment]);

  const fetchAllPendingRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/task-priority-upgrade-requests?status=pending", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch all pending priority upgrade requests");
      const data = await res.json();
      setAllPendingRequests(Array.isArray(data) ? data as PriorityUpgradeRequest[] : []);
    } catch (error) {
      console.error("Failed to fetch all pending priority upgrade requests", error);
      setAllPendingRequests([]);
    }
  }, []);

  const fetchApprovedRequests = useCallback(async () => {
    setApprovedLoading(true);
    try {
      const params = new URLSearchParams({ status: "approved" });
      if (approvedStart) params.set("start", approvedStart);
      if (approvedEnd) params.set("end", approvedEnd);
      const res = await fetch(`/api/task-priority-upgrade-requests?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch approved priority upgrade requests");
      const data = await res.json();
      setApprovedRequests(Array.isArray(data) ? data as PriorityUpgradeRequest[] : []);
    } catch (error) {
      console.error("Failed to fetch approved priority upgrade requests", error);
      setApprovedRequests([]);
    } finally {
      setApprovedLoading(false);
    }
  }, [approvedEnd, approvedStart]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    fetchAllPendingRequests();
  }, [fetchAllPendingRequests]);

  useEffect(() => {
    fetchApprovedRequests();
  }, [fetchApprovedRequests]);

  useEffect(() => {
    setBuildingRulesDraft(buildBuildingPriorityUpgradeDraft(buildings, config));
  }, [buildings, config]);

  useEffect(() => {
    const closeRangeDropdown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-approval-range-dropdown]")) return;
      setOpenRangeBuildingId(null);
    };
    window.addEventListener("pointerdown", closeRangeDropdown);
    return () => window.removeEventListener("pointerdown", closeRangeDropdown);
  }, []);

  const departmentCounts = useMemo(() => {
    return DEPARTMENTS.map((department) => ({
      department,
      count: allPendingRequests.filter((request) => departmentForRequest(request) === department).length,
    }));
  }, [allPendingRequests, departmentForRequest]);

  const updateBuildingRule = (
    buildingId: number,
    updater: (current: PriorityUpgradeRequestRule) => PriorityUpgradeRequestRule
  ) => {
    setBuildingRulesDraft((current) => {
      const fallback = priorityUpgradeRequestRuleForBuilding(config, buildingId);
      return {
        ...current,
        [buildingId]: updater(current[buildingId] ?? fallback),
      };
    });
  };

  const saveBuildingPriorityUpgradeRules = async () => {
    setSettingsSaving(true);
    setSettingsMessage(null);
    try {
      const payload: Record<string, string | number | boolean> = {};
      for (const building of buildings) {
        const rule = buildingRulesDraft[building.id] ?? priorityUpgradeRequestRuleForBuilding(config, building.id);
        payload[priorityUpgradeRequestEnabledConfigKey(building.id)] = rule.enabled;
        payload[priorityUpgradeRequestMinPriorityConfigKey(building.id)] = rule.minPriority;
      }
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to save priority upgrade UI settings");
      setSettingsMessage("已保存，摄影端提权入口会按各楼座规则生效");
    } catch {
      setSettingsMessage("保存失败，请稍后重试");
    } finally {
      setSettingsSaving(false);
    }
  };

  const reviewRequest = async (id: string, action: "approve" | "reject") => {
    if (savingId) return;
    setSavingId(id);
    try {
      const approvedPriority = approvedPriorityById[id];
      const response = await fetch(`/api/task-priority-upgrade-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, approvedPriority }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "审批失败");
      }
      setExitingRequestIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      setRequests((current) => current.filter((request) => request.id !== id));
      setAllPendingRequests((current) => current.filter((request) => request.id !== id));
      await Promise.all([fetchAllPendingRequests(), fetchApprovedRequests()]);
    } catch (error) {
      console.error("Failed to review priority upgrade request", error);
      window.alert(error instanceof Error ? error.message : "审批失败");
    } finally {
      setExitingRequestIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setSavingId(null);
    }
  };

  const applyApprovedRange = (range: "previousBusinessDay" | "previousWeek" | "previousMonth") => {
    if (range === "previousBusinessDay") {
      const day = previousBusinessDay();
      setApprovedStart(dateInputValue(day));
      setApprovedEnd(dateInputValue(day));
      return;
    }
    const nextRange = range === "previousWeek" ? previousWeekRange() : previousMonthRange();
    setApprovedStart(dateInputValue(nextRange.start));
    setApprovedEnd(dateInputValue(nextRange.end));
  };

  const renderRequestCard = (request: PriorityUpgradeRequest, mode: "pending" | "approved") => {
    const options = pendingApprovalPriorityOptions(request.task.priority);
    const selectedPriority = approvedPriorityById[request.id] ?? request.targetPriority;
    const saving = savingId === request.id;
    const photographerProfile = profileById.get(request.task.photographer.id);
    const taskBuildingId = request.task.locationBuildingId ?? request.task.photographer.buildingId;
    const buildingName = taskBuildingId
      ? buildingNameById.get(taskBuildingId) ?? `楼座 ${taskBuildingId}`
      : "楼座待补充";
    const department = departmentForRequest(request) ?? request.task.photographer.department ?? photographerProfile?.department ?? "部门待补充";
    const compact = mode === "pending";
    const exiting = compact && exitingRequestIds.has(request.id);

    if (compact) {
      return (
        <div
          key={request.id}
          className={`approval-request-card admin-table-row rounded-2xl border border-white/70 bg-white/50 px-3 py-2 shadow-sm ${
            exiting ? "approval-request-card-exiting" : ""
          }`}
        >
          <div className="grid items-center gap-3 xl:grid-cols-[minmax(0,1fr)_180px]">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="shrink-0 rounded-lg bg-red-100 px-2 py-1 text-[11px] font-extrabold leading-none text-red-600">
                  P{request.fromPriority} 申请 P{request.targetPriority}
                </span>
                <span className="max-w-[92px] truncate rounded-lg bg-white/70 px-2 py-1 text-[10px] font-extrabold leading-none text-[--text-secondary]">
                  {requestSku(request)}
                </span>
                <span className="min-w-0 truncate text-[13px] font-extrabold text-[--text-primary]">
                  {request.task.roomNumber}室 · {request.task.category.name}
                </span>
                <span className="shrink-0 text-[12px] font-extrabold text-[--text-secondary]">
                  {durationLabel(request.task.category)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-[--text-secondary]">
                <span>楼座：{buildingName}</span>
                <span>所属：{department}</span>
                <span>申请人：{request.requestedBy.name}</span>
                <span>申请时间：{formatTime(request.createdAt)}</span>
              </div>
              <p className="mt-1.5 truncate rounded-xl bg-white/48 px-2.5 py-1 text-[11px] font-semibold text-[--text-secondary]">
                理由：{request.reason || "未填写"}
              </p>
            </div>

            <div className="grid shrink-0 grid-cols-[1fr_auto] items-end gap-2">
              <label className="min-w-0 text-[10px] font-extrabold text-[--text-muted]">
                批准优先级
                <select
                  value={selectedPriority}
                  onChange={(event) => setApprovedPriorityById((current) => ({ ...current, [request.id]: Number(event.target.value) }))}
                  className="mt-1 h-8 w-full rounded-xl border border-white/70 bg-white/72 px-2 text-xs font-extrabold text-slate-700 outline-none"
                  disabled={saving}
                >
                  {options.map((priority) => (
                    <option key={priority} value={priority}>P{priority}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={saving}
                  className="h-8 rounded-xl bg-emerald-500 px-3 text-xs font-extrabold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    void reviewRequest(request.id, "approve");
                  }}
                >
                  批准
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="h-8 rounded-xl bg-red-50 px-3 text-xs font-extrabold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    void reviewRequest(request.id, "reject");
                  }}
                >
                  驳回
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={request.id} className="admin-table-row rounded-2xl border border-white/70 bg-white/50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-extrabold text-red-600">
                P{request.fromPriority} 申请 P{request.targetPriority}
              </span>
              <span className="rounded-lg bg-white/70 px-2 py-1 text-[10px] font-extrabold text-[--text-secondary]">
                {requestSku(request)}
              </span>
              <span className="text-sm font-extrabold text-[--text-primary]">
                {request.task.roomNumber}室 · {request.task.category.name}
              </span>
              <span className="text-xs font-bold text-[--text-muted]">
                {durationLabel(request.task.category)}
              </span>
            </div>
            <div className="mt-2 grid gap-x-3 gap-y-1 text-xs font-medium text-[--text-secondary] sm:grid-cols-2">
              <p>摄影师：{request.task.photographer.name}</p>
              <p>所属：{department}</p>
              <p>楼座：{buildingName}</p>
              <p>申请人：{request.requestedBy.name}</p>
              <p>当前负责人：{request.task.assistant?.name ?? "未分配"}</p>
              <p>通过时间：{formatTime(requestReviewTime(request))}</p>
            </div>
            <p className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-xs font-semibold leading-relaxed text-[--text-secondary]">
              理由：{request.reason || "未填写"}
            </p>
          </div>
          <div className="shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-right">
            <p className="text-[10px] font-extrabold text-emerald-600">已通过</p>
            <p className="mt-1 text-xs font-extrabold text-[--text-primary]">
              P{request.approvedPriority ?? request.targetPriority}
            </p>
            <p className="mt-1 text-[10px] font-bold text-[--text-muted]">
              {request.reviewedBy?.name ?? "审批人待补充"}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[0.25fr_1.75fr]">
        <section className="approval-settings-panel admin-table-row rounded-2xl border border-white/70 bg-white/50 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[--text-primary]">提权申请设置</h3>
          </div>

          <div className="space-y-2.5">
            <div className="approval-settings-table overflow-visible rounded-2xl border border-white/70 bg-white/34 p-1.5">
              <div className="min-w-[280px]">
                <div className="px-2 pb-1.5">
                  <div className="grid grid-cols-[minmax(68px,1fr)_78px_92px] items-center gap-2 text-[10px] font-black text-[--text-primary]">
                    <span>楼座信息</span>
                    <span className="whitespace-nowrap text-center text-[9px]">提权申请启用</span>
                    <span className="text-center">开放范围</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {buildings.length === 0 ? (
                    <p className="rounded-xl bg-white/58 px-3 py-5 text-center text-xs font-semibold text-[--text-muted]">暂无楼座数据</p>
                  ) : buildings.map((building) => {
                    const rule = buildingRulesDraft[building.id] ?? priorityUpgradeRequestRuleForBuilding(config, building.id);
                    return (
                      <div
                        key={building.id}
                        className={`approval-settings-row relative grid min-h-[42px] grid-cols-[minmax(68px,1fr)_78px_92px] items-center gap-2 rounded-2xl bg-white/58 px-2 py-1.5 ${
                          openRangeBuildingId === building.id ? "z-30" : "z-0"
                        }`}
                      >
                        <div className="min-w-0 px-1">
                          <p className="truncate text-[10px] font-extrabold text-[--text-primary]">{building.name}</p>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => updateBuildingRule(building.id, (current) => ({ ...current, enabled: !current.enabled }))}
                            className={`approval-switch relative h-5 w-10 rounded-full p-0.5 transition-colors ${
                              rule.enabled ? "approval-switch-on bg-emerald-500" : "approval-switch-off bg-slate-300"
                            }`}
                            aria-label={`${building.name} 提权申请开关`}
                          >
                            <span
                              className={`approval-switch-knob block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                                rule.enabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                        <div className="relative" data-approval-range-dropdown>
                          <button
                            type="button"
                            disabled={!rule.enabled}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenRangeBuildingId((current) => current === building.id ? null : building.id);
                            }}
                            className={`approval-range-select flex h-7 w-full items-center justify-between gap-1 rounded-xl px-2 text-[10px] font-extrabold outline-none transition-all disabled:cursor-not-allowed disabled:opacity-45 ${approvalPriorityLevelCls(rule.minPriority)}`}
                            aria-expanded={openRangeBuildingId === building.id}
                          >
                            <span>P{rule.minPriority}以上</span>
                            <span className={`text-sm leading-none transition-transform ${openRangeBuildingId === building.id ? "rotate-180" : ""}`}>⌄</span>
                          </button>
                          {openRangeBuildingId === building.id && rule.enabled && (
                            <div className="approval-range-menu absolute left-0 top-[calc(100%+4px)] z-40 w-full overflow-hidden rounded-xl border border-white/70 bg-white/95 p-1 shadow-lg">
                              {PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_OPTIONS.map((priority) => {
                                const selected = priority === rule.minPriority;
                                return (
                                  <button
                                    key={priority}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      updateBuildingRule(building.id, (current) => ({ ...current, minPriority: priority }));
                                      setOpenRangeBuildingId(null);
                                    }}
                                    className={`approval-range-option flex h-7 w-full items-center justify-between rounded-lg px-2 text-[10px] font-extrabold transition-colors ${
                                      selected ? `${approvalPriorityLevelCls(priority)} approval-priority-pill-selected` : "text-[--text-secondary] hover:bg-slate-100/80"
                                    }`}
                                  >
                                    <span>P{priority}以上</span>
                                    {selected && <span className="text-[10px]">✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveBuildingPriorityUpgradeRules()}
                disabled={settingsSaving || buildings.length === 0}
                className="h-8 rounded-xl bg-slate-900 px-3.5 text-[11px] font-extrabold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
              >
                {settingsSaving ? "保存中..." : "保存设置"}
              </button>
              {settingsMessage && (
                <p className="text-[10px] font-bold text-[--text-muted]">{settingsMessage}</p>
              )}
            </div>
          </div>
        </section>

        <section
          className="admin-table-row flex h-[448px] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/50 p-4 shadow-sm"
          onClick={() => setSelectedDepartment(null)}
        >
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[--text-primary]">待处理审批</h3>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[96px_minmax(0,1fr)]">
            <div className="min-h-0 space-y-2 overflow-y-auto pr-0.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedDepartment(null);
                }}
                className={`w-full rounded-2xl border px-2 py-2 text-left transition-all ${
                  selectedDepartment == null
                    ? "border-slate-200 bg-white/72 shadow-sm"
                    : "border-white/70 bg-white/40 hover:bg-white/68"
                }`}
              >
                <span className="block text-[10px] font-extrabold text-[--text-muted]">全部部门</span>
                <span className="mt-1 block text-4xl font-black leading-none text-[--text-primary]">{allPendingRequests.length}</span>
              </button>
              {departmentCounts.map(({ department, count }) => (
                <button
                  key={department}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedDepartment((current) => current === department ? null : department);
                  }}
                  className={`w-full rounded-2xl border px-2 py-2 text-left transition-all ${
                    selectedDepartment === department
                      ? "border-red-200 bg-red-50 shadow-sm"
                      : "border-white/70 bg-white/40 hover:bg-white/68"
                  }`}
                >
                  <span className="block text-[10px] font-extrabold text-[--text-muted]">{department}</span>
                  <span className="mt-1 block text-4xl font-black leading-none text-[--text-primary]">{count}</span>
                </button>
              ))}
            </div>

            <div
              className="min-h-0 overflow-hidden rounded-3xl border border-white/70 bg-white/34 p-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="h-full space-y-1.5 overflow-y-auto pr-1">
                {pendingLoading ? (
                  <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
                ) : requests.length === 0 ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-white/70 bg-white/42 px-4 text-center text-sm font-semibold text-gray-400">
                    暂无待审批提权申请
                  </div>
                ) : (
                  requests.map((request) => renderRequestCard(request, "pending"))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="admin-table-row rounded-2xl border border-white/70 bg-white/50 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[--text-primary]">所有通过审批提权记录</h3>
            <p className="mt-1 text-xs font-medium text-[--text-muted]">
              日期范围会随请求拼接 start/end，由后端筛选返回
            </p>
          </div>
          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-600">
            {approvedRequests.length} 条
          </span>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl bg-white/42 p-3">
          <label className="flex flex-col gap-1 text-[10px] font-extrabold text-[--text-muted]">
            开始日期
            <input
              type="date"
              value={approvedStart}
              onChange={(event) => setApprovedStart(event.target.value)}
              className="h-9 rounded-xl border border-white/70 bg-white/72 px-3 text-xs font-extrabold text-slate-700 outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-extrabold text-[--text-muted]">
            结束日期
            <input
              type="date"
              value={approvedEnd}
              onChange={(event) => setApprovedEnd(event.target.value)}
              className="h-9 rounded-xl border border-white/70 bg-white/72 px-3 text-xs font-extrabold text-slate-700 outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => applyApprovedRange("previousBusinessDay")}
            className="h-9 rounded-xl bg-white/70 px-3 text-xs font-extrabold text-[--text-secondary] transition-colors hover:bg-white"
          >
            上一个工作日
          </button>
          <button
            type="button"
            onClick={() => applyApprovedRange("previousWeek")}
            className="h-9 rounded-xl bg-white/70 px-3 text-xs font-extrabold text-[--text-secondary] transition-colors hover:bg-white"
          >
            上一周
          </button>
          <button
            type="button"
            onClick={() => applyApprovedRange("previousMonth")}
            className="h-9 rounded-xl bg-white/70 px-3 text-xs font-extrabold text-[--text-secondary] transition-colors hover:bg-white"
          >
            上个月
          </button>
          <button
            type="button"
            onClick={() => {
              setApprovedStart("");
              setApprovedEnd("");
            }}
            className="h-9 rounded-xl bg-white/50 px-3 text-xs font-extrabold text-[--text-muted] transition-colors hover:bg-white/80"
          >
            清空
          </button>
        </div>

        <div className="space-y-3">
          {approvedLoading ? (
            <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
          ) : approvedRequests.length === 0 ? (
            <div className="rounded-2xl border border-white/70 bg-white/42 py-10 text-center text-sm font-semibold text-gray-400">
              暂无通过审批提权记录
            </div>
          ) : (
            approvedRequests.map((request) => renderRequestCard(request, "approved"))
          )}
        </div>
      </section>
    </div>
  );
}
