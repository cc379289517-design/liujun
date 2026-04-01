import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFile } from "fs/promises";
import path from "path";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/buildings/[id] - 更新楼座（支持 JSON 或 FormData 上传平面图）
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";
    const data: Record<string, unknown> = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const name = formData.get("name");
      if (name) data.name = name;

      const file = formData.get("floorPlan") as File | null;
      if (file && file.size > 0) {
        const ext = path.extname(file.name) || ".png";
        const filename = `floor-plan-${id}-${Date.now()}${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(path.join(process.cwd(), "public/uploads", filename), buffer);
        data.floorPlanUrl = `/uploads/${filename}`;
      }
    } else {
      const body = await request.json();
      if (body.name !== undefined) data.name = body.name;
      if (body.floorPlanUrl !== undefined) data.floorPlanUrl = body.floorPlanUrl;
      if (body.cropX !== undefined) data.cropX = body.cropX;
      if (body.cropY !== undefined) data.cropY = body.cropY;
      if (body.cropW !== undefined) data.cropW = body.cropW;
      if (body.cropH !== undefined) data.cropH = body.cropH;
    }

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
