import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBuildingForJson } from "@/lib/buildingPayload";

/**
 * GET /api/buildings - 获取所有楼座及房间
 */
export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get("view") ?? "full";

    if (view === "summary" || view === "stats") {
      const buildings = await prisma.building.findMany({
        select: {
          id: true,
          name: true,
        },
        orderBy: { id: "asc" },
      });

      return Response.json(buildings);
    }

    if (view !== "full") {
      return Response.json({ error: "Invalid view" }, { status: 400 });
    }

    const buildings = await prisma.building.findMany({
      include: {
        rooms: { orderBy: { roomNumber: "asc" } },
        ironingMachines: { orderBy: [{ sortRank: "asc" }, { id: "asc" }] },
      },
      orderBy: { id: "asc" },
    });

    return Response.json(buildings.map(serializeBuildingForJson));
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

    return Response.json(serializeBuildingForJson(building), { status: 201 });
  } catch (error) {
    console.error("[POST /api/buildings]", error);
    return Response.json({ error: "Failed to create building" }, { status: 500 });
  }
}
