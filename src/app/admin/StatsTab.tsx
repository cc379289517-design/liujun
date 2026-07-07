"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { assistantTaskScoreFromSeconds, displayTaskCategoryName, EXTERNAL_MODEL_ASSIST_DISPLAY_NAME, isExternalModelAssistTaskName } from "@/lib/assistantScore";
import { effectiveWorkMinutesFromApi, totalEffectiveWorkSecondsFromApi } from "@/lib/taskEffectiveTime";

type TaskStatus = "waiting" | "executing" | "paused" | "completed";
type Feedback = "like" | "dislike";
type DatePreset = "today" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";

type BuildingFromAPI = {
  id: number;
  name: string;
};

type ProfileFromAPI = {
  id: string;
  name: string;
  role: string;
  department: string | null;
  group: string | null;
  avatar: string | null;
  buildingId: number;
  activeBuildingId?: number | null;
  building?: BuildingFromAPI;
};

type TaskParticipant = {
  id: string;
  taskId: string;
  assistantId: string;
  role: string;
  status: string;
  joinedAt: string;
  leftAt: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  effectiveWorkSeconds?: number | null;
  workSegmentStartedAt?: string | null;
  assistant: { id: string; name: string; currentRoom: string | null; avatar: string | null; buildingId: number };
};

type TaskFromAPI = {
  id: string;
  photographerId: string;
  assistantId: string | null;
  locationBuildingId?: number | null;
  roomNumber: string;
  categoryId: number;
  priority: number;
  status: TaskStatus;
  note: string | null;
  publisherFeedback?: Feedback | null;
  completionRegistration?: {
    id: string;
    taskId: string;
    assistantId: string;
    sku: string;
    imageUrls: string | string[];
    reasonType?: string | null;
    description: string | null;
    overtimeMinutesSnapshot: number | null;
    workSecondsSnapshot: number | null;
    createdAt: string;
    updatedAt: string;
    assistant?: { id: string; name: string } | null;
  } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estEndTime: string | null;
  effectiveWorkSeconds?: number | null;
  workSegmentStartedAt?: string | null;
  photographer: { id: string; name: string; currentRoom: string | null; buildingId: number };
  assistant: { id: string; name: string; currentRoom: string | null } | null;
  collaborators?: TaskParticipant[];
  category: { id: number; name: string; priorityLevel: number; estDuration?: number; minDuration?: number; maxDuration?: number };
};

type AssistantScoreRow = {
  assistantId: string;
  assistantName: string;
  department: string;
  completedCount: number;
  workSeconds: number;
  crossBuildingCount: number;
  score: number;
  likes: number;
  dislikes: number;
};

type PhotographerRow = {
  photographerId: string;
  photographerName: string;
  buildingName: string;
  total: number;
  overtime: number;
  mainType: string;
};

const DEPARTMENT_OPTIONS = ["一部", "二部", "全域优化组"];
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "thisWeek", label: "本周" },
  { key: "lastWeek", label: "上周" },
  { key: "thisMonth", label: "本月" },
  { key: "lastMonth", label: "上月" },
];
const TASK_TYPE_ORDER = ["手持", "穿戴", "手工", "熨烫", EXTERNAL_MODEL_ASSIST_DISPLAY_NAME, "其他"];

const STATUS_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  waiting: { label: "等待中", cls: "bg-slate-100 text-slate-500" },
  executing: { label: "进行中", cls: "bg-orange-100 text-orange-600" },
  paused: { label: "已暂停", cls: "bg-amber-100 text-amber-600" },
  completed: { label: "已完成", cls: "bg-emerald-100 text-emerald-600" },
};

const PRIORITY_LABEL: Record<number, { label: string; cls: string }> = {
  1: { label: "P1", cls: "bg-red-50 text-red-600" },
  2: { label: "P2", cls: "bg-orange-50 text-orange-600" },
  3: { label: "P3", cls: "bg-amber-50 text-amber-600" },
  4: { label: "P4", cls: "bg-blue-50 text-blue-600" },
  5: { label: "P5", cls: "bg-slate-50 text-slate-500" },
};

const TYPE_META: Record<string, { dot: string; bar: string; text: string }> = {
  "手持": { dot: "#ef4444", bar: "bg-red-400", text: "text-red-600" },
  "穿戴": { dot: "#f97316", bar: "bg-orange-400", text: "text-orange-600" },
  "手工": { dot: "#f59e0b", bar: "bg-amber-400", text: "text-amber-600" },
  "熨烫": { dot: "#10b981", bar: "bg-emerald-400", text: "text-emerald-600" },
  [EXTERNAL_MODEL_ASSIST_DISPLAY_NAME]: { dot: "#a855f7", bar: "bg-purple-400", text: "text-purple-600" },
  "其他": { dot: "#3b82f6", bar: "bg-blue-400", text: "text-blue-600" },
};

