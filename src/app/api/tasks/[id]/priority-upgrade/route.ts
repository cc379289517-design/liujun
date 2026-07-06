import { NextRequest } from "next/server";
import { PriorityUpgradeRequestStatus, Role, TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canPriorityRequestByConfig,
  priorityUpgradeRequestRuleForBuilding,
  priorityUpgradeRangeLabel,
} from "@/lib/priorityUpgradeRules";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const requesterId = typeof body.requesterId === "string" ? body.requesterId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";

    if (!requesterId) {
      return Response.json({ error: "requesterId required" }, { status: 400 });
    }
    if (!sku) {
      return Response.json({ error: "SKU 必填", code: "SKU_REQUIRED" }, { status: 400 });
    }
    if (!reason) {
      return Response.json({ error: "申请理由必填" }, { status: 400 });
    }

    const task = await prisma.bookingTask.findUnique({
      where: { id },
      include: {
        photographer: { select: { id: true, role: true, buildingId: true } },
      },
    });
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.photographerId !== requesterId || task.photographer.role !== Role.photographer) {
      return Response.json({ error: "只能由任务摄影师本人申请提权" }, { status: 403 });
    }
    if (task.status === TaskStatus.executing || task.status === TaskStatus.completed) {
      return Response.json({ error: "进行中或已完成任务不支持提权申请" }, { status: 409 });
    }
    if (task.priority <= 1) {
      return Response.json({ error: "当前任务已经是 P1，无需提权" }, { status: 409 });
    }

    const configRows = await prisma.systemConfig.findMany({ select: { key: true, value: true } });
    const config = Object.fromEntries(configRows.map((row) => [row.key, row.value]));
    const taskBuildingId = task.locationBuildingId ?? task.photographer.buildingId;
    const buildingRule = priorityUpgradeRequestRuleForBuilding(config, taskBuildingId);
    if (!buildingRule.enabled) {
      return Response.json(
        { error: "提权申请入口已关闭", code: "PRIORITY_UPGRADE_DISABLED" },
        { status: 403 },
      );
    }

    if (!canPriorityRequestByConfig(task.priority, buildingRule.minPriority)) {
      return Response.json(
        { error: `当前仅开放 ${priorityUpgradeRangeLabel(buildingRule.minPriority)} 任务申请提权` },
        { status: 409 },
      );
    }

    const pending = await prisma.taskPriorityUpgradeRequest.findFirst({
      where: {
        taskId: id,
        status: PriorityUpgradeRequestStatus.pending,
      },
      select: { id: true },
    });
    if (pending) {
      return Response.json({ error: "该任务已有待审批提权申请" }, { status: 409 });
    }

    const created = await prisma.taskPriorityUpgradeRequest.create({
      data: {
        taskId: id,
        requestedById: requesterId,
        fromPriority: task.priority,
        targetPriority: 1,
        sku,
        reason,
      },
      include: {
        requestedBy: { select: { id: true, name: true } },
      },
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error("[POST /api/tasks/[id]/priority-upgrade]", error);
    return Response.json({ error: "Failed to create priority upgrade request" }, { status: 500 });
  }
}
