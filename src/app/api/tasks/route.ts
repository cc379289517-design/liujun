import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { OnlineStatus, PriorityUpgradeRequestStatus, Role, TaskStatus } from "@/generated/prisma/client";
import {
  assignTask,
  checkPhotographerActiveTaskLimit,
  interruptExecutingPreempt,
  interruptWaitingPreempt,
  runTaskMaintenance,
  taskLeaveUpperMinutes,
} from "@/lib/scheduler";
import { isIroningCategoryName } from "@/lib/ironingRules";
import {
  PHOTOGRAPHER_LIMIT_QUEUE_CAPACITY,
  PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
  photographerLimitQueueFullPrompt,
} from "@/lib/photographerTaskLimit";

const VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES: PriorityUpgradeRequestStatus[] = [
  PriorityUpgradeRequestStatus.pending,
  PriorityUpgradeRequestStatus.approved,
];
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover"];
const ACTIVE_TASK_STATUSES = [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] as const;

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
  priorityUpgradeRequests: {
    where: { status: { in: VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      fromPriority: true,
      targetPriority: true,
      reason: true,
      createdAt: true,
    },
  },
  completionRegistration: {
    select: {
      id: true,
      taskId: true,
      assistantId: true,
      sku: true,
      imageUrls: true,
      reasonType: true,
      description: true,
      overtimeMinutesSnapshot: true,
      workSecondsSnapshot: true,
      createdAt: true,
      updatedAt: true,
      assistant: { select: { id: true, name: true } },
    },
  },
  assistantTransferRequests: {
    where: { status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES } },
    orderBy: { requestedAt: "desc" },
    take: 3,
    select: {
      id: true,
      taskId: true,
      fromAssistantId: true,
      targetAssistantId: true,
      counterpartTaskId: true,
      kind: true,
      responseMode: true,
      status: true,
      reason: true,
      requestedAt: true,
      targetConfirmedAt: true,
      completedAt: true,
      canceledAt: true,
    },
  },
} as const;

const TASK_INCLUDE_WITHOUT_COLLABORATORS = {
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: TASK_INCLUDE.category,
  priorityUpgradeRequests: TASK_INCLUDE.priorityUpgradeRequests,
  completionRegistration: TASK_INCLUDE.completionRegistration,
  assistantTransferRequests: TASK_INCLUDE.assistantTransferRequests,
} as const;

const STATS_TASK_SELECT = {
  id: true,
  photographerId: true,
  assistantId: true,
  locationBuildingId: true,
  roomNumber: true,
  priority: true,
  status: true,
  publisherFeedback: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  estEndTime: true,
  effectiveWorkSeconds: true,
  workSegmentStartedAt: true,
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: TASK_INCLUDE.category,
  collaborators: {
    where: { status: { not: "left" } },
    select: {
      id: true,
      taskId: true,
      assistantId: true,
      role: true,
      status: true,
      joinedAt: true,
      leftAt: true,
      startedAt: true,
      completedAt: true,
      effectiveWorkSeconds: true,
      workSegmentStartedAt: true,
      assistant: { select: { id: true, name: true, currentRoom: true, avatar: true, buildingId: true } },
    },
  },
  completionRegistration: TASK_INCLUDE.completionRegistration,
} as const;

const ADMIN_LIST_TASK_SELECT = {
  id: true,
  photographerId: true,
  assistantId: true,
  locationBuildingId: true,
  roomNumber: true,
  priority: true,
  status: true,
  createdAt: true,
  photographer: { select: { id: true, name: true, currentRoom: true, buildingId: true } },
  assistant: { select: { id: true, name: true, currentRoom: true } },
  category: { select: { id: true, name: true, priorityLevel: true } },
} as const;

const TASK_QUERY_LIMIT_MAX = 500;

function parsePositiveIntParam(value: string | null, name: string): { value?: number; error?: Response } {
  if (value == null || value.trim() === "") return {};
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: Response.json({ error: `${name} must be a positive integer` }, { status: 400 }) };
  }
  return { value: parsed };
}

function parseDateBoundParam(value: string | null, name: string): { value?: Date; error?: Response } {
  if (value == null || value.trim() === "") return {};
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return { error: Response.json({ error: `${name} must be a valid date` }, { status: 400 }) };
  }
  return { value: parsed };
}

function taskBuildingWhere(buildingId: number) {
  return {
    OR: [
      { locationBuildingId: buildingId },
      { locationBuildingId: null, photographer: { buildingId } },
    ],
  };
}

async function createdTaskResponse(task: unknown) {
  await runTaskMaintenance();
  return Response.json(task, { status: 201 });
}

