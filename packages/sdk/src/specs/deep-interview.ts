/**
 * specs/deep-interview.ts — Typed deep-interview spec artifact
 * (F-204, Phase 1 OMX adoption).
 *
 * A `DeepInterviewSpec` is the durable artifact produced by a
 * `/deep-interview` Socratic loop. The interview runs for a bounded
 * number of rounds (a `depth` profile) and produces:
 *   - a `ClarityBreakdown` — per-dimension clarity scores;
 *   - one or more `PressureFinding` records — the Socratic pressure
 *     ladder's catch-list, what the loop exposed and tried to
 *     de-risk;
 *   - a `TerminologyLedger` — every contested term and the meaning
 *     the operator committed to.
 *
 * `closeInterview(spec)` is the terminal step: it (a) terminates at
 * the depth-profile cap (never beyond), (b) forces `nonGoals` and
 * `decisionBoundaries` to be explicit lists even if empty, and
 * (c) stamps the final `AmbiguityScore` computed from
 * `clarityBreakdown`.
 *
 * The spec round-trips through JSON; every field is `readonly`.
 */

import {
  AMBIGUITY_SCHEMA_VERSION,
  AMBIGUITY_WEIGHTS,
  type AmbiguityKind,
  type AmbiguityScore,
  computeAmbiguity,
} from "../ambiguity/score.js";

export const DEEP_INTERVIEW_SCHEMA_VERSION = "1.0.0" as const;

/** Bounded round counts per depth profile. */
export type DeepInterviewDepth = "quick" | "standard" | "deep";

export const DEEP_INTERVIEW_MAX_ROUNDS: Readonly<Record<DeepInterviewDepth, number>> = Object.freeze({
  quick: 3,
  standard: 7,
  deep: 12,
});

/** Per-dimension clarity values in `[0, 1]`. Keys mirror the
 *  ambiguity-weight-set dimensions for the chosen `kind`. */
export interface ClarityBreakdown {
  readonly intent: number;
  readonly outcome: number;
  readonly scope: number;
  readonly constraints: number;
  readonly success: number;
  readonly context: number;
}

/** A single finding from the Socratic pressure ladder. */
export interface PressureFinding {
  /** Stable identifier (slug) for the finding. */
  readonly id: string;
  /** One-line summary the operator can scan. */
  readonly summary: string;
  /** The dimension the finding maps to. */
  readonly dimension: keyof ClarityBreakdown;
  /** The lever the loop applied to expose or de-risk the issue. */
  readonly lever: "pre_mortem" | "inversion" | "second_order" | "steel_man" | "dialectic" | "concrete";
  /** ISO 8601 timestamp the finding was recorded. */
  readonly recordedAt: string;
  /** Optional resolution note. */
  readonly resolution?: string;
}

/** One entry in the terminology ledger. */
export interface TerminologyLedgerEntry {
  readonly term: string;
  readonly meaning: string;
  /** ISO 8601 timestamp the operator committed to the meaning. */
  readonly committedAt: string;
}

export type TerminologyLedger = ReadonlyArray<TerminologyLedgerEntry>;

