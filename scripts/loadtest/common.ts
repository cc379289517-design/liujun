import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LoadtestMode = "smoke" | "readonly" | "mixed" | "sweep";

export type RequestLogEvent = {
  kind: "request";
  ts: string;
  elapsedMs: number;
  scenario: string;
  personaRole: string;
  personaId: string;
  method: string;
  endpoint: string;
  status: number;
  ok: boolean;
  durationMs: number;
  bytes: number;
  error?: string;
  code?: string;
  timeout?: boolean;
  counts?: {
    profiles?: number;
    tasks?: number;
    publicQueue?: number;
    assistantStatus?: number;
    notices?: number;
  };
  syncMode?: "full" | "delta";
  maintenanceRan?: boolean;
};

export type SampleLogEvent = {
  kind: "sample";
  ts: string;
  elapsedMs: number;
  rssMb: number;
  heapUsedMb: number;
  serverPid?: number;
  serverRssMb?: number;
  serverCpuPct?: number;
};

export type RawLogEvent = RequestLogEvent | SampleLogEvent;

export type LoadtestReportConfig = {
  mode: LoadtestMode;
  baseUrl: string;
  durationSec: number;
  outDir: string;
  startedAt: string;
  endedAt?: string;
  gitCommit?: string;
  personas: {
    photographers: number;
    assistants: number;
    admins: number;
  };
  options: Record<string, string | number | boolean | null>;
};

export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      args.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(body, next);
      i += 1;
    } else {
      args.set(body, "true");
    }
  }
  return args;
}

export function stringArg(args: Map<string, string>, name: string, fallback: string): string {
  return args.get(name) ?? process.env[name.replaceAll("-", "_").toUpperCase()] ?? fallback;
}

