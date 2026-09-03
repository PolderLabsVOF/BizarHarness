#!/usr/bin/env node
/**
 * cli/commands/guard.mjs
 *
 * `bizar guard` — F-206 `/guard` progress-guarding loop operator
 * surface.
 *
 * Implements a bounded read-only progress audit that re-checks a plan
 * doc + PROGRESS.md + feature_list.json + recent git history + the
 * per-guard `checks.jsonl`. Every `check` invocation is independent —
 * there is no persistent background process. The cadence is driven by
 * the operator wiring `bizar guard check` into Claude Code's `/loop`
 * primitive or an external scheduler.
 *
 * Subcommands:
 *
 *   bizar guard start  --plan <path> [--interval 15m] [--goal <text>] [--slug <id>]
 *     Create the guard and print a copy-pasteable `/loop` invocation.
 *
 *   bizar guard check  [--slug <id>] [--json]
 *     Run ONE bounded audit; append the verdict to checks.jsonl; exit
 *     0 for healthy|done, 2 for drift|stuck.
 *
 *   bizar guard status [--slug <id>] [--json]
 *     Print the guard's state + the most recent checks.
 *
 *   bizar guard stop   --slug <id>
 *     Mark the guard as stopped (operator override).
 *
 *   bizar guard list   [--json]
 *     Enumerate every guard on disk.
 *
 * The guard MUST NOT auto-commit, auto-push, or auto-publish. All
 * "fix" actions are advisory log/nudge writes only.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  addGuard,
  getGuard,
  listGuardChecks,
  listGuards,
  markGuardStopped,
  normalizeSlug,
  recordGuardCheck,
} from '../../packages/sdk/dist/agent/guard.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

function usage() {
  console.log(`
  bizar guard — F-206 progress-guarding loop (audit-only)

  Usage:
    bizar guard start --plan <path> [--interval 15m|900000|1h] [--goal <text>] [--slug <id>]
    bizar guard check [--slug <id>] [--json]
    bizar guard status [--slug <id>] [--json]
    bizar guard stop --slug <id>
    bizar guard list [--json]

  What guard does:
    start  creates a guard at .bizar/guards/<slug>/ and prints a
           copy-pasteable /loop invocation for the configured cadence.
    check  runs ONE bounded read-only audit (plan doc, PROGRESS.md,
           feature_list.json, recent commits, prior checks) and
           records a verdict to .bizar/guards/<slug>/checks.jsonl.
           Self-terminates on verdict=done; nudges PROGRESS.md on
           drift|stuck; writes to drift-log.md for drift|stuck.
    status prints the guard's state and the most recent 5 checks.
    stop   marks the guard as stopped (operator override).
    list   enumerates every guard on disk.

  Verdicts:
    healthy  plan is progressing, recent activity present
    drift    plan's stated next-actions diverge from PROGRESS.md
    stuck    no commits in last interval, no in-flight worktrees,
             no feature_list.json state change
    done     plan closed or feature_list.json WIP=0 with all shipped
             features (self-terminates; writes DONE.md archive note)

  Exit codes:
    0  healthy | done
    2  drift | stuck
    1  usage / IO error
`);
}

// ── Interval parsing ────────────────────────────────────────────────────────

/**
 * Parse an interval string into milliseconds. Accepts plain integers
 * (interpreted as ms) or `<n><unit>` with unit ∈ {s, m, h}.
 *
 * Examples: "15m" → 900000, "900000" → 900000, "1h" → 3600000,
 * "30s" → 30000.
 */
