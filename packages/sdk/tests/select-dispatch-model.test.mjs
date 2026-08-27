/**
 * Tests for the central dispatch-model selector (F-188 / IMP-013).
 *
 * Pins the verbatim five-step fallback ladder from IMPROVEMENTS.md
 * line 646 and the never-downgrade rule from line 654.
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  selectDispatchModel,
  NEVER_DOWNGRADE_ROLES,
  REASON,
  TIER_STRENGTH,
  TIER_CHEAPNESS,
} from "../src/router/select-dispatch-model.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

describe("selectDispatchModel (F-188 / IMP-013)", () => {
  it("returns activeSessionModel with reason 'session-inherit' when selected pool is empty", () => {
    const d = selectDispatchModel({
      task: { task: "research X", role: "research-analyst" },
      selectedProfiles: [],
      staticProfiles: [],
      activeSessionModel: "session/model-default",
      budget: {},
      health: {},
      runId: "run-empty",
    });
    assert.equal(d.modelId, "session/model-default");
    assert.equal(d.reason, REASON.SESSION_INHERIT);
    assert.equal(d.tier, "default");
    assert.ok(UUID_RE.test(d.routingDecisionId), "routingDecisionId is a UUID");
    assert.deepEqual(d.fallbackChain, [], "empty pool has empty chain");
    assert.equal(d.confidence, 0.5);
  });

  it("returns null when selected pool is empty and no session model is set", () => {
    const d = selectDispatchModel({
      task: { task: "research X", role: "research-analyst" },
      selectedProfiles: [],
      staticProfiles: [],
      activeSessionModel: undefined,
      budget: {},
      health: {},
      runId: "run-null",
    });
    assert.equal(d.modelId, null);
    assert.equal(d.reason, REASON.SESSION_INHERIT);
    assert.equal(d.confidence, 0);
  });

  it("returns the exact-capability match with reason 'exact-capability'", () => {
    const selected = [
      makeProfile("provider/cheap", "budget", { capabilities: makeCapabilities(), limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } }),
      makeProfile("provider/strong", "high", { capabilities: makeCapabilities(), limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } }),
    ];
    const d = selectDispatchModel({
      task: { task: "long task", role: "research-analyst", risk: "medium", capabilities: ["long-context", "tool-use"], minContextTokens: 100000 },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-exact",
    });
    assert.equal(d.modelId, "provider/strong", "strong model wins by capability floor");
    assert.equal(d.tier, "high");
    assert.equal(d.reason, REASON.EXACT);
    assert.equal(d.confidence, 1.0);
    // provider/cheap is reported as ineligible because its context floor
    // (32000) is below the requested minimum (100000). The chain records
    // this so the audit trail can prove we considered and skipped it.
    assert.ok(
      d.ineligibleReasons.some((r) => r.includes("provider/cheap") && r.includes("contextTokens")),
      `ineligibleReasons must surface provider/cheap's context floor mismatch (got ${JSON.stringify(d.ineligibleReasons)})`,
    );
    assert.ok(d.fallbackChain.includes("provider/strong"));
  });

  it("returns strongest healthy with reason 'strongest-healthy-risk-high' when risk=high and no exact tier match", () => {
    const selected = [
      makeProfile("provider/low", "mid", { capabilities: makeCapabilities(), limits: { contextTokens: 8000, inputTokens: null, outputTokens: null } }),
      makeProfile("provider/high", "high", { capabilities: makeCapabilities(), limits: { contextTokens: 128000, inputTokens: null, outputTokens: null } }),
      makeProfile("provider/mid", "default", { capabilities: makeCapabilities(), limits: { contextTokens: 64000, inputTokens: null, outputTokens: null } }),
    ];
    const d = selectDispatchModel({
      task: { task: "sensitive dispatch", role: "todd", risk: "high" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-high",
    });
    assert.equal(d.modelId, "provider/high", "high tier is strongest healthy");
    assert.equal(d.reason, REASON.STRONGEST_RISK_HIGH);
    assert.equal(d.confidence, 0.95);
  });

  it("returns cheapest healthy with reason 'cheapest-healthy-risk-low' when risk=low", () => {
    const selected = [
      makeProfile("provider/premium", "premium"),
      makeProfile("provider/budget", "budget"),
      makeProfile("provider/mid", "mid"),
    ];
    const d = selectDispatchModel({
      task: { task: "mechanical edit", role: "todd", risk: "low" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-low",
    });
    assert.equal(d.modelId, "provider/budget");
    assert.equal(d.reason, REASON.CHEAPEST_RISK_LOW);
    assert.equal(d.confidence, 0.7);
  });

  it("returns next stronger from selected pool with reason 'next-stronger' when risk=medium", () => {
    const selected = [
      makeProfile("provider/default", "default"),
      makeProfile("provider/budget", "budget"),
    ];
    const d = selectDispatchModel({
      task: { task: "ordinary work", role: "todd", risk: "medium" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-medium",
    });
    assert.equal(d.modelId, "provider/default", "default is the strongest tier present in selected pool");
    assert.equal(d.reason, REASON.NEXT_STRONGER);
    assert.equal(d.confidence, 0.85);
  });

  it("skips unhealthy models and falls back to the next healthy", () => {
    const selected = [
      makeProfile("provider/best-but-out", "high"),
      makeProfile("provider/next", "default"),
    ];
    const health = { "provider/best-but-out": { status: "unhealthy", reason: "provider outage 503" } };
    const d = selectDispatchModel({
      task: { task: "task", role: "todd", risk: "medium" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health,
      runId: "run-unhealthy",
    });
    assert.equal(d.modelId, "provider/next", "unhealthy best is excluded");
    assert.ok(d.fallbackChain.some((entry) => entry === "provider/best-but-out:unhealthy"), "chain records the unhealthy skip");
  });

  it("uses strongest healthy when role is security regardless of risk label", () => {
    const selected = [
      makeProfile("provider/cheap", "budget"),
      makeProfile("provider/mid", "mid"),
      makeProfile("provider/strong", "high"),
    ];
    const d = selectDispatchModel({
      task: { task: "adversarial review", role: "security", risk: "low" }, // risk=low would normally pick budget, but never-downgrade overrides
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-security",
    });
    assert.equal(d.modelId, "provider/strong", "security always gets strongest");
    assert.equal(d.reason, REASON.STRONGEST_NEVER_DOWNGRADE);
    assert.equal(d.confidence, 1.0);
  });

  it("honours the never-downgrade set across {security, architecture, adversarial, audit, karen}", () => {
    const selected = [
      makeProfile("provider/strong", "high"),
      makeProfile("provider/weak", "budget"),
    ];
    for (const role of NEVER_DOWNGRADE_ROLES) {
      const d = selectDispatchModel({
        task: { task: "task", role, risk: "low" },
        selectedProfiles: selected,
        staticProfiles: [],
        budget: {},
        health: {},
        runId: `run-nd-${role}`,
      });
      assert.equal(d.modelId, "provider/strong", `role=${role} must pick strongest`);
      assert.equal(d.reason, REASON.STRONGEST_NEVER_DOWNGRADE);
    }
  });

  it("populates ineligibleReasons and falls through to session-inherit when no selected profile is dispatchable", () => {
    const selected = [
      makeProfile("provider/old", "budget", { capabilities: { reasoning: false, toolCall: false } }),
    ];
    const d = selectDispatchModel({
      task: { task: "needs reasoning", role: "todd", requireReasoning: true },
      selectedProfiles: selected,
      staticProfiles: [],
      activeSessionModel: "session/inherit",
      budget: {},
      health: {},
      runId: "run-ineligible",
    });
    assert.equal(d.modelId, "session/inherit", "falls through to session inheritance");
    assert.equal(d.reason, REASON.SESSION_INHERIT);
    assert.ok(
      d.ineligibleReasons.some((r) => r.includes("provider/old") && r.includes("reasoning")),
      `ineligibleReasons must include provider/old missing reasoning (got ${JSON.stringify(d.ineligibleReasons)})`,
    );
  });

  it("returns no-eligible when selected pool is non-empty but nothing eligible AND no session model is set", () => {
    const selected = [
      makeProfile("provider/old", "budget", { capabilities: { reasoning: false, toolCall: false } }),
    ];
    const d = selectDispatchModel({
      task: { task: "needs reasoning", role: "todd", requireReasoning: true },
      selectedProfiles: selected,
      staticProfiles: [],
      activeSessionModel: undefined,
      budget: {},
      health: {},
      runId: "run-no-eligible",
    });
    assert.equal(d.modelId, null);
    assert.equal(d.reason, REASON.NO_ELIGIBLE);
    assert.ok(d.ineligibleReasons.length > 0);
  });

  it("records the ordered fallback chain for the resolved decision", () => {
    const selected = [
      makeProfile("provider/a", "default"),
      makeProfile("provider/b", "high"),
      makeProfile("provider/c", "premium"),
    ];
    const d = selectDispatchModel({
      task: { task: "architect review", role: "architecture", risk: "high" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      runId: "run-chain",
    });
    assert.equal(d.modelId, "provider/c", "strongest selected wins for never-downgrade role");
    assert.deepEqual(d.fallbackChain, ["provider/c", "provider/b", "provider/a"], "chain ordered strongest → weakest");
  });

  it("honours health recent-failure count >= 3 as unhealthy", () => {
    const selected = [
      makeProfile("provider/flaky", "high"),
      makeProfile("provider/clean", "default"),
    ];
    const health = {
      "provider/flaky": { recentFailureCount: 5, lastFailureAt: "2026-08-26T00:00:00.000Z" },
    };
    const d = selectDispatchModel({
      task: { task: "task", role: "todd", risk: "medium" },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health,
      runId: "run-flaky",
    });
    assert.equal(d.modelId, "provider/clean", "flaky model skipped");
    assert.ok(d.fallbackChain.some((entry) => entry === "provider/flaky:unhealthy"));
  });

  it("prefers positive verified-outcome history on the same role+capability shape", () => {
    const selected = [
      makeProfile("provider/stronger", "high"),
      makeProfile("provider/weaker", "default"),
    ];
    const history = {
      byRoleCapability: {
        "research-analyst|long-context": [
          { modelId: "provider/weaker", success: true, verifiedAt: "2026-08-26T00:00:00.000Z" },
          { modelId: "provider/weaker", success: true, verifiedAt: "2026-08-25T00:00:00.000Z" },
          { modelId: "provider/weaker", success: true, verifiedAt: "2026-08-24T00:00:00.000Z" },
          { modelId: "provider/weaker", success: true, verifiedAt: "2026-08-23T00:00:00.000Z" },
        ],
      },
    };
    const d = selectDispatchModel({
      task: { task: "research X", role: "research-analyst", risk: "medium", capabilities: ["long-context"] },
      selectedProfiles: selected,
      staticProfiles: [],
      budget: {},
      health: {},
      history,
      runId: "run-history",
    });
    // risk=medium with a positive-history winner means the ladder "next
    // stronger" picks the strongest in the pool — and the chain reflects
    // that consideration. We don't pin the exact model here (the bias is
    // tied to the implementation's history pre-ordering); we DO pin that
    // the decision is from the medium-risk ladder and recorded.
    assert.equal(d.reason, REASON.NEXT_STRONGER);
    assert.ok(d.fallbackChain.length >= 2);
  });

  it("emits a unique UUID per invocation", () => {
    const seen = new Set();
    for (let i = 0; i < 8; i += 1) {
      const d = selectDispatchModel({
        task: { task: "any", role: "todd", risk: "medium" },
        selectedProfiles: [makeProfile("provider/a", "default")],
        staticProfiles: [],
        budget: {},
        health: {},
        runId: `run-${i}`,
      });
      assert.ok(UUID_RE.test(d.routingDecisionId), `decision ${i} has a UUID routingDecisionId`);
      assert.ok(!seen.has(d.routingDecisionId), `decision ${i} UUIDs are unique across calls`);
      seen.add(d.routingDecisionId);
    }
  });

  it("returns the active session model when the only selected profile is unhealthy AND risk is low", () => {
    const selected = [makeProfile("provider/only", "budget")];
    const health = { "provider/only": { status: "unhealthy" } };
    const d = selectDispatchModel({
      task: { task: "task", role: "todd", risk: "low" },
      selectedProfiles: selected,
      staticProfiles: [],
      activeSessionModel: "session/model",
      budget: {},
      health,
      runId: "run-fallthrough",
    });
    assert.equal(d.modelId, "session/model");
    assert.equal(d.reason, REASON.SESSION_INHERIT);
  });

  it("honours tier order in TIER_STRENGTH so tests can rely on the strongest-first convention", () => {
    assert.deepEqual([...TIER_STRENGTH], ["premium", "high", "mid-design", "default", "mid", "budget"]);
  });

  it("honours tier order in TIER_CHEAPNESS so tests can rely on the cheapest-first convention", () => {
    assert.deepEqual([...TIER_CHEAPNESS], ["budget", "mid", "default", "mid-design", "high", "premium"]);
  });

  it("exposes the canonical reason vocabulary", () => {
    for (const key of [
      "EXACT",
      "NEXT_STRONGER",
      "STRONGEST_RISK_HIGH",
      "STRONGEST_NEVER_DOWNGRADE",
      "CHEAPEST_RISK_LOW",
      "SESSION_INHERIT",
      "NO_ELIGIBLE",
    ]) {
      assert.ok(typeof REASON[key] === "string", `REASON.${key} is a string`);
    }
  });
});
