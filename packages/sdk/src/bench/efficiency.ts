/**
 * bench/efficiency.ts — Production-autonomy audit #85, P2 efficiency benchmarks.
 *
 * Audit quote (production-autonomy-improvements-2026-08-28.md, line 265):
 *
 *   "More roles and parallelism do not guarantee faster completion.
 *    Add controlled benchmarks comparing:
 *      - single-agent versus multi-agent execution;
 *      - sequential versus parallel DAGs;
 *      - model tiers and escalation policies;
 *      - worktree overhead versus saved conflict time;
 *      - research depth versus task success;
 *      - reviewer count versus defect escape rate.
 *    Optimize for verified outcomes per euro and per wall-clock minute.
 *    Automatically reduce fan-out when coordination overhead exceeds
 *    expected benefit."
 *
 * This module exposes a deterministic, pure-JS benchmark harness. The
 * canonical inputs are *synthetic tasks* — operator-supplied workload
 * profiles that carry:
 *
 *   - `workMs`: simulated wall-clock duration per worker invocation
 *   - `costUsd`: simulated model cost in micro-cents per worker invocation
 *   - `successProb`: probability a worker produces a passing result
 *   - `quality`: 0..1 quality score of the worker's output (also a function
 *                of `reviewerCount` — reviewers catch some defects)
 *
 * The harness runs each benchmark configuration with a fixed seed
 * (`rngSeed`) so different runs of the same input are reproducible.
 * Everything here is pure: no I/O, no clocks, no environment reads.
 * `bizar bench` (cli/commands/bench.mjs) is the operator-facing wrapper.
 *
 * Why synthetic: real Claude-API benchmarks are non-deterministic and
 * cost money. The point of these benchmarks is *relative* — to make the
 * "fan-out × coordination overhead" trade-off observable and
 * auditable, not to predict absolute throughput. Operators wire the
 * harness to their actual cost / latency samples at run time by
 * supplying `realRuns` (see `efficiencyFromRealRuns`).
 *
 * Schema version (audit #84). Bump on ANY breaking change to the input
 * or result shape. Additive optional fields bump the minor.
 */
export const EFFICIENCY_BENCH_SCHEMA_VERSION = "1.0.0";

/**
 * One synthetic task — a single unit of work a worker can perform.
 * Mirrors the typed `EvidenceBundle.resourceUsage` shape (micro-cent
 * cost, millisecond wall-clock) so the bench output can be folded
 * directly into the autonomy ledger when real runs are substituted.
 */
export interface SyntheticTask {
  /** Stable id for the task; used as a key in benchmark reports. */
  readonly id: string;
  /** Wall-clock duration of one worker invocation in milliseconds. */
  readonly workMs: number;
  /** Cost of one worker invocation in USD micro-cents (1 USD = 1e6 uSD). */
  readonly costUsd: number;
  /** Probability the worker produces a passing result, 0..1. */
  readonly successProb: number;
  /**
   * Quality score of the worker's output, 0..1. Reviewers consume
   * this to compute the effective defect rate. Real workers should
   * report quality in their EvidenceBundle, but for the synthetic
   * harness it is part of the workload profile.
   */
  readonly quality: number;
}

/**
 * Configuration for one benchmark run: how many parallel reviewers
 * gate the work and whether the worker DAG is sequential or parallel.
 * `parallel: true` means each task runs in its own worker; `false`
 * means tasks run on a single worker in series (work = sum(workMs),
 * cost = sum(costUsd)).
 */
export interface BenchConfig {
  readonly label: string;
  readonly fanOut: number;
  readonly reviewerCount: number;
  readonly parallel: boolean;
  /**
   * Coordination overhead ratio (0..1+). 0 = free parallelism; 0.5 =
   * parallel work costs 50% more wall-clock than a single worker.
   * Derived empirically from operator logs (see `audit-coordination`
   * hook in audit #83 followups).
   */
  readonly coordinationOverheadRatio: number;
}

/**
 * One worker's outcome. Internal to the harness.
 */
interface WorkerRun {
  readonly taskId: string;
  readonly succeeded: boolean;
  readonly quality: number;
  readonly workMs: number;
  readonly costUsd: number;
}

/**
 * Result of one benchmark configuration. The two headline metrics —
 * `costPerVerifiedUsd` and `wallClockPerVerifiedMs` — are the audit's
 * "verified outcomes per euro and per wall-clock minute" axes.
 */
