import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { completeTask, assignTask, runTaskMaintenance, updateTaskParticipantStatus } from "@/lib/scheduler";
import { TaskStatus, ProfileStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";

type RouteContext = { params: Promise<{ id: string }> };

function taskTypeGroupName(name: string | null | undefined): string {
  if (!name) return "其他";
  if (name === "短时熨烫" || name === "长时熨烫" || name === "熨烫" || name.includes("熨")) return "熨烫";
  return "其他";
}

async function ironingMachineAvailabilityForStart(taskId: string): Promise<{ ok: boolean; available: number; executing: number }> {
  const task = await prisma.bookingTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      locationBuildingId: true,
      photographer: { select: { buildingId: true } },
      category: { select: { name: true } },
    },
  });
  if (!task || taskTypeGroupName(task.category?.name) !== "熨烫") {
    return { ok: true, available: 0, executing: 0 };
  }

  const buildingId = task.locationBuildingId ?? task.photographer.buildingId;
  const [available, executing] = await Promise.all([
    prisma.ironingMachine.count({ where: { buildingId, status: "normal" } }),
    prisma.bookingTask.count({
      where: {
        id: { not: task.id },
        status: TaskStatus.executing,
        OR: [
          { locationBuildingId: buildingId },
          { locationBuildingId: null, photographer: { buildingId } },
        ],
        category: {
          name: { contains: "熨" },
        },
      },
    }),
  ]);

  return { ok: executing < available, available, executing };
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
        collaborators: {
          where: { status: { not: "left" } },
          include: {
            assistant: { select: { id: true, name: true, currentRoom: true, avatar: true, buildingId: true } },
          },
        },
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

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: { collaborators: { where: { status: { in: ["waiting", "executing", "paused"] } }, select: { assistantId: true } } },
    });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    const releasedIds = [task.assistantId, ...task.collaborators.map((c) => c.assistantId)]
      .filter((id): id is string => id != null);
    if (releasedIds.length > 0) {
      await prisma.profile.updateMany({
        where: { id: { in: releasedIds } },
        data: { status: ProfileStatus.idle },
      });
    }

    await prisma.bookingTask.delete({ where: { id } });
    await runTaskMaintenance({ force: true });

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
    const { action, estMinutes, actorAssistantId } = body;

    const task = await prisma.bookingTask.findUnique({ where: { id } });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    switch (action) {
      case "start": {
        const actorId = actorAssistantId ?? task.assistantId;
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for start" }, { status: 400 });
        }
        const ironingAvailability = await ironingMachineAvailabilityForStart(id);
        if (!ironingAvailability.ok) {
          return Response.json(
            {
              code: "ironing_machine_busy",
              error: "当前区域熨烫机正在使用，请等待上一位助理完成后再开始",
              available: ironingAvailability.available,
              executing: ironingAvailability.executing,
            },
            { status: 409 },
          );
        }
        await updateTaskParticipantStatus(id, actorId, "executing", estMinutes);
        const updated = await prisma.bookingTask.findUnique({ where: { id } });
        await runTaskMaintenance();

        return Response.json(updated);
      }

      case "pause": {
        const actorId = actorAssistantId ?? task.assistantId;
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for pause" }, { status: 400 });
        }
        await updateTaskParticipantStatus(id, actorId, "paused");
        const updated = await prisma.bookingTask.findUnique({ where: { id } });
        await runTaskMaintenance();

        return Response.json(updated);
      }

      case "complete": {
        const actorId = actorAssistantId ?? task.assistantId;
        if (actorId) {
          await updateTaskParticipantStatus(id, actorId, "completed");
        } else {
          await completeTask(id);
        }
        const updated = await prisma.bookingTask.findUnique({ where: { id } });
        await runTaskMaintenance();
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
          await runTaskMaintenance();
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
            await tx.taskCollaborator.upsert({
              where: { taskId_assistantId: { taskId: id, assistantId: task.assistantId } },
              create: {
                taskId: id,
                assistantId: task.assistantId,
                role: "primary",
                status: newStatus,
                startedAt: newStatus === "executing" ? (task.startedAt ?? new Date()) : null,
                workSegmentStartedAt: newStatus === "executing" ? new Date() : null,
              },
              update: {
                role: "primary",
                status: newStatus,
                leftAt: null,
                startedAt: newStatus === "executing" ? (task.startedAt ?? new Date()) : undefined,
                workSegmentStartedAt: newStatus === "executing" ? new Date() : null,
              },
            });

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
        await runTaskMaintenance();

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

      case "updateNote": {
        const { note } = body as { note: string };
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { note: note?.trim() || null },
        });
        return Response.json(updated);
      }

      case "updatePublisherFeedback": {
        const { feedback } = body as { feedback?: string | null };
        const normalizedFeedback =
          feedback === "like" || feedback === "dislike" ? feedback : null;
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { publisherFeedback: normalizedFeedback },
        });
        return Response.json(updated);
      }

      default:
        return Response.json(
          { error: "Invalid action. Use: start, pause, complete, extend, setStatus, updateNote, updatePublisherFeedback" },
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
      {
        error: error instanceof Error && error.message.includes("熨烫机")
          ? error.message
          : "Failed to update task",
        ...(details ? { details } : {}),
      },
      { status: error instanceof Error && error.message.includes("熨烫机") ? 409 : 500 }
    );
  }
}
