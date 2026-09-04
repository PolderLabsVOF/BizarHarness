/**
 * cli/__tests__/goal-bootstrap.test.mjs
 *
 * CLI surface tests for `bizar goal-bootstrap` (F-207 Mike autonomous
 * goal seeding). The fixture is a tmp directory with a stub
 * `feature_list.json` written by the test; the CLI operates inside
 * that tmp and never touches the host repo.
 *
 * Coverage (5 cases):
 *   1. help exits 0 and prints the usage banner
 *   2. empty features → idle (no charter written)
 *   3. one not_started → bootstrap + charter file exists on disk
 *   4. existing charter for in_progress feature → resume
 *   5. malformed feature_list.json → warning + idle (graceful)
 */

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const BIN = join(REPO_ROOT, 'cli', 'bin.mjs');

const fixtures = [];

afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop(), { recursive: true, force: true });
});

function setupFixture(features = null) {
  const root = mkdtempSync(join(tmpdir(), 'bizar-goal-bootstrap-'));
  fixtures.push(root);
  const featureListPath = join(root, 'feature_list.json');
  if (features !== null) {
    writeFileSync(featureListPath, JSON.stringify(features, null, 2), 'utf-8');
  } else {
    // Empty object — also acceptable as "no features array" and should
    // not crash; the SDK helper tolerates the malformed shape and
    // returns idle with a warning.
    writeFileSync(featureListPath, '{}', 'utf-8');
  }
  const specsDir = join(root, 'docs', 'specs');
  // mkdirSync recursive so the resume test can pre-seed an existing
  // charter without a separate bootstrap call.
  mkdirSync(specsDir, { recursive: true });
  return { root, featureListPath, specsDir };
}

function runGoalBootstrap(args, { cwd, allowFail = false } = {}) {
  return spawnSync(process.execPath, [BIN, 'goal-bootstrap', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    ...(allowFail ? {} : { stdio: ['ignore', 'pipe', 'pipe'] }),
  });
}

describe('bizar goal-bootstrap', () => {
  test('prints help on --help and exits 0', () => {
    const res = runGoalBootstrap(['--help'], { cwd: REPO_ROOT });
    assert.equal(res.status, 0, `help should exit 0; stderr=${res.stderr}`);
    assert.match(res.stdout, /bizar goal-bootstrap — F-207 Mike autonomous goal seeding/);
    assert.match(res.stdout, /--feature-list/);
    assert.match(res.stdout, /--specs-dir/);
  });

  test('returns idle when there are no not_started features', () => {
    const { root, featureListPath, specsDir } = setupFixture({
      features: [
        { id: 'F-100', state: 'passing', title: 'Old' },
        { id: 'F-101', state: 'passing', title: 'Older' },
      ],
    });
    const res = runGoalBootstrap(
      ['--feature-list', featureListPath, '--specs-dir', specsDir],
      { cwd: root },
    );
    assert.equal(res.status, 0, `idle should exit 0; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.deepEqual(parsed, { action: 'idle' });
    assert.equal(existsSync(join(specsDir, 'ultragoal-F-100.md')), false);
  });

  test('writes the aggregate charter on a single not_started feature', () => {
    const { root, featureListPath, specsDir } = setupFixture({
      features: [
        { id: 'F-209', state: 'passing', title: 'Old' },
        { id: 'F-210', state: 'not_started', title: 'Ship the SDK helper', behavior: 'Test the bootstrap' },
      ],
    });
    const res = runGoalBootstrap(
      ['--feature-list', featureListPath, '--specs-dir', specsDir],
      { cwd: root },
    );
    assert.equal(res.status, 0, `bootstrap should exit 0; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.action, 'bootstrap');
    assert.equal(parsed.id, 'F-210');
    assert.equal(parsed.charterPath, join(specsDir, 'ultragoal-F-210.md'));
    assert.ok(existsSync(parsed.charterPath), 'charter file must be written');
    const body = readFileSync(parsed.charterPath, 'utf-8');
    assert.match(body, /# Ultragoal Charter — F-210/);
    assert.match(body, /Ship the SDK helper/);
    assert.match(body, /Test the bootstrap/);
  });

  test('resumes an existing charter for an in_progress feature', () => {
    const { root, featureListPath, specsDir } = setupFixture({
      features: [
        { id: 'F-207', state: 'in_progress', title: 'Self-bootstrap' },
        { id: 'F-208', state: 'not_started', title: 'Next' },
      ],
    });
    // Pre-seed the matching charter so the resume branch fires.
    writeFileSync(join(specsDir, 'ultragoal-F-207.md'), '# old charter\n', 'utf-8');
    const res = runGoalBootstrap(
      ['--feature-list', featureListPath, '--specs-dir', specsDir],
      { cwd: root },
    );
    assert.equal(res.status, 0, `resume should exit 0; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.deepEqual(parsed, { action: 'resume', id: 'F-207', source: 'spec' });
    // Resume must not rewrite the charter.
    assert.equal(readFileSync(join(specsDir, 'ultragoal-F-207.md'), 'utf-8'), '# old charter\n');
  });

  test('degrades gracefully when feature_list.json is malformed', () => {
    const { root, featureListPath, specsDir } = setupFixture();
    // Force-write a non-JSON body — the helper catches the parse error
    // and returns idle + warning instead of crashing SessionStart.
    writeFileSync(featureListPath, '{ this is not json', 'utf-8');
    const res = runGoalBootstrap(
      ['--feature-list', featureListPath, '--specs-dir', specsDir],
      { cwd: root, allowFail: true },
    );
    assert.equal(res.status, 0, `graceful path should still exit 0; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.action, 'idle');
    assert.ok(typeof parsed.warning === 'string' && parsed.warning.length > 0);
  });
});
