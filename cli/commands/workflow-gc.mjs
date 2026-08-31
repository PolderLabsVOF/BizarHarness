#!/usr/bin/env node
/**
 * cli/commands/workflow-gc.mjs — Phase B (v10.21.0) B.3
 *
 * Garbage-collects workflow run artifact directories under
 * `<cwd>/.bizar/runs/`. Each run is a directory written by
 * `config/workflows/lib/dispatch.js#writeArtifact` (B.1).
 *
 * Policy:
 *   - TTL: 14 days since the directory's mtime (configurable via
 *     `--max-age-days`).
 *   - In-progress gate: if `feature_list.json` has any feature with
 *     `state: in_progress`, NO directories are deleted (conservative;
 *     we have no feature -> runId mapping). The dry-run reports this
 *     explicitly so the operator sees the skip reason.
 *   - Permission failures: skip + warn, never abort the run.
 *   - Idempotent: re-running after a successful GC is a no-op.
 *
 * Usage:
 *   node cli/commands/workflow-gc.mjs                 # real deletion
 *   node cli/commands/workflow-gc.mjs --dry-run       # list only
 *   node cli/commands/workflow-gc.mjs --max-age-days=7
 *   node cli/commands/workflow-gc.mjs --root <path>   # override run root
 *
 * Exit codes:
 *   0  success (every candidate either deleted or explicitly skipped)
 *   1  at least one delete failed (dry-run is exit 0; the operator
 *      reviews the per-row status and re-runs)
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const dispatchPath = resolve(repoRoot, 'config', 'workflows', 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

const { listRuns } = dispatch;

const DEFAULT_MAX_AGE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = { dryRun: false, maxAgeDays: DEFAULT_MAX_AGE_DAYS, root: undefined };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--max-age-days=')) {
      const n = Number(a.slice('--max-age-days='.length));
      if (Number.isFinite(n) && n >= 0) args.maxAgeDays = n;
    } else if (a.startsWith('--root=')) {
      args.root = a.slice('--root='.length);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`workflow-gc — delete .bizar/runs/<run-id>/ older than N days.

Usage:
  node cli/commands/workflow-gc.mjs                  real deletion
  node cli/commands/workflow-gc.mjs --dry-run        list candidates, no deletions
  node cli/commands/workflow-gc.mjs --max-age-days=N  override the 14-day default TTL
  node cli/commands/workflow-gc.mjs --root <path>    override the artifact root

Exit codes:
  0  success (every candidate either deleted or explicitly skipped)
  1  at least one delete failed (operator reviews + re-runs)
`);
}

/**
 * Inspect feature_list.json#in_progress. Returns
 * `{ inProgress: boolean, ids: string[] }`. When the file is missing
 * or unreadable, inProgress is false (no gate) — a missing
 * feature_list.json is not the GC tool's problem to fix.
 */
function inProgressFeatureIds(cwd) {
  const p = resolve(cwd, 'feature_list.json');
  if (!existsSync(p)) return { inProgress: false, ids: [] };
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'));
    const features = Array.isArray(json?.features) ? json.features : [];
    const ids = features.filter((f) => f && f.state === 'in_progress').map((f) => f.id || '<no-id>');
    return { inProgress: ids.length > 0, ids };
  } catch {
    return { inProgress: false, ids: [] };
  }
}

/**
 * Build a candidate list. Each row carries enough metadata for the
 * dry-run output + the deletion loop:
 *   { runId, path, ageDays, size, action: 'delete' | 'skip:<reason>' }
 *
 * Skip reasons:
 *   'too-recent'      — mtime within the TTL window
 *   'in-progress'     — feature_list.json has any in_progress feature
 *   'permission-denied' — stat/rm threw EACCES or EPERM
 *   'missing'         — directory vanished between listRuns() and stat()
 */
