#!/usr/bin/env node
/**
 * cli/commands/bench.mjs
 *
 * `bizar bench` — audit #85 (P2 efficiency benchmarks) operator surface.
 *
 * The SDK module at `packages/sdk/src/bench/efficiency.ts` is pure
 * (no I/O, no env reads); this CLI is the thin operator wrapper that
 * supplies the standard task profiles + auto-fan-out report and emits
 * the JSON / human-readable output.
 *
 * Subcommands:
 *
 *   bizar bench                           default: run all benchmarks
 *   bizar bench single-vs-multi           compare fanOut=1 vs fanOut=4
 *   bizar bench sequential-vs-parallel    compare serial vs parallel DAG
 *   bizar bench reviewers                 compare 0/1/2 reviewer gates
 *   bizar bench worktree                  compare worktree overhead vs saved conflict time
 *   bizar bench recommend-fan-out         apply auto-fan-out rule to a context
 *   bizar bench --format=json|human       output format (default: human)
 *   bizar bench --seed=N                  deterministic seed (default: 42)
 *
 * Why this exists: the audit calls out six required comparisons. We
 * ship five as built-in subcommands; the sixth (research depth) is
 * operator-configurable via `--tasks=<file.json>` and is intentionally
 * left to workflow owners to specialize. The auto-fan-out report is
 * the audit's "automatically reduce fan-out when coordination
 * overhead exceeds expected benefit" rule, surfaced as a runnable
 * command rather than buried in a router.
 */

import { readFileSync } from 'node:fs';
import {
  EFFICIENCY_BENCH_SCHEMA_VERSION,
  AUTO_REDUCTION_SCHEMA_VERSION,
  runBench,
  compareConfigurations,
  recommendFanOut,
} from '../../packages/sdk/dist/bench/index.js';

const REPO_ROOT = process.cwd();

/**
 * Default synthetic workload: a 4-task chain where each task is
 * roughly independent. Matches a typical "implement a feature" pass
 * (research → design → implement → verify).
 */
function defaultTasks() {
  return [
    { id: 'research', workMs: 4_000, costUsd: 12_000, successProb: 0.95, quality: 0.80 },
    { id: 'design',   workMs: 3_000, costUsd: 10_000, successProb: 0.90, quality: 0.85 },
    { id: 'implement',workMs: 8_000, costUsd: 24_000, successProb: 0.85, quality: 0.75 },
    { id: 'verify',   workMs: 3_000, costUsd:  8_000, successProb: 0.92, quality: 0.88 },
  ];
}

function loadTasks(args) {
  const tasksFlag = args.find((a) => a.startsWith('--tasks='));
  if (tasksFlag) {
    const path = tasksFlag.slice('--tasks='.length);
    const abs = path.startsWith('/') ? path : `${REPO_ROOT}/${path}`;
    const raw = JSON.parse(readFileSync(abs, 'utf8'));
    if (!Array.isArray(raw)) {
      throw new TypeError('--tasks=<file.json> must contain a JSON array');
    }
    return raw;
  }
  return defaultTasks();
}

function seedOf(args) {
  const sFlag = args.find((a) => a.startsWith('--seed='));
  return sFlag ? Number(sFlag.slice('--seed='.length)) : 42;
}

function formatOf(args) {
  const fFlag = args.find((a) => a.startsWith('--format='));
  return fFlag ? fFlag.slice('--format='.length) : 'human';
}

/** Configurations for the single-vs-multi comparison. */
function configsSingleVsMulti() {
  return [
    { label: 'single-agent',     fanOut: 1, reviewerCount: 1, parallel: false, coordinationOverheadRatio: 0.0 },
    { label: 'multi-agent-par',  fanOut: 4, reviewerCount: 1, parallel: true,  coordinationOverheadRatio: 0.15 },
  ];
}

function configsSequentialVsParallel() {
  return [
    { label: 'sequential',       fanOut: 1, reviewerCount: 1, parallel: false, coordinationOverheadRatio: 0.0 },
    { label: 'parallel-dag',     fanOut: 4, reviewerCount: 1, parallel: true,  coordinationOverheadRatio: 0.10 },
  ];
}

function configsReviewers() {
  return [
    { label: 'no-reviewers',     fanOut: 1, reviewerCount: 0, parallel: false, coordinationOverheadRatio: 0.0 },
    { label: '1-reviewer',       fanOut: 1, reviewerCount: 1, parallel: false, coordinationOverheadRatio: 0.0 },
    { label: '2-reviewers',      fanOut: 1, reviewerCount: 2, parallel: false, coordinationOverheadRatio: 0.0 },
  ];
}

