/**
 * ambiguity/score.test.ts — Unit tests for the ambiguity math.
 *
 * Verifies:
 *   - Boundary scores (all-0, all-1) are exact
 *   - Weight-sum invariant (handled by scripts/__tests__/ambiguity-weights)
 *   - Closure behavior (the score is `Σ w_i · clarity_i`)
 *   - Determinism: identical inputs produce identical outputs
 *   - Invalid inputs: missing keys, out-of-range, NaN, non-numeric,
 *     unknown dimensions, wrong kind
 *   - Both `greenfield` and `brownfield` presets work
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  AMBIGUITY_SCHEMA_VERSION,
  AMBIGUITY_WEIGHTS,
  computeAmbiguity,
} from "../../src/ambiguity/score.js";

const ALL_ONES_GREENFIELD = {
  intent: 1,
  outcome: 1,
  scope: 1,
  constraints: 1,
  success: 1,
  context: 1,
};

const ALL_ZEROS_GREENFIELD = {
  intent: 0,
  outcome: 0,
  scope: 0,
  constraints: 0,
  success: 0,
  context: 0,
};

const ALL_ONES_BROWNFIELD = {
  intent: 1,
  outcome: 1,
  scope: 1,
  constraints: 1,
  success: 1,
};

const ALL_ZEROS_BROWNFIELD = {
  intent: 0,
  outcome: 0,
  scope: 0,
  constraints: 0,
  success: 0,
};

describe("AMBIGUITY_SCHEMA_VERSION", () => {
  it("is a semver string", () => {
    assert.equal(typeof AMBIGUITY_SCHEMA_VERSION, "string");
    assert.match(AMBIGUITY_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe("AMBIGUITY_WEIGHTS presets", () => {
  it("greenfield has 6 dimensions", () => {
    assert.equal(Object.keys(AMBIGUITY_WEIGHTS.greenfield).length, 6);
  });

  it("brownfield has 5 dimensions", () => {
    assert.equal(Object.keys(AMBIGUITY_WEIGHTS.brownfield).length, 5);
  });
});

describe("computeAmbiguity — boundary scores", () => {
  it("returns 1.00 when every dimension is fully clear (greenfield)", () => {
    const r = computeAmbiguity(ALL_ONES_GREENFIELD, "greenfield");
    assert.equal(r.score, 1);
    assert.equal(r.kind, "greenfield");
    assert.equal(r.schemaVersion, AMBIGUITY_SCHEMA_VERSION);
    assert.equal(Object.keys(r.breakdown).length, 6);
  });

  it("returns 0.00 when every dimension is fully unclear (greenfield)", () => {
    const r = computeAmbiguity(ALL_ZEROS_GREENFIELD, "greenfield");
    assert.equal(r.score, 0);
  });

  it("returns 1.00 when every dimension is fully clear (brownfield)", () => {
    const r = computeAmbiguity(ALL_ONES_BROWNFIELD, "brownfield");
    assert.equal(r.score, 1);
    assert.equal(r.kind, "brownfield");
  });

  it("returns 0.00 when every dimension is fully unclear (brownfield)", () => {
    const r = computeAmbiguity(ALL_ZEROS_BROWNFIELD, "brownfield");
    assert.equal(r.score, 0);
  });
});

describe("computeAmbiguity — closure", () => {
  it("computes a weighted score for an asymmetric greenfield input", () => {
    const r = computeAmbiguity(
      { intent: 1, outcome: 0.5, scope: 0.5, constraints: 0.5, success: 0.5, context: 0.5 },
      "greenfield",
    );
    // 0.20*1 + (0.20+0.15+0.15+0.15+0.15)*0.5 = 0.20 + 0.40 = 0.60
    assert.equal(r.score, 0.6);
  });

  it("computes a weighted score for an asymmetric brownfield input", () => {
    const r = computeAmbiguity(
      { intent: 0, outcome: 1, scope: 1, constraints: 1, success: 1 },
      "brownfield",
    );
    // 0.25*0 + 0.25*1 + 0.20*1 + 0.15*1 + 0.15*1 = 0.75
    assert.equal(r.score, 0.75);
  });

  it("breakdown values sum to the score", () => {
    const r = computeAmbiguity(
      { intent: 0.3, outcome: 0.6, scope: 0.4, constraints: 0.7, success: 0.5, context: 0.8 },
      "greenfield",
    );
    const breakdownSum = Object.values(r.breakdown).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(breakdownSum - r.score) < 1e-6, `breakdown sum ${breakdownSum} != score ${r.score}`);
  });

  it("breakdown contribution for each dimension matches w*clarity", () => {
    const clarity = { intent: 0.5, outcome: 0.5, scope: 0.5, constraints: 0.5, success: 0.5, context: 0.5 };
    const r = computeAmbiguity(clarity, "greenfield");
    for (const dim of Object.keys(AMBIGUITY_WEIGHTS.greenfield)) {
      const w = AMBIGUITY_WEIGHTS.greenfield[dim as keyof typeof AMBIGUITY_WEIGHTS.greenfield];
      const expected = Math.round(w * 0.5 * 1e4) / 1e4;
      assert.equal(r.breakdown[dim], expected);
    }
  });
});

describe("computeAmbiguity — determinism", () => {
  it("identical inputs produce identical scores", () => {
    const input = { intent: 0.4, outcome: 0.6, scope: 0.7, constraints: 0.8, success: 0.9, context: 1.0 };
    const a = computeAmbiguity(input, "greenfield");
    const b = computeAmbiguity(input, "greenfield");
    assert.deepEqual(a, b);
  });

  it("default kind is greenfield when omitted", () => {
    const a = computeAmbiguity(ALL_ONES_GREENFIELD);
    const b = computeAmbiguity(ALL_ONES_GREENFIELD, "greenfield");
    assert.deepEqual(a, b);
    assert.equal(a.kind, "greenfield");
  });
});

describe("computeAmbiguity — score bounds", () => {
  it("score is always in [0, 1] across a randomized sweep", () => {
    for (let i = 0; i < 50; i++) {
      const input = {
        intent: Math.random(),
        outcome: Math.random(),
        scope: Math.random(),
        constraints: Math.random(),
        success: Math.random(),
        context: Math.random(),
      };
      const r = computeAmbiguity(input, "greenfield");
      assert.ok(r.score >= 0 && r.score <= 1, `score out of bounds: ${r.score}`);
    }
  });
});

describe("computeAmbiguity — invalid inputs", () => {
  it("rejects null input", () => {
    assert.throws(() => computeAmbiguity(null as unknown as never, "greenfield"), /must be a non-array object/);
  });

  it("rejects array input", () => {
    assert.throws(() => computeAmbiguity([] as unknown as never, "greenfield"), /must be a non-array object/);
  });

  it("rejects empty input object", () => {
    assert.throws(() => computeAmbiguity({}, "greenfield"), /at least one dimension/);
  });

  it("rejects missing required dimension (greenfield)", () => {
    assert.throws(
      () => computeAmbiguity({ intent: 1, outcome: 1, scope: 1, constraints: 1, success: 1 }, "greenfield"),
      /missing required dimension "context"/,
    );
  });

  it("rejects missing required dimension (brownfield)", () => {
    assert.throws(
      () => computeAmbiguity({ intent: 1, outcome: 1, scope: 1, constraints: 1 }, "brownfield"),
      /missing required dimension "success"/,
    );
  });

  it("rejects negative values", () => {
    assert.throws(
      () => computeAmbiguity({ intent: -0.1, outcome: 1, scope: 1, constraints: 1, success: 1, context: 1 }, "greenfield"),
      /must be a finite number in \[0, 1\]/,
    );
  });

  it("rejects values greater than 1", () => {
    assert.throws(
      () => computeAmbiguity({ intent: 1.5, outcome: 1, scope: 1, constraints: 1, success: 1, context: 1 }, "greenfield"),
      /must be a finite number in \[0, 1\]/,
    );
  });

  it("rejects NaN values", () => {
    assert.throws(
      () => computeAmbiguity({ intent: Number.NaN, outcome: 1, scope: 1, constraints: 1, success: 1, context: 1 }, "greenfield"),
      /must be a finite number in \[0, 1\]/,
    );
  });

  it("rejects Infinity values", () => {
    assert.throws(
      () => computeAmbiguity({ intent: Number.POSITIVE_INFINITY, outcome: 1, scope: 1, constraints: 1, success: 1, context: 1 }, "greenfield"),
      /must be a finite number in \[0, 1\]/,
    );
  });

  it("rejects non-numeric values", () => {
    assert.throws(
      () => computeAmbiguity({ intent: "1", outcome: 1, scope: 1, constraints: 1, success: 1, context: 1 }, "greenfield"),
      /must be a finite number in \[0, 1\]/,
    );
  });

  it("rejects unknown dimensions for the chosen kind", () => {
    assert.throws(
      () => computeAmbiguity({ ...ALL_ONES_GREENFIELD, ghost: 0.5 }, "greenfield"),
      /unknown dimension "ghost"/,
    );
  });

  it("rejects unknown kind", () => {
    assert.throws(
      () => computeAmbiguity(ALL_ONES_GREENFIELD, "bluefield" as never),
      /unknown kind/,
    );
  });

  it("accepts boundary values 0 and 1", () => {
    assert.doesNotThrow(() => computeAmbiguity({ ...ALL_ZEROS_GREENFIELD, intent: 1 }, "greenfield"));
    assert.doesNotThrow(() => computeAmbiguity({ ...ALL_ONES_GREENFIELD, intent: 0 }, "greenfield"));
  });
});
