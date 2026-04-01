import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { completeTask, autoClaimWaitingTask, assignTask, sweepWaitingTasks } from "@/lib/scheduler";
import { TaskStatus, ProfileStatus } from "@/generated/prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

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

        const updated = await prisma.bookingTask.update({
          where: { id },
          data: {
            status: TaskStatus.executing,
            startedAt: new Date(),
            estEndTime,
          },
        });

        if (task.assistantId) {
          await prisma.profile.update({
            where: { id: task.assistantId },
            data: { status: ProfileStatus.executing },
          });
        }

        return Response.json(updated);
      }

      case "pause": {
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { status: TaskStatus.paused },
        });

        if (task.assistantId) {
          await prisma.profile.update({
            where: { id: task.assistantId },
            data: { status: ProfileStatus.busy },
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
          setStatusData.startedAt = new Date();
        } else if (newStatus === "waiting") {
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
    return Response.json({ error: "Failed to update task" }, { status: 500 });
  }
}
