/**
 * tests/eval/report.test.mjs
 *
 * v5.0.0 — Tests for eval run comparison / diff reporting.
 *
 * Verifies:
 *   - compareRuns correctly categorizes fixtures as improved/regressed/unchanged
 *   - saveRun and getRun work correctly
 *   - listRuns returns runs in order
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const storeHome = join(tmpdir(), `bizar-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.BIZAR_STORE_HOME = storeHome;
mkdirSync(storeHome, { recursive: true });

const EVAL_STORE = await import('../../src/server/eval-store.mjs');

describe('eval store — run comparison', () => {

  afterEach(() => {
    EVAL_STORE.__resetStoreForTests();
  });

  describe('compareRuns', () => {
    it('categorizes improved fixtures (was failing, now passing)', async () => {
      const run1 = {
        id: 'run_1',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 2,
        passed: 1,
        failed: 1,
        results: [
          { fixtureId: 'f1', ok: false, latencyMs: 100 },
          { fixtureId: 'f2', ok: true, latencyMs: 100 },
        ],
      };
      const run2 = {
        id: 'run_2',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 2,
        passed: 2,
        failed: 0,
        results: [
          { fixtureId: 'f1', ok: true, latencyMs: 100 },
          { fixtureId: 'f2', ok: true, latencyMs: 100 },
        ],
      };

      await EVAL_STORE.saveRun(run1);
      await EVAL_STORE.saveRun(run2);

      const diff = await EVAL_STORE.compareRuns('run_1', 'run_2');

      assert.strictEqual(diff.improved.length, 1);
      assert.strictEqual(diff.improved[0].fixtureId, 'f1');
      assert.strictEqual(diff.regressed.length, 0);
      assert.strictEqual(diff.unchanged.length, 1);
      assert.strictEqual(diff.unchanged[0].fixtureId, 'f2');
    });

    it('categorizes regressed fixtures (was passing, now failing)', async () => {
      const run1 = {
        id: 'run_a',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 2,
        passed: 2,
        failed: 0,
        results: [
          { fixtureId: 'f1', ok: true, latencyMs: 100 },
          { fixtureId: 'f2', ok: true, latencyMs: 100 },
        ],
      };
      const run2 = {
        id: 'run_b',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 2,
        passed: 1,
        failed: 1,
        results: [
          { fixtureId: 'f1', ok: false, latencyMs: 100 },
          { fixtureId: 'f2', ok: true, latencyMs: 100 },
        ],
      };

      await EVAL_STORE.saveRun(run1);
      await EVAL_STORE.saveRun(run2);

      const diff = await EVAL_STORE.compareRuns('run_a', 'run_b');

      assert.strictEqual(diff.regressed.length, 1);
      assert.strictEqual(diff.regressed[0].fixtureId, 'f1');
      assert.strictEqual(diff.improved.length, 0);
      assert.strictEqual(diff.unchanged.length, 1);
    });

    it('categorizes unchanged fixtures', async () => {
      const run1 = {
        id: 'run_x',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 1,
        passed: 1,
        failed: 0,
        results: [{ fixtureId: 'f1', ok: true, latencyMs: 100 }],
      };
      const run2 = {
        id: 'run_y',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 1,
        passed: 1,
        failed: 0,
        results: [{ fixtureId: 'f1', ok: true, latencyMs: 120 }],
      };

      await EVAL_STORE.saveRun(run1);
      await EVAL_STORE.saveRun(run2);

      const diff = await EVAL_STORE.compareRuns('run_x', 'run_y');

      assert.strictEqual(diff.unchanged.length, 1);
      assert.strictEqual(diff.improved.length, 0);
      assert.strictEqual(diff.regressed.length, 0);
    });

    it('returns error when run not found', async () => {
      const diff = await EVAL_STORE.compareRuns('nonexistent', 'also-nonexistent');
      assert.ok(diff.error);
      assert.strictEqual(diff.error, 'run not found');
    });

    it('handles fixtures that only exist in one run', async () => {
      const run1 = {
        id: 'run_new',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 2,
        passed: 2,
        failed: 0,
        results: [
          { fixtureId: 'f1', ok: true, latencyMs: 100 },
          { fixtureId: 'f2', ok: true, latencyMs: 100 },
        ],
      };
      const run2 = {
        id: 'run_old',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 1,
        passed: 1,
        failed: 0,
        results: [{ fixtureId: 'f1', ok: true, latencyMs: 100 }],
      };

      await EVAL_STORE.saveRun(run1);
      await EVAL_STORE.saveRun(run2);

      const diff = await EVAL_STORE.compareRuns('run_new', 'run_old');
      // f2 only exists in run_new, so it's not in the diff
      assert.strictEqual(diff.unchanged.length, 1);
    });
  });

  describe('saveRun / getRun', () => {
    it('saves and retrieves a run', async () => {
      const run = {
        id: 'run_save_test',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 1,
        passed: 1,
        failed: 0,
        results: [{ fixtureId: 'f1', ok: true, latencyMs: 100 }],
      };

      const saved = await EVAL_STORE.saveRun(run);
      assert.strictEqual(saved.ok, true);
      assert.ok(saved.path.includes('run_save_test'));

      const retrieved = await EVAL_STORE.getRun('run_save_test');
      assert.strictEqual(retrieved.id, 'run_save_test');
      assert.strictEqual(retrieved.total, 1);
      assert.strictEqual(retrieved.passed, 1);
    });

    it('returns null for nonexistent run', async () => {
      const result = await EVAL_STORE.getRun('nonexistent_run_id');
      assert.strictEqual(result, null);
    });
  });

  describe('listRuns', () => {
    it('returns runs in newest-first order', async () => {
      for (let i = 0; i < 5; i++) {
        const run = {
          id: `run_list_${i}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          suitePath: '/test',
          total: 1,
          passed: 1,
          failed: 0,
          results: [],
        };
        await EVAL_STORE.saveRun(run);
      }

      const runs = await EVAL_STORE.listRuns({ limit: 3 });
      assert.strictEqual(runs.length, 3);
      // Should be newest first
      assert.strictEqual(runs[0].id, 'run_list_4');
      assert.strictEqual(runs[1].id, 'run_list_3');
      assert.strictEqual(runs[2].id, 'run_list_2');
    });

    it('respects limit parameter', async () => {
      // Save a few runs first
      for (let i = 0; i < 4; i++) {
        const run = {
          id: `run_limit_${i}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          suitePath: '/test',
          total: 1,
          passed: 1,
          failed: 0,
          results: [],
        };
        await EVAL_STORE.saveRun(run);
      }
      const runs = await EVAL_STORE.listRuns({ limit: 2 });
      assert.strictEqual(runs.length, 2);
    });
  });

  describe('deleteRun', () => {
    it('deletes a run', async () => {
      const run = {
        id: 'run_to_delete',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        suitePath: '/test',
        total: 1,
        passed: 1,
        failed: 0,
        results: [],
      };
      await EVAL_STORE.saveRun(run);
      const result = await EVAL_STORE.deleteRun('run_to_delete');
      assert.strictEqual(result.ok, true);
      const retrieved = await EVAL_STORE.getRun('run_to_delete');
      assert.strictEqual(retrieved, null);
    });
  });

  describe('buildRunId', () => {
    it('generates unique IDs', () => {
      const id1 = EVAL_STORE.buildRunId();
      const id2 = EVAL_STORE.buildRunId();
      assert.notStrictEqual(id1, id2);
      assert.ok(id1.startsWith('run_'));
      assert.ok(id2.startsWith('run_'));
    });
  });
});
