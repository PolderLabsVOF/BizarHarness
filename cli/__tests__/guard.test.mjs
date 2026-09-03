/**
 * cli/__tests__/guard.test.mjs
 *
 * CLI surface tests for `bizar guard` (F-206 `/guard` progress-guarding
 * loop). The fixture is a tmp directory with a stub plan doc,
 * `feature_list.json`, and `PROGRESS.md` written by the test; the guard
 * operates entirely inside that tmp so it never touches the host repo.
 *
 * Coverage (12 cases):
 *   1.  start creates state.json and prints a /loop line
 *   2.  start with mismatched options throws GUARD_SLUG_TAKEN
 *   3.  status reads state and prints recent checks
 *   4.  check on a closed plan returns done and self-terminates
 *   5.  check on a drifted plan returns drift, exits 2, writes drift-log
 *   6.  check on a stuck plan returns stuck, exits 2
 *   7.  check on a healthy plan returns healthy, exits 0
 *   8.  stop transitions status to stopped
 *   9.  list enumerates every guard
 *   10. JSON output shape (slug, verdict, signals, recommendation, selfTerminated)
 *   11. missing-slug error path
 *   12. malformed planPath error path
 *   13. interval parsing: 15m, 900000, 1h
 */

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const BIN = join(REPO_ROOT, 'cli', 'bin.mjs');

const fixtures = [];

afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop(), { recursive: true, force: true });
});

function setupFixture({
  planH2 = 'Plan',
  driftPlan = false,
  stuck = false,
  done = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bizar-guard-'));
  fixtures.push(root);

  // Plan doc with optional ## Done first heading.
  const planPath = join(root, 'plan.md');
  const planBody = driftPlan
    ? '# Plan\n\n## Next actions\n\n- refactor token router\n- rewrite ambiguity CLI\n- rewrite guard loop\n- add new heuristic\n- delete legacy code\n- ship new release\n'
    : '# Plan\n\n## ' + planH2 + '\n\n- Build the SDK\n- Wire the CLI\n';
  writeFileSync(planPath, planBody);

  // feature_list.json: by default an in_progress feature so the audit
  // does not trip "done" via VCR/WIP=0. The done-path fixture flips
  // this off.
  const featureList = done
    ? {
        features: [
          { id: 'F-A', state: 'passing', title: 'A' },
          { id: 'F-B', state: 'passing', title: 'B' },
        ],
        vcr: { passing: 2, activated: 2, ratio: 1.0 },
      }
    : {
        features: [
          { id: 'F-A', state: 'passing', title: 'A' },
          { id: 'F-B', state: 'in_progress', title: 'B' },
          { id: 'F-C', state: 'not_started', title: 'C' },
        ],
        vcr: { passing: 1, activated: 2, ratio: 0.5 },
      };
  writeFileSync(join(root, 'feature_list.json'), JSON.stringify(featureList, null, 2));

  // PROGRESS.md: recent Status all-gates-green only on done path; in
  // other modes the status is "In flight" so we don't trip the
  // PROGRESS.md-done signal.
  const progressPath = join(root, 'PROGRESS.md');
  const progressBody = done
    ? '# Progress\n\n' +
      '## In Progress — fixture (2026-09-03)\n\n' +
      '### Status\n\nAll gates green\n\n'
    : '# Progress\n\n' +
      '## In Progress — fixture (2026-09-03)\n\n' +
      '### Status\n\nIn flight\n\n';
  writeFileSync(progressPath, progressBody);

  // For "stuck" tests: stamp feature_list.json older than last check,
  // and make sure there are no commits in this tmp (no .git).
  if (stuck) {
    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(planPath, oldTime, oldTime);
    utimesSync(join(root, 'feature_list.json'), oldTime, oldTime);
    utimesSync(progressPath, oldTime, oldTime);
  }

  return { root, planPath, featureList, progressPath };
}

function runGuard(args, { cwd, allowFail = false } = {}) {
  return spawnSync(process.execPath, [BIN, 'guard', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
    ...(allowFail ? {} : { stdio: ['ignore', 'pipe', 'pipe'] }),
  });
}

describe('bizar guard start', () => {
  test('creates state.json and prints a copy-pasteable /loop line', () => {
    const { root, planPath } = setupFixture();
    const res = runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    assert.equal(res.status, 0, `start should exit 0; stderr=${res.stderr}`);
    const statePath = join(root, '.bizar', 'guards', 'demo', 'state.json');
    assert.ok(existsSync(statePath), 'state.json must be created');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.slug, 'demo');
    assert.equal(state.planPath, planPath);
    assert.equal(state.intervalMs, 900_000); // default 15m
    assert.equal(state.status, 'pending');
    assert.match(res.stdout, /Guard demo ready/);
    assert.match(res.stdout, /\/loop 15m "bizar guard check --slug demo --json"/);
  });

  test('rejects re-add with mismatched options', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    const res = runGuard(
      ['start', '--plan', planPath, '--interval', '30m', '--slug', 'demo'],
      { cwd: root, allowFail: true },
    );
    assert.notEqual(res.status, 0, 'mismatched re-add must fail');
    assert.match(res.stderr, /GUARD_SLUG_TAKEN/);
  });
});

