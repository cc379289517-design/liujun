import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import { assignTask, canInterrupt, interruptAssistant, sweepWaitingTasks, cleanupStaleTasks, syncProfileStatus } from "@/lib/scheduler";

const TASK_INCLUDE = {
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: { select: { id: true, name: true, priorityLevel: true } },
} as const;

/**
 * GET /api/tasks - 查询任务列表
 * 支持 ?status=waiting&priority=1&photographerId=xxx&assistantId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") as TaskStatus | null;
    const priority = searchParams.get("priority");
    const photographerId = searchParams.get("photographerId");
    const assistantId = searchParams.get("assistantId");

    const todayOnly = searchParams.get("todayOnly");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (priority) where.priority = parseInt(priority);
    if (photographerId) where.photographerId = photographerId;
    if (assistantId) where.assistantId = assistantId;

    // 只返回今天的任务（基于 createdAt，过了24点自动不显示昨天的）
    if (todayOnly === "true") {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      where.createdAt = { gte: startOfDay, lt: endOfDay };
    }

    // 返回本周任务（周一到周日）
    const weekOnly = searchParams.get("weekOnly");
    if (weekOnly === "true") {
      const now = new Date();
      const dow = now.getDay(); // 0=周日
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.createdAt = { gte: monday, lt: nextMonday };
    }

    // 每日首次请求时清理过期任务
    await cleanupStaleTasks();

    // 同步助理 profile.status 与实际任务一致
    await syncProfileStatus();

    // 每次查询时扫描：将空闲助理与等待中的任务自动匹配
    await sweepWaitingTasks();

    const tasks = await prisma.bookingTask.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    return Response.json(tasks);
  } catch (error) {
    console.error("[GET /api/tasks]", error);
    return Response.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks - 批量清空任务
 * 支持 ?photographerId=xxx 按摄影师清空
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const photographerId = searchParams.get("photographerId");

    const where: Record<string, unknown> = {};
    if (photographerId) where.photographerId = photographerId;
    // 排除已完成的任务，只清空进行中/等待中的
    where.status = { not: TaskStatus.completed };

    // 先释放被分配的助理
    const tasksToDelete = await prisma.bookingTask.findMany({
      where,
      select: { assistantId: true },
    });

    const assistantIds = tasksToDelete
      .map((t) => t.assistantId)
      .filter((id): id is string => id !== null);

    if (assistantIds.length > 0) {
      await prisma.profile.updateMany({
        where: { id: { in: assistantIds } },
        data: { status: "idle" },
      });
    }

    const result = await prisma.bookingTask.deleteMany({ where });

    // 助理释放后，扫描等待队列自动派单
    await sweepWaitingTasks();

    return Response.json({ deleted: result.count });
  } catch (error) {
    console.error("[DELETE /api/tasks]", error);
    return Response.json({ error: "Failed to delete tasks" }, { status: 500 });
  }
}

/**
 * POST /api/tasks - 创建新任务
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      photographerId,
      roomNumber,
      categoryId,
      priority: requestedPriority,
      assistantId,
      isSpecified,
      isLocked,
      lockReason,
      estMinutes,
      note,
    } = body;

    if (!photographerId || !roomNumber || !categoryId) {
      return Response.json(
        { error: "photographerId, roomNumber, categoryId are required" },
        { status: 400 }
      );
    }

    const category = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return Response.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    // 锁定开关打开时必须填写原因
    if (isLocked && !lockReason) {
      return Response.json(
        { error: "lockReason is required when isLocked is true" },
        { status: 400 }
      );
    }

    const estEndTime = estMinutes
      ? new Date(Date.now() + estMinutes * 60 * 1000)
      : null;

    const task = await prisma.bookingTask.create({
      data: {
        photographerId,
        roomNumber,
        categoryId,
        priority: requestedPriority ?? category.priorityLevel,
        isSpecified: isSpecified ?? false,
        assistantId: isSpecified ? assistantId : null,
        isLocked: isLocked ?? false,
        lockReason: isLocked ? lockReason : null,
        estEndTime,
        note,
      },
      include: TASK_INCLUDE,
    });

    // 自动派单（非指定助理模式）
    if (!isSpecified) {
      const buildingId = task.photographer.buildingId;
      const taskPriority = task.priority;

      // P1 紧急任务：尝试插单（仅同楼座）
      if (taskPriority === 1) {
        const busyAssistants = await prisma.profile.findMany({
          where: {
            role: { in: ["assistant", "assistant_leader"] },
            status: { in: ["executing", "busy"] },
            onlineStatus: "online",
            buildingId,
          },
        });

        // 查找每个忙碌助理当前执行的任务优先级，优先插断低优先级
        const assistantCurrentTasks = await prisma.bookingTask.findMany({
          where: {
            assistantId: { in: busyAssistants.map((a) => a.id) },
            status: TaskStatus.executing,
          },
          include: { category: { select: { canBeInterrupted: true } } },
        });

        // 按当前任务优先级从低到高排序（P4→P3→P2），优先插最低的
        // 同时过滤掉类型不允许被打断的任务
        const sortedCandidates = assistantCurrentTasks
          .filter((t) => t.priority > 1 && !t.isLocked && t.category.canBeInterrupted)
          .sort((a, b) => b.priority - a.priority);

        for (const candidate of sortedCandidates) {
          if (!candidate.assistantId) continue;
          const ok = await canInterrupt(candidate.assistantId, 1);
          if (ok) {
            await interruptAssistant(candidate.assistantId, task.id);
            const updated = await prisma.bookingTask.findUnique({
              where: { id: task.id },
              include: TASK_INCLUDE,
            });
            return Response.json(updated, { status: 201 });
          }
        }
      }

      // 普通派单：查找空闲助理
      const assignedId = await assignTask(task.id, buildingId);
      if (assignedId) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return Response.json(updated, { status: 201 });
      }
    }

    return Response.json(task, { status: 201 });
  } catch (error) {
    console.error("[POST /api/tasks]", error);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }
}
