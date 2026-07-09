import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseArgs, stringArg } from "./loadtest/common";

type GateResult = {
  name: string;
  ok: boolean;
  command: string;
  output: string;
};

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(__dirname, "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

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

function timestampForPath(date = new Date()) {
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

function defaultSshTarget() {
  if (!process.env.MINI_HOST) return "";
  return process.env.MINI_USER ? `${process.env.MINI_USER}@${process.env.MINI_HOST}` : process.env.MINI_HOST;
}

function appendArg(args: string[], name: string, value: string) {
  if (!value) return;
  args.push(`--${name}=${value}`);
}

function commandText(script: string, args: string[]) {
  return `npm run ${script}${args.length ? ` -- ${args.join(" ")}` : ""}`;
}

async function runGate(name: string, script: string, args: string[]): Promise<GateResult> {
  const command = commandText(script, args);
  try {
    const { stdout, stderr } = await execFileAsync(npmBin, ["run", script, "--", ...args], {
      cwd: projectDir,
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { name, ok: true, command, output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim() };
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string };
    return {
      name,
      ok: false,
      command,
      output: `${failed.stdout ?? ""}${failed.stderr ? `\n${failed.stderr}` : ""}${failed.message ? `\n${failed.message}` : ""}`.trim(),
    };
  }
}

function render(results: GateResult[]) {
  const ok = results.every((result) => result.ok);
  const lines = [
    "# Daily Ops Check",
    "",
    `- Result: ${ok ? "PASS" : "FAIL"}`,
    `- Generated at: ${new Date().toISOString()}`,
    "",
    "## Gates",
    "",
  ];

  for (const result of results) {
    lines.push(`- ${result.ok ? "PASS" : "FAIL"} ${result.name}: \`${result.command}\``);
  }

  for (const result of results) {
    lines.push("", `## ${result.name}`, "", "```text", result.output || "(no output)", "```");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  await loadDeployEnv();
  const args = parseArgs(process.argv.slice(2));
  const sshTarget = stringArg(args, "ssh-target", defaultSshTarget());
  const projectDirRemote = stringArg(args, "remote-project-dir", process.env.MINI_PROJECT_DIR ?? "");
  const remoteBackupDir = stringArg(args, "remote-backup-dir", projectDirRemote ? `${projectDirRemote}/database-backups` : "");
  const remoteLogDir = stringArg(args, "remote-log-dir", projectDirRemote ? `${projectDirRemote}/logs` : "");
  const backupMaxAgeMin = stringArg(args, "backup-max-age-min", "1440");
  const reportDir = stringArg(args, "out-dir", path.join(projectDir, "ops-reports"));
  const outFile = stringArg(args, "out-file", path.join(reportDir, `daily-check-${timestampForPath()}.md`));

  const prodArgs: string[] = [];
  appendArg(prodArgs, "ssh-target", sshTarget);
  appendArg(prodArgs, "remote-backup-dir", remoteBackupDir);
  appendArg(prodArgs, "backup-max-age-min", backupMaxAgeMin);
  appendArg(prodArgs, "full-max-bytes", stringArg(args, "full-max-bytes", ""));
  appendArg(prodArgs, "delta-max-bytes", stringArg(args, "delta-max-bytes", ""));

  const metricsArgs: string[] = [];
  appendArg(metricsArgs, "ssh-target", sshTarget);
  appendArg(metricsArgs, "remote-log-dir", remoteLogDir);
  appendArg(metricsArgs, "interaction-p75-max", stringArg(args, "interaction-p75-max", ""));
  appendArg(metricsArgs, "lcp-p75-max", stringArg(args, "lcp-p75-max", ""));
  appendArg(metricsArgs, "cls-p75-max", stringArg(args, "cls-p75-max", ""));
  appendArg(metricsArgs, "longtask-p95-max", stringArg(args, "longtask-p95-max", ""));

  const results = [
    await runGate("Production Check", "prod:check", prodArgs),
    await runGate("Client Metrics Report", "client-metrics:report", metricsArgs),
  ];

  const report = render(results);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, report, "utf8");
  console.log(report);
  console.log(`Report saved: ${outFile}`);

  if (!results.every((result) => result.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
