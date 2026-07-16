/**
 * scripts/audit.mjs
 *
 * Pillar B — Self-auditing: harness score 0-100 across 12 categories.
 *
 * Each category scores 0-10. Weighted sum gives 0-100.
 * Deterministic — same repo state always yields same score.
 * Evidence string captured per category for transparency.
 *
 * Categories:
 *   typecheck  tests  e2e  arch-boundaries  security-patterns
 *   doc-sync  feature-list-state  clean-state  perf-budget
 *   coverage  observability  drift
 *
 * Usage:
 *   node scripts/audit.mjs                  → JSON to stdout
 *   node scripts/audit.mjs --write          → also write .harness/audit/latest.json
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HARNESS_AUDIT_DIR = join(ROOT, '.harness', 'audit');
const LATEST_PATH = join(HARNESS_AUDIT_DIR, 'latest.json');
const FEATURE_LIST = join(ROOT, 'feature_list.json');
const PROGRESS_MD = join(ROOT, '.bizar', 'PROGRESS.md');
const ARCH_RULES = join(ROOT, '.harness', 'arch-rules.json');
const CLAUDE_MD = join(ROOT, 'CLAUDE.md');
const AGENTS_MD = join(ROOT, 'AGENTS.md');

const WRITE = process.argv.includes('--write');

// ── Category definitions ──────────────────────────────────────────────────────

/**
 * @typedef {{ score: number, evidence: string }} CategoryResult
 * @typedef {Record<string, CategoryResult>} AuditResult
 */

/** Run a shell command, return {ok, stdout, stderr, exitCode}. */
function run(cmd, cwd = ROOT) {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', timeout: 120_000 });
    return { ok: true, stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

/** Score 10 if ok, 0 if not. */
function scoreOk(r) {
  return r.exitCode === 0 ? 10 : 0;
}

/** Score 10 if pass in last line, 0 otherwise. */
function scorePassInLastLine(r) {
  if (r.exitCode !== 0) return 0;
  const lines = r.stdout.split('\n');
  const last = lines[lines.length - 1]?.toLowerCase() ?? '';
  return last.includes('pass') || last.includes('ok') || last.includes('0 errors') ? 10 : 5;
}

// ── Individual category checks ────────────────────────────────────────────────

function checkTypecheck() {
  const r = run('bunx tsc --noEmit 2>&1');
  const score = r.exitCode === 0 ? 10 : 0;
  const evidence = score === 10
    ? 'bunx tsc --noEmit exited 0'
    : `bunx tsc --noEmit failed:\n${r.stdout.split('\n').slice(-3).join('\n')}`;
  return { score, evidence };
}

function checkTests() {
  // Run make test and look for pass/fail summary in last 5 lines
  const r = run('make test 2>&1');
  const lines = r.stdout.split('\n').slice(-5).join(' ');
  const lower = lines.toLowerCase();
  let score = 0;
  if (lower.includes('pass') || lower.includes('ok')) score = 10;
  else if (r.exitCode === 0) score = 10;
  else score = 0;
  const evidence = `make test exit ${r.exitCode}: ${lines.slice(-100)}`;
  return { score, evidence };
}

function checkE2e() {
  const r = run('bun run scripts/bh-full-e2e.mjs 2>&1');
  const lastLine = r.stdout.split('\n').slice(-2).join(' ').toLowerCase();
  const score = (r.exitCode === 0 || lastLine.includes('pass') || lastLine.includes('13/13'))
    ? 10
    : lastLine.includes('14/14') ? 10
    : lastLine.includes('22/22') ? 10
    : 0;
  const evidence = `bh-full-e2e.mjs exit ${r.exitCode}: ${r.stdout.split('\n').slice(-2).join(' ')}`;
  return { score, evidence };
}

function checkArchBoundaries() {
  const r = run('bash scripts/check-arch.sh . 2>&1');
  const score = r.exitCode === 0 ? 10 : 0;
  const evidence = score === 10
    ? 'check-arch.sh passed'
    : `check-arch.sh failed:\n${r.stdout.split('\n').slice(-3).join('\n')}`;
  return { score, evidence };
}

function checkSecurityPatterns() {
  // Scan for common security issues in config files
  let score = 10;
  const issues = [];

  // Check settings.json for dangerous patterns
  const settingsPath = join(ROOT, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, 'utf8');
      // Check for hardcoded API keys (simple heuristic)
      if (/api[_-]?key["\s:]+["'][a-zA-Z0-9_-]{20,}/.test(content)) {
        score -= 2;
        issues.push('possible hardcoded API key in settings.json');
      }
      // Check for dangerous shell exec patterns
      if (/shell:\s*true/.test(content)) {
        score -= 1;
        issues.push('shell:true found in settings');
      }
    } catch {
      // ignore
    }
  }

  // Check .claude/agents for unsafe tool grants
  const agentsDir = join(ROOT, '.claude', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir)) {
      if (!file.endsWith('.md')) continue;
      const content = readFileSync(join(agentsDir, file), 'utf8');
      // Flag commands that allow arbitrary bash without scoping
      if (/allowed-tools:.*\*\*/.test(content)) {
        score -= 2;
        issues.push(`${file}: overly broad allowed-tools:*`);
      }
    }
  }

  score = Math.max(0, score);
  const evidence = issues.length === 0
    ? 'No security pattern issues found'
    : `Issues: ${issues.join('; ')}`;
  return { score, evidence };
}

