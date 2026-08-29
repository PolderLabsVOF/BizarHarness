/**
 * bench/index.ts — Public re-exports for the efficiency-bench module (audit #85).
 *
 * Why this exists: the production-autonomy audit's P2 recommendation
 * calls for "controlled benchmarks comparing single-agent vs multi-
 * agent, sequential vs parallel DAGs, model tiers, worktree overhead,
 * research depth, and reviewer count". This barrel exposes the
 * synthetic harness + the auto-fan-out-reduction rule so callers can
 * wire either piece from the SDK or from `bizar bench`.
 */

export {
  EFFICIENCY_BENCH_SCHEMA_VERSION,
  runBench,
  compareConfigurations,
  efficiencyFromRealRuns,
} from "./efficiency.js";
export type {
  SyntheticTask,
  BenchConfig,
  BenchResult,
  BenchComparison,
  RealRunSummary,
} from "./efficiency.js";

export {
  AUTO_REDUCTION_SCHEMA_VERSION,
  DEFAULT_OVERHEAD_VS_BENEFIT_RATIO,
  DEFAULT_DEFECT_ESCAPE_RATE_THRESHOLD,
  MIN_FAN_OUT,
  recommendFanOut,
  recommendFanOutBatch,
} from "./auto-reduction.js";
export type {
  FanOutContext,
  FanOutDecisionReason,
  FanOutDecision,
} from "./auto-reduction.js";
