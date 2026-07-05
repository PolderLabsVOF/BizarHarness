/**
 * compaction.test.ts
 *
 * Spec contract for the compaction gate (see src/compaction.mjs):
 *   - `shouldCompact` returns false below 50%, true at and above 50%.
 *   - `shouldCompact` is defensive: null usage, undefined usage.total, and
 *     non-positive maxContext all return false (no false positives).
 *   - `maybeCompactSession` returns `{ compacted: false, reason: "below_threshold" }`
 *     when below the gate.
 *   - `maybeCompactSession` returns `{ compacted: true, sessionId, threshold, … }`
 *     when at/over the gate.
 *   - The default threshold is 0.5.
 *   - `setCompactionThreshold` rejects out-of-range values with a throw;
 *     accepts in-range values silently.
 *   - State leaks between tests are not allowed — every test that mutates
 *     the threshold calls `resetCompactionDefaults()` in its teardown
 *     (bun:test does not have a global afterEach, so we use try/finally).
 *
 * Tests use `bun:test` to match the rest of the plugin suite (see
 * `tests/loop.test.ts`, `tests/options.test.ts`, etc.).
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";

import {
  shouldCompact,
  maybeCompactSession,
  getCompactionThreshold,
  setCompactionThreshold,
  resetCompactionDefaults,
} from "../src/compaction.mjs";

/**
 * Bun:test does not expose a global `afterEach`/`beforeEach` reset hook
 * that runs across describe blocks, so we wire per-block setup/teardown
 * via the standard `beforeEach`/`afterEach` imports. We also reset on
 * entry to each test as a belt-and-braces guarantee that no leak from a
 * prior test (run in the same process by `bun test`) can poison state.
 */
beforeEach(() => {
  resetCompactionDefaults();
});

afterEach(() => {
  resetCompactionDefaults();
});

describe("shouldCompact", () => {
  test("does not compact below 50%", () => {
    expect(shouldCompact({ total: 40000 }, 100000)).toBe(false);
  });

  test("does not compact at 49.99%", () => {
    expect(shouldCompact({ total: 49999 }, 100000)).toBe(false);
  });

  test("compacts at exactly 50%", () => {
    expect(shouldCompact({ total: 50000 }, 100000)).toBe(true);
  });

  test("compacts above 50%", () => {
    expect(shouldCompact({ total: 80000 }, 100000)).toBe(true);
  });

  test("compacts at 100% (full context)", () => {
    expect(shouldCompact({ total: 100000 }, 100000)).toBe(true);
  });

  test("does not compact with null usage", () => {
    expect(shouldCompact(null, 100000)).toBe(false);
  });

  test("does not compact with undefined usage", () => {
    expect(shouldCompact(undefined, 100000)).toBe(false);
  });

  test("does not compact when usage.total is missing", () => {
    expect(shouldCompact({}, 100000)).toBe(false);
  });

  test("does not compact with non-positive maxContext", () => {
    expect(shouldCompact({ total: 50000 }, 0)).toBe(false);
    expect(shouldCompact({ total: 50000 }, -1)).toBe(false);
  });

  test("respects a non-default threshold (0.7)", () => {
    setCompactionThreshold(0.7);
    expect(shouldCompact({ total: 60000 }, 100000)).toBe(false);
    expect(shouldCompact({ total: 70000 }, 100000)).toBe(true);
    expect(shouldCompact({ total: 80000 }, 100000)).toBe(true);
  });
});