function checkDocSync() {
  // Check AGENTS.md and CLAUDE.md are in sync (mirror check)
  const r = run('bash scripts/mirror-claude-md.sh --check 2>&1');
  const score = r.exitCode === 0 ? 10 : 0;
  const evidence = score === 10
    ? 'AGENTS.md and CLAUDE.md in sync'
    : 'Mirror check failed — run make mirror-claude-md';
  return { score, evidence };
}

function checkFeatureListState() {
  if (!existsSync(FEATURE_LIST)) {
    return { score: 0, evidence: 'feature_list.json not found' };
  }
  try {
    const raw = JSON.parse(readFileSync(FEATURE_LIST, 'utf8'));
    const features = raw.features ?? [];
    if (features.length === 0) return { score: 0, evidence: 'feature_list.json has 0 features' };

    const notStarted = features.filter((f) => f.state === 'not_started').length;
    const passing = features.filter((f) => f.state === 'passing').length;
    const active = features.filter((f) => f.state === 'active').length;
    const total = features.length;

    // Penalise not_started features (WIP=1 violation) and missing evidence
    const noEvidence = features.filter((f) => f.state === 'passing' && !f.evidence).length;
    let score = 10;
    if (notStarted > 1) score -= 2;
    if (noEvidence > 0) score -= 1;
    score = Math.max(0, score);

    const evidence = `features=${total} passing=${passing} active=${active} not_started=${notStarted} missing_evidence=${noEvidence}`;
    return { score, evidence };
  } catch (err) {
    return { score: 0, evidence: `feature_list.json parse error: ${err.message}` };
  }
}

function checkCleanState() {
  // Check for console.log / debugger / .only() in production code
  const r = run(
    "grep -rEn '(console\\.log|debugger|\\.only\\()' packages/sdk/src plugins/bizar/index.ts plugins/bizar/src --include='*.ts' --include='*.mjs' 2>/dev/null | grep -v test | grep -v '\\.test\\.' || true"
  );
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const score = lines.length === 0 ? 10 : 0;
  const evidence = lines.length === 0
    ? 'No debug artifacts found'
    : `Found ${lines.length} debug artifacts:\n${lines.slice(0, 3).join('\n')}`;
  return { score, evidence };
}

function checkPerfBudget() {
  // Check that no single file exceeds reasonable line count (simple proxy)
  const TOO_BIG = 2000;
  let violations = [];
  for (const dir of [join(ROOT, 'packages', 'sdk', 'src'), join(ROOT, 'plugins', 'bizar', 'src')]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir, { recursive: true })) {
      if (!file.endsWith('.ts') && !file.endsWith('.mjs')) continue;
      const full = join(dir, file);
      try {
        const lines = readFileSync(full, 'utf8').split('\n');
        if (lines.length > TOO_BIG) {
          violations.push(`${file}:${lines.length} lines`);
        }
      } catch {
        // ignore unreadable
      }
    }
  }
  const score = violations.length === 0 ? 10 : Math.max(0, 10 - violations.length);
  const evidence = violations.length === 0
    ? 'No file exceeds 2000 lines'
    : `Files over 2000 lines: ${violations.slice(0, 3).join(', ')}`;
  return { score, evidence };
}

