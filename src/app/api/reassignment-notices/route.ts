import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const assistantId = request.nextUrl.searchParams.get("assistantId");
    if (!assistantId) {
      return Response.json({ error: "assistantId is required" }, { status: 400 });
    }

    const notices = await prisma.standbyReassignmentNotice.findMany({
      where: {
        OR: [
          { newAssistantId: assistantId, newAssistantAcknowledgedAt: null },
          { oldAssistantId: assistantId, oldAssistantAcknowledgedAt: null },
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
    });

    return Response.json(notices);
  } catch (error) {
    console.error("[GET /api/reassignment-notices]", error);
    return Response.json({ error: "Failed to fetch reassignment notices" }, { status: 500 });
  }
}