function configsWorktree() {
  // 4 workers with and without worktree overhead.
  return [
    { label: 'no-worktree',      fanOut: 4, reviewerCount: 1, parallel: true,  coordinationOverheadRatio: 0.10 },
    { label: 'with-worktree',    fanOut: 4, reviewerCount: 1, parallel: true,  coordinationOverheadRatio: 0.35 },
  ];
}

function runComparison(tasks, configs, seed) {
  const [a, b] = configs;
  return compareConfigurations(tasks, a, b, seed);
}

function benchSingleVsMulti(tasks, seed) {
  return runComparison(tasks, configsSingleVsMulti(), seed);
}

function benchSequentialVsParallel(tasks, seed) {
  return runComparison(tasks, configsSequentialVsParallel(), seed);
}

function benchReviewers(tasks, seed) {
  const configs = configsReviewers();
  return configs.map((c) => runBench(tasks, c, seed));
}

function benchWorktree(tasks, seed) {
  return runComparison(tasks, configsWorktree(), seed);
}

/**
 * Render a single BenchResult as a fixed-width row.
 */
function formatRow(r) {
  const cost = Number.isFinite(r.costPerVerifiedUsd)
    ? (r.costPerVerifiedUsd / 1_000_000).toFixed(4) + ' USD'
    : '∞';
  const wall = Number.isFinite(r.wallClockPerVerifiedMs)
    ? r.wallClockPerVerifiedMs.toFixed(0) + ' ms'
    : '∞';
  return [
    r.configLabel.padEnd(22),
    `fanOut=${String(r.fanOut).padEnd(2)}`,
    `reviewers=${r.reviewerCount}`,
    `verified=${String(r.verifiedOutcomes).padEnd(2)}/${r.totalAttempts}`,
    `cost/v=${cost.padStart(10)}`,
    `wall/v=${wall.padStart(10)}`,
  ].join('  ');
}

function renderHumanSingleVsMulti(comparison) {
  const out = [];
  out.push('  single-agent vs multi-agent (audit #85)');
  out.push('');
  out.push('    ' + formatRow(comparison.a));
  out.push('    ' + formatRow(comparison.b));
  out.push('');
  out.push(
    `    cost ratio (a/b): ${comparison.costRatioAOverB.toFixed(2)}   wall ratio (a/b): ${comparison.wallClockRatioAOverB.toFixed(2)}`,
  );
  out.push(
    `    winner by cost: ${comparison.costWinner}    winner by wall-clock: ${comparison.wallClockWinner}`,
  );
  return out.join('\n');
}

function renderHumanSequentialVsParallel(comparison) {
  const out = [];
  out.push('  sequential vs parallel DAG (audit #85)');
  out.push('');
  out.push('    ' + formatRow(comparison.a));
  out.push('    ' + formatRow(comparison.b));
  out.push('');
  out.push(
    `    wall-clock speedup (a/b): ${comparison.wallClockRatioAOverB.toFixed(2)} (lower = sequential is faster)`,
  );
  return out.join('\n');
}

function renderHumanReviewers(results) {
  const out = [];
  out.push('  reviewer count vs verified outcomes (audit #85)');
  out.push('');
  for (const r of results) {
    out.push('    ' + formatRow(r));
  }
  out.push('');
  out.push('    expectation: 0 reviewers = cheapest, highest defect rate;');
  out.push('                 2 reviewers = lowest defect rate, ~2× reviewer cost.');
  return out.join('\n');
}

function renderHumanWorktree(comparison) {
  const out = [];
  out.push('  worktree overhead vs saved conflict time (audit #85)');
  out.push('');
  out.push('    ' + formatRow(comparison.a));
  out.push('    ' + formatRow(comparison.b));
  out.push('');
  out.push(
    `    observed overhead ratios: a=${comparison.a.observedOverheadRatio.toFixed(2)}  b=${comparison.b.observedOverheadRatio.toFixed(2)}`,
  );
  out.push(
    `    verdict: ${comparison.a.totalWallClockMs <= comparison.b.totalWallClockMs ? 'no-worktree' : 'with-worktree'} wins on wall-clock`,
  );
  return out.join('\n');
}

