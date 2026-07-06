function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {}
}

function publicQueueSeenStorageKey(profileId: string): string {
  return `publicQueueEscalationSeen:v2:${profileId}`;
}

function publicQueueOrderStorageKey(profileId: string, buildingId: number | null): string {
  return `publicQueueLastOrder:v2:${profileId}:${buildingId ?? "all"}`;
}

export function readPublicQueueSeenEscalations(profileId: string): Set<string> {
  try {
    const parsed = JSON.parse(safeLocalStorageGet(publicQueueSeenStorageKey(profileId)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writePublicQueueSeenEscalations(profileId: string, keys: string[]) {
  if (keys.length === 0) return;
  const seen = readPublicQueueSeenEscalations(profileId);
  keys.forEach((key) => seen.add(key));
  safeLocalStorageSet(publicQueueSeenStorageKey(profileId), JSON.stringify([...seen].slice(-300)));
}

export function readPublicQueueLastOrder(profileId: string, buildingId: number | null): string[] {
  try {
    const parsed = JSON.parse(safeLocalStorageGet(publicQueueOrderStorageKey(profileId, buildingId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writePublicQueueLastOrder(profileId: string, buildingId: number | null, ids: string[]) {
  safeLocalStorageSet(publicQueueOrderStorageKey(profileId, buildingId), JSON.stringify(ids.slice(0, 80)));
}

export function mergePublicQueueOrder(storedIds: string[], finalIds: string[]): string[] {
  const finalSet = new Set(finalIds);
  const ordered = storedIds.filter((id) => finalSet.has(id));
  const orderedSet = new Set(ordered);
  return [...ordered, ...finalIds.filter((id) => !orderedSet.has(id))];
}

export function buildSyntheticBeforePromotionIds(finalIds: string[], promotedIds: string[]): string[] {
  const ids = [...finalIds];
  for (const id of promotedIds) {
    const index = ids.indexOf(id);
    if (index < 0 || index >= ids.length - 1) continue;
    ids.splice(index, 1);
    ids.splice(index + 1, 0, id);
  }
  return ids;
}