const PINYIN_INITIALS: Record<string, string> = {
  张: "z", 王: "w", 李: "l", 赵: "z", 刘: "l", 陈: "c", 杨: "y", 黄: "h", 周: "z", 吴: "w",
  徐: "x", 孙: "s", 胡: "h", 朱: "z", 高: "g", 林: "l", 何: "h", 郭: "g", 马: "m", 罗: "l",
  梁: "l", 宋: "s", 郑: "z", 谢: "x", 韩: "h", 唐: "t", 冯: "f", 于: "y", 董: "d", 萧: "x",
  程: "c", 曹: "c", 袁: "y", 邓: "d", 许: "x", 傅: "f", 沈: "s", 曾: "z", 彭: "p", 吕: "l",
  苏: "s", 卢: "l", 蒋: "j", 蔡: "c", 贾: "j", 丁: "d", 魏: "w", 薛: "x", 叶: "y", 阎: "y",
  余: "y", 潘: "p", 杜: "d", 戴: "d", 夏: "x", 钟: "z", 汪: "w", 田: "t", 任: "r", 姜: "j",
  范: "f", 方: "f", 石: "s", 姚: "y", 谭: "t", 廖: "l", 邹: "z", 熊: "x", 金: "j", 陆: "l",
  郝: "h", 孔: "k", 白: "b", 崔: "c", 康: "k", 毛: "m", 邱: "q", 秦: "q", 江: "j", 史: "s",
  顾: "g", 侯: "h", 邵: "s", 孟: "m", 龙: "l", 万: "w", 段: "d", 雷: "l", 钱: "q", 汤: "t",
  尹: "y", 黎: "l", 易: "y", 常: "c", 武: "w", 乔: "q", 贺: "h", 赖: "l", 龚: "g", 文: "w",
  摄: "s", 助: "z", 小: "x", 阿: "a",
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, diff));
}

function dateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function presetRange(preset: DatePreset, now = new Date()) {
  const today = startOfDay(now);
  if (preset === "today") return { start: today, end: addDays(today, 1) };
  if (preset === "thisWeek") {
    const start = startOfWeek(now);
    return { start, end: addDays(start, 7) };
  }
  if (preset === "lastWeek") {
    const start = addDays(startOfWeek(now), -7);
    return { start, end: addDays(start, 7) };
  }
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }
  if (preset === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start, end: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  return { start: today, end: addDays(today, 1) };
}

