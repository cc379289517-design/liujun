export function collaborationEnabledConfigKey(buildingId: number): string {
  return `collaboration_enabled_b${buildingId}`;
}

export function collaborationMaxParticipantsConfigKey(buildingId: number): string {
  return `collaboration_max_participants_b${buildingId}`;
}

export const COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_CONFIG_KEY = "collaboration_queue_auto_close_limit";
export const COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_OPTIONS = [4, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT = 10;

export function parseCollaborationEnabled(value: string | null | undefined): boolean {
  return value !== "false";
}

export function parseCollaborationMaxParticipants(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(12, Math.max(1, parsed));
}

export function parseCollaborationQueueAutoCloseLimit(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT;
  const normalized = Math.floor(parsed);
  if (!COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT_OPTIONS.includes(normalized as 4 | 5 | 6 | 7 | 8 | 9 | 10)) {
    return DEFAULT_COLLABORATION_QUEUE_AUTO_CLOSE_LIMIT;
  }
  return normalized;
}

export function taskCategoryAllowsCollaboration(category: {
  minDuration?: number | null;
  maxDuration?: number | null;
} | null | undefined): boolean {
  const min = category?.minDuration;
  const max = category?.maxDuration;
  return (typeof max === "number" && max > 30) || (typeof min === "number" && min >= 30);
}
