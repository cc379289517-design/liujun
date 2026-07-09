import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { numberArg, parseArgs, stringArg } from "./loadtest/common";

type MetricName = "navigation" | "lcp" | "cls" | "longtask" | "interaction" | "visibility";

type MetricSample = {
  name: MetricName;
  value: number;
  rating?: string;
  metadata?: Record<string, unknown>;
};

type MetricRecord = {
  receivedAt?: string;
  sessionId?: string;
  path?: string;
  role?: string;
  reason?: string;
  viewport?: { width?: number; height?: number; dpr?: number };
  connection?: { effectiveType?: string };
  metrics?: MetricSample[];
};

type MetricSummary = {
  count: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
  needsImprovement: number;
  poor: number;
};

type Report = {
  ok: boolean;
  source: string;
  records: number;
  sessions: number;
  metrics: Record<string, MetricSummary>;
  byPath: Array<{ key: string; count: number; interactionP75: number; lcpP75: number; longtaskP95: number }>;
  byRole: Array<{ key: string; count: number; interactionP75: number; lcpP75: number; longtaskP95: number }>;
  failures: string[];
};

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(__dirname, "..");
const METRIC_NAMES: MetricName[] = ["navigation", "lcp", "cls", "longtask", "interaction", "visibility"];

async function loadDeployEnv() {
  const envPath = path.join(projectDir, ".mini-deploy.env");
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
  }
}

function todayForPath(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function splitShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

async function readSource(args: Map<string, string>): Promise<{ source: string; text: string }> {
  const file = stringArg(args, "file", path.join(projectDir, "logs", `client-metrics-${todayForPath()}.jsonl`));
  const sshTarget = stringArg(args, "ssh-target", "");
  if (!sshTarget) {
    return { source: file, text: await readFile(file, "utf8") };
  }

  const remoteLogDir = stringArg(args, "remote-log-dir", process.env.MINI_PROJECT_DIR ? `${process.env.MINI_PROJECT_DIR}/logs` : "logs");
  const remoteFile = stringArg(args, "remote-file", path.posix.join(remoteLogDir, path.basename(file)));
  const sshOptions = splitShellArgs(stringArg(args, "ssh-opts", process.env.SSH_OPTS ?? ""));
  const { stdout } = await execFileAsync("ssh", [...sshOptions, sshTarget, `cat ${shellQuote(remoteFile)}`], {
    timeout: 15_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { source: `${sshTarget}:${remoteFile}`, text: stdout };
}

function parseRecords(text: string): MetricRecord[] {
  const records: MetricRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as MetricRecord;
      if (Array.isArray(parsed.metrics)) records.push(parsed);
    } catch {
      // Ignore corrupt trailing lines; append-only logs can be read mid-write.
    }
  }
  return records;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

function summarize(samples: MetricSample[]): MetricSummary {
  const values = samples.map((sample) => sample.value).filter((value) => Number.isFinite(value));
  return {
    count: values.length,
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p95: percentile(values, 95),
    max: percentile(values, 100),
    needsImprovement: samples.filter((sample) => sample.rating === "needs-improvement").length,
    poor: samples.filter((sample) => sample.rating === "poor").length,
  };
}

function sampleMetrics(records: MetricRecord[], name: MetricName): MetricSample[] {
  return records.flatMap((record) => record.metrics ?? []).filter((metric) => metric.name === name && Number.isFinite(metric.value));
}

function groupRows(records: MetricRecord[], keyFor: (record: MetricRecord) => string) {
  const groups = new Map<string, MetricRecord[]>();
  for (const record of records) {
    const key = keyFor(record) || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      interactionP75: summarize(sampleMetrics(rows, "interaction")).p75,
      lcpP75: summarize(sampleMetrics(rows, "lcp")).p75,
      longtaskP95: summarize(sampleMetrics(rows, "longtask")).p95,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function buildReport(source: string, records: MetricRecord[], args: Map<string, string>): Report {
  const thresholds = {
    interactionP75: numberArg(args, "interaction-p75-max", 200),
    lcpP75: numberArg(args, "lcp-p75-max", 2500),
    clsP75: numberArg(args, "cls-p75-max", 0.1),
    longtaskP95: numberArg(args, "longtask-p95-max", 250),
  };
  const metrics = Object.fromEntries(
    METRIC_NAMES.map((name) => [name, summarize(sampleMetrics(records, name))]),
  );
  const failures: string[] = [];
  if (metrics.interaction.count > 0 && metrics.interaction.p75 > thresholds.interactionP75) {
    failures.push(`interaction p75 ${metrics.interaction.p75}ms > ${thresholds.interactionP75}ms`);
  }
  if (metrics.lcp.count > 0 && metrics.lcp.p75 > thresholds.lcpP75) {
    failures.push(`LCP p75 ${metrics.lcp.p75}ms > ${thresholds.lcpP75}ms`);
  }
  if (metrics.cls.count > 0 && metrics.cls.p75 > thresholds.clsP75) {
    failures.push(`CLS p75 ${metrics.cls.p75} > ${thresholds.clsP75}`);
  }
  if (metrics.longtask.count > 0 && metrics.longtask.p95 > thresholds.longtaskP95) {
    failures.push(`longtask p95 ${metrics.longtask.p95}ms > ${thresholds.longtaskP95}ms`);
  }

  return {
    ok: failures.length === 0,
    source,
    records: records.length,
    sessions: new Set(records.map((record) => record.sessionId).filter(Boolean)).size,
    metrics,
    byPath: groupRows(records, (record) => record.path ?? "unknown"),
    byRole: groupRows(records, (record) => record.role ?? "unknown"),
    failures,
  };
}

function renderSummary(summary: MetricSummary): string {
  if (summary.count === 0) return "count=0";
  const weak = summary.needsImprovement + summary.poor;
  const weakRate = Math.round((weak / summary.count) * 1000) / 10;
  return `count=${summary.count}, p50=${summary.p50}, p75=${summary.p75}, p95=${summary.p95}, max=${summary.max}, weak=${weakRate}%`;
}

function render(report: Report): string {
  const lines = [
    "# Client Metrics Report",
    "",
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Source: ${report.source}`,
    `- Records: ${report.records}`,
    `- Sessions: ${report.sessions}`,
    "",
    "## Metrics",
    "",
  ];

  for (const name of METRIC_NAMES) {
    lines.push(`- ${name}: ${renderSummary(report.metrics[name])}`);
  }

  lines.push("", "## Hot Paths", "");
  for (const row of report.byPath) {
    lines.push(`- ${row.key}: records=${row.count}, interactionP75=${row.interactionP75}, lcpP75=${row.lcpP75}, longtaskP95=${row.longtaskP95}`);
  }

  lines.push("", "## Roles", "");
  for (const row of report.byRole) {
    lines.push(`- ${row.key}: records=${row.count}, interactionP75=${row.interactionP75}, lcpP75=${row.lcpP75}, longtaskP95=${row.longtaskP95}`);
  }

  if (report.failures.length > 0) {
    lines.push("", "## Failures", "");
    report.failures.forEach((failure) => lines.push(`- ${failure}`));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  await loadDeployEnv();
  const args = parseArgs(process.argv.slice(2));
  const { source, text } = await readSource(args);
  const records = parseRecords(text);
  const report = buildReport(source, records, args);
  console.log(render(report));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
