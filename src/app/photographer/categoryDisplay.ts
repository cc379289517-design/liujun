import { buildDurationLabel, taskTypeGroupName } from "./taskDisplay";
import type { BuiltCategory, DbCategory } from "./types";

export const CAT_STYLES: Record<string, { bg: string; active: string; darkBg: string; darkActive: string; text: string; darkText: string }> = {
  "手持": { bg: "bg-red-400/20", active: "bg-red-400/35", darkBg: "bg-red-500/25", darkActive: "bg-red-500/40", text: "text-red-700", darkText: "text-red-300" },
  "服装穿戴": { bg: "bg-orange-400/20", active: "bg-orange-400/35", darkBg: "bg-orange-500/25", darkActive: "bg-orange-500/40", text: "text-orange-700", darkText: "text-orange-300" },
  "手工DIY": { bg: "bg-amber-400/20", active: "bg-amber-400/35", darkBg: "bg-amber-500/25", darkActive: "bg-amber-500/40", text: "text-amber-700", darkText: "text-amber-300" },
  "熨烫": { bg: "bg-emerald-400/20", active: "bg-emerald-400/35", darkBg: "bg-emerald-500/25", darkActive: "bg-emerald-500/40", text: "text-emerald-700", darkText: "text-emerald-300" },
  "其他": { bg: "bg-blue-400/20", active: "bg-blue-400/35", darkBg: "bg-blue-500/25", darkActive: "bg-blue-500/40", text: "text-blue-700", darkText: "text-blue-300" },
};

export const CAT_ORDER = ["手持", "服装穿戴", "手工DIY", "熨烫", "其他"];

export const CAT_SOLID_BG: Record<string, string> = {
  "手持": "bg-red-400",
  "服装穿戴": "bg-orange-400",
  "手工DIY": "bg-amber-400",
  "熨烫": "bg-emerald-400",
  "其他": "bg-blue-400",
};

export const CAT_SOLID_HEX: Record<string, string> = {
  "手持": "#f87171",
  "服装穿戴": "#fb923c",
  "手工DIY": "#fbbf24",
  "熨烫": "#34d399",
  "其他": "#60a5fa",
};

const PRIORITY_CLS: Record<number, string> = {
  1: "bg-red-500 text-white",
  2: "bg-orange-500 text-white",
  3: "bg-amber-500 text-white",
  4: "bg-blue-500 text-white",
  5: "bg-gray-500 text-white",
  6: "bg-purple-500 text-white",
};

const QUICK_EXTERNAL_MODEL_FOLLOW_TITLE = "外模跟拍协助";
const QUICK_EXTERNAL_MODEL_FOLLOW_PRIORITY = 6;

function isExternalModelFollowCategory(name: string): boolean {
  return name === QUICK_EXTERNAL_MODEL_FOLLOW_TITLE || (name.includes("外模") && (name.includes("跟拍") || name.includes("拍摄") || name.includes("协助")));
}

export function queueTaskTypeShortLabel(name: string | null | undefined): string {
  const groupName = taskTypeGroupName(name);
  if (groupName === "服装穿戴") return "穿戴";
  if (groupName === "手工DIY") return "手工";
  return groupName;
}

export function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function buildCategories(dbCats: DbCategory[]): BuiltCategory[] {
  const result: BuiltCategory[] = [];
  for (const catName of CAT_ORDER) {
    const style = CAT_STYLES[catName];
    if (!style) continue;
    const items = dbCats
      .filter((c) => taskTypeGroupName(c.name) === catName)
      .sort((a, b) => a.priorityLevel - b.priorityLevel || a.minDuration - b.minDuration || a.id - b.id);
    if (items.length === 0) continue;
    const externalModelFollow = catName === "其他"
      ? items.find((c) => isExternalModelFollowCategory(c.name)) ?? items.find((c) => c.priorityLevel === 3) ?? items[0]
      : null;
    const durationItems = items.filter((c) => !isExternalModelFollowCategory(c.name));
    result.push({
      name: catName,
      ...style,
      durations: (durationItems.length > 0 ? durationItems : items).map((c) => ({
        label: buildDurationLabel(c.minDuration, c.maxDuration),
        priority: `P${c.priorityLevel}`,
        cls: PRIORITY_CLS[c.priorityLevel] || PRIORITY_CLS[5],
        categoryId: c.id,
        sourceName: c.name,
      })),
      specialActions: externalModelFollow
        ? [{
          title: QUICK_EXTERNAL_MODEL_FOLLOW_TITLE,
          label: buildDurationLabel(externalModelFollow.minDuration, externalModelFollow.maxDuration),
          priority: `P${QUICK_EXTERNAL_MODEL_FOLLOW_PRIORITY}`,
          cls: "bg-purple-500 text-white",
          categoryId: externalModelFollow.id,
          sourceName: externalModelFollow.name,
          priorityOverride: QUICK_EXTERNAL_MODEL_FOLLOW_PRIORITY,
          quickBookSpecialType: "external_model_follow",
          tone: "purple",
        }]
        : undefined,
    });
  }
  return result;
}
