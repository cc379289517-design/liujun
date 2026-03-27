import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/buildings/[id] - 更新楼座
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.floorPlanUrl !== undefined) data.floorPlanUrl = body.floorPlanUrl;

    const building = await prisma.building.update({
      where: { id: parseInt(id) },
      data,
    });
    return Response.json(building);
  } catch (error) {
    console.error("[PATCH /api/buildings/[id]]", error);
    return Response.json({ error: "Failed to update building" }, { status: 500 });
  }
}

/**
 * DELETE /api/buildings/[id] - 删除楼座
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    await prisma.building.delete({ where: { id: parseInt(id) } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/buildings/[id]]", error);
    return Response.json({ error: "Failed to delete building" }, { status: 500 });
  }
}
