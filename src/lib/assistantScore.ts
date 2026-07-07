export const EXTERNAL_MODEL_ASSIST_SCORE_FACTOR = 0.8;
export const EXTERNAL_MODEL_ASSIST_DISPLAY_NAME = "外模跟拍协助";

export function isExternalModelAssistTaskName(taskName: string | null | undefined, priority?: number | null): boolean {
  const name = taskName?.trim() ?? "";
  if (!name) return false;
  if (priority === 6 && name === "其他") return true;
  return (
    name === EXTERNAL_MODEL_ASSIST_DISPLAY_NAME ||
    name.includes("外模") &&
    (name.includes("协助") || name.includes("跟拍") || name.includes("拍摄"))
  );
}

export function displayTaskCategoryName(taskName: string | null | undefined, priority?: number | null): string {
  return isExternalModelAssistTaskName(taskName, priority)
    ? EXTERNAL_MODEL_ASSIST_DISPLAY_NAME
    : taskName?.trim() || "其他";
}

export function assistantTaskScoreFactor(taskName: string | null | undefined, priority?: number | null): number {
  return isExternalModelAssistTaskName(taskName, priority) ? EXTERNAL_MODEL_ASSIST_SCORE_FACTOR : 1;
}

export function assistantTaskScoreFromSeconds(
  workSeconds: number,
  taskName: string | null | undefined,
  priority?: number | null,
): number {
  return (Math.max(0, workSeconds) / 3600) * assistantTaskScoreFactor(taskName, priority);
}
