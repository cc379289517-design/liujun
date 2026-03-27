import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/categories - 获取所有任务类型
 */
export async function GET() {
  try {
    const categories = await prisma.taskCategory.findMany({
      orderBy: { priorityLevel: "asc" },
    });

    return Response.json(categories);
  } catch (error) {
    console.error("[GET /api/categories]", error);
    return Response.json({ error: "Failed to fetch categories" }, { status: 500 });
  }
}

/**
 * POST /api/categories - 创建任务类型
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, priorityLevel, minDuration, maxDuration, hexColor, sortRank, estDuration } = body;

    if (!name || !priorityLevel || !minDuration || !maxDuration) {
      return Response.json(
        { error: "name, priorityLevel, minDuration, maxDuration are required" },
        { status: 400 }
      );
    }

    const category = await prisma.taskCategory.create({
      data: {
        name,
        description: description || null,
        priorityLevel: parseInt(priorityLevel),
        minDuration: parseInt(minDuration),
        maxDuration: parseInt(maxDuration),
        estDuration: estDuration ? parseInt(estDuration) : null,
        hexColor: hexColor || null,
        sortRank: sortRank !== undefined ? parseInt(sortRank) : 0,
      },
    });

    return Response.json(category, { status: 201 });
  } catch (error) {
    console.error("[POST /api/categories]", error);
    return Response.json({ error: "Failed to create category" }, { status: 500 });
  }
}
