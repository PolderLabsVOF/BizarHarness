/**
 * cli/commands/evidence.mjs
 *
 * `bizar evidence` — F-191 / IMP-018 per-dispatch model evidence CLI.
 *
 *   bizar evidence tail --limit N       # print the last N rows
 *   bizar evidence show <id>            # print one record (decision + outcome)
 *   bizar evidence verify <id>          # exit 0 on integrity OK, 1 on mismatch
 *   bizar evidence run <runId>          # print every record for a run
 *   bizar evidence audit                # rows missing outcome or with provider mismatch
 *
 * The store lives at `~/.config/bizar/evidence/dispatch.jsonl` by default;
 * `BIZAR_EVIDENCE_DIR` overrides the directory and `BIZAR_HOME` overrides
 * the home root. The wire format is the JSONL produced by the SDK's
 * `createFileEvidenceStore` and the workflow-side `appendEvidence`
 * mirror in `config/workflows/lib/dispatch.js`.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ── Evidence dir resolution ──────────────────────────────────────────────────

export function resolveEvidenceDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.BIZAR_EVIDENCE_DIR && typeof env.BIZAR_EVIDENCE_DIR === 'string') {
    return isAbsolute(env.BIZAR_EVIDENCE_DIR)
      ? env.BIZAR_EVIDENCE_DIR
      : resolve(cwd, env.BIZAR_EVIDENCE_DIR);
  }
  const home = env.BIZAR_HOME || (env.HOME ? `${env.HOME}/.config/bizar` : null)
    || join(homedir(), '.config', 'bizar');
  return join(home, 'evidence');
}

export function evidenceFilePath(opts = {}) {
  return join(resolveEvidenceDir(opts), 'dispatch.jsonl');
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Read every line from the JSONL evidence file. Returns an empty array
 * when the file does not exist yet.
 */
export function readEvidenceRows(opts = {}) {
  const path = evidenceFilePath(opts);
  if (!existsSync(path)) return [];
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* skip malformed lines */ }
  }
  return rows;
}

/**
 * Pure structural integrity check. Mirrors the SDK's
 * `EvidenceStore.verifyIntegrity` so the CLI matches the SDK without
 * importing the TS source.
 *
 * Returns `{ ok: true }` when the row + chain is intact, otherwise
 * `{ ok: false, reason: '<machine-readable string>' }`.
 */
export function verifyIntegrityForRow(row) {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'not-found' };
  if (row.decision && typeof row.decision === 'object'
      && row.decision.routingDecisionId !== row.routingDecisionId) {
    return { ok: false, reason: 'decision-id-mismatch' };
  }
  const inputs = row.inputs && typeof row.inputs === 'object' ? row.inputs : null;
  if (!inputs) return { ok: false, reason: 'inputs-missing' };
  for (const field of ['selectedProfilesHash', 'staticProfilesHash', 'budgetHash', 'healthHash']) {
    if (typeof inputs[field] !== 'string' || !/^[0-9a-f]{64}$/.test(inputs[field])) {
      return { ok: false, reason: `inputs-hash-mismatch:${field}` };
    }
  }
  if (!row.schemaVersion || row.schemaVersion !== 1) {
    return { ok: false, reason: 'schema-version-mismatch' };
  }
  if (!row.createdAt || Number.isNaN(Date.parse(row.createdAt))) {
    return { ok: false, reason: 'createdAt-missing' };
  }
  return { ok: true };
}

export function verifyIntegrityForId(routingDecisionId, opts = {}) {
  const rows = readEvidenceRows(opts).filter((r) => r.routingDecisionId === routingDecisionId);
  if (rows.length === 0) return { ok: false, reason: 'not-found' };
  for (const row of rows) {
    const check = verifyIntegrityForRow(row);
    if (!check.ok) return check;
  }
  return { ok: true };
}

export function tailRows({ limit = 10, dir } = {}) {
  const rows = readEvidenceRows(dir ? { cwd: process.cwd(), env: { ...process.env, BIZAR_EVIDENCE_DIR: dir } } : {});
  const safeLimit = typeof limit === 'number' && limit >= 0 ? limit : rows.length;
  return rows.slice(Math.max(0, rows.length - safeLimit));
}

export function findByRunId(runId, opts = {}) {
  if (typeof runId !== 'string' || !runId) return [];
  return readEvidenceRows(opts).filter((r) => r.runId === runId);
}