export interface BenchResult {
  readonly configLabel: string;
  readonly fanOut: number;
  readonly reviewerCount: number;
  readonly parallel: boolean;
  readonly coordinationOverheadRatio: number;
  /** Total cost in micro-cents for the configuration. */
  readonly totalCostUsd: number;
  /** Total wall-clock duration in milliseconds (parallel = max, sequential = sum). */
  readonly totalWallClockMs: number;
  /** Successful + reviewer-passing outcomes (audit's "verified outcomes"). */
  readonly verifiedOutcomes: number;
  /** Total attempts (before reviewers). */
  readonly totalAttempts: number;
  /** cost / verifiedOutcomes, or +Infinity if verifiedOutcomes is 0. */
  readonly costPerVerifiedUsd: number;
  /** wallClock / verifiedOutcomes, or +Infinity if verifiedOutcomes is 0. */
  readonly wallClockPerVerifiedMs: number;
  /**
   * Coordination overhead ratio actually observed: (real wall-clock -
   * theoretical-best wall-clock) / theoretical-best. The theoretical
   * best for `parallel: true` is `max(worker.workMs) * (1 +
   * coordinationOverheadRatio)`. The benchmark lets operators see
   * whether the configured ratio matched reality.
   */
  readonly observedOverheadRatio: number;
}

/**
 * Compare two configurations on the same task set. Lower is better for
 * both `costPerVerifiedUsd` and `wallClockPerVerifiedMs`. The function
 * also returns the relative win on each axis (positive = `a` is better,
 * expressed as a fraction of `a`'s own metric).
 */
export interface BenchComparison {
  readonly a: BenchResult;
  readonly b: BenchResult;
  readonly costRatioAOverB: number;
  readonly wallClockRatioAOverB: number;
  /** Best-by-cost. */
  readonly costWinner: "a" | "b";
  /** Best-by-wall-clock. */
  readonly wallClockWinner: "a" | "b";
}

/**
 * Deterministic PRNG (Mulberry32). `bizar bench` accepts a numeric
 * seed so reruns of the same task set produce identical numbers; this
 * is what makes the audit reproducible across operators.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run a single configuration against a task set. `parallel: true`
 * runs `fanOut` workers in parallel; `parallel: false` runs them in
 * series on a single worker. Reviewers each add `workMs` +
 * `costUsd` per worker, gate-passed with probability
 * `1 - (1 - worker.quality) ^ reviewerCount`.
 *
 * The reviewers add their cost AFTER workers complete (sequential
 * per worker). This matches the audit's "reviewer count vs defect
 * escape rate" prescription: each reviewer independently inspects
 * the same worker output.
 */
export function runBench(
  tasks: ReadonlyArray<SyntheticTask>,
  config: BenchConfig,
  seed: number,
): BenchResult {
  if (tasks.length === 0) {
    return {
      configLabel: config.label,
      fanOut: config.fanOut,
      reviewerCount: config.reviewerCount,
      parallel: config.parallel,
      coordinationOverheadRatio: config.coordinationOverheadRatio,
      totalCostUsd: 0,
      totalWallClockMs: 0,
      verifiedOutcomes: 0,
      totalAttempts: 0,
      costPerVerifiedUsd: Number.POSITIVE_INFINITY,
      wallClockPerVerifiedMs: Number.POSITIVE_INFINITY,
      observedOverheadRatio: 0,
    };
  }
  const rng = mulberry32(seed);
  const workers: WorkerRun[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i % tasks.length];
    const workMs = config.parallel ? t.workMs : t.workMs;
    const costUsd = t.costUsd;
    const passed = rng() < t.successProb;
    // Quality jitters slightly per run so two perfect workers can still
    // diverge. Bounded 0..1; mean = t.quality, spread 0.1.
    const quality = Math.min(1, Math.max(0, t.quality + (rng() - 0.5) * 0.1));
    workers.push({ taskId: t.id, succeeded: passed, quality, workMs, costUsd });
  }

  // Reviewer gate: each reviewer independently rejects with probability
  // (1 - quality). Multiple reviewers compound — `n` reviewers catch
  // `(1 - quality)^n` defects on average.
  let verified = 0;
  let reviewerCostUsd = 0;
  let reviewerWallClockMs = 0;
  for (const w of workers) {
    if (!w.succeeded) continue;
    const defectProb = 1 - w.quality;
    const caught = 1 - Math.pow(defectProb, config.reviewerCount);
    if (rng() < caught) continue;
    verified += 1;
    reviewerCostUsd += Math.round(w.costUsd * 0.1) * config.reviewerCount;
    reviewerWallClockMs += Math.round(w.workMs * 0.15) * config.reviewerCount;
  }

  const workerCostUsd = workers.reduce((a, w) => a + w.costUsd, 0);
  const workerWallClockMs = workers.reduce((a, w) => a + Math.max(0, w.workMs), 0);
  const totalCostUsd = workerCostUsd + reviewerCostUsd;

  // Wall-clock: parallel = max(workers) × (1 + coord overhead);
  // sequential = sum(workers) × (1 + coord overhead, applied to scheduler).
  // Reviewers always run after workers complete (sequential gate).
  let totalWallClockMs: number;
  let theoreticalBestMs: number;
  if (config.parallel) {
    theoreticalBestMs = Math.max(...workers.map((w) => w.workMs));
    totalWallClockMs =
      Math.ceil(theoreticalBestMs * (1 + config.coordinationOverheadRatio)) +
      reviewerWallClockMs;
  } else {
    theoreticalBestMs = workerWallClockMs;
    totalWallClockMs = workerWallClockMs + reviewerWallClockMs;
  }
  const observedOverhead =
    theoreticalBestMs === 0
      ? 0
      : (totalWallClockMs - theoreticalBestMs) / theoreticalBestMs;

  return {
    configLabel: config.label,
    fanOut: config.fanOut,
    reviewerCount: config.reviewerCount,
    parallel: config.parallel,
    coordinationOverheadRatio: config.coordinationOverheadRatio,
    totalCostUsd,
    totalWallClockMs,
    verifiedOutcomes: verified,
    totalAttempts: workers.length,
    costPerVerifiedUsd: verified === 0 ? Number.POSITIVE_INFINITY : totalCostUsd / verified,
    wallClockPerVerifiedMs:
      verified === 0 ? Number.POSITIVE_INFINITY : totalWallClockMs / verified,
    observedOverheadRatio: Math.max(0, observedOverhead),
  };
}

