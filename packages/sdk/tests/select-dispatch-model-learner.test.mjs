/**
 * Tests for IMP-020 / F-192 selector-learner wiring.
 *
 * Drives `selectDispatchModel` with a real `InMemoryOutcomeLearner` and
 * asserts the four acceptance invariants from the IMPROVEMENTS.md spec:
 *
 *   1. Ranking input from the learner changes the selection when a
 *      non-greedy candidate has higher posterior.
 *   2. Quarantined model is skipped even if it has the strongest prior.
 *   3. NEVER_DOWNGRADE_ROLES ignore the learner ranking.
 *   4. Sequential `record(signal)` updates the next call's ranking.
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";

import { selectDispatchModel, REASON, NEVER_DOWNGRADE_ROLES } from "../src/router/select-dispatch-model.ts";
import { createInMemoryOutcomeLearner, newRoutingDecisionId } from "../src/router/outcome-learner.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeProfile(id, tier, profile) {
  return { id, tier, profile };
}

function makeCapabilities(overrides = {}) {
  return {
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    attachment: true,
    temperature: true,
    ...overrides,
  };
}

function baseTask(over = {}) {
  return {
    task: "implement X",
    role: "implementer",
    phase: "implement",
    risk: "medium",
    capabilities: ["tool-use"],
    languageTag: "ts",
    ...over,
  };
}

function recordSuccess(learner, modelId, tier, role = "implementer", status = "success") {
  learner.record({
    routingDecisionId: newRoutingDecisionId(),
    modelId,
    // Match the selector's modelToContextKey shape exactly so the
    // bucket key resolves to the same hash. The selector only sets
    // `provider` when the candidate has a `discriminatedProfile.provider`
    // and only sets `contextSizeBucket` when `minContextTokens` is
    // provided; tests don't supply either, so both stay undefined.
    taskKey: {
      modelId,
      tier,
      role,
      phase: "implement",
      capability: "tool-use",
      riskLevel: "medium",
      languageTag: "ts",
    },
    status,
    verifiedBy: "auto-verifier",
    capturedAt: new Date().toISOString(),
  });
}

describe("selectDispatchModel + learner — acceptance gate", () => {
  it("re-ranking via learner changes the selection when non-greedy candidate has higher posterior", () => {
    const learner = createInMemoryOutcomeLearner();
    // Pool has two healthy candidates; we train the cheaper tier to
    // be the stronger performer so the learner should promote it.
    // Sonnet: 2 successes, 5 failures (mean ≈ 0.286).
    for (let i = 0; i < 2; i++) recordSuccess(learner, "anthropic/claude-3-5-sonnet", "high", "implementer");
    for (let i = 0; i < 5; i++) recordSuccess(learner, "anthropic/claude-3-5-sonnet", "high", "implementer", "failure");
    // Haiku: 6 successes, 0 failures (mean = 1).
    for (let i = 0; i < 6; i++) recordSuccess(learner, "anthropic/claude-haiku", "default", "implementer");
    const d = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
        makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-learner-1",
      outcomeLearner: learner,
    });
    expect(d.modelId).toBe("anthropic/claude-haiku");
    // The learner's ranking did the override.
    assert.ok(["next-stronger", "exact-capability"].includes(d.reason), `unexpected reason: ${d.reason}`);
  });

  it("without learner the same pool picks the tier-stronger model (control)", () => {
    const d = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
        makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-learner-control",
    });
    expect(d.modelId).toBe("anthropic/claude-3-5-sonnet");
  });

  it("quarantined model is skipped even if it has the strongest prior", () => {
    const learner = createInMemoryOutcomeLearner();
    // Quarantine claude-3-5 with 3 strikes.
    for (const status of ["transport", "auth", "rate-limit"]) {
      learner.record({
        routingDecisionId: newRoutingDecisionId(),
        modelId: "anthropic/claude-3-5-sonnet",
        taskKey: { modelId: "anthropic/claude-3-5-sonnet", tier: "high", role: "implementer" },
        status,
        verifiedBy: "auto-verifier",
        capturedAt: new Date().toISOString(),
      });
    }
    expect(learner.isQuarantined("anthropic/claude-3-5-sonnet")).toBe(true);
    const d = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
        makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-quarantine",
      outcomeLearner: learner,
    });
    expect(d.modelId).toBe("anthropic/claude-haiku");
    expect(d.fallbackChain.some((entry) => entry.includes("claude-3-5-sonnet:quarantined"))).toBe(true);
  });

  it("NEVER_DOWNGRADE_ROLES ignore the learner ranking", () => {
    const learner = createInMemoryOutcomeLearner();
    // Train the budget-tier haiku to be the proven winner.
    for (let i = 0; i < 10; i++) recordSuccess(learner, "anthropic/claude-haiku", "default", "security");
    // Train opus to be a proven loser (plain 'failure' to avoid quarantine).
    for (let i = 0; i < 10; i++) {
      learner.record({
        routingDecisionId: newRoutingDecisionId(),
        modelId: "anthropic/claude-opus",
        taskKey: { modelId: "anthropic/claude-opus", tier: "premium", role: "security" },
        status: "failure",
        verifiedBy: "auto-verifier",
        capturedAt: new Date().toISOString(),
      });
    }
    for (const role of NEVER_DOWNGRADE_ROLES) {
      const d = selectDispatchModel({
        task: baseTask({ role }),
        selectedProfiles: [
          makeProfile("anthropic/claude-opus", "premium", makeCapabilities()),
          makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
        ],
        staticProfiles: [],
        activeSessionModel: "anthropic/claude-opus",
        budget: {},
        health: {},
        runId: `run-${role}`,
        outcomeLearner: learner,
      });
      // Always the strongest tier regardless of learner ranking.
      expect(d.modelId, `${role} should pin to strongest tier`).toBe("anthropic/claude-opus");
      expect(d.reason).toBe(REASON.STRONGEST_NEVER_DOWNGRADE);
    }
  });

  it("sequential record() updates the next call's ranking", () => {
    const learner = createInMemoryOutcomeLearner();
    // Initial call: equal evidence, tier-strength wins.
    const d1 = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
        makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-seq-1",
      outcomeLearner: learner,
    });
    expect(d1.modelId).toBe("anthropic/claude-3-5-sonnet");
    expect(UUID_RE.test(d1.routingDecisionId)).toBe(true);
    // Now train haiku aggressively (10 successes, 0 failures) so its
    // posterior mean dominates sonnet's default (1.0) tie.
    for (let i = 0; i < 10; i++) recordSuccess(learner, "anthropic/claude-haiku", "default", "implementer");
    // Also record some sonnet failures so its mean is lower than haiku's.
    for (let i = 0; i < 3; i++) {
      learner.record({
        routingDecisionId: newRoutingDecisionId(),
        modelId: "anthropic/claude-3-5-sonnet",
        taskKey: { modelId: "anthropic/claude-3-5-sonnet", tier: "high", role: "implementer", phase: "implement", capability: "tool-use", riskLevel: "medium", provider: "anthropic", languageTag: "ts", contextSizeBucket: "medium" },
        status: "failure",
        verifiedBy: "auto-verifier",
        capturedAt: new Date().toISOString(),
      });
    }
    const d2 = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
        makeProfile("anthropic/claude-haiku", "default", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-seq-2",
      outcomeLearner: learner,
    });
    expect(d2.modelId).toBe("anthropic/claude-haiku");
    expect(d2.routingDecisionId).not.toBe(d1.routingDecisionId);
  });

  it("learner is optional — selector still works without one", () => {
    const d = selectDispatchModel({
      task: baseTask(),
      selectedProfiles: [
        makeProfile("anthropic/claude-3-5-sonnet", "high", makeCapabilities()),
      ],
      staticProfiles: [],
      activeSessionModel: "anthropic/claude-3-5-sonnet",
      budget: {},
      health: {},
      runId: "run-no-learner",
    });
    expect(d.modelId).toBe("anthropic/claude-3-5-sonnet");
  });
});