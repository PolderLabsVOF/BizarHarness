/**
 * Integration test: drive `decideAgentWith` end-to-end through the F-188
 * central selector and assert the `routingDecisionId` round-trips into
 * `RouteDecisionOutput` (F-185 audit trail contract).
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { decideAgentWith, ModelRouter, QLearningRouter } from "../src/router/index.ts";
import { REASON } from "../src/router/select-dispatch-model.ts";

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

describe("decideAgentWith → selectDispatchModel integration (F-188 / IMP-013)", () => {
  it("threads routingDecisionId + modelId + selectorReason into RouteDecisionOutput", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const selectedProfiles = [
      makeProfile("provider/strong", "high", { capabilities: makeCapabilities(), limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } }),
      makeProfile("provider/cheap", "budget", { capabilities: makeCapabilities(), limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } }),
    ];
    const out = decideAgentWith(mr, qr, {
      task: "research the F-188 selector end-to-end",
      role: "research-analyst",
      risk: "medium",
      capabilities: ["long-context"],
      selectedProfiles,
      activeSessionModel: "session/default",
      runId: "integration-1",
    });
    assert.equal(out.modelId, "provider/strong", "strongest selected wins for medium risk with capabilities set");
    assert.equal(out.modelTier, "high");
    assert.ok(UUID_RE.test(out.routingDecisionId), "routingDecisionId is a UUID");
    assert.equal(out.selectorReason, REASON.EXACT);
    assert.equal(out.codemodIntent, null);
    // Agent pick came from Q-learning (the selector does not pick agents).
    assert.equal(typeof out.agent, "string");
    assert.ok(out.surfacedTags.some((t) => t.startsWith("[TASK_MODEL_RECOMMENDATION]")), "selector surfaces the tier tag");
  });

  it("mints a routingDecisionId even on the legacy bandit chain (no role + profiles)", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const out = decideAgentWith(mr, qr, { task: "ordinary task" });
    assert.ok(UUID_RE.test(out.routingDecisionId));
    assert.equal(out.modelId, null, "legacy chain does not resolve a modelId");
    assert.equal(out.selectorReason, null, "legacy chain does not invoke the selector");
  });

  it("falls through to session-inherit when only activeSessionModel is supplied", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const out = decideAgentWith(mr, qr, {
      task: "task with no selected pool",
      role: "todd",
      risk: "medium",
      activeSessionModel: "session/inherit",
      runId: "integration-session",
    });
    assert.equal(out.modelId, "session/inherit", "empty selected pool ⇒ session inheritance");
    assert.equal(out.selectorReason, REASON.SESSION_INHERIT);
    assert.ok(UUID_RE.test(out.routingDecisionId));
  });

  it("never-downgrade rule fires for role=security", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const selectedProfiles = [
      makeProfile("provider/cheap", "budget"),
      makeProfile("provider/strong", "high"),
    ];
    const out = decideAgentWith(mr, qr, {
      task: "adversarial review",
      role: "security",
      risk: "low", // risk=low would normally pick cheap, but never-downgrade overrides
      selectedProfiles,
      runId: "integration-security",
    });
    assert.equal(out.modelId, "provider/strong");
    assert.equal(out.selectorReason, REASON.STRONGEST_NEVER_DOWNGRADE);
  });

  it("honours health map and skips unhealthy selected models", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const selectedProfiles = [
      makeProfile("provider/best-but-out", "high"),
      makeProfile("provider/next", "default"),
    ];
    const health = { "provider/best-but-out": { status: "unhealthy" } };
    const out = decideAgentWith(mr, qr, {
      task: "task",
      role: "todd",
      risk: "medium",
      selectedProfiles,
      health,
      runId: "integration-health",
    });
    assert.equal(out.modelId, "provider/next", "unhealthy model is skipped");
  });

  it("preserves the codemod short-circuit (Tier-1 branch is unchanged)", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const out = decideAgentWith(mr, qr, {
      task: "convert var to const across the codebase",
      role: "brenda",
      selectedProfiles: [makeProfile("provider/any", "default")],
      runId: "integration-codemod",
    });
    assert.equal(out.agent, "brenda");
    assert.equal(out.modelTier, "budget");
    assert.equal(out.codemodIntent, "var-to-const");
    assert.equal(out.modelId, null, "codemod short-circuit does not resolve via the selector");
    assert.equal(out.selectorReason, null);
    assert.ok(UUID_RE.test(out.routingDecisionId), "routingDecisionId is still minted on the codemod branch");
  });

  it("preserves the explicitAgent branch (highest precedence unchanged)", () => {
    const mr = new ModelRouter({ seed: 7 });
    const qr = new QLearningRouter({ seed: 7 });
    const out = decideAgentWith(mr, qr, {
      task: "manual override",
      explicitAgent: "karen",
      role: "todd",
      selectedProfiles: [makeProfile("provider/any", "default")],
      runId: "integration-explicit",
    });
    assert.equal(out.agent, "karen", "explicit agent wins over the Q-learning pick");
    assert.equal(out.modelId, null, "explicit branch does not invoke the selector");
    assert.equal(out.selectorReason, null);
    assert.ok(UUID_RE.test(out.routingDecisionId), "routingDecisionId is still minted on the explicit branch");
  });
});