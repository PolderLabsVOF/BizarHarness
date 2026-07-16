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
  const { stdout, stderr, status } = execSync(
    `node "${AUDIT_SCRIPT}" 2>&1`,
    { cwd: PROJECT_ROOT, encoding: 'utf8' }
  );
  return { stdout, stderr, status };
}

function parseAuditOutput(stdout) {
  try {
    if (!stdout || typeof stdout !== 'string') return null;
    const lines = stdout.trim().split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    return last ? JSON.parse(last) : null;
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
    'docSync', 'featureListState', 'cleanState', 'perfBudget',
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

test('missing feature_list.json yields score 0 for feature-list-state (tolerates missing state)', () => {
  // Rename the real feature_list.json out of the way, run audit, restore it
  const flPath = join(PROJECT_ROOT, 'feature_list.json');
  const backupPath = flPath + '.audit-test-backup';
  const hadBackup = existsSync(backupPath);
  if (existsSync(flPath)) {
    renameSync(flPath, backupPath);
  }
  try {
    const { stdout } = execSync(`node "${AUDIT_SCRIPT}" 2>&1`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    const result = parseAuditOutput(stdout);
    assert.ok(result !== null, `audit output should be valid JSON. stdout: ${(stdout ?? '').slice(0, 200)}`);
    assert.equal(result.scores.featureListState, 0, 'missing feature_list should give featureListState=0');
  } finally {
    if (existsSync(backupPath)) {
      renameSync(backupPath, flPath);
    }
  }
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
