/**
 * ambiguity/score.ts — Quantitative ambiguity scoring for Bizar
 * deep-interview and pre-execution gates (F-202, Phase 1 OMX adoption).
 *
 * Inspired by OMX's per-dimension clarity model. The function name
 * matches its semantics: `computeAmbiguity` returns an *ambiguity*
 * score in `[0, 1]` where **lower = clearer** (low-is-good). This is
 * what `config/skills/deep-interview/SKILL.md` reads for the closure
 * condition `AmbiguityScore ≤ 0.10` and what `bizar ambiguity`'s
 * `--allow-high` gate uses.
 *
 * Internally we accept per-dimension *clarity* values in `[0, 1]`
 * (high-is-clear) and compute the ambiguity contribution per
 * dimension as `w_i · (1 − clarity_i)`. The total is therefore:
 *   `score = Σ_i (w_i · (1 − clarity_i)) = 1 − Σ_i (w_i · clarity_i)`
 * which is in `[0, 1]`, low-is-good, and matches the function name.
 *
 * The split keeps the math deterministic and testable in isolation
 * (no model flakiness in unit tests) while still letting callers
 * source the per-dimension clarity from an upstream Socratic loop.
 * We do NOT call an LLM from inside this module.
 *
 * Two weight presets are shipped:
 *   - `greenfield` — 6 dimensions, `intent | outcome | scope | constraints | success | context`.
 *   - `brownfield` — 5 dimensions, `intent | outcome | scope | constraints | success`.
 * Both weight sets are required to sum to exactly `1.00` (see
 * `scripts/__tests__/ambiguity-weights.test.mjs` for the invariant).
 *
 * Returned `score` is the weighted average of per-dimension
 * ambiguity, so closure (`score ≤ 0.10`) reads as "≤ 10% ambiguity
 * remaining". The `breakdown` records each dimension's contribution
 * to that total so callers can render a "what is still unclear?"
 * table without redoing the math.
 *
 * **Schema note**: AMBIGUITY_SCHEMA_VERSION was bumped 1.0.0 → 2.0.0
 * on 2026-09-03 to mark the semantic flip from `Σ w_i · clarity_i`
 * (high-is-clear) to `Σ w_i · (1 − clarity_i)` (low-is-good, true
 * ambiguity). Consumers that persisted a v1.0.0 score should treat
 * it as `1 − stored` when reading back.
 */

export const AMBIGUITY_SCHEMA_VERSION = "2.0.0" as const;

/** Allowed ambiguity-weight presets. */
export type AmbiguityKind = "greenfield" | "brownfield";

/**
 * Per-dimension clarity values, each in `[0, 1]`.
 *
 * Keys present in the chosen weight set MUST be present here;
 * unknown keys cause `computeAmbiguity` to throw with
 * `AMBIGUITY_UNKNOWN_DIMENSION`. Missing keys cause a throw with
 * `AMBIGUITY_MISSING_DIMENSION`. This is a deliberate fail-loud
 * choice so callers cannot silently zero-out a dimension by
 * forgetting to score it.
 */
export type AmbiguityInput = Readonly<Record<string, number>>;

/** Result of `computeAmbiguity`. */
export interface AmbiguityScore {
  /** Weighted ambiguity in `[0, 1]`. Lower = clearer. The closure
   *  gate in `config/skills/deep-interview/SKILL.md` is
   *  `score ≤ 0.10`. */
  readonly score: number;
  /** Per-dimension ambiguity contribution. Keys mirror the
   *  weight-set keys; values are the per-dimension
   *  `w_i · (1 − clarity_i)` contribution in `[0, w_i]`. The values
   *  sum to `score` so callers can render "what is still unclear?"
   *  by sorting descending without redoing the math. */
  readonly breakdown: Readonly<Record<string, number>>;
  /** Echoes `AMBIGUITY_SCHEMA_VERSION` so consumers can persist a
   *  versioned record alongside the spec artifact. */
  readonly schemaVersion: typeof AMBIGUITY_SCHEMA_VERSION;
  /** Echoes the kind used so consumers do not have to remember. */
  readonly kind: AmbiguityKind;
}

/**
 * Greenfield weight preset — six dimensions summing to `1.00`.
 * Brownfield `context` captures "how much existing code is this
 * touching?", which is N/A for greenfield work and therefore
 * omitted there.
 */
export const AMBIGUITY_WEIGHTS = Object.freeze({
  greenfield: Object.freeze({
    intent: 0.20,
    outcome: 0.20,
    scope: 0.15,
    constraints: 0.15,
    success: 0.15,
    context: 0.15,
  }),
  brownfield: Object.freeze({
    intent: 0.25,
    outcome: 0.25,
    scope: 0.20,
    constraints: 0.15,
    success: 0.15,
  }),
} as const);

/**
 * The full set of dimension names across both weight presets, exposed
 * for tooling (lint rules, drift guards, docs). Order matches
 * declaration order; not load-bearing.
 */
export const AMBIGUITY_DIMENSIONS = Object.freeze([
  "intent",
  "outcome",
  "scope",
  "constraints",
  "success",
  "context",
] as const);

export type AmbiguityDimension = (typeof AMBIGUITY_DIMENSIONS)[number];

function assertNonEmptyRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("computeAmbiguity: input must be a non-array object");
  }
  if (Object.keys(value as object).length === 0) {
    throw new TypeError("computeAmbiguity: input must contain at least one dimension");
  }
}

function isFiniteNumberInUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Compute the weighted ambiguity score for an input.
 *
 * @param input  Per-dimension clarity in `[0, 1]`.
 * @param kind   Which weight preset to apply.
 * @returns      `{ score, breakdown, schemaVersion, kind }`.
 *
 * Throws `TypeError` when:
 *   - `input` is not a non-empty object;
 *   - a key is missing from the chosen weight set;
 *   - a value is not a finite number in `[0, 1]`;
 *   - a value is `NaN` or non-numeric.
 *
 * Pure: no I/O, no randomness, no time, no LLM. Deterministic for
 * identical input + kind.
 */
export function computeAmbiguity(
  input: AmbiguityInput,
  kind: AmbiguityKind = "greenfield",
): AmbiguityScore {
  if (kind !== "greenfield" && kind !== "brownfield") {
    throw new TypeError(`computeAmbiguity: unknown kind "${String(kind)}"`);
  }
  assertNonEmptyRecord(input);

  const weights = AMBIGUITY_WEIGHTS[kind];
  const breakdown: Record<string, number> = {};

  let score = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    const raw = (input as Record<string, unknown>)[dim];
    if (raw === undefined) {
      throw new TypeError(
        `computeAmbiguity: missing required dimension "${dim}" for kind="${kind}"`,
      );
    }
    if (!isFiniteNumberInUnitInterval(raw)) {
      throw new TypeError(
        `computeAmbiguity: dimension "${dim}" must be a finite number in [0, 1] (got ${String(raw)})`,
      );
    }
    const contribution = weight * (1 - raw);
    score += contribution;
    breakdown[dim] = Math.round(contribution * 1e4) / 1e4;
  }

  // Reject unknown dimensions explicitly — silently dropping them
  // would mask caller bugs (typo in dimension name).
  const allowedKeys = new Set(Object.keys(weights));
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(
        `computeAmbiguity: unknown dimension "${key}" for kind="${kind}" (allowed: ${[...allowedKeys].join(", ")})`,
      );
    }
  }

  return {
    score: Math.round(score * 1e4) / 1e4,
    breakdown: Object.freeze(breakdown),
    schemaVersion: AMBIGUITY_SCHEMA_VERSION,
    kind,
  };
}
