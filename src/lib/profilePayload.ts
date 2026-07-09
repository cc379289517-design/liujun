import { Prisma } from "@/generated/prisma/client";

export const PUBLIC_PROFILE_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  avatar: true,
  role: true,
  department: true,
  group: true,
  buildingId: true,
  currentRoom: true,
  activeBuildingId: true,
  activeRoom: true,
  status: true,
  subStatus: true,
  eatingStartedAt: true,
  eatingPausedAt: true,
  eatingEndedAt: true,
  eatingAccumulatedSeconds: true,
  onlineStatus: true,
  isOnline: true,
  updatedAt: true,
  building: { select: { id: true, name: true, extraVenues: true } },
} as const;

export const IDENTITY_PROFILE_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  avatar: true,
  role: true,
  department: true,
  group: true,
  buildingId: true,
  currentRoom: true,
  activeBuildingId: true,
  activeRoom: true,
  status: true,
  subStatus: true,
  eatingStartedAt: true,
  eatingPausedAt: true,
  eatingEndedAt: true,
  eatingAccumulatedSeconds: true,
  onlineStatus: true,
  updatedAt: true,
  building: { select: { id: true, name: true } },
} as const;

export const STATS_PROFILE_SELECT = {
  id: true,
  name: true,
  avatar: true,
  role: true,
  department: true,
  group: true,
  buildingId: true,
  activeBuildingId: true,
  updatedAt: true,
  building: { select: { id: true, name: true } },
} as const;

export const AVATAR_PROFILE_SELECT = {
  id: true,
  name: true,
  currentRoom: true,
  avatar: true,
  buildingId: true,
  updatedAt: true,
} as const;

export type PublicProfileRow = Prisma.ProfileGetPayload<{ select: typeof PUBLIC_PROFILE_SELECT }>;
export type IdentityProfileRow = Prisma.ProfileGetPayload<{ select: typeof IDENTITY_PROFILE_SELECT }>;
export type StatsProfileRow = Prisma.ProfileGetPayload<{ select: typeof STATS_PROFILE_SELECT }>;
export type AvatarProfileLike = { id: string; avatar: string | null; updatedAt?: Date | string | null };

export function avatarValueForJson(profile: AvatarProfileLike): string | null {
  const avatar = profile.avatar?.trim();
  if (!avatar) return null;
  if (/^data:/i.test(avatar)) {
    const updatedAtMs = profile.updatedAt
      ? new Date(profile.updatedAt).getTime()
      : 0;
    const version = Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? `?v=${updatedAtMs}`
      : "";
    return `/api/profiles/${encodeURIComponent(profile.id)}/avatar${version}`;
  }
  return avatar;
}

export function serializeProfileForJson<T extends AvatarProfileLike & { password?: unknown }>(
  profile: T,
): Omit<T, "password"> & { avatar: string | null } {
  const { password: _password, ...rest } = profile;
  return {
    ...rest,
    avatar: avatarValueForJson(profile),
  };
}

export function serializeTaskAssistantAvatars<T extends {
  collaborators?: Array<{ assistant?: AvatarProfileLike | null }>;
}>(task: T): T {
  if (!Array.isArray(task.collaborators)) return task;
  return {
    ...task,
    collaborators: task.collaborators.map((collaborator) => ({
      ...collaborator,
      assistant: collaborator.assistant ? serializeProfileForJson(collaborator.assistant) : collaborator.assistant,
    })),
  };
}