function renderHumanAutoReduction(decision, ctx) {
  const out = [];
  out.push('  recommend-fan-out (auto-reduction rule, audit #85)');
  out.push('');
  out.push(`    context:                fanOut=${ctx.currentFanOut}  overheadRatio=${ctx.historicalCoordinationOverheadRatio}  expectedBenefitRatio=${ctx.expectedBenefitRatio}  defectEscapeRate=${ctx.historicalDefectEscapeRate}`);
  out.push(`    recommended fan-out:    ${decision.recommendedFanOut}`);
  out.push(`    reason:                 ${decision.reason}`);
  out.push(`    overhead-vs-benefit:    ${decision.overheadVsBenefitGap.toFixed(3)}`);
  out.push(`    reduced:                ${decision.reduced}`);
  out.push('');
  out.push('    rule:');
  out.push('      defectEscapeRate > 0.20  →  verifier-cannot-certify (fan-out unchanged; widen reviewers)');
  out.push('      overheadRatio >= benefit →  reduce by one step (single-worker-fan-out at floor)');
  out.push('      otherwise                →  keep-current');
  return out.join('\n');
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eq = key.indexOf('=');
      if (eq >= 0) {
        flags[key.slice(0, eq)] = key.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (!next || next.startsWith('--')) flags[key] = true;
        else { flags[key] = next; i++; }
      }
    }
  }
  return flags;
}

function parseAutoReductionFlags(args) {
  // bizar bench recommend-fan-out --fan-out=N --overhead=R --benefit=R --escape=R
  const flags = parseFlags(args);
  const fanOut = Number(flags['fan-out'] ?? flags.fanOut ?? 4);
  const overhead = Number(flags.overhead ?? 0.5);
  const benefit = Number(flags.benefit ?? 0.6);
  const escape = Number(flags.escape ?? 0.05);
  return {
    currentFanOut: fanOut,
    historicalCoordinationOverheadRatio: overhead,
    expectedBenefitRatio: benefit,
    historicalDefectEscapeRate: escape,
  };
}

export const USAGE = `
  bizar bench — audit #85 efficiency benchmarks + auto-fan-out rule

  Usage:
    bizar bench [single-vs-multi | sequential-vs-parallel | reviewers | worktree]
                [--format=json|human] [--seed=N] [--tasks=<file.json>]
    bizar bench recommend-fan-out --fan-out=N --overhead=R --benefit=R --escape=R
                [--format=json|human]

  Subcommands (default: run all four):
    single-vs-multi           fanOut=1 sequential vs fanOut=4 parallel
    sequential-vs-parallel    serial 4-task chain vs parallel 4-task DAG
    reviewers                 0/1/2 reviewer gates on the same task set
    worktree                  coordination overhead 0.10 vs 0.35

  recommend-fan-out:
    bizar bench recommend-fan-out --fan-out=4 --overhead=0.5 --benefit=0.6 --escape=0.05
    Applies the audit's "automatically reduce fan-out when coordination
    overhead exceeds expected benefit" rule.

  Schema versions:
    bench/efficiency.ts       ${EFFICIENCY_BENCH_SCHEMA_VERSION}
    bench/auto-reduction.ts   ${AUTO_REDUCTION_SCHEMA_VERSION}
`;

export async function run(subargs) {
  if (subargs.includes('--help') || subargs.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const subcommand = subargs.find((a) => !a.startsWith('--'));

  if (subcommand === 'recommend-fan-out') {
    const ctx = parseAutoReductionFlags(subargs);
    const decision = recommendFanOut(ctx);
    if (formatOf(subargs) === 'json') {
      console.log(JSON.stringify({ context: ctx, decision, schemaVersion: AUTO_REDUCTION_SCHEMA_VERSION }, null, 2));
    } else {
      console.log(renderHumanAutoReduction(decision, ctx));
    }
    return 0;
  }

  const tasks = loadTasks(subargs);
  const seed = seedOf(subargs);
  const format = formatOf(subargs);
  const runOne = subcommand === undefined;
  const want = (name) => runOne || subcommand === name;

  const out = { schemaVersion: EFFICIENCY_BENCH_SCHEMA_VERSION, generatedAt: new Date().toISOString() };

  if (want('single-vs-multi')) {
    out.singleVsMulti = benchSingleVsMulti(tasks, seed);
  }
  if (want('sequential-vs-parallel')) {
    out.sequentialVsParallel = benchSequentialVsParallel(tasks, seed);
  }
  if (want('reviewers')) {
    out.reviewers = benchReviewers(tasks, seed);
  }
  if (want('worktree')) {
    out.worktree = benchWorktree(tasks, seed);
  }

  if (Object.keys(out).length === 2) {
    console.log(USAGE);
    return 1;
  }

  if (format === 'json') {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`bizar bench — audit #85 (generated ${out.generatedAt}, seed=${seed})`);
    console.log('');
    if (out.singleVsMulti) {
      console.log(renderHumanSingleVsMulti(out.singleVsMulti));
      console.log('');
    }
    if (out.sequentialVsParallel) {
      console.log(renderHumanSequentialVsParallel(out.sequentialVsParallel));
      console.log('');
    }
    if (out.reviewers) {
      console.log(renderHumanReviewers(out.reviewers));
      console.log('');
    }
    if (out.worktree) {
      console.log(renderHumanWorktree(out.worktree));
      console.log('');
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}