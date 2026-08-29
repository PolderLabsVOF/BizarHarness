/**
 * autonomy/outcome-record.test.mjs — Phase B.1 (F-194) unit tests for
 * OutcomeLearnerOutcome. Verifies:
 *   - server-stamps outcomeId (UUID) + createdAt (ISO 8601)
 *   - copies objectiveRunId + bundleId from the evidence bundle
 *   - rejects an empty posteriorUpdates array
 *   - validates every PosteriorUpdate shape (agentRole, tier, integer delta, string reason)
 *   - omits the summary key when not provided
 *   - bundleRefersTo folds to a structural equality check
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createOutcomeLearnerOutcome,
  bundleRefersTo,
} from "../../src/autonomy/outcome-record.js";
import {
  createEvidenceBundle,
  sha256Hex,
} from "../../src/autonomy/evidence-bundle.js";

const abcSha = sha256Hex("abc");

function buildBundle() {
  return createEvidenceBundle(
    {
      objectiveRunId: "00000000-0000-4000-8000-000000000002",
      command: "npm test",
      cwd: "/tmp/run",
      envDigest: sha256Hex(""),
      exitCode: 0,
      stdoutSha256: abcSha,
      stderrSha256: sha256Hex(""),
      testCounts: { total: 1, passed: 1, failed: 0, skipped: 0 },
      testReports: [
        { framework: "node:test", suite: "smoke", reportSha256: abcSha, durationMs: 1 },
      ],
      baselineRevision: "deadbeef",
      resultingRevision: "deadbeef",
      patchSha256: sha256Hex(""),
      lockfileSha256: sha256Hex(""),
      evaluatorVersion: "v1",
      evaluatorSha256: abcSha,
      rubricSha256: abcSha,
      resourceUsage: { wallClockMs: 1, peakMemoryMb: 1, costUsdMicroCents: 0, tokens: { input: 0, output: 0 } },
    },
    "secret",
  );
}

describe("outcome-record schema", () => {
  it("stamps outcomeId + createdAt and copies bundle + run ids from the evidence bundle", () => {
    const bundle = buildBundle();
    const outcome = createOutcomeLearnerOutcome({
      bundle,
      posteriorUpdates: [
        { agentRole: "implementer", tier: "mid", delta: 5, reason: "tests passed" },
      ],
      summary: "first observation",
    });
    assert.match(outcome.outcomeId, /^[0-9a-f-]{36}$/);
    assert.equal(outcome.bundleId, bundle.bundleId);
    assert.equal(outcome.objectiveRunId, bundle.objectiveRunId);
    assert.equal(outcome.summary, "first observation");
    assert.equal(typeof outcome.createdAt, "string");
    assert.equal(outcome.posteriorUpdates.length, 1);
    assert.deepEqual(outcome.posteriorUpdates[0], {
      agentRole: "implementer",
      tier: "mid",
      delta: 5,
      reason: "tests passed",
    });
  });

  it("omits the summary key when not provided", () => {
    const bundle = buildBundle();
    const outcome = createOutcomeLearnerOutcome({
      bundle,
      posteriorUpdates: [{ agentRole: "implementer", tier: "mid", delta: -2, reason: "tests failed" }],
    });
    assert.equal(outcome.summary, undefined);
    assert.equal("summary" in outcome, false);
  });

  it("rejects an empty posteriorUpdates array", () => {
    const bundle = buildBundle();
    assert.throws(
      () => createOutcomeLearnerOutcome({ bundle, posteriorUpdates: [] }),
      /posteriorUpdates must be a non-empty array/,
    );
  });

  it("rejects a non-integer delta", () => {
    const bundle = buildBundle();
    assert.throws(
      () =>
        createOutcomeLearnerOutcome({
          bundle,
          posteriorUpdates: [{ agentRole: "x", tier: "y", delta: 1.5, reason: "r" }],
        }),
      /integer delta/,
    );
  });

  it("rejects an empty agentRole / tier / non-string reason", () => {
    const bundle = buildBundle();
    assert.throws(
      () =>
        createOutcomeLearnerOutcome({
          bundle,
          posteriorUpdates: [{ agentRole: "", tier: "y", delta: 1, reason: "r" }],
        }),
      /non-empty agentRole/,
    );
    assert.throws(
      () =>
        createOutcomeLearnerOutcome({
          bundle,
          posteriorUpdates: [{ agentRole: "x", tier: "", delta: 1, reason: "r" }],
        }),
      /non-empty tier/,
    );
    assert.throws(
      () =>
        createOutcomeLearnerOutcome({
          bundle,
          posteriorUpdates: [{ agentRole: "x", tier: "y", delta: 1, reason: 7 }],
        }),
      /string reason/,
    );
  });

  it("bundleRefersTo folds to bundleId equality", () => {
    const bundle = buildBundle();
    const outcome = createOutcomeLearnerOutcome({
      bundle,
      posteriorUpdates: [{ agentRole: "x", tier: "y", delta: 0, reason: "noop" }],
    });
    assert.equal(bundleRefersTo(bundle, outcome), true);

    const other = createOutcomeLearnerOutcome({
      bundle,
      posteriorUpdates: [{ agentRole: "x", tier: "y", delta: 0, reason: "noop2" }],
    });
    assert.equal(bundleRefersTo(bundle, other), true);

    const otherBundle = buildBundle();
    assert.equal(bundleRefersTo(otherBundle, outcome), false);
  });
});
