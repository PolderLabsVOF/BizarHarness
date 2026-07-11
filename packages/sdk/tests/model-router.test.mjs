/**
 * Tests for the Thompson-sampling bandit model router (F-033).
 *
 * - Codemod short-circuit returns `{tier: 'flash', codemodIntent}`.
 * - Default priors make `flash` the most-likely pick.
 * - recordOutcome() shifts the Beta(α, β) priors.
 * - recordOutcome with seed gives deterministic picks.
 */

import { describe, test, expect } from "vitest";
import { ModelRouter } from "../src/router/model-router.js";

describe("ModelRouter — codemod short-circuit", () => {
  test("var-to-const short-circuits to flash with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("convert var to const");
    expect(d.tier).toBe("flash");
    expect(d.codemodIntent).toBe("var-to-const");
    expect(d.confidence).toBe(1.0);
  });

  test("remove-console short-circuits to flash with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("strip console.log statements");
    expect(d.tier).toBe("flash");
    expect(d.codemodIntent).toBe("remove-console");
  });

  test("add-logging short-circuits to flash with codemodIntent", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("add logging to the handler");
    expect(d.tier).toBe("flash");
    expect(d.codemodIntent).toBe("add-logging");
  });
});

describe("ModelRouter — Thompson sampling", () => {
  test("non-codemod prompt returns a valid tier", () => {
    const r = new ModelRouter({ seed: 42 });
    const d = r.route("design a database schema for inventory");
    expect(["flash", "mid", "expensive"]).toContain(d.tier);
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(d.codemodIntent).toBeUndefined();
  });

  test("default priors favor flash (alpha=2, beta=1)", () => {
    const r = new ModelRouter({ seed: 1 });
    const priors = r.getPriors();
    // The default-prior math (matches ADR-026 §BANDIT_REWARDS note).
    expect(priors.flash.alpha).toBe(2);
    expect(priors.flash.beta).toBe(1);
    expect(priors.mid.alpha).toBe(1);
    expect(priors.mid.beta).toBe(1);
    expect(priors.expensive.alpha).toBe(1);
    expect(priors.expensive.beta).toBe(2);
  });

  test("many flash successes shift priors toward flash", () => {
    const r = new ModelRouter({ seed: 42 });
    for (let i = 0; i < 30; i++) r.recordOutcome("flash", true);
    const priors = r.getPriors();
    expect(priors.flash.alpha).toBeGreaterThan(2);
    expect(priors.flash.beta).toBe(1);
  });

  test("flash failures increment β", () => {
    const r = new ModelRouter({ seed: 42 });
    for (let i = 0; i < 5; i++) r.recordOutcome("flash", false);
    const priors = r.getPriors();
    expect(priors.flash.alpha).toBe(2);
    expect(priors.flash.beta).toBe(1 + 5);
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

  test("expensive success is devalued (alpha += 0.4)", () => {
    const r = new ModelRouter({ seed: 42 });
    r.recordOutcome("expensive", true);
    const priors = r.getPriors();
    expect(priors.expensive.alpha).toBeCloseTo(1.4);
  });
});

describe("ModelRouter — overrides", () => {
  test("priors override applies per-tier", () => {
    const r = new ModelRouter({
      priors: { expensive: { alpha: 100, beta: 1 } },
      seed: 1,
    });
    const priors = r.getPriors();
    expect(priors.expensive.alpha).toBe(100);
    expect(priors.flash.alpha).toBe(2); // default still in place
  });
});
