import { createWriteStream, type WriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  LoadtestMode,
  LoadtestReportConfig,
  RawLogEvent,
  RequestLogEvent,
  booleanArg,
  byteLength,
  createSeededRandom,
  ensureDir,
  normalizeBaseUrl,
  numberArg,
  parseArgs,
  pick,
  sleep,
  stringArg,
  timestampForPath,
  tryParseJson,
  writeReportFiles,
} from "./common";

type Profile = {
  id: string;
  employeeId?: string | null;
  name: string;
  role: "photographer" | "assistant" | "assistant_leader" | "admin";
  buildingId: number;
  activeBuildingId?: number | null;
  currentRoom?: string | null;
  activeRoom?: string | null;
};

type Building = {
  id: number;
  name: string;
  rooms?: Array<{ roomNumber: string }>;
};

type Category = {
  id: number;
  name: string;
  priorityLevel: number;
  estDuration: number;
  maxDuration: number;
};

type TaskLike = {
  id: string;
  photographerId?: string;
  assistantId?: string | null;
  status?: "waiting" | "executing" | "paused" | "completed";
  priority?: number;
  ironingStage?: "none" | "waiting_machine" | "notified" | "using";
  parentTaskId?: string | null;
  isLocked?: boolean | null;
  lockReason?: string | null;
  roomNumber?: string;
  category?: { id: number; name: string; estDuration?: number; maxDuration?: number };
  collaborators?: Array<{ assistantId?: string; status?: string; role?: string }>;
};

type Persona = {
  id: string;
  role: "photographer" | "assistant" | "admin";
  profile: Profile;
  intervalMs: number;
  syncToken: string | null;
  lastFullSyncAtMs: number;
  taskCache: TaskLike[];
};

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const mode = stringArg(args, "mode", "smoke") as LoadtestMode;
const durationSec = Math.max(1, numberArg(args, "duration", mode === "smoke" ? 60 : mode === "mixed" ? 1200 : 600));
const baseUrl = normalizeBaseUrl(stringArg(args, "base-url", process.env.BASE_URL ?? "http://localhost:3000"));
const seed = Math.floor(numberArg(args, "seed", 20260708));
const random = createSeededRandom(seed);
const outDir = stringArg(args, "out-dir", path.join("loadtest", "results", `${timestampForPath()}-${mode}`));
const timeoutMs = Math.max(1000, numberArg(args, "timeout-ms", 15_000));
const photographerCount = Math.floor(numberArg(args, "photographers", mode === "smoke" ? 5 : 80));
const assistantCount = Math.floor(numberArg(args, "assistants", mode === "smoke" ? 3 : 30));
const adminCount = Math.floor(numberArg(args, "admins", mode === "smoke" ? 1 : 5));
const visiblePollMs = Math.max(500, numberArg(args, "poll-ms", mode === "smoke" ? 2000 : 3000));
const adminPollMs = Math.max(1000, numberArg(args, "admin-poll-ms", mode === "smoke" ? 4000 : 12_000));
const writeRatePerMin = Math.max(0, numberArg(args, "write-rate-per-min", mode === "mixed" ? 60 : 0));
const assistantActionChance = Math.max(0, Math.min(1, numberArg(args, "assistant-action-chance", mode === "mixed" ? 0.25 : 0)));
const fullSyncIntervalMs = Math.max(10_000, numberArg(args, "full-sync-interval-ms", 5 * 60_000));
const allowWrites = booleanArg(args, "allow-writes", false);
const allowRemote = booleanArg(args, "allow-remote", false);
const serverPid = Math.floor(numberArg(args, "server-pid", Number(process.env.SERVER_PID ?? "0"))) || undefined;
const PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON = "photographer_active_task_limit_queue";

function isWriteMode(currentMode: LoadtestMode): boolean {
  return currentMode === "mixed" || currentMode === "sweep";
}

