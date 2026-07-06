export const PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_CONFIG_KEY = "priority_upgrade_request_min_priority";
export const PRIORITY_UPGRADE_REQUEST_ENABLED_CONFIG_KEY = "priority_upgrade_request_enabled";
export const PRIORITY_UPGRADE_REQUEST_BUILDING_IDS_CONFIG_KEY = "priority_upgrade_request_building_ids";
export const DEFAULT_PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY = 3;
export const PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_OPTIONS = [2, 3, 4, 5] as const;

type PriorityUpgradeConfigEntry = { value?: unknown } | string | number | boolean | null | undefined;
type PriorityUpgradeConfigMap = Record<string, PriorityUpgradeConfigEntry>;

export type PriorityUpgradeRequestRule = {
  enabled: boolean;
  minPriority: number;
};

export function priorityUpgradeRequestEnabledConfigKey(buildingId: number): string {
  return `${PRIORITY_UPGRADE_REQUEST_ENABLED_CONFIG_KEY}_b${buildingId}`;
}

export function priorityUpgradeRequestMinPriorityConfigKey(buildingId: number): string {
  return `${PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_CONFIG_KEY}_b${buildingId}`;
}

export function parsePriorityUpgradeRequestMinPriority(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_OPTIONS.includes(parsed as typeof PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_OPTIONS[number])
    ? parsed
    : DEFAULT_PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY;
}

export function parsePriorityUpgradeRequestEnabled(value: unknown): boolean {
  const normalized = String(value ?? "true").trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "false", "off", "disabled", "no"].includes(normalized);
}

export function parsePriorityUpgradeRequestBuildingIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return uniquePositiveInts(value);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return uniquePositiveInts(parsed);
  } catch {
    // 管理端可能保存逗号分隔字符串；不是 JSON 时继续按文本解析。
  }

  return uniquePositiveInts(raw.split(/[\s,，;；|]+/));
}

export function isPriorityUpgradeRequestBuildingAllowed(
  taskBuildingId: number | null | undefined,
  allowedBuildingIds: number[]
): boolean {
  if (allowedBuildingIds.length === 0) return true;
  return taskBuildingId != null && allowedBuildingIds.includes(taskBuildingId);
}

export function canPriorityRequestByConfig(priority: number, minPriority: number): boolean {
  const normalizedPriority = Math.round(Number(priority) || 0);
  const normalizedMin = parsePriorityUpgradeRequestMinPriority(minPriority);
  return normalizedPriority >= normalizedMin;
}

export function priorityUpgradeRequestRuleForBuilding(
  config: PriorityUpgradeConfigMap,
  buildingId: number | null | undefined
): PriorityUpgradeRequestRule {
  const globalEnabled = parsePriorityUpgradeRequestEnabled(configValue(config, PRIORITY_UPGRADE_REQUEST_ENABLED_CONFIG_KEY));
  const globalMinPriority = parsePriorityUpgradeRequestMinPriority(configValue(config, PRIORITY_UPGRADE_REQUEST_MIN_PRIORITY_CONFIG_KEY));
  const legacyAllowedBuildingIds = parsePriorityUpgradeRequestBuildingIds(
    configValue(config, PRIORITY_UPGRADE_REQUEST_BUILDING_IDS_CONFIG_KEY)
  );

  if (buildingId == null) {
    return {
      enabled: globalEnabled && legacyAllowedBuildingIds.length === 0,
      minPriority: globalMinPriority,
    };
  }

  const buildingEnabled = configValue(config, priorityUpgradeRequestEnabledConfigKey(buildingId));
  const buildingMinPriority = configValue(config, priorityUpgradeRequestMinPriorityConfigKey(buildingId));
  return {
    enabled: buildingEnabled == null
      ? globalEnabled && isPriorityUpgradeRequestBuildingAllowed(buildingId, legacyAllowedBuildingIds)
      : parsePriorityUpgradeRequestEnabled(buildingEnabled),
    minPriority: buildingMinPriority == null
      ? globalMinPriority
      : parsePriorityUpgradeRequestMinPriority(buildingMinPriority),
  };
}

export function priorityUpgradeRangeLabel(minPriority: number): string {
  const normalizedMin = parsePriorityUpgradeRequestMinPriority(minPriority);
  return Array.from({ length: 6 - normalizedMin }, (_, index) => `P${normalizedMin + index}`).join("、");
}

function configValue(config: PriorityUpgradeConfigMap, key: string): unknown {
  const entry = config[key];
  if (entry && typeof entry === "object" && "value" in entry) return entry.value;
  return entry;
}

function uniquePositiveInts(values: unknown[]): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => Number.parseInt(String(value).trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}
