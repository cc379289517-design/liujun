import { Role, ProfileStatus, TaskStatus } from "@/generated/prisma/client";

// Re-export enums for convenience
export { Role, ProfileStatus, TaskStatus };

// ============================================
// 优先级常量（数值越小优先级越高）
// P1-P5 的具体任务定义由管理后台「任务逻辑」中的任务类型配置决定
// ============================================
export const PRIORITY = {
  P1: 1, // 最高优先级（可插断其他任务）
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5, // 最低优先级
} as const;

// ============================================
// 状态颜色映射
// ============================================
export const STATUS_COLORS: Record<ProfileStatus, string> = {
  idle: "#22c55e", // 绿色 - 空闲
  assigned: "#3b82f6", // 蓝色 - 待就位
  busy: "#fdba74", // 浅橙 - 在忙
  executing: "#f97316", // 橙色 - 进行中
  finishing: "#86efac", // 浅绿 - 快结束
};

// ============================================
// 调度配置
// ============================================
export const SCHEDULER_CONFIG = {
  ESCALATION_THRESHOLD_MINUTES: 30, // 提权阈值：等待超过30分钟
  INTERRUPT_MAX_MINUTES: 30, // 插单最大离开时间：30分钟
  COMPLETION_WARNING_MINUTES: 2, // 结项预警：提前2分钟
} as const;

// ============================================
// Socket 事件类型
// ============================================
export const SOCKET_EVENTS = {
  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_ASSIGNED: "task:assigned",
  PROFILE_UPDATED: "profile:updated",
  ALERT_URGENT: "alert:urgent",
  ALERT_COMPLETION: "alert:completion",
} as const;
