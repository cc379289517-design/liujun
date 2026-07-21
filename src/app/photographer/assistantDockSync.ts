import type { DockAssistant } from "./AssistantDock";

export type AssistantProfileForDock = Pick<
  DockAssistant,
  | "id"
  | "name"
  | "status"
  | "onlineStatus"
  | "subStatus"
  | "updatedAt"
  | "eatingStartedAt"
  | "eatingPausedAt"
  | "eatingEndedAt"
  | "eatingAccumulatedSeconds"
  | "currentRoom"
  | "avatar"
  | "group"
> & {
  activeRoom?: string | null;
  activeBuildingId?: number | null;
  buildingId?: number;
  role?: string;
};

export type AssistantStatusPatch = { id: string } & Partial<DockAssistant>;

function identityProfileValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

export function mergeIdentityProfilePatches<T extends { id: string }>(
  previous: T[],
  patches: Array<Partial<T> & { id: string }>,
): T[] {
  if (patches.length === 0) return previous;
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  let changed = false;
  const next = previous.map((profile) => {
    const patch = patchById.get(profile.id);
    if (!patch) return profile;
    const merged = { ...profile, ...patch };
    const keys = Object.keys(merged) as Array<keyof T>;
    if (keys.every((key) => identityProfileValueEqual(profile[key], merged[key]))) return profile;
    changed = true;
    return merged;
  });
  return changed ? next : previous;
}

export function shouldRefreshIdentityProfiles({
  cachedProfileCount,
  lastFetchedAt,
  now,
  requestInFlight,
  freshnessMs,
}: {
  cachedProfileCount: number;
  lastFetchedAt: number;
  now: number;
  requestInFlight: boolean;
  freshnessMs: number;
}): boolean {
  if (requestInFlight) return false;
  if (cachedProfileCount === 0) return true;
  return lastFetchedAt <= 0 || now - lastFetchedAt >= freshnessMs;
}

export function profileToDockAssistant(profile: AssistantProfileForDock): DockAssistant {
  return {
    ...profile,
    currentRoom: profile.activeRoom ?? profile.currentRoom,
    currentTask: null,
    pausedRoom: null,
    pausedTaskDesc: null,
    pausedTaskDetail: null,
    pausedElapsedMin: 0,
    preemptedWaitingRoom: null,
    preemptedWaitingTaskDesc: null,
    preemptedWaitingTaskDetail: null,
    newTaskDesc: null,
    resumingFromPause: false,
    pendingRoom: null,
    currentTaskNote: null,
    currentTaskId: null,
    executingOvertimeMin: null,
    pausedOvertimeMin: null,
    preemptedOvertimeMin: null,
  };
}

export function reconcileAssistantDockSnapshot(
  previous: DockAssistant[],
  profilePatches: AssistantProfileForDock[],
  assistantStatus: AssistantStatusPatch[],
): DockAssistant[] {
  const profilePatchById = new Map(profilePatches.map((profile) => [profile.id, profile]));
  const statusById = new Map(assistantStatus.map((status) => [status.id, status]));
  const authoritativeIds = new Set(assistantStatus.map((status) => status.id));
  const seen = new Set<string>();
  const base = previous.length > 0
    ? previous.filter((assistant) => authoritativeIds.has(assistant.id)).map((assistant) => {
        seen.add(assistant.id);
        const patch = profilePatchById.get(assistant.id);
        return patch ? { ...assistant, ...profileToDockAssistant(patch) } : assistant;
      })
    : profilePatches.filter((profile) => authoritativeIds.has(profile.id)).map((profile) => {
        seen.add(profile.id);
        return profileToDockAssistant(profile);
      });

  for (const patch of profilePatches) {
    if (authoritativeIds.has(patch.id) && !seen.has(patch.id)) {
      base.push(profileToDockAssistant(patch));
    }
  }

  return base.map((assistant) => ({
    ...assistant,
    ...statusById.get(assistant.id),
  }));
}

function profileServiceBuildingId(profile: AssistantProfileForDock): number | null {
  return profile.activeBuildingId ?? profile.buildingId ?? null;
}

function profileIsDockAssistant(profile: AssistantProfileForDock): boolean {
  return !profile.role || profile.role === "assistant" || profile.role === "assistant_leader";
}

function hasLiveDockPlacement(assistant: DockAssistant): boolean {
  return Boolean(
    assistant.currentTask ||
      assistant.currentTaskId ||
      assistant.pausedRoom ||
      assistant.pendingRoom ||
      assistant.preemptedWaitingRoom
  );
}

export function optimisticAssistantDockForBuilding(
  previous: DockAssistant[],
  profiles: AssistantProfileForDock[],
  buildingId: number | null | undefined,
): DockAssistant[] {
  if (buildingId == null) return previous;
  const previousById = new Map(previous.map((assistant) => [assistant.id, assistant]));
  return profiles
    .filter((profile) => profileIsDockAssistant(profile) && profileServiceBuildingId(profile) === buildingId)
    .map((profile) => {
      const base = profileToDockAssistant(profile);
      const existing = previousById.get(profile.id);
      if (!existing) return base;
      return {
        ...base,
        ...existing,
        id: base.id,
        name: base.name,
        status: base.status,
        onlineStatus: base.onlineStatus,
        subStatus: base.subStatus,
        updatedAt: base.updatedAt,
        eatingStartedAt: base.eatingStartedAt,
        eatingPausedAt: base.eatingPausedAt,
        eatingEndedAt: base.eatingEndedAt,
        eatingAccumulatedSeconds: base.eatingAccumulatedSeconds,
        avatar: base.avatar,
        group: base.group,
        currentRoom: hasLiveDockPlacement(existing) ? existing.currentRoom ?? base.currentRoom : base.currentRoom,
      };
    });
}

export function patchAssistantDockRoom(
  assistants: DockAssistant[],
  assistantId: string,
  room: string | null,
): DockAssistant[] {
  return assistants.map((assistant) =>
    assistant.id === assistantId ? { ...assistant, currentRoom: room } : assistant
  );
}
