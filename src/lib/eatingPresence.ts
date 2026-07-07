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

export function normalizeEatingAccumulatedSeconds(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function eatingCurrentSegmentSeconds(
  eatingStartedAt: Date | string | number | null | undefined,
  now: Date | number = new Date()
): number {
  if (!eatingStartedAt) return 0;
  const startedAtMs = typeof eatingStartedAt === "number" ? eatingStartedAt : new Date(eatingStartedAt).getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || nowMs <= startedAtMs) return 0;
  return Math.floor((nowMs - startedAtMs) / 1000);
}

export function eatingTotalElapsedSeconds(
  eatingStartedAt: Date | string | number | null | undefined,
  accumulatedSeconds: unknown,
  now: Date | number = new Date()
): number {
  return normalizeEatingAccumulatedSeconds(accumulatedSeconds) + eatingCurrentSegmentSeconds(eatingStartedAt, now);
}

export function eatingRemainingSeconds(
  eatingStartedAt: Date | string | number | null | undefined,
  accumulatedSeconds: unknown,
  now: Date | number,
  limitMinutes: unknown
): number {
  const limitSeconds = parseEatingOvertimeAlertMin(limitMinutes) * 60;
  return Math.max(0, limitSeconds - eatingTotalElapsedSeconds(eatingStartedAt, accumulatedSeconds, now));
}