export function getById(routingDecisionId, opts = {}) {
  const rows = readEvidenceRows(opts).filter((r) => r.routingDecisionId === routingDecisionId);
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.sequence ?? 0) > (latest.sequence ?? 0) ? row : latest);
}

/**
 * Audit rows: missing outcome OR `actualProviderModel` disagrees with
 * `decision.modelId`. The 100% agreement metric from IMPROVEMENTS.md
 * line 881 lives here.
 */
export function auditRows(opts = {}) {
  const rows = readEvidenceRows(opts);
  const primaries = rows.filter((r) => (r.sequence ?? 0) === 0);
  const missingOutcome = primaries.filter((r) => !r.outcome);
  const mismatched = primaries.filter((r) => r.outcome
    && typeof r.outcome.actualProviderModel === 'string'
    && r.decision
    && typeof r.decision.modelId === 'string'
    && r.outcome.actualProviderModel !== r.decision.modelId);
  return { missingOutcome, mismatched, totalRows: rows.length, primaryRows: primaries.length };
}

// ── Help / argument parsing ─────────────────────────────────────────────────

function showHelp() {
  console.log(`
  bizar evidence — F-191 per-dispatch model evidence audit trail

  Usage:
    bizar evidence tail --limit N         Print the last N rows (default 10)
    bizar evidence show <routingDecisionId>
                                        Print one record (decision + outcome)
    bizar evidence verify <routingDecisionId>
                                        Run integrity check; exit 0 / 1
    bizar evidence run <runId>           Print every record for a run
    bizar evidence audit                 Rows missing outcome or with model mismatch

  Common flags:
    --dir <path>                        Override the evidence directory
    --json                              Emit machine-readable JSON
`);
}

