/**
 * Tests for the Q-learning agent router (F-033).
 *
 * - selectAgent() returns one of the 14 hard-coded Bizar agent names.
 * - Codemod prompts route to brenda (the routine-implementation agent).
 * - recordOutcome() updates the Q-table (snapshot mean shifts).
 * - LRU caching: repeated tasks return the same pick without burning
 *   exploration budget.
 *
 * v10.3.0 — Action set expanded from 8 to 14 to cover every dispatched
 * agent (steve, brad, carl, pam, kevin, oscar).
 */

import { describe, test, expect } from "vitest";
import { QLearningRouter, AGENT_ACTIONS } from "../src/router/q-learning-router.js";

describe("QLearningRouter — action set", () => {
  test("AGENT_ACTIONS lists all 14 Bizar agents", () => {
    expect(AGENT_ACTIONS.length).toBe(14);
    expect(AGENT_ACTIONS).toContain("mike");
    expect(AGENT_ACTIONS).toContain("brenda");
    expect(AGENT_ACTIONS).toContain("linda");
    // v10.3.0 — long-tail agents now routable
    for (const agent of ["steve", "brad", "carl", "pam", "kevin", "oscar"]) {
      expect(AGENT_ACTIONS, `missing long-tail agent: ${agent}`).toContain(agent);
    }
  });
});

describe("QLearningRouter — codemod short-circuit", () => {
  test("var-to-const picks brenda", () => {
    const r = new QLearningRouter({ seed: 42, epsilon: 0 });
    expect(r.selectAgent("convert var to const").agent).toBe("brenda");
  });

  test("remove-console picks brenda", () => {
    const r = new QLearningRouter({ seed: 42, epsilon: 0 });
    expect(r.selectAgent("remove console.log calls").agent).toBe("brenda");
  });

  test("add-logging picks brenda", () => {
    const r = new QLearningRouter({ seed: 42, epsilon: 0 });
    expect(r.selectAgent("add logging to the handler").agent).toBe("brenda");
  });
});

describe("QLearningRouter — bandit behavior", () => {
  test("non-codemod task returns a valid agent", () => {
    const r = new QLearningRouter({ seed: 42, epsilon: 0.5 });
    const d = r.selectAgent("explain the architecture of this codebase");
    expect(AGENT_ACTIONS).toContain(d.agent);
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
  });

  test("epsilon=0 deterministic given seeded RNG", () => {
    const a = new QLearningRouter({ seed: 99, epsilon: 0 });
    const b = new QLearningRouter({ seed: 99, epsilon: 0 });
    const task = "implement a new cache layer for the storage engine";
    // Different RNG state path; the LRU cache for the first call
    // should fire identically. Subsequent calls fall back to bandit.
    expect(a.selectAgent(task).agent).toBe(b.selectAgent(task).agent);
  });

  test("recordOutcome shifts the Q snapshot toward the rewarded agent", () => {
    const r = new QLearningRouter({ seed: 7, epsilon: 0 });
    const before = r.snapshot().find((s) => s.agent === "todd")?.qMean ?? 0.5;
    for (let i = 0; i < 50; i++) r.recordOutcome("todd", true);
    const after = r.snapshot().find((s) => s.agent === "todd")?.qMean ?? 0.5;
    expect(after).toBeGreaterThan(before);
  });

  test("failures shift the Q mean downward", () => {
    const r = new QLearningRouter({ seed: 7, epsilon: 0 });
    for (let i = 0; i < 50; i++) r.recordOutcome("susan", false);
    const after = r.snapshot().find((s) => s.agent === "susan")?.qMean ?? 0.5;
    expect(after).toBeLessThan(0.5);
  });

  test("recordOutcome is a no-op for unknown agents", () => {
    const r = new QLearningRouter({ seed: 7, epsilon: 0 });
    const before = r.snapshot();
    r.recordOutcome("not-a-real-agent", true);
    const after = r.snapshot();
    expect(after).toEqual(before);
  });
});

describe("QLearningRouter — LRU cache", () => {
  test("repeated task returns the cached decision", () => {
    const r = new QLearningRouter({ seed: 11, epsilon: 0 });
    const task = "review this PR for security concerns";
    const first = r.selectAgent(task);
    const second = r.selectAgent(task);
    // The LRU returns the exact stored object — same agent, same confidence.
    expect(second.agent).toBe(first.agent);
    expect(second.confidence).toBe(first.confidence);
  });
});

describe("QLearningRouter — empty input safety", () => {
  test("null task returns the safe mike fallback", () => {
    const r = new QLearningRouter({ seed: 7 });
    const d = r.selectAgent("");
    expect(d.agent).toBe("mike");
  });
});