export function numberArg(args: Map<string, string>, name: string, fallback: number): number {
  const raw = args.get(name) ?? process.env[name.replaceAll("-", "_").toUpperCase()];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function booleanArg(args: Map<string, string>, name: string, fallback = false): boolean {
  const raw = args.get(name) ?? process.env[name.replaceAll("-", "_").toUpperCase()];
  if (raw == null || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function timestampForPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSeededRandom(seed: number): () => number {
  let state = Math.floor(seed) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function pick<T>(items: T[], random: () => number): T {
  if (items.length === 0) throw new Error("Cannot pick from empty list");
  return items[Math.floor(random() * items.length) % items.length];
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function tryParseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeNumbers(values: number[]) {
  if (values.length === 0) {
    return { count: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    avg: round(sum / values.length),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
  };
}

export function buildReport(events: RawLogEvent[], config: LoadtestReportConfig) {
  const requests = events.filter((event): event is RequestLogEvent => event.kind === "request");
  const samples = events.filter((event): event is SampleLogEvent => event.kind === "sample");
  const durationMs =
    requests.length > 0
      ? Math.max(...requests.map((event) => event.elapsedMs))
      : config.durationSec * 1000;
  const groups = new Map<string, RequestLogEvent[]>();

  for (const request of requests) {
    const key = `${request.scenario} ${request.method} ${request.endpoint}`;
    const list = groups.get(key) ?? [];
    list.push(request);
    groups.set(key, list);
  }

  const endpointRows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const durations = summarizeNumbers(rows.map((row) => row.durationMs));
      const bytes = summarizeNumbers(rows.map((row) => row.bytes));
      const errors = rows.filter((row) => !row.ok).length;
      return {
        key,
        count: rows.length,
        rps: round(rows.length / Math.max(1, durationMs / 1000), 2),
        errors,
        errorRate: round((errors / Math.max(1, rows.length)) * 100, 2),
        durations,
        bytes,
      };
    });

  const workbenchRequests = requests.filter((request) => request.endpoint === "/api/workbench/sync");
  const workbenchCounts = {
    avgProfiles: round(
      average(workbenchRequests.map((request) => request.counts?.profiles).filter(isNumber)),
    ),
    avgTasks: round(
      average(workbenchRequests.map((request) => request.counts?.tasks).filter(isNumber)),
    ),
    avgPublicQueue: round(
      average(workbenchRequests.map((request) => request.counts?.publicQueue).filter(isNumber)),
    ),
    avgAssistantStatus: round(
      average(workbenchRequests.map((request) => request.counts?.assistantStatus).filter(isNumber)),
    ),
    avgNotices: round(
      average(workbenchRequests.map((request) => request.counts?.notices).filter(isNumber)),
    ),
    fullSyncs: summarizeWorkbenchSyncMode(workbenchRequests, "full"),
    deltaSyncs: summarizeWorkbenchSyncMode(workbenchRequests, "delta"),
    maintenanceRuns: workbenchRequests.filter((request) => request.maintenanceRan).length,
  };

  const errorSamples = requests
    .filter((request) => !request.ok)
    .slice(0, 25)
    .map((request) => ({
      ts: request.ts,
      scenario: request.scenario,
      personaRole: request.personaRole,
      method: request.method,
      endpoint: request.endpoint,
      status: request.status,
      code: request.code ?? "",
      error: request.error ?? "",
      durationMs: round(request.durationMs),
    }));

  const latestSample = samples[samples.length - 1] ?? null;
  const summary = {
    config,
    totals: {
      requests: requests.length,
      errors: requests.filter((request) => !request.ok).length,
      durationSec: round(durationMs / 1000, 2),
      rps: round(requests.length / Math.max(1, durationMs / 1000), 2),
    },
    endpoints: endpointRows,
    workbench: workbenchCounts,
    system: {
      samples: samples.length,
      latest: latestSample,
      maxRssMb: round(Math.max(0, ...samples.map((sample) => sample.rssMb))),
      maxHeapUsedMb: round(Math.max(0, ...samples.map((sample) => sample.heapUsedMb))),
      maxServerRssMb: round(Math.max(0, ...samples.map((sample) => sample.serverRssMb ?? 0))),
      maxServerCpuPct: round(Math.max(0, ...samples.map((sample) => sample.serverCpuPct ?? 0))),
    },
    errorSamples,
  };

  const markdown = renderMarkdownReport(summary);
  return { summary, markdown };
}

export async function writeReportFiles(
  outDir: string,
  events: RawLogEvent[],
  config: LoadtestReportConfig,
): Promise<void> {
  const { summary, markdown } = buildReport(events, config);
  await ensureDir(outDir);
  await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(outDir, "summary.md"), markdown);
  await writeFile(path.join(outDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export async function readJsonl(filePath: string): Promise<RawLogEvent[]> {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawLogEvent);
}

function renderMarkdownReport(summary: ReturnType<typeof buildReport>["summary"]): string {
  const lines: string[] = [];
  lines.push("# Load Test Summary");
  lines.push("");
  lines.push(`- Mode: ${summary.config.mode}`);
  lines.push(`- Base URL: ${summary.config.baseUrl}`);
  lines.push(`- Started: ${summary.config.startedAt}`);
  if (summary.config.endedAt) lines.push(`- Ended: ${summary.config.endedAt}`);
  if (summary.config.gitCommit) lines.push(`- Git commit: ${summary.config.gitCommit}`);
  lines.push(
    `- Personas: ${summary.config.personas.photographers} photographers, ${summary.config.personas.assistants} assistants, ${summary.config.personas.admins} admins`,
  );
  lines.push(`- Total requests: ${summary.totals.requests}`);
  lines.push(`- Total errors: ${summary.totals.errors}`);
  lines.push(`- Observed RPS: ${summary.totals.rps}`);
  lines.push("");
  lines.push("## Endpoint Latency");
  lines.push("");
  lines.push("| Scenario / endpoint | Count | RPS | Err% | p50 | p95 | p99 | Max | Avg bytes | p95 bytes |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of summary.endpoints) {
    lines.push(
      `| ${row.key} | ${row.count} | ${row.rps} | ${row.errorRate} | ${row.durations.p50} | ${row.durations.p95} | ${row.durations.p99} | ${row.durations.max} | ${row.bytes.avg} | ${row.bytes.p95} |`,
    );
  }
  lines.push("");
  lines.push("## Workbench Shape");
  lines.push("");
  lines.push(`- Avg profiles per sync: ${summary.workbench.avgProfiles}`);
  lines.push(`- Avg personal tasks per sync: ${summary.workbench.avgTasks}`);
  lines.push(`- Avg public queue per sync: ${summary.workbench.avgPublicQueue}`);
  lines.push(`- Avg assistant status patches per sync: ${summary.workbench.avgAssistantStatus}`);
  lines.push(`- Avg notices per sync: ${summary.workbench.avgNotices}`);
  lines.push(`- Full syncs: ${summary.workbench.fullSyncs.count}, total ${summary.workbench.fullSyncs.totalMb} MB, avg bytes ${summary.workbench.fullSyncs.avgBytes}, p95 bytes ${summary.workbench.fullSyncs.p95Bytes}`);
  lines.push(`- Delta syncs: ${summary.workbench.deltaSyncs.count}, total ${summary.workbench.deltaSyncs.totalMb} MB, avg bytes ${summary.workbench.deltaSyncs.avgBytes}, p95 bytes ${summary.workbench.deltaSyncs.p95Bytes}`);
  lines.push(`- Maintenance runs observed in sync responses: ${summary.workbench.maintenanceRuns}`);
  lines.push("");
  lines.push("## System Samples");
  lines.push("");
  lines.push(`- Samples: ${summary.system.samples}`);
  lines.push(`- Max loadtest RSS MB: ${summary.system.maxRssMb}`);
  lines.push(`- Max loadtest heap MB: ${summary.system.maxHeapUsedMb}`);
  lines.push(`- Max server RSS MB: ${summary.system.maxServerRssMb}`);
  lines.push(`- Max server CPU %: ${summary.system.maxServerCpuPct}`);
  lines.push("");
  lines.push("## Error Samples");
  lines.push("");
  if (summary.errorSamples.length === 0) {
    lines.push("- None");
  } else {
    lines.push("| Time | Scenario | Role | Request | Status | Code | Error | ms |");
    lines.push("|---|---|---|---|---:|---|---|---:|");
    for (const sample of summary.errorSamples) {
      lines.push(
        `| ${sample.ts} | ${sample.scenario} | ${sample.personaRole} | ${sample.method} ${sample.endpoint} | ${sample.status} | ${escapeCell(sample.code)} | ${escapeCell(sample.error)} | ${sample.durationMs} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- 混合写压测结果必须结合服务端日志检查 SQLite busy/locked、重复派单和任务丢失。");
  lines.push("- `summary.json` 保留机器可读明细，`raw.jsonl` 保留逐请求样本。");
  return `${lines.join("\n")}\n`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function summarizeWorkbenchSyncMode(requests: RequestLogEvent[], syncMode: "full" | "delta") {
  const rows = requests.filter((request) => request.syncMode === syncMode);
  const bytes = summarizeNumbers(rows.map((request) => request.bytes));
  const totalBytes = rows.reduce((sum, request) => sum + request.bytes, 0);
  return {
    count: rows.length,
    totalBytes,
    totalMb: round(totalBytes / 1024 / 1024, 2),
    avgBytes: bytes.avg,
    p95Bytes: bytes.p95,
    avgTasks: round(average(rows.map((request) => request.counts?.tasks).filter(isNumber))),
    avgPublicQueue: round(average(rows.map((request) => request.counts?.publicQueue).filter(isNumber))),
  };
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
