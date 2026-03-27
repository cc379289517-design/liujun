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
 * POST /api/tasks - 创建新任务
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      photographerId,
      roomNumber,
      categoryId,
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
        priority: category.priorityLevel,
        isSpecified: isSpecified ?? false,
        assistantId: isSpecified ? assistantId : null,
        isLocked: isLocked ?? false,
        lockReason: isLocked ? lockReason : null,
        estEndTime,
        note,
      },
      include: {
        photographer: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
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
                photographer: { select: { id: true, name: true } },
                assistant: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
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
            photographer: { select: { id: true, name: true } },
            assistant: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
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
