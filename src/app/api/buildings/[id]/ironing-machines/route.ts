import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { IroningMachineStatus } from "@/generated/prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

const STATUS_SET = new Set<IroningMachineStatus>(["normal", "maintenance"]);

function clampPercent(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return Math.min(100, Math.max(0, Math.round(fallback * 100) / 100));
  return Math.min(100, Math.max(0, Math.round(num * 100) / 100));
}

async function nextMachineName(buildingId: number): Promise<string> {
  const existing = await prisma.ironingMachine.findMany({
    where: { buildingId },
    select: { name: true },
    orderBy: { id: "asc" },
  });
  const names = new Set(existing.map((item) => item.name));
  for (let index = 0; index < 702; index += 1) {
    const name = `熨烫机${index + 1}`;
    if (!names.has(name)) return name;
  }
  return `熨烫机${existing.length + 1}`;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const buildingId = Number(id);
    if (!Number.isInteger(buildingId)) {
      return Response.json({ error: "Invalid building id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const count = Math.min(20, Math.max(1, Number.parseInt(String(body.count ?? 1), 10) || 1));
    const existingCount = await prisma.ironingMachine.count({ where: { buildingId } });
    const created = [];

    for (let index = 0; index < count; index += 1) {
      const name = typeof body.name === "string" && body.name.trim() && count === 1
        ? body.name.trim()
        : await nextMachineName(buildingId);
      const machine = await prisma.ironingMachine.create({
        data: {
          buildingId,
          name,
          status: STATUS_SET.has(body.status) ? body.status : "normal",
          xPosition: clampPercent(body.xPosition, 86),
          yPosition: clampPercent(body.yPosition, 14 + (existingCount + index) * 6),
          sortRank: existingCount + index,
        },
      });
      created.push(machine);
    }

    return Response.json(count === 1 ? created[0] : created, { status: 201 });
  } catch (error) {
    console.error("[POST /api/buildings/[id]/ironing-machines]", error);
    return Response.json({ error: "Failed to create ironing machine" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const machineId = Number(body.machineId);
    if (!Number.isInteger(machineId)) {
      return Response.json({ error: "machineId is required" }, { status: 400 });
    }

    const data: {
      name?: string;
      status?: IroningMachineStatus;
      xPosition?: number;
      yPosition?: number;
      sortRank?: number;
    } = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (STATUS_SET.has(body.status)) data.status = body.status;
    if (body.xPosition !== undefined) data.xPosition = clampPercent(body.xPosition, 86);
    if (body.yPosition !== undefined) data.yPosition = clampPercent(body.yPosition, 14);
    if (body.sortRank !== undefined) {
      const sortRank = Number.parseInt(String(body.sortRank), 10);
      if (Number.isFinite(sortRank)) data.sortRank = sortRank;
    }

    const machine = await prisma.ironingMachine.update({
      where: { id: machineId },
      data,
    });
    return Response.json(machine);
  } catch (error) {
    console.error("[PATCH /api/buildings/[id]/ironing-machines]", error);
    return Response.json({ error: "Failed to update ironing machine" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const machineId = Number(request.nextUrl.searchParams.get("machineId"));
    if (!Number.isInteger(machineId)) {
      return Response.json({ error: "machineId is required" }, { status: 400 });
    }

    await prisma.ironingMachine.delete({ where: { id: machineId } });
    return Response.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/buildings/[id]/ironing-machines]", error);
    return Response.json({ error: "Failed to delete ironing machine" }, { status: 500 });
  }
}