function parseInterval(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UsageError('GUARD_INTERVAL_INVALID: interval must be a non-empty string');
  }
  const trimmed = raw.trim();
  const m = /^(\d+)(ms|s|m|h)?$/.exec(trimmed);
  if (!m) {
    throw new UsageError(
      `GUARD_INTERVAL_INVALID: cannot parse interval ${JSON.stringify(raw)}; expected forms: 900000, 15m, 1h, 30s`,
    );
  }
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  if (!Number.isFinite(n) || n <= 0) {
    throw new UsageError(`GUARD_INTERVAL_INVALID: interval must be > 0`);
  }
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    default:
      throw new UsageError(`GUARD_INTERVAL_INVALID: unknown unit ${unit}`);
  }
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Tiny flag parser: returns Record<flag, value | true> for present flags. */
function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string') continue;
    if (!a.startsWith('--')) {
      if (!out._positional) out._positional = [];
      out._positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function resolveRepoRoot() {
  return process.cwd();
}

function repoGuardDir(slug, repoRoot = resolveRepoRoot()) {
  return join(repoRoot, '.bizar', 'guards', slug);
}

function clampLimit(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(50, Math.floor(n));
}

// ── Subcommand: start ───────────────────────────────────────────────────────

function runStart(flags) {
  const planPath = typeof flags.plan === 'string' ? flags.plan : '';
  if (!planPath) {
    console.error('guard start: --plan <path> is required');
    return EXIT_USAGE;
  }
  if (!existsSync(planPath)) {
    console.error(`guard start: plan file not found: ${planPath}`);
    return EXIT_ERROR;
  }
  let intervalMs;
  try {
    intervalMs = parseInterval(typeof flags.interval === 'string' ? flags.interval : '15m');
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`guard start: ${err.message}`);
      return EXIT_USAGE;
    }
    throw err;
  }
  const goal = typeof flags.goal === 'string' ? flags.goal : undefined;
  const explicitSlug = typeof flags.slug === 'string' ? flags.slug : undefined;
  let guard;
  try {
    guard = addGuard({
      planPath,
      intervalMs,
      goal,
      slug: explicitSlug,
      repoRoot: resolveRepoRoot(),
    });
  } catch (err) {
    if (err instanceof UsageError || /GUARD_/.test(String(err?.message ?? ''))) {
      console.error(`guard start: ${err.message}`);
      return EXIT_USAGE;
    }
    console.error(`guard start: ${err?.message ?? String(err)}`);
    return EXIT_ERROR;
  }
  const intervalHuman = humanizeInterval(guard.intervalMs);
  const slashLine = `/loop ${intervalHuman} "bizar guard check --slug ${guard.slug} --json"`;
  console.log(`Guard ${guard.slug} ready at .bizar/guards/${guard.slug}/ (cadence ${intervalHuman}).`);
  console.log('');
  console.log('Wire the host-side loop with:');
  console.log(`  ${slashLine}`);
  console.log('');
  console.log('Or invoke a one-off audit any time with:');
  console.log(`  bizar guard check --slug ${guard.slug} --json`);
  return EXIT_OK;
}

function humanizeInterval(ms) {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

// ── Subcommand: list ────────────────────────────────────────────────────────

function runList(flags) {
  const repoRoot = resolveRepoRoot();
  const guards = listGuards(repoRoot);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ guards }, null, 2) + '\n');
    return EXIT_OK;
  }
  if (guards.length === 0) {
    console.log('No guards registered. Run `bizar guard start --plan <path>` to create one.');
    return EXIT_OK;
  }
  console.log('slug                            plan                     cadence   status   last verdict');
  console.log('------------------------------- ------------------------ --------- -------- -------------');
  for (const g of guards) {
    const cadence = humanizeInterval(g.intervalMs);
    const last = g.lastVerdict ?? '-';
    console.log(
      `${pad(g.slug, 31)} ${pad(truncate(g.planPath, 24), 24)} ${pad(cadence, 9)} ${pad(g.status, 8)} ${last}`,
    );
  }
  return EXIT_OK;
}

function pad(s, n) {
  s = String(s ?? '');
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…';
}

// ── Subcommand: status ──────────────────────────────────────────────────────

