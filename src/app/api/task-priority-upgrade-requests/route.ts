import { NextRequest } from "next/server";
import { Prisma, PriorityUpgradeRequestStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const STATUS_VALUES = new Set(["pending", "approved", "rejected", "all"]);

function parsePositiveIntParam(value: string | null, name: string): { value?: number; error?: Response } {
  if (value == null || value.trim() === "") return {};
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: Response.json({ error: `${name} must be a positive integer`, code: "INVALID_INTEGER" }, { status: 400 }) };
  }
  return { value: parsed };
}

function parseDateParam(value: string | null, name: string, endOfDay = false): { value?: Date; error?: Response } {
  if (value == null || value.trim() === "") return {};
  const trimmed = value.trim();
  let date: Date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
    date = endOfDay
      ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
      : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  } else {
    date = new Date(trimmed);
  }

  if (Number.isNaN(date.getTime())) {
    return { error: Response.json({ error: `${name} must be a valid date`, code: "INVALID_DATE" }, { status: 400 }) };
  }
  return { value: date };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? "pending";
    if (!STATUS_VALUES.has(status)) {
      return Response.json({ error: "status must be pending, approved, rejected, or all" }, { status: 400 });
    }

    const start = parseDateParam(searchParams.get("start"), "start");
    if (start.error) return start.error;
    const end = parseDateParam(searchParams.get("end"), "end", true);
    if (end.error) return end.error;
    if (start.value && end.value && start.value > end.value) {
      return Response.json({ error: "start must be before end", code: "INVALID_DATE_RANGE" }, { status: 400 });
    }

    const buildingId = parsePositiveIntParam(searchParams.get("buildingId"), "buildingId");
    if (buildingId.error) return buildingId.error;
    const department = searchParams.get("department")?.trim();

    const where: Prisma.TaskPriorityUpgradeRequestWhereInput = {};
    const andFilters: Prisma.TaskPriorityUpgradeRequestWhereInput[] = [];
    if (status !== "all") where.status = status as PriorityUpgradeRequestStatus;
    if (start.value || end.value) {
      const dateRange = {
        ...(start.value ? { gte: start.value } : {}),
        ...(end.value ? { lte: end.value } : {}),
      };
      if (status === "approved") {
        where.reviewedAt = dateRange;
      } else {
        where.createdAt = dateRange;
      }
    }
    if (department) {
      andFilters.push({ task: { photographer: { department } } });
    }
    if (buildingId.value != null) {
      andFilters.push({
        task: {
          OR: [
            { locationBuildingId: buildingId.value },
            { locationBuildingId: null, photographer: { buildingId: buildingId.value } },
          ],
        },
      });
    }
    if (andFilters.length > 0) where.AND = andFilters;

    const requests = await prisma.taskPriorityUpgradeRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, department: true, group: true, buildingId: true } },
        reviewedBy: { select: { id: true, name: true, department: true, group: true, buildingId: true } },
        task: {
          include: {
            photographer: { select: { id: true, name: true, currentRoom: true, department: true, group: true, buildingId: true } },
            assistant: { select: { id: true, name: true, currentRoom: true, department: true, group: true, buildingId: true } },
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
          },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return Response.json(requests);
  } catch (error) {
    console.error("[GET /api/task-priority-upgrade-requests]", error);
    return Response.json({ error: "Failed to fetch priority upgrade requests" }, { status: 500 });
  }
}
