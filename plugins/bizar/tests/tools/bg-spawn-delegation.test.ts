/**
 * Delegation wrapper unit tests.
 *
 * `bizar_spawn_background` silently fell back to odin for any
 * subagent request because cline 1.17.x rejects
 * `cline run --agent <subagent>` with "agent X is a subagent,
 * not a primary agent". The fix routes subagent requests through
 * odin with a directive delegation prompt.
 *
 * These tests cover the pure helpers — `PRIMARY_AGENTS`,
 * `needsDelegationWrapper`, and `buildDelegationPrompt` — exported
 * from src/tools/bg-spawn.ts specifically for testability.
 */

import { describe, it, expect } from "bun:test";
import {
  PRIMARY_AGENTS,
  needsDelegationWrapper,
  buildDelegationPrompt,
} from "../../src/tools/bg-spawn";

describe("PRIMARY_AGENTS — set of agents accepted by cline run --agent", () => {
  it("contains the three primary agents from config/agents/*.md", () => {
    expect(PRIMARY_AGENTS.has("odin")).toBe(true);
    expect(PRIMARY_AGENTS.has("quick")).toBe(true);
    expect(PRIMARY_AGENTS.has("agent-browser")).toBe(true);
  });

  it("does NOT contain any subagent", () => {
    for (const sub of [
      "mimir",
      "heimdall",
      "hermod",
      "thor",
      "baldr",
      "tyr",
      "vidarr",
      "forseti",
      "frigg",  // v3.20.11: frigg was demoted to subagent (mode: subagent)
      "vor",
      "semble-search",
    ]) {
      expect(PRIMARY_AGENTS.has(sub)).toBe(false);
    }
  });

  it("is in sync with the on-disk agent configs", async () => {
    // Read each config/agents/*.md and extract the mode field. The
    // PRIMARY_AGENTS set must be the exact set of `mode: primary`
    // agents. This guards against drift when a new agent is added.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(import.meta.dir, "..", "..", "..", "..", "config", "agents");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const diskPrimary = new Set<string>();
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      const m = text.match(/^mode:\s*(\S+)/m);
      if (m && m[1] === "primary") {
        diskPrimary.add(f.replace(/\.md$/, ""));
      }
    }
    // The disk set must equal our PRIMARY_AGENTS set exactly.
    const code = new Set(PRIMARY_AGENTS);
    expect([...code].sort()).toEqual([...diskPrimary].sort());
  });
});

describe("needsDelegationWrapper", () => {
  it("returns false for primary agents", () => {
    expect(needsDelegationWrapper("odin")).toBe(false);
    expect(needsDelegationWrapper("quick")).toBe(false);
    expect(needsDelegationWrapper("agent-browser")).toBe(false);
  });

  it("returns true for subagents", () => {
    expect(needsDelegationWrapper("mimir")).toBe(true);
    expect(needsDelegationWrapper("heimdall")).toBe(true);
    expect(needsDelegationWrapper("thor")).toBe(true);
    expect(needsDelegationWrapper("tyr")).toBe(true);
    expect(needsDelegationWrapper("vidarr")).toBe(true);
    expect(needsDelegationWrapper("forseti")).toBe(true);
  });

  it("returns true for unknown agent names (defensive — let cline reject)", () => {
    expect(needsDelegationWrapper("xyz-unknown-agent")).toBe(true);
    expect(needsDelegationWrapper("")).toBe(true);
  });
});

describe("buildDelegationPrompt", () => {
  it("names the requested subagent explicitly", () => {
    const prompt = buildDelegationPrompt("mimir", "research X");
    expect(prompt).toContain("Requested subagent: mimir");
    expect(prompt).toContain('agent="mimir"');
  });

  it("includes the user prompt verbatim between BEGIN/END markers", () => {
    const userPrompt = "research MiniMax rate limits and recommend a fallback strategy";
    const prompt = buildDelegationPrompt("mimir", userPrompt);
    expect(prompt).toContain("--- BEGIN USER PROMPT ---");
    expect(prompt).toContain("--- END USER PROMPT ---");
    expect(prompt).toContain(userPrompt);
  });

  it("is directive: forbids Odin from performing the work itself", () => {
    const prompt = buildDelegationPrompt("thor", "implement feature X");
    expect(prompt).toMatch(/Do NOT/i);
    expect(prompt).toMatch(/perform the work yourself/i);
    expect(prompt).toMatch(/Do NOT interpret/i);
    expect(prompt).toMatch(/Do NOT ask/i);
    expect(prompt).toMatch(/Do NOT route to any other agent/i);
  });

  it("instructs Odin to use the task tool (cline's delegation mechanism)", () => {
    const prompt = buildDelegationPrompt("mimir", "research X");
    expect(prompt).toMatch(/task tool/i);
    expect(prompt).toMatch(/agent="mimir"/);
  });

  it("instructs Odin to report the subagent's output verbatim", () => {
    const prompt = buildDelegationPrompt("mimir", "research X");
    expect(prompt).toMatch(/verbatim/i);
    expect(prompt).toMatch(/Do not summarize/i);
  });

  it("handles a multi-line user prompt without mangling it", () => {
    const multiline = "line 1\nline 2\n  indented\n\nparagraph break";
    const prompt = buildDelegationPrompt("mimir", multiline);
    expect(prompt).toContain(multiline);
    // Boundaries preserved
    const beginIdx = prompt.indexOf("--- BEGIN USER PROMPT ---");
    const endIdx = prompt.indexOf("--- END USER PROMPT ---");
    expect(beginIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(beginIdx);
    const between = prompt.slice(beginIdx + "--- BEGIN USER PROMPT ---".length, endIdx);
    expect(between).toContain("line 1");
    expect(between).toContain("indented");
    expect(between).toContain("paragraph break");
  });

  it("handles a user prompt with special regex characters", () => {
    const tricky = "find files matching *.test.ts and use $VAR + (a|b)";
    const prompt = buildDelegationPrompt("mimir", tricky);
    expect(prompt).toContain(tricky);
  });
});