import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/categories/[id] - update a category
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, priorityLevel, minDuration, maxDuration, estDuration, hexColor, sortRank } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (priorityLevel !== undefined) data.priorityLevel = parseInt(String(priorityLevel));
    if (minDuration !== undefined) data.minDuration = parseInt(String(minDuration));
    if (maxDuration !== undefined) data.maxDuration = parseInt(String(maxDuration));
    if (estDuration !== undefined) data.estDuration = estDuration !== null ? parseInt(String(estDuration)) : null;
    if (hexColor !== undefined) data.hexColor = hexColor;
    if (sortRank !== undefined) data.sortRank = parseInt(String(sortRank));

    const updated = await prisma.taskCategory.update({
      where: { id: parseInt(id) },
      data,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("[PATCH /api/categories/[id]]", error);
    return Response.json({ error: "Failed to update category" }, { status: 500 });
  }
}
