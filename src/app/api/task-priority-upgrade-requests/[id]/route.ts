import { NextRequest } from "next/server";
import { PriorityUpgradeRequestStatus, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runTaskMaintenance } from "@/lib/scheduler";

type RouteContext = { params: Promise<{ id: string }> };

function parsePriority(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "approve" || body.action === "reject" ? body.action : null;
    const reviewerId = typeof body.reviewerId === "string" && body.reviewerId.trim() ? body.reviewerId.trim() : null;
    const reviewNote = typeof body.reviewNote === "string" && body.reviewNote.trim() ? body.reviewNote.trim() : null;

    if (!action) {
      return Response.json({ error: "action must be approve or reject" }, { status: 400 });
    }

    let reviewer: { id: string; role: Role } | null = null;
    if (reviewerId) {
      reviewer = await prisma.profile.findUnique({
        where: { id: reviewerId },
        select: { id: true, role: true },
      });
      if (!reviewer || (reviewer.role !== Role.admin && reviewer.role !== Role.assistant_leader)) {
        return Response.json({ error: "只有管理或助理组长可以审批提权申请" }, { status: 403 });
      }
    }

    const requestRow = await prisma.taskPriorityUpgradeRequest.findUnique({
      where: { id },
      include: { task: true },
    });
    if (!requestRow) {
      return Response.json({ error: "Priority upgrade request not found" }, { status: 404 });
    }
    if (requestRow.status !== PriorityUpgradeRequestStatus.pending) {
      return Response.json({ error: "该申请已处理，不能重复审批" }, { status: 409 });
    }

    if (action === "reject") {
      const rejected = await prisma.taskPriorityUpgradeRequest.update({
        where: { id },
        data: {
          status: PriorityUpgradeRequestStatus.rejected,
          reviewedById: reviewer?.id ?? null,
          reviewedAt: new Date(),
          reviewNote,
        },
      });
      return Response.json(rejected);
    }

    const approvedPriority = parsePriority(body.approvedPriority) ?? requestRow.targetPriority;
    if (approvedPriority < 1 || approvedPriority >= requestRow.task.priority) {
      return Response.json({ error: `批准优先级必须高于当前 P${requestRow.task.priority}` }, { status: 400 });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.taskPriorityUpgradeRequest.update({
        where: { id },
        data: {
          status: PriorityUpgradeRequestStatus.approved,
          approvedPriority,
          reviewedById: reviewer?.id ?? null,
          reviewedAt: now,
          reviewNote,
        },
      });
      const updatedTask = await tx.bookingTask.update({
        where: { id: requestRow.taskId },
        data: {
          priority: approvedPriority,
          escalatedAt: now,
          escalatedFromPriority: requestRow.task.escalatedFromPriority ?? requestRow.task.priority,
        },
      });
      return { request: updatedRequest, task: updatedTask };
    });

    await runTaskMaintenance({ force: true });
    return Response.json(result);
  } catch (error) {
    console.error("[PATCH /api/task-priority-upgrade-requests/[id]]", error);
    return Response.json({ error: "Failed to review priority upgrade request" }, { status: 500 });
  }
}
