import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/categories - 获取所有任务类型（勿缓存：后台改时段后工作台需尽快读到新数据）
 */
export async function GET() {
  try {
    const categories = await prisma.taskCategory.findMany({
      orderBy: { priorityLevel: "asc" },
    });

    return NextResponse.json(categories, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[GET /api/categories]", error);
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
  }
}

/**
 * POST /api/categories - 创建任务类型
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, priorityLevel, minDuration, maxDuration, hexColor, sortRank, estDuration, canBeInterrupted, maxInterruptMinutes } = body;

    if (!name || !priorityLevel) {
      return Response.json(
        { error: "name, priorityLevel are required" },
        { status: 400 }
      );
    }

    const parsedMaxDuration = maxDuration != null ? parseInt(maxDuration) : 0;
    const forceNonInterruptible = parsedMaxDuration > 0 && parsedMaxDuration <= 30;

    const category = await prisma.taskCategory.create({
      data: {
        name,
        description: description || null,
        priorityLevel: parseInt(priorityLevel),
        minDuration: minDuration != null ? parseInt(minDuration) : 0,
        maxDuration: parsedMaxDuration,
        estDuration: estDuration ? parseInt(estDuration) : undefined,
        hexColor: hexColor || null,
        sortRank: sortRank !== undefined ? parseInt(sortRank) : 0,
        canBeInterrupted: forceNonInterruptible ? false : canBeInterrupted !== undefined ? canBeInterrupted : true,
        maxInterruptMinutes: forceNonInterruptible ? null : maxInterruptMinutes != null ? parseInt(maxInterruptMinutes) : null,
      },
    });

    return Response.json(category, { status: 201 });
  } catch (error) {
    console.error("[POST /api/categories]", error);
    return Response.json({ error: "Failed to create category" }, { status: 500 });
  }
}