describe('bizar guard status', () => {
  test('prints state and recent checks', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    runGuard(['check', '--slug', 'demo', '--json'], { cwd: root, allowFail: true });
    const res = runGuard(['status', '--slug', 'demo'], { cwd: root });
    assert.equal(res.status, 0, `status should exit 0; stderr=${res.stderr}`);
    assert.match(res.stdout, /guard demo/);
    assert.match(res.stdout, /cadence\s*:\s*15m/);
    assert.match(res.stdout, /recent checks/);
  });

  test('JSON output includes guard and checks', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    runGuard(['check', '--slug', 'demo', '--json'], { cwd: root, allowFail: true });
    const res = runGuard(['status', '--slug', 'demo', '--json'], { cwd: root });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.guard.slug, 'demo');
    assert.ok(Array.isArray(parsed.checks));
  });
});

describe('bizar guard check', () => {
  test('returns done and self-terminates on a closed plan', () => {
    const { root, planPath } = setupFixture({ planH2: 'Done', done: true });
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    const res = runGuard(['check', '--slug', 'demo', '--json'], { cwd: root });
    assert.equal(res.status, 0, 'done should exit 0');
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.verdict, 'done');
    assert.equal(parsed.selfTerminated, true);
    assert.equal(parsed.status, 'done');
    const statePath = join(root, '.bizar', 'guards', 'demo', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.status, 'done');
    assert.ok(state.stoppedAt);
    assert.ok(existsSync(join(root, '.bizar', 'guards', 'demo', 'DONE.md')));
  });

  test('returns drift, exits 2, and writes drift-log on a divergent plan', () => {
    const { root, planPath } = setupFixture({ driftPlan: true });
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    const res = runGuard(['check', '--slug', 'demo', '--json'], { cwd: root, allowFail: true });
    assert.equal(res.status, 2, `drift should exit 2; got ${res.status}; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.verdict, 'drift');
    assert.equal(parsed.selfTerminated, false);
    const driftLog = join(root, '.bizar', 'guards', 'demo', 'drift-log.md');
    assert.ok(existsSync(driftLog), 'drift-log.md must be written');
    const driftText = readFileSync(driftLog, 'utf-8');
    assert.match(driftText, /verdict=drift/);
  });

  test('returns stuck, exits 2, on a stalled plan with no recent activity', () => {
    const { root, planPath } = setupFixture({ stuck: true });
    runGuard(['start', '--plan', planPath, '--slug', 'demo', '--interval', '15m'], { cwd: root });
    // Pre-seed two prior stuck checks so the escalation gate triggers.
    const checksPath = join(root, '.bizar', 'guards', 'demo', 'checks.jsonl');
    mkdirSync(dirname(checksPath), { recursive: true });
    const prior = [
      JSON.stringify({
        ts: '2020-01-01T00:00:00.000Z',
        verdict: 'stuck',
        signals: [],
        recommendation: '',
        selfTerminated: false,
      }),
      JSON.stringify({
        ts: '2020-01-01T00:30:00.000Z',
        verdict: 'stuck',
        signals: [],
        recommendation: '',
        selfTerminated: false,
      }),
    ].join('\n');
    writeFileSync(checksPath, prior + '\n');
    const res = runGuard(['check', '--slug', 'demo', '--json'], { cwd: root, allowFail: true });
    assert.equal(res.status, 2, `stuck should exit 2; got ${res.status}; stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.verdict, 'stuck');
  });

  test('returns healthy on a fresh plan and exits 0', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    const res = runGuard(['check', '--slug', 'demo', '--json'], { cwd: root });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.verdict, 'healthy');
    assert.equal(parsed.selfTerminated, false);
    assert.ok(parsed.signals.length >= 1);
  });
});

