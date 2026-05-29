import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import { isCollaborationEnabledForBuilding, syncProfileStatus, syncTaskAggregateFromParticipants } from "@/lib/scheduler";
import {
  collaborationMaxParticipantsConfigKey,
  parseCollaborationMaxParticipants,
  taskCategoryAllowsCollaboration,
} from "@/lib/collaborationRules";

type RouteContext = { params: Promise<{ id: string }> };

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
    const requestedIds: string[] = Array.isArray(body.assistantIds)
      ? Array.from(new Set<string>(body.assistantIds.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)))
      : [];

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        photographer: { select: { buildingId: true } },
        category: { select: { minDuration: true, maxDuration: true } },
        collaborators: { where: { role: "helper", status: { not: "left" } }, select: { assistantId: true } },
      },
    });
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    if (task.status === TaskStatus.completed) {
      return Response.json({ error: "Completed task cannot add collaborators" }, { status: 400 });
    }

    const assistantIds = requestedIds.filter((assistantId) => assistantId !== task.assistantId);
    const primaryParticipantCount = task.assistantId ? 1 : 0;
    if (assistantIds.length > 0) {
      if (!taskCategoryAllowsCollaboration(task.category)) {
        return Response.json({ error: "Only tasks over 30 minutes can add collaborators" }, { status: 400 });
      }
      const enabled = await isCollaborationEnabledForBuilding(task.photographer.buildingId);
      if (!enabled) {
        return Response.json({ error: "Collaboration disabled for this building" }, { status: 400 });
      }
      const maxConfig = await prisma.systemConfig.findUnique({
        where: { key: collaborationMaxParticipantsConfigKey(task.photographer.buildingId) },
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

    const candidates = assistantIds.length > 0
      ? await prisma.profile.findMany({
          where: {
            id: { in: assistantIds },
            role: { in: ["assistant", "assistant_leader"] },
            onlineStatus: "online",
            subStatus: null,
            buildingId: task.photographer.buildingId,
          },
          select: { id: true },
        })
      : [];
    const validIds = candidates.map((p) => p.id);
    if (assistantIds.length > 0) {
      const maxConfig = await prisma.systemConfig.findUnique({
        where: { key: collaborationMaxParticipantsConfigKey(task.photographer.buildingId) },
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

    const currentIds = task.collaborators.map((c) => c.assistantId);
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
