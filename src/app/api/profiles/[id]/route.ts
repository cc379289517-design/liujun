import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { OnlineStatus, ProfileStatus, TaskStatus } from "@/generated/prisma/client";
import { runTaskMaintenance } from "@/lib/scheduler";
import {
  ASSISTANT_EATING_SUB_STATUS,
  EATING_REENTRY_COOLDOWN_CONFIG_KEY,
  eatingReentryRemainingMs,
  parseEatingReentryCooldownMin,
} from "@/lib/eatingPresence";

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

    const { status, subStatus, currentRoom, buildingId, activeBuildingId, activeRoom, isOnline, name, role, avatar, employeeId, onlineStatus, department, group } = body;

    const data: Record<string, unknown> = {};
    if (status && Object.values(ProfileStatus).includes(status)) {
      data.status = status;
    }
    if (subStatus !== undefined) data.subStatus = subStatus;
    if (currentRoom !== undefined) data.currentRoom = currentRoom || null;
    if (buildingId !== undefined) data.buildingId = parseInt(String(buildingId));
    if (activeBuildingId !== undefined) data.activeBuildingId = activeBuildingId == null ? null : parseInt(String(activeBuildingId));
    if (activeRoom !== undefined) data.activeRoom = activeRoom;
    if (isOnline !== undefined) data.isOnline = isOnline;
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (avatar !== undefined) data.avatar = avatar;
    if (employeeId !== undefined) data.employeeId = employeeId || null;
    if (onlineStatus !== undefined) {
      if (!Object.values(OnlineStatus).includes(onlineStatus)) {
        return Response.json({ error: "Invalid onlineStatus" }, { status: 400 });
      }
      data.onlineStatus = onlineStatus;
    }
    if (department !== undefined) data.department = department || null;
    if (group !== undefined) data.group = group || null;

    // 记录更新前的状态，用于判断是否需要触发自动派单
    const before = await prisma.profile.findUnique({
      where: { id },
      select: {
        status: true,
        onlineStatus: true,
        subStatus: true,
        eatingStartedAt: true,
        eatingEndedAt: true,
        role: true,
        buildingId: true,
        activeBuildingId: true,
      },
    });

    if (!before) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    const pausedTaskCount = before && ["assistant", "assistant_leader"].includes(before.role)
      ? await prisma.bookingTask.count({
        where: {
          status: TaskStatus.paused,
          OR: [
            { assistantId: id },
            { collaborators: { some: { assistantId: id, status: "paused" } } },
          ],
        },
      })
      : 0;

    // 助理/助理组长在任务中时，不允许切换在线状态；暂停中允许切换吃饭/休假
    if (
      (onlineStatus !== undefined || subStatus !== undefined) &&
      ["assistant", "assistant_leader"].includes(before.role) &&
      before.status !== ProfileStatus.idle &&
      !(before.status === ProfileStatus.busy && pausedTaskCount > 0)
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

    const isAssistant = ["assistant", "assistant_leader"].includes(before.role);
    const requestedSubStatus =
      subStatus !== undefined
        ? subStatus || null
        : onlineStatus !== undefined && onlineStatus !== OnlineStatus.online
          ? null
          : undefined;
    const requestedOnlineStatus = onlineStatus as OnlineStatus | undefined;
    const enteringEating =
      isAssistant &&
      requestedSubStatus === ASSISTANT_EATING_SUB_STATUS &&
      before.subStatus !== ASSISTANT_EATING_SUB_STATUS;
    const leavingEating =
      isAssistant &&
      before.subStatus === ASSISTANT_EATING_SUB_STATUS &&
      (
        (requestedSubStatus !== undefined && requestedSubStatus !== ASSISTANT_EATING_SUB_STATUS) ||
        (requestedOnlineStatus !== undefined && requestedOnlineStatus !== OnlineStatus.online)
      );

    if (enteringEating) {
      const cfg = await prisma.systemConfig.findUnique({
        where: { key: EATING_REENTRY_COOLDOWN_CONFIG_KEY },
        select: { value: true },
      });
      const cooldownMinutes = parseEatingReentryCooldownMin(cfg?.value);
      const now = new Date();
      const remainingMs = eatingReentryRemainingMs(before.eatingEndedAt, now, cooldownMinutes);
      if (remainingMs > 0) {
        const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
        return Response.json(
          {
            code: "EATING_REENTRY_COOLDOWN",
            error: `刚结束吃饭状态，${remainingMinutes}分钟后才可以再次切换为吃饭中`,
            remainingMinutes,
            cooldownMinutes,
            canRetryAt: new Date(now.getTime() + remainingMs).toISOString(),
          },
          { status: 400 }
        );
      }
      data.subStatus = ASSISTANT_EATING_SUB_STATUS;
      data.onlineStatus = OnlineStatus.online;
      data.isOnline = true;
      data.eatingStartedAt = now;
      data.eatingEndedAt = null;
    } else if (leavingEating) {
      data.subStatus = requestedSubStatus ?? null;
      data.eatingEndedAt = new Date();
    } else if (
      isAssistant &&
      requestedSubStatus === ASSISTANT_EATING_SUB_STATUS &&
      before.subStatus === ASSISTANT_EATING_SUB_STATUS
    ) {
      data.eatingStartedAt = before.eatingStartedAt ?? new Date();
      data.eatingEndedAt = null;
    }

    const beforeServiceBuildingId = before?.activeBuildingId ?? before?.buildingId;
    const nextBuildingId =
      activeBuildingId !== undefined && activeBuildingId != null
        ? parseInt(String(activeBuildingId))
        : undefined;
    const isBuildingChange =
      isAssistant &&
      nextBuildingId !== undefined &&
      Number.isFinite(nextBuildingId) &&
      nextBuildingId !== beforeServiceBuildingId;
    let shouldSweep = false;

    if (
      isBuildingChange &&
      (before.status === ProfileStatus.executing || before.status === ProfileStatus.finishing)
    ) {
      return Response.json(
        { error: "助理进行中时不能切换楼座" },
        { status: 400 }
      );
    }

    let updated = await prisma.$transaction(async (tx) => {
      if (isBuildingChange && before.status === ProfileStatus.assigned) {
        await tx.bookingTask.updateMany({
          where: { assistantId: id, status: TaskStatus.waiting },
          data: { assistantId: null, parentTaskId: null },
        });
        const pausedCount = await tx.bookingTask.count({
          where: { assistantId: id, status: TaskStatus.paused },
        });
        data.status = pausedCount > 0 ? ProfileStatus.busy : ProfileStatus.idle;
        shouldSweep = true;
      }

      return tx.profile.update({
        where: { id },
        data,
        include: { building: { select: { id: true, name: true, extraVenues: true } } },
      });
    });
    if (isBuildingChange) shouldSweep = true;

    // 助理变为可用状态时，自动扫描等待中的任务进行派单
    if (before && ["assistant", "assistant_leader"].includes(before.role)) {
      const wasAvailable = before.status === ProfileStatus.idle && before.onlineStatus === "online" && !before.subStatus;
      const nowAvailable = updated.status === ProfileStatus.idle && updated.onlineStatus === "online" && !updated.subStatus;

      if (!wasAvailable && nowAvailable) {
        shouldSweep = true;
      }
    }

    if (shouldSweep) {
      await runTaskMaintenance({ force: true });
      const fresh = await prisma.profile.findUnique({
        where: { id },
        include: { building: { select: { id: true, name: true, extraVenues: true } } },
      });
      if (fresh) updated = fresh;
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