function parseLimit(args) {
  const flag = args.find((a) => a.startsWith('--limit='));
  if (flag) {
    const value = Number(flag.slice('--limit='.length));
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const idx = args.indexOf('--limit');
  if (idx !== -1 && idx + 1 < args.length) {
    const value = Number(args[idx + 1]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 10;
}

function parseDir(args) {
  const flag = args.find((a) => a.startsWith('--dir='));
  if (flag) return flag.slice('--dir='.length);
  const idx = args.indexOf('--dir');
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

// ── Subcommand handlers ──────────────────────────────────────────────────────

function printRow(row, { json = false } = {}) {
  if (json) {
    process.stdout.write(JSON.stringify(row, null, 2) + '\n');
    return;
  }
  const head = `${row.routingDecisionId}  seq=${row.sequence ?? 0}  run=${row.runId}  agent=${row.agentName ?? '-'}  phase=${row.workflowPhase ?? '-'}  created=${row.createdAt}`;
  console.log(head);
  console.log(`  decision.modelId = ${row.decision?.modelId ?? '(null)'}`);
  console.log(`  decision.tier    = ${row.decision?.tier ?? '(unknown)'}`);
  console.log(`  decision.reason  = ${row.decision?.reason ?? '-'}`);
  if (row.outcome) {
    console.log(`  outcome.status   = ${row.outcome.status}`);
    if (typeof row.outcome.durationMs === 'number') {
      console.log(`  outcome.duration = ${row.outcome.durationMs}ms`);
    }
    if (row.outcome.actualProviderModel) {
      console.log(`  outcome.actual   = ${row.outcome.actualProviderModel}`);
    }
    if (row.outcome.errorMessage) {
      console.log(`  outcome.error    = ${row.outcome.errorMessage}`);
    }
  } else {
    console.log(chalk.yellow('  outcome          = (missing)'));
  }
  console.log('');
}

function handleTail(args) {
  const wantJson = args.includes('--json');
  const limit = parseLimit(args);
  const dir = parseDir(args);
  const rows = tailRows({ limit, dir });
  if (wantJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  if (rows.length === 0) {
    console.log(chalk.yellow('  ! evidence store is empty (or file does not exist)'));
    return 0;
  }
  for (const row of rows) printRow(row, {});
  return 0;
}

function handleShow(args) {
  const wantJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('-'));
  const id = positional[0];
  if (!id) {
    console.error(chalk.red('  ✗ bizar evidence show requires a routingDecisionId'));
    return 2;
  }
  const dir = parseDir(args);
  const row = getById(id, dir ? { cwd: process.cwd(), env: { ...process.env, BIZAR_EVIDENCE_DIR: dir } } : {});
  if (!row) {
    if (wantJson) {
      process.stdout.write(JSON.stringify({ error: `routingDecisionId=${id} not found` }, null, 2) + '\n');
    } else {
      console.error(chalk.red(`  ✗ routingDecisionId=${id} not found`));
    }
    return 2;
  }
  if (wantJson) {
    process.stdout.write(JSON.stringify(row, null, 2) + '\n');
    return 0;
  }
  printRow(row, {});
  return 0;
}

function handleVerify(args) {
  const wantJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('-'));
  const id = positional[0];
  if (!id) {
    console.error(chalk.red('  ✗ bizar evidence verify requires a routingDecisionId'));
    return 2;
  }
  const dir = parseDir(args);
  const check = verifyIntegrityForId(id, dir ? { cwd: process.cwd(), env: { ...process.env, BIZAR_EVIDENCE_DIR: dir } } : {});
  if (wantJson) {
    process.stdout.write(JSON.stringify(check, null, 2) + '\n');
  } else if (!check.ok) {
    console.error(chalk.red(`  ✗ integrity check failed: ${check.reason}`));
  } else {
    console.log(chalk.green(`  ✓ integrity OK for ${id}`));
  }
  return check.ok ? 0 : 1;
}

function handleRun(args) {
  const wantJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('-'));
  const runId = positional[0];
  if (!runId) {
    console.error(chalk.red('  ✗ bizar evidence run requires a runId'));
    return 2;
  }
  const dir = parseDir(args);
  const rows = findByRunId(runId, dir ? { cwd: process.cwd(), env: { ...process.env, BIZAR_EVIDENCE_DIR: dir } } : {});
  if (wantJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  if (rows.length === 0) {
    console.log(chalk.yellow(`  ! no rows for runId=${runId}`));
    return 0;
  }
  for (const row of rows) printRow(row, {});
  return 0;
}

function handleAudit(args) {
  const wantJson = args.includes('--json');
  const dir = parseDir(args);
  const report = auditRows(dir ? { cwd: process.cwd(), env: { ...process.env, BIZAR_EVIDENCE_DIR: dir } } : {});
  if (wantJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.missingOutcome.length === 0 && report.mismatched.length === 0 ? 0 : 1;
  }
  console.log(chalk.green(`  primary rows: ${report.primaryRows}  total rows: ${report.totalRows}`));
  console.log(chalk.yellow(`  missing outcome: ${report.missingOutcome.length}`));
  console.log(chalk.yellow(`  provider-model mismatch: ${report.mismatched.length}`));
  if (report.missingOutcome.length > 0) {
    console.log('');
    console.log(chalk.yellow('  Missing outcome:'));
    for (const row of report.missingOutcome.slice(0, 20)) {
      console.log(`    ${row.routingDecisionId}  decision.modelId=${row.decision?.modelId ?? '(null)'}  run=${row.runId}`);
    }
  }
  if (report.mismatched.length > 0) {
    console.log('');
    console.log(chalk.yellow('  Provider-model mismatch:'));
    for (const row of report.mismatched.slice(0, 20)) {
      console.log(`    ${row.routingDecisionId}  decision.modelId=${row.decision?.modelId}  actualProviderModel=${row.outcome?.actualProviderModel}`);
    }
  }
  return report.missingOutcome.length === 0 && report.mismatched.length === 0 ? 0 : 1;
}

// ── run() entrypoint ─────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'evidence') return false;
  if (isHelpRequest || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return true;
  }
  const sub = args[0];
  if (!sub) {
    showHelp();
    return true;
  }
  // Strip the subcommand from args before delegating.
  const rest = args.slice(1);
  switch (sub) {
    case 'tail':
      process.exit(handleTail(rest));
      return true;
    case 'show':
      process.exit(handleShow(rest));
      return true;
    case 'verify':
      process.exit(handleVerify(rest));
      return true;
    case 'run':
      process.exit(handleRun(rest));
      return true;
    case 'audit':
      process.exit(handleAudit(rest));
      return true;
    default:
      console.error(chalk.red(`  ✗ unknown evidence subcommand: ${sub}`));
      showHelp();
      process.exit(2);
      return true;
  }
}
