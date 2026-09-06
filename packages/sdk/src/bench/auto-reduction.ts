/**
 * bench/auto-reduction.ts — Production-autonomy audit #85, fan-out auto-reduction.
 *
 * Audit quote (production-autonomy-improvements-2026-08-28.md, line 276):
 *
 *   "Automatically reduce fan-out when coordination overhead exceeds
 *    expected benefit."
 *
 * The `recommendFanOut` pure function is the operational rule. It
 * consumes:
 *
 *   - `currentFanOut`: the orchestrator's current fan-out (number of
 *     parallel workers for the next dispatch)
 *   - `historicalCoordinationOverheadRatio`: empirically observed
 *     coordination overhead from prior `runBench` / real-runs data
 *   - `expectedBenefitRatio`: how much parallelism is *expected* to
 *     improve the work, expressed as a fraction of wall-clock saved
 *     vs a single worker. (E.g. 4 independent tasks → 0.75 expected
 *     speedup; `expectedBenefitRatio = 0.75`.)
 *   - `historicalDefectEscapeRate`: fraction of worker outputs that
 *     reviewers missed (0..1). Higher escape rate means reviewers
 *     aren't pulling their weight; the rule widens to compensate.
 *
 * and returns:
 *
 *   - `recommendedFanOut`: 1..currentFanOut
 *   - `reason`: stable, machine-readable justification the orchestrator
 *     can log into its audit trail
 *
 * Decision rule (audit-aligned):
 *
 *   1. If coordination overhead ≥ expected benefit, reduce by 1 each
 *      step until fan-out = 1 (single worker wins).
 *   2. If defect escape rate > 0.20 (audit failure threshold for
 *      "verifier cannot certify"), widen reviewer count rather than
 *      fan-out (out of scope for this function — we surface the
 *      recommendation but leave widening to the reviewer policy).
 *   3. Otherwise, keep current fan-out.
 *
 * Why pure: the rule is consulted from `bizar bench recommend-fan-out`
 * (CLI) and from orchestrator fan-out policy; both contexts want the
 * same answer for the same inputs, with no I/O surprise.
 */

export const AUTO_REDUCTION_SCHEMA_VERSION = "1.0.0";

/** Threshold above which coordination overhead is deemed to exceed benefit. */
export const DEFAULT_OVERHEAD_VS_BENEFIT_RATIO = 1.0;
/** Defect escape rate above which the rule recommends widening reviewers. */
export const DEFAULT_DEFECT_ESCAPE_RATE_THRESHOLD = 0.20;
/** Hard floor: never recommend fan-out = 0. */
export const MIN_FAN_OUT = 1;
/** Hard ceiling: never widen fan-out beyond the input. */
export const MAX_FAN_OUT_FLOOR = 1;

export interface FanOutContext {
  readonly currentFanOut: number;
  /**
   * Empirically observed coordination overhead ratio (0..2+). 0.5 =
   * parallel work costs 50% more wall-clock than the theoretical best.
   */
  readonly historicalCoordinationOverheadRatio: number;
  /**
   * Expected wall-clock savings from parallelism (0..1). 0.75 = the
   * work is 75% faster when split into N independent workers.
   */
  readonly expectedBenefitRatio: number;
  /**
   * Fraction of defects reviewers missed across the recent window
   * (0..1). Used to flag a "verifier cannot certify" condition.
   */
  readonly historicalDefectEscapeRate: number;
}

export type FanOutDecisionReason =
  | "single-worker-fan-out"
  | "coordination-overhead-exceeds-benefit"
  | "verifier-cannot-certify"
  | "keep-current";

export interface FanOutDecision {
  readonly recommendedFanOut: number;
  readonly reason: FanOutDecisionReason;
  /** Diagnostic: combined (overheadRatio - expectedBenefitRatio). Positive = reduce. */
  readonly overheadVsBenefitGap: number;
  /** Diagnostic: did the rule trigger a reduction? */
  readonly reduced: boolean;
}

/**
 * Pure fan-out recommendation. See file header for the rule.
 */
export function recommendFanOut(ctx: FanOutContext): FanOutDecision {
  const fanOut = Math.max(MIN_FAN_OUT, Math.floor(ctx.currentFanOut));
  const overhead = ctx.historicalCoordinationOverheadRatio;
  const benefit = ctx.expectedBenefitRatio;
  const escape = ctx.historicalDefectEscapeRate;
  const gap = overhead - benefit;

  // Rule 2 first: defect escape rate above the threshold — surface the
  // condition but do NOT shrink fan-out, since shrinking workers
  // doesn't fix a reviewer-policy problem. The orchestrator widens
  // reviewers separately. Returning the current fan-out with a
  // distinct reason lets the caller log the trigger and route the
  // fix to the right policy.
  if (escape > DEFAULT_DEFECT_ESCAPE_RATE_THRESHOLD) {
    return {
      recommendedFanOut: fanOut,
      reason: "verifier-cannot-certify",
      overheadVsBenefitGap: gap,
      reduced: false,
    };
  }

  // Rule 1: coordination overhead meets or exceeds expected benefit.
  // Reduce by one step per call; the orchestrator calls again on the
  // next dispatch until either gap ≤ 0 or fan-out = 1.
  if (overhead >= benefit && fanOut > MIN_FAN_OUT) {
    const next = fanOut - 1;
    return {
      recommendedFanOut: next,
      reason: next === MIN_FAN_OUT ? "single-worker-fan-out" : "coordination-overhead-exceeds-benefit",
      overheadVsBenefitGap: gap,
      reduced: true,
    };
  }

  return {
    recommendedFanOut: fanOut,
    reason: "keep-current",
    overheadVsBenefitGap: gap,
    reduced: false,
  };
}

/**
 * Convenience helper for a batch of context updates (e.g. applied to
 * the last K historical buckets at once). Each context is reduced in
 * turn; the first one that triggers a reduction is returned. Useful
 * when the orchestrator wants the *most aggressive* safe reduction.
 */
export function recommendFanOutBatch(
  contexts: ReadonlyArray<FanOutContext>,
): FanOutDecision {
  if (contexts.length === 0) {
    return {
      recommendedFanOut: MIN_FAN_OUT,
      reason: "single-worker-fan-out",
      overheadVsBenefitGap: 0,
      reduced: false,
    };
  }
  // Track the worst-gap keep-current decision so we always return a
  // decision that reflects the most adverse observed gap, never a
  // fabricated initial state.
  let worstKeepCurrent: FanOutDecision | null = null;
  for (const ctx of contexts) {
    const next = recommendFanOut(ctx);
    if (next.reduced) return next;
    if (
      worstKeepCurrent === null ||
      next.overheadVsBenefitGap > worstKeepCurrent.overheadVsBenefitGap
    ) {
      worstKeepCurrent = next;
    }
  }
  return (
    worstKeepCurrent ?? {
      recommendedFanOut: MIN_FAN_OUT,
      reason: "single-worker-fan-out",
      overheadVsBenefitGap: 0,
      reduced: false,
    }
  );
}
