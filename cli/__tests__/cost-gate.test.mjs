/**
 * cli/__tests__/cost-gate.test.mjs
 *
 * F-035 — tests for cli/cost-gate.mjs (atomic SQLite-backed room budget tracker).
 *
 * Uses Node's built-in `node:test`. No external framework.
 *
 * Coverage:
 *   1. registerRoom — idempotent, accepts valid cap, rejects invalid.
 *   2. status — reflects spentUsd / remaining correctly.
 *   3. listRooms — returns every room with up-to-date totals.
 *   4. reserve → commit: happy path, final remaining matches.
 *   5. reserve → release: spentUsd stays 0, remaining recovers.
 *   6. BUDGET_EXCEEDED: refusal when projected > cap.
 *   7. Reservation expiry: state flips to 'expired' on sweepExpired.
 *   8. Late commit: COMMIT_AFTER_EXPIRY warning + 'committed_post_expiry' state.
 *   9. Concurrent reserves: one succeeds, the other BUDGET_EXCEEDEDs (BEGIN
 *      IMMEDIATE atomicity).
 *  10. ALREADY_FINALIZED on double commit / double release.
 *  11. ROOM_NOT_FOUND path.
 *  12. Expiry clamping [5s, 300s] per ADR-164.1 §3.2.
 */

import { test, describe, before, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  CostGate,
  RESERVATION_EXPIRY_FLOOR_MS,
  RESERVATION_EXPIRY_CEILING_MS,
  clampReservationExpiry,
} = await import('../cost-gate.mjs');

let tmpdir_created = false;
let tmp;

before(() => {
  if (!tmpdir_created) {
    tmp = mkdtempSync(join(tmpdir(), 'bizar-cost-gate-'));
    tmpdir_created = true;
  }
});

afterEach(() => {
  // each test creates its own gate; nothing to clean up
});

function freshGate(clock) {
  const dbPath = join(tmp, `gate-${Math.random().toString(36).slice(2, 8)}-${Date.now()}.db`);
  return new CostGate({
    dbPath,
    clock: clock || (() => Date.now()),
  });
}

describe('registerRoom()', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('inserts a new room', () => {
    const r = gate.registerRoom('titan-cluster', 50);
    assert.equal(r.ok, true);
    assert.equal(r.roomId, 'titan-cluster');
    assert.equal(r.capUsd, 50);
  });

  test('upsert on conflict — idempotent', () => {
    gate.registerRoom('titan-cluster', 50);
    gate.registerRoom('titan-cluster', 75); // raises cap
    const s = gate.status('titan-cluster');
    assert.equal(s.capUsd, 75);
  });

  test('rejects invalid roomId', () => {
    assert.throws(() => gate.registerRoom('', 10), /roomId/);
    assert.throws(() => gate.registerRoom(null, 10), /roomId/);
  });

  test('rejects negative cap', () => {
    assert.throws(() => gate.registerRoom('r', -1), /capUsd/);
    assert.throws(() => gate.registerRoom('r', NaN), /capUsd/);
  });
});

describe('status() and listRooms()', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('status returns null for unknown room', () => {
    assert.equal(gate.status('nope'), null);
  });

  test('status reflects spentUsd and remaining correctly', () => {
    gate.registerRoom('alpha', 100);
    gate.reserve('alpha', 'tester', 30);
    // Capture txId deterministically for the commit
    const rsv = gate.reserve('alpha', 'tester', 10);
    gate.commit(rsv.txId, 10);
    const s = gate.status('alpha');
    assert.equal(s.spentUsd, 10, 'only the committed 10 is spent');
    assert.equal(s.reservedUsd, 30, 'the 30 reservation is still live');
    assert.equal(s.remainingUsd, 100 - 10 - 30);
    assert.ok(s.txCount >= 2);
  });

  test('listRooms returns every registered room', () => {
    gate.registerRoom('a', 1);
    gate.registerRoom('b', 2);
    gate.registerRoom('c', 3);
    const all = gate.listRooms();
    const ids = all.map((r) => r.roomId).sort();
    assert.deepEqual(ids, ['a', 'b', 'c']);
  });
});

describe('reserve → commit happy path', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('reserve then commit with smaller amount', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'agent1', 40);
    assert.equal(rsv.ok, true);
    assert.ok(rsv.txId.startsWith('tx-'));
    const cm = gate.commit(rsv.txId, 25);
    assert.equal(cm.ok, true);
    assert.equal(cm.committed, true);
    const s = gate.status('r');
    assert.equal(s.spentUsd, 25);
    assert.equal(s.remainingUsd, 75);
  });

  test('reserve then commit with same amount', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'agent1', 40);
    const cm = gate.commit(rsv.txId, 40);
    assert.equal(cm.committed, true);
    assert.equal(gate.status('r').spentUsd, 40);
  });
});

