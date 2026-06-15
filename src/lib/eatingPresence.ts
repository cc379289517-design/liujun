export const ASSISTANT_EATING_SUB_STATUS = "eating";
export const EATING_OVERTIME_ALERT_CONFIG_KEY = "eating_overtime_alert_min";
export const EATING_REENTRY_COOLDOWN_CONFIG_KEY = "eating_reentry_cooldown_min";

export const DEFAULT_EATING_OVERTIME_ALERT_MIN = 30;
export const DEFAULT_EATING_REENTRY_COOLDOWN_MIN = 30;

export function parseEatingOvertimeAlertMin(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_EATING_OVERTIME_ALERT_MIN;
  return Math.min(120, Math.max(5, n));
}

export function parseEatingReentryCooldownMin(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_EATING_REENTRY_COOLDOWN_MIN;
  return Math.min(180, Math.max(5, n));
}

export function eatingReentryRemainingMs(
  eatingEndedAt: Date | string | null | undefined,
  now: Date,
  cooldownMinutes: number
): number {
  if (!eatingEndedAt) return 0;
  const endedAtMs = new Date(eatingEndedAt).getTime();
  if (!Number.isFinite(endedAtMs)) return 0;
  const cooldownMs = parseEatingReentryCooldownMin(cooldownMinutes) * 60 * 1000;
  return Math.max(0, endedAtMs + cooldownMs - now.getTime());
}
