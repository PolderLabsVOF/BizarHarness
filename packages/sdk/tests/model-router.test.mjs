/**
 * Tests for the Thompson-sampling bandit model router (F-033).
 *
 * - Codemod short-circuit returns `{tier: 'budget', codemodIntent}`.
 * - Default priors make `budget` the most-likely pick.
 * - recordOutcome() shifts the Beta(α, β) priors.
 * - recordOutcome with seed gives deterministic picks.
 *
 * Six-tier vocabulary (BizarTier, IMP-015): premium | high |
 * mid-design | default | mid | budget. The historical 3-tier names
 * (`flash` / `mid` / `expensive`) are deprecated — `flash` maps to
 * `budget`, `expensive` maps to `premium`, and `mid` survives as-is.
 */

import { describe, test, expect } from "vitest";
import { ModelRouter } from "../src/router/model-router.js";

const ALL_TIERS = ["premium", "high", "mid-design", "default", "mid", "budget"];

describe("ModelRouter — codemod short-circuit", () => {
  test("var-to-const short-circuits to budget with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("convert var to const");
    expect(d.tier).toBe("budget");
    expect(d.codemodIntent).toBe("var-to-const");
    expect(d.confidence).toBe(1.0);
  });

  test("remove-console short-circuits to budget with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("strip console.log statements");
    expect(d.tier).toBe("budget");
    expect(d.codemodIntent).toBe("remove-console");
  });

  test("add-logging short-circuits to budget with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("add logging to the handler");
    expect(d.tier).toBe("budget");
    expect(d.codemodIntent).toBe("add-logging");
  });
});

describe("ModelRouter — Thompson sampling", () => {
  test("non-codemod prompt returns a valid tier", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("design a database schema for inventory");
    expect(ALL_TIERS).toContain(d.tier);
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(d.codemodIntent).toBeUndefined();
  });

  test("default priors favor budget (alpha=2, beta=1)", () => {
    const r = new ModelRouter({ seed: 1 });
    const priors = r.getPriors();
    // The default-prior math (matches ADR-026 §BANDIT_REWARDS note).
    expect(priors.budget.alpha).toBe(2);
    expect(priors.budget.beta).toBe(1);
    expect(priors.mid.alpha).toBe(1);
    expect(priors.mid.beta).toBe(1);
    expect(priors["mid-design"].alpha).toBe(1);
    expect(priors["mid-design"].beta).toBe(1);
    expect(priors.default.alpha).toBe(1);
    expect(priors.default.beta).toBe(1);
    expect(priors.high.alpha).toBe(1);
    expect(priors.high.beta).toBe(2);
    expect(priors.premium.alpha).toBe(1);
    expect(priors.premium.beta).toBe(2);
  });

  test("many budget successes shift priors toward budget", () => {
    const r = new ModelRouter({ seed: 42 });
    for (let i = 0; i < 30; i++) r.recordOutcome("budget", true);
    const priors = r.getPriors();
    expect(priors.budget.alpha).toBeGreaterThan(2);
    expect(priors.budget.beta).toBe(1);
  });

  test("budget failures increment β", () => {
    const r = new ModelRouter({ seed: 42 });
    for (let i = 0; i < 5; i++) r.recordOutcome("budget", false);
    const priors = r.getPriors();
    expect(priors.budget.alpha).toBe(2);
    expect(priors.budget.beta).toBe(1 + 5);
  });

  test("seeded RNG produces deterministic pick", () => {
    const a = new ModelRouter({ seed: 7 });
    const b = new ModelRouter({ seed: 7 });
    const prompt = "explain what this function does";
    // Run several samples; at least one must agree (probabilistically
    // very near 1.0).
    let matches = 0;
    for (let i = 0; i < 20; i++) {
      const da = a.route(prompt);
      const db = b.route(prompt);
      if (da.tier === db.tier) matches += 1;
    }
    expect(matches).toBeGreaterThanOrEqual(18);
  });

  test("premium success is devalued (alpha += 0.4)", () => {
    const r = new ModelRouter({ seed: 42 });
    r.recordOutcome("premium", true);
    const priors = r.getPriors();
    expect(priors.premium.alpha).toBeCloseTo(1.4);
  });

  // -----------------------------------------------------------------
  // IMP-015 — new tiers added during the canonical-taxonomy closure.
  // These tests pin the per-tier reward weights and the prior shape
  // for `high`, `default`, and `mid-design` (none existed in the
  // legacy 3-tier vocabulary).
  // -----------------------------------------------------------------

  test("default priors for high: alpha=1, beta=2", () => {
    const r = new ModelRouter({ seed: 1 });
    const priors = r.getPriors();
    expect(priors.high.alpha).toBe(1);
    expect(priors.high.beta).toBe(2);
  });

  test("recordOutcome(\"high\", true) increments α by 0.55", () => {
    const r = new ModelRouter({ seed: 42 });
    r.recordOutcome("high", true);
    const priors = r.getPriors();
    expect(priors.high.alpha).toBeCloseTo(1.55);
    expect(priors.high.beta).toBe(2);
  });

  test("recordOutcome(\"premium\", true) increments α by 0.4", () => {
    const r = new ModelRouter({ seed: 42 });
    r.recordOutcome("premium", true);
    const priors = r.getPriors();
    expect(priors.premium.alpha).toBeCloseTo(1.4);
    expect(priors.premium.beta).toBe(2);
  });
});

describe("ModelRouter — overrides", () => {
  test("priors override applies per-tier", () => {
    const r = new ModelRouter({
      priors: { premium: { alpha: 100, beta: 1 } },
      seed: 1,
    });
    const priors = r.getPriors();
    expect(priors.premium.alpha).toBe(100);
    expect(priors.budget.alpha).toBe(2); // default still in place
  });
});
