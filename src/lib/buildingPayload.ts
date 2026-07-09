export type BuildingFloorPlanLike = {
  id: number;
  floorPlanUrl: string | null;
};

export function floorPlanValueForJson(building: BuildingFloorPlanLike): string | null {
  const floorPlanUrl = building.floorPlanUrl?.trim();
  if (!floorPlanUrl) return null;
  if (/^data:/i.test(floorPlanUrl)) {
    return `/api/buildings/${building.id}/floor-plan`;
  }
  return floorPlanUrl;
}

export function serializeBuildingForJson<T extends BuildingFloorPlanLike>(
  building: T,
): T & { floorPlanUrl: string | null } {
  return {
    ...building,
    floorPlanUrl: floorPlanValueForJson(building),
  };
}
