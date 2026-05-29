export function collaborationEnabledConfigKey(buildingId: number): string {
  return `collaboration_enabled_b${buildingId}`;
}

export function collaborationMaxParticipantsConfigKey(buildingId: number): string {
  return `collaboration_max_participants_b${buildingId}`;
}

export function parseCollaborationEnabled(value: string | null | undefined): boolean {
  return value !== "false";
}

export function parseCollaborationMaxParticipants(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(12, Math.max(1, parsed));
}

export function taskCategoryAllowsCollaboration(category: {
  minDuration?: number | null;
  maxDuration?: number | null;
} | null | undefined): boolean {
  const min = category?.minDuration;
  const max = category?.maxDuration;
  return (typeof max === "number" && max > 30) || (typeof min === "number" && min >= 30);
}
