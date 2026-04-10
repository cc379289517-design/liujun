/**
 * 任务「有效执行时长」：只累计 status=executing 的时间段；
 * 暂停、待就位、插单占用时间不计入。
 */

export type TaskEffectiveFields = {
  effectiveWorkSeconds: number;
  workSegmentStartedAt: Date | null;
  startedAt: Date | null;
  status: string;
};

export function activeSegmentStart(task: TaskEffectiveFields): Date | null {
  if (task.status !== "executing") return null;
  return task.workSegmentStartedAt ?? task.startedAt;
}

/** 当前正在执行的片段已过去的秒数（未写入 effectiveWorkSeconds 的部分） */
export function runningSegmentSeconds(task: TaskEffectiveFields, nowMs = Date.now()): number {
  const seg = activeSegmentStart(task);
  if (!seg) return 0;
  return Math.max(0, Math.floor((nowMs - seg.getTime()) / 1000));
}

/** 总有效秒数 = 已结算 + 当前执行片段 */
export function totalEffectiveWorkSeconds(task: TaskEffectiveFields, nowMs = Date.now()): number {
  return (task.effectiveWorkSeconds ?? 0) + runningSegmentSeconds(task, nowMs);
}

/** 将当前执行片段结算进 effectiveWorkSeconds，并清空片段起点（用于 pause / complete / 手工改状态） */
export function flushExecutingSegment(task: TaskEffectiveFields, nowMs = Date.now()): {
  effectiveWorkSeconds: number;
  workSegmentStartedAt: null;
} {
  if (task.status !== "executing") {
    return { effectiveWorkSeconds: task.effectiveWorkSeconds ?? 0, workSegmentStartedAt: null };
  }
  const seg = task.workSegmentStartedAt ?? task.startedAt;
  if (!seg) {
    return { effectiveWorkSeconds: task.effectiveWorkSeconds ?? 0, workSegmentStartedAt: null };
  }
  const delta = Math.max(0, Math.floor((nowMs - seg.getTime()) / 1000));
  return {
    effectiveWorkSeconds: (task.effectiveWorkSeconds ?? 0) + delta,
    workSegmentStartedAt: null,
  };
}

const toDate = (v: string | Date | null | undefined) =>
  v == null ? null : v instanceof Date ? v : new Date(v);

/** API/JSON 任务对象：总有效秒数 */
export function totalEffectiveWorkSecondsFromApi(
  task: {
    effectiveWorkSeconds?: number | null;
    workSegmentStartedAt?: string | Date | null;
    startedAt?: string | Date | null;
    completedAt?: string | Date | null;
    pausedAt?: string | Date | null;
    status: string;
  },
  nowMs = Date.now()
): number {
  const baseEff = task.effectiveWorkSeconds ?? 0;
  // 迁移前已暂停的任务：无累计字段时用「开始→点击暂停」墙钟差近似有效工时
  if (baseEff === 0 && task.status === "paused" && task.startedAt && task.pausedAt) {
    const s = toDate(task.startedAt)!.getTime();
    const p = toDate(task.pausedAt)!.getTime();
    return Math.max(0, Math.floor((p - s) / 1000));
  }
  // 旧数据：无 effective 字段时，已完成任务退回墙钟差（秒）
  if (baseEff === 0 && task.status === "completed" && task.startedAt && task.completedAt) {
    const s = toDate(task.startedAt)!.getTime();
    const e = toDate(task.completedAt)!.getTime();
    return Math.max(0, Math.floor((e - s) / 1000));
  }

  return totalEffectiveWorkSeconds(
    {
      effectiveWorkSeconds: baseEff,
      workSegmentStartedAt: toDate(task.workSegmentStartedAt),
      startedAt: toDate(task.startedAt),
      status: task.status,
    },
    nowMs
  );
}

/** API/JSON 任务对象上的有效工时（分钟），供前端展示 */
export function effectiveWorkMinutesFromApi(
  task: {
    effectiveWorkSeconds?: number | null;
    workSegmentStartedAt?: string | Date | null;
    startedAt?: string | Date | null;
    completedAt?: string | Date | null;
    status: string;
  },
  nowMs = Date.now()
): number {
  return Math.floor(totalEffectiveWorkSecondsFromApi(task, nowMs) / 60);
}
