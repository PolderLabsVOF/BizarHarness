/**
 * scripts/__tests__/chaos.test.mjs
 *
 * Production-autonomy audit Milestone 4 — chaos testing framework.
 *
 * This suite injects deterministic faults into the durable scheduler +
 * evidence ledger and asserts that each component converges to a valid
 * terminal state. The five fault classes called out in the audit:
 *
 *   1. Crash-during-resume     — a `claimObjective` is in flight when
 *                                the process dies; restart must leave
 *                                the objective recoverable.
 *   2. Duplicate-event         — the same `objective_events` row is
 *                                recorded twice; replay must be
 *                                idempotent at the consumer level.
 *   3. Out-of-order-event      — events arrive with backwards
 *                                timestamps; replay must read them in
 *                                stable (id) order.
 *   4. Expired-lease           — a lease silently expires while the
 *                                worker is still running; recovery
 *                                must reclaim the objective cleanly.
 *   5. Corrupt-evidence-row    — a malformed JSONL row is appended
 *                                to an objective's evidence file;
 *                                `verifyBundles` must reject it with a
 *                                stable reason code and `listBundles`
 *                                must not crash.
 *
 * Each fault class is asserted via a fresh, in-memory scheduler so the
 * suite stays deterministic and fast (no shared state across tests).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('chaos testing — durable scheduler + evidence ledger', () => {
  let schedMod;
  let evidenceMod;
  let dir;
  let evidenceDir;

  before(async () => {
    schedMod = await import('../../cli/commands/objective-scheduler.mjs');
    evidenceMod = await import('../../cli/commands/evidence-bundles.mjs');
    dir = mkdtempSync(join(tmpdir(), 'bizar-chaos-'));
    evidenceDir = join(dir, 'evidence');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('crash-during-resume: a half-written claim is recoverable', () => {
    const dbPath = join(dir, 'chaos-1.sqlite');
    const sched = new schedMod.ObjectiveScheduler({ dbPath, now: () => 1_000_000 });
    try {
      sched.createObjective({ objectiveRunId: 'chaos-1', goal: 'crash-during-resume' });
      // Simulate a crash: claim is partially applied — owner set but
      // lease NOT yet stamped (the process died between the two
      // writes). We model this by setting owner + heartbeat manually
      // via a raw UPDATE that bypasses the scheduler's atomic claim.
      sched.db.prepare(
        `UPDATE objectives
           SET owner = 'mid-claim-session',
               heartbeat_at = 1_000_000,
               updated_at = 1_000_000
         WHERE objective_run_id = 'chaos-1'`,
      ).run();
      // Lease is NULL → recoverStale treats this as a non-orphan (lease
      // is missing, not expired). But the owner is still set, so a
      // fresh claim by a new owner must succeed (no LEASE_HELD because
      // lease_expires_at IS NULL).
      const reclaim = sched.claimObjective({
        objectiveRunId: 'chaos-1',
        owner: 'fresh-owner',
        leaseMs: 60_000,
      });
      assert.equal(reclaim.owner, 'fresh-owner');
      assert.ok(reclaim.leaseExpiresAt > 0);
      // Recovery sweep just past the claim but BEFORE lease expiry
      // must be a no-op.
      const sweep = sched.recoverStale({ now: 1_030_000 });
      assert.equal(sweep.recovered.length, 0);
    } finally {
      sched.close();
    }
  });

  it('duplicate-event: replay returns the duplicated rows but is semantically idempotent', () => {
    const dbPath = join(dir, 'chaos-2.sqlite');
    const sched = new schedMod.ObjectiveScheduler({ dbPath, now: () => 1_000_000 });
    try {
      sched.createObjective({ objectiveRunId: 'chaos-2', goal: 'duplicate-event' });
      sched.claimObjective({ objectiveRunId: 'chaos-2', owner: 'A', leaseMs: 60_000 });
      // Inject a duplicate 'claimed' event at the SQL layer (simulates
      // a writer retry without an idempotency key).
      sched.db.prepare(
        `INSERT INTO objective_events
           (objective_run_id, kind, ts, payload_json)
         VALUES (?, 'claimed', ?, ?)`,
      ).run('chaos-2', 1_000_000, JSON.stringify({ owner: 'A', duplicate: true }));
      const events = sched.listEvents({ objectiveRunId: 'chaos-2' });
      const claimed = events.filter((e) => e.kind === 'claimed');
      assert.equal(claimed.length, 2, 'duplicate event is recorded twice');
      // Convergent state: scheduler.getObjective reflects a single
      // ownership; the duplicate event does NOT double the attempt.
      const obj = sched.getObjective({ objectiveRunId: 'chaos-2' });
      assert.equal(obj.attempt, 1);
      assert.equal(obj.owner, 'A');
    } finally {
      sched.close();
    }
  });

  it('out-of-order-event: replay reads events in stable (id) order', () => {
    const dbPath = join(dir, 'chaos-3.sqlite');
    const sched = new schedMod.ObjectiveScheduler({ dbPath, now: () => 1_000_000 });
    try {
      sched.createObjective({ objectiveRunId: 'chaos-3', goal: 'out-of-order' });
      // Inject events with timestamps that go BACKWARDS. The audit
      // says replay must be stable, so listEvents orders by (ts, id).
      sched.db.prepare(
        `INSERT INTO objective_events (objective_run_id, kind, ts, payload_json) VALUES
           ('chaos-3', 'first',  900_000, '{}'),
           ('chaos-3', 'second', 800_000, '{}'),
           ('chaos-3', 'third',  700_000, '{}')`,
      ).run();
      const events = sched.listEvents({ objectiveRunId: 'chaos-3' });
      // The first event ('created') was at ts=1_000_000 from the
      // scheduler API; the three manual inserts went at 900/800/700k.
      // Ordering must be by (ts ASC, id ASC).
      const kinds = events.map((e) => e.kind);
      assert.deepEqual(
        kinds,
        ['third', 'second', 'first', 'created'],
        'replay order is stable: (ts, id)',
      );
    } finally {
      sched.close();
    }
  });

  it('expired-lease: a silently expired lease is reclaimed cleanly by recovery', () => {
    const dbPath = join(dir, 'chaos-4.sqlite');
    const clock = { t: 1_000_000 };
    const sched = new schedMod.ObjectiveScheduler({ dbPath, now: () => clock.t });
    try {
      sched.createObjective({ objectiveRunId: 'chaos-4', goal: 'expired lease' });
      sched.claimObjective({ objectiveRunId: 'chaos-4', owner: 'silent-worker', leaseMs: 1_000 });
      // The "silent" worker keeps heartbeating its OWN state but the
      // lease wall-clock has advanced past expiry.
      clock.t += 60_000;
      // Recovery sweep sees the expired lease and releases it.
      const sweep = sched.recoverStale({ now: clock.t });
      assert.equal(sweep.recovered.length, 1);
      assert.equal(sweep.recovered[0].owner, null);
      assert.equal(sweep.recovered[0].attempt, 2);
      // The new owner can claim without hitting LEASE_HELD because
      // the previous lease has been cleared.
      const fresh = sched.claimObjective({ objectiveRunId: 'chaos-4', owner: 'new-worker', leaseMs: 30_000 });
      assert.equal(fresh.owner, 'new-worker');
      assert.equal(fresh.attempt, 3);
      // A heartbeat from the old (silent) worker is rejected because
      // its owner no longer matches.
      assert.throws(
        () => sched.heartbeatObjective({ objectiveRunId: 'chaos-4', owner: 'silent-worker', leaseMs: 30_000 }),
        (err) => err.code === 'OWNER_MISMATCH',
      );
    } finally {
      sched.close();
    }
  });

  it('corrupt-evidence-row: listBundles survives malformed JSONL; verifyBundles reports a stable reason', () => {
    // The evidence ledger lives at evidenceDir; create one JSONL with
    // a valid header row + a corrupt row + a truncated tail.
    const objectiveId = 'chaos-5-evidence';
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const path = join(evidenceDir, `${objectiveId}.jsonl`);
    writeFileSync(path, JSON.stringify({ objectiveRunId: objectiveId, marker: 'valid' }) + '\n');
    appendFileSync(path, 'this is not valid json {{{ {{\n');
    appendFileSync(path, JSON.stringify({ objectiveRunId: objectiveId, marker: 'tail' }) + '\n');

    // listBundles must NOT throw; the row count must reflect every
    // non-blank line (including the corrupt one).
    const listed = evidenceMod.listBundles({ evidenceDir });
    const entry = listed.find((b) => b.objectiveRunId === objectiveId);
    assert.ok(entry, 'listBundles must surface the run even with a corrupt row');
    assert.equal(entry.rowCount, 3, 'rowCount counts the corrupt line as a row');
    // lastAppendedAt is null because the tail could not be parsed.
    assert.equal(entry.lastAppendedAt, null);

    // verifyBundles needs a secret. Since we never signed the rows,
    // verification returns ok:false with a stable, machine-readable
    // reason. The audit requires we NEVER throw on corrupt evidence.
    // Accept any documented stable reason.
    const verify = evidenceMod.verifyBundles({ evidenceDir, secret: 'chaos-test-secret' });
    assert.equal(verify.ok, false, 'corrupt evidence must verify as false');
    const STABLE_REASONS = [
      'signatures-bundle-orphan',
      'signatures-bundle-shape',
      'signatures-bundle-count-mismatch',
      'bundle-signature-mismatch',
    ];
    assert.ok(
      STABLE_REASONS.includes(verify.reason),
      `verifyBundles must return a stable reason, got ${verify.reason}`,
    );
  });
});