async function photographerHasStaleActiveTasks(photographerId: string): Promise<boolean> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const task = await prisma.bookingTask.findFirst({
    where: {
      photographerId,
      createdAt: { lt: startOfToday },
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
    select: { id: true },
  });
  return task != null;
}

function specifiedAssistantError(error: string, code: string, status = 409) {
  return Response.json({ error, code }, { status });
}

async function validateSpecifiedAssistant(
  assistantId: string,
  taskBuildingId: number
): Promise<Response | null> {
  const assistant = await prisma.profile.findUnique({
    where: { id: assistantId },
    select: {
      id: true,
      role: true,
      onlineStatus: true,
      subStatus: true,
      buildingId: true,
      activeBuildingId: true,
    },
  });

  if (!assistant) {
    return specifiedAssistantError("指定助理不存在，请重新选择", "SPECIFIED_ASSISTANT_NOT_FOUND", 404);
  }
  if (assistant.role !== Role.assistant && assistant.role !== Role.assistant_leader) {
    return specifiedAssistantError("只能指定助理或助理组长", "SPECIFIED_ASSISTANT_INVALID_ROLE", 400);
  }
  if (assistant.onlineStatus !== OnlineStatus.online) {
    return specifiedAssistantError("指定助理当前不在线，无法指定", "SPECIFIED_ASSISTANT_OFFLINE");
  }
  if (assistant.subStatus) {
    return specifiedAssistantError("指定助理当前暂不可接单，请重新选择", "SPECIFIED_ASSISTANT_UNAVAILABLE");
  }

  const assistantBuildingId = assistant.activeBuildingId ?? assistant.buildingId;
  if (assistantBuildingId !== taskBuildingId) {
    return specifiedAssistantError("指定助理不在当前任务区域，请重新选择", "SPECIFIED_ASSISTANT_WRONG_BUILDING");
  }
  return null;
}

