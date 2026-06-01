export const PHOTOGRAPHER_MAX_ACTIVE_TASKS_CONFIG_KEY = "photographer_max_active_tasks";
export const DEFAULT_PHOTOGRAPHER_MAX_ACTIVE_TASKS = 1;
export const PHOTOGRAPHER_MAX_ACTIVE_TASK_OPTIONS = [1, 2, 3, 4] as const;
export const PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON = "photographer_active_task_limit_queue";
export const PHOTOGRAPHER_LIMIT_QUEUE_CAPACITY = 1;

export function parsePhotographerMaxActiveTasks(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PHOTOGRAPHER_MAX_ACTIVE_TASKS;
  const normalized = Math.floor(parsed);
  if (!PHOTOGRAPHER_MAX_ACTIVE_TASK_OPTIONS.includes(normalized as 1 | 2 | 3 | 4)) {
    return DEFAULT_PHOTOGRAPHER_MAX_ACTIVE_TASKS;
  }
  return normalized;
}

export function photographerLimitQueuePrompt(limit: number): string {
  return `当前摄影师已达到最大${limit}条任务发布量，待上一任务完结后进入公共队列中排队`;
}

export function photographerLimitQueueFullPrompt(limit: number): string {
  return `当前摄影师已达到最大${limit}条任务发布量，且已有任务在队列中，请先完成或取消已有任务后再发布`;
}

export function isPhotographerLimitQueuedTask(task: { isLocked?: boolean | null; lockReason?: string | null }): boolean {
  return task.isLocked === true && task.lockReason === PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON;
}
