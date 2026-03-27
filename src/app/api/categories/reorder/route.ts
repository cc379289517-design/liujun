import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/categories/reorder - batch update sortRank
 * Body: { items: [{ id: 1, sortRank: 0 }, { id: 2, sortRank: 1 }] }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "items array is required" }, { status: 400 });
    }

    for (const item of items) {
      await prisma.taskCategory.update({
        where: { id: item.id },
        data: { sortRank: item.sortRank },
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/categories/reorder]", error);
    return Response.json({ error: "Failed to reorder categories" }, { status: 500 });
  }
}
