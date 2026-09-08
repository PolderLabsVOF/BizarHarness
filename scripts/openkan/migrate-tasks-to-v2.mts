// scripts/openkan/migrate-tasks-to-v2.mts — Vendored + adapted from OpenKan 0.7.0
// Source: https://github.com/PolderLabsVOF/openkan/blob/2488a00/scripts/migrate-tasks-to-v2.ts
// Provenance: commit 2488a00 (v0.7.0 tag). The upstream script imports
// `../ok/schemas.ts` + `../ok/storage.ts` which are not shipped in the
// `@polderlabs/openkan` npm tarball, so this version inlines the type
// guard, the v1→v2 converter, and the atomic writer so it runs as a
// standalone Node script under `bizar openkan migrate`.
//
// Behaviour preserved from upstream:
//   - Walks `.ok/tasks/tsk-*.json` (legacy v1 flat files).
//   - Converts each into the v2 directory form (`.ok/tasks/<id>/task.json`).
//   - Backs up the original as `.ok/tasks/<id>/task.v1.json` inside the
//     new directory. Idempotent: a task with both v2 and v1 backup
//     already in place is reported as skipped.
//   - Never aborts mid-run on a single failure; logs the error and
//     continues so partial progress is preserved.
//
// Usage:
//   node --experimental-strip-types scripts/openkan/migrate-tasks-to-v2.mts [root]
// where `root` is the project root containing `.ok/`. Defaults to cwd.
import { promises as fs } from "node:fs";
import * as path from "node:path";

interface MigrationReport {
  root: string;
  scanned: number;
  migrated: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}

/** Inline type guard for OpenKan task v1. Avoids depending on ok/schemas.ts. */
function isTaskV1(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return false;
  const candidate = obj as { schema?: unknown };
  return candidate.schema === "ok.task.v1" && typeof (candidate as { id?: unknown }).id === "string";
}

/** Map the v1 priority enum to v2. Unknown values fall through to "normal". */
function mapPriority(value: unknown): "low" | "normal" | "high" | "urgent" {
  switch (value) {
    case "p0":
      return "urgent";
    case "p1":
      return "high";
    case "p2":
      return "normal";
    case "p3":
      return "low";
    case "low":
    case "normal":
    case "high":
    case "urgent":
      return value;
    default:
      return "normal";
  }
}

/** Minimal v1→v2 converter. Carries over the v1 fields the v2 superset accepts. */
function convertV1ToV2(v1: Record<string, unknown>): Record<string, unknown> {
  const v2: Record<string, unknown> = {
    schema: "ok.task.v2",
    id: v1.id,
  };
  for (const key of [
    "title",
    "description",
    "status",
    "column",
    "order",
    "agent",
    "model",
    "sessionId",
    "state",
    "lastError",
    "artifact",
    "sessionArtifact",
    "source",
    "tags",
    "category",
    "effort",
    "archived",
    "assignees",
    "images",
    "parentId",
    "subtaskIds",
    "offlineMirrorId",
    "scopes",
    "owner",
    "evidence",
    "links",
  ]) {
    if (v1[key] !== undefined) v2[key] = v1[key];
  }
  if (v1.priority !== undefined) {
    v2.priority = mapPriority(v1.priority);
  } else {
    v2.priority = "normal";
  }
  if (v1.id) v2.id = v1.id;
  return v2;
}

/** Atomic write — same shape as upstream's storage primitive. */
async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await fs.writeFile(tmpPath, contents, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function listV1FlatFiles(tasksDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(tasksDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
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
      } catch {
        /* not yet migrated */
      }
      const raw = await fs.readFile(src, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        report.errors.push({ id, reason: `invalid JSON: ${(err as Error).message}` });
        continue;
      }
      if (!isTaskV1(parsed)) {
        report.errors.push({ id, reason: "file does not match ok.task.v1 schema" });
        continue;
      }
      const v2 = convertV1ToV2(parsed);
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite(v2File, JSON.stringify(v2, null, 2) + "\n");
      // Move the legacy flat file into the new directory as backup.
      await fs.rename(src, backup);
      report.migrated += 1;
    } catch (err) {
      report.errors.push({ id, reason: (err as Error).message ?? String(err) });
    }
  }
  return report;
}

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
if (process.argv[1] && /migrate-tasks-to-v2\.mts?$/.test(process.argv[1])) {
  cmdMigrateTasksToV2(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${(err as Error).message ?? String(err)}\n`);
      process.exit(1);
    },
  );
}
