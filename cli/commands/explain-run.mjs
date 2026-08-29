/**
 * cli/commands/explain-run.mjs
 *
 * F-194 + production-autonomy audit Milestone 2 ("Resumable controller")
 * observability surface. `bizar explain-run <objectiveRunId>` joins
 * the durable ObjectiveRun scheduler state with the typed EvidenceBundle
 * ledger to produce a single, replayable report for one objective.
 *
 * Subcommands:
 *   explain-run <objectiveRunId>     JSON (default) — structured timeline
 *                                   suitable for `jq`, automation, and
 *                                   the next `bizar status` iteration.
 *   explain-run <id> --format=human  human-readable multi-line report.
 *   explain-run --list [--phase=X]  list every objective in the scheduler
 *                                   (filterable by phase and status).
 *
 * Why a join over both stores:
 *   - The scheduler state (`cli/commands/objective-scheduler.mjs`) owns
 *     the *intent* aggregate: goal, lease, attempt, phase transitions.
 *   - The evidence ledger (`cli/commands/evidence-bundles.mjs`) owns the
 *     *observation* rows: typed `EvidenceBundle`s with command, exit,
 *     revisions, sha256, evaluator digest, and signature.
 *   - Operators reading a stale or crashed run need both to diagnose
 *     what actually happened vs what was claimed to happen.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectiveScheduler } from './objective-scheduler.mjs';
import { bundleJsonlPath, resolveEvidenceDir } from './evidence-bundles.mjs';

function requireText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function parseFlags(argv) {
  const flags = { _: [], format: 'json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format' || a === '-f') {
      flags.format = String(argv[++i] ?? '').trim();
      continue;
    }
    if (a.startsWith('--format=')) { flags.format = a.slice('--format='.length).trim(); continue; }
    if (a === '--phase') { flags.phase = String(argv[++i] ?? '').trim(); continue; }
    if (a.startsWith('--phase=')) { flags.phase = a.slice('--phase='.length).trim(); continue; }
    if (a === '--status') { flags.status = String(argv[++i] ?? '').trim(); continue; }
    if (a.startsWith('--status=')) { flags.status = a.slice('--status='.length).trim(); continue; }
    if (a === '--list' || a === '-l') { flags.list = true; continue; }
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    flags._.push(a);
  }
  return flags;
}

function isoOrNull(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

/**
 * Read the EvidenceBundle JSONL for one objective (if any) and return
 * a non-verifying summary. We deliberately skip signature verification
 * here — the explainer is read-only and should not require the secret.
 * The structured output includes `rowCount` and `lastAppendedAt`; the
 * full rows are NOT echoed to avoid leaking operator-side evidence
 * contents into logs.
 */
function summarizeEvidence({ objectiveRunId, evidenceDir }) {
  const path = bundleJsonlPath({ objectiveRunId, evidenceDir });
  if (!existsSync(path)) {
    return { rowCount: 0, lastAppendedAt: null, path: null };
  }
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let lastAppendedAt = null;
  if (lines.length > 0) {
    try {
      const last = JSON.parse(lines[lines.length - 1]);
      lastAppendedAt = last.createdAt ?? null;
    } catch { /* malformed tail — caller can re-verify with bizarre evidence verify-bundles */ }
  }
  return { rowCount: lines.length, lastAppendedAt, path };
}

/**
 * Build the structured report for one objective. Returns `null` if no
 * row matches the id (caller renders a not-found message).
 */
export function buildExplainRun({ objectiveRunId, cwd = process.cwd(), env = process.env } = {}) {
  const id = requireText(objectiveRunId, 'objectiveRunId');
  const sched = new ObjectiveScheduler({ cwd, env });
  try {
    const run = sched.getObjective({ objectiveRunId: id });
    if (!run) return null;
    const events = sched.listEvents({ objectiveRunId: id }).map((e) => ({
      id: e.id,
      kind: e.kind,
      ts: e.ts,
      tsIso: isoOrNull(e.ts),
      payload: e.payload,
    }));
    const evidenceDir = resolveEvidenceDir({ cwd, env });
    const evidence = summarizeEvidence({ objectiveRunId: id, evidenceDir });
    return {
      objectiveRunId: run.objectiveRunId,
      goal: run.goal,
      phase: run.phase,
      status: run.status,
      owner: run.owner,
      attempt: run.attempt,
      leaseExpiresAt: run.leaseExpiresAt,
      leaseExpiresAtIso: isoOrNull(run.leaseExpiresAt),
      heartbeatAt: run.heartbeatAt,
      heartbeatAtIso: isoOrNull(run.heartbeatAt),
      blocker: run.blocker,
      createdAt: run.createdAt,
      createdAtIso: isoOrNull(run.createdAt),
      updatedAt: run.updatedAt,
      updatedAtIso: isoOrNull(run.updatedAt),
      terminalAt: run.terminalAt,
      terminalAtIso: isoOrNull(run.terminalAt),
      payload: run.payload,
      events,
      evidence,
      dbPath: sched.dbPath,
    };
  } finally {
    sched.close();
  }
}

/**
 * Build a tabular listing of every objective in the scheduler,
 * optionally filtered by phase and/or status.
 */
