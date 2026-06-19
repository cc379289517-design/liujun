export const IRONING_PREP_WINDOW_MIN_CONFIG_KEY = "ironing_prep_window_min";
export const IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY = "ironing_confirm_timeout_sec";
export const IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY = "ironing_machine_claim_ttl_min";

export const DEFAULT_IRONING_PREP_WINDOW_MIN = 5;
export const DEFAULT_IRONING_CONFIRM_TIMEOUT_SEC = 60;
export const DEFAULT_IRONING_MACHINE_CLAIM_TTL_MIN = 2;

export function parseIroningPrepWindowMin(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IRONING_PREP_WINDOW_MIN;
  return Math.min(30, Math.max(1, Math.round(n)));
}

export function parseIroningConfirmTimeoutSec(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IRONING_CONFIRM_TIMEOUT_SEC;
  return Math.min(300, Math.max(15, Math.round(n)));
}

export function parseIroningMachineClaimTtlMin(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IRONING_MACHINE_CLAIM_TTL_MIN;
  return Math.min(30, Math.max(1, Math.round(n)));
}

export function isIroningCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name === "熨烫" || name.includes("熨");
}