function planCandidates({ runs, nowMs, maxAgeDays, inProgress }) {
  const out = [];
  for (const run of runs) {
    const ageDays = (nowMs - run.mtimeMs) / MS_PER_DAY;
    if (inProgress) {
      out.push({ runId: run.runId, path: run.path, ageDays, size: run.size, action: 'skip:in-progress' });
      continue;
    }
    if (ageDays < maxAgeDays) {
      out.push({ runId: run.runId, path: run.path, ageDays, size: run.size, action: 'skip:too-recent' });
      continue;
    }
    out.push({ runId: run.runId, path: run.path, ageDays, size: run.size, action: 'delete' });
  }
  return out;
}

/**
 * Execute the plan. Returns `{ rows, errors }` where `errors` is the
 * list of (runId, message) pairs for failed deletions. Best-effort:
 * every error is recorded but the loop continues so a single
 * permission-denied directory does not block the rest of the sweep.
 */
function executePlan(rows, { dryRun, nowMs }) {
  const errors = [];
  const out = [];
  for (const row of rows) {
    if (row.action !== 'delete' || dryRun) {
      out.push(row);
      continue;
    }
    try {
      rmSync(row.path, { recursive: true, force: true });
      out.push({ ...row, deletedAt: new Date(nowMs).toISOString() });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const reason = /EACCES|EPERM/.test(message) ? 'permission-denied' : 'unknown';
      out.push({ ...row, action: `error:${reason}`, error: message });
      errors.push({ runId: row.runId, message });
    }
  }
  return { rows: out, errors };
}

function formatRows(rows) {
  const lines = [];
  for (const row of rows) {
    const tag = row.action.startsWith('skip:')
      ? `SKIP (${row.action.slice('skip:'.length)})`
      : row.action.startsWith('error:')
        ? `ERROR (${row.action.slice('error:'.length)})`
        : row.deletedAt
          ? 'DELETED'
          : 'DELETE';
    lines.push(`  ${tag.padEnd(22)} ${row.runId.padEnd(38)} age=${row.ageDays.toFixed(2)}d size=${row.size}B`);
  }
  return lines.join('\n');
}

function emitGcLog(rows, errors, { dryRun, maxAgeDays, inProgressIds, outputPath }) {
  const summary = {
    dryRun,
    maxAgeDays,
    inProgressIds,
    deleted: rows.filter((r) => r.deletedAt).length,
    skipped: rows.filter((r) => r.action.startsWith('skip:')).length,
    errors: rows.filter((r) => r.action.startsWith('error:')).length,
    rows,
  };
  if (outputPath) {
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    } catch {
      // best-effort: the console output is the source of truth
    }
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const root = args.root ? resolve(args.root) : undefined;
  const cwd = process.cwd();
  const nowMs = Date.now();
  const inProgress = inProgressFeatureIds(cwd);
  const runs = listRuns({ runRoot: root });
  const plan = planCandidates({ runs, nowMs, maxAgeDays: args.maxAgeDays, inProgress: inProgress.inProgress });
  const { rows } = executePlan(plan, { dryRun: args.dryRun, nowMs });
  const gcLogPath = resolve(cwd, '.bizar', 'runs', 'gc.json');
  const summary = emitGcLog(rows, [], { dryRun: args.dryRun, maxAgeDays: args.maxAgeDays, inProgressIds: inProgress.ids, outputPath: gcLogPath });

  process.stdout.write(
    [
      `▶ workflow-gc ${args.dryRun ? '(dry-run)' : ''}`,
      `  root:           ${root || resolve(cwd, '.bizar', 'runs')}`,
      `  max-age-days:   ${args.maxAgeDays}`,
      `  in-progress:    ${inProgress.inProgress ? `yes [${inProgress.ids.join(', ')}]` : 'no'}`,
      `  candidates:     ${rows.length}`,
      `  deleted:        ${summary.deleted}`,
      `  skipped:        ${summary.skipped}`,
      `  errors:         ${summary.errors}`,
      '',
      formatRows(rows),
      '',
    ].join('\n'),
  );

  if (summary.errors > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`workflow-gc failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});