/**
 * autonomy/objective-run.ts — Typed ObjectiveRun schema (Phase B.1, F-194).
 *
 * An `ObjectiveRun` is the canonical, typed record of a single autonomous
 * task dispatch. It captures the goal, the constraints (allowed side
 * effects, forbidden paths, budget), the current phase, and the immutable
 * evaluator version so future readers can replay the run against the
 * exact rubric that scored it.
 *
 * Why this is a separate type (not embedded in `EvidenceBundle`):
 *   - The `ObjectiveRun` is the *intent*: it is created before any
 *     evidence is collected. The bundle is the *observation* that fills
 *     the run in.
 *   - Operators may inspect a queued or in-flight run before any
 *     evidence exists; that requires a type that does not depend on
 *     `EvidenceBundle`.
 *   - Phase transitions (`planning` → `executing` → `verifying` →
 *     `done` | `failed` | `cancelled`) are part of the run, not the
 *     bundle.
 *
 * Invariants:
 *   - `objectiveRunId` is a UUID v4 string generated server-side via
 *     `newObjectiveRunId()`. Callers MUST NOT supply one.
 *   - `createdAt` is stamped server-side; caller values are ignored.
 *   - `evaluatorVersion` is required so the rubric that scored the run
 *     is unambiguous at replay time.
 *   - `budget` is in USD micro-cents (`uSD`) to avoid floating-point drift.
 */

import { randomUUID } from "node:crypto";

/** Lifecycle phases of an `ObjectiveRun`. */
export type ObjectiveRunPhase =
  | "planning"
  | "executing"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";

/** Runtime array of `ObjectiveRunPhase` values — kept in lock-step with the
 * type union above so JS callers and drift-guard tests can compare against
 * the same canonical list. The audit calls out drift between the typed
 * schema and the scheduler's runtime guards as a regression source. */
export const OBJECTIVE_PHASES = Object.freeze([
  "planning",
  "executing",
  "verifying",
  "done",
  "failed",
  "cancelled",
] as const) satisfies ReadonlyArray<ObjectiveRunPhase>;

/** Terminal vs. in-flight status of an `ObjectiveRun`. */
export type ObjectiveRunStatus = "active" | "succeeded" | "failed" | "cancelled";

/** Runtime array of `ObjectiveRunStatus` values. See `OBJECTIVE_PHASES`. */
export const OBJECTIVE_STATUSES = Object.freeze([
  "active",
  "succeeded",
  "failed",
  "cancelled",
] as const) satisfies ReadonlyArray<ObjectiveRunStatus>;

/** A single side effect the run is allowed to perform. */
export interface AllowedSideEffect {
  /** Side-effect class (e.g. `Bash`, `Edit`, `Write`). */
  readonly kind: string;
  /** Optional narrower matcher (e.g. a glob or command prefix). */
  readonly matcher?: string;
}

/** Budget in USD micro-cents (1 USD = 1_000_000 uSD). */
export interface Budget {
  readonly usd: number;
  /** Optional wall-clock cap in seconds; `undefined` means unbounded. */
  readonly wallClockSeconds?: number;
}

/** Constraint envelope that gates an `ObjectiveRun`. */
export interface ObjectiveRunConstraints {
  /** Allow-list of side effects the run may invoke. */
  readonly allowedSideEffects: ReadonlyArray<AllowedSideEffect>;
  /** Absolute or relative paths the run MUST NOT touch. */
  readonly forbiddenPaths: ReadonlyArray<string>;
  /** Hard budget for the run; the orchestrator halts on overrun. */
  readonly budget: Budget;
}

/** The typed record of a single autonomous task dispatch. */
export interface ObjectiveRun {
  readonly objectiveRunId: string;
  /** Free-form goal string supplied by the orchestrator. */
  readonly goal: string;
  /** Optional repo-relative scope the run is constrained to. */
  readonly scope?: string;
  /** Constraints gating the run. */
  readonly constraints: ObjectiveRunConstraints;
  /** Current phase. */
  readonly phase: ObjectiveRunPhase;
  /** Current status. */
  readonly status: ObjectiveRunStatus;
  /** Rubric version that scored this run; required for replay parity. */
  readonly evaluatorVersion: string;
  /** Server-stamped ISO 8601 creation timestamp. */
  readonly createdAt: string;
  /** Server-stamped ISO 8601 last-update timestamp. */
  readonly updatedAt: string;
}

/** Generate a new server-side `objectiveRunId`. */
export function newObjectiveRunId(): string {
  return randomUUID();
}

/**
 * Create a new `ObjectiveRun`. Server-stamps `objectiveRunId`, the
 * timestamps, and the initial phase/status. The caller MUST supply
 * `goal`, `constraints`, and `evaluatorVersion`.
 */
export function createObjectiveRun({
  goal,
  scope,
  allowedSideEffects,
  forbiddenPaths,
  budget,
  evaluatorVersion,
}: {
  goal: string;
  scope?: string;
  allowedSideEffects: ReadonlyArray<AllowedSideEffect>;
  forbiddenPaths: ReadonlyArray<string>;
  budget: Budget;
  evaluatorVersion: string;
}): ObjectiveRun {
  if (typeof goal !== "string" || goal.length === 0) {
    throw new TypeError("createObjectiveRun: goal must be a non-empty string");
  }
  if (typeof evaluatorVersion !== "string" || evaluatorVersion.length === 0) {
    throw new TypeError("createObjectiveRun: evaluatorVersion must be a non-empty string");
  }
  if (!Number.isInteger(budget.usd) || budget.usd < 0) {
    throw new TypeError("createObjectiveRun: budget.usd must be a non-negative integer micro-cent count");
  }
  const now = new Date().toISOString();
  return {
    objectiveRunId: newObjectiveRunId(),
    goal,
    ...(scope ? { scope } : {}),
    constraints: {
      allowedSideEffects: [...allowedSideEffects],
      forbiddenPaths: [...forbiddenPaths],
      budget: { usd: budget.usd, ...(budget.wallClockSeconds !== undefined ? { wallClockSeconds: budget.wallClockSeconds } : {}) },
    },
    phase: "planning",
    status: "active",
    evaluatorVersion,
    createdAt: now,
    updatedAt: now,
  };
}
