import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetricPayload = {
  sessionId?: unknown;
  path?: unknown;
  role?: unknown;
  reason?: unknown;
  viewport?: unknown;
  connection?: unknown;
  metrics?: unknown;
};

const MAX_BODY_BYTES = 32 * 1024;
const MAX_METRICS = 50;
const ALLOWED_METRICS = new Set(["navigation", "lcp", "cls", "longtask", "interaction", "visibility"]);

function cleanString(value: unknown, fallback = "", max = 120): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined;
}

function cleanRecord(value: unknown, maxEntries = 12): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value).slice(0, maxEntries)) {
    if (typeof raw === "string") result[key] = raw.slice(0, 80);
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = Math.round(raw * 10) / 10;
    else if (typeof raw === "boolean") result[key] = raw;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function logPath(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return path.join(process.cwd(), "logs", `client-metrics-${yyyy}${mm}${dd}.jsonl`);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: MetricPayload;
  try {
    payload = JSON.parse(text) as MetricPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(payload.metrics)) {
    return Response.json({ error: "metrics array is required" }, { status: 400 });
  }

  const metrics = payload.metrics.slice(0, MAX_METRICS).flatMap((metric) => {
    if (!metric || typeof metric !== "object") return [];
    const row = metric as Record<string, unknown>;
    const name = cleanString(row.name);
    if (!ALLOWED_METRICS.has(name)) return [];
    const value = cleanNumber(row.value);
    if (value == null) return [];
    return [{
      name,
      value,
      ts: cleanNumber(row.ts) ?? Date.now(),
      rating: cleanString(row.rating, "", 32) || undefined,
      metadata: cleanRecord(row.metadata),
    }];
  });

  if (metrics.length === 0) {
    return Response.json({ ok: true, accepted: 0 });
  }

  const record = {
    receivedAt: new Date().toISOString(),
    sessionId: cleanString(payload.sessionId, "unknown", 80),
    path: cleanString(payload.path, "/", 160),
    role: cleanString(payload.role, "unknown", 40),
    reason: cleanString(payload.reason, "", 40),
    viewport: cleanRecord(payload.viewport),
    connection: cleanRecord(payload.connection),
    userAgent: cleanString(request.headers.get("user-agent"), "", 180),
    metrics,
  };

  const filePath = logPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");

  return Response.json({ ok: true, accepted: metrics.length });
}
