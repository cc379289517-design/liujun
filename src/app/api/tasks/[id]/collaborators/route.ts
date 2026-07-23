import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import {
  getCollaborationAvailabilityForBuilding,
  syncProfileStatus,
  syncTaskAggregateFromParticipants,
} from "@/lib/scheduler";
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

const INVITATION_INCLUDE = {
  inviterProfile: { select: { id: true, name: true, role: true } },
  targetAssistant: {
    select: { id: true, name: true, avatar: true, buildingId: true, activeBuildingId: true },
  },
} as const;

/**
 * POST /api/tasks/[id]/collaborators
 * 同步已接受协作者与待确认邀请。新增人员只有在本人确认后才会成为协作者。
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const actorProfileId = typeof body.actorProfileId === "string" ? body.actorProfileId.trim() : "";
    const actorAssistantId = typeof body.actorAssistantId === "string" ? body.actorAssistantId.trim() : null;
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    const requestedIds: string[] = Array.isArray(body.assistantIds)
      ? Array.from(
          new Set<string>(
            body.assistantIds.filter(
              (value: unknown): value is string => typeof value === "string" && value.length > 0
            )
          )
        )
      : [];

    if (!actorProfileId) {
      return Response.json({ error: "actorProfileId is required" }, { status: 400 });
    }
    if (actorAssistantId && actorAssistantId !== actorProfileId) {
      return Response.json({ error: "actorAssistantId must match actorProfileId" }, { status: 403 });
    }

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        photographer: { select: { buildingId: true } },
        collaborators: {
          where: { status: { in: [...ACTIVE_PARTICIPANT_STATUSES] } },
          select: { assistantId: true, role: true, status: true },
        },
        collaborationInvitations: {
          where: { status: "pending" },
          select: { id: true, targetAssistantId: true },
        },
      },
    });
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    if (task.status === TaskStatus.completed) {
      return Response.json({ error: "Completed task cannot add collaborators" }, { status: 400 });
    }

    const isPhotographer = task.photographerId === actorProfileId && !actorAssistantId;
    const primary = task.collaborators.find(
      (participant) => participant.role === "primary" && participant.assistantId === actorProfileId
    );
    const isPrimaryAssistant =
      actorAssistantId === actorProfileId &&
      task.assistantId === actorProfileId &&
      (!primary || ACTIVE_PARTICIPANT_STATUSES.includes(primary.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]));
    if (!isPhotographer && !isPrimaryAssistant) {
      return Response.json(
        { error: "Only the task photographer or primary assistant can manage collaborators" },
        { status: 403 }
      );
    }

    const taskBuildingId = task.locationBuildingId ?? task.photographer.buildingId;
    const currentHelperIds = task.collaborators
      .filter((participant) => participant.role === "helper")
      .map((participant) => participant.assistantId);
    const pendingTargetIds = task.collaborationInvitations.map((invitation) => invitation.targetAssistantId);
    const managedIds = new Set([...currentHelperIds, ...pendingTargetIds]);
    const desiredIds = requestedIds.filter((assistantId) => assistantId !== task.assistantId);
    const addedIds = desiredIds.filter((assistantId) => !managedIds.has(assistantId));
    const leavingIds = currentHelperIds.filter((assistantId) => !desiredIds.includes(assistantId));
    const canceledTargetIds = pendingTargetIds.filter((assistantId) => !desiredIds.includes(assistantId));

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
    }

    const maxConfig = await prisma.systemConfig.findUnique({
      where: { key: collaborationMaxParticipantsConfigKey(taskBuildingId) },
      select: { value: true },
    });
    const maxParticipants = parseCollaborationMaxParticipants(maxConfig?.value);
    const primaryParticipantCount = task.assistantId ? 1 : 0;
    if (addedIds.length > 0 && primaryParticipantCount + desiredIds.length > maxParticipants) {
      return Response.json(
        { error: `超过多人协作 ${maxParticipants} 人上限`, maxParticipants },
        { status: 400 }
      );
    }

    if (addedIds.length > 0) {
      const candidates = await prisma.profile.findMany({
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
          assignedTasks: { none: { status: { in: [...ACTIVE_TASK_STATUSES] } } },
          collaboratedTasks: {
            none: {
              status: { in: [...ACTIVE_PARTICIPANT_STATUSES] },
              task: { status: { in: [...ACTIVE_TASK_STATUSES] } },
            },
          },
        },
        select: { id: true },
      });
      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
      const unavailableAssistantIds = addedIds.filter((assistantId) => !candidateIds.has(assistantId));
      if (unavailableAssistantIds.length > 0) {
        return Response.json(
          { error: "部分助理当前不满足协作邀请条件", unavailableAssistantIds },
          { status: 409 }
        );
      }
    }

    const now = new Date();
    const changedParticipants = leavingIds.length > 0;
    const createdInvitations = await prisma.$transaction(async (tx) => {
      if (task.assistantId) {
        await tx.taskCollaborator.upsert({
          where: { taskId_assistantId: { taskId: id, assistantId: task.assistantId } },
          create: {
            taskId: id,
            assistantId: task.assistantId,
            role: "primary",
            status: task.status === TaskStatus.paused ? "paused" : task.status,
          },
          update: { role: "primary", leftAt: null },
        });
      }

      if (leavingIds.length > 0) {
        await tx.taskCollaborator.updateMany({
          where: {
            taskId: id,
            assistantId: { in: leavingIds },
            role: "helper",
            status: { in: [...ACTIVE_PARTICIPANT_STATUSES] },
          },
          data: { status: "left", leftAt: now, workSegmentStartedAt: null },
        });
      }
      if (canceledTargetIds.length > 0) {
        await tx.taskCollaborationInvitation.updateMany({
          where: { taskId: id, targetAssistantId: { in: canceledTargetIds }, status: "pending" },
          data: { status: "canceled", reason: "inviter_removed", canceledAt: now },
        });
      }

      const invitations = [];
      for (const targetAssistantId of addedIds) {
        invitations.push(
          await tx.taskCollaborationInvitation.upsert({
            where: { taskId_targetAssistantId: { taskId: id, targetAssistantId } },
            create: {
              taskId: id,
              inviterProfileId: actorProfileId,
              targetAssistantId,
              status: "pending",
              reason,
            },
            update: {
              inviterProfileId: actorProfileId,
              status: "pending",
              reason,
              requestedAt: now,
              respondedAt: null,
              canceledAt: null,
            },
            include: INVITATION_INCLUDE,
          })
        );
      }
      return invitations;
    });

    if (changedParticipants) {
      await syncTaskAggregateFromParticipants(id);
      await syncProfileStatus();
    }

    const [updated, invitations] = await Promise.all([
      prisma.bookingTask.findUnique({ where: { id }, include: TASK_WITH_COLLABORATORS_INCLUDE }),
      prisma.taskCollaborationInvitation.findMany({
        where: { taskId: id, status: "pending" },
        include: INVITATION_INCLUDE,
        orderBy: { requestedAt: "asc" },
      }),
    ]);
    return Response.json({
      task: updated,
      invitation: createdInvitations.at(-1) ?? null,
      invitations,
    });
  } catch (error) {
    console.error("[POST /api/tasks/[id]/collaborators]", error);
    const details = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;
    return Response.json(
      { error: "Failed to update collaborators", ...(details ? { details } : {}) },
      { status: 500 }
    );
  }
}