function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function assertSafety() {
  if (!["smoke", "readonly", "mixed", "sweep"].includes(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }
  if (isWriteMode(mode) && !allowWrites) {
    throw new Error(`${mode} 会触发写操作，请显式加 --allow-writes，并确认目标是隔离测试库。`);
  }
  if (isWriteMode(mode) && !isLocalBaseUrl(baseUrl) && !allowRemote) {
    throw new Error(`拒绝对非 localhost 目标执行写压测：${baseUrl}。如确认为隔离环境，请显式加 --allow-remote。`);
  }
}

async function fetchJsonOrThrow<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

function loadtestProfiles(profiles: Profile[], role: Profile["role"], count: number): Profile[] {
  const filtered = profiles.filter((profile) => {
    const roleMatches =
      role === "assistant"
        ? profile.role === "assistant" || profile.role === "assistant_leader"
        : profile.role === role;
    return roleMatches && profile.employeeId?.startsWith(role === "photographer" ? "LT-P" : role === "admin" ? "LT-M" : "LT-A");
  });
  const fallback = profiles.filter((profile) =>
    role === "assistant"
      ? profile.role === "assistant" || profile.role === "assistant_leader"
      : profile.role === role,
  );
  const selected = (filtered.length >= count ? filtered : fallback).slice(0, count);
  if (selected.length < count) {
    throw new Error(`可用 ${role} 数量不足：需要 ${count}，实际 ${selected.length}`);
  }
  return selected;
}

function endpointForLog(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/api/tasks/") && parsed.pathname !== "/api/tasks/sweep") {
    return "/api/tasks/[id]";
  }
  return parsed.pathname;
}

