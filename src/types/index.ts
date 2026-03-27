import { Role, ProfileStatus, TaskStatus } from "@/generated/prisma/client";

// Re-export enums for convenience
export { Role, ProfileStatus, TaskStatus };

// ============================================
// 优先级常量
// ============================================
export const PRIORITY = {
  P1_URGENT: 1, // 紧急：1-10min 短时手持
  P2_HIGH: 2, // 高：10-20min 服装穿戴
  P3_MEDIUM: 3, // 中：<30min 短时熨烫/DIY
  P4_LOW: 4, // 低：>30min 长时任务
} as const;

// ============================================
// 状态颜色映射
// ============================================
export const STATUS_COLORS: Record<ProfileStatus, string> = {
  idle: "#22c55e", // 绿色 - 空闲
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
  AUTO_COMPLETE_IDLE_MINUTES: 5, // 围栏自动结项：离开5分钟
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
