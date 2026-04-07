import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProfileStatus } from "@/generated/prisma/client";
import { sweepWaitingTasks } from "@/lib/scheduler";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/profiles/[id] - 获取单个用户详情
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    const profile = await prisma.profile.findUnique({
      where: { id },
      include: {
        building: true,
        createdTasks: {
          where: { status: { not: "completed" } },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        assignedTasks: {
          where: { status: { not: "completed" } },
          orderBy: { priority: "asc" },
          take: 10,
        },
      },
    });

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    return Response.json(profile);
  } catch (error) {
    console.error("[GET /api/profiles/[id]]", error);
    return Response.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

/**
 * PATCH /api/profiles/[id] - 更新用户状态
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { status, subStatus, currentRoom, buildingId, isOnline, name, role, avatar, employeeId, onlineStatus, department, group } = body;

    const data: Record<string, unknown> = {};
    if (status && Object.values(ProfileStatus).includes(status)) {
      data.status = status;
    }
    if (subStatus !== undefined) data.subStatus = subStatus;
    if (currentRoom !== undefined) data.currentRoom = currentRoom;
    if (buildingId !== undefined) data.buildingId = parseInt(String(buildingId));
    if (isOnline !== undefined) data.isOnline = isOnline;
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (avatar !== undefined) data.avatar = avatar;
    if (employeeId !== undefined) data.employeeId = employeeId;
    if (onlineStatus !== undefined) data.onlineStatus = onlineStatus;
    if (department !== undefined) data.department = department;
    if (group !== undefined) data.group = group;

    // 记录更新前的状态，用于判断是否需要触发自动派单
    const before = await prisma.profile.findUnique({
      where: { id },
      select: { status: true, onlineStatus: true, subStatus: true, role: true },
    });

    // 助理/助理组长在任务中时，不允许切换在线状态
    if (
      before &&
      onlineStatus !== undefined &&
      ["assistant", "assistant_leader"].includes(before.role) &&
      before.status !== ProfileStatus.idle
    ) {
      const statusLabel: Record<string, string> = {
        assigned: "待就位",
        busy: "在忙",
        executing: "进行中",
        finishing: "快结束",
      };
      return Response.json(
        { error: `该助理当前处于「${statusLabel[before.status] || before.status}」状态，无法切换在线状态` },
        { status: 400 }
      );
    }

    const updated = await prisma.profile.update({
      where: { id },
      data,
      include: { building: { select: { id: true, name: true, extraVenues: true } } },
    });

    // 助理变为可用状态时，自动扫描等待中的任务进行派单
    if (before && ["assistant", "assistant_leader"].includes(before.role)) {
      const wasAvailable = before.status === ProfileStatus.idle && before.onlineStatus === "online" && !before.subStatus;
      const nowAvailable = updated.status === ProfileStatus.idle && updated.onlineStatus === "online" && !updated.subStatus;

      if (!wasAvailable && nowAvailable) {
        sweepWaitingTasks().catch((err) =>
          console.error("[PATCH /api/profiles/[id]] sweep failed:", err)
        );
      }
    }

    return Response.json(updated);
  } catch (error) {
    console.error("[PATCH /api/profiles/[id]]", error);
    return Response.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

/**
 * DELETE /api/profiles/[id] - 删除用户
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    await prisma.profile.delete({ where: { id } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/profiles/[id]]", error);
    return Response.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
