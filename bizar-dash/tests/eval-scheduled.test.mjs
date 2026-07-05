// tests/eval-scheduled.test.mjs — v5.3.0
// Tests for eval schedule CRUD

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

describe('Eval schedule CRUD', () => {
  const originalConfigDir = process.env.BIZAR_EVAL_CONFIG_DIR;

  beforeEach(() => {
    // Use a unique config dir per test to avoid cross-test pollution
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env.BIZAR_EVAL_CONFIG_DIR = `/tmp/bizar-eval-config-${testId}`;
    mkdirSync(process.env.BIZAR_EVAL_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    process.env.BIZAR_EVAL_CONFIG_DIR = originalConfigDir;
  });

  it('registerEvalSchedule returns a schedule with id', async () => {
    // Dynamic import ensures env var is set before module initializes
    const mod = await import(`../src/server/eval-store.mjs?v=${Date.now()}`);
    const { registerEvalSchedule } = mod;
    const schedule = registerEvalSchedule({
      name: 'Daily check',
      suitePath: './fixtures',
      cron: '0 8 * * *',
      agent: 'thor',
    });
    assert.ok(schedule.id);
    assert.strictEqual(schedule.name, 'Daily check');
    assert.strictEqual(schedule.suitePath, './fixtures');
    assert.strictEqual(schedule.cron, '0 8 * * *');
    assert.strictEqual(schedule.agent, 'thor');
  });

  it('listEvalSchedules returns all registered schedules', async () => {
    const mod = await import(`../src/server/eval-store.mjs?v=${Date.now()}-${Math.random()}`);
    const { registerEvalSchedule, listEvalSchedules } = mod;
    registerEvalSchedule({ name: 's1', suitePath: './a', cron: '0 9 * * *' });
    registerEvalSchedule({ name: 's2', suitePath: './b', cron: '0 10 * * *' });
    const schedules = listEvalSchedules();
    assert.strictEqual(schedules.length, 2);
    assert.ok(schedules.find((s) => s.name === 's1'));
    assert.ok(schedules.find((s) => s.name === 's2'));
  });

  it('deleteEvalSchedule removes a schedule by id', async () => {
    const mod = await import(`../src/server/eval-store.mjs?v=${Date.now()}`);
    const { registerEvalSchedule, listEvalSchedules, deleteEvalSchedule } = mod;
    const sched = registerEvalSchedule({ name: 'to-delete', suitePath: './x', cron: '0 9 * * *' });
    const result = deleteEvalSchedule(sched.id);
    assert.strictEqual(result.ok, true);
    const remaining = listEvalSchedules();
    assert.strictEqual(remaining.find((s) => s.id === sched.id), undefined);
  });

  it('deleteEvalSchedule returns ok:false for unknown id', async () => {
    const mod = await import(`../src/server/eval-store.mjs?v=${Date.now()}`);
    const { deleteEvalSchedule } = mod;
    const result = deleteEvalSchedule('does-not-exist');
    assert.strictEqual(result.ok, false);
  });

  it('schedule ids are unique across multiple registrations', async () => {
    const mod = await import(`../src/server/eval-store.mjs?v=${Date.now()}`);
    const { registerEvalSchedule, listEvalSchedules } = mod;
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      ids.add(registerEvalSchedule({ name: `s${i}`, suitePath: '.', cron: '* * * * *' }).id);
    }
    assert.strictEqual(ids.size, 10);
  });
});

describe('schedules runner eval-run action', () => {
  it('schedulesRunner module loads and exposes tick', async () => {
    const { schedulesRunner } = await import('../src/server/schedules-runner.mjs');
    assert.strictEqual(typeof schedulesRunner.tick, 'function');
  });
});
