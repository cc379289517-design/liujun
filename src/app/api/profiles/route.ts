import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";

/**
 * GET /api/profiles - 查询用户列表
 * 支持 ?role=assistant&buildingId=1&status=idle
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const role = searchParams.get("role");
    const buildingId = searchParams.get("buildingId");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (buildingId) where.buildingId = parseInt(buildingId);
    if (status) where.status = status;

    const profiles = await prisma.profile.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });

    return Response.json(profiles);
  } catch (error) {
    console.error("[GET /api/profiles]", error);
    return Response.json({ error: "Failed to fetch profiles" }, { status: 500 });
  }
}

/**
 * POST /api/profiles - 创建用户
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, employeeId, role, buildingId, currentRoom, avatar, department, group } = body;

    if (!name || !role || !buildingId) {
      return Response.json(
        { error: "name, role, and buildingId are required" },
        { status: 400 }
      );
    }

    if (!Object.values(Role).includes(role)) {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    const profile = await prisma.profile.create({
      data: {
        name,
        employeeId: employeeId || null,
        role,
        buildingId: parseInt(buildingId),
        currentRoom: currentRoom || null,
        avatar: avatar || null,
        department: department || null,
        group: group || null,
      },
      include: { building: { select: { id: true, name: true } } },
    });

    return Response.json(profile, { status: 201 });
  } catch (error) {
    console.error("[POST /api/profiles]", error);
    return Response.json({ error: "Failed to create profile" }, { status: 500 });
  }
}
