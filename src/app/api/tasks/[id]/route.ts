import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertAssistantCanStartTaskByPriority,
  completeTask,
  assignTask,
  ironingMachineAvailabilityForTask,
  prepareWaitingTaskForAssistantStart,
  respondPrimaryAssistantTransfer,
  runTaskMaintenance,
  requestPrimaryAssistantTransfer,
  syncProfileStatus,
  scheduleTaskMaintenance,
  updateTaskParticipantStatus,
} from "@/lib/scheduler";
import { TaskStatus, ProfileStatus, Role } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { flushExecutingSegment } from "@/lib/taskEffectiveTime";

type RouteContext = { params: Promise<{ id: string }> };
type TaskActionActor = { id: string; role: Role };

const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"] as const;
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover", "completed"];

function actorIdFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function loadActorProfile(actorId: string | null): Promise<TaskActionActor | null> {
  if (!actorId) return null;
  return prisma.profile.findUnique({
    where: { id: actorId },
    select: { id: true, role: true },
  });
}

function isAssistantActor(actor: TaskActionActor | null): boolean {
  return actor?.role === Role.assistant || actor?.role === Role.assistant_leader;
}

function isTaskManager(actor: TaskActionActor | null): boolean {
  return actor?.role === Role.admin || actor?.role === Role.assistant_leader;
}

function forbidden(error: string, code = "TASK_ACTION_FORBIDDEN") {
  return Response.json({ error, code }, { status: 403 });
}

const TASK_ACTION_BUSINESS_ERROR_MESSAGES = [
  "熨烫机",
  "当前助理",
  "该熨烫任务",
  "该任务已",
  "多人协作任务",
  "只有助理",
  "移交",
  "目标助理",
  "不能使用交换",
  "不能接手",
  "更高优先级",
] as const;

function isTaskActionBusinessError(error: unknown): error is Error {
  return error instanceof Error &&
    TASK_ACTION_BUSINESS_ERROR_MESSAGES.some((message) => error.message.includes(message));
}

async function actorIsActiveTaskParticipant(
  taskId: string,
  actorId: string,
  taskAssistantId: string | null
): Promise<boolean> {
  if (taskAssistantId === actorId) return true;
  const participant = await prisma.taskCollaborator.findUnique({
    where: { taskId_assistantId: { taskId, assistantId: actorId } },
    select: { status: true },
  });
  return !!participant &&
    ACTIVE_PARTICIPANT_STATUSES.includes(participant.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]);
}

async function canActorWriteTask(
  taskId: string,
  task: { photographerId: string; assistantId: string | null },
  actor: TaskActionActor | null
): Promise<boolean> {
  if (!actor) return false;
  if (actor.id === task.photographerId) return true;
  if (isTaskManager(actor)) return true;
  if (!isAssistantActor(actor)) return false;
  return actorIsActiveTaskParticipant(taskId, actor.id, task.assistantId);
}

function taskDetailInclude() {
  return {
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
    completionRegistration: {
      include: {
        assistant: { select: { id: true, name: true } },
      },
    },
    assistantTransferRequests: {
      where: { status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES } },
      orderBy: { requestedAt: "desc" },
      take: 3,
    },
  } as const;
}

async function loadTaskDetail(taskId: string) {
  const [task, transferRequests] = await Promise.all([
    prisma.bookingTask.findUnique({
      where: { id: taskId },
      include: taskDetailInclude(),
    }),
    prisma.taskAssistantTransferRequest.findMany({
      where: {
        status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES },
        OR: [
          { taskId },
          { counterpartTaskId: taskId },
        ],
      },
      orderBy: { requestedAt: "desc" },
    }),
  ]);
  if (!task) return null;
  return {
    ...task,
    assistantTransferRequests: transferRequests,
  };
}