async function request(
  persona: Persona,
  scenario: string,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ data: unknown; event: RequestLogEvent }> {
  const url = `${baseUrl}${endpoint}`;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  let text = "";
  let data: unknown = null;
  let error = "";
  let code = "";
  let timeout = false;

  try {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: body == null ? undefined : { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    text = await response.text();
    data = tryParseJson(text);
    if (!response.ok) {
      if (data && typeof data === "object") {
        const record = data as Record<string, unknown>;
        error = typeof record.error === "string" ? record.error : text.slice(0, 200);
        code = typeof record.code === "string" ? record.code : "";
      } else {
        error = text.slice(0, 200);
      }
    }
  } catch (caught) {
    const err = caught instanceof Error ? caught : new Error(String(caught));
    timeout = err.name === "AbortError";
    error = timeout ? "timeout" : err.message;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = performance.now() - started;
  const event: RequestLogEvent = {
    kind: "request",
    ts: new Date().toISOString(),
    elapsedMs: Date.now() - startedAtMs,
    scenario,
    personaRole: persona.role,
    personaId: persona.profile.id,
    method,
    endpoint: endpointForLog(url),
    status,
    ok: status >= 200 && status < 400,
    durationMs,
    bytes: byteLength(text),
    error: error || undefined,
    code: code || undefined,
    timeout: timeout || undefined,
  };

  if (event.endpoint === "/api/workbench/sync" && data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    event.syncMode = record.syncMode === "delta" ? "delta" : record.syncMode === "full" ? "full" : undefined;
    event.counts = {
      profiles: Array.isArray(record.profiles) ? record.profiles.length : undefined,
      tasks: Array.isArray(record.tasks) ? record.tasks.length : undefined,
      publicQueue: Array.isArray(record.publicQueue) ? record.publicQueue.length : undefined,
      assistantStatus: Array.isArray(record.assistantStatus) ? record.assistantStatus.length : undefined,
      notices: Array.isArray(record.notices) ? record.notices.length : undefined,
    };
    const maintenance = record.maintenance;
    event.maintenanceRan =
      !!maintenance &&
      typeof maintenance === "object" &&
      (maintenance as Record<string, unknown>).skipped === false;
  }

  logEvent(event);
  return { data, event };
}

function personaBuildingId(profile: Profile): number {
  return profile.activeBuildingId ?? profile.buildingId;
}

function syncEndpoint(persona: Persona): string {
  const { profile, role } = persona;
  const view = role === "assistant" ? "assistant" : role === "photographer" ? "photographer" : "admin";
  const params = new URLSearchParams({
    profileId: profile.id,
    role: profile.role,
    buildingId: String(personaBuildingId(profile)),
    view,
  });
  const syncToken = persona.syncToken;
  const shouldFullSync = !syncToken || Date.now() - persona.lastFullSyncAtMs >= fullSyncIntervalMs;
  if (shouldFullSync) {
    params.set("full", "1");
  } else {
    params.set("since", syncToken);
  }
  return `/api/workbench/sync?${params.toString()}`;
}

function adminTasksEndpoint(profile: Profile): string {
  const params = new URLSearchParams({
    todayOnly: "true",
    view: "admin",
    payload: "adminList",
    buildingId: String(profile.buildingId),
    limit: "300",
  });
  return `/api/tasks?${params.toString()}`;
}

function taskBelongsToAssistant(task: TaskLike, assistantId: string): boolean {
  return task.assistantId === assistantId ||
    (task.collaborators ?? []).some((collaborator) => collaborator.assistantId === assistantId && collaborator.status !== "left");
}

function isIroningTask(task: TaskLike): boolean {
  return task.category?.name?.includes("熨") === true;
}

function hasPhotographerLimitQueuedTask(tasks: TaskLike[], photographerId: string): boolean {
  return tasks.some((task) =>
    task.photographerId === photographerId &&
    task.status === "waiting" &&
    task.isLocked === true &&
    task.lockReason === PHOTOGRAPHER_LIMIT_QUEUE_LOCK_REASON
  );
}

function taskStatusForAssistant(task: TaskLike, assistantId: string): TaskLike["status"] | string | undefined {
  const participant = (task.collaborators ?? []).find((collaborator) =>
    collaborator.assistantId === assistantId &&
    collaborator.status !== "left"
  );
  return participant?.status ?? task.status;
}

function assistantHasWorkingTask(tasks: TaskLike[], assistantId: string): boolean {
  return tasks.some((task) => {
    if (!taskBelongsToAssistant(task, assistantId)) return false;
    const status = taskStatusForAssistant(task, assistantId);
    return status === "executing" || status === "paused";
  });
}

function canAttemptStartWaitingTask(task: TaskLike, assistantId: string, hasWorkingTask: boolean): boolean {
  const status = taskStatusForAssistant(task, assistantId);
  if (status !== "waiting") return false;
  if (hasWorkingTask && !task.parentTaskId) return false;
  if (!isIroningTask(task)) return true;
  if (task.ironingStage === "waiting_machine") return false;
  return true;
}

function startableWaitingTasksForAssistant(tasks: TaskLike[], assistantId: string, hasWorkingTask: boolean): TaskLike[] {
  const candidates = tasks
    .filter((task) => canAttemptStartWaitingTask(task, assistantId, hasWorkingTask))
    .sort((a, b) =>
      (a.priority ?? 999) - (b.priority ?? 999) ||
      (isIroningTask(a) ? 0 : 1) - (isIroningTask(b) ? 0 : 1)
    );
  const highestPriority = candidates[0]?.priority;
  return highestPriority == null
    ? candidates
    : candidates.filter((task) => task.priority === highestPriority);
}

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : null;
}

function mergeIncrementalTasks(
  current: TaskLike[],
  incoming: TaskLike[],
  visibleIds: string[] | null,
  syncMode: "full" | "delta",
): TaskLike[] {
  if (syncMode !== "delta") return incoming;

  const byId = new Map<string, TaskLike>();
  for (const task of current) byId.set(task.id, task);
  for (const task of incoming) {
    const existing = byId.get(task.id);
    byId.set(task.id, existing ? { ...existing, ...task } : task);
  }

  if (!visibleIds) return [...byId.values()];
  return visibleIds
    .map((id) => byId.get(id))
    .filter((task): task is TaskLike => task != null);
}

function hasMissingVisibleTaskDetails(
  current: TaskLike[],
  incoming: TaskLike[],
  visibleIds: string[] | null,
): boolean {
  if (!visibleIds) return false;
  const knownIds = new Set<string>();
  for (const task of current) knownIds.add(task.id);
  for (const task of incoming) knownIds.add(task.id);
  return visibleIds.some((id) => !knownIds.has(id));
}

function applyPersonaSyncCache(persona: Persona, data: Record<string, unknown>): TaskLike[] {
  const incomingTasks = Array.isArray(data.tasks) ? data.tasks as TaskLike[] : [];
  const syncMode = data.syncMode === "delta" ? "delta" : "full";
  const taskIds = stringIds(data.taskIds);

  if (
    syncMode === "delta" &&
    (!taskIds || data.syncTruncated === true || hasMissingVisibleTaskDetails(persona.taskCache, incomingTasks, taskIds))
  ) {
    persona.syncToken = null;
    persona.lastFullSyncAtMs = 0;
    return persona.taskCache;
  }

  const nextTasks = mergeIncrementalTasks(persona.taskCache, incomingTasks, taskIds, syncMode);
  persona.taskCache = nextTasks;
  persona.syncToken = typeof data.syncToken === "string" ? data.syncToken : null;
  if (syncMode === "full") {
    persona.lastFullSyncAtMs = Date.now();
  }
  return nextTasks;
}

async function maybeCreateTask(
  persona: Persona,
  tasks: TaskLike[],
  buildings: Building[],
  categories: Category[],
): Promise<void> {
  if (persona.role !== "photographer") return;
  const ticksPerMinute = 60_000 / visiblePollMs;
  const probability = writeRatePerMin / Math.max(1, photographerCount) / Math.max(1, ticksPerMinute);
  if (random() > probability) return;
  if (hasPhotographerLimitQueuedTask(tasks, persona.profile.id)) return;

  const building = buildings.find((item) => item.id === persona.profile.buildingId) ?? pick(buildings, random);
  const rooms = building.rooms ?? [];
  const roomNumber = rooms.length > 0 ? pick(rooms, random).roomNumber : persona.profile.currentRoom ?? "公共区";
  const category = pick(categories, random);
  await request(persona, "mixed-create", "POST", "/api/tasks", {
    photographerId: persona.profile.id,
    locationBuildingId: building.id,
    roomNumber,
    categoryId: category.id,
    estMinutes: category.estDuration || category.maxDuration || 10,
    note: "压测自动创建",
  });
}

async function maybeAssistantAction(persona: Persona, tasks: TaskLike[]): Promise<void> {
  if (persona.role !== "assistant" || random() > assistantActionChance) return;
  const ownTasks = tasks.filter((task) => taskBelongsToAssistant(task, persona.profile.id));
  const hasWorkingTask = assistantHasWorkingTask(ownTasks, persona.profile.id);
  const waiting = startableWaitingTasksForAssistant(ownTasks, persona.profile.id, hasWorkingTask)[0];
  const paused = ownTasks.find((task) => taskStatusForAssistant(task, persona.profile.id) === "paused");
  const executing = ownTasks.find((task) => taskStatusForAssistant(task, persona.profile.id) === "executing");

  if (waiting) {
    await request(persona, "mixed-start", "PATCH", `/api/tasks/${waiting.id}`, {
      action: "start",
      actorAssistantId: persona.profile.id,
    });
    return;
  }
  if (paused) {
    await request(persona, "mixed-resume", "PATCH", `/api/tasks/${paused.id}`, {
      action: "start",
      actorAssistantId: persona.profile.id,
    });
    return;
  }
  if (executing) {
    const shouldComplete = random() < 0.8;
    await request(persona, shouldComplete ? "mixed-complete" : "mixed-pause", "PATCH", `/api/tasks/${executing.id}`, {
      action: shouldComplete ? "complete" : "pause",
      actorAssistantId: persona.profile.id,
    });
  }
}

async function personaLoop(
  persona: Persona,
  buildings: Building[],
  categories: Category[],
): Promise<void> {
  await sleep(Math.floor(random() * persona.intervalMs));
  while (Date.now() < stopAtMs) {
    const loopStarted = Date.now();
    if (mode === "sweep") {
      await request(persona, "sweep", "POST", "/api/tasks/sweep");
    } else if (persona.role === "admin") {
      await request(persona, mode === "mixed" ? "mixed-admin-list" : "readonly-admin-list", "GET", adminTasksEndpoint(persona.profile));
    } else {
      const sync = await request(
        persona,
        mode === "mixed" ? "mixed-sync" : "readonly-sync",
        "GET",
        syncEndpoint(persona),
      );
      const data = sync.data && typeof sync.data === "object" ? sync.data as Record<string, unknown> : {};
      const tasks = applyPersonaSyncCache(persona, data);
      if (mode === "mixed") {
        await maybeCreateTask(persona, tasks, buildings, categories);
        await maybeAssistantAction(persona, tasks);
      }
    }

    const elapsed = Date.now() - loopStarted;
    const jitter = Math.floor((random() - 0.5) * persona.intervalMs * 0.25);
    await sleep(Math.max(100, persona.intervalMs + jitter - elapsed));
  }
}

async function sampleLoop() {
  let previousCpu = process.cpuUsage();
  while (Date.now() < stopAtMs) {
    const memory = process.memoryUsage();
    const event = {
      kind: "sample",
      ts: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      rssMb: Math.round(memory.rss / 1024 / 102.4) / 10,
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 102.4) / 10,
    } as RawLogEvent;
    previousCpu = process.cpuUsage(previousCpu);
    Object.assign(event, await readServerSample());
    logEvent(event);
    await sleep(5000);
  }
}

