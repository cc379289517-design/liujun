import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import { getCollaborationAvailabilityForBuilding, syncProfileStatus, syncTaskAggregateFromParticipants } from "@/lib/scheduler";
import {
  collaborationMaxParticipantsConfigKey,
  parseCollaborationMaxParticipants,
} from "@/lib/collaborationRules";

type RouteContext = { params: Promise<{ id: string }> };
const ACTIVE_TASK_STATUSES = [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] as const;
const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"] as const;

const TASK_WITH_COLLABORATORS_INCLUDE = {
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
 * POST /api/tasks/[id]/collaborators
 * 用传入的 assistantIds 同步当前任务的协作助理。
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const actorAssistantId = typeof body.actorAssistantId === "string" ? body.actorAssistantId : null;
    const requestedIds: string[] = Array.isArray(body.assistantIds)
      ? Array.from(new Set<string>(body.assistantIds.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)))
      : [];

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        photographer: { select: { buildingId: true } },
        category: { select: { minDuration: true, maxDuration: true } },
        collaborators: { where: { status: { not: "left" } }, select: { assistantId: true, role: true, status: true } },
      },
    });
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    if (task.status === TaskStatus.completed) {
      return Response.json({ error: "Completed task cannot add collaborators" }, { status: 400 });
    }
    if (actorAssistantId) {
      const primary = task.collaborators.find((c) => c.role === "primary" && c.assistantId === actorAssistantId);
      const isActivePrimary =
        task.assistantId === actorAssistantId &&
        (!primary || ACTIVE_PARTICIPANT_STATUSES.includes(primary.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]));
      if (!isActivePrimary) {
        return Response.json({ error: "Only the primary assistant can manage collaborators" }, { status: 403 });
      }
    }
    const taskBuildingId = task.locationBuildingId ?? task.photographer.buildingId;

    const currentIds = task.collaborators.filter((c) => c.role === "helper").map((c) => c.assistantId);
    const assistantIds = requestedIds.filter((assistantId) => assistantId !== task.assistantId);
    const addedIds = assistantIds.filter((assistantId) => !currentIds.includes(assistantId));
    const primaryParticipantCount = task.assistantId ? 1 : 0;
    if (addedIds.length > 0) {
      const availability = await getCollaborationAvailabilityForBuilding(taskBuildingId);
      if (!availability.enabled) {
        return Response.json(
          {
            error: availability.autoClosed
              ? `当前区域任务队列已达到 ${availability.queueLimit} 条，已自动关闭新增多人协作`
              : "Collaboration disabled for this building",
            code: availability.autoClosed
              ? "COLLABORATION_AUTO_CLOSED_BY_QUEUE"
              : "COLLABORATION_DISABLED_FOR_BUILDING",
            queueCount: availability.queueCount,
            queueLimit: availability.queueLimit,
          },
          { status: 400 }
        );
      }
      const maxConfig = await prisma.systemConfig.findUnique({
        where: { key: collaborationMaxParticipantsConfigKey(taskBuildingId) },
        select: { value: true },
      });
      const maxParticipants = parseCollaborationMaxParticipants(maxConfig?.value);
      if (primaryParticipantCount + assistantIds.length > maxParticipants) {
        return Response.json(
          { error: `超过多人协作 ${maxParticipants} 人上限`, maxParticipants },
          { status: 400 }
        );
      }
    }

    const retainedCurrentIds = assistantIds.filter((assistantId) => currentIds.includes(assistantId));
    const candidates = addedIds.length > 0
      ? await prisma.profile.findMany({
          where: {
            id: { in: addedIds },
            role: { in: ["assistant", "assistant_leader"] },
            status: "idle",
            onlineStatus: "online",
            subStatus: null,
            OR: [
              { activeBuildingId: taskBuildingId },
              { activeBuildingId: null, buildingId: taskBuildingId },
            ],
            assignedTasks: {
              none: { status: { in: [...ACTIVE_TASK_STATUSES] } },
            },
            collaboratedTasks: {
              none: {
                status: { in: [...ACTIVE_PARTICIPANT_STATUSES] },
                task: { status: { in: [...ACTIVE_TASK_STATUSES] } },
              },
            },
          },
          select: { id: true },
        })
      : [];
    const validIds = Array.from(new Set([...retainedCurrentIds, ...candidates.map((p) => p.id)]));
    if (addedIds.length > 0) {
      const maxConfig = await prisma.systemConfig.findUnique({
        where: { key: collaborationMaxParticipantsConfigKey(taskBuildingId) },
        select: { value: true },
      });
      const maxParticipants = parseCollaborationMaxParticipants(maxConfig?.value);
      if (primaryParticipantCount + validIds.length > maxParticipants) {
        return Response.json(
          { error: `超过多人协作 ${maxParticipants} 人上限`, maxParticipants },
          { status: 400 }
        );
      }
    }

    const leavingIds = currentIds.filter((assistantId) => !validIds.includes(assistantId));

    await prisma.$transaction(async (tx) => {
      if (task.assistantId) {
        await tx.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: id, assistantId: task.assistantId } },
          create: { taskId: id, assistantId: task.assistantId, role: "primary", status: task.status === TaskStatus.paused ? "paused" : task.status },
          update: { role: "primary", leftAt: null },
        });
      }

      if (leavingIds.length > 0) {
        await tx.taskCollaborator.updateMany({
          where: { taskId: id, assistantId: { in: leavingIds }, role: "helper", status: { not: "left" } },
          data: { status: "left", leftAt: new Date() },
        });
      }

      for (const assistantId of validIds) {
        const existing = await tx.taskCollaborator.findUnique({
          where: { taskId_assistantId: { taskId: id, assistantId } },
          select: { status: true },
        });
        await tx.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: id, assistantId } },
          create: { taskId: id, assistantId, role: "helper", status: "waiting" },
          update: {
            role: "helper",
            status: existing && existing.status !== "left" ? existing.status : "waiting",
            leftAt: null,
          },
        });
      }
    });

    await syncTaskAggregateFromParticipants(id);
    await syncProfileStatus();

    const updated = await prisma.bookingTask.findUnique({
      where: { id },
      include: TASK_WITH_COLLABORATORS_INCLUDE,
    });
    return Response.json(updated);
  } catch (error) {
    console.error("[POST /api/tasks/[id]/collaborators]", error);
    const details = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;
    return Response.json({ error: "Failed to update collaborators", ...(details ? { details } : {}) }, { status: 500 });
  }
}
