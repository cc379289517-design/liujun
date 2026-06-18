import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/buildings - 获取所有楼座及房间
 */
export async function GET() {
  try {
    const buildings = await prisma.building.findMany({
      include: {
        rooms: { orderBy: { roomNumber: "asc" } },
        ironingMachines: { orderBy: [{ sortRank: "asc" }, { id: "asc" }] },
      },
      orderBy: { id: "asc" },
    });

    return Response.json(buildings);
  } catch (error) {
    console.error("[GET /api/buildings]", error);
    return Response.json({ error: "Failed to fetch buildings" }, { status: 500 });
  }
}

/**
 * POST /api/buildings - 创建楼座
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, floorPlanUrl } = body;

    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const building = await prisma.building.create({
      data: { name, floorPlanUrl: floorPlanUrl || null },
      include: { rooms: true, ironingMachines: true },
    });

    return Response.json(building, { status: 201 });
  } catch (error) {
    console.error("[POST /api/buildings]", error);
    return Response.json({ error: "Failed to create building" }, { status: 500 });
  }
}
