/**
 * scripts/__tests__/objective-scheduler.test.mjs
 *
 * Drift guard + behavior tests for the F-194 / audit Milestone 2
 * "Resumable controller" deliverable:
 *
 *   1. The module's exported surface (`ObjectiveScheduler`,
 *      `ObjectiveSchedulerError`, `OBJECTIVE_PHASES`,
 *      `OBJECTIVE_STATUSES`, `resolveObjectiveSchedulerDb`) is stable.
 *   2. The shipped phase / status enums exactly match the
 *      `ObjectiveRunPhase` / `ObjectiveRunStatus` union in
 *      `packages/sdk/src/autonomy/objective-run.ts` so the scheduler
 *      cannot drift from the typed schema.
 *   3. The scheduler drives a full `planning → executing → verifying →
 *      done` lifecycle for one objective, recording every transition in
 *      `objective_events`.
 *   4. Lease semantics: a live lease held by one owner cannot be
 *      stolen by another owner; the same owner can renew.
 *   5. `recoverStale()` is idempotent: an orphan is released exactly
 *      once per sweep, attempt counter increments exactly once, and a
 *      subsequent sweep is a no-op until a new lease is granted and
 *      expires.
 *   6. After recovery, a fresh owner can `claimObjective` and the
 *      lease history is intact.
 *   7. Heartbeat from a non-owner is rejected.
 *   8. Cancel without `force` requires a matching owner; cancel with
 *      `force: true` always succeeds and clears the lease.
 *   9. `listEvents` returns the canonical replay timeline.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('objective-scheduler surface', () => {
  let mod;
  before(async () => {
    mod = await import('../../cli/commands/objective-scheduler.mjs');
  });

  it('cli/commands/objective-scheduler.mjs exports the F-194 scheduler surface', () => {
    assert.equal(typeof mod.ObjectiveScheduler, 'function');
    assert.equal(typeof mod.ObjectiveSchedulerError, 'function');
    assert.ok(Array.isArray(mod.OBJECTIVE_PHASES));
    assert.ok(Array.isArray(mod.OBJECTIVE_STATUSES));
    assert.equal(typeof mod.resolveObjectiveSchedulerDb, 'function');
  });

  it('phase + status enums mirror the SDK ObjectiveRun schema', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/objective-run.js');
    assert.deepEqual(
      [...mod.OBJECTIVE_PHASES].sort(),
      [...sdk.OBJECTIVE_PHASES].sort(),
      'OBJECTIVE_PHASES must match SDK ObjectiveRunPhase',
    );
    assert.deepEqual(
      [...mod.OBJECTIVE_STATUSES].sort(),
      [...sdk.OBJECTIVE_STATUSES].sort(),
      'OBJECTIVE_STATUSES must match SDK ObjectiveRunStatus',
    );
  });

  it('resolves the default DB path under BIZAR_HOME/state/', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bizar-obj-home-'));
    try {
      const path = mod.resolveObjectiveSchedulerDb({
        env: { BIZAR_HOME: home },
      });
      assert.equal(path, join(home, 'state', 'objectives.sqlite'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('ObjectiveScheduler — lifecycle + recovery', () => {
  let mod;
  let dir;
  let dbPath;
  let sched;

  before(async () => {
    mod = await import('../../cli/commands/objective-scheduler.mjs');
    dir = mkdtempSync(join(tmpdir(), 'bizar-obj-sched-'));
    dbPath = join(dir, 'objectives.sqlite');
  });

  after(() => {
    if (sched) sched.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('drives a full planning → executing → verifying → done lifecycle', () => {
    sched = new mod.ObjectiveScheduler({ dbPath });
    const created = sched.createObjective({
      objectiveRunId: 'obj-lifecycle-1',
      goal: 'ship the resumable controller',
      payload: { constraints: { budget: { usd: 100_000 } } },
    });
    assert.equal(created.phase, 'planning');
    assert.equal(created.status, 'active');
    assert.equal(created.attempt, 0);
    assert.equal(created.leaseExpiresAt, null);

    const claimed = sched.claimObjective({
      objectiveRunId: 'obj-lifecycle-1',
      owner: 'session-A',
      leaseMs: 60_000,
    });
    assert.equal(claimed.phase, 'planning');
    assert.equal(claimed.status, 'active');
    assert.equal(claimed.attempt, 1);
    assert.equal(claimed.owner, 'session-A');
    assert.ok(claimed.leaseExpiresAt > 0);

    const executing = sched.transitionObjective({
      objectiveRunId: 'obj-lifecycle-1',
      owner: 'session-A',
      expectedFromPhase: 'planning',
      toPhase: 'executing',
    });
    assert.equal(executing.phase, 'executing');
    assert.equal(executing.status, 'active');

    const verifying = sched.transitionObjective({
      objectiveRunId: 'obj-lifecycle-1',
      owner: 'session-A',
      expectedFromPhase: 'executing',
      toPhase: 'verifying',
    });
    assert.equal(verifying.phase, 'verifying');

    const done = sched.transitionObjective({
      objectiveRunId: 'obj-lifecycle-1',
      owner: 'session-A',
      expectedFromPhase: 'verifying',
      toPhase: 'done',
    });
    assert.equal(done.phase, 'done');
    assert.equal(done.status, 'succeeded');
    assert.equal(done.leaseExpiresAt, null, 'terminal objectives release the lease');
    assert.ok(done.terminalAt > 0);
  });

  it('rejects phase mismatch on transition', () => {
    // Fresh DB for isolation. The previous test closed nothing on disk.
    const localPath = join(dir, 'objectives-phase-mismatch.sqlite');
    const local = new mod.ObjectiveScheduler({ dbPath: localPath });
    local.createObjective({
      objectiveRunId: 'obj-mismatch-1',
      goal: 'transition failure path',
    });
    local.claimObjective({ objectiveRunId: 'obj-mismatch-1', owner: 'A' });
    assert.throws(
      () => local.transitionObjective({
        objectiveRunId: 'obj-mismatch-1',
        owner: 'A',
        expectedFromPhase: 'verifying', // wrong — objective is still 'planning'
        toPhase: 'executing',
      }),
      (err) => err.code === 'PHASE_MISMATCH',
    );
    local.close();
  });

  it('blocks a second owner from stealing a live lease', () => {
    const localPath = join(dir, 'objectives-lease-race.sqlite');
    const local = new mod.ObjectiveScheduler({ dbPath: localPath });
    local.createObjective({ objectiveRunId: 'obj-lease-1', goal: 'lease race' });
    local.claimObjective({ objectiveRunId: 'obj-lease-1', owner: 'A', leaseMs: 60_000 });
    assert.throws(
      () => local.claimObjective({ objectiveRunId: 'obj-lease-1', owner: 'B', leaseMs: 60_000 }),
      (err) => err.code === 'LEASE_HELD',
    );
    // Same owner can renew (no attempt bump on renewal).
    const renewed = local.claimObjective({ objectiveRunId: 'obj-lease-1', owner: 'A', leaseMs: 60_000 });
    assert.equal(renewed.attempt, 1, 'renewal does not increment attempt');
    local.close();
  });

  it('rejects heartbeat from a non-owner', () => {
    const localPath = join(dir, 'objectives-heartbeat.sqlite');
    const local = new mod.ObjectiveScheduler({ dbPath: localPath });
    local.createObjective({ objectiveRunId: 'obj-hb-1', goal: 'heartbeat ownership' });
    local.claimObjective({ objectiveRunId: 'obj-hb-1', owner: 'A', leaseMs: 60_000 });
    assert.throws(
      () => local.heartbeatObjective({ objectiveRunId: 'obj-hb-1', owner: 'B', leaseMs: 60_000 }),
      (err) => err.code === 'OWNER_MISMATCH',
    );
    // Real owner succeeds.
    const ok = local.heartbeatObjective({ objectiveRunId: 'obj-hb-1', owner: 'A', leaseMs: 60_000 });
    assert.equal(ok.owner, 'A');
    assert.ok(ok.heartbeatAt > 0);
    local.close();
  });

  it('recoverStale releases an orphan, increments attempt exactly once, and is idempotent', () => {
    const localPath = join(dir, 'objectives-recover.sqlite');
    const clock = { t: 1_000_000 };
    const local = new mod.ObjectiveScheduler({ dbPath: localPath, now: () => clock.t });
    local.createObjective({ objectiveRunId: 'obj-rec-1', goal: 'orphan recovery' });
    local.claimObjective({
      objectiveRunId: 'obj-rec-1',
      owner: 'crashed-session',
      leaseMs: 5_000,
    });
    const beforeRecover = local.getObjective({ objectiveRunId: 'obj-rec-1' });
    assert.equal(beforeRecover.attempt, 1);
    assert.equal(beforeRecover.owner, 'crashed-session');

    // Advance the clock past the lease expiry, then sweep.
    clock.t += 10_000;
    const first = local.recoverStale({ now: clock.t });
    assert.equal(first.recovered.length, 1);
    assert.equal(first.recovered[0].objectiveRunId, 'obj-rec-1');
    assert.equal(first.recovered[0].owner, null, 'owner cleared');
    assert.equal(first.recovered[0].attempt, 2, 'attempt incremented exactly once');
    assert.equal(first.recovered[0].leaseExpiresAt, null);

    // Second sweep is a no-op — the orphan is already released.
    const second = local.recoverStale({ now: clock.t });
    assert.equal(second.recovered.length, 0);
    // The DB row is unchanged from the first sweep.
    assert.equal(local.getObjective({ objectiveRunId: 'obj-rec-1' }).attempt, 2);

    // A fresh owner can re-claim the released objective, bumping attempt to 3.
    const reclaimed = local.claimObjective({
      objectiveRunId: 'obj-rec-1',
      owner: 'fresh-session',
      leaseMs: 5_000,
    });
    assert.equal(reclaimed.attempt, 3);
    assert.equal(reclaimed.owner, 'fresh-session');

    // The full event timeline is available for replay / `bizar explain-run`.
    const events = local.listEvents({ objectiveRunId: 'obj-rec-1' });
    const kinds = events.map((e) => e.kind);
    assert.deepEqual(kinds, [
      'created',
      'claimed',
      'lease-expired',
      'claimed',
    ], 'event timeline must reflect the recovery arc');
    const expiryEvent = events.find((e) => e.kind === 'lease-expired');
    assert.equal(expiryEvent.payload.previousOwner, 'crashed-session');
    assert.equal(expiryEvent.payload.attemptAfter, 2);
    local.close();
  });

  it('cancel without force requires a matching owner; cancel with force always succeeds', () => {
    const localPath = join(dir, 'objectives-cancel.sqlite');
    const local = new mod.ObjectiveScheduler({ dbPath: localPath });
    local.createObjective({ objectiveRunId: 'obj-can-1', goal: 'cancellation path' });
    local.claimObjective({ objectiveRunId: 'obj-can-1', owner: 'A', leaseMs: 60_000 });
    assert.throws(
      () => local.cancelObjective({ objectiveRunId: 'obj-can-1', owner: 'B', reason: 'wrong owner' }),
      (err) => err.code === 'OWNER_MISMATCH',
    );
    const cancelled = local.cancelObjective({
      objectiveRunId: 'obj-can-1',
      owner: 'B',
      reason: 'operator override',
      force: true,
    });
    assert.equal(cancelled.phase, 'cancelled');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.leaseExpiresAt, null);
    local.close();
  });

  it('listEvents returns the canonical replay timeline for a full happy path', () => {
    const localPath = join(dir, 'objectives-events.sqlite');
    const local = new mod.ObjectiveScheduler({ dbPath: localPath });
    local.createObjective({ objectiveRunId: 'obj-evt-1', goal: 'event timeline' });
    local.claimObjective({ objectiveRunId: 'obj-evt-1', owner: 'session-X', leaseMs: 30_000 });
    local.heartbeatObjective({ objectiveRunId: 'obj-evt-1', owner: 'session-X', leaseMs: 30_000 });
    local.transitionObjective({
      objectiveRunId: 'obj-evt-1',
      owner: 'session-X',
      expectedFromPhase: 'planning',
      toPhase: 'executing',
    });
    local.transitionObjective({
      objectiveRunId: 'obj-evt-1',
      owner: 'session-X',
      expectedFromPhase: 'executing',
      toPhase: 'verifying',
    });
    local.transitionObjective({
      objectiveRunId: 'obj-evt-1',
      owner: 'session-X',
      expectedFromPhase: 'verifying',
      toPhase: 'done',
    });
    const kinds = local.listEvents({ objectiveRunId: 'obj-evt-1' }).map((e) => e.kind);
    assert.deepEqual(kinds, [
      'created',
      'claimed',
      'heartbeat',
      'transitioned',
      'transitioned',
      'transitioned',
    ]);
    local.close();
  });
});
