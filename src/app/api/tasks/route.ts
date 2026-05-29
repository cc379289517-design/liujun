import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import {
  assignTask,
  buildP1InterruptCandidateOrderFromFiltered,
  canInterrupt,
  effectiveInterruptLeaveCapMinutes,
  getSchedulerRuntimeConfig,
  interruptAssistant,
  interruptWaitingPreempt,
  recordP1InterruptRoundRobin,
  sweepWaitingTasks,
  cleanupStaleTasks,
  syncProfileStatus,
  escalatePriorities,
  taskCategoryCanBeInterrupted,
} from "@/lib/scheduler";

const TASK_INCLUDE = {
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: {
    select: {
      id: true,
      name: true,
      priorityLevel: true,
      estDuration: true,
      minDuration: true,
      maxDuration: true,
    },
  },
  collaborators: {
    where: { status: { not: "left" } },
    include: {
      assistant: { select: { id: true, name: true, currentRoom: true, avatar: true, buildingId: true } },
    },
  },
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
    if (assistantId) {
      where.OR = [
        { assistantId },
        { collaborators: { some: { assistantId, status: { not: "left" } } } },
      ];
    }

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

    // 动态提权：等待超时的任务自动升级优先级
    await escalatePriorities();

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

    // 先释放被分配的助理与协作助理
    const tasksToDelete = await prisma.bookingTask.findMany({
      where,
      select: {
        assistantId: true,
        collaborators: { where: { status: { in: ["waiting", "executing", "paused"] } }, select: { assistantId: true } },
      },
    });

    const assistantIds = tasksToDelete
      .flatMap((t) => [t.assistantId, ...t.collaborators.map((c) => c.assistantId)])
      .filter((id): id is string => id !== null);

    if (assistantIds.length > 0) {
      await prisma.profile.updateMany({
        where: { id: { in: assistantIds } },
        data: { status: "idle" },
      });
    }

    const result = await prisma.bookingTask.deleteMany({ where });
    await syncProfileStatus();

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
      select: { priorityLevel: true, estDuration: true, maxDuration: true },
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

    if (isSpecified && assistantId) {
      await prisma.$transaction([
        prisma.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: task.id, assistantId } },
          create: { taskId: task.id, assistantId, role: "primary", status: "waiting" },
          update: { role: "primary", status: "waiting", leftAt: null },
        }),
        prisma.profile.update({
          where: { id: assistantId },
          data: { status: "assigned" },
        }),
      ]);
      const updated = await prisma.bookingTask.findUnique({
        where: { id: task.id },
        include: TASK_INCLUDE,
      });
      return Response.json(updated ?? task, { status: 201 });
    }

    // 自动派单（非指定助理模式）：先空闲助理；无空闲则对「更紧急的短时单」尝试插单
    if (!isSpecified) {
      const buildingId = task.photographer.buildingId;
      const taskPriority = task.priority;

      const assignedIdle = await assignTask(task.id, buildingId);
      if (assignedIdle) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return Response.json(updated, { status: 201 });
      }

      // 同楼座无空闲助理：尝试抢占「已派发、尚在待就位」的较低优先任务（新单更紧急）
      const preempted = await interruptWaitingPreempt(buildingId, task.id, taskPriority);
      if (preempted) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return Response.json(updated ?? task, { status: 201 });
      }

      // 仍无：尝试对执行中单插单（新单更紧急且离场在 cap 内、当前类型允许被打断）
      const busyAssistants = await prisma.profile.findMany({
        where: {
          role: { in: ["assistant", "assistant_leader"] },
          status: { in: ["executing", "busy"] },
          onlineStatus: "online",
          buildingId,
        },
      });

      const runtimeCfg = await getSchedulerRuntimeConfig();
      const globalInterruptCap = runtimeCfg.INTERRUPT_MAX_MINUTES;
      /** 新任务「离场」保守上界：优先用类型 maxDuration（与快捷预约时段一致），否则 estDuration */
      const newTaskLeaveUpperMin =
        category.maxDuration > 0 ? category.maxDuration : Math.max(0, category.estDuration || 0);

      const assistantCurrentTasks = await prisma.bookingTask.findMany({
        where: {
          assistantId: { in: busyAssistants.map((a) => a.id) },
          status: TaskStatus.executing,
        },
        include: { category: { select: { canBeInterrupted: true, maxDuration: true, maxInterruptMinutes: true } } },
      });

      const filteredCandidates = assistantCurrentTasks.filter((t) => {
        if (t.isLocked || !taskCategoryCanBeInterrupted(t.category)) return false;
        // 当前执行单须比新单「更低优先」（数值更大），P1 进行中不可作为被插对象
        if (t.priority <= taskPriority) return false;
        const cap = effectiveInterruptLeaveCapMinutes(globalInterruptCap, t.category.maxInterruptMinutes);
        if (newTaskLeaveUpperMin > cap) return false;
        return true;
      });

      const interruptOrder = await buildP1InterruptCandidateOrderFromFiltered(buildingId, filteredCandidates);

      for (const candidate of interruptOrder) {
        if (!candidate.assistantId) continue;
        const ok = await canInterrupt(candidate.assistantId, taskPriority);
        if (ok) {
          await interruptAssistant(candidate.assistantId, task.id);
          await recordP1InterruptRoundRobin(buildingId, candidate.assistantId);
          const updated = await prisma.bookingTask.findUnique({
            where: { id: task.id },
            include: TASK_INCLUDE,
          });
          return Response.json(updated, { status: 201 });
        }
      }

      const finalTask = await prisma.bookingTask.findUnique({
        where: { id: task.id },
        include: TASK_INCLUDE,
      });
      return Response.json(finalTask ?? task, { status: 201 });
    }

    const withInclude = await prisma.bookingTask.findUnique({
      where: { id: task.id },
      include: TASK_INCLUDE,
    });
    return Response.json(withInclude ?? task, { status: 201 });
  } catch (error) {
    console.error("[POST /api/tasks]", error);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }
}
