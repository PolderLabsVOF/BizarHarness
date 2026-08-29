/**
 * autonomy/outcome-record.ts — OutcomeLearnerOutcome (Phase B.1, F-194).
 *
 * An `OutcomeLearnerOutcome` ties an `EvidenceBundle` to the posterior
 * the outcome learner derived from it. It is the durable record of
 * "the learner observed bundle X and updated the posterior for
 * agent Y / tier Z by delta D."
 *
 * The outcome record is intentionally minimal so it stays append-only
 * and easy to replay. Heavy state (the full posterior) lives in the
 * router; the outcome record carries only the delta so an auditor can
 * reconstruct the chain.
 *
 * Invariants:
 *   - `outcomeId` is server-stamped via `randomUUID()`.
 *   - `bundleId` references an existing `EvidenceBundle.bundleId`.
 *   - `createdAt` is server-stamped; caller values are ignored.
 *   - `posteriorDelta` is a 64-bit signed integer delta on the
 *     learner's posterior for `(agentRole, tier)`.
 */

import { randomUUID } from "node:crypto";
import type { EvidenceBundle } from "./evidence-bundle.js";

/**
 * Schema version of `OutcomeLearnerOutcome` (audit #84, P2 spec-sprawl reduction).
 * Bump on ANY breaking change to the schema (new required field, removed
 * field, or semantic change). Additive changes (new optional field) bump
 * the minor version.
 */
export const OUTCOME_LEARNER_SCHEMA_VERSION = "1.0.0";

/** Posterior update the learner applied for a (agent, tier) pair. */
export interface PosteriorUpdate {
  readonly agentRole: string;
  readonly tier: string;
  /** 64-bit signed integer delta applied to the posterior. */
  readonly delta: number;
  /** Reason string describing why the delta was applied. */
  readonly reason: string;
}

/** Durable record of a learner observation → posterior update. */
export interface OutcomeLearnerOutcome {
  readonly outcomeId: string;
  /** Bundle this outcome observes. */
  readonly bundleId: string;
  /** Run the bundle belongs to. */
  readonly objectiveRunId: string;
  /** Posterior updates applied to the learner. */
  readonly posteriorUpdates: ReadonlyArray<PosteriorUpdate>;
  /** Optional summary the learner emits for operator consumption. */
  readonly summary?: string;
  /** Server-stamped ISO 8601 timestamp. */
  readonly createdAt: string;
  /** Schema version that produced this record (audit #84). */
  readonly schemaVersion: string;
}

/** Build an `OutcomeLearnerOutcome` from an `EvidenceBundle`. */
export function createOutcomeLearnerOutcome({
  bundle,
  posteriorUpdates,
  summary,
}: {
  bundle: EvidenceBundle;
  posteriorUpdates: ReadonlyArray<PosteriorUpdate>;
  summary?: string;
}): OutcomeLearnerOutcome {
  if (!Array.isArray(posteriorUpdates) || posteriorUpdates.length === 0) {
    throw new TypeError("createOutcomeLearnerOutcome: posteriorUpdates must be a non-empty array");
  }
  for (const u of posteriorUpdates) {
    if (typeof u.agentRole !== "string" || u.agentRole.length === 0) {
      throw new TypeError("createOutcomeLearnerOutcome: each PosteriorUpdate requires a non-empty agentRole");
    }
    if (typeof u.tier !== "string" || u.tier.length === 0) {
      throw new TypeError("createOutcomeLearnerOutcome: each PosteriorUpdate requires a non-empty tier");
    }
    if (!Number.isInteger(u.delta)) {
      throw new TypeError("createOutcomeLearnerOutcome: each PosteriorUpdate requires an integer delta");
    }
    if (typeof u.reason !== "string") {
      throw new TypeError("createOutcomeLearnerOutcome: each PosteriorUpdate requires a string reason");
    }
  }
  return {
    outcomeId: randomUUID(),
    bundleId: bundle.bundleId,
    objectiveRunId: bundle.objectiveRunId,
    posteriorUpdates: [...posteriorUpdates],
    ...(summary ? { summary } : {}),
    schemaVersion: OUTCOME_LEARNER_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  };
}

/** Pure helper that asserts an EvidenceBundle id matches the expected one. */
export function bundleRefersTo(bundle: EvidenceBundle, outcome: OutcomeLearnerOutcome): boolean {
  return bundle.bundleId === outcome.bundleId;
}
