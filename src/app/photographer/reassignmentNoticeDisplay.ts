import type { StandbyReassignmentNoticeFromAPI } from "./types";

export type ReassignmentNoticeRole = "old" | "new";

export type ReassignmentNoticeDisplay = {
  title: string;
  message: string;
  buttonLabel: string;
  source: "system" | "manual" | "confirmed_swap";
};

function padNotificationTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatNotificationTimestamp(value: string | null | undefined, now = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const time = `${padNotificationTimePart(date.getHours())}:${padNotificationTimePart(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? time
    : `${padNotificationTimePart(date.getMonth() + 1)}-${padNotificationTimePart(date.getDate())} ${time}`;
}

export function isSystemAutomaticReassignmentReason(reason: string): boolean {
  return reason === "ironing_wait_load_balance" ||
    reason === "unselected_standby_release" ||
    reason.startsWith("standby_timeout_");
}

function taskLabel(notice: StandbyReassignmentNoticeFromAPI): string {
  return `${notice.taskRoomNumber}室 · ${notice.taskCategoryName} · P${notice.taskPriority}`;
}

function oldWorkLabel(notice: StandbyReassignmentNoticeFromAPI): string {
  return [
    notice.oldAssistantActiveTaskRoomNumber ? `${notice.oldAssistantActiveTaskRoomNumber}室` : null,
    notice.oldAssistantActiveTaskCategoryName,
  ].filter(Boolean).join(" · ") || "其他任务";
}

export function reassignmentNoticeDisplay(
  notice: StandbyReassignmentNoticeFromAPI,
  role: ReassignmentNoticeRole,
): ReassignmentNoticeDisplay {
  const task = taskLabel(notice);

  if (notice.reason === "assistant_swap_after_complete_ready") {
    const counterpart = role === "old" ? notice.newAssistantName : notice.oldAssistantName;
    return {
      title: "已确认的交换现已就绪",
      message: `此前双方已确认与${counterpart}助理交换「${task}」，现已满足接替条件，请按已确认流程前往处理。`,
      buttonLabel: "知道了",
      source: "confirmed_swap",
    };
  }

  if (isSystemAutomaticReassignmentReason(notice.reason)) {
    let message: string;
    if (notice.reason === "ironing_wait_load_balance") {
      message = role === "old"
        ? `系统检测到你的未开始熨烫等待较多，已将「${task}」自动转派给${notice.newAssistantName}。此次调整由系统判断，不是助理主动发起交换。`
        : `系统检测到你当前的未开始熨烫等待较少，已将「${task}」自动转派给你。此次调整由系统判断，不是${notice.oldAssistantName}主动发起交换。`;
    } else if (notice.reason === "unselected_standby_release") {
      message = role === "old"
        ? `系统检测到你正在处理「${oldWorkLabel(notice)}」，已将未开始的「${task}」自动转派给${notice.newAssistantName}。此次调整不是助理主动发起交换。`
        : `系统检测到${notice.oldAssistantName}正在处理其他任务，已将未开始的「${task}」自动转派给你。此次调整由系统判断，不是${notice.oldAssistantName}主动发起交换。`;
    } else if (role === "old") {
      message = notice.reason === "standby_timeout_ironing_retained"
        ? `系统检测到你长时间未应答「${task}」，当前没有可接手助理，准备熨烫任务仍保留在你名下。你的在线状态未改变，请按现场情况继续处理。`
        : notice.reason === "standby_timeout_no_replacement"
        ? `系统检测到你长时间未应答「${task}」，已按待就位超时规则将任务释放到公共队列。你的在线状态未改变，可继续接收新任务。`
        : notice.oldAssistantSetOffline
        ? `系统检测到你长时间未应答「${task}」，已按待就位超时规则处理并将你切换为离线。确认后恢复应接在线状态。`
        : `系统检测到你长时间未应答「${task}」，已按待就位超时规则自动转派给${notice.newAssistantName}。此次调整不是助理主动发起交换。`;
    } else {
      message = notice.reason === "standby_timeout_ironing_retained"
        ? `系统检测到${notice.oldAssistantName}长时间未应答「${task}」，当前没有可接手助理，任务仍保留原归属。此次处理由系统判断，不是助理主动发起交换。`
        : `系统检测到${notice.oldAssistantName}长时间未应答「${task}」，已按待就位超时规则自动转派给你。此次调整不是${notice.oldAssistantName}主动发起交换。`;
    }

    return {
      title: "系统自动转派通知",
      message,
      buttonLabel: role === "old" && notice.oldAssistantSetOffline ? "确认并恢复在线" : role === "old" ? "知道了" : "确认",
      source: "system",
    };
  }

  return {
    title: role === "old" ? "任务接替/交换申请已发出" : "任务接替/交换申请",
    message: role === "old"
      ? `你已向${notice.newAssistantName}发起「${task}」接替/交换申请，请等待对方确认。`
      : `${notice.oldAssistantName}向你发起「${task}」接替/交换申请，请按双方协商结果处理。`,
    buttonLabel: role === "old" ? "知道了" : "确认",
    source: "manual",
  };
}
