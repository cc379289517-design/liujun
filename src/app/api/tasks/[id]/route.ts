import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { completeTask, assignTask, sweepWaitingTasks } from "@/lib/scheduler";
import { TaskStatus, ProfileStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";

type RouteContext = { params: Promise<{ id: string }> };

/** 避免 DB/迁移产生的非法日期经 Prisma 写回时报错 */
function coerceValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? d : null;
}

/**
 * GET /api/tasks/[id] - 获取单个任务详情
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        photographer: true,
        assistant: true,
        category: true,
        parentTask: true,
        interruptTasks: true,
      },
    });

    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    return Response.json(task);
  } catch (error) {
    console.error("[GET /api/tasks/[id]]", error);
    return Response.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - 删除单个任务
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    const task = await prisma.bookingTask.findUnique({ where: { id } });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    // 如果任务有分配的助理，将助理状态恢复为 idle
    if (task.assistantId) {
      await prisma.profile.update({
        where: { id: task.assistantId },
        data: { status: ProfileStatus.idle },
      });
    }

    await prisma.bookingTask.delete({ where: { id } });

    // 助理释放后，扫描等待队列自动派单
    await sweepWaitingTasks();

    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/tasks/[id]]", error);
    return Response.json({ error: "Failed to delete task" }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks/[id] - 更新任务状态
 * Actions: start, pause, complete, extend
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, estMinutes } = body;

    const task = await prisma.bookingTask.findUnique({ where: { id } });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    switch (action) {
      case "start": {
        const estEndTime = estMinutes
          ? new Date(Date.now() + estMinutes * 60 * 1000)
          : task.estEndTime;

        // 暂停后恢复执行：保留首次合法开始时间；有效工时从新片段累计
        const startedAt = coerceValidDate(task.startedAt) ?? new Date();
        const segmentStart = new Date();

        // 事务：任务与助理状态一致更新（仅更新任务而 profile.update 失败时曾导致 500 且状态分裂）
        const updated = await prisma.$transaction(async (tx) => {
          const row = await tx.bookingTask.update({
            where: { id },
            data: {
              status: TaskStatus.executing,
              startedAt,
              workSegmentStartedAt: segmentStart,
              estEndTime,
              // 重新开跑时清除暂停锚点，避免脏数据
              pausedAt: null,
            },
          });
          if (task.assistantId) {
            const { count } = await tx.profile.updateMany({
              where: { id: task.assistantId },
              data: { status: ProfileStatus.executing },
            });
            if (count === 0) {
              throw new Error(`助理不存在或已删除: ${task.assistantId}`);
            }
          }
          return row;
        });

        return Response.json(updated);
      }

      case "pause": {
        // 检查该助理是否有等待中的插单任务（有则改为 assigned，否则 busy）
        let profileStatus: ProfileStatus = ProfileStatus.busy;
        if (task.assistantId) {
          const waitingInterrupt = await prisma.bookingTask.findFirst({
            where: {
              assistantId: task.assistantId,
              status: TaskStatus.waiting,
              parentTaskId: { not: null },
            },
          });
          if (waitingInterrupt) profileStatus = ProfileStatus.assigned;
        }

        const flushed = flushExecutingSegment({
          effectiveWorkSeconds: task.effectiveWorkSeconds,
          workSegmentStartedAt: task.workSegmentStartedAt,
          startedAt: task.startedAt,
          status: task.status,
        });

        const updated = await prisma.bookingTask.update({
          where: { id },
          data: {
            status: TaskStatus.paused,
            pausedAt: new Date(),
            effectiveWorkSeconds: flushed.effectiveWorkSeconds,
            workSegmentStartedAt: null,
          },
        });

        if (task.assistantId) {
          await prisma.profile.update({
            where: { id: task.assistantId },
            data: { status: profileStatus },
          });
        }

        return Response.json(updated);
      }

      case "complete": {
        await completeTask(id);
        const updated = await prisma.bookingTask.findUnique({ where: { id } });
        return Response.json(updated);
      }

      case "setStatus": {
        const { newStatus } = body as { newStatus: string };
        const validStatuses = ["waiting", "executing", "paused", "completed"];
        if (!newStatus || !validStatuses.includes(newStatus)) {
          return Response.json(
            { error: "Invalid newStatus. Use: waiting, executing, paused, completed" },
            { status: 400 }
          );
        }

        // completed 走 completeTask 复用父任务恢复逻辑
        if (newStatus === "completed") {
          await completeTask(id);
          const updated = await prisma.bookingTask.findUnique({ where: { id } });
          return Response.json(updated);
        }

        // 构建更新数据
        const setStatusData: Record<string, unknown> = {
          status: newStatus as TaskStatus,
        };

        // 从 completed 回退时清 completedAt
        if (task.status === "completed") {
          setStatusData.completedAt = null;
        }

        if (newStatus === "executing") {
          setStatusData.startedAt = task.startedAt ?? new Date();
          setStatusData.workSegmentStartedAt = new Date();
        } else if (newStatus === "paused") {
          if (task.status === TaskStatus.executing) {
            const flushed = flushExecutingSegment({
              effectiveWorkSeconds: task.effectiveWorkSeconds,
              workSegmentStartedAt: task.workSegmentStartedAt,
              startedAt: task.startedAt,
              status: task.status,
            });
            setStatusData.effectiveWorkSeconds = flushed.effectiveWorkSeconds;
            setStatusData.workSegmentStartedAt = null;
          }
        } else if (newStatus === "waiting") {
          if (task.status === TaskStatus.executing) {
            const flushed = flushExecutingSegment({
              effectiveWorkSeconds: task.effectiveWorkSeconds,
              workSegmentStartedAt: task.workSegmentStartedAt,
              startedAt: task.startedAt,
              status: task.status,
            });
            setStatusData.effectiveWorkSeconds = flushed.effectiveWorkSeconds;
            setStatusData.workSegmentStartedAt = null;
          }
          setStatusData.startedAt = null;
        }

        // 事务：更新任务 + 助理状态
        const updated = await prisma.$transaction(async (tx) => {
          const updatedTask = await tx.bookingTask.update({
            where: { id },
            data: setStatusData,
          });

          if (task.assistantId) {
            const profileStatus =
              newStatus === "executing"
                ? ProfileStatus.executing
                : newStatus === "paused"
                  ? ProfileStatus.busy
                  : newStatus === "waiting"
                    ? ProfileStatus.assigned
                    : ProfileStatus.idle;

            await tx.profile.update({
              where: { id: task.assistantId },
              data: { status: profileStatus },
            });
          }

          return updatedTask;
        });

        // 任务回到 waiting 且无助理时，尝试自动派单
        if (newStatus === "waiting" && !task.assistantId) {
          await assignTask(id);
        }

        return Response.json(updated);
      }

      case "extend": {
        if (!estMinutes) {
          return Response.json(
            { error: "estMinutes required for extend" },
            { status: 400 }
          );
        }
        const newEnd = new Date(Date.now() + estMinutes * 60 * 1000);
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { estEndTime: newEnd },
        });
        return Response.json(updated);
      }

      default:
        return Response.json(
          { error: "Invalid action. Use: start, pause, complete, extend, setStatus" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[PATCH /api/tasks/[id]]", error);
    const isDev = process.env.NODE_ENV === "development";
    let details: string | undefined;
    if (isDev) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        details = `${error.code}: ${error.message}`;
      } else if (error instanceof Error) {
        details = error.message;
      }
    }
    return Response.json(
      { error: "Failed to update task", ...(details ? { details } : {}) },
      { status: 500 }
    );
  }
}
