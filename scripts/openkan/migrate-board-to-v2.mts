// scripts/openkan/migrate-board-to-v2.mts — Vendored from OpenKan 0.7.0
// Source: https://raw.githubusercontent.com/PolderLabsVOF/openkan/2488a00/scripts/migrate-board-to-v2.ts
// Commit: 2488a00

// This is a standalone migration script that walks the legacy `.ok/board.json` file,
// converts each entry under `tasks[]` into the v2 directory form
// (`.ok/tasks/<id>/task.json`), and backs up the legacy file as
// `.ok/tasks.v1.board.json`. Idempotent: a board.json that's already
// been moved aside is reported as skipped.
//
// Usage:
//   node --experimental-strip-types scripts/openkan/migrate-board-to-v2.mts [root]
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

interface LegacyBoardTask {
  id: string;
  title: string;
  description?: string;
  column: "backlog" | "todo" | "doing" | "review" | "done";
  order: number;
  sessionId: string | null;
  agent: string;
  model: string | null;
  status: string;
  state: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  artifact: string;
  sessionArtifact: string | null;
  artifacts?: { mdxPath: string; commentsPath: string; inputsPath: string; statePath: string };
  source?: { path: string; line: number; slug: string };
  sourceHash?: string;
  stale?: boolean;
  lastSourceCheck?: string;
  pendingInputs: string[];
  tags: string[];
  category: string;
  priority: string;
  effort: string | null;
  archived: boolean;
  assignees: string[];
  images: string[];
  parentId: string | null;
  subtaskIds: string[];
  offlineMirrorId?: string;
}

interface LegacyBoardV1 {
  version: number;
  columns: unknown[];
  tasks: LegacyBoardTask[];
  sessions: Record<string, unknown>;
}

function toTaskV2(task: LegacyBoardTask): Record<string, unknown> {
  // Map column to status
  const columnToStatus: Record<string, string> = {
    backlog: "backlog",
    todo: "pending",
    doing: "in_progress",
    review: "review",
    done: "done",
  };

  return {
    schema: "ok.task.v2",
    id: task.id,
    title: task.title,
    description: task.description,
    status: columnToStatus[task.column] || task.status || "backlog",
    priority: task.priority || "normal",
    tags: task.tags || [],
    assignees: task.assignees || [],
    effort: task.effort,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    source: task.source,
    sourceHash: task.sourceHash,
    archived: task.archived,
    parentId: task.parentId,
    subtaskIds: task.subtaskIds,
    column: task.column,
    order: task.order,
    sessionId: task.sessionId,
    agent: task.agent,
    model: task.model,
    state: task.state,
    lastError: task.lastError,
    artifact: task.artifact,
    sessionArtifact: task.sessionArtifact,
    stale: task.stale,
    lastSourceCheck: task.lastSourceCheck,
    pendingInputs: task.pendingInputs || [],
    images: task.images || [],
    category: task.category,
    offlineMirrorId: task.offlineMirrorId,
  };
}

export async function migrateBoardToV2(root: string): Promise<MigrationReport> {
  const tasksDir = path.join(root, ".ok", "tasks");
  const boardPath = path.join(root, ".ok", "board.json");
  const backupPath = path.join(root, ".ok", "tasks.v1.board.json");
  const report: MigrationReport = { root, scanned: 0, migrated: 0, skipped: 0, errors: [] };

  // Idempotent: if board.json is already gone (moved aside) skip.
  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return report;
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const err = e as Error;
    report.errors.push({ id: "<board.json>", reason: `invalid JSON: ${err.message}` });
    return report;
  }

  if (!parsed || typeof parsed !== "object") {
    report.errors.push({ id: "<board.json>", reason: "board.json is not an object" });
    return report;
  }

  const board = parsed as LegacyBoardV1;
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
      // Skip if the v2 form already exists — migration was already done.
      try {
        await fs.access(v2File);
        report.skipped += 1;
        continue;
      } catch { /* not yet migrated */ }

      // Convert using toTaskV2 projection
      const v2 = toTaskV2(task);
      await fs.mkdir(path.join(tasksDir, id), { recursive: true });
      await fs.writeFile(v2File, JSON.stringify(v2, null, 2) + "\n", "utf-8");
      report.migrated += 1;
    } catch (e: unknown) {
      const err = e as Error;
      report.errors.push({ id, reason: err?.message ?? String(e) });
    }
  }

  // Move the legacy board.json aside as a backup
  try {
    await fs.rename(boardPath, backupPath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") {
      report.errors.push({ id: "<board.json>", reason: `could not move to backup: ${err.message}` });
    }
  }

  return report;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

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
  const root = argv[0] ?? process.cwd();
  const report = await migrateBoardToV2(root);
  printReport(report);
  return report.errors.length > 0 ? 1 : 0;
}

// `node --experimental-strip-types scripts/openkan/migrate-board-to-v2.mts [root]`
if (process.argv[1] && process.argv[1].endsWith("migrate-board-to-v2.mts")) {
  cmdMigrateBoardToV2(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const err = e as Error;
      process.stderr.write(`fatal: ${err?.message ?? String(e)}\n`);
      process.exit(1);
    },
  );
}