async function readServerSample(): Promise<Partial<RawLogEvent>> {
  if (!serverPid) return {};
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(serverPid), "-o", "%cpu=,rss="]);
    const [cpuRaw, rssRaw] = stdout.trim().split(/\s+/);
    const cpu = Number(cpuRaw);
    const rssKb = Number(rssRaw);
    return {
      serverPid,
      serverCpuPct: Number.isFinite(cpu) ? cpu : undefined,
      serverRssMb: Number.isFinite(rssKb) ? Math.round(rssKb / 102.4) / 10 : undefined,
    } as Partial<RawLogEvent>;
  } catch {
    return { serverPid } as Partial<RawLogEvent>;
  }
}

function logEvent(event: RawLogEvent) {
  rawEvents.push(event);
  if (!rawStream) return;
  rawStream.write(`${JSON.stringify(event)}\n`);
}

async function gitCommit(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function main() {
  assertSafety();
  await ensureDir(outDir);
  rawStream = createWriteStream(path.join(outDir, "raw.jsonl"), { flags: "a" });

  const [profiles, buildings, categories] = await Promise.all([
    fetchJsonOrThrow<Profile[]>("/api/profiles"),
    fetchJsonOrThrow<Building[]>("/api/buildings"),
    fetchJsonOrThrow<Category[]>("/api/categories"),
  ]);

  const photographers = loadtestProfiles(profiles, "photographer", photographerCount);
  const assistants = loadtestProfiles(profiles, "assistant", assistantCount);
  const admins = loadtestProfiles(profiles, "admin", adminCount);
  const personas: Persona[] = [
    ...photographers.map((profile) => ({
      id: profile.id,
      role: "photographer" as const,
      profile,
      intervalMs: visiblePollMs,
      syncToken: null,
      lastFullSyncAtMs: 0,
      taskCache: [],
    })),
    ...assistants.map((profile) => ({
      id: profile.id,
      role: "assistant" as const,
      profile,
      intervalMs: visiblePollMs,
      syncToken: null,
      lastFullSyncAtMs: 0,
      taskCache: [],
    })),
    ...admins.map((profile) => ({
      id: profile.id,
      role: "admin" as const,
      profile,
      intervalMs: adminPollMs,
      syncToken: null,
      lastFullSyncAtMs: 0,
      taskCache: [],
    })),
  ];

  config.gitCommit = await gitCommit();
  await writeReportFiles(outDir, [], config);
  console.log(`Load test started: mode=${mode} personas=${personas.length} duration=${durationSec}s out=${outDir}`);

  await Promise.allSettled([
    sampleLoop(),
    ...personas.map((persona) => personaLoop(persona, buildings, categories)),
  ]);

  config.endedAt = new Date().toISOString();
  const stream = rawStream;
  if (!stream) throw new Error("raw stream was not initialized");
  stream.end();
  await new Promise<void>((resolve) => stream.on("finish", resolve));
  await writeReportFiles(outDir, rawEvents, config);
  console.log(`Load test complete: ${path.join(outDir, "summary.md")}`);
}

const startedAtMs = Date.now();
const stopAtMs = startedAtMs + durationSec * 1000;
const rawEvents: RawLogEvent[] = [];
let rawStream: WriteStream | null = null;
const config: LoadtestReportConfig = {
  mode,
  baseUrl,
  durationSec,
  outDir,
  startedAt: new Date(startedAtMs).toISOString(),
  personas: {
    photographers: photographerCount,
    assistants: assistantCount,
    admins: adminCount,
  },
  options: {
    seed,
    pollMs: visiblePollMs,
    adminPollMs,
    writeRatePerMin,
    assistantActionChance,
    fullSyncIntervalMs,
    timeoutMs,
    allowWrites,
    allowRemote,
    serverPid: serverPid ?? null,
  },
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  rawStream?.end();
});
