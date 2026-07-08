import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWorkbenchSyncMaintenance } from "@/lib/scheduler";
import { Prisma, PriorityUpgradeRequestStatus } from "@/generated/prisma/client";

const VISIBLE_PRIORITY_UPGRADE_REQUEST_STATUSES: PriorityUpgradeRequestStatus[] = [
  PriorityUpgradeRequestStatus.pending,
  PriorityUpgradeRequestStatus.approved,
];
const VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES = ["confirming", "pending", "pending_after_complete", "ready_to_takeover"];
const AREA_TASK_LIMIT = 500;
const SCOPED_TASK_LIMIT = 200;
const RELATED_CHANGE_ID_LIMIT = 1000;

const FULL_TASK_INCLUDE = {
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

const QUEUE_TASK_INCLUDE = {
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
  assistantTransferRequests: {
    where: { status: { in: VISIBLE_ASSISTANT_TRANSFER_REQUEST_STATUSES } },
    orderBy: { requestedAt: "desc" },
    take: 1,
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

function parseSince(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function taskDeltaWhere(
  baseWhere: Prisma.BookingTaskWhereInput,
  since: Date | null,
  relatedChangedTaskIds: string[],
): Prisma.BookingTaskWhereInput {
  if (!since) return baseWhere;
  const changedFilters: Prisma.BookingTaskWhereInput[] = [{ updatedAt: { gte: since } }];
  if (relatedChangedTaskIds.length > 0) {
    changedFilters.push({ id: { in: relatedChangedTaskIds } });
  }
  return {
    AND: [
      baseWhere,
      { OR: changedFilters },
    ],
  };
}

async function relatedChangedTaskIdsSince(
  since: Date | null,
  taskWhere: Prisma.BookingTaskWhereInput,
): Promise<{ ids: string[]; truncated: boolean }> {
  if (!since) return { ids: [], truncated: false };
  const take = RELATED_CHANGE_ID_LIMIT + 1;
  const [completionRegistrations, priorityRequests, transferRequests, collaborators] = await Promise.all([
    prisma.taskCompletionRegistration.findMany({
      where: {
        updatedAt: { gte: since },
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
    prisma.taskPriorityUpgradeRequest.findMany({
      where: {
        updatedAt: { gte: since },
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
    prisma.taskAssistantTransferRequest.findMany({
      where: {
        OR: [
          { requestedAt: { gte: since } },
          { targetConfirmedAt: { gte: since } },
          { completedAt: { gte: since } },
          { canceledAt: { gte: since } },
        ],
        task: { is: taskWhere },
      },
      select: { taskId: true, counterpartTaskId: true },
      take,
    }),
    prisma.taskCollaborator.findMany({
      where: {
        OR: [
          { joinedAt: { gte: since } },
          { startedAt: { gte: since } },
          { completedAt: { gte: since } },
          { leftAt: { gte: since } },
        ],
        task: { is: taskWhere },
      },
      select: { taskId: true },
      take,
    }),
  ]);

  const truncated = [
    completionRegistrations,
    priorityRequests,
    transferRequests,
    collaborators,
  ].some((rows) => rows.length > RELATED_CHANGE_ID_LIMIT);
  return {
    ids: uniqueIds([
      ...completionRegistrations.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
      ...priorityRequests.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
      ...transferRequests.slice(0, RELATED_CHANGE_ID_LIMIT).flatMap((row) => [row.taskId, row.counterpartTaskId]),
      ...collaborators.slice(0, RELATED_CHANGE_ID_LIMIT).map((row) => row.taskId),
    ]),
    truncated,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const profileId = searchParams.get("profileId");
    const role = searchParams.get("role");
    const buildingId = parsePositiveInt(searchParams.get("buildingId"));
    const view = searchParams.get("view") || role || "building";
    const forceFull = searchParams.get("full") === "1";
    const since = forceFull ? null : parseSince(searchParams.get("since"));
    const syncStartedAt = new Date();

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

    const areaTaskWhere: Prisma.BookingTaskWhereInput = {
      createdAt,
      AND: [areaWhere],
    };
    const scopedTaskWhere: Prisma.BookingTaskWhereInput = {
      createdAt,
      AND: taskFilters,
    };
    const [areaRelatedChanges, scopedRelatedChanges] = await Promise.all([
      relatedChangedTaskIdsSince(since, areaTaskWhere),
      relatedChangedTaskIdsSince(since, scopedTaskWhere),
    ]);
    const areaChangedWhere = taskDeltaWhere(areaTaskWhere, since, areaRelatedChanges.ids);
    const scopedChangedWhere = taskDeltaWhere(scopedTaskWhere, since, scopedRelatedChanges.ids);
    const taskOrderBy = [{ priority: "asc" as const }, { createdAt: "asc" as const }];
    const changedTaskOrderBy = since
      ? [{ updatedAt: "asc" as const }, { id: "asc" as const }]
      : taskOrderBy;

    const [profiles, areaTaskIds, areaTasks, taskIds, tasks, notices] = await Promise.all([
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
        where: areaTaskWhere,
        select: { id: true },
        orderBy: taskOrderBy,
        take: AREA_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: areaChangedWhere,
        include: QUEUE_TASK_INCLUDE,
        orderBy: changedTaskOrderBy,
        take: AREA_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: scopedTaskWhere,
        select: { id: true },
        orderBy: taskOrderBy,
        take: SCOPED_TASK_LIMIT + 1,
      }),
      prisma.bookingTask.findMany({
        where: scopedChangedWhere,
        include: FULL_TASK_INCLUDE,
        orderBy: changedTaskOrderBy,
        take: SCOPED_TASK_LIMIT + 1,
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
    const areaTaskIdsTruncated = areaTaskIds.length > AREA_TASK_LIMIT;
    const areaTasksTruncated = areaTasks.length > AREA_TASK_LIMIT;
    const scopedTaskIdsTruncated = taskIds.length > SCOPED_TASK_LIMIT;
    const scopedTasksTruncated = tasks.length > SCOPED_TASK_LIMIT;
    const visibleAreaTaskIds = areaTaskIds.slice(0, AREA_TASK_LIMIT);
    const visibleAreaTasks = areaTasks.slice(0, AREA_TASK_LIMIT);
    const visibleTaskIds = taskIds.slice(0, SCOPED_TASK_LIMIT);
    const visibleTasks = tasks.slice(0, SCOPED_TASK_LIMIT);
    const syncTruncated = Boolean(since) && (
      areaTasksTruncated ||
      scopedTasksTruncated ||
      areaRelatedChanges.truncated ||
      scopedRelatedChanges.truncated
    );

    return Response.json({
      serverTime: new Date().toISOString(),
      syncMode: since ? "delta" : "full",
      syncToken: syncStartedAt.toISOString(),
      syncTruncated,
      nextPollMs: 3000,
      maintenance,
      profiles,
      tasks: visibleTasks,
      taskIds: visibleTaskIds.map((task) => task.id),
      publicQueue: visibleAreaTasks,
      publicQueueIds: visibleAreaTaskIds.map((task) => task.id),
      publicQueueSummary: {
        total: visibleAreaTaskIds.length,
        changed: visibleAreaTasks.length,
        idListTruncated: areaTaskIdsTruncated,
        taskListTruncated: areaTasksTruncated,
        scopedIdListTruncated: scopedTaskIdsTruncated,
        scopedTaskListTruncated: scopedTasksTruncated,
      },
      notices,
    });
  } catch (error) {
    console.error("[GET /api/workbench/sync]", error);
    return Response.json({ error: "Failed to sync workbench" }, { status: 500 });
  }
}
