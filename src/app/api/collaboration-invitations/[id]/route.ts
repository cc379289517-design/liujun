import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { syncProfileStatus, syncTaskAggregateFromParticipants } from "@/lib/scheduler";
import {
  collaborationMaxParticipantsConfigKey,
  parseCollaborationMaxParticipants,
} from "@/lib/collaborationRules";

type RouteContext = { params: Promise<{ id: string }> };

const ACTIVE_TASK_STATUSES = [TaskStatus.waiting, TaskStatus.executing, TaskStatus.paused] as const;
const ACTIVE_PARTICIPANT_STATUSES = ["waiting", "executing", "paused"] as const;

const INVITATION_INCLUDE = {
  inviterProfile: { select: { id: true, name: true, role: true } },
  targetAssistant: {
    select: {
      id: true,
      name: true,
      avatar: true,
      status: true,
      onlineStatus: true,
      buildingId: true,
      activeBuildingId: true,
    },
  },
  task: {
    include: {
      photographer: { select: { id: true, name: true, buildingId: true } },
      assistant: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, priorityLevel: true, estDuration: true } },
      collaborators: {
        where: { status: { not: "left" } },
        include: { assistant: { select: { id: true, name: true, avatar: true } } },
      },
    },
  },
} as const;

async function expireInvitation(
  tx: Prisma.TransactionClient,
  invitationId: string,
  reason: string,
  now: Date
) {
  await tx.taskCollaborationInvitation.update({
    where: { id: invitationId },
    data: { status: "expired", reason, respondedAt: now },
  });
  const invitation = await tx.taskCollaborationInvitation.findUnique({
    where: { id: invitationId },
    include: INVITATION_INCLUDE,
  });
  return { ok: false as const, status: 409, error: reason, invitation };
}

/**
 * PATCH /api/collaboration-invitations/[id]
 * 目标助理接受或拒绝协作邀请；接受前会重新校验全部资格。
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const actorAssistantId = typeof body.actorAssistantId === "string" ? body.actorAssistantId.trim() : "";
    const accepted = body.accepted;
    if (!actorAssistantId || typeof accepted !== "boolean") {
      return Response.json(
        { error: "actorAssistantId and boolean accepted are required" },
        { status: 400 }
      );
    }

    const existing = await prisma.taskCollaborationInvitation.findUnique({
      where: { id },
      select: { targetAssistantId: true, status: true },
    });
    if (!existing) return Response.json({ error: "Invitation not found" }, { status: 404 });
    if (existing.targetAssistantId !== actorAssistantId) {
      return Response.json({ error: "Only the invited assistant can respond" }, { status: 403 });
    }
    if (existing.status !== "pending") {
      return Response.json({ error: "Invitation is no longer pending" }, { status: 409 });
    }

    const now = new Date();
    if (!accepted) {
      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.taskCollaborationInvitation.updateMany({
          where: { id, targetAssistantId: actorAssistantId, status: "pending" },
          data: { status: "rejected", respondedAt: now },
        });
        if (changed.count === 0) return null;
        return tx.taskCollaborationInvitation.findUnique({
          where: { id },
          include: INVITATION_INCLUDE,
        });
      });
      if (!result) {
        return Response.json({ error: "Invitation is no longer pending" }, { status: 409 });
      }
      return Response.json({ invitation: result });
    }

    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.taskCollaborationInvitation.findUnique({
        where: { id },
        include: {
          task: {
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
          },
        },
      });
      if (!invitation || invitation.status !== "pending") {
        return { ok: false as const, status: 409, error: "Invitation is no longer pending", invitation };
      }
      if (invitation.targetAssistantId !== actorAssistantId) {
        return { ok: false as const, status: 403, error: "Only the invited assistant can respond", invitation };
      }

      const task = invitation.task;
      if (task.status === TaskStatus.completed) {
        return expireInvitation(tx, id, "任务已完成，协作邀请已失效", now);
      }
      const inviterIsPhotographer = task.photographerId === invitation.inviterProfileId;
      const inviterPrimary = task.collaborators.find(
        (participant) =>
          participant.role === "primary" && participant.assistantId === invitation.inviterProfileId
      );
      const inviterIsPrimary =
        task.assistantId === invitation.inviterProfileId &&
        (!inviterPrimary ||
          ACTIVE_PARTICIPANT_STATUSES.includes(
            inviterPrimary.status as typeof ACTIVE_PARTICIPANT_STATUSES[number]
          ));
      if (!inviterIsPhotographer && !inviterIsPrimary) {
        return expireInvitation(tx, id, "邀请发起人已无权管理该任务，邀请已失效", now);
      }

      const taskBuildingId = task.locationBuildingId ?? task.photographer.buildingId;
      const target = await tx.profile.findFirst({
        where: {
          id: actorAssistantId,
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
      if (!target || task.assistantId === actorAssistantId) {
        return expireInvitation(tx, id, "当前已不满足协作条件，邀请已失效", now);
      }

      const maxConfig = await tx.systemConfig.findUnique({
        where: { key: collaborationMaxParticipantsConfigKey(taskBuildingId) },
        select: { value: true },
      });
      const maxParticipants = parseCollaborationMaxParticipants(maxConfig?.value);
      const activeHelperIds = task.collaborators
        .filter((participant) => participant.role === "helper")
        .map((participant) => participant.assistantId);
      const pendingTargetIds = task.collaborationInvitations.map(
        (pendingInvitation) => pendingInvitation.targetAssistantId
      );
      const participantIds = new Set([...activeHelperIds, ...pendingTargetIds]);
      const primaryParticipantCount = task.assistantId ? 1 : 0;
      if (primaryParticipantCount + participantIds.size > maxParticipants) {
        return expireInvitation(tx, id, `超过多人协作 ${maxParticipants} 人上限，邀请已失效`, now);
      }

      await tx.taskCollaborator.upsert({
        where: { taskId_assistantId: { taskId: task.id, assistantId: actorAssistantId } },
        create: {
          taskId: task.id,
          assistantId: actorAssistantId,
          role: "helper",
          status: "waiting",
        },
        update: {
          role: "helper",
          status: "waiting",
          joinedAt: now,
          leftAt: null,
          startedAt: null,
          completedAt: null,
          workSegmentStartedAt: null,
        },
      });
      await tx.taskCollaborationInvitation.update({
        where: { id },
        data: { status: "accepted", respondedAt: now, canceledAt: null },
      });
      const updatedInvitation = await tx.taskCollaborationInvitation.findUnique({
        where: { id },
        include: INVITATION_INCLUDE,
      });
      return { ok: true as const, taskId: task.id, invitation: updatedInvitation };
    });

    if (!result.ok) {
      return Response.json(
        { error: result.error, invitation: result.invitation ?? null },
        { status: result.status }
      );
    }

    await syncTaskAggregateFromParticipants(result.taskId);
    await syncProfileStatus();
    const task = await prisma.bookingTask.findUnique({
      where: { id: result.taskId },
      include: {
        photographer: { select: { id: true, name: true, buildingId: true } },
        assistant: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, priorityLevel: true, estDuration: true } },
        collaborators: {
          where: { status: { not: "left" } },
          include: { assistant: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });
    return Response.json({ task, invitation: result.invitation });
  } catch (error) {
    console.error("[PATCH /api/collaboration-invitations/[id]]", error);
    const details = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;
    return Response.json(
      { error: "Failed to respond to collaboration invitation", ...(details ? { details } : {}) },
      { status: 500 }
    );
  }
}
