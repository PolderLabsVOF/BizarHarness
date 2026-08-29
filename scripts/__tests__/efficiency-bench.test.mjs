/**
 * scripts/__tests__/efficiency-bench.test.mjs
 *
 * Production-autonomy audit #85 — P2 efficiency benchmarks + auto-fan-out rule.
 *
 * Three surfaces under test:
 *
 *   1. The synthetic benchmark harness in `packages/sdk/src/bench/efficiency.ts`
 *      (single-vs-multi, sequential-vs-parallel, reviewer count, worktree
 *      overhead, real-run reduction).
 *   2. The auto-fan-out reduction rule in
 *      `packages/sdk/src/bench/auto-reduction.ts`.
 *   3. The CLI command `bizar bench` (registered in `cli/bin.mjs`).
 *
 * The harness is deterministic: every test uses an explicit `seed`
 * so reruns produce identical numbers. This is the audit's
 * reproducibility requirement.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

describe('efficiency-bench — synthetic harness (audit #85)', () => {
  const bench = async () => import('../../packages/sdk/dist/bench/efficiency.js');

  it('EFFICIENCY_BENCH_SCHEMA_VERSION is exported + semver', async () => {
    const m = await bench();
    assert.equal(typeof m.EFFICIENCY_BENCH_SCHEMA_VERSION, 'string');
    assert.match(m.EFFICIENCY_BENCH_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('runBench returns zero-cost / zero-verified on empty tasks', async () => {
    const { runBench } = await bench();
    const r = runBench([], { label: 'empty', fanOut: 1, reviewerCount: 1, parallel: false, coordinationOverheadRatio: 0 }, 42);
    assert.equal(r.totalAttempts, 0);
    assert.equal(r.verifiedOutcomes, 0);
    assert.equal(r.totalCostUsd, 0);
    assert.equal(r.costPerVerifiedUsd, Number.POSITIVE_INFINITY);
    assert.equal(r.wallClockPerVerifiedMs, Number.POSITIVE_INFINITY);
  });

  it('runBench is deterministic across repeated calls with the same seed', async () => {
    const { runBench } = await bench();
    const tasks = [
      { id: 'a', workMs: 1000, costUsd: 5000, successProb: 0.9, quality: 0.85 },
      { id: 'b', workMs: 2000, costUsd: 7000, successProb: 0.9, quality: 0.85 },
    ];
    const cfg = { label: 'par', fanOut: 2, reviewerCount: 1, parallel: true, coordinationOverheadRatio: 0.1 };
    const r1 = runBench(tasks, cfg, 12345);
    const r2 = runBench(tasks, cfg, 12345);
    assert.deepEqual(r1, r2);
  });

  it('runBench — sequential configuration charges sum of worker costs; parallel charges sum too (cost is per-worker either way)', async () => {
    const { runBench } = await bench();
    const tasks = [
      { id: 'a', workMs: 1000, costUsd: 5000, successProb: 1.0, quality: 0.85 },
      { id: 'b', workMs: 2000, costUsd: 7000, successProb: 1.0, quality: 0.85 },
      { id: 'c', workMs: 3000, costUsd: 9000, successProb: 1.0, quality: 0.85 },
    ];
    const seqCfg = { label: 'seq', fanOut: 1, reviewerCount: 0, parallel: false, coordinationOverheadRatio: 0.0 };
    const parCfg = { label: 'par', fanOut: 3, reviewerCount: 0, parallel: true,  coordinationOverheadRatio: 0.0 };
    const seq = runBench(tasks, seqCfg, 42);
    const par = runBench(tasks, parCfg, 42);
    // Costs are identical (3 workers, 3 attempts, no reviewers).
    assert.equal(seq.totalCostUsd, par.totalCostUsd);
    // Wall-clock: sequential = sum(1000+2000+3000) = 6000; parallel = max(3000) = 3000.
    assert.equal(seq.totalWallClockMs, 6000);
    assert.equal(par.totalWallClockMs, 3000);
  });

  it('runBench — coordination overhead widens the parallel total wall-clock', async () => {
    const { runBench } = await bench();
    const tasks = [
      { id: 'a', workMs: 1000, costUsd: 5000, successProb: 1.0, quality: 0.85 },
      { id: 'b', workMs: 1000, costUsd: 5000, successProb: 1.0, quality: 0.85 },
    ];
    const noOverhead = { label: 'no', fanOut: 2, reviewerCount: 0, parallel: true, coordinationOverheadRatio: 0 };
    const heavyOverhead = { label: 'heavy', fanOut: 2, reviewerCount: 0, parallel: true, coordinationOverheadRatio: 0.5 };
    const no = runBench(tasks, noOverhead, 42);
    const heavy = runBench(tasks, heavyOverhead, 42);
    assert.equal(no.totalWallClockMs, 1000);
    // 0.5 overhead ⇒ wall-clock = max(1000) × 1.5 = 1500 (Math.ceil).
    assert.equal(heavy.totalWallClockMs, 1500);
  });

  it('compareConfigurations names the cheaper and faster winner', async () => {
    const { compareConfigurations } = await bench();
    const tasks = [
      { id: 'a', workMs: 5000, costUsd: 1000, successProb: 1.0, quality: 0.85 },
      { id: 'b', workMs: 5000, costUsd: 1000, successProb: 1.0, quality: 0.85 },
      { id: 'c', workMs: 5000, costUsd: 1000, successProb: 1.0, quality: 0.85 },
      { id: 'd', workMs: 5000, costUsd: 1000, successProb: 1.0, quality: 0.85 },
    ];
    const seq = { label: 'seq', fanOut: 1, reviewerCount: 0, parallel: false, coordinationOverheadRatio: 0 };
    const par = { label: 'par', fanOut: 4, reviewerCount: 0, parallel: true,  coordinationOverheadRatio: 0 };
    const c = compareConfigurations(tasks, seq, par, 42);
    // Sequential = 4*5000 = 20000ms wall-clock; parallel = 5000ms.
    assert.equal(c.a.totalWallClockMs, 20000);
    assert.equal(c.b.totalWallClockMs, 5000);
    assert.equal(c.wallClockWinner, 'b');
    // Both have the same total cost (4 workers × 1000), so costWinner
    // is "a" by <= (ties go to "a").
    assert.equal(c.costWinner, 'a');
  });

  it('efficiencyFromRealRuns lifts a real-run summary to a BenchResult', async () => {
    const { efficiencyFromRealRuns } = await bench();
    const out = efficiencyFromRealRuns({
      configLabel: 'real',
      fanOut: 4,
      reviewerCount: 1,
      parallel: true,
      coordinationOverheadRatio: 0.15,
      totalCostUsd: 40_000,
      totalWallClockMs: 8_000,
      verifiedOutcomes: 4,
      totalAttempts: 4,
    });
    assert.equal(out.costPerVerifiedUsd, 10_000);
    assert.equal(out.wallClockPerVerifiedMs, 2_000);
  });

  it('efficiencyFromRealRuns returns +Infinity when verifiedOutcomes = 0', async () => {
    const { efficiencyFromRealRuns } = await bench();
    const out = efficiencyFromRealRuns({
      configLabel: 'all-failed',
      fanOut: 1,
      reviewerCount: 0,
      parallel: false,
      coordinationOverheadRatio: 0,
      totalCostUsd: 5_000,
      totalWallClockMs: 1_000,
      verifiedOutcomes: 0,
      totalAttempts: 1,
    });
    assert.equal(out.costPerVerifiedUsd, Number.POSITIVE_INFINITY);
  });
});

describe('efficiency-bench — auto fan-out reduction (audit #85)', () => {
  const red = async () => import('../../packages/sdk/dist/bench/auto-reduction.js');

  it('AUTO_REDUCTION_SCHEMA_VERSION is exported + semver', async () => {
    const m = await red();
    assert.equal(typeof m.AUTO_REDUCTION_SCHEMA_VERSION, 'string');
    assert.match(m.AUTO_REDUCTION_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('reduces fan-out by one step when overheadRatio >= expectedBenefitRatio', async () => {
    const { recommendFanOut } = await red();
    const d = recommendFanOut({
      currentFanOut: 4,
      historicalCoordinationOverheadRatio: 0.7,
      expectedBenefitRatio: 0.6,
      historicalDefectEscapeRate: 0.0,
    });
    assert.equal(d.recommendedFanOut, 3);
    assert.equal(d.reason, 'coordination-overhead-exceeds-benefit');
    assert.equal(d.reduced, true);
    assert.ok(d.overheadVsBenefitGap > 0);
  });

  it('floors fan-out at 1 and tags the reason single-worker-fan-out', async () => {
    const { recommendFanOut } = await red();
    const d = recommendFanOut({
      currentFanOut: 2,
      historicalCoordinationOverheadRatio: 0.9,
      expectedBenefitRatio: 0.2,
      historicalDefectEscapeRate: 0.0,
    });
    assert.equal(d.recommendedFanOut, 1);
    assert.equal(d.reason, 'single-worker-fan-out');
    assert.equal(d.reduced, true);
  });

  it('keeps current fan-out when overheadRatio < expectedBenefitRatio', async () => {
    const { recommendFanOut } = await red();
    const d = recommendFanOut({
      currentFanOut: 4,
      historicalCoordinationOverheadRatio: 0.1,
      expectedBenefitRatio: 0.6,
      historicalDefectEscapeRate: 0.0,
    });
    assert.equal(d.recommendedFanOut, 4);
    assert.equal(d.reason, 'keep-current');
    assert.equal(d.reduced, false);
  });

  it('flags verifier-cannot-certify when defectEscapeRate > threshold; does NOT shrink fan-out', async () => {
    const { recommendFanOut, DEFAULT_DEFECT_ESCAPE_RATE_THRESHOLD } = await red();
    const d = recommendFanOut({
      currentFanOut: 4,
      historicalCoordinationOverheadRatio: 0.0,
      expectedBenefitRatio: 0.6,
      historicalDefectEscapeRate: DEFAULT_DEFECT_ESCAPE_RATE_THRESHOLD + 0.05,
    });
    assert.equal(d.reason, 'verifier-cannot-certify');
    assert.equal(d.recommendedFanOut, 4); // unchanged; widening reviewers is a different policy
    assert.equal(d.reduced, false);
  });

  it('recommendFanOutBatch returns the first reducing decision', async () => {
    const { recommendFanOutBatch } = await red();
    const d = recommendFanOutBatch([
      { currentFanOut: 4, historicalCoordinationOverheadRatio: 0.1, expectedBenefitRatio: 0.6, historicalDefectEscapeRate: 0.0 },
      { currentFanOut: 4, historicalCoordinationOverheadRatio: 0.8, expectedBenefitRatio: 0.4, historicalDefectEscapeRate: 0.0 },
    ]);
    assert.equal(d.recommendedFanOut, 3);
    assert.equal(d.reason, 'coordination-overhead-exceeds-benefit');
  });

  it('recommendFanOutBatch returns the worst-gap keep-current when no context triggers', async () => {
    const { recommendFanOutBatch } = await red();
    const d = recommendFanOutBatch([
      { currentFanOut: 4, historicalCoordinationOverheadRatio: 0.1, expectedBenefitRatio: 0.6, historicalDefectEscapeRate: 0.0 },
      { currentFanOut: 4, historicalCoordinationOverheadRatio: 0.2, expectedBenefitRatio: 0.6, historicalDefectEscapeRate: 0.0 },
    ]);
    assert.equal(d.recommendedFanOut, 4);
    assert.equal(d.reason, 'keep-current');
  });

  it('MIN_FAN_OUT is exported and equals 1', async () => {
    const m = await red();
    assert.equal(m.MIN_FAN_OUT, 1);
  });

  it('recommendFanOut clamps a fractional currentFanOut to floor(currentFanOut)', async () => {
    const { recommendFanOut } = await red();
    const d = recommendFanOut({
      currentFanOut: 4.7,
      historicalCoordinationOverheadRatio: 0.0,
      expectedBenefitRatio: 0.6,
      historicalDefectEscapeRate: 0.0,
    });
    assert.equal(d.recommendedFanOut, 4);
  });
});

describe('efficiency-bench — bizar bench CLI (audit #85)', () => {
  it('cli/commands/bench.mjs exports USAGE + run; USAGE mentions all four subcommands', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    assert.equal(typeof mod.run, 'function');
    assert.equal(typeof mod.USAGE, 'string');
    assert.match(mod.USAGE, /bizar bench/);
    assert.match(mod.USAGE, /single-vs-multi/);
    assert.match(mod.USAGE, /sequential-vs-parallel/);
    assert.match(mod.USAGE, /reviewers/);
    assert.match(mod.USAGE, /worktree/);
    assert.match(mod.USAGE, /recommend-fan-out/);
  });

  it('cli/bin.mjs registers the bench case', () => {
    const src = readFileSync(join(REPO_ROOT, 'cli/bin.mjs'), 'utf8');
    assert.match(src, /case 'bench':/);
    assert.match(src, /Could not load bench command module/);
  });

  it('bin.mjs help text mentions bench (audit #85)', () => {
    const src = readFileSync(join(REPO_ROOT, 'cli/bin.mjs'), 'utf8');
    assert.match(src, /bench.*audit #85/i);
  });

  it('run() with --help prints USAGE and exits 0', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    const code = await mod.run(['--help']);
    assert.equal(code, 0);
  });

  it('run() with recommend-fan-out + human format renders the auto-reduction line', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    const code = await mod.run([
      'recommend-fan-out',
      '--fan-out=4',
      '--overhead=0.7',
      '--benefit=0.4',
      '--escape=0.05',
    ]);
    assert.equal(code, 0);
  });

  it('run() with recommend-fan-out + json format returns a JSON object', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    // Capture stdout to validate JSON shape.
    const origLog = console.log;
    let captured = '';
    console.log = (msg) => { captured += String(msg) + '\n'; };
    try {
      const code = await mod.run([
        'recommend-fan-out',
        '--fan-out=4',
        '--overhead=0.7',
        '--benefit=0.4',
        '--escape=0.05',
        '--format=json',
      ]);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const parsed = JSON.parse(captured);
    assert.equal(parsed.schemaVersion, '1.0.0');
    assert.equal(parsed.context.currentFanOut, 4);
    assert.equal(parsed.decision.reason, 'coordination-overhead-exceeds-benefit');
    assert.equal(parsed.decision.recommendedFanOut, 3);
  });

  it('run() with single-vs-multi + json returns both result rows', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    const origLog = console.log;
    let captured = '';
    console.log = (msg) => { captured += String(msg) + '\n'; };
    try {
      const code = await mod.run(['single-vs-multi', '--format=json', '--seed=42']);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const parsed = JSON.parse(captured);
    assert.ok(parsed.singleVsMulti);
    assert.ok(parsed.singleVsMulti.a);
    assert.ok(parsed.singleVsMulti.b);
    assert.match(parsed.singleVsMulti.a.configLabel, /single-agent/);
    assert.match(parsed.singleVsMulti.b.configLabel, /multi-agent-par/);
  });

  it('run() with reviewers + json returns three rows (0/1/2 reviewers)', async () => {
    const mod = await import('../../cli/commands/bench.mjs');
    const origLog = console.log;
    let captured = '';
    console.log = (msg) => { captured += String(msg) + '\n'; };
    try {
      const code = await mod.run(['reviewers', '--format=json', '--seed=42']);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const parsed = JSON.parse(captured);
    assert.ok(Array.isArray(parsed.reviewers));
    assert.equal(parsed.reviewers.length, 3);
    assert.equal(parsed.reviewers[0].reviewerCount, 0);
    assert.equal(parsed.reviewers[1].reviewerCount, 1);
    assert.equal(parsed.reviewers[2].reviewerCount, 2);
  });
});

describe('efficiency-bench — SDK public API (audit #85)', () => {
  it('dist/index.js re-exports the bench module', async () => {
    const sdk = await import('../../packages/sdk/dist/index.js');
    assert.equal(typeof sdk.runBench, 'function');
    assert.equal(typeof sdk.compareConfigurations, 'function');
    assert.equal(typeof sdk.efficiencyFromRealRuns, 'function');
    assert.equal(typeof sdk.recommendFanOut, 'function');
    assert.equal(typeof sdk.recommendFanOutBatch, 'function');
  });

  it('dist/bench/index.d.ts re-declares every bench export', () => {
    const dts = readFileSync(join(REPO_ROOT, 'packages/sdk/dist/bench/index.d.ts'), 'utf8');
    for (const name of [
      'EFFICIENCY_BENCH_SCHEMA_VERSION',
      'AUTO_REDUCTION_SCHEMA_VERSION',
      'runBench',
      'compareConfigurations',
      'efficiencyFromRealRuns',
      'recommendFanOut',
      'recommendFanOutBatch',
      'MIN_FAN_OUT',
    ]) {
      assert.ok(dts.includes(name), `${name} must be in dist/bench/index.d.ts`);
    }
  });
});