import { sweepWaitingTasks } from "@/lib/scheduler";

/**
 * POST /api/tasks/sweep - 触发全局扫描自动派单
 * 助理切换位置后调用，将空闲助理与等待中的任务匹配
 */
export async function POST() {
  try {
    const count = await sweepWaitingTasks();
    return Response.json({ assigned: count });
  } catch (error) {
    console.error("[POST /api/tasks/sweep]", error);
    return Response.json({ error: "Failed to sweep" }, { status: 500 });
  }
}
