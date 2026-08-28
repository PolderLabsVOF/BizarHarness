/**
 * Tests for the IMP-020 / F-192 contextual outcome learner.
 *
 * Pins the verbatim acceptance gate from IMPROVEMENTS.md lines 705-721:
 *   "Updates affect only the relevant model/task state."
 *
 * Every test must verify that `record()` mutates exactly ONE bucket
 * (the matching ContextKey) and never touches the other models' or
 * contexts' posteriors.
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInMemoryOutcomeLearner,
  createFileOutcomeLearner,
  OutcomeLearnerError,
  NEVER_DOWNGRADE_ROLES,
  newRoutingDecisionId,
} from "../src/router/outcome-learner.ts";

function baseKey(over = {}) {
  return {
    modelId: "anthropic/claude-3-5-sonnet",
    tier: "high",
    role: "implementer",
    phase: "implement",
    capability: "tool-use",
    riskLevel: "low",
    provider: "anthropic",
    languageTag: "ts",
    contextSizeBucket: "medium",
    ...over,
  };
}

function success(modelId, over = {}) {
  return {
    routingDecisionId: newRoutingDecisionId(),
    modelId,
    taskKey: baseKey({ modelId, ...over }),
    status: "success",
    verifiedBy: "auto-verifier",
    capturedAt: new Date().toISOString(),
  };
}

function failure(modelId, status = "failure", over = {}) {
  return {
    routingDecisionId: newRoutingDecisionId(),
    modelId,
    taskKey: baseKey({ modelId, ...over }),
    status,
    verifiedBy: "auto-verifier",
    capturedAt: new Date().toISOString(),
  };
}

describe("OutcomeLearner — posterior updates (acceptance gate)", () => {
  it("three successes drive the posterior mean > 0.7", () => {
    const learner = createInMemoryOutcomeLearner();
    for (let i = 0; i < 3; i++) {
      learner.record(success("anthropic/claude-3-5-sonnet"));
    }
    const p = learner.posteriorFor(baseKey());
    // α = 1 + 3, β = 1 → mean = 4/5 = 0.8
    expect(p.meanReward).toBeGreaterThan(0.7);
    expect(p.alpha).toBeCloseTo(4);
    expect(p.beta).toBeCloseTo(1);
    expect(p.successes).toBe(3);
  });

  it("three failures drive the posterior mean < 0.3", () => {
    const learner = createInMemoryOutcomeLearner();
    for (let i = 0; i < 3; i++) {
      learner.record(failure("anthropic/claude-3-5-sonnet"));
    }
    const p = learner.posteriorFor(baseKey());
    // α = 1, β = 1 + 3 → mean = 1/5 = 0.2
    expect(p.meanReward).toBeLessThan(0.3);
    expect(p.alpha).toBeCloseTo(1);
    expect(p.beta).toBeCloseTo(4);
    expect(p.failures).toBe(3);
  });

  it("mixed 2 success + 1 failure produces α=3, β=2", () => {
    const learner = createInMemoryOutcomeLearner();
    learner.record(success("anthropic/claude-3-5-sonnet"));
    learner.record(success("anthropic/claude-3-5-sonnet"));
    learner.record(failure("anthropic/claude-3-5-sonnet"));
    const p = learner.posteriorFor(baseKey());
    expect(p.alpha).toBeCloseTo(3);
    expect(p.beta).toBeCloseTo(2);
    expect(p.successes).toBe(2);
    expect(p.failures).toBe(1);
    expect(p.meanReward).toBeCloseTo(2 / 3);
  });

  it("only updates the matching ContextKey bucket (the acceptance gate)", () => {
    const learner = createInMemoryOutcomeLearner();
    // Record successes for one specific role/phase combination.
    for (let i = 0; i < 5; i++) {
      learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer", phase: "implement" }));
    }
    // Verify the SAME modelId in a different role bucket is untouched.
    const otherRoleKey = baseKey({ modelId: "anthropic/claude-3-5-sonnet", role: "research-analyst", phase: "research" });
    const otherRolePosterior = learner.posteriorFor(otherRoleKey);
    expect(otherRolePosterior.alpha).toBeCloseTo(1);
    expect(otherRolePosterior.beta).toBeCloseTo(1);
    expect(otherRolePosterior.successes).toBe(0);
    expect(otherRolePosterior.failures).toBe(0);
    expect(otherRolePosterior.meanReward).toBeCloseTo(0.5);
    // And a DIFFERENT modelId in the same role is untouched.
    const otherModelKey = baseKey({ modelId: "openai/gpt-4o", role: "implementer", phase: "implement" });
    const otherModelPosterior = learner.posteriorFor(otherModelKey);
    expect(otherModelPosterior.successes).toBe(0);
    expect(otherModelPosterior.meanReward).toBeCloseTo(0.5);
  });

  it("record() returns updated keys for the matching bucket only", () => {
    const learner = createInMemoryOutcomeLearner();
    const result = learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
    expect(result.updated).toHaveLength(1);
    // The updated key must be the canonicalised JSON of the same
    // ContextKey we sent in.
    expect(result.updated[0]).toContain("anthropic/claude-3-5-sonnet");
    expect(result.updated[0]).toContain("implementer");
  });
});

describe("OutcomeLearner — ranking", () => {
  it("returns highest-mean candidate first", () => {
    const learner = createInMemoryOutcomeLearner();
    // Train claude-3-5 as the strong winner.
    for (let i = 0; i < 4; i++) learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
    // Train claude-haiku as the weaker loser.
    for (let i = 0; i < 4; i++) learner.record(failure("anthropic/claude-haiku", "failure", { role: "implementer" }));
    const ranked = learner.ranking("implementer", [
      baseKey({ modelId: "anthropic/claude-3-5-sonnet", role: "implementer" }),
      baseKey({ modelId: "anthropic/claude-haiku", role: "implementer" }),
    ]);
    expect(ranked[0].modelId).toBe("anthropic/claude-3-5-sonnet");
    expect(ranked[1].modelId).toBe("anthropic/claude-haiku");
  });

  it("NEVER_DOWNGRADE_ROLES ignore posterior ranking and pin to strongest tier", () => {
    const learner = createInMemoryOutcomeLearner();
    // Train a budget-tier model as the strongest winner.
    for (let i = 0; i < 10; i++) learner.record(success("anthropic/claude-haiku", { role: "security" }));
    // Make the premium tier look weak with plain 'failure' status
    // (NOT model-quality, which would trigger quarantine).
    for (let i = 0; i < 10; i++) learner.record(failure("anthropic/claude-opus", "failure", { role: "security" }));
    const ranked = learner.ranking("security", [
      baseKey({ modelId: "anthropic/claude-haiku", tier: "budget", role: "security" }),
      baseKey({ modelId: "anthropic/claude-opus", tier: "premium", role: "security" }),
    ]);
    // Even with haiku having perfect evidence, NEVER_DOWNGRADE_ROLES
    // must pin to the strongest tier (premium = opus).
    expect(ranked[0].modelId).toBe("anthropic/claude-opus");
    expect(ranked[0].tier).toBe("premium");
  });

  it("each NEVER_DOWNGRADE_ROLE bypasses the learner", () => {
    const learner = createInMemoryOutcomeLearner();
    const candidates = [
      baseKey({ modelId: "anthropic/claude-haiku", tier: "budget" }),
      baseKey({ modelId: "anthropic/claude-opus", tier: "premium" }),
    ];
    for (const role of ["security", "architecture", "adversarial", "audit", "karen"]) {
      const ranked = learner.ranking(role, candidates);
      expect(ranked[0].modelId, `${role} must pin to strongest tier`).toBe("anthropic/claude-opus");
      expect(NEVER_DOWNGRADE_ROLES.has(role)).toBe(true);
    }
  });

  it("low/medium-risk with low evidence explores ~10% of the time", () => {
    const learner = createInMemoryOutcomeLearner();
    // Force a single observation so the ranking is non-degenerate.
    learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
    learner.record(success("anthropic/claude-haiku", { role: "implementer" }));
    const candidates = [
      baseKey({ modelId: "anthropic/claude-3-5-sonnet", role: "implementer" }),
      baseKey({ modelId: "anthropic/claude-haiku", role: "implementer" }),
    ];
    // Statistical test: with α+β < 5 and 10% exploration, the
    // non-greedy pick should happen ~10% of the time over 1000 calls.
    let nonGreedy = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const ranked = learner.ranking("implementer", candidates);
      // The greedy order should put claude-3-5 first (both have 1
      // success, but 3-5 has higher tier). Non-greedy means the
      // ranking swapped.
      if (ranked[0].modelId !== "anthropic/claude-3-5-sonnet") nonGreedy += 1;
    }
    const ratio = nonGreedy / N;
    // 10% ± 5%
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });
});

describe("OutcomeLearner — quarantine", () => {
  it("triggers after 3 strike-type failures within 24h", () => {
    const learner = createInMemoryOutcomeLearner();
    // 'transport' / 'auth' / 'rate-limit' / 'model-quality' are strikes.
    learner.record(failure("anthropic/claude-opus", "transport"));
    expect(learner.isQuarantined("anthropic/claude-opus")).toBe(false);
    learner.record(failure("anthropic/claude-opus", "auth"));
    expect(learner.isQuarantined("anthropic/claude-opus")).toBe(false);
    learner.record(failure("anthropic/claude-opus", "rate-limit"));
    expect(learner.isQuarantined("anthropic/claude-opus")).toBe(true);
  });

  it("quarantine survives snapshot/restore round-trip", () => {
    const learner = createInMemoryOutcomeLearner();
    learner.record(failure("anthropic/claude-opus", "transport"));
    learner.record(failure("anthropic/claude-opus", "auth"));
    learner.record(failure("anthropic/claude-opus", "rate-limit"));
    const snap = learner.snapshot();
    const restored = createInMemoryOutcomeLearner();
    restored.restore(snap);
    expect(restored.isQuarantined("anthropic/claude-opus")).toBe(true);
  });

  it("does NOT trigger quarantine for 'timeout' or 'context-overflow'", () => {
    const learner = createInMemoryOutcomeLearner();
    for (let i = 0; i < 5; i++) learner.record(failure("anthropic/claude-haiku", "timeout"));
    for (let i = 0; i < 5; i++) learner.record(failure("anthropic/claude-haiku", "context-overflow"));
    expect(learner.isQuarantined("anthropic/claude-haiku")).toBe(false);
    // The posteriors still update (timeout/context-overflow ARE failure statuses for the Beta update).
    const p = learner.posteriorFor(baseKey({ modelId: "anthropic/claude-haiku" }));
    expect(p.failures).toBe(10);
  });

  it("record() refuses to update a quarantined model", () => {
    const learner = createInMemoryOutcomeLearner();
    learner.record(failure("anthropic/claude-opus", "transport"));
    learner.record(failure("anthropic/claude-opus", "auth"));
    learner.record(failure("anthropic/claude-opus", "rate-limit"));
    expect(learner.isQuarantined("anthropic/claude-opus")).toBe(true);
    let threw = false;
    try {
      learner.record(success("anthropic/claude-opus"));
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(OutcomeLearnerError);
      expect((err).code).toBe("QUARANTINE_UPDATE_DENIED");
    }
    expect(threw).toBe(true);
  });
});

describe("OutcomeLearner — decay", () => {
  it("halves alpha after one decay half-life", () => {
    const learner = createInMemoryOutcomeLearner({ decayHalfLifeDays: 14 });
    const now = "2026-01-01T00:00:00.000Z";
    // Seed the posterior.
    learner.record({
      routingDecisionId: newRoutingDecisionId(),
      modelId: "anthropic/claude-3-5-sonnet",
      taskKey: baseKey(),
      status: "success",
      verifiedBy: "auto-verifier",
      capturedAt: now,
    });
    learner.record({
      routingDecisionId: newRoutingDecisionId(),
      modelId: "anthropic/claude-3-5-sonnet",
      taskKey: baseKey(),
      status: "success",
      verifiedBy: "auto-verifier",
      capturedAt: now,
    });
    // Now: 1 day later — well within the 14-day half-life window. We
    // want to verify decay behaves at exactly one half-life.
    const beforePosterior = learner.posteriorFor(baseKey());
    const initialAlpha = beforePosterior.alpha;
    const halfLifeMs = 14 * 24 * 60 * 60 * 1000;
    const futureMs = Date.parse(now) + halfLifeMs;
    const future = new Date(futureMs).toISOString();
    learner.decay(future);
    const after = learner.posteriorFor(baseKey());
    // After one half-life, the excess above the floor (1) should halve.
    // α went from initialAlpha → 1 + (initialAlpha - 1) * 0.5
    const expected = 1 + (initialAlpha - 1) * 0.5;
    expect(after.alpha).toBeCloseTo(expected, 4);
  });
});

describe("OutcomeLearner — restore semantics", () => {
  it("does NOT overwrite a newer posterior with an older snapshot", () => {
    const learner = createInMemoryOutcomeLearner();
    // Populate the newer posterior by recording fresh signals.
    for (let i = 0; i < 99; i++) {
      learner.record(success("anthropic/claude-3-5-sonnet"));
    }
    const newer = learner.posteriorFor(baseKey());
    expect(newer.successes).toBe(99);
    expect(newer.alpha).toBeGreaterThan(50);
    // Build an older snapshot pointing at the SAME bucket.
    const snapshot = learner.snapshot();
    const key = Object.keys(snapshot.posteriors)[0];
    expect(typeof key).toBe("string");
    snapshot.posteriors[key] = {
      ...snapshot.posteriors[key],
      alpha: 1.5,
      successes: 5,
      meanReward: 1.0,
      lastUpdated: "2025-01-01T00:00:00.000Z",
    };
    learner.restore(snapshot);
    const after = learner.posteriorFor(baseKey());
    // The newer posterior must survive — restore must NOT overwrite.
    expect(after.successes).toBe(99);
    expect(after.alpha).toBeGreaterThan(50);
  });

  it("merges older snapshots into empty state", () => {
    const learner = createInMemoryOutcomeLearner();
    // Build the snapshot key by recording one signal first to learn
    // the canonical key shape, then replace the entry with the older
    // payload.
    learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
    const snapshot = learner.snapshot();
    const key = Object.keys(snapshot.posteriors)[0];
    snapshot.posteriors[key] = {
      alpha: 50,
      beta: 1,
      successes: 49,
      failures: 0,
      meanReward: 49 / 50,
      lastUpdated: "2026-08-01T00:00:00.000Z",
    };
    snapshot.quarantined["anthropic/claude-opus"] = {
      since: "2026-08-01T00:00:00.000Z",
      reason: "test",
      strikes: 3,
    };
    // Reset the learner so we have a clean slate, then restore.
    const fresh = createInMemoryOutcomeLearner();
    fresh.restore(snapshot);
    expect(fresh.posteriorFor(baseKey({ role: "implementer" })).successes).toBe(49);
    expect(fresh.isQuarantined("anthropic/claude-opus")).toBe(true);
  });
});

describe("OutcomeLearner — signal validation", () => {
  it("rejects a non-UUID routingDecisionId", () => {
    const learner = createInMemoryOutcomeLearner();
    const signal = success("anthropic/claude-3-5-sonnet");
    signal.routingDecisionId = "not-a-uuid";
    expect(() => learner.record(signal)).toThrow(/UUID v4/);
  });

  it("rejects an unknown verifiedBy", () => {
    const learner = createInMemoryOutcomeLearner();
    const signal = success("anthropic/claude-3-5-sonnet");
    signal.verifiedBy = "self-report";
    let threw = false;
    try {
      learner.record(signal);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(OutcomeLearnerError);
      expect((err).code).toBe("INVALID_VERIFIER");
    }
    expect(threw).toBe(true);
  });

  it("rejects a status outside the closed taxonomy", () => {
    const learner = createInMemoryOutcomeLearner();
    const signal = success("anthropic/claude-3-5-sonnet");
    signal.status = "random";
    let threw = false;
    try {
      learner.record(signal);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(OutcomeLearnerError);
      expect((err).code).toBe("INVALID_STATUS");
    }
    expect(threw).toBe(true);
  });
});

describe("OutcomeLearner — file persistence", () => {
  it("persists to disk on record() and restores on reload", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "outcome-learner-"));
    const path = join(tmpDir, "snapshot.json");
    try {
      const learner = createFileOutcomeLearner(path);
      learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
      learner.record(success("anthropic/claude-3-5-sonnet", { role: "implementer" }));
      // File should now exist with the snapshot.
      const onDisk = JSON.parse(readFileSync(path, "utf-8"));
      expect(Object.keys(onDisk.posteriors).length).toBe(1);
      // Reload via a fresh factory — must see the same posteriors.
      const restored = createFileOutcomeLearner(path);
      const p = restored.posteriorFor(baseKey({ role: "implementer" }));
      expect(p.successes).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
