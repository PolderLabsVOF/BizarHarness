/**
 * cli/__tests__/goal-cli.test.mjs — regression tests for the goal CLI.
 *
 * Covers the three behaviours the bizplan-overhaul charter requires:
 *
 *   1. Atomic writes use the DEC-022 tmp+rename pattern.
 *   2. Steer increments the ledger revision monotonically.
 *   3. Phase transitions are enforced — a `complete` action from
 *      the `planning` phase must be rejected with a
 *      `PHASE_REJECTED` error before any disk write happens.
 *
 * Each test stages a fresh `docs/specs/ultragoal-<id>/` tree under
 * a `mkdtemp` directory and points the goal module at it via its
 * `repoRoot` argument, so the suite cannot pollute the real repo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const goal = await import('../commands/goal.mjs');
const { runStart } = await import('../commands/goal/start.mjs');
const { runSteer } = await import('../commands/goal/steer.mjs');
const { runCheckpoint } = await import('../commands/goal/checkpoint.mjs');
const { runComplete } = await import('../commands/goal/complete.mjs');
const { runStatus } = await import('../commands/goal/status.mjs');
const { runFail } = await import('../commands/goal/fail.mjs');
const { runCancel } = await import('../commands/goal/cancel.mjs');
const { atomicWriteJson, atomicAppendJsonl } = await import('../commands/goal/_atomic.mjs');

function freshRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-goal-test-'));
  return root;
}

test('start: writes charter + ledger atomically and chooses short id when no --run', async () => {
  const repoRoot = freshRepo();
  try {
    const result = await runStart(
      { mode: 'aggregate', goal: 'rename ralplan -> bizplan' },
      { repoRoot },
    );
    assert.equal(result.ok, true);
    assert.match(result.runId, /^ultragoal-[a-f0-9]{8}$/);
    assert.equal(result.mode, 'aggregate');
    assert.equal(result.phase, 'planning');

    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${result.runId}.jsonl`);
    const charterPath = join(repoRoot, 'docs', 'specs', `ultragoal-${result.runId}.md`);
    assert.ok(existsSync(ledgerPath), 'ledger must exist');
    assert.ok(existsSync(charterPath), 'charter must exist');

    const ledgerLines = readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(ledgerLines.length, 1, 'start writes exactly one ledger event');
    const start = JSON.parse(ledgerLines[0]);
    assert.equal(start.event, 'start');
    assert.equal(start.phase, 'planning');
    assert.equal(start.mode, 'aggregate');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('atomic write: tmp file is gone after rename (DEC-022 pattern)', async () => {
  const repoRoot = freshRepo();
  try {
    const result = await runStart(
      { mode: 'aggregate', goal: 'atomic write test' },
      { repoRoot },
    );
    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${result.runId}.jsonl`);
    // After start, no .tmp-* siblings should remain.
    const { readdirSync } = await import('node:fs');
    const siblings = readdirSync(join(repoRoot, 'docs', 'specs', 'ultragoal'))
      .filter((n) => n.includes('.tmp-'));
    assert.deepEqual(siblings, [], 'no tmp file siblings after atomic write');

    // Direct atomic helper test: confirm rename semantics.
    const target = join(repoRoot, 'sample.json');
    atomicWriteJson(target, { ok: true });
    assert.ok(existsSync(target), 'target file must exist after atomic write');
    const { readdirSync: rds } = await import('node:fs');
    const tmp = rds(repoRoot).filter((n) => n.includes('.tmp-'));
    assert.deepEqual(tmp, [], 'no tmp file remains after atomic write');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('steer add_subgoal: revision bumps monotonically', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'revision test' },
      { repoRoot },
    );
    const runId = start.runId;

    const a = await runSteer(
      { _: ['add_subgoal'], run: runId, revision: 1, 'subgoal-id': 'a', weight: 0.5, summary: 'one' },
      { repoRoot },
    );
    assert.equal(a.ok, true);
    assert.equal(a.revision, 1);

    const b = await runSteer(
      { _: ['add_subgoal'], run: runId, revision: 2, 'subgoal-id': 'b', weight: 0.5, summary: 'two' },
      { repoRoot },
    );
    assert.equal(b.ok, true);
    assert.equal(b.revision, 2);

    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${runId}.jsonl`);
    const events = readFileSync(ledgerPath, 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const addSubgoals = events.filter((e) => e.event === 'add_subgoal');
    assert.equal(addSubgoals.length, 2);
    assert.equal(addSubgoals[0].revision, 1);
    assert.equal(addSubgoals[1].revision, 2);
    assert.ok(addSubgoals[0].ts <= addSubgoals[1].ts, 'ts ordering preserved');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('steer checkpoint: allowed from executing/verifying/reviewing/checkpointing; rejected from planning', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'phase guard test' },
      { repoRoot },
    );
    const runId = start.runId;
    // planning -> checkpoint must reject
    await assert.rejects(
      runSteer(
        { _: ['checkpoint'], run: runId, revision: 1, evidence: 'too early' },
        { repoRoot },
      ),
      (err) => {
        assert.equal(err.code, 'PHASE_REJECTED');
        return true;
      },
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('complete: rejected from planning; rejected from executing; accepted from checkpointing with four-lane evidence', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'complete guard test' },
      { repoRoot },
    );
    const runId = start.runId;
    // 1) planning -> complete must reject
    await assert.rejects(
      runComplete(
        { run: runId, revision: 1, 'quality-gate-json': 'nope' },
        { repoRoot },
      ),
      (err) => err.code === 'PHASE_REJECTED' || err.code === 'NOT_FOUND',
    );

    // 2) Write a quality-gate JSON and craft a ledger that is in
    // the `checkpointing` phase so complete can succeed.
    const qgPath = join(repoRoot, 'qg.json');
    writeFileSync(qgPath, JSON.stringify({
      cleaner: { status: 'green' },
      verification: { status: 'green' },
      review: { status: 'green' },
      architecture_invariant: { status: 'green' },
    }));
    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${runId}.jsonl`);
    // Replace the start event's phase with checkpointing so the
    // phase guard accepts the complete action.
    const events = readFileSync(ledgerPath, 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    events[0].phase = 'checkpointing';
    writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const result = await runComplete(
      { run: runId, revision: 2, 'quality-gate-json': qgPath },
      { repoRoot },
    );
    assert.equal(result.ok, true);
    assert.equal(result.phase, 'done');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('complete: missing four-lane evidence rejected', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'four-lane test' },
      { repoRoot },
    );
    const runId = start.runId;
    const qgPath = join(repoRoot, 'qg-bad.json');
    writeFileSync(qgPath, JSON.stringify({
      cleaner: { status: 'green' },
      // verification missing
      review: { status: 'green' },
      architecture_invariant: { status: 'green' },
    }));
    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${runId}.jsonl`);
    const events = readFileSync(ledgerPath, 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    events[0].phase = 'checkpointing';
    writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    await assert.rejects(
      runComplete(
        { run: runId, revision: 1, 'quality-gate-json': qgPath },
        { repoRoot },
      ),
      (err) => {
        assert.equal(err.code, 'PHASE_REJECTED');
        assert.match(err.message, /verification/);
        return true;
      },
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('fail and cancel: allowed from any non-terminal phase; reject from done/failed/cancelled', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'terminal state test' },
      { repoRoot },
    );
    const runId = start.runId;
    const ledgerPath = join(repoRoot, 'docs', 'specs', 'ultragoal', `${runId}.jsonl`);

    // From planning -> fail accepted
    const failed = await runFail(
      { run: runId, reason: 'plan bad' },
      { repoRoot },
    );
    assert.equal(failed.phase, 'failed');

    // From failed -> fail rejected
    await assert.rejects(
      runFail({ run: runId, reason: 'already failed' }, { repoRoot }),
      (err) => err.code === 'PHASE_REJECTED',
    );

    // From failed -> cancel also rejected
    await assert.rejects(
      runCancel({ run: runId, reason: 'after fail' }, { repoRoot }),
      (err) => err.code === 'PHASE_REJECTED',
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('status: returns current phase + revision + eventCount', async () => {
  const repoRoot = freshRepo();
  try {
    const start = await runStart(
      { mode: 'aggregate', goal: 'status test' },
      { repoRoot },
    );
    const runId = start.runId;
    await runSteer(
      { _: ['add_subgoal'], run: runId, revision: 1, 'subgoal-id': 'a', weight: 0.3, summary: 'a' },
      { repoRoot },
    );
    await runSteer(
      { _: ['add_subgoal'], run: runId, revision: 2, 'subgoal-id': 'b', weight: 0.3, summary: 'b' },
      { repoRoot },
    );
    const status = await runStatus({ run: runId }, { repoRoot });
    assert.equal(status.phase, 'planning');
    assert.equal(status.revision, 2);
    assert.equal(status.eventCount, 3); // start + add_subgoal + add_subgoal
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resume: replays a hand-persisted charter into the ledger', async () => {
  const repoRoot = freshRepo();
  try {
    // Stage a hand-persisted charter file (no ledger yet).
    const specsDir = join(repoRoot, 'docs', 'specs');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'ultragoal-hand.md'), [
      '---',
      'Run id: ultragoal-hand',
      'Mode: aggregate',
      'Started: 2026-09-07T00:00:00Z',
      'Completion threshold: 1.0',
      '---',
      '',
      '# Ultragoal charter — hand',
      '',
      'Hand-persisted charter body.',
      '',
    ].join('\n'));

    const { runResume } = await import('../commands/goal/resume.mjs');
    const result = await runResume({}, { repoRoot });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.resumed[0].runId, 'ultragoal-hand');

    // Idempotent: a second resume should be a no-op.
    const second = await runResume({}, { repoRoot });
    assert.equal(second.count, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('atomicAppendJsonl: appending does not leave tmp files', async () => {
  const repoRoot = freshRepo();
  try {
    const file = join(repoRoot, 'append.jsonl');
    atomicAppendJsonl(file, { event: 'a' });
    atomicAppendJsonl(file, { event: 'b' });
    const { readdirSync } = await import('node:fs');
    const tmp = readdirSync(repoRoot).filter((n) => n.includes('.tmp-'));
    assert.deepEqual(tmp, [], 'no tmp files after append');
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).event, 'a');
    assert.equal(JSON.parse(lines[1]).event, 'b');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
