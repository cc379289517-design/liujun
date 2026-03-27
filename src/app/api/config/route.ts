import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// GET /api/config - get all system config
export async function GET() {
  try {
    const configs = await prisma.systemConfig.findMany();
    // Convert to key-value object
    const result: Record<string, { value: string; label: string | null }> = {};
    configs.forEach((c) => {
      result[c.key] = { value: c.value, label: c.label };
    });
    return Response.json(result);
  } catch (error) {
    console.error("[GET /api/config]", error);
    return Response.json({ error: "Failed to fetch config" }, { status: 500 });
  }
}

// PUT /api/config - update system config
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    // body is { key: value, key: value, ... }
    const updates = Object.entries(body);
    for (const [key, value] of updates) {
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/config]", error);
    return Response.json({ error: "Failed to update config" }, { status: 500 });
  }
}
