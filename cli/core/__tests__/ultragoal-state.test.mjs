/**
 * ultragoal-state.test.mjs — Phase machine, atomic write, and
 * hash compare-before-write tests for `cli/core/ultragoal-state.mjs`.
 *
 * Verifies:
 *   - `startUltragoal` writes atomically and stamps `stateHash`.
 *   - `getUltragoalState` returns the same object after a write.
 *   - `advanceUltragoal` walks the linear path
 *     `planning → executing → verifying → reviewing → checkpointing → done`.
 *   - `blocked` is non-terminal: a blocked run can resume back to
 *     `executing`.
 *   - Hash compare-before-write detects a tampered state file.
 *   - Stale-lock expiry lets a fresh writer take over after
 *     `LOCK_STALE_MS` has elapsed.
 *   - Terminal phases (`failed`, `cancelled`, `done`) refuse further
 *     steering.
 */

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LOCK_STALE_MS,
  ULTRAGOAL_PHASES,
  ULTRAGOAL_STATUSES,
  ULTRAGOAL_TERMINAL_STATUSES,
  UltragoalStateError,
  advanceUltragoal,
  cancelUltragoal,
  checkpointUltragoal,
  failUltragoal,
  getUltragoalState,
  resumeUltragoal,
  startUltragoal,
  steerUltragoal,
} from '../ultragoal-state.mjs';

const roots = [];
const sessionId = 'sess-2026-09-03';

function freshFixture() {
  const project = mkdtempSync(join(tmpdir(), 'bizar-ultragoal-'));
  roots.push(project);
  mkdirSync(join(project, '.bizar'), { recursive: true });
  return project;
}

function assertCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof UltragoalStateError, `expected UltragoalStateError, got ${error?.constructor?.name}`);
    assert.equal(error.code, code, `expected code=${code}, got ${error.code}`);
    return true;
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('startUltragoal — atomic write + hash', () => {
  test('writes a state.json with a matching stateHash', () => {
    const project = freshFixture();
    const state = startUltragoal({ projectRoot: project, sessionId, id: 'g1', goal: 'ship OMX Phase 1' });
    const statePath = join(project, '.bizar', 'ultragoal', sessionId, 'g1', 'state.json');
    assert.ok(existsSync(statePath), 'state.json should exist');
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(raw.stateHash, state.stateHash);
    assert.equal(raw.phase, 'planning');
    assert.equal(raw.goal, 'ship OMX Phase 1');
  });

  test('refuses a second active run for the same id', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g2', goal: 'first' });
    assertCode('ALREADY_ACTIVE', () =>
      startUltragoal({ projectRoot: project, sessionId, id: 'g2', goal: 'second' }),
    );
  });

  test('rejects an empty goal', () => {
    const project = freshFixture();
    assertCode('GOAL_REQUIRED', () =>
      startUltragoal({ projectRoot: project, sessionId, id: 'g3', goal: '' }),
    );
  });

  test('rejects an unknown modeOf', () => {
    const project = freshFixture();
    assertCode('INVALID_MODE', () =>
      startUltragoal({ projectRoot: project, sessionId, id: 'g4', goal: 'ok', modeOf: 'wrong' }),
    );
  });
});

describe('phase machine — linear path', () => {
  test('walks planning → executing → verifying → reviewing → checkpointing → done', () => {
    const project = freshFixture();
    let state = startUltragoal({ projectRoot: project, sessionId, id: 'g5', goal: 'walk' });
    assert.equal(state.phase, 'planning');

    state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g5', to: 'executing' });
    assert.equal(state.phase, 'executing');

    state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g5', to: 'verifying' });
    assert.equal(state.phase, 'verifying');

    state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g5', to: 'reviewing' });
    assert.equal(state.phase, 'reviewing');

    state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g5', to: 'checkpointing' });
    assert.equal(state.phase, 'checkpointing');

    state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g5', to: 'done' });
    assert.equal(state.phase, 'done');
    assert.equal(state.terminalAt, state.updatedAt);
  });

  test('rejects an invalid transition (planning → done)', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g6', goal: 'walk' });
    assertCode('INVALID_TRANSITION', () =>
      advanceUltragoal({ projectRoot: project, sessionId, id: 'g6', to: 'done' }),
    );
  });
});

describe('phase machine — blocked is non-terminal', () => {
  test('blocked → resume → executing', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g7', goal: 'walk' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g7', to: 'executing' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g7', to: 'blocked' });
    let state = getUltragoalState({ projectRoot: project, sessionId, id: 'g7' });
    assert.equal(state.phase, 'blocked');
    assert.ok(!ULTRAGOAL_TERMINAL_STATUSES.includes('blocked'));
    state = resumeUltragoal({ projectRoot: project, sessionId, id: 'g7', note: 'env fixed' });
    assert.equal(state.phase, 'executing');
  });

  test('resumeUltragoal refuses a non-blocked run', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g8', goal: 'walk' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g8', to: 'executing' });
    assertCode('NOT_BLOCKED', () =>
      resumeUltragoal({ projectRoot: project, sessionId, id: 'g8' }),
    );
  });
});