function runStatus(flags) {
  const slug = typeof flags.slug === 'string' ? flags.slug : guessActiveSlug();
  if (!slug) {
    console.error('guard status: --slug <id> is required when more than one guard exists');
    return EXIT_USAGE;
  }
  let normalized;
  try {
    normalized = normalizeSlug(slug);
  } catch (err) {
    console.error(`guard status: ${err.message}`);
    return EXIT_USAGE;
  }
  const repoRoot = resolveRepoRoot();
  const guard = getGuard(normalized, repoRoot);
  if (!guard) {
    console.error(`guard status: no guard with slug ${normalized}`);
    return EXIT_ERROR;
  }
  const limit = clampLimit(flags.limit, 5);
  const checks = listGuardChecks(normalized, limit, repoRoot);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ guard, checks }, null, 2) + '\n');
    return EXIT_OK;
  }
  console.log(`guard ${guard.slug}`);
  console.log(`  plan      : ${guard.planPath}`);
  console.log(`  cadence   : ${humanizeInterval(guard.intervalMs)}`);
  console.log(`  status    : ${guard.status}`);
  console.log(`  started   : ${guard.startedAt}`);
  console.log(`  last check: ${guard.lastCheckedAt ?? '(none)'}`);
  console.log(`  last verdict: ${guard.lastVerdict ?? '(none)'}`);
  if (guard.goal) console.log(`  goal      : ${guard.goal}`);
  if (checks.length > 0) {
    console.log('');
    console.log(`  recent checks (last ${checks.length}):`);
    for (const c of checks) {
      console.log(`    ${c.ts}  ${pad(c.verdict, 7)}  ${c.recommendation}`);
    }
  }
  return EXIT_OK;
}

// ── Subcommand: stop ────────────────────────────────────────────────────────

function runStop(flags) {
  const slug = typeof flags.slug === 'string' ? flags.slug : guessActiveSlug();
  if (!slug) {
    console.error('guard stop: --slug <id> is required');
    return EXIT_USAGE;
  }
  let normalized;
  try {
    normalized = normalizeSlug(slug);
  } catch (err) {
    console.error(`guard stop: ${err.message}`);
    return EXIT_USAGE;
  }
  try {
    const stopped = markGuardStopped(normalized, resolveRepoRoot());
    console.log(`guard ${stopped.slug}: status=stopped stoppedAt=${stopped.stoppedAt}`);
    return EXIT_OK;
  } catch (err) {
    console.error(`guard stop: ${err?.message ?? String(err)}`);
    return EXIT_ERROR;
  }
}

// ── Subcommand: check ───────────────────────────────────────────────────────

function runCheck(flags) {
  const repoRoot = resolveRepoRoot();
  const slug = typeof flags.slug === 'string' ? flags.slug : guessActiveSlug();
  if (!slug) {
    console.error('guard check: --slug <id> is required when more than one guard exists');
    return EXIT_USAGE;
  }
  let normalized;
  try {
    normalized = normalizeSlug(slug);
  } catch (err) {
    console.error(`guard check: ${err.message}`);
    return EXIT_USAGE;
  }
  const guard = getGuard(normalized, repoRoot);
  if (!guard) {
    console.error(`guard check: no guard with slug ${normalized}`);
    return EXIT_ERROR;
  }
  const audit = performAudit(normalized, guard, repoRoot);
  // Side effects BEFORE writing the check so failures are visible.
  if (audit.verdict === 'done') {
    writeDoneArchive(normalized, guard, audit, repoRoot);
  }
  if (audit.verdict === 'drift' || audit.verdict === 'stuck') {
    appendDriftLog(normalized, guard, audit, repoRoot);
    nudgeProgressMd(audit, repoRoot);
  }
  let updated;
  try {
    updated = recordGuardCheck(
      normalized,
      {
        ts: new Date().toISOString(),
        verdict: audit.verdict,
        signals: audit.signals,
        recommendation: audit.recommendation,
        selfTerminated: audit.verdict === 'done',
      },
      repoRoot,
    );
  } catch (err) {
    console.error(`guard check: ${err?.message ?? String(err)}`);
    return EXIT_ERROR;
  }
  const json = {
    slug: normalized,
    verdict: audit.verdict,
    signals: audit.signals,
    recommendation: audit.recommendation,
    selfTerminated: audit.verdict === 'done',
    status: updated.status,
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } else {
    console.log(`guard ${normalized}: verdict=${audit.verdict}`);
    if (audit.signals.length > 0) {
      for (const s of audit.signals) console.log(`  · ${s}`);
    }
    console.log(`  → ${audit.recommendation}`);
    if (json.selfTerminated) {
      console.log(`  status=${updated.status} (self-terminated)`);
    }
  }
  if (audit.verdict === 'drift' || audit.verdict === 'stuck') return 2;
  return EXIT_OK;
}

