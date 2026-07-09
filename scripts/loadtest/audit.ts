import path from "node:path";
import { writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";
import {
  RequestLogEvent,
  parseArgs,
  readJsonl,
  stringArg,
} from "./common";

type RawAudit = {
  totalRequests: number;
  non2xx: number;
  systemFailures: number;
  byScenario: Record<string, number>;
  byReason: Record<string, number>;
};

type InvariantAudit = {
  multiActiveRootAssistants: number;
  duplicateCurrentPrimaryAssistants: number;
  ironingUsingOverCapacity: number;
  samples: {
    multiActiveRootAssistants: Array<{ assistantId: string; taskIds: string[] }>;
    ironingUsingOverCapacity: Array<{ buildingId: number; using: number; capacity: number }>;
  };
};

type LoadtestAudit = {
  ok: boolean;
  resultDir: string;
  raw: RawAudit;
  invariants: InvariantAudit;
};

function isRequestEvent(event: unknown): event is RequestLogEvent {
  return Boolean(event && typeof event === "object" && (event as { kind?: unknown }).kind === "request");
}

function isSystemFailure(request: RequestLogEvent): boolean {
  if (request.status >= 500 || request.timeout === true) return true;
  const text = `${request.code ?? ""} ${request.error ?? ""}`;
  return /\b(sqlite|sqlite_busy|sqlite_locked|database is locked|database locked|database busy|locked database|prisma.*timeout)\b/i.test(text);
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

async function auditRaw(dir: string): Promise<RawAudit> {
  const rows = await readJsonl(path.join(dir, "raw.jsonl"));
  const requests = rows.filter(isRequestEvent);
  const non2xx = requests.filter((request) => !request.ok);
  const systemFailures = requests.filter(isSystemFailure);
  return {
    totalRequests: requests.length,
    non2xx: non2xx.length,
    systemFailures: systemFailures.length,
    byScenario: countBy(non2xx, (request) => request.scenario),
    byReason: countBy(non2xx, (request) => `${request.code || "(no-code)"} | ${request.error || ""}`),
  };
}

async function auditInvariants(): Promise<InvariantAudit> {
  const activeRoots = await prisma.bookingTask.findMany({
    where: {
      parentTaskId: null,
      status: { in: [TaskStatus.executing, TaskStatus.paused] },
      assistantId: { not: null },
    },
    select: {
      id: true,
      assistantId: true,
    },
  });

  const activeRootsByAssistant = new Map<string, string[]>();
  for (const task of activeRoots) {
    const assistantId = task.assistantId;
    if (!assistantId) continue;
    activeRootsByAssistant.set(assistantId, [
      ...(activeRootsByAssistant.get(assistantId) ?? []),
      task.id,
    ]);
  }
  const multiActiveRootAssistants = [...activeRootsByAssistant.entries()]
    .filter(([, taskIds]) => taskIds.length > 1)
    .map(([assistantId, taskIds]) => ({ assistantId, taskIds }));

  const buildings = await prisma.building.findMany({
    select: {
      id: true,
      ironingMachines: {
        where: { status: "normal" },
        select: { id: true },
      },
    },
  });
  const capacityByBuilding = new Map(buildings.map((building) => [building.id, building.ironingMachines.length]));
  const ironingUsingRows = await prisma.bookingTask.groupBy({
    by: ["locationBuildingId"],
    where: {
      ironingStage: "using",
      status: { in: [TaskStatus.executing, TaskStatus.paused] },
    },
    _count: { _all: true },
  });
  const ironingUsingOverCapacity = ironingUsingRows
    .filter((row) => row.locationBuildingId != null)
    .map((row) => {
      const buildingId = row.locationBuildingId!;
      return {
        buildingId,
        using: row._count._all,
        capacity: capacityByBuilding.get(buildingId) ?? 0,
      };
    })
    .filter((row) => row.using > row.capacity);

  return {
    multiActiveRootAssistants: multiActiveRootAssistants.length,
    duplicateCurrentPrimaryAssistants: multiActiveRootAssistants.length,
    ironingUsingOverCapacity: ironingUsingOverCapacity.length,
    samples: {
      multiActiveRootAssistants: multiActiveRootAssistants.slice(0, 10),
      ironingUsingOverCapacity: ironingUsingOverCapacity.slice(0, 10),
    },
  };
}

function auditOk(audit: LoadtestAudit): boolean {
  return audit.raw.systemFailures === 0 &&
    audit.invariants.multiActiveRootAssistants === 0 &&
    audit.invariants.duplicateCurrentPrimaryAssistants === 0 &&
    audit.invariants.ironingUsingOverCapacity === 0;
}

function renderMarkdown(audit: LoadtestAudit): string {
  const lines = [
    "# Loadtest Audit",
    "",
    `- Result: ${audit.ok ? "PASS" : "FAIL"}`,
    `- Result dir: ${audit.resultDir}`,
    "",
    "## Raw Log",
    "",
    `- Total requests: ${audit.raw.totalRequests}`,
    `- Non-2xx: ${audit.raw.non2xx}`,
    `- System failures: ${audit.raw.systemFailures}`,
    `- By scenario: \`${JSON.stringify(audit.raw.byScenario)}\``,
    `- By reason: \`${JSON.stringify(audit.raw.byReason)}\``,
    "",
    "## Invariants",
    "",
    `- Multi active root assistants: ${audit.invariants.multiActiveRootAssistants}`,
    `- Duplicate current primary assistants: ${audit.invariants.duplicateCurrentPrimaryAssistants}`,
    `- Ironing using over capacity: ${audit.invariants.ironingUsingOverCapacity}`,
    "",
    "## Samples",
    "",
    "```json",
    JSON.stringify(audit.invariants.samples, null, 2),
    "```",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = stringArg(args, "dir", "");
  if (!dir) {
    throw new Error("请传入 --dir=loadtest/results/xxxx");
  }

  const audit: LoadtestAudit = {
    ok: false,
    resultDir: dir,
    raw: await auditRaw(dir),
    invariants: await auditInvariants(),
  };
  audit.ok = auditOk(audit);

  await writeFile(path.join(dir, "audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile(path.join(dir, "audit.md"), renderMarkdown(audit));

  console.log(renderMarkdown(audit));
  await prisma.$disconnect();
  if (!audit.ok) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
