/**
 * plugins/bizar/tests/odin.test.ts
 *
 * Unit tests for the Odin orchestrator decomposition logic.
 *
 * Odin takes a user prompt, decomposes it into subtasks, and assigns
 * roles based on keyword analysis. v1 uses heuristic sentence splitting
 * + role templates (no LLM in the loop). These tests verify that
 * decomposition produces sensible outputs for representative inputs.
 */
import { describe, test, expect } from "bun:test";

import { decomposeTask, buildOdinPrompt, type OdinDecomposition } from "../src/odin";

describe("decomposeTask — single-sentence fallback", () => {
  test("returns 2-step research+implement default", () => {
    const out = decomposeTask("Build a CLI todo app");
    expect(out.subtasks).toHaveLength(2);
    expect(out.subtasks[0].role).toBe("mimir");
    expect(out.subtasks[1].role).toBe("thor");
    expect(out.subtasks[0].blocking).toBe(true);
    expect(out.estimatedAgents).toBe(3);
    expect(out.rationale).toContain("defaulted");
  });

  test("empty task → empty decomposition", () => {
    const out = decomposeTask("");
    expect(out.subtasks).toEqual([]);
    expect(out.estimatedAgents).toBe(0);
  });

  test("whitespace-only task → empty decomposition", () => {
    const out = decomposeTask("   \n\t  ");
    expect(out.subtasks).toEqual([]);
  });
});

describe("decomposeTask — sentence splitting", () => {
  test("splits on period + space", () => {
    const out = decomposeTask("Research the auth library. Implement the OAuth flow. Test the integration.");
    expect(out.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(out.subtasks[0].role).toBe("mimir"); // research
    expect(out.subtasks[1].role).toBe("thor"); // implement
    expect(out.subtasks[2].role).toBe("forseti"); // test
  });

  test("splits on ' and ' when no periods", () => {
    const out = decomposeTask("Research auth libraries and implement the OAuth flow");
    expect(out.subtasks).toHaveLength(2);
  });

  test("caps at maxSubtasks (default 4)", () => {
    const out = decomposeTask(
      "Step A. Step B. Step C. Step D. Step E. Step F. Step G.",
    );
    expect(out.subtasks.length).toBeLessThanOrEqual(4);
  });

  test("merges adjacent same-role sentences when overflowing", () => {
    // 7 sentences that all map to "thor" — should merge down to ≤4.
    const out = decomposeTask(
      "Build a function. Build another function. Build a class. " +
      "Build a service. Build an API. Build a CLI. Test the result.",
    );
    expect(out.subtasks.length).toBeLessThanOrEqual(4);
    // First subtask should still be thor (build keyword).
    expect(out.subtasks[0].role).toBe("thor");
  });
});

describe("decomposeTask — role assignment", () => {
  test("UI-related → baldr", () => {
    const out = decomposeTask("Design a new UI for the dashboard. Animate the buttons.");
    const roles = out.subtasks.map((s) => s.role);
    expect(roles.some((r) => r === "baldr")).toBe(true);
  });

  test("testing-related → forseti", () => {
    const out = decomposeTask("Add unit tests for the parser and verify coverage.");
    const roles = out.subtasks.map((s) => s.role);
    expect(roles.some((r) => r === "forseti")).toBe(true);
  });

  test("research-related → mimir", () => {
    const out = decomposeTask("Investigate the docs. Survey the codebase. Analyze patterns.");
    const roles = out.subtasks.map((s) => s.role);
    expect(roles.some((r) => r === "mimir")).toBe(true);
  });

  test("debug-related → tyr", () => {
    const out = decomposeTask("Debug the bug. Investigate the root cause.");
    const roles = out.subtasks.map((s) => s.role);
    expect(roles.some((r) => r === "tyr")).toBe(true);
  });
});

describe("buildOdinPrompt", () => {
  test("includes mission, subtasks, and rationale", () => {
    const decomp = decomposeTask("Build a CLI todo app");
    const prompt = buildOdinPrompt("Build a CLI todo app", decomp);
    expect(prompt).toContain("You are Odin");
    expect(prompt).toContain("## Mission");
    expect(prompt).toContain("Build a CLI todo app");
    expect(prompt).toContain("## Subtasks");
    expect(prompt).toContain("## Coordination");
    expect(prompt).toContain("## Rationale");
  });

  test("marks blocking subtasks explicitly", () => {
    const decomp: OdinDecomposition = {
      subtasks: [
        { title: "Research", prompt: "do research", role: "mimir", blocking: true },
        { title: "Implement", prompt: "implement", role: "thor" },
      ],
      estimatedAgents: 3,
      rationale: "test",
    };
    const prompt = buildOdinPrompt("x", decomp);
    expect(prompt).toContain("blocking");
    // The non-blocking entry should not have "blocking" appended.
    const implMatch = prompt.match(/2\.\s+\*\*Implement\*\*/);
    expect(implMatch).toBeTruthy();
    expect(prompt.indexOf("(thor, blocking)")).toBeLessThan(prompt.indexOf("(thor)"));
  });
});