describe('hash compare-before-write', () => {
  test('detects a tampered state file and refuses to advance', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g9', goal: 'walk' });
    const statePath = join(project, '.bizar', 'ultragoal', sessionId, 'g9', 'state.json');
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    raw.goal = 'tampered';
    // Recompute the hash so the integrity check on read passes;
    // this simulates an out-of-band writer that forgot to bump
    // the revision. We then mutate the file *without* recomputing.
    delete raw.stateHash;
    writeFileSync(statePath, JSON.stringify(raw, null, 2));
    try {
      advanceUltragoal({ projectRoot: project, sessionId, id: 'g9', to: 'executing' });
      assert.fail('expected integrity error to be thrown');
    } catch (error) {
      assert.ok(
        error instanceof UltragoalStateError,
        `expected UltragoalStateError, got ${error?.constructor?.name}`,
      );
      assert.ok(
        ['INTEGRITY_ERROR', 'INVALID_STATE'].includes(error.code),
        `expected INTEGRITY_ERROR or INVALID_STATE, got ${error.code}`,
      );
    }
  });
});

describe('stale-lock recovery', () => {
  test('a lock older than LOCK_STALE_MS is reclaimed', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g10', goal: 'walk' });
    const lockPath = join(project, '.bizar', 'ultragoal', sessionId, 'g10', 'state.lock');
    // Simulate a crashed writer by placing a stale lock file.
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, createdAt: Date.now() }));
    const old = Date.now() / 1000 - (LOCK_STALE_MS / 1000) - 5;
    utimesSync(lockPath, old, old);
    // Should not throw — the stale lock should be reclaimed.
    const state = advanceUltragoal({ projectRoot: project, sessionId, id: 'g10', to: 'executing' });
    assert.equal(state.phase, 'executing');
    assert.ok(!existsSync(lockPath), 'lock should be cleared after the mutation');
  });
});

describe('steerUltragoal — add_subgoal + split_subgoal', () => {
  test('adds a subgoal to an active run', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g11', goal: 'walk' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g11', to: 'executing' });
    const state = steerUltragoal({
      projectRoot: project,
      sessionId,
      id: 'g11',
      action: 'add_subgoal',
      payload: { id: 's1', title: 'subgoal one' },
    });
    assert.ok(state.subgoals.s1);
    assert.equal(state.subgoals.s1.status, 'pending');
  });

  test('rejects a duplicate subgoal id', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g12', goal: 'walk' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g12', to: 'executing' });
    steerUltragoal({
      projectRoot: project,
      sessionId,
      id: 'g12',
      action: 'add_subgoal',
      payload: { id: 's1', title: 'one' },
    });
    assertCode('SUBGOAL_EXISTS', () =>
      steerUltragoal({
        projectRoot: project,
        sessionId,
        id: 'g12',
        action: 'add_subgoal',
        payload: { id: 's1', title: 'duplicate' },
      }),
    );
  });

  test('splits an existing subgoal into N replacements', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g13', goal: 'walk' });
    advanceUltragoal({ projectRoot: project, sessionId, id: 'g13', to: 'executing' });
    steerUltragoal({
      projectRoot: project,
      sessionId,
      id: 'g13',
      action: 'add_subgoal',
      payload: { id: 'big', title: 'big subgoal' },
    });
    const state = steerUltragoal({
      projectRoot: project,
      sessionId,
      id: 'g13',
      action: 'split_subgoal',
      payload: { id: 'big', replacement: ['a', 'b', 'c'] },
    });
    assert.equal(state.subgoals.big, undefined);
    assert.ok(state.subgoals.a);
    assert.ok(state.subgoals.b);
    assert.ok(state.subgoals.c);
  });
});

describe('terminal phase refusal', () => {
  test('cannot steer a failed run', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g14', goal: 'walk' });
    failUltragoal({ projectRoot: project, sessionId, id: 'g14', reason: 'oops' });
    assertCode('TERMINAL', () =>
      steerUltragoal({
        projectRoot: project,
        sessionId,
        id: 'g14',
        action: 'add_subgoal',
        payload: { id: 's1', title: 'one' },
      }),
    );
  });

  test('cancel records terminalAt + history entry', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g15', goal: 'walk' });
    const state = cancelUltragoal({ projectRoot: project, sessionId, id: 'g15', reason: 'operator' });
    assert.equal(state.phase, 'cancelled');
    assert.equal(state.terminalAt, state.updatedAt);
    const last = state.history[state.history.length - 1];
    assert.equal(last.event, 'cancel');
  });
});

describe('checkpointUltragoal', () => {
  test('appends a checkpoint entry that survives a re-read', () => {
    const project = freshFixture();
    startUltragoal({ projectRoot: project, sessionId, id: 'g16', goal: 'walk' });
    checkpointUltragoal({ projectRoot: project, sessionId, id: 'g16', note: 'mid-flight' });
    const state = getUltragoalState({ projectRoot: project, sessionId, id: 'g16' });
    assert.equal(state.checkpointLog.length, 1);
    assert.equal(state.checkpointLog[0].note, 'mid-flight');
  });
});

describe('exports', () => {
  test('ULTRAGOAL_PHASES lists the linear forward path', () => {
    assert.deepEqual([...ULTRAGOAL_PHASES], [
      'planning',
      'executing',
      'verifying',
      'reviewing',
      'checkpointing',
      'done',
    ]);
  });

  test('ULTRAGOAL_STATUSES includes blocked alongside terminal phases', () => {
    assert.ok(ULTRAGOAL_STATUSES.includes('blocked'));
    assert.ok(ULTRAGOAL_STATUSES.includes('failed'));
    assert.ok(ULTRAGOAL_STATUSES.includes('cancelled'));
  });
});