export function listObjectives({ phase, status, cwd = process.cwd(), env = process.env } = {}) {
  const sched = new ObjectiveScheduler({ cwd, env });
  try {
    return sched.listObjectives({
      ...(phase ? { phase } : {}),
      ...(status ? { status } : {}),
    }).map((row) => ({
      objectiveRunId: row.objectiveRunId,
      phase: row.phase,
      status: row.status,
      owner: row.owner,
      attempt: row.attempt,
      leaseExpiresAtIso: isoOrNull(row.leaseExpiresAt),
      goal: row.goal,
      createdAtIso: isoOrNull(row.createdAt),
      updatedAtIso: isoOrNull(row.updatedAt),
      terminalAtIso: isoOrNull(row.terminalAt),
    }));
  } finally {
    sched.close();
  }
}

function renderHuman(report) {
  const lines = [];
  lines.push(`ObjectiveRun ${report.objectiveRunId}`);
  lines.push('-'.repeat(Math.max(20, report.objectiveRunId.length + 14)));
  lines.push(`goal:      ${report.goal}`);
  lines.push(`phase:     ${report.phase}`);
  lines.push(`status:    ${report.status}`);
  lines.push(`owner:     ${report.owner ?? '<none>'}`);
  lines.push(`attempt:   ${report.attempt}`);
  lines.push(`createdAt: ${report.createdAtIso}`);
  lines.push(`updatedAt: ${report.updatedAtIso}`);
  lines.push(`terminalAt:${report.terminalAtIso ? ' ' + report.terminalAtIso : ''}`);
  lines.push(`lease:     ${report.leaseExpiresAtIso ?? '<none>'}`);
  lines.push(`heartbeat: ${report.heartbeatAtIso ?? '<none>'}`);
  if (report.blocker) lines.push(`blocker:   ${report.blocker}`);
  if (report.payload && Object.keys(report.payload).length > 0) {
    lines.push(`payload:`);
    lines.push(`  ${JSON.stringify(report.payload)}`);
  }
  lines.push('');
  lines.push(`Events (${report.events.length}):`);
  for (const e of report.events) {
    lines.push(`  [${e.tsIso}] ${e.kind}` + (e.payload && Object.keys(e.payload).length > 0 ? '  ' + JSON.stringify(e.payload) : ''));
  }
  lines.push('');
  lines.push(`Evidence: ${report.evidence.rowCount} bundle row(s)` +
    (report.evidence.lastAppendedAt ? ` (last appended ${report.evidence.lastAppendedAt})` : ''));
  if (report.evidence.path) lines.push(`  path: ${report.evidence.path}`);
  return lines.join('\n') + '\n';
}

function renderHumanList(rows) {
  if (rows.length === 0) return '(no objectives match the filters)\n';
  const header = ['OBJECTIVE_RUN_ID', 'PHASE', 'STATUS', 'ATTEMPT', 'OWNER', 'UPDATED', 'GOAL'];
  const widths = header.map((h) => h.length);
  const cells = rows.map((r) => [
    r.objectiveRunId,
    r.phase,
    r.status,
    String(r.attempt),
    r.owner ?? '<none>',
    r.updatedAtIso ?? '',
    r.goal,
  ]);
  for (const row of cells) {
    for (let i = 0; i < header.length; i++) {
      widths[i] = Math.max(widths[i], (row[i] ?? '').length);
    }
  }
  const fmt = (cells) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
  const lines = [fmt(header), ...cells.map(fmt)];
  return lines.join('\n') + '\n';
}

export const USAGE = `Usage:
  bizar explain-run <objectiveRunId> [--format=json|human]
  bizar explain-run --list [--phase=<p>] [--status=<s>] [--format=json|human]

Show the durable ObjectiveRun state for one id (joined with the
EvidenceBundle ledger) or list every objective filtered by phase /
status. The scheduler DB lives at BIZAR_HOME/state/objectives.sqlite
(BIZAR_OBJECTIVE_DB override).

Subcommands:
  <id>           structured report for one objective (JSON default).
                 Use --format=human for a multi-line operator view.
  --list, -l     tabular listing (filterable by --phase and --status).

Examples:
  bizar explain-run 7f1c8a3b-...
  bizar explain-run 7f1c8a3b-... --format=human
  bizar explain-run --list --phase=verifying
  bizar explain-run --list --status=active --format=human
`;

export async function run(cmd, args, isHelp) {
  if (cmd !== 'explain-run') return false;
  const flags = parseFlags(args);
  if (isHelp || flags.help) {
    process.stdout.write(USAGE);
    return true;
  }
  const cwd = process.cwd();
  if (flags.list) {
    const rows = listObjectives({ phase: flags.phase, status: flags.status, cwd, env: process.env });
    if (flags.format === 'human') {
      process.stdout.write(renderHumanList(rows));
    } else {
      process.stdout.write(JSON.stringify({ ok: true, count: rows.length, rows }, null, 2) + '\n');
    }
    return true;
  }
  const id = flags._[0];
  if (!id) {
    process.stderr.write(USAGE);
    process.exit(2);
    return true;
  }
  let report;
  try {
    report = buildExplainRun({ objectiveRunId: id, cwd, env: process.env });
  } catch (err) {
    process.stderr.write(`explain-run failed: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
    return true;
  }
  if (!report) {
    process.stderr.write(`objective not found: ${id}\n`);
    process.exit(2);
    return true;
  }
  if (flags.format === 'human') {
    process.stdout.write(renderHuman(report));
  } else {
    process.stdout.write(JSON.stringify({ ok: true, run: report }, null, 2) + '\n');
  }
  return true;
}
