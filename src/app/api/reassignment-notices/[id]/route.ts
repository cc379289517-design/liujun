import { NextRequest } from "next/server";
import { OnlineStatus, ProfileStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sweepWaitingTasks } from "@/lib/scheduler";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : "";

    const notice = await prisma.standbyReassignmentNotice.findUnique({
      where: { id },
      select: {
        id: true,
        oldAssistantId: true,
        newAssistantId: true,
        oldAssistantSetOffline: true,
      },
    });
    if (!notice) {
      return Response.json({ error: "Notice not found" }, { status: 404 });
    }

    if (action === "acknowledgeNew") {
      const updated = await prisma.standbyReassignmentNotice.update({
        where: { id },
        data: { newAssistantAcknowledgedAt: new Date() },
      });
      return Response.json({ notice: updated });
    }

    if (action === "acknowledgeOld") {
      if (!notice.oldAssistantSetOffline) {
        const updatedNotice = await prisma.standbyReassignmentNotice.update({
          where: { id },
          data: { oldAssistantAcknowledgedAt: new Date() },
        });
        return Response.json({ notice: updatedNotice });
      }

      const [updatedNotice, updatedProfile] = await prisma.$transaction([
        prisma.standbyReassignmentNotice.update({
          where: { id },
          data: { oldAssistantAcknowledgedAt: new Date() },
        }),
        prisma.profile.update({
          where: { id: notice.oldAssistantId },
          data: {
            status: ProfileStatus.idle,
            onlineStatus: OnlineStatus.online,
            isOnline: true,
          },
          include: { building: { select: { id: true, name: true, extraVenues: true } } },
        }),
      ]);
      await sweepWaitingTasks();
      return Response.json({ notice: updatedNotice, profile: updatedProfile });
    }

    return Response.json(
      { error: "Invalid action. Use: acknowledgeNew, acknowledgeOld" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[PATCH /api/reassignment-notices/[id]]", error);
    return Response.json({ error: "Failed to update reassignment notice" }, { status: 500 });
  }
}
