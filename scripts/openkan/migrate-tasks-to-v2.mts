// scripts/openkan/migrate-tasks-to-v2.mts — Vendored from OpenKan 0.7.0
// Source: https://raw.githubusercontent.com/PolderLabsVOF/openkan/2488a00/scripts/migrate-tasks-to-v2.ts
// Commit: 2488a00

// This is a standalone migration script that walks `.ok/tasks/tsk-*.json` (legacy v1 flat files),
// converts each into the v2 directory form (`.ok/tasks/<id>/task.json`),
// and backs up the original as `.ok/tasks/<id>/task.v1.json` inside the
// new directory. Idempotent: a task with both v2 and v1 backup already in
// place is reported as skipped.
//
// Usage:
//   node --experimental-strip-types scripts/openkan/migrate-tasks-to-v2.mts [root]
// where `root` is the project root containing `.ok/`. Defaults to cwd.
//
// Exit code is 0 on success, 1 if any task fails to migrate. The script
// never aborts mid-run on a single failure; it logs the error and
// continues so partial progress is preserved and the operator can
// inspect the offending file.

import { promises as fs } from "node:fs";
import * as path from "node:path";

interface MigrationReport {
  root: string;
  scanned: number;
  migrated: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}

interface TaskV1 {
  schema: "ok.task.v1";
  id: string;
  title: string;
  status: string;
  [key: string]: unknown;
}

function isTaskV1(obj: unknown): obj is TaskV1 {
  return typeof obj === "object" && obj !== null && (obj as TaskV1).schema === "ok.task.v1";
}

function convertTaskV1ToV2(task: TaskV1): Record<string, unknown> {
  // Basic conversion from v1 to v2 schema
  const v2: Record<string, unknown> = {
    schema: "ok.task.v2",
    id: task.id,
    title: task.title,
    status: task.status,
  };
  // Copy over other fields that might exist
  const skip = ["schema", "id", "title", "status"];
  for (const key of Object.keys(task)) {
    if (!skip.includes(key)) {
      v2[key] = task[key];
    }
  }
  return v2;
}

async function listV1FlatFiles(tasksDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(tasksDir);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return [];
    throw e;
  }
  return names.filter((n) => /^tsk-[A-Za-z0-9_-]+\.json$/.test(n));
}

export async function migrateTasksToV2(root: string): Promise<MigrationReport> {
  const tasksDir = path.join(root, ".ok", "tasks");
  const report: MigrationReport = { root, scanned: 0, migrated: 0, skipped: 0, errors: [] };
  const flat = await listV1FlatFiles(tasksDir);
  report.scanned = flat.length;

  for (const file of flat) {
    const id = file.replace(/\.json$/, "");
    const src = path.join(tasksDir, file);
    const dir = path.join(tasksDir, id);
    const v2File = path.join(dir, "task.json");
    const backup = path.join(dir, "task.v1.json");

    try {
      // Skip if the v2 form already exists — migration was already done.
      try {
        await fs.access(v2File);
        report.skipped += 1;
        continue;
      } catch { /* not yet migrated */ }

      const raw = await fs.readFile(src, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e: unknown) {
        const err = e as Error;
        report.errors.push({ id, reason: `invalid JSON: ${err.message}` });
        continue;
      }

      if (!isTaskV1(parsed)) {
        report.errors.push({ id, reason: "file does not match ok.task.v1 schema" });
        continue;
      }

      // Convert v1 → v2 and write the directory form
      const v2 = convertTaskV1ToV2(parsed);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(v2File, JSON.stringify(v2, null, 2) + "\n", "utf-8");

      // Move the legacy flat file into the new directory as backup.
      await fs.rename(src, backup);
      report.migrated += 1;
    } catch (e: unknown) {
      const err = e as Error;
      report.errors.push({ id, reason: err?.message ?? String(e) });
    }
  }

  return report;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printReport(report: MigrationReport, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`scanned ${report.scanned} legacy v1 file(s) in ${report.root}/.ok/tasks\n`);
  stream.write(`migrated ${report.migrated}, skipped ${report.skipped}, errors ${report.errors.length}\n`);
  if (report.errors.length > 0) {
    stream.write("\nErrors:\n");
    for (const err of report.errors) {
      stream.write(`  ${err.id}: ${err.reason}\n`);
    }
  }
}

export async function cmdMigrateTasksToV2(argv: string[]): Promise<number> {
  const root = argv[0] ?? process.cwd();
  const report = await migrateTasksToV2(root);
  printReport(report);
  return report.errors.length > 0 ? 1 : 0;
}

// `node --experimental-strip-types scripts/openkan/migrate-tasks-to-v2.mts [root]`
if (process.argv[1] && process.argv[1].endsWith("migrate-tasks-to-v2.mts")) {
  cmdMigrateTasksToV2(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const err = e as Error;
      process.stderr.write(`fatal: ${err?.message ?? String(e)}\n`);
      process.exit(1);
    },
  );
}
