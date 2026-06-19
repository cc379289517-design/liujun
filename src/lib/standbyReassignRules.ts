export const STANDBY_REASSIGN_TIMEOUT_MIN_CONFIG_KEY = "standby_reassign_timeout_min";
export const DEFAULT_STANDBY_REASSIGN_TIMEOUT_MIN = 20;

export function parseStandbyReassignTimeoutMin(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_STANDBY_REASSIGN_TIMEOUT_MIN;
  return Math.min(120, Math.max(1, Math.round(n)));
}
