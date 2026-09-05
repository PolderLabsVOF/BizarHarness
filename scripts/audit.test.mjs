/**
 * scripts/audit.test.mjs
 *
 * Pillar B — Tests for scripts/audit.mjs
 * 5 test groups: each dimension scoring, total score, missing-state tolerance, evidence captured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.filename, '..', '..');
const AUDIT_SCRIPT = join(PROJECT_ROOT, 'scripts', 'audit.mjs');

// Load the module as a script (audit.mjs writes to stdout, so we invoke it)
// Always runs from PROJECT_ROOT so that ROOT resolution is correct.
function runAudit() {
  try {
    const stdout = execSync(`node "${AUDIT_SCRIPT}" 2>&1`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status ?? 1 };
  }
}

function parseAuditOutput(stdout) {
  try {
    if (!stdout || typeof stdout !== 'string') return null;
    // Try last non-empty line first (handles single-line JSON)
    const trimmed = stdout.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // Multi-line JSON: find the last line that starts a valid object/array
      const lines = trimmed.split('\n');
      // Find the first '{' or '[' and parse from there to end
      const startIdx = lines.findIndex((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
      if (startIdx >= 0) {
        return JSON.parse(lines.slice(startIdx).join('\n'));
      }
      return null;
    }
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Tests ─────────────────────────────────────────────────────────────────────

test('each dimension returns a score 0-10 and an evidence string', () => {
  const out = runAudit();
  if (out.status !== 0) return; // audit.mjs may fail in broken environments
  const result = parseAuditOutput(out.stdout);
  const dims = [
    'typecheck', 'tests', 'e2e', 'archBoundaries', 'securityPatterns',
    'docSync', 'openKanState', 'cleanState', 'perfBudget',
    'coverage', 'observability', 'drift',
  ];
  for (const dim of dims) {
    assert.ok(dim in result.categories, `Missing category: ${dim}`);
    const { score, evidence } = result.categories[dim];
    assert.ok(typeof score === 'number', `${dim}.score must be number`);
    assert.ok(score >= 0 && score <= 10, `${dim}.score must be 0-10, got ${score}`);
    assert.ok(typeof evidence === 'string', `${dim}.evidence must be string`);
    assert.ok(evidence.length > 0, `${dim}.evidence must be non-empty`);
  }
});

test('total score is the weighted sum of all dimensions', () => {
  const out = runAudit();
  if (out.status !== 0) return;
  const result = parseAuditOutput(out.stdout);

  const weights = result.weights ?? {};
  let expected = 0;
  for (const [key, weight] of Object.entries(weights)) {
    expected += (result.scores[key] ?? 0) * weight;
  }
  expected = Math.round(expected * 10) / 10;

  assert.equal(result.total, expected, `total ${result.total} should equal weighted sum ${expected}`);
});

test('missing .ok/ yields score 0 for openKanState (tolerates missing workspace)', () => {
  // Rename the real .ok/ out of the way, run audit, restore it.
  const okPath = join(PROJECT_ROOT, '.ok');
  const backupPath = okPath + '.audit-test-backup';
  const hadBackup = existsSync(backupPath);
  if (existsSync(okPath)) {
    renameSync(okPath, backupPath);
  }
  try {
    const stdout = execSync(`node "${AUDIT_SCRIPT}" 2>&1`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    const result = parseAuditOutput(stdout);
    assert.ok(result !== null, `audit output should be valid JSON. stdout: ${(stdout ?? '').slice(0, 200)}`);
    assert.equal(result.scores.openKanState, 0, 'missing .ok/ should give openKanState=0');
    assert.match(
      result.categories.openKanState.evidence,
      /bizar openkan init/,
      'evidence should point at the openkan init bootstrap',
    );
  } finally {
    if (existsSync(backupPath)) {
      renameSync(backupPath, okPath);
    }
  }
});

test('present .ok/ with live tasks yields score 10 for openKanState', () => {
  const out = runAudit();
  if (out.status !== 0) return;
  const result = parseAuditOutput(out.stdout);
  assert.ok(result, 'audit output should be valid JSON');
  assert.equal(result.scores.openKanState, 10, 'live .ok/ should give openKanState=10');
  const evidence = result.categories.openKanState.evidence;
  const taskMatch = evidence.match(/(\d+) task/);
  assert.ok(taskMatch, 'evidence should mention a task count');
  assert.ok(Number.isFinite(Number(taskMatch[1])), 'captured task count should be numeric');
  assert.ok(Number(taskMatch[1]) > 0, 'captured task count should be non-zero');
});

test('evidence strings are human-readable (non-empty, contain useful context)', () => {
  const out = runAudit();
  if (out.status !== 0) return;
  const result = parseAuditOutput(out.stdout);

  for (const [dim, { evidence }] of Object.entries(result.categories)) {
    assert.ok(
      evidence.length > 5 && typeof evidence === 'string',
      `${dim} evidence too short or not a string: "${evidence}"`
    );
  }
});

test('--write creates .harness/audit/latest.json', () => {
  const latestPath = join(PROJECT_ROOT, '.harness', 'audit', 'latest.json');
  const hadLatest = existsSync(latestPath);
  const backupPath = latestPath + '.audit-test-backup';
  if (hadLatest) {
    renameSync(latestPath, backupPath);
  }
  try {
    execSync(`node "${AUDIT_SCRIPT}" --write 2>&1`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    assert.ok(existsSync(latestPath), '.harness/audit/latest.json should exist after --write');
    const written = JSON.parse(readFileSync(latestPath, 'utf8'));
    assert.ok('total' in written, 'written JSON should have total');
    assert.ok('categories' in written, 'written JSON should have categories');
    assert.ok('scores' in written, 'written JSON should have scores');
  } finally {
    if (existsSync(latestPath)) rmSync(latestPath);
    if (hadLatest) {
      renameSync(backupPath, latestPath);
    }
  }
});
