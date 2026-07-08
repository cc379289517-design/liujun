import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  LoadtestReportConfig,
  parseArgs,
  readJsonl,
  stringArg,
  writeReportFiles,
} from "./common";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = stringArg(args, "dir", "");
  if (!dir) {
    throw new Error("请传入 --dir=loadtest/results/xxxx");
  }

  const configPath = path.join(dir, "config.json");
  const rawPath = path.join(dir, "raw.jsonl");
  const config = JSON.parse(await readFile(configPath, "utf8")) as LoadtestReportConfig;
  const events = await readJsonl(rawPath);
  await writeReportFiles(dir, events, config);
  console.log(`Report refreshed: ${path.join(dir, "summary.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