function parseDateInput(value: string, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function formatDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtMin(min: number) {
  const value = Math.max(0, Math.round(Number(min) || 0));
  if (value <= 60) return `${value}分钟`;
  const hour = Math.round((value / 60) * 10) / 10;
  return Number.isInteger(hour) ? `${hour}小时` : `${hour.toFixed(1)}小时`;
}

function fmtScore(score: number) {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function taskTypeGroup(name: string | undefined, priority?: number | null) {
  const value = name || "";
  if (isExternalModelAssistTaskName(value, priority)) return EXTERNAL_MODEL_ASSIST_DISPLAY_NAME;
  if (value.includes("手持")) return "手持";
  if (value.includes("穿戴") || value.includes("服装")) return "穿戴";
  if (value.includes("手工") || value.includes("DIY")) return "手工";
  if (value.includes("熨烫")) return "熨烫";
  return "其他";
}

function roomLabel(value: string | null | undefined) {
  if (!value) return "—";
  if (value.endsWith("室")) return value;
  return /^\d+$/.test(value) ? `${value}室` : value;
}

function durationLabel(cat: TaskFromAPI["category"] | undefined) {
  if (!cat) return "—";
  if (typeof cat.minDuration === "number" && typeof cat.maxDuration === "number") {
    const min = cat.minDuration;
    const max = cat.maxDuration;
    if (min > 0 || max > 0) return min === max ? fmtMin(max) : `${fmtMin(min)}-${fmtMin(max)}`;
  }
  if (typeof cat.estDuration === "number" && cat.estDuration > 0) return fmtMin(cat.estDuration);
  return "—";
}

function nameInitials(name: string) {
  return Array.from(name)
    .map((char) => {
      if (/^[a-zA-Z0-9]$/.test(char)) return char.toLowerCase();
      return PINYIN_INITIALS[char] || "";
    })
    .join("");
}

function matchesName(name: string | null | undefined, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const raw = (name || "").toLowerCase();
  return raw.includes(q) || nameInitials(name || "").includes(q);
}

function taskParticipants(task: TaskFromAPI) {
  return (task.collaborators ?? []).filter((c) => c.status !== "left");
}

function taskParticipantFor(task: TaskFromAPI, assistantId: string | null | undefined) {
  if (!assistantId) return null;
  return taskParticipants(task).find((c) => c.assistantId === assistantId) ?? null;
}

function taskBuildingId(task: TaskFromAPI) {
  return task.locationBuildingId ?? task.photographer?.buildingId ?? null;
}

function isCompletedOvertime(task: TaskFromAPI) {
  if (task.status !== "completed" || !task.completedAt || !task.estEndTime) return false;
  return new Date(task.completedAt).getTime() > new Date(task.estEndTime).getTime();
}

function registrationImageUrls(task: TaskFromAPI) {
  const raw = task.completionRegistration?.imageUrls;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function participantCompletedAtMs(task: TaskFromAPI, participant?: TaskParticipant | null) {
  const raw = participant?.completedAt ?? task.completedAt ?? task.createdAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export default function StatsTab() {
  const defaultRange = useMemo(() => presetRange("thisWeek"), []);
  const [tasks, setTasks] = useState<TaskFromAPI[]>([]);
  const [profiles, setProfiles] = useState<ProfileFromAPI[]>([]);
  const [buildings, setBuildings] = useState<BuildingFromAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [datePreset, setDatePreset] = useState<DatePreset>("thisWeek");
  const [customStart, setCustomStart] = useState(dateInputValue(defaultRange.start));
  const [customEnd, setCustomEnd] = useState(dateInputValue(addDays(defaultRange.end, -1)));
  const [scopeType, setScopeType] = useState<"all" | "department" | "building">("all");
  const [scopeDepartment, setScopeDepartment] = useState("");
  const [scopeBuildingId, setScopeBuildingId] = useState("");
  const [detailNameQuery, setDetailNameQuery] = useState("");
  const [detailDepartment, setDetailDepartment] = useState("");
  const [detailBuildingId, setDetailBuildingId] = useState("");
  const [detailTaskType, setDetailTaskType] = useState("");
  const [detailPriority, setDetailPriority] = useState("");
  const [detailRegistration, setDetailRegistration] = useState("");
  const [detailSku, setDetailSku] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, profileRes, buildingRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/profiles"),
        fetch("/api/buildings"),
      ]);
      if (taskRes.ok) {
        const data = await taskRes.json();
        setTasks(Array.isArray(data) ? data : []);
      }
      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfiles(Array.isArray(data) ? data : []);
      }
      if (buildingRes.ok) {
        const data = await buildingRes.json();
        setBuildings(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch stats data", error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const range = useMemo(() => {
    if (datePreset !== "custom") return presetRange(datePreset, new Date(nowMs));
    const start = parseDateInput(customStart, defaultRange.start);
    const endDay = parseDateInput(customEnd, addDays(defaultRange.end, -1));
    return { start, end: addDays(endDay, 1) };
  }, [customEnd, customStart, datePreset, defaultRange.end, defaultRange.start, nowMs]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const buildingNameById = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings]);
  const departments = useMemo(() => {
    const fromProfiles = profiles.map((p) => p.department).filter((v): v is string => Boolean(v));
    return Array.from(new Set([...DEPARTMENT_OPTIONS, ...fromProfiles]));
  }, [profiles]);

  const baseTasks = useMemo(() => {
    return tasks.filter((task) => {
      const created = new Date(task.createdAt);
      if (created < range.start || created >= range.end) return false;
      if (scopeType === "department") {
        const assistantProfile = task.assistantId ? profileById.get(task.assistantId) : null;
        const collaboratorProfiles = taskParticipants(task).map((c) => profileById.get(c.assistantId)).filter(Boolean) as ProfileFromAPI[];
        const hasDepartment = [assistantProfile, ...collaboratorProfiles].some((p) => (p?.department || "") === scopeDepartment);
        if (!hasDepartment) return false;
      }
      if (scopeType === "building" && scopeBuildingId) {
        if (String(taskBuildingId(task) ?? "") !== scopeBuildingId) return false;
      }
      return true;
    });
  }, [profileById, range.end, range.start, scopeBuildingId, scopeDepartment, scopeType, tasks]);

  const detailTasks = useMemo(() => {
    return baseTasks.filter((task) => {
      if (detailDepartment) {
        const assistantProfile = task.assistantId ? profileById.get(task.assistantId) : null;
        const collaboratorProfiles = taskParticipants(task).map((c) => profileById.get(c.assistantId)).filter(Boolean) as ProfileFromAPI[];
        if (![assistantProfile, ...collaboratorProfiles].some((p) => (p?.department || "") === detailDepartment)) return false;
      }
      if (detailBuildingId && String(taskBuildingId(task) ?? "") !== detailBuildingId) return false;
      if (detailTaskType && taskTypeGroup(task.category?.name, task.priority) !== detailTaskType) return false;
      if (detailPriority && task.priority !== Number(detailPriority)) return false;
      if (detailRegistration === "registered" && !task.completionRegistration) return false;
      if (detailRegistration === "unregistered" && (task.status !== "completed" || task.completionRegistration)) return false;
      if (detailRegistration === "overtimeRegistered" && (!task.completionRegistration || !isCompletedOvertime(task))) return false;
      if (detailSku && !(task.completionRegistration?.sku ?? "").toLowerCase().includes(detailSku.trim().toLowerCase())) return false;
      if (detailNameQuery) {
        const names = [
          task.photographer?.name,
          task.assistant?.name,
          ...taskParticipants(task).map((c) => c.assistant?.name),
        ];
        if (!names.some((name) => matchesName(name, detailNameQuery))) return false;
      }
      return true;
    });
  }, [baseTasks, detailBuildingId, detailDepartment, detailNameQuery, detailPriority, detailRegistration, detailSku, detailTaskType, profileById]);

  const analytics = useMemo(() => {
    const completed = baseTasks.filter((t) => t.status === "completed");
    const overtime = completed.filter(isCompletedOvertime);
    const registered = completed.filter((t) => t.completionRegistration);
    const registeredOvertime = registered.filter(isCompletedOvertime);
    const avgDuration = completed.length
      ? Math.round(completed.reduce((sum, t) => sum + effectiveWorkMinutesFromApi(t, nowMs), 0) / completed.length)
      : 0;
    const likes = baseTasks.filter((t) => t.publisherFeedback === "like").length;
    const dislikes = baseTasks.filter((t) => t.publisherFeedback === "dislike").length;

    const typeCounts = new Map<string, number>();
    for (const task of baseTasks) {
      const type = taskTypeGroup(task.category?.name, task.priority);
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    const typeBreakdown = TASK_TYPE_ORDER.map((name) => ({
      name,
      count: typeCounts.get(name) ?? 0,
      pct: baseTasks.length ? Math.round(((typeCounts.get(name) ?? 0) / baseTasks.length) * 100) : 0,
    })).filter((item) => item.count > 0);
    const mainTaskType = [...typeBreakdown].sort((a, b) => b.count - a.count)[0]?.name ?? "—";

    const assistantMap = new Map<string, {
      assistantId: string;
      assistantName: string;
      department: string;
      entries: { taskId: string; taskName: string; buildingId: number | null; completedAtMs: number; workSeconds: number; feedback: Feedback | null }[];
    }>();

    const addAssistantEntry = (task: TaskFromAPI, assistantId: string, assistantName: string, source: TaskFromAPI | TaskParticipant, completedAtMs: number) => {
      const profile = profileById.get(assistantId);
      const row = assistantMap.get(assistantId) ?? {
        assistantId,
        assistantName: profile?.name ?? assistantName,
        department: profile?.department || "未分组",
        entries: [],
      };
      row.entries.push({
        taskId: task.id,
        taskName: displayTaskCategoryName(task.category?.name, task.priority),
        buildingId: taskBuildingId(task),
        completedAtMs,
        workSeconds: totalEffectiveWorkSecondsFromApi({ ...source, status: "completed" }, nowMs),
        feedback: task.publisherFeedback ?? null,
      });
      assistantMap.set(assistantId, row);
    };

    for (const task of completed) {
      const seen = new Set<string>();
      if (task.assistantId) {
        const participant = taskParticipantFor(task, task.assistantId);
        addAssistantEntry(task, task.assistantId, task.assistant?.name ?? "未命名助理", participant ?? task, participantCompletedAtMs(task, participant));
        seen.add(task.assistantId);
      }
      for (const participant of taskParticipants(task)) {
        if (participant.status !== "completed" || seen.has(participant.assistantId)) continue;
        addAssistantEntry(task, participant.assistantId, participant.assistant?.name ?? "未命名助理", participant, participantCompletedAtMs(task, participant));
        seen.add(participant.assistantId);
      }
    }

    const assistantRanking: AssistantScoreRow[] = Array.from(assistantMap.values()).map((row) => {
      const entries = [...row.entries].sort((a, b) => a.completedAtMs - b.completedAtMs);
      let crossBuildingCount = 0;
      for (let i = 1; i < entries.length; i++) {
        if (entries[i - 1].buildingId != null && entries[i].buildingId != null && entries[i - 1].buildingId !== entries[i].buildingId) {
          crossBuildingCount++;
        }
      }
      const workSeconds = entries.reduce((sum, entry) => sum + entry.workSeconds, 0);
      const score = entries.reduce(
        (sum, entry) => sum + assistantTaskScoreFromSeconds(entry.workSeconds, entry.taskName),
        0,
      );
      const completedCount = entries.length;
      return {
        assistantId: row.assistantId,
        assistantName: row.assistantName,
        department: row.department,
        completedCount,
        workSeconds,
        crossBuildingCount,
        score,
        likes: entries.filter((entry) => entry.feedback === "like").length,
        dislikes: entries.filter((entry) => entry.feedback === "dislike").length,
      };
    }).sort((a, b) => b.score - a.score || b.completedCount - a.completedCount || b.workSeconds - a.workSeconds || a.assistantName.localeCompare(b.assistantName));

    const photographerMap = new Map<string, { photographerName: string; buildingName: string; tasks: TaskFromAPI[] }>();
    for (const task of baseTasks) {
      const current = photographerMap.get(task.photographerId) ?? {
        photographerName: task.photographer?.name ?? "未命名摄影师",
        buildingName: buildingNameById.get(task.photographer?.buildingId ?? -1) ?? "未设置",
        tasks: [],
      };
      current.tasks.push(task);
      photographerMap.set(task.photographerId, current);
    }
    const photographerRows: PhotographerRow[] = Array.from(photographerMap.entries()).map(([photographerId, row]) => {
      const localTypeCounts = new Map<string, number>();
      for (const task of row.tasks) {
        const type = taskTypeGroup(task.category?.name, task.priority);
        localTypeCounts.set(type, (localTypeCounts.get(type) ?? 0) + 1);
      }
      const mainType = [...localTypeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
      return {
        photographerId,
        photographerName: row.photographerName,
        buildingName: row.buildingName,
        total: row.tasks.length,
        overtime: row.tasks.filter(isCompletedOvertime).length,
        mainType,
      };
    }).sort((a, b) => b.total - a.total || b.overtime - a.overtime || a.photographerName.localeCompare(b.photographerName));

    const days: { label: string; publish: number; completed: number }[] = [];
    for (let cursor = new Date(range.start); cursor < range.end && days.length < 45; cursor = addDays(cursor, 1)) {
      const dayStart = new Date(cursor);
      const dayEnd = addDays(dayStart, 1);
      days.push({
        label: formatDate(dayStart),
        publish: baseTasks.filter((task) => {
          const created = new Date(task.createdAt);
          return created >= dayStart && created < dayEnd;
        }).length,
        completed: baseTasks.filter((task) => {
          if (!task.completedAt) return false;
          const done = new Date(task.completedAt);
          return done >= dayStart && done < dayEnd;
        }).length,
      });
    }

    return {
      total: baseTasks.length,
      completed: completed.length,
      overtime: overtime.length,
      registered: registered.length,
      registeredOvertime: registeredOvertime.length,
      avgDuration,
      likes,
      dislikes,
      likeRate: likes + dislikes > 0 ? Math.round((likes / (likes + dislikes)) * 100) : 0,
      typeBreakdown,
      mainTaskType,
      assistantRanking,
      photographerRows,
      trendDays: days,
    };
  }, [baseTasks, buildingNameById, nowMs, profileById, range.end, range.start]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-[--text-muted]">加载中...</div>;
  }

  const rangeLabel = `${formatDate(range.start)} - ${formatDate(addDays(range.end, -1))}`;
  const maxTrend = Math.max(1, ...analytics.trendDays.flatMap((item) => [item.publish, item.completed]));

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-extrabold text-[--text-primary]">数据统计</h2>
            <p className="mt-1 text-[11px] font-semibold text-[--text-muted]">
              {rangeLabel} · {scopeType === "all" ? "全部范围" : scopeType === "department" ? scopeDepartment || "未选择部门" : buildingNameById.get(Number(scopeBuildingId)) || "未选择楼座"}
            </p>
          </div>
          <button onClick={fetchData} className="rounded-xl bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 shadow-sm ring-1 ring-white/70 transition-colors hover:bg-white/80">刷新数据</button>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-wrap gap-2">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => setDatePreset(preset.key)}
                className={`rounded-xl px-3 py-2 text-[12px] font-extrabold transition-colors ${datePreset === preset.key ? "bg-slate-900 text-white shadow-lg" : "bg-white/52 text-slate-600 hover:bg-white/80"}`}
              >
                {preset.label}
              </button>
            ))}
            <button
              onClick={() => setDatePreset("custom")}
              className={`rounded-xl px-3 py-2 text-[12px] font-extrabold transition-colors ${datePreset === "custom" ? "bg-slate-900 text-white shadow-lg" : "bg-white/52 text-slate-600 hover:bg-white/80"}`}
            >
              自定义
            </button>
            {datePreset === "custom" && (
              <div className="flex items-center gap-2 rounded-xl bg-white/52 px-2 py-1 ring-1 ring-white/70">
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-transparent text-[12px] font-bold text-slate-600 outline-none" />
                <span className="text-[11px] font-bold text-slate-400">至</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-transparent text-[12px] font-bold text-slate-600 outline-none" />
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <button onClick={() => setScopeType("all")} className={`rounded-xl px-3 py-2 text-[12px] font-extrabold ${scopeType === "all" ? "bg-blue-500 text-white" : "bg-white/52 text-slate-600 hover:bg-white/80"}`}>全部</button>
            <select
              value={scopeType === "department" ? scopeDepartment : ""}
              onChange={(e) => { setScopeType("department"); setScopeDepartment(e.target.value); }}
              className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"
            >
              <option value="">选择部门</option>
              {departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            <select
              value={scopeType === "building" ? scopeBuildingId : ""}
              onChange={(e) => { setScopeType("building"); setScopeBuildingId(e.target.value); }}
              className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"
            >
              <option value="">选择楼座</option>
              {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-6">
        {[
          { label: "发布总任务", value: analytics.total, unit: "单", cls: "text-slate-900" },
          { label: "已完成", value: analytics.completed, unit: "单", cls: "text-emerald-600" },
          { label: "已完成超时", value: analytics.overtime, unit: "单", cls: "text-red-500" },
          { label: "异常登记", value: analytics.registered, unit: "条", cls: "text-orange-500" },
          { label: "平均用时", value: analytics.avgDuration, unit: "分钟", cls: "text-blue-600" },
          { label: "点赞率", value: analytics.likeRate, unit: "%", cls: "text-orange-500" },
        ].map((item) => (
          <div key={item.label} className="card px-4 py-4">
            <p className="text-[11px] font-bold text-[--text-muted]">{item.label}</p>
            <div className="mt-3 flex items-end gap-1">
              <span className={`text-[30px] font-extrabold leading-none tabular-nums ${item.cls}`}>{item.value}</span>
              <span className="pb-1 text-[11px] font-bold text-[--text-muted]">{item.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-[--text-primary]">助理运转排行</h3>
              <p className="mt-1 text-[10px] font-semibold text-[--text-muted]">综合分 = 实际服务时长(1小时=1分)，外模跟拍协助按 x0.8</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-extrabold text-blue-600">TOP {Math.min(10, analytics.assistantRanking.length)}</span>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[38px_1.2fr_0.8fr_0.75fr_0.75fr_0.75fr_0.7fr] items-center gap-2 rounded-xl bg-slate-50/70 px-3 py-2 text-[10px] font-extrabold text-[--text-muted]">
              <span>#</span><span>助理</span><span>部门</span><span className="text-right">完成</span><span className="text-right">贡献值</span><span className="text-right">点赞/点踩</span><span className="text-right">跨区</span>
            </div>
            {analytics.assistantRanking.length === 0 ? (
              <div className="rounded-2xl bg-white/34 py-10 text-center text-[12px] font-semibold text-[--text-muted]">暂无助理完成数据</div>
            ) : analytics.assistantRanking.slice(0, 10).map((row, index) => {
              const pct = Math.max(6, Math.round((row.score / Math.max(analytics.assistantRanking[0]?.score || 1, 1)) * 100));
              return (
                <div key={row.assistantId} className="grid grid-cols-[38px_1.2fr_0.8fr_0.75fr_0.75fr_0.75fr_0.7fr] items-center gap-2 rounded-2xl bg-white/44 px-3 py-2.5 text-[12px] font-bold text-slate-700 transition-colors hover:bg-white/70">
                  <span className={`font-black ${index < 3 ? "text-orange-500" : "text-slate-400"}`}>{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-extrabold text-[--text-primary]">{row.assistantName}</span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} /></span>
                  </span>
                  <span className="truncate text-[--text-muted]">{row.department}</span>
                  <span className="text-right tabular-nums text-emerald-600">{row.completedCount}</span>
                  <span className="text-right tabular-nums text-orange-500">{fmtScore(row.score)}</span>
                  <span className="text-right tabular-nums text-[--text-muted]">{row.likes}/{row.dislikes}</span>
                  <span className="text-right tabular-nums text-[--text-muted]">{row.crossBuildingCount}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-extrabold text-[--text-primary]">任务类型占比</h3>
              <span className="text-[11px] font-bold text-[--text-muted]">主要：{analytics.mainTaskType}</span>
            </div>
            <div className="space-y-3">
              {analytics.typeBreakdown.length === 0 ? <div className="py-8 text-center text-[12px] font-semibold text-[--text-muted]">暂无类型数据</div> : analytics.typeBreakdown.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-[12px] font-bold">
                    <span className="flex items-center gap-2 text-[--text-primary]"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_META[item.name].dot }} />{item.name}</span>
                    <span className="text-[--text-muted]">{item.count}单 · {item.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${TYPE_META[item.name].bar}`} style={{ width: `${item.pct}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 text-[15px] font-extrabold text-[--text-primary]">摄影发布情况</h3>
            <div className="space-y-2">
              {analytics.photographerRows.slice(0, 5).map((row) => (
                <div key={row.photographerId} className="grid grid-cols-[1fr_54px_54px_64px] items-center gap-2 rounded-xl bg-white/44 px-3 py-2 text-[11px] font-bold">
                  <span className="min-w-0"><span className="block truncate text-[--text-primary]">{row.photographerName}</span><span className="text-[10px] text-[--text-muted]">{row.buildingName}</span></span>
                  <span className="text-right text-slate-600">{row.total}单</span>
                  <span className="text-right text-red-500">超时{row.overtime}</span>
                  <span className={`text-right ${TYPE_META[row.mainType]?.text || "text-slate-500"}`}>{row.mainType}</span>
                </div>
              ))}
              {analytics.photographerRows.length === 0 && <div className="py-8 text-center text-[12px] font-semibold text-[--text-muted]">暂无发布数据</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold text-[--text-primary]">发布 / 完成趋势</h3>
          <div className="flex items-center gap-4 text-[11px] font-bold text-[--text-muted]"><span>发布</span><span className="text-emerald-600">完成</span></div>
        </div>
        <div className="flex h-44 items-end gap-2 overflow-x-auto pb-1 task-scroll">
          {analytics.trendDays.map((day) => (
            <div key={day.label} className="flex min-w-[42px] flex-1 flex-col items-center justify-end gap-1">
              <div className="flex h-32 items-end gap-1">
                <span className="w-3 rounded-t bg-blue-300" style={{ height: `${Math.max(2, (day.publish / maxTrend) * 120)}px` }} title={`发布 ${day.publish}`} />
                <span className="w-3 rounded-t bg-emerald-400" style={{ height: `${Math.max(2, (day.completed / maxTrend) * 120)}px` }} title={`完成 ${day.completed}`} />
              </div>
              <span className="text-[10px] font-bold text-[--text-muted]">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="border-b border-white/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-extrabold text-[--text-primary]">任务明细 <span className="text-[12px] text-[--text-muted]">({detailTasks.length})</span></h3>
            <input
              value={detailNameQuery}
              onChange={(e) => setDetailNameQuery(e.target.value)}
              placeholder="搜索摄影师/助理姓名或首字母"
              className="w-[260px] rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70 placeholder:text-slate-400"
            />
          </div>
          <div className="grid gap-2 md:grid-cols-6">
            <select value={detailDepartment} onChange={(e) => setDetailDepartment(e.target.value)} className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"><option value="">全部部门</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <select value={detailBuildingId} onChange={(e) => setDetailBuildingId(e.target.value)} className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"><option value="">全部楼座</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <select value={detailTaskType} onChange={(e) => setDetailTaskType(e.target.value)} className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"><option value="">全部类型</option>{TASK_TYPE_ORDER.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select value={detailPriority} onChange={(e) => setDetailPriority(e.target.value)} className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70"><option value="">全部优先级</option>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
            <select value={detailRegistration} onChange={(e) => setDetailRegistration(e.target.value)} className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70">
              <option value="">全部登记</option>
              <option value="registered">已异常登记</option>
              <option value="overtimeRegistered">超时且已登记</option>
              <option value="unregistered">已完成未登记</option>
            </select>
            <input
              value={detailSku}
              onChange={(e) => setDetailSku(e.target.value)}
              placeholder="搜索 SKU"
              className="rounded-xl border-0 bg-white/58 px-3 py-2 text-[12px] font-bold text-slate-600 outline-none ring-1 ring-white/70 placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto task-scroll">
          <table className="w-full min-w-[1320px] border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl">
              <tr className="border-b border-slate-200/70 text-[10px] font-extrabold uppercase tracking-wide text-[--text-muted]">
                <th className="px-4 py-3">时间</th><th className="px-3 py-3">摄影师</th><th className="px-3 py-3">助理</th><th className="px-3 py-3">部门</th><th className="px-3 py-3">楼座</th><th className="px-3 py-3">房间</th><th className="px-3 py-3">类型</th><th className="px-3 py-3">优先级</th><th className="px-3 py-3">用时</th><th className="px-3 py-3">SKU/登记</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">反馈</th>
              </tr>
            </thead>
            <tbody>
              {detailTasks.length === 0 ? (
                <tr><td colSpan={12} className="py-10 text-center text-[12px] font-semibold text-[--text-muted]">暂无匹配任务</td></tr>
              ) : detailTasks.map((task) => {
                const assistantProfile = task.assistantId ? profileById.get(task.assistantId) : null;
                const participantNames = taskParticipants(task).filter((p) => p.role !== "primary" && p.assistantId !== task.assistantId).map((p) => p.assistant.name);
                const assistantNames = [task.assistant?.name, ...participantNames].filter(Boolean).join("、") || "—";
                const department = assistantProfile?.department || "—";
                const buildingName = buildingNameById.get(taskBuildingId(task) ?? -1) ?? "—";
                const pr = PRIORITY_LABEL[task.priority] || PRIORITY_LABEL[4];
                const st = STATUS_STYLE[task.status];
                const type = taskTypeGroup(task.category?.name, task.priority);
                const registration = task.completionRegistration;
                const imageUrls = registrationImageUrls(task);
                const imageCount = imageUrls.length;
                return (
                  <tr key={task.id} className="border-b border-slate-100/80 transition-colors hover:bg-white/44">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[--text-muted]">{formatDateTime(task.createdAt)}</td>
                    <td className="px-3 py-3 font-bold text-[--text-primary]">{task.photographer?.name || "—"}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 font-bold text-slate-600" title={assistantNames}>{assistantNames}</td>
                    <td className="px-3 py-3 text-[--text-muted]">{department}</td>
                    <td className="px-3 py-3 text-[--text-muted]">{buildingName}</td>
                    <td className="px-3 py-3 text-[--text-muted]">{roomLabel(task.roomNumber)}</td>
                    <td className={`px-3 py-3 font-extrabold ${TYPE_META[type].text}`}>{type}</td>
                    <td className="px-3 py-3"><span className={`rounded-md px-2 py-1 text-[10px] font-black ${pr.cls}`}>{pr.label}</span></td>
                    <td className="px-3 py-3 text-[--text-muted]">{task.status === "completed" || task.status === "executing" || task.status === "paused" ? fmtMin(effectiveWorkMinutesFromApi(task, nowMs)) : durationLabel(task.category)}</td>
                    <td className="max-w-[220px] px-3 py-3">
                      {registration ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="rounded-md bg-orange-50 px-2 py-1 text-[10px] font-black text-orange-600">{registration.sku}</span>
                            {registration.reasonType ? <span className="rounded-md bg-slate-50 px-1.5 py-1 text-[10px] font-bold text-slate-500">{registration.reasonType}</span> : null}
                            {registration.overtimeMinutesSnapshot ? <span className="rounded-md bg-red-50 px-1.5 py-1 text-[10px] font-bold text-red-500">超{registration.overtimeMinutesSnapshot}分</span> : null}
                            {imageCount > 0 ? <a href={imageUrls[0]} target="_blank" rel="noreferrer" className="rounded-md bg-blue-50 px-1.5 py-1 text-[10px] font-bold text-blue-500 hover:bg-blue-100">图{imageCount}</a> : null}
                          </div>
                          {registration.description && <p className="truncate text-[10px] font-semibold text-[--text-muted]" title={registration.description}>{registration.description}</p>}
                        </div>
                      ) : task.status === "completed" ? (
                        <span className="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400">未登记</span>
                      ) : (
                        <span className="text-[--text-muted]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><span className={`rounded-md px-2 py-1 text-[10px] font-black ${st.cls}`}>{st.label}</span></td>
                    <td className="px-3 py-3 text-[--text-muted]">{task.publisherFeedback === "like" ? "点赞" : task.publisherFeedback === "dislike" ? "点踩" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
