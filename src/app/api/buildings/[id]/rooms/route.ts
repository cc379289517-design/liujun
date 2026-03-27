import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/buildings/[id]/rooms - 添加房间
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { roomNumber, floor, fenceRadius, xPosition, yPosition } = body;

    if (!roomNumber) {
      return Response.json({ error: "roomNumber is required" }, { status: 400 });
    }

    const room = await prisma.room.create({
      data: {
        buildingId: parseInt(id),
        roomNumber,
        floor: floor ? parseInt(floor) : 1,
        fenceRadius: fenceRadius ? parseFloat(fenceRadius) : null,
        xPosition: xPosition ? parseFloat(xPosition) : null,
        yPosition: yPosition ? parseFloat(yPosition) : null,
      },
    });

    return Response.json(room, { status: 201 });
  } catch (error) {
    console.error("[POST /api/buildings/[id]/rooms]", error);
    return Response.json({ error: "Failed to create room" }, { status: 500 });
  }
}

/**
 * PATCH /api/buildings/[id]/rooms - 更新房间坐标
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, xPosition, yPosition, fenceRadius } = body;

    if (!roomId) {
      return Response.json({ error: "roomId is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (xPosition !== undefined) data.xPosition = parseFloat(xPosition);
    if (yPosition !== undefined) data.yPosition = parseFloat(yPosition);
    if (fenceRadius !== undefined) data.fenceRadius = parseFloat(fenceRadius);

    const room = await prisma.room.update({
      where: { id: parseInt(roomId) },
      data,
    });

    return Response.json(room);
  } catch (error) {
    console.error("[PATCH /api/buildings/[id]/rooms]", error);
    return Response.json({ error: "Failed to update room" }, { status: 500 });
  }
}

/**
 * DELETE /api/buildings/[id]/rooms?roomId=xxx - 删除房间
 */
export async function DELETE(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get("roomId");
    if (!roomId) {
      return Response.json({ error: "roomId is required" }, { status: 400 });
    }

    await prisma.room.delete({ where: { id: parseInt(roomId) } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/buildings/[id]/rooms]", error);
    return Response.json({ error: "Failed to delete room" }, { status: 500 });
  }
}