function guessActiveSlug() {
  const all = listGuards(resolveRepoRoot());
  if (all.length === 1) return all[0].slug;
  return null;
}

// ── Audit logic ─────────────────────────────────────────────────────────────

/**
 * Run a bounded read-only audit. Returns the verdict, signal list, and
 * recommendation. The function is intentionally pure with respect to
 * inputs (other than spawning git); all side-effects live in the caller.
 */
function performAudit(slug, guard, repoRoot) {
  const signals = [];
  let done = false;

  // Signal A: plan doc has a `## Done` / `## Complete` heading at the
  // top of its section list. We treat the *first* H2 after the doc's
  // intro as the candidate — operators routinely use a "Done" header
  // to mark plan closure.
  const planAbs = resolvePlanPath(guard.planPath, repoRoot);
  if (existsSync(planAbs)) {
    const text = readFileSync(planAbs, 'utf-8');
    const headings = Array.from(text.matchAll(/^##\s+([^\n]+)$/gm)).map((m) => m[1].trim());
    const firstHeading = headings[0] ?? null;
    if (firstHeading && /^(done|complete|completed)$/i.test(firstHeading)) {
      signals.push(`plan doc first H2 is "${firstHeading}"`);
      done = true;
    } else {
      signals.push(`plan doc first H2 is "${firstHeading ?? '(none)'}"`);
    }
  } else {
    signals.push(`plan doc missing at ${planAbs}`);
  }

  // Signal B: feature_list.json — if WIP=0 AND activated == passing AND
  // there is no in-progress feature, ship is complete.
  const featureListDone = checkFeatureList(repoRoot, signals);
  if (featureListDone) done = true;

  // Signal C: PROGRESS.md + recent git log freshness.
  if (checkProgressAndGit(guard, repoRoot, signals)) done = true;

  // Signal D: drift — compare plan's stated next-actions to PROGRESS.md's
  // last `## In Progress` block's next-actions.
  if (!done && checkDrift(guard, repoRoot, signals)) {
    return {
      verdict: 'drift',
      signals,
      recommendation:
        'Plan doc and PROGRESS.md diverge. Reconcile the next-actions list in the plan doc with the most-recent `## In Progress` block in PROGRESS.md, then re-run `bizar guard check`.',
    };
  }

  // Signal E: stuck — escalate when the last 2 checks were stuck OR
  // when no commits / no worktrees / no state change in the interval.
  if (!done && checkStuck(guard, slug, repoRoot, signals)) {
    return {
      verdict: 'stuck',
      signals,
      recommendation:
        'No state change in the last interval and the previous two checks were also unhealthy. Pause the loop, refresh the plan doc, and resume by re-running `bizar guard start` with a fresh slug.',
    };
  }

  if (done) {
    return {
      verdict: 'done',
      signals,
      recommendation:
        'Plan is closed. Self-termination: status=done, archive note written to .bizar/guards/<slug>/DONE.md.',
    };
  }
  return {
    verdict: 'healthy',
    signals,
    recommendation: 'Progress is on track. Continue the loop; next check in '
      + humanizeInterval(guard.intervalMs) + '.',
  };
}

function resolvePlanPath(planPath, repoRoot) {
  return isAbsolute(planPath) ? planPath : resolve(repoRoot, planPath);
}

function checkFeatureList(repoRoot, signals) {
  const fp = join(repoRoot, 'feature_list.json');
  if (!existsSync(fp)) {
    signals.push('feature_list.json not present at repo root');
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(fp, 'utf-8'));
  } catch (err) {
    signals.push(`feature_list.json malformed: ${err.message}`);
    return false;
  }
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  const inProgress = features.filter((f) => f && f.state === 'in_progress');
  const passing = features.filter((f) => f && f.state === 'passing').length;
  const activated = features.filter((f) => f && f.state !== 'not_started').length;
  signals.push(`feature_list: passing=${passing} activated=${activated} in_progress=${inProgress.length}`);
  const vcr = parsed?.vcr ?? null;
  if (vcr && typeof vcr.activated === 'number' && vcr.activated === vcr.passing && inProgress.length === 0) {
    signals.push(`vcr.activated (${vcr.activated}) == vcr.passing (${vcr.passing}) with no in_progress`);
    return true;
  }
  if (activated > 0 && passing === activated && inProgress.length === 0) {
    return true;
  }
  return false;
}

function checkProgressAndGit(guard, repoRoot, signals) {
  const fp = join(repoRoot, 'PROGRESS.md');
  if (!existsSync(fp)) {
    signals.push('PROGRESS.md not present at repo root');
    return false;
  }
  const text = readFileSync(fp, 'utf-8');
  const headerRe = /^## In Progress[^\n]*$/gm;
  const headers = Array.from(text.matchAll(headerRe)).map((m) => ({
    header: m[0],
    offset: m.index ?? 0,
  }));
  if (headers.length === 0) {
    signals.push('PROGRESS.md has no `## In Progress` header');
    return false;
  }
  const last = headers[headers.length - 1];
  const blockStart = last.offset + last.header.length;
  const nextHeader = text.slice(blockStart).search(/^##\s/m);
  const blockText = nextHeader === -1
    ? text.slice(blockStart)
    : text.slice(blockStart, blockStart + nextHeader);
  const statusMatch = blockText.match(/###\s+Status\s*\n+([^\n]+)/);
  if (statusMatch && /All gates green/i.test(statusMatch[1])) {
    signals.push(`PROGRESS.md most-recent Status: "${statusMatch[1].trim()}"`);
    // Combined gate: also need a "no commits since last check" freshness
    // signal AND a relatively complete plan doc; if both hold, treat
    // as done. Otherwise surface this as a strong "healthy" signal.
    const lastCheck = guard.lastCheckedAt;
    const lastCommit = recentLastCommitDate(repoRoot);
    if (lastCheck && lastCommit && lastCommit <= lastCheck) {
      signals.push(`git log: last commit ${lastCommit} <= last check ${lastCheck}`);
      return true;
    }
    signals.push('PROGRESS.md reports all gates green but commits are newer than last check');
  } else {
    signals.push('PROGRESS.md most-recent Status does not read "All gates green"');
  }
  return false;
}

function recentLastCommitDate(repoRoot) {
  const res = spawnSync(
    'git',
    ['-C', repoRoot, 'log', '-1', '--pretty=%cI'],
    { encoding: 'utf-8', timeout: 5000 },
  );
  if (res.status !== 0) return null;
  const ts = (res.stdout ?? '').trim();
  return ts || null;
}

function checkDrift(guard, repoRoot, signals) {
  const planAbs = resolvePlanPath(guard.planPath, repoRoot);
  if (!existsSync(planAbs)) return false;
  const planText = readFileSync(planAbs, 'utf-8');
  const planNextActions = extractNextActions(planText);
  const progressFp = join(repoRoot, 'PROGRESS.md');
  if (!existsSync(progressFp)) return false;
  const progressText = readFileSync(progressFp, 'utf-8');
  const progressNext = extractNextActions(progressText);
  if (planNextActions.length === 0 && progressNext.length === 0) {
    signals.push('no extractable next-action items in either doc');
    return false;
  }
  // A drift signal fires when one doc carries material next-action
  // content (>= 3 items) that the other doc does not surface.
  if (planNextActions.length === 0) {
    signals.push(`PROGRESS.md has ${progressNext.length} next-action items but plan doc has none`);
    return progressNext.length >= 3;
  }
  if (progressNext.length === 0) {
    signals.push(`plan doc has ${planNextActions.length} next-action items but PROGRESS.md has none`);
    return planNextActions.length >= 3;
  }
  // Compare by normalized token sets: a "drift" requires >= 3
  // semantically different items that the one doc mentions and the
  // other doesn't. We approximate semantic difference by set-difference
  // between key-token bags.
  const planTokens = tokenize(planNextActions.join('\n'));
  const progressTokens = tokenize(progressNext.join('\n'));
  const onlyInPlan = planTokens.filter((t) => !progressTokens.includes(t));
  const onlyInProgress = progressTokens.filter((t) => !planTokens.includes(t));
  signals.push(
    `plan next-actions: ${planNextActions.length} items; PROGRESS.md next-actions: ${progressNext.length} items; only-in-plan=${onlyInPlan.length} only-in-progress=${onlyInProgress.length}`,
  );
  if (onlyInPlan.length >= 3 || onlyInProgress.length >= 3) return true;
  return false;
}

function checkStuck(guard, slug, repoRoot, signals) {
  // First: escalate if the last 2 checks were both stuck.
  const recentChecks = listGuardChecks(slug, 2, repoRoot);
  const lastTwoStuck = recentChecks.length >= 2 && recentChecks.every((c) => c.verdict === 'stuck');
  if (lastTwoStuck) {
    signals.push('previous two checks were both stuck');
    return true;
  }
  // Second: surface as stuck if no commits in last interval AND no
  // in-flight worktrees older than 2 intervals AND no feature_list.json
  // state change since last check.
  const intervalMs = guard.intervalMs;
  const lastCommit = recentLastCommitDate(repoRoot);
  const lastCheck = guard.lastCheckedAt;
  const lastCommitStale = lastCommit && lastCheck && Date.parse(lastCommit) <= Date.parse(lastCheck);
  const staleSeconds = intervalMs / 1000;
  const worktrees = listWorktreesOlderThan(repoRoot, intervalMs * 2);
  const featureListChanged = hasFeatureListChangedSince(repoRoot, lastCheck);
  signals.push(
    `stuck-gates: lastCommitStale=${!!lastCommitStale} worktrees(${staleSeconds * 2}s)=${worktrees.length} featureListChanged=${featureListChanged}`,
  );
  if (lastCommitStale && worktrees.length === 0 && !featureListChanged) {
    return true;
  }
  return false;
}

function listWorktreesOlderThan(repoRoot, cutoffMs) {
  const res = spawnSync(
    'git',
    ['-C', repoRoot, 'worktree', 'list', '--porcelain'],
    { encoding: 'utf-8', timeout: 5000 },
  );
  if (res.status !== 0) return [];
  const out = (res.stdout ?? '').trim();
  if (!out) return [];
  const lines = out.split('\n');
  const records = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current) records.push(current);
  // We approximate "age" by branch-tip commit date for the worktree.
  const cutoffIso = new Date(Date.now() - cutoffMs).toISOString();
  return records.filter((r) => {
    if (!r.branch) return false;
    const tipRes = spawnSync(
      'git',
      ['-C', r.path ?? repoRoot, 'log', '-1', '--pretty=%cI', r.branch],
      { encoding: 'utf-8', timeout: 5000 },
    );
    if (tipRes.status !== 0) return false;
    const ts = (tipRes.stdout ?? '').trim();
    return ts && ts <= cutoffIso;
  });
}

function hasFeatureListChangedSince(repoRoot, sinceIso) {
  if (!sinceIso) return false;
  const fp = join(repoRoot, 'feature_list.json');
  if (!existsSync(fp)) return false;
  const stat = statSyncSafe(fp);
  if (!stat) return false;
  const iso = new Date(stat.mtimeMs).toISOString();
  return iso > sinceIso;
}

function statSyncSafe(fp) {
  try {
    return statSync(fp);
  } catch {
    return null;
  }
}

// ── Next-action extraction ────────────────────────────────────────────────

const NEXT_HEADING_RE = /(^|\n)\s*##+\s*(?:Next actions?|Next Steps?|Next Steps)\s*\n+([\s\S]*?)(?=\n\s*##+\s|\n\s*---+\s|$)/i;

/**
 * Extract a list of "next action" bullets from a markdown doc.
 * Looks for a heading named "Next actions" / "Next Steps" and grabs any
 * `-`, `*`, or numbered list items under it. Falls back to a scan for
 * standalone bullet items when no heading is present.
 */
function extractNextActions(text) {
  const m = text.match(NEXT_HEADING_RE);
  if (m) {
    return bulletsIn(m[2]);
  }
  // Fallback: scan top of the doc for bullet items.
  const head = text.slice(0, 4000);
  return bulletsIn(head);
}

function bulletsIn(text) {
  const out = [];
  const re = /^\s*(?:[-*]|\d+\.)\s+(.+)$/gm;
  let bm;
  while ((bm = re.exec(text)) !== null) {
    const item = bm[1].trim();
    if (item.length > 0) out.push(item);
  }
  return out;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'as', 'at', 'by', 'from',
  'this', 'that', 'these', 'those', 'it', 'its', 'into', 'out', 'up', 'down',
  'over', 'under', 'via', 'per', 'each', 'some', 'all', 'any', 'no', 'not',
  'we', 'our', 'you', 'your', 'they', 'their', 'them', 'i', 'me', 'my',
  'do', 'does', 'did', 'done', 'make', 'makes', 'made',
]);

function tokenize(text) {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9-]+/g)
      .filter((t) => t.length >= 4 && !STOP.has(t)),
  ));
}

