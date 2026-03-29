import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import { assignTask, canInterrupt, interruptAssistant } from "@/lib/scheduler";

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

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (priority) where.priority = parseInt(priority);
    if (photographerId) where.photographerId = photographerId;
    if (assistantId) where.assistantId = assistantId;

    const tasks = await prisma.bookingTask.findMany({
      where,
      include: {
        photographer: { select: { id: true, name: true, currentRoom: true } },
        assistant: { select: { id: true, name: true, currentRoom: true } },
        category: { select: { id: true, name: true, priorityLevel: true } },
      },
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
      include: {
        photographer: { select: { id: true, name: true, currentRoom: true } },
        assistant: { select: { id: true, name: true, currentRoom: true } },
        category: { select: { id: true, name: true, priorityLevel: true } },
      },
    });

    // 自动派单（非指定助理模式）
    if (!isSpecified) {
      // P1 紧急任务：尝试插单
      if (category.priorityLevel === 1) {
        const busyAssistants = await prisma.profile.findMany({
          where: {
            role: "assistant",
            status: { in: ["executing", "busy"] },
            isOnline: true,
          },
        });

        for (const assistant of busyAssistants) {
          const ok = await canInterrupt(assistant.id, 1);
          if (ok) {
            await interruptAssistant(assistant.id, task.id);
            const updated = await prisma.bookingTask.findUnique({
              where: { id: task.id },
              include: {
                photographer: { select: { id: true, name: true, currentRoom: true } },
                assistant: { select: { id: true, name: true, currentRoom: true } },
                category: { select: { id: true, name: true, priorityLevel: true } },
              },
            });
            return Response.json(updated, { status: 201 });
          }
        }
      }

      // 普通派单：查找空闲助理
      const assignedId = await assignTask(task.id);
      if (assignedId) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: {
            photographer: { select: { id: true, name: true, currentRoom: true } },
            assistant: { select: { id: true, name: true, currentRoom: true } },
            category: { select: { id: true, name: true, priorityLevel: true } },
          },
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
