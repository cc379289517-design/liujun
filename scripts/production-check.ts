import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { byteLength, numberArg, parseArgs, stringArg } from "./loadtest/common";

type CheckStatus = "pass" | "fail" | "warn";

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  durationMs?: number;
  bytes?: number;
};

type FetchResult = {
  status: number;
  ok: boolean;
  text: string;
  durationMs: number;
  bytes: number;
};

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(__dirname, "..");

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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function defaultBaseUrl(): string {
  if (process.env.PROD_BASE_URL) return process.env.PROD_BASE_URL;
  if (process.env.MINI_HOST) {
    return `http://${process.env.MINI_HOST}:${process.env.MINI_PORT || "3000"}`;
  }
  return "http://127.0.0.1:3000";
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

function result(name: string, status: CheckStatus, detail: string, extra: Partial<CheckResult> = {}): CheckResult {
  return { name, status, detail, ...extra };
}

function fetchMetrics(response: FetchResult): Partial<CheckResult> {
  return { durationMs: response.durationMs, bytes: response.bytes };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text,
      durationMs: Math.round(performance.now() - started),
      bytes: byteLength(text),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkJsonEndpoint(name: string, url: string, timeoutMs: number, maxBytes: number): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    if (!response.ok) {
      return result(name, "fail", `HTTP ${response.status}`, fetchMetrics(response));
    }
    try {
      JSON.parse(response.text);
    } catch {
      return result(name, "fail", "响应不是合法 JSON", fetchMetrics(response));
    }
    if (response.bytes > maxBytes) {
      return result(name, "fail", `响应体 ${response.bytes} bytes 超过阈值 ${maxBytes}`, fetchMetrics(response));
    }
    return result(name, "pass", `HTTP ${response.status}, ${response.bytes} bytes`, fetchMetrics(response));
  } catch (error) {
    return result(name, "fail", error instanceof Error ? error.message : String(error));
  }
}

async function checkPage(name: string, url: string, timeoutMs: number, maxBytes: number): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    if (!response.ok) return result(name, "fail", `HTTP ${response.status}`, fetchMetrics(response));
    if (!response.text.includes("<!DOCTYPE html") && !response.text.includes("<html")) {
      return result(name, "fail", "页面响应不像 HTML", fetchMetrics(response));
    }
    if (response.bytes > maxBytes) {
      return result(name, "fail", `页面体积 ${response.bytes} bytes 超过阈值 ${maxBytes}`, fetchMetrics(response));
    }
    return result(name, "pass", `HTTP ${response.status}, ${response.bytes} bytes`, fetchMetrics(response));
  } catch (error) {
    return result(name, "fail", error instanceof Error ? error.message : String(error));
  }
}

async function checkWorkbenchSync(baseUrl: string, args: Map<string, string>, timeoutMs: number): Promise<CheckResult[]> {
  const profileId = stringArg(args, "profile-id", "health-check");
  const role = stringArg(args, "role", "photographer");
  const buildingId = stringArg(args, "building-id", "1");
  const view = stringArg(args, "view", "photographer");
  const fullMaxBytes = numberArg(args, "full-max-bytes", 100_000);
  const deltaMaxBytes = numberArg(args, "delta-max-bytes", 10_000);

  const fullUrl = `${baseUrl}/api/workbench/sync?${new URLSearchParams({
    profileId,
    role,
    buildingId,
    view,
    full: "1",
  })}`;
  const checks: CheckResult[] = [];
  let token = "";
  try {
    const response = await fetchWithTimeout(fullUrl, timeoutMs);
    if (!response.ok) {
      checks.push(result("workbench full sync", "fail", `HTTP ${response.status}`, fetchMetrics(response)));
      return checks;
    }
    const parsed = JSON.parse(response.text) as { syncToken?: unknown };
    if (response.bytes > fullMaxBytes) {
      checks.push(result("workbench full sync", "fail", `响应体 ${response.bytes} bytes 超过阈值 ${fullMaxBytes}`, fetchMetrics(response)));
    } else {
      checks.push(result("workbench full sync", "pass", `HTTP ${response.status}, ${response.bytes} bytes`, fetchMetrics(response)));
    }
    token = typeof parsed.syncToken === "string" ? parsed.syncToken : "";
  } catch (error) {
    checks.push(result("workbench full sync", "fail", error instanceof Error ? error.message : String(error)));
    return checks;
  }
  if (checks.some((check) => check.name === "workbench full sync" && check.status === "fail")) return checks;
  if (!token) {
    checks.push(result("workbench delta sync", "fail", "full sync 未返回 syncToken"));
    return checks;
  }

  const deltaUrl = `${baseUrl}/api/workbench/sync?${new URLSearchParams({
    profileId,
    role,
    buildingId,
    view,
    since: token,
  })}`;
  checks.push(await checkJsonEndpoint("workbench delta sync", deltaUrl, timeoutMs, deltaMaxBytes));
  return checks;
}

