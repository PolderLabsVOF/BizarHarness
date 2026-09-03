/**
 * specs/deep-interview.test.ts — Unit tests for the deep-interview spec.
 *
 * Verifies:
 *   - Depth-profile round cap (quick=3, standard=7, deep=12)
 *   - Closure forces nonGoals + decisionBoundaries to be present
 *   - Terminology-ledger round-trip (read-back matches write-in)
 *   - Ambiguity score integration via `closeInterview`
 *   - Malformed inputs throw `TypeError`
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  DEEP_INTERVIEW_SCHEMA_VERSION,
  DEEP_INTERVIEW_MAX_ROUNDS,
  closeInterview,
} from "../../src/specs/deep-interview.js";

const baseInput = () => ({
  slug: "f-202-omx-phase1",
  title: "OMX Phase 1 scaffolding",
  depth: "deep" as const,
  kind: "greenfield" as const,
  rounds: 5,
  clarityBreakdown: {
    intent: 0.8,
    outcome: 0.7,
    scope: 0.6,
    constraints: 0.5,
    success: 0.9,
    context: 0.4,
  },
  findings: [],
  terminologyLedger: [],
  now: new Date("2026-09-03T12:00:00.000Z"),
});

describe("DEEP_INTERVIEW_SCHEMA_VERSION", () => {
  it("is a semver string", () => {
    assert.match(DEEP_INTERVIEW_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe("DEEP_INTERVIEW_MAX_ROUNDS", () => {
  it("quick caps at 3", () => {
    assert.equal(DEEP_INTERVIEW_MAX_ROUNDS.quick, 3);
  });

  it("standard caps at 7", () => {
    assert.equal(DEEP_INTERVIEW_MAX_ROUNDS.standard, 7);
  });

  it("deep caps at 12", () => {
    assert.equal(DEEP_INTERVIEW_MAX_ROUNDS.deep, 12);
  });
});

describe("closeInterview — depth-profile round cap", () => {
  it("caps quick depth at 3 even when rounds supplied is 99", () => {
    const spec = closeInterview({ ...baseInput(), depth: "quick", rounds: 99 });
    assert.equal(spec.depth, "quick");
    assert.equal(spec.maxRounds, 3);
    assert.equal(spec.rounds, 3);
  });

  it("caps standard depth at 7", () => {
    const spec = closeInterview({ ...baseInput(), depth: "standard", rounds: 99 });
    assert.equal(spec.rounds, 7);
    assert.equal(spec.maxRounds, 7);
  });

  it("caps deep depth at 12", () => {
    const spec = closeInterview({ ...baseInput(), depth: "deep", rounds: 99 });
    assert.equal(spec.rounds, 12);
    assert.equal(spec.maxRounds, 12);
  });

  it("preserves rounds under the cap", () => {
    const spec = closeInterview({ ...baseInput(), depth: "standard", rounds: 4 });
    assert.equal(spec.rounds, 4);
  });

  it("clamps negative rounds to 0", () => {
    const spec = closeInterview({ ...baseInput(), depth: "deep", rounds: -3 });
    assert.equal(spec.rounds, 0);
  });
});

describe("closeInterview — closure forces nonGoals + decisionBoundaries", () => {
  it("treats omitted nonGoals as empty list", () => {
    const spec = closeInterview(baseInput());
    assert.ok(Array.isArray(spec.nonGoals));
    assert.equal(spec.nonGoals.length, 0);
  });

  it("treats omitted decisionBoundaries as empty list", () => {
    const spec = closeInterview(baseInput());
    assert.ok(Array.isArray(spec.decisionBoundaries));
    assert.equal(spec.decisionBoundaries.length, 0);
  });

  it("preserves supplied nonGoals verbatim", () => {
    const spec = closeInterview({ ...baseInput(), nonGoals: ["out of scope: A", "out of scope: B"] });
    assert.deepEqual([...spec.nonGoals], ["out of scope: A", "out of scope: B"]);
  });
});

describe("closeInterview — terminology ledger round-trip", () => {
  it("round-trips an empty ledger", () => {
    const spec = closeInterview(baseInput());
    assert.deepEqual([...spec.terminologyLedger], []);
  });

  it("round-trips a populated ledger in order", () => {
    const ledger = [
      { term: "phase", meaning: "current step in the lifecycle", committedAt: "2026-09-03T11:00:00.000Z" },
      { term: "lifecycle", meaning: "ordered set of phases", committedAt: "2026-09-03T11:05:00.000Z" },
    ];
    const spec = closeInterview({ ...baseInput(), terminologyLedger: ledger });
    assert.deepEqual([...spec.terminologyLedger], ledger);
  });
});

describe("closeInterview — ambiguity score integration", () => {
  it("embeds the score computed from clarityBreakdown", () => {
    const spec = closeInterview(baseInput());
    assert.equal(spec.ambiguity.kind, "greenfield");
    // Post-v2.0.0 the score is `Σ w_i · (1 − clarity_i)` (low-is-good
    // ambiguity). Re-derive it from the base fixture to confirm wiring.
    const expected =
      0.20 * (1 - 0.8) +
      0.20 * (1 - 0.7) +
      0.15 * (1 - 0.6) +
      0.15 * (1 - 0.5) +
      0.15 * (1 - 0.9) +
      0.15 * (1 - 0.4);
    assert.equal(spec.ambiguity.score, Math.round(expected * 1e4) / 1e4);
  });

  it("uses brownfield weights when kind=brownfield", () => {
    const spec = closeInterview({ ...baseInput(), kind: "brownfield" });
    assert.equal(spec.ambiguity.kind, "brownfield");
    assert.ok(spec.ambiguity.score >= 0 && spec.ambiguity.score <= 1);
  });

  it("stamps schemaVersion + closedAt", () => {
    const spec = closeInterview(baseInput());
    assert.equal(spec.schemaVersion, DEEP_INTERVIEW_SCHEMA_VERSION);
    assert.equal(spec.closedAt, "2026-09-03T12:00:00.000Z");
  });
});

describe("closeInterview — malformed input", () => {
  it("rejects an empty slug", () => {
    assert.throws(() => closeInterview({ ...baseInput(), slug: "" }), /slug must be a non-empty string/);
  });

  it("rejects an empty title", () => {
    assert.throws(() => closeInterview({ ...baseInput(), title: "" }), /title must be a non-empty string/);
  });

  it("rejects an unknown depth", () => {
    assert.throws(() => closeInterview({ ...baseInput(), depth: "shallow" as never }), /unknown depth/);
  });

  it("rejects an unknown kind", () => {
    assert.throws(() => closeInterview({ ...baseInput(), kind: "bluefield" as never }), /unknown kind/);
  });

  it("rejects a clarityBreakdown with out-of-range value", () => {
    assert.throws(
      () => closeInterview({ ...baseInput(), clarityBreakdown: { ...baseInput().clarityBreakdown, intent: 1.5 } }),
      /clarityBreakdown is invalid/,
    );
  });

  it("rejects a non-array findings list", () => {
    assert.throws(
      () => closeInterview({ ...baseInput(), findings: "nope" as never }),
      /findings must be an array/,
    );
  });
});
