import { isPhotographerLimitQueuedTask } from "@/lib/photographerTaskLimit";
import type { ExtraVenueEntry, TaskFromAPI, VenuePoint, WorkbenchBuilding } from "./types";

/** 解析楼座 extraVenues JSON，非法或空时返回 []，避免 hover 整页崩溃 */
export function safeExtraVenueEntries(extraVenues: string | null | undefined): ExtraVenueEntry[] {
  if (!extraVenues || !extraVenues.trim()) return [];
  try {
    const raw = JSON.parse(extraVenues) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: ExtraVenueEntry[] = [];
    for (const v of raw) {
      if (typeof v === "string") {
        if (v) out.push({ name: v });
        continue;
      }
      if (v && typeof v === "object" && "name" in v) {
        const o = v as { name: string; type?: string; x?: unknown; y?: unknown; color?: unknown; polygon?: unknown };
        const name = String(o.name ?? "");
        const parsedX = typeof o.x === "number" ? o.x : typeof o.x === "string" ? Number(o.x) : NaN;
        const parsedY = typeof o.y === "number" ? o.y : typeof o.y === "string" ? Number(o.y) : NaN;
        const x = Number.isFinite(parsedX) ? parsedX : undefined;
        const y = Number.isFinite(parsedY) ? parsedY : undefined;
        const polygon = Array.isArray(o.polygon)
          ? o.polygon
              .map((point) => {
                if (!point || typeof point !== "object") return null;
                const rawPoint = point as { x?: unknown; y?: unknown };
                const px = typeof rawPoint.x === "number" ? rawPoint.x : typeof rawPoint.x === "string" ? Number(rawPoint.x) : NaN;
                const py = typeof rawPoint.y === "number" ? rawPoint.y : typeof rawPoint.y === "string" ? Number(rawPoint.y) : NaN;
                return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
              })
              .filter((point): point is VenuePoint => point !== null)
          : undefined;
        const color = typeof o.color === "string" && o.color.trim() ? o.color : undefined;
        if (name) out.push({ name, type: o.type, x, y, color, polygon });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function defaultBuildingVenue(building: WorkbenchBuilding | null | undefined): string | null {
  if (!building) return null;
  const venues = safeExtraVenueEntries(building.extraVenues);
  const realScene = venues.find((v) => v.type === "实景棚");
  if (realScene?.name) return realScene.name;
  if (venues[0]?.name) return venues[0].name;
  return building.rooms[0]?.roomNumber ?? null;
}

export function formatRoomOrVenue(value: string | null | undefined): string {
  if (!value) return "";
  if (value.endsWith("室")) return value;
  return /^\d+$/.test(value) ? `${value}室` : value;
}

export function venueBelongsToBuilding(building: WorkbenchBuilding | null | undefined, value: string | null | undefined): boolean {
  if (!building || !value) return false;
  const normalized = value.endsWith("室") ? value.slice(0, -1) : value;
  const isRoom = building.rooms.some((room) => room.roomNumber === normalized);
  const isPublicVenue = safeExtraVenueEntries(building.extraVenues).some((venue) => venue.name === value);
  return isRoom || isPublicVenue;
}

export function isAssistantRole(role: string | undefined): boolean {
  return role === "assistant" || role === "assistant_leader";
}

export function profileServiceBuildingId(profile: { role: string; buildingId: number; activeBuildingId?: number | null }): number {
  return isAssistantRole(profile.role) ? profile.activeBuildingId ?? profile.buildingId : profile.buildingId;
}

export function profileServiceRoom(profile: { role: string; currentRoom: string | null; activeRoom?: string | null }): string | null {
  return isAssistantRole(profile.role) ? profile.activeRoom ?? null : profile.currentRoom;
}

export function taskLocationBuildingId(task: TaskFromAPI | null | undefined): number | null {
  return task?.locationBuildingId ?? task?.photographer?.buildingId ?? null;
}

export function isPublicQueueTaskForBuilding(task: TaskFromAPI, buildingId: number | null): boolean {
  return (
    buildingId != null &&
    taskLocationBuildingId(task) === buildingId &&
    !isPhotographerLimitQueuedTask(task) &&
    (task.status === "waiting" || task.status === "paused")
  );
}