// ── Side-effect writers ───────────────────────────────────────────────────

function appendDriftLog(slug, guard, audit, repoRoot) {
  const dir = repoGuardDir(slug, repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fp = join(dir, 'drift-log.md');
  const stamp = new Date().toISOString();
  const lines = [
    '',
    `## ${stamp} — verdict=${audit.verdict}`,
    '',
    `- plan: \`${guard.planPath}\``,
    `- cadence: ${humanizeInterval(guard.intervalMs)}`,
    '',
    '### Signals',
    '',
    ...audit.signals.map((s) => `- ${s}`),
    '',
    '### Recommendation',
    '',
    `${audit.recommendation}`,
    '',
  ];
  appendFileSync(fp, lines.join('\n'), 'utf-8');
}

function writeDoneArchive(slug, guard, audit, repoRoot) {
  const dir = repoGuardDir(slug, repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fp = join(dir, 'DONE.md');
  const lines = [
    `# Guard ${slug} — self-terminated`,
    '',
    `- plan: \`${guard.planPath}\``,
    `- cadence: ${humanizeInterval(guard.intervalMs)}`,
    `- closed: ${new Date().toISOString()}`,
    '',
    '## Signals',
    '',
    ...audit.signals.map((s) => `- ${s}`),
    '',
    '## Recommendation',
    '',
    `${audit.recommendation}`,
    '',
  ];
  writeFileSync(fp, lines.join('\n'), 'utf-8');
}

function nudgeProgressMd(audit, repoRoot) {
  const fp = join(repoRoot, 'PROGRESS.md');
  if (!existsSync(fp)) return;
  const text = readFileSync(fp, 'utf-8');
  const headers = Array.from(text.matchAll(/^## In Progress[^\n]*$/gm));
  if (headers.length === 0) return;
  const last = headers[headers.length - 1];
  const blockStart = last.index ?? 0;
  const blockEndCandidate = text.slice(blockStart + 1).search(/^##\s/m);
  const blockEnd = blockEndCandidate === -1
    ? text.length
    : blockStart + 1 + blockEndCandidate;
  const stamp = new Date().toISOString();
  const nudge = `\n\n> guard@${stamp}: ${audit.recommendation}\n`;
  const next = text.slice(0, blockEnd) + nudge + text.slice(blockEnd);
  writeFileSync(fp, next, 'utf-8');
}

// ── Public dispatch ─────────────────────────────────────────────────────────

export async function run(subargs) {
  const args = Array.isArray(subargs) ? subargs : [];
  const [subcmd, ...rest] = args;
  const flags = parseFlags(rest);
  if (subcmd === undefined || subcmd === '--help' || subcmd === '-h' || subcmd === 'help') {
    usage();
    return EXIT_OK;
  }
  switch (subcmd) {
    case 'start':
      return runStart(flags);
    case 'status':
      return runStatus(flags);
    case 'check':
      return runCheck(flags);
    case 'stop':
      return runStop(flags);
    case 'list':
      return runList(flags);
    default:
      console.error(`guard: unknown subcommand ${JSON.stringify(subcmd)}`);
      usage();
      return EXIT_USAGE;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
}