async function checkLocalBackup(dir: string, maxAgeMinutes: number): Promise<CheckResult> {
  try {
    const entries = await readdir(dir);
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".db.gz"))
        .map(async (entry) => {
          const filePath = path.join(dir, entry);
          const stats = await stat(filePath);
          return { filePath, mtimeMs: stats.mtimeMs };
        }),
    );
    const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) return result("sqlite backup freshness", "fail", `未找到 .db.gz 备份：${dir}`);
    const ageMinutes = Math.round((Date.now() - latest.mtimeMs) / 60_000);
    if (ageMinutes > maxAgeMinutes) {
      return result("sqlite backup freshness", "fail", `最近备份 ${ageMinutes} 分钟前，超过阈值 ${maxAgeMinutes}`);
    }
    return result("sqlite backup freshness", "pass", `最近备份 ${ageMinutes} 分钟前：${latest.filePath}`);
  } catch (error) {
    return result("sqlite backup freshness", "fail", error instanceof Error ? error.message : String(error));
  }
}

async function checkRemoteBackup(target: string, sshOptions: string[], dir: string, maxAgeMinutes: number): Promise<CheckResult> {
  const command = `find ${shellQuote(dir)} -name '*.db.gz' -mmin -${maxAgeMinutes} -print -quit`;
  try {
    const { stdout } = await execFileAsync("ssh", [...sshOptions, target, command], { timeout: 10_000 });
    const found = stdout.trim();
    if (!found) {
      return result("remote sqlite backup freshness", "fail", `远程 ${dir} 内没有 ${maxAgeMinutes} 分钟内的 .db.gz 备份`);
    }
    return result("remote sqlite backup freshness", "pass", found);
  } catch (error) {
    return result("remote sqlite backup freshness", "fail", error instanceof Error ? error.message : String(error));
  }
}

function render(results: CheckResult[]): string {
  const lines = ["# Production Check", ""];
  for (const item of results) {
    const metrics = [
      item.durationMs != null ? `${item.durationMs}ms` : "",
      item.bytes != null ? `${item.bytes} bytes` : "",
    ].filter(Boolean);
    lines.push(`- ${item.status.toUpperCase()} ${item.name}: ${item.detail}${metrics.length ? ` (${metrics.join(", ")})` : ""}`);
  }
  lines.push("");
  lines.push(results.some((item) => item.status === "fail") ? "Result: FAIL" : "Result: PASS");
  return lines.join("\n");
}

async function main() {
  await loadDeployEnv();
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(stringArg(args, "base-url", defaultBaseUrl()));
  const timeoutMs = numberArg(args, "timeout-ms", 5_000);
  const configMaxBytes = numberArg(args, "config-max-bytes", 200_000);
  const pageMaxBytes = numberArg(args, "page-max-bytes", 1_000_000);
  const backupMaxAgeMinutes = numberArg(args, "backup-max-age-min", 24 * 60);

  const results: CheckResult[] = [];
  results.push(await checkJsonEndpoint("config api", `${baseUrl}/api/config`, timeoutMs, configMaxBytes));
  results.push(await checkPage("photographer page", `${baseUrl}/photographer`, timeoutMs, pageMaxBytes));
  results.push(...await checkWorkbenchSync(baseUrl, args, timeoutMs));

  const backupDir = stringArg(args, "backup-dir", "");
  const sshTarget = stringArg(args, "ssh-target", "");
  const sshOptions = splitShellArgs(stringArg(args, "ssh-opts", process.env.SSH_OPTS ?? ""));
  const remoteBackupDir = stringArg(args, "remote-backup-dir", process.env.MINI_PROJECT_DIR ? `${process.env.MINI_PROJECT_DIR}/database-backups` : "");
  if (backupDir) {
    results.push(await checkLocalBackup(backupDir, backupMaxAgeMinutes));
  } else if (sshTarget && remoteBackupDir) {
    results.push(await checkRemoteBackup(sshTarget, sshOptions, remoteBackupDir, backupMaxAgeMinutes));
  }

  console.log(render(results));
  if (results.some((item) => item.status === "fail")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