describe('bizar guard stop', () => {
  test('transitions status to stopped', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'demo'], { cwd: root });
    const res = runGuard(['stop', '--slug', 'demo'], { cwd: root });
    assert.equal(res.status, 0, `stop should exit 0; stderr=${res.stderr}`);
    const state = JSON.parse(
      readFileSync(join(root, '.bizar', 'guards', 'demo', 'state.json'), 'utf-8'),
    );
    assert.equal(state.status, 'stopped');
    assert.ok(state.stoppedAt);
  });
});

describe('bizar guard list', () => {
  test('enumerates every guard as JSON', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--slug', 'alpha'], { cwd: root });
    runGuard(['start', '--plan', planPath, '--slug', 'beta'], { cwd: root });
    const res = runGuard(['list', '--json'], { cwd: root });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.guards.length, 2);
    assert.deepEqual(parsed.guards.map((g) => g.slug).sort(), ['alpha', 'beta']);
  });

  test('prints empty list when no guards exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'bizar-guard-empty-'));
    fixtures.push(root);
    const res = runGuard(['list'], { cwd: root });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /No guards registered/);
  });
});

describe('bizar guard error paths', () => {
  test('missing slug on check returns a clear error', () => {
    const { root } = setupFixture();
    // No guards registered: a bare `check` must refuse rather than guess.
    const res = runGuard(['check'], { cwd: root, allowFail: true });
    assert.notEqual(res.status, 0);
    // explicit unknown slug also surfaces a clear error
    const res2 = runGuard(['check', '--slug', 'no-such-guard'], {
      cwd: root,
      allowFail: true,
    });
    assert.notEqual(res2.status, 0);
    assert.match(res2.stderr, /no guard with slug no-such-guard/);
  });

  test('missing plan file errors out on start', () => {
    const root = mkdtempSync(join(tmpdir(), 'bizar-guard-no-plan-'));
    fixtures.push(root);
    const res = runGuard(['start', '--plan', 'no-such-plan.md'], {
      cwd: root,
      allowFail: true,
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /plan file not found/);
  });

  test('rejects a malformed slug', () => {
    const { root, planPath } = setupFixture();
    const res = runGuard(
      ['start', '--plan', planPath, '--slug', 'Bad Slug!'],
      { cwd: root, allowFail: true },
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /GUARD_SLUG_INVALID/);
  });
});

describe('interval parsing', () => {
  test('15m parses to 900000ms', () => {
    const { root, planPath } = setupFixture();
    const res = runGuard(['start', '--plan', planPath, '--interval', '15m', '--slug', 'a'], {
      cwd: root,
    });
    assert.equal(res.status, 0, `start should exit 0; stderr=${res.stderr}`);
    const state = JSON.parse(
      readFileSync(join(root, '.bizar', 'guards', 'a', 'state.json'), 'utf-8'),
    );
    assert.equal(state.intervalMs, 900_000);
    assert.match(res.stdout, /\/loop 15m/);
  });

  test('900000 parses to 900000ms', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--interval', '900000', '--slug', 'b'], {
      cwd: root,
    });
    const state = JSON.parse(
      readFileSync(join(root, '.bizar', 'guards', 'b', 'state.json'), 'utf-8'),
    );
    assert.equal(state.intervalMs, 900_000);
  });

  test('1h parses to 3600000ms', () => {
    const { root, planPath } = setupFixture();
    runGuard(['start', '--plan', planPath, '--interval', '1h', '--slug', 'c'], {
      cwd: root,
    });
    const state = JSON.parse(
      readFileSync(join(root, '.bizar', 'guards', 'c', 'state.json'), 'utf-8'),
    );
    assert.equal(state.intervalMs, 3_600_000);
  });
});