describe("getCompactionThreshold / setCompactionThreshold", () => {
  test("default threshold is 0.5", () => {
    expect(getCompactionThreshold()).toBe(0.5);
  });

  test("setCompactionThreshold rejects 0 (below minimum)", () => {
    expect(() => setCompactionThreshold(0)).toThrow(/Invalid compaction threshold/);
  });

  test("setCompactionThreshold rejects 0.05 (below minimum 0.1)", () => {
    expect(() => setCompactionThreshold(0.05)).toThrow(/Invalid compaction threshold/);
  });

  test("setCompactionThreshold rejects 1.5 (above maximum)", () => {
    expect(() => setCompactionThreshold(1.5)).toThrow(/Invalid compaction threshold/);
  });

  test("setCompactionThreshold rejects NaN", () => {
    expect(() => setCompactionThreshold(Number.NaN)).toThrow(/Invalid compaction threshold/);
  });

  test("setCompactionThreshold rejects Infinity", () => {
    expect(() => setCompactionThreshold(Number.POSITIVE_INFINITY)).toThrow(
      /Invalid compaction threshold/,
    );
  });

  test("setCompactionThreshold rejects non-number values", () => {
    expect(() => setCompactionThreshold("0.5" as unknown as number)).toThrow(
      /Invalid compaction threshold/,
    );
    expect(() => setCompactionThreshold(null as unknown as number)).toThrow(
      /Invalid compaction threshold/,
    );
  });

  test("setCompactionThreshold accepts 0.1 (lower bound)", () => {
    expect(() => setCompactionThreshold(0.1)).not.toThrow();
    expect(getCompactionThreshold()).toBe(0.1);
  });

  test("setCompactionThreshold accepts 1.0 (upper bound)", () => {
    expect(() => setCompactionThreshold(1.0)).not.toThrow();
    expect(getCompactionThreshold()).toBe(1.0);
  });

  test("setCompactionThreshold accepts 0.7 (in-range)", () => {
    expect(() => setCompactionThreshold(0.7)).not.toThrow();
    expect(getCompactionThreshold()).toBe(0.7);
  });
});

describe("maybeCompactSession", () => {
  test("returns below_threshold when under limit", async () => {
    const r = await maybeCompactSession({
      sessionId: "s1",
      messageCount: 5,
      currentUsage: { total: 30000 },
      maxContext: 100000,
      summarizer: async (texts) => texts.join(" "),
    });
    expect(r.compacted).toBe(false);
    expect(r.reason).toBe("below_threshold");
    expect(r.ratio).toBeCloseTo(0.3);
  });

  test("triggers when over limit", async () => {
    const r = await maybeCompactSession({
      sessionId: "s1",
      messageCount: 100,
      currentUsage: { total: 60000 },
      maxContext: 100000,
      summarizer: async () => "summary",
    });
    expect(r.compacted).toBe(true);
    expect(r.sessionId).toBe("s1");
    expect(r.atMessages).toBe(100);
    expect(r.threshold).toBe(0.5);
    expect(r.preservedRecent).toBe(10);
    expect(r.ratio).toBeCloseTo(0.6);
  });

  test("triggers at exactly the threshold (50000/100000 = 0.5)", async () => {
    const r = await maybeCompactSession({
      sessionId: "edge",
      messageCount: 42,
      currentUsage: { total: 50000 },
      maxContext: 100000,
      summarizer: async () => "",
    });
    expect(r.compacted).toBe(true);
    expect(r.atMessages).toBe(42);
  });

  test("respects a custom preserveRecent override", async () => {
    const r = await maybeCompactSession({
      sessionId: "s2",
      messageCount: 200,
      currentUsage: { total: 90000 },
      maxContext: 100000,
      summarizer: async () => "",
      preserveRecent: 25,
    });
    expect(r.compacted).toBe(true);
    expect(r.preservedRecent).toBe(25);
  });

  test("respects a non-default threshold", async () => {
    setCompactionThreshold(0.8);
    const r1 = await maybeCompactSession({
      sessionId: "s3",
      messageCount: 50,
      currentUsage: { total: 70000 },
      maxContext: 100000,
      summarizer: async () => "",
    });
    expect(r1.compacted).toBe(false);

    const r2 = await maybeCompactSession({
      sessionId: "s3",
      messageCount: 50,
      currentUsage: { total: 85000 },
      maxContext: 100000,
      summarizer: async () => "",
    });
    expect(r2.compacted).toBe(true);
    expect(r2.threshold).toBe(0.8);
  });

  test("does not invoke the summarizer when below threshold", async () => {
    let called = false;
    await maybeCompactSession({
      sessionId: "s4",
      messageCount: 10,
      currentUsage: { total: 1000 },
      maxContext: 100000,
      summarizer: async () => {
        called = true;
        return "should-not-run";
      },
    });
    expect(called).toBe(false);
  });

  test("throws when sessionId is missing", async () => {
    await expect(
      maybeCompactSession({
        sessionId: "",
        messageCount: 1,
        currentUsage: { total: 999999 },
        maxContext: 100000,
        summarizer: async () => "",
      }),
    ).rejects.toThrow(/sessionId is required/);
  });
});

describe("resetCompactionDefaults", () => {
  test("restores the threshold to 0.5 after a custom set", () => {
    setCompactionThreshold(0.9);
    expect(getCompactionThreshold()).toBe(0.9);
    resetCompactionDefaults();
    expect(getCompactionThreshold()).toBe(0.5);
  });
});