/**
 * GET /api/tasks/[id] - 获取单个任务详情
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    const task = await loadTaskDetail(id);

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
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actorProfileId =
      request.nextUrl.searchParams.get("actorProfileId") ||
      request.headers.get("x-profile-id");

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        collaborators: { where: { status: { in: ["waiting", "executing", "paused"] } }, select: { assistantId: true } },
        interruptTasks: { where: { status: { in: [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] } }, select: { id: true } },
      },
    });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (!actorProfileId || actorProfileId !== task.photographerId) {
      return Response.json(
        { error: "只有任务发布摄影师可以取消未开始任务", code: "ONLY_PHOTOGRAPHER_CAN_CANCEL_TASK" },
        { status: 403 }
      );
    }
    if (task.status !== TaskStatus.waiting || task.startedAt != null) {
      return Response.json(
        { error: "任务已开始，不能直接取消", code: "TASK_ALREADY_STARTED_CANNOT_CANCEL" },
        { status: 409 }
      );
    }

    const releasedIds = [task.assistantId, ...task.collaborators.map((c) => c.assistantId)]
      .filter((id): id is string => id != null);

    await prisma.$transaction(async (tx) => {
      if (task.interruptTasks.length > 0) {
        await tx.bookingTask.updateMany({
          where: { parentTaskId: task.id },
          data: { parentTaskId: null },
        });
      }
      await tx.bookingTask.delete({ where: { id } });
    });

    if (releasedIds.length > 0) {
      await syncProfileStatus();
    }
    await runTaskMaintenance({ force: true });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/tasks/[id]]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return Response.json({
        error: "任务处于关联流程中，暂时不能取消",
        code: "TASK_RELATION_CONFLICT",
      }, {
        status: 409,
      });
    }
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
    const { action, estMinutes, actorAssistantId, actorProfileId } = body;

    const task = await prisma.bookingTask.findUnique({ where: { id } });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    switch (action) {
      case "start": {
        const actorId = actorIdFrom(actorAssistantId);
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for start" }, { status: 400 });
        }
        const actor = await loadActorProfile(actorId);
        if (!isAssistantActor(actor)) {
          return forbidden("只有助理可以开始任务", "ONLY_ASSISTANT_CAN_START_TASK");
        }
        await assertAssistantCanStartTaskByPriority(id, actorId);
        await prepareWaitingTaskForAssistantStart(id, actorId);
        const refreshedTask = await prisma.bookingTask.findUnique({
          where: { id },
          select: { assistantId: true, ironingStage: true },
        });
        const canOperate = await actorIsActiveTaskParticipant(id, actorId, refreshedTask?.assistantId ?? task.assistantId);
        if (!canOperate) {
          return forbidden("只有当前任务参与助理可以开始任务", "ONLY_TASK_PARTICIPANT_CAN_START_TASK");
        }
        const ironingAvailability = await ironingMachineAvailabilityForTask(id);
        if (
          !ironingAvailability.ok &&
          refreshedTask?.ironingStage !== "notified" &&
          refreshedTask?.ironingStage !== "using"
        ) {
          return Response.json(
            {
              code: "ironing_machine_busy",
              error: "当前区域熨烫机正在使用，请等待上一位助理完成后再开始",
              available: ironingAvailability.available,
              executing: ironingAvailability.occupied,
              required: ironingAvailability.required,
            },
            { status: 409 },
          );
        }
        await updateTaskParticipantStatus(id, actorId, "executing", estMinutes);
        const updated = await loadTaskDetail(id);
        scheduleTaskMaintenance();

        return Response.json(updated);
      }

      case "pause": {
        const actorId = actorIdFrom(actorAssistantId);
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for pause" }, { status: 400 });
        }
        const actor = await loadActorProfile(actorId);
        if (!isAssistantActor(actor)) {
          return forbidden("只有任务助理可以暂停任务", "ONLY_ASSISTANT_CAN_PAUSE_TASK");
        }
        const canOperate = await actorIsActiveTaskParticipant(id, actorId, task.assistantId);
        if (!canOperate) {
          return forbidden("只有当前任务参与助理可以暂停任务", "ONLY_TASK_PARTICIPANT_CAN_PAUSE_TASK");
        }
        await updateTaskParticipantStatus(id, actorId, "paused");
        const updated = await loadTaskDetail(id);
        scheduleTaskMaintenance();

        return Response.json(updated);
      }

      case "complete": {
        const actorId = actorIdFrom(actorAssistantId);
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for complete" }, { status: 400 });
        }
        const actor = await loadActorProfile(actorId);
        if (!isAssistantActor(actor)) {
          return forbidden("只有任务助理可以完成任务", "ONLY_ASSISTANT_CAN_COMPLETE_TASK");
        }
        const canOperate = await actorIsActiveTaskParticipant(id, actorId, task.assistantId);
        if (!canOperate) {
          return forbidden("只有当前任务参与助理可以完成任务", "ONLY_TASK_PARTICIPANT_CAN_COMPLETE_TASK");
        }
        await updateTaskParticipantStatus(id, actorId, "completed");
        const updated = await loadTaskDetail(id);
        scheduleTaskMaintenance();
        return Response.json(updated);
      }

      case "setStatus": {
        const actor = await loadActorProfile(actorIdFrom(actorProfileId) ?? actorIdFrom(actorAssistantId));
        if (!isTaskManager(actor)) {
          return forbidden("只有管理或助理组长可以直接改任务状态", "ONLY_MANAGER_CAN_SET_TASK_STATUS");
        }
        const { newStatus } = body as { newStatus: string };
        const validStatuses = ["waiting", "executing", "paused", "completed"];
        if (!newStatus || !validStatuses.includes(newStatus)) {
          return Response.json(
            { error: "Invalid newStatus. Use: waiting, executing, paused, completed" },
            { status: 400 }
          );
        }
        if (newStatus === "executing" || newStatus === "paused") {
          return Response.json(
            { error: "请使用 start/pause 命令切换任务执行状态", code: "USE_ATOMIC_TASK_ACTION" },
            { status: 409 }
          );
        }
        if (newStatus === "waiting" && (task.status !== TaskStatus.waiting || task.startedAt != null)) {
          return Response.json(
            { error: "已开始任务不能通过 setStatus 回退为 waiting", code: "TASK_ALREADY_STARTED_CANNOT_SET_WAITING" },
            { status: 409 }
          );
        }

        // completed 走 completeTask 复用父任务恢复逻辑
        if (newStatus === "completed") {
          await completeTask(id);
          const updated = await loadTaskDetail(id);
          scheduleTaskMaintenance();
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
        const actor = await loadActorProfile(actorIdFrom(actorProfileId) ?? actorIdFrom(actorAssistantId));
        const canOperate = actor ? await canActorWriteTask(id, task, actor) : false;
        if (!canOperate) {
          return forbidden("只有任务相关人员可以延长任务", "ONLY_TASK_ACTOR_CAN_EXTEND_TASK");
        }
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
        const actor = await loadActorProfile(actorIdFrom(actorProfileId) ?? actorIdFrom(actorAssistantId));
        const canOperate = actor ? await canActorWriteTask(id, task, actor) : false;
        if (!canOperate) {
          return forbidden("只有任务相关人员可以修改备注", "ONLY_TASK_ACTOR_CAN_UPDATE_NOTE");
        }
        const { note } = body as { note: string };
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { note: note?.trim() || null },
        });
        return Response.json(updated);
      }

      case "updatePublisherFeedback": {
        const actor = await loadActorProfile(actorIdFrom(actorProfileId));
        if (!actor || actor.id !== task.photographerId) {
          return forbidden("只有任务发布摄影师可以反馈任务发布明细", "ONLY_PHOTOGRAPHER_CAN_UPDATE_FEEDBACK");
        }
        const { feedback } = body as { feedback?: string | null };
        const normalizedFeedback =
          feedback === "like" || feedback === "dislike" ? feedback : null;
        const updated = await prisma.bookingTask.update({
          where: { id },
          data: { publisherFeedback: normalizedFeedback },
        });
        return Response.json(updated);
      }

      case "cancelSpecifiedAssistant": {
        const actor = await loadActorProfile(actorIdFrom(actorProfileId));
        if (!actor || (actor.id !== task.photographerId && actor.role !== Role.admin)) {
          return forbidden("只有任务发布摄影师或管理员可以取消指定助理", "ONLY_OWNER_OR_ADMIN_CAN_CANCEL_SPECIFIED");
        }
        const specifiedTask = await prisma.bookingTask.findUnique({
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
            completionRegistration: {
              include: {
                assistant: { select: { id: true, name: true } },
              },
            },
          },
        });
        if (!specifiedTask) {
          return Response.json({ error: "Task not found" }, { status: 404 });
        }
        if (!specifiedTask.isSpecified || !specifiedTask.assistantId) {
          return Response.json({ error: "该任务不是指定助理任务", code: "TASK_NOT_SPECIFIED" }, { status: 409 });
        }
        const specifiedParticipant = specifiedTask.collaborators.find(
          (participant) => participant.assistantId === specifiedTask.assistantId
        );
        if (
          specifiedTask.status !== TaskStatus.waiting ||
          specifiedTask.startedAt != null ||
          specifiedParticipant?.startedAt != null ||
          specifiedParticipant?.status === "executing" ||
          specifiedParticipant?.status === "paused" ||
          specifiedParticipant?.status === "completed"
        ) {
          return Response.json(
            { error: "指定助理已开始过该任务，不能取消指定", code: "SPECIFIED_TASK_ALREADY_STARTED" },
            { status: 409 }
          );
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.taskCollaborator.updateMany({
            where: {
              taskId: id,
              assistantId: specifiedTask.assistantId!,
              role: "primary",
              status: { not: "left" },
            },
            data: { status: "left", leftAt: now },
          });
          await tx.bookingTask.update({
            where: { id },
            data: {
              isSpecified: false,
              assistantId: null,
              ironingStage: "none",
              ironingNotifiedAt: null,
              ironingStartedAt: null,
            },
          });
        });
        await syncProfileStatus();
        await runTaskMaintenance();
        const latest = await prisma.bookingTask.findUnique({
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
            completionRegistration: {
              include: {
                assistant: { select: { id: true, name: true } },
              },
            },
          },
        });
        return Response.json(latest);
      }

      case "transferPrimaryAssistant": {
        const { targetAssistantId } = body as { targetAssistantId?: string };
        const actorId = actorIdFrom(actorAssistantId);
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for transfer", code: "TRANSFER_ACTOR_REQUIRED" }, { status: 400 });
        }
        const actor = await loadActorProfile(actorId);
        if (!isAssistantActor(actor)) {
          return forbidden("只有任务助理可以发起移交", "ONLY_ASSISTANT_CAN_TRANSFER_TASK");
        }
        if (!targetAssistantId || typeof targetAssistantId !== "string") {
          return Response.json({ error: "targetAssistantId required for transfer", code: "TRANSFER_TARGET_REQUIRED" }, { status: 400 });
        }
        const result = await requestPrimaryAssistantTransfer(id, actorId, targetAssistantId);
        await runTaskMaintenance({ force: true });
        const latest = await prisma.bookingTask.findUnique({
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
            completionRegistration: {
              include: {
                assistant: { select: { id: true, name: true } },
              },
            },
            assistantTransferRequests: {
              where: { status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] } },
              orderBy: { requestedAt: "desc" },
              take: 3,
            },
          },
        });
        if (!latest) {
          return Response.json({ error: "Task not found after transfer" }, { status: 404 });
        }
        return Response.json({ ...latest, transferResult: result });
      }

      case "respondPrimaryAssistantTransfer": {
        const { accepted, responseMode } = body as { accepted?: boolean; responseMode?: "pause_and_go" | "after_complete" };
        const actorId = actorIdFrom(actorAssistantId);
        if (!actorId) {
          return Response.json({ error: "actorAssistantId required for transfer response", code: "TRANSFER_ACTOR_REQUIRED" }, { status: 400 });
        }
        const actor = await loadActorProfile(actorId);
        if (!isAssistantActor(actor)) {
          return forbidden("只有目标助理可以响应移交", "ONLY_ASSISTANT_CAN_RESPOND_TRANSFER");
        }
        if (typeof accepted !== "boolean") {
          return Response.json({ error: "accepted boolean required for transfer response", code: "TRANSFER_RESPONSE_REQUIRED" }, { status: 400 });
        }
        const result = await respondPrimaryAssistantTransfer(id, actorId, accepted, responseMode);
        await runTaskMaintenance({ force: true });
        const latest = await prisma.bookingTask.findUnique({
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
            completionRegistration: {
              include: {
                assistant: { select: { id: true, name: true } },
              },
            },
            assistantTransferRequests: {
              where: { status: { in: ["confirming", "pending", "pending_after_complete", "ready_to_takeover"] } },
              orderBy: { requestedAt: "desc" },
              take: 3,
            },
          },
        });
        if (!latest) {
          return Response.json({ error: "Task not found after transfer response" }, { status: 404 });
        }
        return Response.json({ ...latest, transferResult: result });
      }

      default:
        return Response.json(
          { error: "Invalid action. Use: start, pause, complete, extend, setStatus, updateNote, updatePublisherFeedback, cancelSpecifiedAssistant, transferPrimaryAssistant, respondPrimaryAssistantTransfer" },
          { status: 400 }
        );
    }
  } catch (error) {
    const isBusinessError = isTaskActionBusinessError(error);
    if (!isBusinessError) {
      console.error("[PATCH /api/tasks/[id]]", error);
    }
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
        error: isBusinessError
          ? error.message
          : "Failed to update task",
        ...(details ? { details } : {}),
      },
      { status: isBusinessError ? 409 : 500 }
    );
  }
}
