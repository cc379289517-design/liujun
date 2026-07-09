import { prisma } from "@/lib/prisma";
import { WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY } from "@/lib/workbenchBackground";
import { NextRequest } from "next/server";

const LARGE_CONFIG_KEYS = new Set([WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]);

type ConfigRow = {
  key: string;
  value: string;
  label: string | null;
};

type LargeConfigMetaRow = {
  key: string;
  label: string | null;
  updatedAt: Date;
};

function parseConfigKeys(value: string | null): string[] | null {
  if (!value) return null;
  const keys = value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? Array.from(new Set(keys)) : null;
}

function publicLargeConfigValue(row: LargeConfigMetaRow): string {
  if (row.key === WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY) {
    return `/api/config/background?v=${row.updatedAt.getTime()}`;
  }
  return "";
}

// GET /api/config - get all system config
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeLarge = searchParams.get("includeLarge") === "1";
    const requestedKeys = parseConfigKeys(searchParams.get("keys"));
    const result: Record<string, { value: string; label: string | null }> = {};

    if (includeLarge) {
      const configs = await prisma.systemConfig.findMany({
        where: requestedKeys ? { key: { in: requestedKeys } } : undefined,
        select: { key: true, value: true, label: true },
      });
      configs.forEach((c: ConfigRow) => {
        result[c.key] = { value: c.value, label: c.label };
      });
      return Response.json(result);
    }

    const keyFilter = requestedKeys ? { in: requestedKeys } : undefined;
    const smallConfigs = await prisma.systemConfig.findMany({
      where: {
        key: keyFilter
          ? { ...keyFilter, notIn: Array.from(LARGE_CONFIG_KEYS) }
          : { notIn: Array.from(LARGE_CONFIG_KEYS) },
      },
      select: { key: true, value: true, label: true },
    });
    smallConfigs.forEach((c: ConfigRow) => {
      result[c.key] = { value: c.value, label: c.label };
    });

    const largeKeysToExpose = requestedKeys
      ? requestedKeys.filter((key) => LARGE_CONFIG_KEYS.has(key))
      : Array.from(LARGE_CONFIG_KEYS);
    if (largeKeysToExpose.length > 0) {
      const largeConfigs = await prisma.systemConfig.findMany({
        where: { key: { in: largeKeysToExpose } },
        select: { key: true, label: true, updatedAt: true },
      });
      largeConfigs.forEach((c: LargeConfigMetaRow) => {
        result[c.key] = { value: publicLargeConfigValue(c), label: c.label };
      });
    }

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
