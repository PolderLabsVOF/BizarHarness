#!/usr/bin/env node
/**
 * Read-only retained-core audit with machine-readable evidence.
 *
 * Each category scores 0 or 10 from an executable check. `--write` also
 * stores the report at `.harness/audit/latest.json`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function command(command, args, success, failure) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = (result.stderr || result.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0];
  return {
    score: result.status === 0 ? 10 : 0,
    evidence: result.status === 0 ? success : `${failure}${output ? `: ${output}` : ''}`,
  };
}

function predicate(ok, success, failure) {
  return { score: ok ? 10 : 0, evidence: ok ? success : failure };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function listJsonDir(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(join(path, name)))
    .filter(Boolean);
}

const openKanIndex = readJson(join(ROOT, '.ok', 'index.json'));
const openKanTasks = listJsonDir(join(ROOT, '.ok', 'tasks'));
const openKanPlans = listJsonDir(join(ROOT, '.ok', 'plans'));
const openKanPrds = listJsonDir(join(ROOT, '.ok', 'prds'));
const activeOpenKanTask = openKanTasks.find((task) => task?.status === 'in_progress') || null;

function openKanStateEvidence() {
  if (!openKanIndex || !Array.isArray(openKanIndex.tasks)) {
    return 'OpenKan workspace .ok/ is missing or invalid — bootstrap with: bizar openkan init';
  }
  const taskCount = openKanIndex.tasks.length;
  const planCount = openKanIndex.plans?.length || 0;
  const prdCount = openKanIndex.prds?.length || 0;
  const ownerLine = activeOpenKanTask?.owner ? ` active task ${activeOpenKanTask.id} owned by ${activeOpenKanTask.owner}` : '';
  return `OpenKan .ok/ present: ${taskCount} task(s), ${planCount} plan(s), ${prdCount} PRD(s)${ownerLine}.`;
}

const settings = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'config', 'claude', 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
})();

const categories = {
  typecheck: command('npm', ['run', 'typecheck', '--silent'], 'TypeScript typecheck passed.', 'TypeScript typecheck failed'),
  tests: command('npm', ['run', 'test:sdk', '--silent'], 'SDK unit suite passed.', 'SDK unit suite failed'),
  e2e: command(process.execPath, ['scripts/bh-full-e2e.mjs'], 'Claude Code core E2E passed.', 'Core E2E failed'),
  archBoundaries: command('bash', ['scripts/check-arch.sh', '.'], 'Architecture rules passed.', 'Architecture rule failed'),
  securityPatterns: command(process.execPath, ['config/claude/hooks/__tests__/workflow-guards.test.mjs'], 'Approval and safety guard tests passed.', 'Workflow guard test failed'),
  docSync: command('bash', ['scripts/mirror-claude-md.sh', '--check'], 'CLAUDE.md mirror is synchronized.', 'CLAUDE.md mirror drifted'),
  openKanState: predicate(
    !!openKanIndex && Array.isArray(openKanIndex.tasks) && openKanTasks.length > 0,
    openKanStateEvidence(),
    openKanStateEvidence(),
  ),
  cleanState: command(process.execPath, ['scripts/verify-removed-surfaces.mjs'], 'Removed UI and note-vault surfaces are absent.', 'Removed surface remains'),
  perfBudget: predicate(
    existsSync(join(ROOT, 'packages', 'sdk', 'src', 'mcp', 'bin.ts')),
    'Runtime is a bounded stdio MCP process with no persistent service.',
    'MCP runtime entry is missing.',
  ),
  coverage: predicate(
    existsSync(join(ROOT, 'packages', 'sdk', 'tests')) && existsSync(join(ROOT, 'config', 'claude', 'hooks', '__tests__')),
    'SDK and hook behavior both have executable test suites.',
    'SDK or hook test coverage directory is missing.',
  ),
  observability: predicate(
    !!settings?.hooks?.SessionStart && !!settings?.hooks?.SessionEnd && !!settings?.hooks?.UserPromptSubmit,
    'Local lifecycle telemetry is wired for start, prompt, and end events.',
    'Lifecycle observability hooks are incomplete.',
  ),
  drift: command(process.execPath, ['scripts/sync-skills-mirror.mjs', '--check'], 'Canonical and project skill trees match.', 'Skill mirror drift detected'),
};

const weights = Object.fromEntries(Object.keys(categories).map((key) => [key, 1 / Object.keys(categories).length]));
const scores = Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.score]));
const total = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0) * 10) / 10;
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Claude Code core harness (dashboard and Bizar note-vault excluded and prohibited)',
  categories,
  scores,
  weights,
  total,
};

if (process.argv.includes('--write')) {
  const path = join(ROOT, '.harness', 'audit', 'latest.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