/** Operator-facing artifact persisted at `docs/specs/deep-interview-<slug>.md`. */
export interface DeepInterviewSpec {
  readonly schemaVersion: typeof DEEP_INTERVIEW_SCHEMA_VERSION;
  readonly slug: string;
  readonly title: string;
  readonly depth: DeepInterviewDepth;
  readonly kind: AmbiguityKind;
  /** Maximum rounds permitted by `depth`. */
  readonly maxRounds: number;
  /** Number of rounds actually run. Capped at `maxRounds` by `closeInterview`. */
  readonly rounds: number;
  readonly clarityBreakdown: ClarityBreakdown;
  readonly findings: ReadonlyArray<PressureFinding>;
  readonly terminologyLedger: TerminologyLedger;
  /** Explicit list of out-of-scope items. `closeInterview` guarantees this is present. */
  readonly nonGoals: ReadonlyArray<string>;
  /** Explicit decision boundaries — what's locked vs negotiable. */
  readonly decisionBoundaries: ReadonlyArray<string>;
  /** Computed once at closure; reflects the final `clarityBreakdown`. */
  readonly ambiguity: AmbiguityScore;
  /** ISO 8601 stamp `closeInterview` was invoked. */
  readonly closedAt?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClarityBreakdown(value: unknown): value is ClarityBreakdown {
  if (!isPlainRecord(value)) return false;
  const keys: ReadonlyArray<keyof ClarityBreakdown> = [
    "intent",
    "outcome",
    "scope",
    "constraints",
    "success",
    "context",
  ];
  return keys.every((k) => typeof value[k] === "number" && Number.isFinite(value[k]) && (value[k] as number) >= 0 && (value[k] as number) <= 1);
}

function clampRoundsToDepthProfile(rounds: number, depth: DeepInterviewDepth): number {
  if (!Number.isFinite(rounds) || rounds < 0) return 0;
  const max = DEEP_INTERVIEW_MAX_ROUNDS[depth];
  return Math.min(Math.floor(rounds), max);
}

function ensureStringList(value: unknown, name: string): ReadonlyArray<string> {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError(`DeepInterviewSpec: ${name} must be an array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new TypeError(`DeepInterviewSpec: ${name} entries must be strings`);
    }
  }
  return Object.freeze([...value]);
}

/**
 * Build the typed `DeepInterviewSpec` and finalize it for
 * persistence. Closure guarantees:
 *   - `rounds` is capped at the depth-profile maximum (never exceeds
 *     `DEEP_INTERVIEW_MAX_ROUNDS[depth]`);
 *   - `nonGoals` and `decisionBoundaries` are explicit arrays
 *     (empty arrays are accepted; missing is coerced to empty);
 *   - `ambiguity` is computed from the supplied `clarityBreakdown`
 *     and the chosen `kind`.
 *
 * Throws `TypeError` on malformed input.
 */
export function closeInterview(input: {
  slug: string;
  title: string;
  depth: DeepInterviewDepth;
  kind: AmbiguityKind;
  rounds: number;
  clarityBreakdown: ClarityBreakdown;
  findings: ReadonlyArray<PressureFinding>;
  terminologyLedger: TerminologyLedger;
  nonGoals?: ReadonlyArray<string>;
  decisionBoundaries?: ReadonlyArray<string>;
  now?: Date;
}): DeepInterviewSpec {
  if (typeof input.slug !== "string" || input.slug.trim().length === 0) {
    throw new TypeError("closeInterview: slug must be a non-empty string");
  }
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    throw new TypeError("closeInterview: title must be a non-empty string");
  }
  if (input.depth !== "quick" && input.depth !== "standard" && input.depth !== "deep") {
    throw new TypeError(`closeInterview: unknown depth "${String(input.depth)}"`);
  }
  if (input.kind !== "greenfield" && input.kind !== "brownfield") {
    throw new TypeError(`closeInterview: unknown kind "${String(input.kind)}"`);
  }
  if (!isClarityBreakdown(input.clarityBreakdown)) {
    throw new TypeError("closeInterview: clarityBreakdown is invalid (every dimension must be a finite number in [0, 1])");
  }
  if (!Array.isArray(input.findings)) {
    throw new TypeError("closeInterview: findings must be an array");
  }
  if (!Array.isArray(input.terminologyLedger)) {
    throw new TypeError("closeInterview: terminologyLedger must be an array");
  }

  const rounds = clampRoundsToDepthProfile(input.rounds, input.depth);

  // The clarity breakdown has all six dimension keys by type, but
  // brownfield does not score `context` (it is greenfield-only).
  // Filter the breakdown to the dimensions the chosen weight set
  // actually consumes so the strict dimension validator in
  // `computeAmbiguity` does not fire for the irrelevant key.
  const weightKeys = Object.keys(AMBIGUITY_WEIGHTS[input.kind]);
  const breakdownForScore: Record<string, number> = {};
  for (const key of weightKeys) {
    breakdownForScore[key] = (input.clarityBreakdown as unknown as Record<string, number>)[key];
  }
  const ambiguity = computeAmbiguity(breakdownForScore, input.kind);

  // Closure forces explicit non-goals + decision boundaries.
  const nonGoals = ensureStringList(input.nonGoals, "nonGoals");
  const decisionBoundaries = ensureStringList(input.decisionBoundaries, "decisionBoundaries");

  const now = (input.now ?? new Date()).toISOString();

  return Object.freeze({
    schemaVersion: DEEP_INTERVIEW_SCHEMA_VERSION,
    slug: input.slug,
    title: input.title,
    depth: input.depth,
    kind: input.kind,
    maxRounds: DEEP_INTERVIEW_MAX_ROUNDS[input.depth],
    rounds,
    clarityBreakdown: Object.freeze({ ...input.clarityBreakdown }),
    findings: Object.freeze([...input.findings]),
    terminologyLedger: Object.freeze([...input.terminologyLedger]),
    nonGoals,
    decisionBoundaries,
    ambiguity: Object.freeze(ambiguity),
    closedAt: now,
  });
}

/** Re-export the ambiguity schema version so consumers that already
 *  import from `specs/deep-interview` get a single import. */
export { AMBIGUITY_SCHEMA_VERSION };