/**
 * GET /api/tasks - 查询任务列表
 * 支持 ?status=waiting&priority=1&photographerId=xxx&assistantId=xxx&buildingId=1&limit=100&startDate=...&endDate=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") as TaskStatus | null;
    const priority = searchParams.get("priority");
    const photographerId = searchParams.get("photographerId");
    const assistantId = searchParams.get("assistantId");
    const profileId = searchParams.get("profileId");
    const view = searchParams.get("view");
    const buildingIdParam = searchParams.get("buildingId");
    const limitParam = searchParams.get("limit");
    const payload = searchParams.get("payload");
    const includeCollaborators = searchParams.get("includeCollaborators") !== "false";

    const todayOnly = searchParams.get("todayOnly");

    const where: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];
    if (status) where.status = status;
    const parsedPriority = parsePositiveIntParam(priority, "priority");
    if (parsedPriority.error) return parsedPriority.error;
    if (parsedPriority.value != null) where.priority = parsedPriority.value;

    const parsedLimit = parsePositiveIntParam(limitParam, "limit");
    if (parsedLimit.error) return parsedLimit.error;
    const take = parsedLimit.value == null ? undefined : Math.min(parsedLimit.value, TASK_QUERY_LIMIT_MAX);

    const parsedStartDate = parseDateBoundParam(searchParams.get("startDate"), "startDate");
    if (parsedStartDate.error) return parsedStartDate.error;
    const parsedEndDate = parseDateBoundParam(searchParams.get("endDate"), "endDate");
    if (parsedEndDate.error) return parsedEndDate.error;
    if (parsedStartDate.value && parsedEndDate.value) {
      if (parsedStartDate.value >= parsedEndDate.value) {
        return Response.json({ error: "startDate must be before endDate" }, { status: 400 });
      }
      where.createdAt = { gte: parsedStartDate.value, lt: parsedEndDate.value };
    } else if (parsedStartDate.value) {
      where.createdAt = { gte: parsedStartDate.value };
    } else if (parsedEndDate.value) {
      where.createdAt = { lt: parsedEndDate.value };
    }

    const parsedBuildingId = parsePositiveIntParam(buildingIdParam, "buildingId");
    if (parsedBuildingId.error) return parsedBuildingId.error;
    if (parsedBuildingId.value != null) {
      andFilters.push(taskBuildingWhere(parsedBuildingId.value));
    }

    const scopedPhotographerId = photographerId || (view === "photographer" ? profileId : null);
    const scopedAssistantId = assistantId || (view === "assistant" ? profileId : null);
    if (view && !["photographer", "assistant", "admin", "building"].includes(view)) {
      return Response.json({ error: "view must be photographer, assistant, admin, or building" }, { status: 400 });
    }
    if ((view === "photographer" || view === "assistant") && !profileId && !photographerId && !assistantId) {
      return Response.json({ error: "profileId is required for photographer or assistant view" }, { status: 400 });
    }
    if (payload && !["stats", "adminList"].includes(payload)) {
      return Response.json({ error: "payload must be stats or adminList" }, { status: 400 });
    }

    if (scopedPhotographerId) where.photographerId = scopedPhotographerId;
    if (scopedAssistantId) {
      andFilters.push({
        OR: [
          { assistantId: scopedAssistantId },
          { collaborators: { some: { assistantId: scopedAssistantId, status: { not: "left" } } } },
          {
            assistantTransferRequests: {
              some: {
                targetAssistantId: scopedAssistantId,
                status: { in: ["confirming", "pending_after_complete", "ready_to_takeover"] },
              },
            },
          },
          {
            assistantTransferRequests: {
              some: {
                fromAssistantId: scopedAssistantId,
                status: "pending_after_complete",
              },
            },
          },
        ],
      });
    }

    // 只返回今天的任务（基于 createdAt，过了24点自动不显示昨天的）
    if (todayOnly === "true" && !where.createdAt) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      where.createdAt = { gte: startOfDay, lt: endOfDay };
    }

    // 返回本周任务（周一到周日）
    const weekOnly = searchParams.get("weekOnly");
    if (weekOnly === "true" && !where.createdAt) {
      const now = new Date();
      const dow = now.getDay(); // 0=周日
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const rawWeekOffset = Number.parseInt(searchParams.get("weekOffset") ?? "0", 10);
      const weekOffset = Number.isFinite(rawWeekOffset) ? rawWeekOffset : 0;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + weekOffset * 7);
      const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.createdAt = { gte: monday, lt: nextMonday };
    }

    if (andFilters.length > 0) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...andFilters];
    }

    if (payload === "stats") {
      const tasks = await prisma.bookingTask.findMany({
        where,
        select: STATS_TASK_SELECT,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take,
      });

      return Response.json(tasks);
    }

    if (payload === "adminList") {
      const tasks = await prisma.bookingTask.findMany({
        where,
        select: ADMIN_LIST_TASK_SELECT,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take,
      });

      return Response.json(tasks);
    }

    const include = includeCollaborators ? TASK_INCLUDE : TASK_INCLUDE_WITHOUT_COLLABORATORS;

    const tasks = await prisma.bookingTask.findMany({
      where,
      include,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take,
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
    // 只清空助理尚未点击开始、且不在插单链路中的 waiting 任务。
    where.status = TaskStatus.waiting;
    where.parentTaskId = null;
    where.interruptTasks = { none: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } } };

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
    await runTaskMaintenance({ force: true });

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
      locationBuildingId,
      roomNumber,
      categoryId,
      assistantId,
      isSpecified,
      isLocked,
      lockReason,
      estMinutes,
      note,
      priority,
      quickBookSpecialType,
    } = body;
    const wantsSpecifiedAssistant = isSpecified === true;
    const specifiedAssistantId = typeof assistantId === "string" ? assistantId.trim() : "";

    if (!photographerId || !roomNumber || !categoryId) {
      return Response.json(
        { error: "photographerId, roomNumber, categoryId are required" },
        { status: 400 }
      );
    }
    if (wantsSpecifiedAssistant && !specifiedAssistantId) {
      return specifiedAssistantError("指定助理不能为空，请重新选择", "SPECIFIED_ASSISTANT_REQUIRED", 400);
    }

    if (await photographerHasStaleActiveTasks(photographerId)) {
      await runTaskMaintenance({ force: true });
    }

    const taskLimit = await checkPhotographerActiveTaskLimit(photographerId);
    const queuedByPhotographerLimit = !taskLimit.allowed;
    if (queuedByPhotographerLimit) {
      const existingLimitQueuedTasks = await prisma.bookingTask.count({
        where: {
          photographerId,
          status: TaskStatus.waiting,
          assistantId: null,
          isLocked: true,
          lockReason: PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON,
        },
      });
      if (existingLimitQueuedTasks >= PHOTOGRAPHER_LIMIT_QUEUE_CAPACITY) {
        return Response.json(
          {
            error: photographerLimitQueueFullPrompt(taskLimit.limit),
            code: "PHOTOGRAPHER_LIMIT_QUEUE_FULL",
            activeTaskCount: taskLimit.activeCount,
            maxActiveTasks: taskLimit.limit,
            queuedTaskCount: existingLimitQueuedTasks,
            maxQueuedTasks: PHOTOGRAPHER_LIMIT_QUEUE_CAPACITY,
          },
          { status: 409 }
        );
      }
    }

    const category = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
      select: { name: true, priorityLevel: true, estDuration: true, maxDuration: true },
    });

    if (!category) {
      return Response.json({ error: "Invalid categoryId" }, { status: 400 });
    }
    const requestedPriority = Number.parseInt(String(priority ?? ""), 10);
    const externalModelSpecialPriority =
      quickBookSpecialType === "external_model_follow" &&
      requestedPriority === 6 &&
      (category.name === "其他" || category.name.includes("外模"));
    const initialPriority = externalModelSpecialPriority ? 6 : category.priorityLevel;

    const photographer = await prisma.profile.findUnique({
      where: { id: photographerId },
      select: { buildingId: true },
    });
    if (!photographer) {
      return Response.json({ error: "Invalid photographerId" }, { status: 400 });
    }

    const parsedLocationBuildingId =
      locationBuildingId != null && locationBuildingId !== ""
        ? parseInt(String(locationBuildingId), 10)
        : null;
    const normalizedLocationBuildingId =
      typeof parsedLocationBuildingId === "number" && Number.isFinite(parsedLocationBuildingId)
        ? parsedLocationBuildingId
        : null;
    const effectiveTaskBuildingId = normalizedLocationBuildingId ?? photographer.buildingId;

    if (wantsSpecifiedAssistant && !queuedByPhotographerLimit) {
      const specifiedAssistantValidation = await validateSpecifiedAssistant(
        specifiedAssistantId,
        effectiveTaskBuildingId
      );
      if (specifiedAssistantValidation) return specifiedAssistantValidation;
    }

    // 锁定开关打开时必须填写原因
    if (isLocked && !lockReason && !queuedByPhotographerLimit) {
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
        locationBuildingId: normalizedLocationBuildingId,
        roomNumber,
        categoryId,
        priority: initialPriority,
        isSpecified: queuedByPhotographerLimit ? false : wantsSpecifiedAssistant,
        assistantId: !queuedByPhotographerLimit && wantsSpecifiedAssistant ? specifiedAssistantId : null,
        isLocked: queuedByPhotographerLimit ? true : isLocked ?? false,
        lockReason: queuedByPhotographerLimit
          ? PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON
          : isLocked
            ? lockReason
            : null,
        estEndTime,
        note,
      },
      include: TASK_INCLUDE,
    });

    if (queuedByPhotographerLimit) {
      return createdTaskResponse(task);
    }

    if (wantsSpecifiedAssistant) {
      await prisma.$transaction([
        prisma.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: task.id, assistantId: specifiedAssistantId } },
          create: { taskId: task.id, assistantId: specifiedAssistantId, role: "primary", status: "waiting" },
          update: { role: "primary", status: "waiting", leftAt: null },
        }),
        prisma.profile.updateMany({
          where: { id: specifiedAssistantId, status: "idle" },
          data: { status: "assigned" },
        }),
      ]);
      const updated = await prisma.bookingTask.findUnique({
        where: { id: task.id },
        include: TASK_INCLUDE,
      });
      return createdTaskResponse(updated ?? task);
    }

    // 自动派单（非指定助理模式）：先空闲助理；无空闲则对「更紧急的短时单」尝试插单
    if (!wantsSpecifiedAssistant) {
      const buildingId = task.locationBuildingId ?? effectiveTaskBuildingId;
      const taskPriority = task.priority;
      /** 新任务「离场」保守上界：优先用类型 maxDuration（与快捷预约时段一致），否则 estDuration */
      const newTaskLeaveUpperMin = taskLeaveUpperMinutes(category);

      const assignedIdle = await assignTask(task.id, buildingId);
      if (assignedIdle) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return createdTaskResponse(updated);
      }

      if (isIroningCategoryName(category.name)) {
        const finalTask = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return createdTaskResponse(finalTask ?? task);
      }

      // 同楼座无空闲助理：尝试抢占「已派发、尚在待就位」的较低优先任务（新单更紧急）
      const preempted = await interruptWaitingPreempt(buildingId, task.id, taskPriority, newTaskLeaveUpperMin);
      if (preempted) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return createdTaskResponse(updated ?? task);
      }

      // 仍无：尝试对执行中单插单（与 sweep 共用同一套候选过滤和保护规则）
      const interruptedExecuting = await interruptExecutingPreempt(
        buildingId,
        task.id,
        taskPriority,
        newTaskLeaveUpperMin
      );
      if (interruptedExecuting) {
        const updated = await prisma.bookingTask.findUnique({
          where: { id: task.id },
          include: TASK_INCLUDE,
        });
        return createdTaskResponse(updated);
      }

      const finalTask = await prisma.bookingTask.findUnique({
        where: { id: task.id },
        include: TASK_INCLUDE,
      });
      return createdTaskResponse(finalTask ?? task);
    }

    const withInclude = await prisma.bookingTask.findUnique({
      where: { id: task.id },
      include: TASK_INCLUDE,
    });
    return createdTaskResponse(withInclude ?? task);
  } catch (error) {
    console.error("[POST /api/tasks]", error);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }
}
