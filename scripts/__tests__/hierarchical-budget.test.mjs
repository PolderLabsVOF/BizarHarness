/**
 * scripts/__tests__/hierarchical-budget.test.mjs
 *
 * Drift guard + behavior tests for the F-035 / audit #80 hierarchical
 * budget extension to `cli/cost-gate.mjs`:
 *
 *   1. The single-room API (registerRoom / reserve / commit / release /
 *      sweepExpired / status) is unchanged.
 *   2. `registerScope({ scopeId, parentScopeId, scopeKind, capUsd })` is
 *      idempotent and updates `cap_usd` on conflict.
 *   3. A `reserveHierarchy({ chain, amount, ... })` walks the chain
 *      atomically and rejects if ANY scope would be exceeded, returning
 *      `BUDGET_EXCEEDED` with the offending scope id.
 *   4. A successful reserve links every scope in the chain, increments
 *      `reserved_usd` at each, and stamps a single `scope_transactions`
 *      row with the chain + amount.
 *   5. `commitHierarchy(txId, actualUsd)` walks the chain, moves the
 *      original reserved amount out of `reserved_usd`, adds the actual
 *      amount to `spent_usd`, and emits `committed_post_expiry` with a
 *      `COMMIT_AFTER_EXPIRY` warning when the reservation had already
 *      expired.
 *   6. `releaseHierarchy(txId)` refunds the chain and flips the
 *      transaction to `released`.
 *   7. `sweepHierarchyExpired(nowMs)` refunds `reserved_usd` at every
 *      linked scope and is idempotent (second call with no intervening
 *      work is a no-op).
 *   8. A second reserve against the same chain that would exceed ANY
 *      cap is rejected and does NOT touch any scope (atomicity).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cli/cost-gate.mjs — hierarchical budgets (audit #80)', () => {
  let mod;
  let dir;
  let dbPath;

  before(async () => {
    mod = await import('../../cli/cost-gate.mjs');
    dir = mkdtempSync(join(tmpdir(), 'bizar-hbudget-'));
    dbPath = join(dir, 'cost-gate.db');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdtempSync(join(tmpdir(), 'bizar-hbudget-'));
  });

  it('the legacy room API still works (backward compat)', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerRoom('room-X', 100);
      const r1 = gate.reserve('room-X', 'caller-1', 10, { expiryMs: 60_000 });
      assert.equal(r1.ok, true);
      assert.match(r1.txId, /^tx-/);
      const c1 = gate.commitHierarchy.length; // sanity touch
      void c1;
      const c2 = gate.commit(r1.txId, 12);
      assert.equal(c2.ok, true);
      const s = gate.status('room-X');
      assert.equal(s.spentUsd, 12);
      assert.equal(s.reservedUsd, 0);
    } finally {
      gate.close();
    }
  });

  it('registerScope is idempotent and updates cap on conflict', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      const r1 = gate.registerScope({
        scopeId: 'objective:obj-1',
        scopeKind: 'objective',
        capUsd: 10,
      });
      assert.equal(r1.ok, true);
      // Re-register with new cap.
      const r2 = gate.registerScope({
        scopeId: 'objective:obj-1',
        scopeKind: 'objective',
        capUsd: 25,
      });
      assert.equal(r2.ok, true);
      assert.equal(gate.getScope('objective:obj-1').capUsd, 25);
      // Reject parent that does not exist.
      assert.throws(
        () => gate.registerScope({
          scopeId: 'phase:obj-1:exec',
          parentScopeId: 'objective:does-not-exist',
          scopeKind: 'phase',
          capUsd: 5,
        }),
        /parent scope not found/,
      );
      // Reject self-parent.
      assert.throws(
        () => gate.registerScope({
          scopeId: 'objective:obj-1',
          parentScopeId: 'objective:obj-1',
          scopeKind: 'objective',
          capUsd: 10,
        }),
        /parent_scope_id must differ/,
      );
    } finally {
      gate.close();
    }
  });

  it('reserveHierarchy links every scope and increments reserved_usd atomically', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerScope({ scopeId: 'objective:obj-A', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'phase:obj-A:exec', parentScopeId: 'objective:obj-A', scopeKind: 'phase', capUsd: 50 });
      gate.registerScope({ scopeId: 'agent:kevin', scopeKind: 'agent', capUsd: 20 });
      gate.registerScope({ scopeId: 'model:sonnet', scopeKind: 'model', capUsd: 10 });

      const r = gate.reserveHierarchy({
        chain: ['objective:obj-A', 'phase:obj-A:exec', 'agent:kevin', 'model:sonnet'],
        amountUsd: 5,
        callerId: 'session-1',
        expiryMs: 60_000,
      });
      assert.equal(r.ok, true);
      assert.match(r.txId, /^tx-/);
      for (const id of ['objective:obj-A', 'phase:obj-A:exec', 'agent:kevin', 'model:sonnet']) {
        const s = gate.getScope(id);
        assert.equal(s.reservedUsd, 5, `${id} must reserve 5`);
        assert.equal(s.spentUsd, 0);
      }
    } finally {
      gate.close();
    }
  });

  it('reserveHierarchy refuses when ANY scope would be exceeded (atomic)', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerScope({ scopeId: 'objective:obj-B', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'phase:obj-B:exec', parentScopeId: 'objective:obj-B', scopeKind: 'phase', capUsd: 50 });
      gate.registerScope({ scopeId: 'model:haiku', scopeKind: 'model', capUsd: 10 });
      // First reserve commits nothing; second reserve tries to push
      // model:haiku past its cap. Must fail with offendingScopeId=model:haiku
      // and leave all scopes untouched (no half-state).
      const r1 = gate.reserveHierarchy({
        chain: ['objective:obj-B', 'phase:obj-B:exec', 'model:haiku'],
        amountUsd: 8,
        expiryMs: 60_000,
      });
      assert.equal(r1.ok, true);
      const r2 = gate.reserveHierarchy({
        chain: ['objective:obj-B', 'phase:obj-B:exec', 'model:haiku'],
        amountUsd: 5, // would push model:haiku to 13 > 10
        expiryMs: 60_000,
      });
      assert.equal(r2.ok, false);
      assert.equal(r2.error, 'BUDGET_EXCEEDED');
      assert.equal(r2.offendingScopeId, 'model:haiku');
      // Atomicity: no scope was touched by r2.
      for (const id of ['objective:obj-B', 'phase:obj-B:exec', 'model:haiku']) {
        const s = gate.getScope(id);
        assert.equal(s.reservedUsd, 8, `${id} reserved_usd must be unchanged`);
      }
    } finally {
      gate.close();
    }
  });

  it('reserveHierarchy reports SCOPE_NOT_FOUND for unknown scope', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerScope({ scopeId: 'objective:obj-C', scopeKind: 'objective', capUsd: 100 });
      const r = gate.reserveHierarchy({
        chain: ['objective:obj-C', 'phase:obj-C:nope'],
        amountUsd: 1,
      });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'SCOPE_NOT_FOUND');
      assert.equal(r.missingScopeId, 'phase:obj-C:nope');
    } finally {
      gate.close();
    }
  });

  it('commitHierarchy moves reserved → spent at every level', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerScope({ scopeId: 'objective:obj-D', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'model:sonnet', scopeKind: 'model', capUsd: 10 });
      const r = gate.reserveHierarchy({
        chain: ['objective:obj-D', 'model:sonnet'],
        amountUsd: 6,
        expiryMs: 60_000,
      });
      const c = gate.commitHierarchy(r.txId, 5.5);
      assert.equal(c.ok, true);
      assert.equal(c.committed, true);
      assert.equal(c.warned, undefined);
      assert.equal(gate.getScope('objective:obj-D').reservedUsd, 0);
      assert.equal(gate.getScope('objective:obj-D').spentUsd, 5.5);
      assert.equal(gate.getScope('model:sonnet').reservedUsd, 0);
      assert.equal(gate.getScope('model:sonnet').spentUsd, 5.5);
      // Re-commit fails.
      assert.equal(gate.commitHierarchy(r.txId, 5.5).error, 'ALREADY_FINALIZED');
    } finally {
      gate.close();
    }
  });

  it('releaseHierarchy refunds the chain and flips to released', () => {
    const gate = new mod.CostGate({ dbPath });
    try {
      gate.registerScope({ scopeId: 'objective:obj-E', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'phase:obj-E:exec', parentScopeId: 'objective:obj-E', scopeKind: 'phase', capUsd: 50 });
      const r = gate.reserveHierarchy({
        chain: ['objective:obj-E', 'phase:obj-E:exec'],
        amountUsd: 7,
        expiryMs: 60_000,
      });
      const rel = gate.releaseHierarchy(r.txId);
      assert.equal(rel.ok, true);
      assert.equal(gate.getScope('objective:obj-E').reservedUsd, 0);
      assert.equal(gate.getScope('phase:obj-E:exec').reservedUsd, 0);
      // Re-release fails.
      assert.equal(gate.releaseHierarchy(r.txId).error, 'ALREADY_FINALIZED');
    } finally {
      gate.close();
    }
  });

  it('commitHierarchy emits COMMIT_AFTER_EXPIRY when the reservation had expired', () => {
    const gate = new mod.CostGate({ dbPath });
    let now = 1_000_000;
    gate.clock = () => now;
    try {
      gate.registerScope({ scopeId: 'objective:obj-F', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'model:haiku', scopeKind: 'model', capUsd: 10 });
      const r = gate.reserveHierarchy({
        chain: ['objective:obj-F', 'model:haiku'],
        amountUsd: 3,
        expiryMs: 1_000, // very short window
      });
      assert.equal(r.ok, true);
      now += 5_000; // reservation has now expired
      const c = gate.commitHierarchy(r.txId, 3);
      assert.equal(c.ok, true);
      assert.equal(c.warned, 'COMMIT_AFTER_EXPIRY');
      assert.equal(gate.getScope('model:haiku').reservedUsd, 0);
      assert.equal(gate.getScope('model:haiku').spentUsd, 3);
    } finally {
      gate.close();
    }
  });

  it('sweepHierarchyExpired refunds reserved_usd at every linked scope and is idempotent', () => {
    const gate = new mod.CostGate({ dbPath });
    let now = 1_000_000;
    gate.clock = () => now;
    try {
      gate.registerScope({ scopeId: 'objective:obj-G', scopeKind: 'objective', capUsd: 100 });
      gate.registerScope({ scopeId: 'phase:obj-G:exec', parentScopeId: 'objective:obj-G', scopeKind: 'phase', capUsd: 50 });
      gate.registerScope({ scopeId: 'model:sonnet', scopeKind: 'model', capUsd: 10 });
      const r = gate.reserveHierarchy({
        chain: ['objective:obj-G', 'phase:obj-G:exec', 'model:sonnet'],
        amountUsd: 4,
        expiryMs: 1_000,
      });
      assert.equal(r.ok, true);
      now += 5_000;
      const swept1 = gate.sweepHierarchyExpired(now);
      assert.equal(swept1, 1);
      for (const id of ['objective:obj-G', 'phase:obj-G:exec', 'model:sonnet']) {
        assert.equal(gate.getScope(id).reservedUsd, 0, `${id} reserved refunded`);
      }
      const swept2 = gate.sweepHierarchyExpired(now);
      assert.equal(swept2, 0, 'second sweep is a no-op');
    } finally {
      gate.close();
    }
  });
});
