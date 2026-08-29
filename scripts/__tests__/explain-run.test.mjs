/**
 * scripts/__tests__/explain-run.test.mjs
 *
 * Drift guard + behavior tests for `bizar explain-run` (audit #79).
 *
 *   1. The CLI module exports `buildExplainRun`, `listObjectives`,
 *      `run`, and `USAGE` with stable signatures.
 *   2. `cli/bin.mjs` routes `explain-run` to the module via the
 *      same pattern used by `improve` / `evidence`.
 *   3. `buildExplainRun({ objectiveRunId })` returns a structured
 *      report that joins scheduler state + lifecycle events +
 *      EvidenceBundle summary.
 *   4. `listObjectives({ phase, status })` returns the matching
 *      scheduler rows in camelCase JSON shape.
 *   5. Non-existent ids surface as `null` (caller renders the
 *      not-found message).
 *   6. The `--help` path prints the usage block without throwing.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cli/commands/explain-run.mjs', () => {
  let mod;
  let home;
  let schedMod;

  before(async () => {
    home = mkdtempSync(join(tmpdir(), 'bizar-explain-run-'));
    process.env.BIZAR_HOME = home;
    mod = await import('../../cli/commands/explain-run.mjs');
    schedMod = await import('../../cli/commands/objective-scheduler.mjs');
  });

  after(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.BIZAR_HOME;
  });

  beforeEach(() => {
    rmSync(join(home, 'state'), { recursive: true, force: true });
  });

  it('exports the audit #79 surface', () => {
    assert.equal(typeof mod.buildExplainRun, 'function');
    assert.equal(typeof mod.listObjectives, 'function');
    assert.equal(typeof mod.run, 'function');
    assert.equal(typeof mod.USAGE, 'string');
    assert.match(mod.USAGE, /bizar explain-run <objectiveRunId>/);
    assert.match(mod.USAGE, /--list/);
    assert.match(mod.USAGE, /--format=human/);
  });

  it('cli/bin.mjs routes explain-run through the same pattern as improve', () => {
    const src = readFileSync(join(process.cwd(), 'cli', 'bin.mjs'), 'utf8');
    assert.match(src, /case 'explain-run':/, 'bin.mjs must register explain-run');
    assert.match(src, /importCommand\('explain-run'\)/, 'bin.mjs must lazy-import explain-run');
    assert.match(src, /bizar explain-run <id>/);
  });

  it('buildExplainRun returns null when the objective does not exist', () => {
    const result = mod.buildExplainRun({ objectiveRunId: 'no-such-objective' });
    assert.equal(result, null);
  });

  it('buildExplainRun joins scheduler state + events + evidence summary', () => {
    const sched = new schedMod.ObjectiveScheduler({ cwd: home, env: { BIZAR_HOME: home } });
    try {
      sched.createObjective({
        objectiveRunId: 'uuid-explained-1',
        goal: 'audit #79 happy path',
        payload: { constraints: { budget: { usd: 50_000 } } },
      });
      sched.claimObjective({
        objectiveRunId: 'uuid-explained-1',
        owner: 'session-explainer',
        leaseMs: 5_000,
      });
      sched.transitionObjective({
        objectiveRunId: 'uuid-explained-1',
        owner: 'session-explainer',
        expectedFromPhase: 'planning',
        toPhase: 'executing',
        reason: 'kickoff',
      });
    } finally {
      sched.close();
    }

    const report = mod.buildExplainRun({
      objectiveRunId: 'uuid-explained-1',
      cwd: home,
      env: { BIZAR_HOME: home },
    });
    assert.ok(report, 'report must exist');
    assert.equal(report.objectiveRunId, 'uuid-explained-1');
    assert.equal(report.goal, 'audit #79 happy path');
    assert.equal(report.phase, 'executing');
    assert.equal(report.status, 'active');
    assert.equal(report.owner, 'session-explainer');
    assert.equal(report.attempt, 1);
    assert.equal(typeof report.createdAtIso, 'string');
    assert.equal(typeof report.leaseExpiresAtIso, 'string');
    assert.deepEqual(
      report.events.map((e) => e.kind),
      ['created', 'claimed', 'transitioned'],
      'event timeline must reflect the full arc',
    );
    const transition = report.events.find((e) => e.kind === 'transitioned');
    assert.equal(transition.payload.fromPhase, 'planning');
    assert.equal(transition.payload.toPhase, 'executing');
    assert.equal(transition.payload.reason, 'kickoff');
    assert.equal(report.evidence.rowCount, 0,
      'no evidence bundles exist for this objective in a clean test');
    assert.equal(report.evidence.lastAppendedAt, null);
    assert.ok(report.dbPath.endsWith('objectives.sqlite'));
  });

  it('listObjects filters by phase and status', () => {
    const sched = new schedMod.ObjectiveScheduler({ cwd: home, env: { BIZAR_HOME: home } });
    try {
      sched.createObjective({ objectiveRunId: 'uuid-list-1', goal: 'phase filter' });
      sched.createObjective({ objectiveRunId: 'uuid-list-2', goal: 'status filter' });
      const c2 = sched.claimObjective({
        objectiveRunId: 'uuid-list-2',
        owner: 'session-A',
        leaseMs: 30_000,
      });
      sched.transitionObjective({
        objectiveRunId: 'uuid-list-2',
        owner: 'session-A',
        expectedFromPhase: 'planning',
        toPhase: 'executing',
      });
    } finally {
      sched.close();
    }

    const planningOnly = mod.listObjectives({
      phase: 'planning', cwd: home, env: { BIZAR_HOME: home },
    });
    assert.deepEqual(
      planningOnly.map((r) => r.objectiveRunId),
      ['uuid-list-1'],
      'phase filter must return only planning rows',
    );

    const executingOnly = mod.listObjectives({
      phase: 'executing', cwd: home, env: { BIZAR_HOME: home },
    });
    assert.deepEqual(
      executingOnly.map((r) => r.objectiveRunId),
      ['uuid-list-2'],
    );

    const activeOnly = mod.listObjectives({
      status: 'active', cwd: home, env: { BIZAR_HOME: home },
    });
    assert.equal(activeOnly.length, 2, 'both objectives are still active');
  });

  it('run() responds to --help with USAGE and exits cleanly', async () => {
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    try {
      const ok = await mod.run('explain-run', ['--help'], false);
      assert.equal(ok, true);
    } finally {
      process.stdout.write = origWrite;
    }
    const out = chunks.join('');
    assert.match(out, /Usage:/);
    assert.match(out, /--format=human/);
  });

  it('run() with an unknown id exits with code 2 and a clear message', async () => {
    const errs = [];
    const codes = [];
    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origExit = process.exit;
    process.stderr.write = (chunk) => { errs.push(String(chunk)); return true; };
    process.exit = (code) => { codes.push(code); };
    try {
      const ok = await mod.run('explain-run', ['uuid-does-not-exist'], false);
      assert.equal(ok, true);
      assert.deepEqual(codes, [2]);
      assert.match(errs.join(''), /objective not found/);
    } finally {
      process.stderr.write = origErrWrite;
      process.exit = origExit;
    }
  });
});
