import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";

/**
 * POST /api/profiles/batch - 批量创建用户
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profiles } = body;

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return Response.json({ error: "profiles array is required" }, { status: 400 });
    }

    const results: { success: number; failed: { index: number; name: string; error: string }[] } = {
      success: 0,
      failed: [],
    };

    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      try {
        if (!p.name || !p.role || !p.buildingId) {
          results.failed.push({ index: i, name: p.name || "未知", error: "缺少必填字段" });
          continue;
        }
        if (!Object.values(Role).includes(p.role)) {
          results.failed.push({ index: i, name: p.name, error: `无效角色: ${p.role}` });
          continue;
        }

        const profileData = {
          name: p.name,
          role: p.role,
          buildingId: parseInt(String(p.buildingId)),
          currentRoom: p.currentRoom || null,
          avatar: p.avatar || null,
          employeeId: p.employeeId || null,
          department: p.department || null,
          group: p.group || null,
        };

        if (p.employeeId) {
          const existing = await prisma.profile.findFirst({
            where: { employeeId: p.employeeId },
          });
          if (existing) {
            await prisma.profile.update({
              where: { id: existing.id },
              data: profileData,
            });
          } else {
            await prisma.profile.create({ data: profileData });
          }
        } else {
          await prisma.profile.create({ data: profileData });
        }
        results.success++;
      } catch (err) {
        results.failed.push({ index: i, name: p.name || "未知", error: String(err) });
      }
    }

    return Response.json(results, { status: 201 });
  } catch (error) {
    console.error("[POST /api/profiles/batch]", error);
    return Response.json({ error: "Failed to batch create profiles" }, { status: 500 });
  }
}