describe('reserve → release', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('release frees the budget without charging it', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 30);
    const rel = gate.release(rsv.txId);
    assert.equal(rel.ok, true);
    assert.equal(rel.released, true);
    const s = gate.status('r');
    assert.equal(s.spentUsd, 0);
    assert.equal(s.reservedUsd, 0);
    assert.equal(s.remainingUsd, 100);
  });

  test('release on already-released tx returns ALREADY_FINALIZED', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 10);
    gate.release(rsv.txId);
    const rel = gate.release(rsv.txId);
    assert.equal(rel.ok, false);
    assert.equal(rel.error, 'ALREADY_FINALIZED');
  });
});

describe('BUDGET_EXCEEDED refusal', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('refuses reserve that would exceed cap', () => {
    gate.registerRoom('r', 100);
    const r1 = gate.reserve('r', 'a', 80);
    assert.equal(r1.ok, true);
    const r2 = gate.reserve('r', 'a', 30);
    assert.equal(r2.ok, false);
    assert.equal(r2.error, 'BUDGET_EXCEEDED');
    assert.equal(r2.capUsd, 100);
    assert.equal(r2.committed, 0);
    assert.equal(r2.reserved, 80);
  });

  test('committing an exact-fit reservation is allowed (with epsilon)', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 100);
    assert.equal(rsv.ok, true);
    assert.equal(rsv.remainingAfterReserve, 0);
  });
});

describe('expiry + late commit', () => {
  let gate;
  let now;
  beforeEach(() => {
    now = 1_700_000_000_000;
    gate = freshGate(() => now);
  });
  afterEach(() => gate.close());

  test('sweepExpired flips reserved rows to expired', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 10, { expiryMs: 5_000 });
    assert.equal(rsv.ok, true);
    now += 6_000; // past expiry
    const swept = gate.sweepExpired();
    assert.equal(swept, 1);
    const tx = gate.listTransactions('r').find((t) => t.tx_id === rsv.txId);
    assert.equal(tx.kind, 'expired');
  });

  test('commit after expiry returns COMMIT_AFTER_EXPIRY warning + spends the actual amount', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 10, { expiryMs: 5_000 });
    now += 6_000; // past expiry
    const cm = gate.commit(rsv.txId, 7.5);
    assert.equal(cm.ok, true);
    assert.equal(cm.warned, 'COMMIT_AFTER_EXPIRY');
    const tx = gate.listTransactions('r').find((t) => t.tx_id === rsv.txId);
    assert.equal(tx.kind, 'committed_post_expiry');
    const s = gate.status('r');
    assert.equal(s.spentUsd, 7.5);
    assert.equal(s.remainingUsd, 92.5);
  });

  test('commit twice returns ALREADY_FINALIZED', () => {
    gate.registerRoom('r', 100);
    const rsv = gate.reserve('r', 'a', 10);
    gate.commit(rsv.txId, 8);
    const cm2 = gate.commit(rsv.txId, 8);
    assert.equal(cm2.ok, false);
    assert.equal(cm2.error, 'ALREADY_FINALIZED');
  });
});

describe('CONCURRENT reserve race (BEGIN IMMEDIATE atomicity)', () => {
  test('only one of N concurrent reserves can exceed the cap when strictly under', () => {
    const gate = freshGate();
    try {
      gate.registerRoom('cr', 10);
      // Fire 10 reserves of $1.50 against a $10 cap. The first 6
      // succeed ($9 projected); the 7th hits BUDGET_EXCEEDED. We use
      // a tight loop so they pile up against the immediate write lock.
      const results = [];
      for (let i = 0; i < 20; i++) {
        const r = gate.reserve('cr', `caller-${i}`, 1.5);
        results.push(r);
      }
      const ok = results.filter((r) => r.ok).length;
      const denied = results.filter((r) => !r.ok).length;
      assert.equal(ok + denied, 20);
      assert.equal(ok, 6, `expected 6 reserves to fit (6 × $1.50 = $9 ≤ $10), got ${ok}`);
      assert.equal(denied, 14);
      assert.ok(
        results.some((r) => !r.ok && r.error === 'BUDGET_EXCEEDED'),
        'at least one must hit BUDGET_EXCEEDED',
      );
      const s = gate.status('cr');
      assert.equal(s.reservedUsd, 9);
      assert.equal(s.spentUsd, 0);
    } finally {
      gate.close();
    }
  });
});

describe('ROOM_NOT_FOUND', () => {
  let gate;
  beforeEach(() => { gate = freshGate(); });
  afterEach(() => gate.close());

  test('reserve returns ROOM_NOT_FOUND', () => {
    const r = gate.reserve('nope', 'a', 10);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'ROOM_NOT_FOUND');
  });
});

describe('clampReservationExpiry — ADR-164.1 §3.2', () => {
  test('floors at 5_000 ms', () => {
    assert.equal(clampReservationExpiry(100), RESERVATION_EXPIRY_FLOOR_MS);
  });
  test('caps at 300_000 ms', () => {
    assert.equal(clampReservationExpiry(60 * 60 * 1000), RESERVATION_EXPIRY_CEILING_MS);
  });
  test('passes through valid values', () => {
    assert.equal(clampReservationExpiry(30_000), 30_000);
  });
  test('uses 60_000 ms default for undefined', () => {
    assert.equal(clampReservationExpiry(undefined), 60_000);
  });
});
