// scripts/openkan/migrate-board-to-v2.mts — Vendored + adapted from OpenKan 0.7.0
// Source: https://github.com/PolderLabsVOF/openkan/blob/2488a00/scripts/migrate-board-to-v2.ts
// Provenance: commit 2488a00 (v0.7.0 tag). The upstream script imports
// `../ok/storage.ts` + `../kanban/board.ts` which are not shipped in the
// `@polderlabs/openkan` npm tarball, so this version inlines the type
// guard, the v2 projection, and the atomic writer so it runs as a
// standalone Node script under `bizar openkan migrate`.
//
// Behaviour preserved from upstream:
//   - Walks the legacy `.ok/board.json` file.
//   - Converts each entry under `tasks[]` into the v2 directory form
//     (`.ok/tasks/<id>/task.json`).
//   - Backs up the legacy file as `.ok/tasks.v1.board.json`.
//   - Idempotent: an already-migrated board is reported as skipped.
//   - Never aborts mid-run on a single failure.
//
// Usage:
//   node --experimental-strip-types scripts/openkan/migrate-board-to-v2.mts [root]
// where `root` is the project root containing `.ok/`. Defaults to cwd.
import { promises as fs } from "node:fs";
import * as path from "node:path";

interface LegacyBoardTask {
  id: string;
  title?: string;
  description?: string;
  column?: string;
  order?: number;
  sessionId?: string | null;
  agent?: string;
  model?: string | null;
  status?: string;
  state?: string;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  artifact?: string;
  sessionArtifact?: string | null;
  source?: { path: string; line: number; slug: string };
  pendingInputs?: string[];
  tags?: string[];
  category?: string;
  priority?: string;
  effort?: string | null;
  archived?: boolean;
  assignees?: string[];
  images?: string[];
  parentId?: string | null;
  subtaskIds?: string[];
  offlineMirrorId?: string;
  [key: string]: unknown;
}

interface LegacyBoard {
  version?: number;
  columns?: unknown[];
  tasks?: LegacyBoardTask[];
  sessions?: Record<string, unknown>;
}

interface MigrationReport {
  root: string;
  scanned: number;
  migrated: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}

/** Inline atomic writer. */
async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await fs.writeFile(tmpPath, contents, "utf8");
  await fs.rename(tmpPath, filePath);
}

/** Project a legacy board task into the v2 superset shape. */
function projectBoardTaskToV2(task: LegacyBoardTask): Record<string, unknown> {
  const v2: Record<string, unknown> = {
    schema: "ok.task.v2",
    id: task.id,
  };
  for (const key of [
    "title",
    "description",
    "column",
    "order",
    "sessionId",
    "agent",
    "model",
    "state",
    "lastError",
    "createdAt",
    "updatedAt",
    "artifact",
    "sessionArtifact",
    "source",
    "pendingInputs",
    "tags",
    "category",
    "effort",
    "archived",
    "assignees",
    "images",
    "parentId",
    "subtaskIds",
    "offlineMirrorId",
  ]) {
    if (task[key] !== undefined) v2[key] = task[key];
  }
  // board.json stored `status` for the engine column lifecycle; v2 uses
  // `status` for the planning lifecycle and `column` for the board
  // position. Carry both through.
  if (task.status !== undefined) v2.status = task.status;
  if (task.priority !== undefined) v2.priority = task.priority;
  return v2;
}

export async function migrateBoardToV2(root: string, options: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  const boardPath = path.join(root, ".ok", "board.json");
  const backupPath = path.join(root, ".ok", "tasks.v1.board.json");
  const tasksDir = path.join(root, ".ok", "tasks");
  const report: MigrationReport = { root, scanned: 0, migrated: 0, skipped: 0, errors: [] };
  const dryRun = options.dryRun === true;

  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return report;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    report.errors.push({ id: "<board.json>", reason: `invalid JSON: ${(err as Error).message}` });
    return report;
  }
  if (!parsed || typeof parsed !== "object") {
    report.errors.push({ id: "<board.json>", reason: "board.json is not an object" });
    return report;
  }
  const board = parsed as LegacyBoard;
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  report.scanned = tasks.length;

  for (const task of tasks) {
    const id = task.id;
    if (!id || !/^tsk-[A-Za-z0-9_-]+$/.test(id)) {
      report.errors.push({ id: String(id), reason: "task id does not match tsk-<id>" });
      continue;
    }
    const v2File = path.join(tasksDir, id, "task.json");
    try {
      try {
        await fs.access(v2File);
        report.skipped += 1;
        continue;
      } catch {
        /* not yet migrated */
      }
      const v2 = projectBoardTaskToV2(task);
      if (dryRun) {
        report.migrated += 1;
        continue;
      }
      await fs.mkdir(path.join(tasksDir, id), { recursive: true });
      await atomicWrite(v2File, JSON.stringify(v2, null, 2) + "\n");
      report.migrated += 1;
    } catch (err) {
      report.errors.push({ id, reason: (err as Error).message ?? String(err) });
    }
  }

  if (!dryRun) {
    try {
      await fs.rename(boardPath, backupPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        report.errors.push({ id: "<board.json>", reason: `could not move to backup: ${(err as Error).message}` });
      }
    }
  }

  return report;
}

function printReport(report: MigrationReport, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`scanned ${report.scanned} task(s) in ${report.root}/.ok/board.json\n`);
  stream.write(`migrated ${report.migrated}, skipped ${report.skipped}, errors ${report.errors.length}\n`);
  if (report.errors.length > 0) {
    stream.write("\nErrors:\n");
    for (const err of report.errors) {
      stream.write(`  ${err.id}: ${err.reason}\n`);
    }
  }
}

export async function cmdMigrateBoardToV2(argv: string[]): Promise<number> {
  const args = argv.slice();
  const dryRun = args.includes("--dry-run");
  const rootIdx = args.findIndex((a) => !a.startsWith("--"));
  const root = rootIdx >= 0 ? args[rootIdx] : process.cwd();
  const report = await migrateBoardToV2(root, { dryRun });
  printReport(report);
  return report.errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && /migrate-board-to-v2\.mts?$/.test(process.argv[1])) {
  cmdMigrateBoardToV2(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${(err as Error).message ?? String(err)}\n`);
      process.exit(1);
    },
  );
}
