import { overtimeMinutesBeyondSlot } from "@/lib/taskEffectiveTime";
import { formatRoomOrVenue } from "./locationDisplay";
import {
  apiTaskToDisplay,
  fmtMin,
  isIroningTask,
  passiveIroningWaitingPresentation,
  taskCategoryDurationCaption,
  taskListActualLine,
  taskStatusForProfile,
  taskTimingForProfile,
} from "./taskDisplay";
import type { TaskFromAPI } from "./types";

export type MobileTaskDotPalette = {
  overtime: string;
  inProgress: string;
  idle: string;
  assigned: string;
};

export type MobileTaskStatusMeta = {
  label: string;
  dot: string;
  badge: string;
  panel: string;
};

export function mobileTaskStatusForProfile(
  task: TaskFromAPI,
  options: { isAssistantProfile: boolean; profileId?: string | null },
): string {
  return taskStatusForProfile(task, options.isAssistantProfile ? options.profileId : undefined) ?? task.status;
}

export function mobileTaskStatusMeta(
  task: TaskFromAPI,
  options: {
    isAssistantProfile: boolean;
    profileId?: string | null;
    nowMs: number;
    dots: MobileTaskDotPalette;
    freeIroningMachineCount?: number;
    hasWorkingTaskForProfile?: boolean;
  },
): MobileTaskStatusMeta {
  const status = mobileTaskStatusForProfile(task, options);
  if (status === "executing") {
    const over = overtimeMinutesBeyondSlot(
      {
        ...taskTimingForProfile(task, options.isAssistantProfile ? options.profileId : undefined),
        status,
        category: task.category,
      },
      options.nowMs,
    );
    return over != null
      ? { label: `超时${fmtMin(over)}`, dot: options.dots.overtime, badge: "bg-red-100/80 text-red-600", panel: "bg-red-400/14" }
      : { label: "进行中", dot: options.dots.inProgress, badge: "bg-orange-100/80 text-orange-600", panel: "bg-orange-400/16" };
  }
  if (status === "paused") return { label: "暂停中", dot: "#9ca3af", badge: "bg-gray-100/80 text-gray-600", panel: "bg-gray-400/14" };
  if (status === "completed") return { label: "已完成", dot: options.dots.idle, badge: "bg-green-100/80 text-green-600", panel: "bg-green-400/12" };
  if (isIroningTask(task) && task.ironingStage === "waiting_machine") {
    const presentation = passiveIroningWaitingPresentation(task, {
      freeIroningMachineCount: options.freeIroningMachineCount,
      hasWorkingTaskForProfile: options.hasWorkingTaskForProfile,
    });
    return { label: presentation.label, dot: "#10b981", badge: "bg-emerald-100/80 text-emerald-700", panel: "bg-emerald-400/12" };
  }
  if (isIroningTask(task) && task.ironingStage === "notified") {
    return { label: "准备熨烫", dot: "#84cc16", badge: "bg-lime-100/80 text-lime-700", panel: "bg-lime-400/14" };
  }
  return { label: task.assistantId ? "待就位" : "队列中", dot: options.dots.assigned, badge: "bg-blue-100/80 text-blue-600", panel: "bg-blue-400/12" };
}

export function mobileTaskSubtitle(
  task: TaskFromAPI,
  options: { isAssistantProfile: boolean },
): string {
  const person = options.isAssistantProfile
    ? task.photographer?.name ?? "摄影师"
    : task.assistant?.name ?? "未分配助理";
  return `${formatRoomOrVenue(task.roomNumber)} · ${person} · ${taskCategoryDurationCaption(task.category, task.priority)}`;
}

export function mobileTaskTimeLine(
  task: TaskFromAPI,
  options: { isAssistantProfile: boolean; profileId?: string | null; nowMs: number },
): string | null {
  const display = apiTaskToDisplay(task, options.isAssistantProfile ? options.profileId ?? undefined : undefined);
  return taskListActualLine(
    display,
    task,
    options.nowMs,
    true,
    options.isAssistantProfile ? options.profileId ?? undefined : undefined,
  );
}