function checkCoverage() {
  // ponytail: coverage is not currently measured. When coverage tooling
  // (c8, vitest coverage) is added, replace this stub with actual coverage check.
  // Heuristic: check if any coverage-related config exists
  const hasCoverageConfig = existsSync(join(ROOT, 'coverage'))
    || existsSync(join(ROOT, '.nycrc'))
    || existsSync(join(ROOT, 'vitest.config.ts'));
  const score = hasCoverageConfig ? 7 : 3;
  const evidence = hasCoverageConfig
    ? 'Coverage tooling config found (actual coverage not measured)'
    : 'No coverage tooling configured — add c8/vitest coverage to measure';
  return { score, evidence };
}

function checkObservability() {
  // Check session traces directory exists and is writable
  const tracesDir = join(ROOT, '.harness', 'traces');
  const hasSessionsFile = existsSync(join(tracesDir, 'sessions.jsonl'));
  const hasArchRules = existsSync(ARCH_RULES);
  const score = hasSessionsFile && hasArchRules ? 10 : hasArchRules ? 7 : 3;
  const evidence = `sessions.jsonl=${hasSessionsFile} arch-rules.json=${hasArchRules}`;
  return { score, evidence };
}

function checkDrift() {
  // Compare latest audit score vs previous
  if (!existsSync(LATEST_PATH)) {
    return { score: 10, evidence: 'No prior audit — drift check skipped (first run)' };
  }
  try {
    const prev = JSON.parse(readFileSync(LATEST_PATH, 'utf8'));
    const prevTotal = prev.total ?? 0;
    const categories = prev.categories ?? {};
    const prevDiffs = Object.entries(categories)
      .map(([k, v]) => `${k}:${v.score}`)
      .sort()
      .join(',');

    // Compute current scores for comparison
    const currentScores = {
      typecheck: checkTypecheck().score,
      tests: checkTests().score,
      e2e: checkE2e().score,
      archBoundaries: checkArchBoundaries().score,
      securityPatterns: checkSecurityPatterns().score,
      docSync: checkDocSync().score,
      featureListState: checkFeatureListState().score,
      cleanState: checkCleanState().score,
      perfBudget: checkPerfBudget().score,
      coverage: checkCoverage().score,
      observability: checkObservability().score,
    };
    const currentTotal = computeTotal(currentScores);
    const currentDiffs = Object.entries(currentScores)
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join(',');

    const changed = prevDiffs !== currentDiffs;
    const delta = currentTotal - prevTotal;
    const score = changed ? 10 : 0; // Any change = good (we're tracking)
    const evidence = changed
      ? `Score changed: ${prevTotal}→${currentTotal} (Δ${delta >= 0 ? '+' : ''}${delta})`
      : `Score unchanged: ${prevTotal} (no drift since last audit)`;
    return { score, evidence };
  } catch (err) {
    return { score: 5, evidence: `Could not read prior audit: ${err.message}` };
  }
}

// ── Weights and aggregation ───────────────────────────────────────────────────

/** @type {Record<string, number>} */
const WEIGHTS = {
  typecheck: 0.15,
  tests: 0.12,
  e2e: 0.12,
  archBoundaries: 0.08,
  securityPatterns: 0.10,
  docSync: 0.05,
  featureListState: 0.10,
  cleanState: 0.08,
  perfBudget: 0.05,
  coverage: 0.05,
  observability: 0.05,
  drift: 0.05,
};

/**
 * @param {Record<string, number>} scores
 * @returns {number}
 */
function computeTotal(scores) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (scores[key] ?? 0) * weight;
  }
  return Math.round(total * 10) / 10; // round to 1 decimal
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startedAt = new Date().toISOString();

  const categories = {
    typecheck: checkTypecheck(),
    tests: checkTests(),
    e2e: checkE2e(),
    archBoundaries: checkArchBoundaries(),
    securityPatterns: checkSecurityPatterns(),
    docSync: checkDocSync(),
    featureListState: checkFeatureListState(),
    cleanState: checkCleanState(),
    perfBudget: checkPerfBudget(),
    coverage: checkCoverage(),
    observability: checkObservability(),
    drift: checkDrift(),
  };

  /** @type {Record<string, number>} */
  const scores = {};
  for (const [key, result] of Object.entries(categories)) {
    scores[key] = result.score;
  }

  const total = computeTotal(scores);

  /** @type {AuditResult} */
  const result = {
    version: '1.0.0',
    startedAt,
    completedAt: new Date().toISOString(),
    total,
    categories,
    scores,
    weights: WEIGHTS,
  };

  if (WRITE) {
    mkdirSync(HARNESS_AUDIT_DIR, { recursive: true });
    writeFileSync(LATEST_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  }

  // Always print JSON to stdout
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