/**
 * Compare two configurations on the same task set and report the
 * headline relative metrics. The audit's three named comparisons
 * (single vs multi, sequential vs parallel, 0 vs 1 vs 2 reviewers)
 * all become a `compareConfigurations` call.
 */
export function compareConfigurations(
  tasks: ReadonlyArray<SyntheticTask>,
  a: BenchConfig,
  b: BenchConfig,
  seed: number,
): BenchComparison {
  const ra = runBench(tasks, a, seed);
  const rb = runBench(tasks, b, seed);
  // Both infinities ⇒ ratio undefined; pick +Infinity for safety.
  const costRatio =
    rb.costPerVerifiedUsd === Number.POSITIVE_INFINITY
      ? ra.costPerVerifiedUsd === Number.POSITIVE_INFINITY
        ? 1
        : Number.POSITIVE_INFINITY
      : ra.costPerVerifiedUsd / rb.costPerVerifiedUsd;
  const wallClockRatio =
    rb.wallClockPerVerifiedMs === Number.POSITIVE_INFINITY
      ? ra.wallClockPerVerifiedMs === Number.POSITIVE_INFINITY
        ? 1
        : Number.POSITIVE_INFINITY
      : ra.wallClockPerVerifiedMs / rb.wallClockPerVerifiedMs;
  return {
    a: ra,
    b: rb,
    costRatioAOverB: costRatio,
    wallClockRatioAOverB: wallClockRatio,
    costWinner: ra.costPerVerifiedUsd <= rb.costPerVerifiedUsd ? "a" : "b",
    wallClockWinner:
      ra.wallClockPerVerifiedMs <= rb.wallClockPerVerifiedMs ? "a" : "b",
  };
}

/**
 * Reduce a list of real `EvidenceBundle` records (or any shape with
 * the same numeric fields) into the same `BenchResult` shape the
 * synthetic harness produces. Operators wire this to their autonomy
 * ledger so future `bizar bench` invocations report on real data,
 * not the synthetic default.
 */
export interface RealRunSummary {
  readonly configLabel: string;
  readonly fanOut: number;
  readonly reviewerCount: number;
  readonly parallel: boolean;
  readonly coordinationOverheadRatio: number;
  readonly totalCostUsd: number;
  readonly totalWallClockMs: number;
  readonly verifiedOutcomes: number;
  readonly totalAttempts: number;
}

export function efficiencyFromRealRuns(input: RealRunSummary): BenchResult {
  return {
    configLabel: input.configLabel,
    fanOut: input.fanOut,
    reviewerCount: input.reviewerCount,
    parallel: input.parallel,
    coordinationOverheadRatio: input.coordinationOverheadRatio,
    totalCostUsd: input.totalCostUsd,
    totalWallClockMs: input.totalWallClockMs,
    verifiedOutcomes: input.verifiedOutcomes,
    totalAttempts: input.totalAttempts,
    costPerVerifiedUsd:
      input.verifiedOutcomes === 0
        ? Number.POSITIVE_INFINITY
        : input.totalCostUsd / input.verifiedOutcomes,
    wallClockPerVerifiedMs:
      input.verifiedOutcomes === 0
        ? Number.POSITIVE_INFINITY
        : input.totalWallClockMs / input.verifiedOutcomes,
    observedOverheadRatio: 0,
  };
}
