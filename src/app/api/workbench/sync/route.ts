import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWorkbenchSyncMaintenance } from "@/lib/scheduler";
import { PriorityUpgradeRequestStatus } from "@/generated/prisma/client";

const VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES: PriorityUpgradeRequestStatus[] = [
  PriorityUpgradeRequestStatus.pending,
  PriorityUpgradeRequestStatus.approved,
];
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover"];

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

function parsePositiveInt(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function taskBuildingWhere(buildingId: number) {
  return {
    OR: [
      { locationBuildingId: buildingId },
      { locationBuildingId: null, photographer: { buildingId } },
    ],
  };
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function isAssistantRole(role: string | null): boolean {
  return role === "assistant" || role === "assistant_leader";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const profileId = searchParams.get("profileId");
    const role = searchParams.get("role");
    const buildingId = parsePositiveInt(searchParams.get("buildingId"));
    const view = searchParams.get("view") || role || "building";

    if (!buildingId) {
      return Response.json({ error: "buildingId is required" }, { status: 400 });
    }

    const maintenance = await runWorkbenchSyncMaintenance();
    const createdAt = todayRange();
    const areaWhere = taskBuildingWhere(buildingId);

    const taskFilters: Record<string, unknown>[] = [];
    if (profileId && (view === "photographer" || role === "photographer")) {
      taskFilters.push({ photographerId: profileId });
    } else if (profileId && (isAssistantRole(view) || isAssistantRole(role))) {
      taskFilters.push({
        OR: [
          { assistantId: profileId },
          { collaborators: { some: { assistantId: profileId, status: { not: "left" } } } },
          {
            assistantTransferRequests: {
              some: {
                targetAssistantId: profileId,
                status: { in: ["confirming", "pending_after_complete", "ready_to_takeover"] },
              },
            },
          },
          {
            assistantTransferRequests: {
              some: {
                fromAssistantId: profileId,
                status: "pending_after_complete",
              },
            },
          },
        ],
      });
    } else {
      taskFilters.push(areaWhere);
    }

    const [profiles, areaTasks, tasks, notices] = await Promise.all([
      prisma.profile.findMany({
        where: {
          role: { in: ["assistant", "assistant_leader"] },
          OR: [
            { activeBuildingId: buildingId },
            { activeBuildingId: null, buildingId },
          ],
        },
        include: {
          building: { select: { id: true, name: true, extraVenues: true } },
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      prisma.bookingTask.findMany({
        where: {
          createdAt,
          AND: [areaWhere],
        },
        include: TASK_INCLUDE,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: 500,
      }),
      prisma.bookingTask.findMany({
        where: {
          createdAt,
          AND: taskFilters,
        },
        include: TASK_INCLUDE,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: 200,
      }),
      profileId && isAssistantRole(role)
        ? prisma.standbyReassignmentNotice.findMany({
            where: {
              OR: [
                { newAssistantId: profileId, newAssistantAcknowledgedAt: null },
                { oldAssistantId: profileId, oldAssistantAcknowledgedAt: null },
              ],
            },
            include: {
              task: {
                select: {
                  id: true,
                  note: true,
                  roomNumber: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    return Response.json({
      serverTime: new Date().toISOString(),
      syncToken: new Date().toISOString(),
      nextPollMs: 3000,
      maintenance,
      profiles,
      tasks,
      publicQueue: areaTasks,
      notices,
    });
  } catch (error) {
    console.error("[GET /api/workbench/sync]", error);
    return Response.json({ error: "Failed to sync workbench" }, { status: 500 });
  }
}
