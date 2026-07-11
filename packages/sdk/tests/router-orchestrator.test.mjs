/**
 * Tests for the router orchestrator (F-033).
 *
 * Verifies the precedence chain:
 *   explicit > codemod > q-learning > bandit > default
 *
 * Plus the surfaced-tags contract:
 *   [CODEMOD_AVAILABLE] <intent>
 *   [TASK_MODEL_RECOMMENDATION] <tier>
 *
 * Plus persistence: saveTo() writes state files; loadFrom() rehydrates
 * the same priors.
 */

import { describe, test, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decideAgentWith,
  getRouter,
  ModelRouter,
  QLearningRouter,
  codemodTag,
  tierTag,
  DEFAULT_MODEL_STATE_PATH,
  DEFAULT_Q_STATE_PATH,
} from "../src/router/index.js";

describe("decideAgentWith — precedence chain", () => {
  test("explicit agent wins (when known)", () => {
    const mr = new ModelRouter({ seed: 42 });
    const qr = new QLearningRouter({ seed: 42 });
    const d = decideAgentWith(mr, qr, {
      task: "convert var to const",
      explicitAgent: "odin",
    });
    expect(d.agent).toBe("odin");
    expect(d.agentConfidence).toBe(1.0);
    expect(d.codemodIntent).toBeNull();
    // Explicit path still emits a [TASK_MODEL_RECOMMENDATION] tag.
    expect(d.surfacedTags.some((t) => t.startsWith("[TASK_MODEL_RECOMMENDATION]"))).toBe(true);
    expect(d.surfacedTags.some((t) => t.startsWith("[CODEMOD_AVAILABLE]"))).toBe(false);
  });

  test("codemod intent short-circuits before q-learning", () => {
    const mr = new ModelRouter({ seed: 42 });
    const qr = new QLearningRouter({ seed: 42 });
    const d = decideAgentWith(mr, qr, { task: "convert var to const" });
    expect(d.agent).toBe("heimdall");
    expect(d.agentConfidence).toBe(1.0);
    expect(d.codemodIntent).toBe("var-to-const");
    expect(d.modelTier).toBe("flash");
    // Both tags should be surfaced for a codemod hit.
    expect(d.surfacedTags.some((t) => t.includes("CODEMOD_AVAILABLE"))).toBe(true);
    expect(d.surfacedTags.some((t) => t.includes("TASK_MODEL_RECOMMENDATION"))).toBe(true);
  });

  test("non-codemod task routes via q-learning + bandit", () => {
    const mr = new ModelRouter({ seed: 42 });
    const qr = new QLearningRouter({ seed: 42 });
    const d = decideAgentWith(mr, qr, { task: "design a database schema" });
    expect(["odin", "frigg", "vor", "mimir", "heimdall", "thor", "tyr", "forseti"])
      .toContain(d.agent);
    expect(d.codemodIntent).toBeNull();
    expect(["flash", "mid", "expensive"]).toContain(d.modelTier);
    expect(d.surfacedTags.length).toBe(1);
    expect(d.surfacedTags[0]).toMatch(/^\[TASK_MODEL_RECOMMENDATION\]/);
  });

  test("unknown explicit agent falls through to q-learning", () => {
    const mr = new ModelRouter({ seed: 42 });
    const qr = new QLearningRouter({ seed: 42 });
    const d = decideAgentWith(mr, qr, { task: "hello world", explicitAgent: "totally-unknown" });
    expect(d.agent).not.toBe("totally-unknown");
    expect(AGENT_SET.has(d.agent)).toBe(true);
  });
});

const AGENT_SET = new Set(["odin", "frigg", "vor", "mimir", "heimdall", "thor", "tyr", "forseti"]);

describe("tag formatters", () => {
  test("codemodTag includes intent and confidence", () => {
    const tag = codemodTag("var-to-const", 0.71);
    expect(tag).toContain("[CODEMOD_AVAILABLE]");
    expect(tag).toContain("var-to-const");
    expect(tag).toMatch(/conf=0\.71/);
  });

  test("tierTag includes tier and confidence", () => {
    const tag = tierTag({ tier: "flash", confidence: 0.42 });
    expect(tag).toContain("[TASK_MODEL_RECOMMENDATION]");
    expect(tag).toContain("flash");
    expect(tag).toMatch(/conf=0\.42/);
  });
});

describe("getRouter() — factory + persistence", () => {
  test("with custom routers is in-memory only", () => {
    const mr = new ModelRouter({ seed: 1 });
    const qr = new QLearningRouter({ seed: 1 });
    const bundle = getRouter({ modelRouter: mr, qRouter: qr });
    expect(bundle.modelRouter).toBe(mr);
    expect(bundle.qRouter).toBe(qr);
    const d = bundle.decideAgent({ task: "convert var to const" });
    expect(d.codemodIntent).toBe("var-to-const");
  });

  test("default state paths are .harness/router-state.{model,q}", () => {
    expect(DEFAULT_MODEL_STATE_PATH).toBe(".harness/router-state.json");
    expect(DEFAULT_Q_STATE_PATH).toBe(".harness/q-router-state.json");
  });

  test("saveTo writes the bundle pointer + per-router state files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizar-router-"));
    try {
      const mr = new ModelRouter({ seed: 5 });
      const qr = new QLearningRouter({ seed: 5 });
      // Force the persistence files into a temp dir by manipulating
      // the bundle basePath through saveTo's sibling files.
      const bundle = getRouter({ modelRouter: mr, qRouter: qr });
      // Override the cwd-derived basePath so the save lands in `dir`.
      const basePath = join(dir, "router-state");
      const modelPath = `${basePath}.model`;
      const qPath = `${basePath}.q`;
      mr.saveTo(modelPath);
      qr.saveTo(qPath);
      expect(existsSync(modelPath)).toBe(true);
      expect(existsSync(qPath)).toBe(true);
      const state = JSON.parse(readFileSync(modelPath, "utf-8"));
      expect(state.version).toBe(1);
      expect(state.priors.flash.alpha).toBe(2);
    } finally {
      // mkdtempSync + recursive rm
      const { rmSync } = require("node:fs");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ModelRouter.loadFrom rehydrates priors", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizar-router-"));
    try {
      const fp = join(dir, "router.json");
      const original = new ModelRouter({ seed: 42 });
      original.recordOutcome("flash", true);
      original.recordOutcome("flash", true);
      original.saveTo(fp);

      const loaded = ModelRouter.loadFrom(fp);
      const priors = loaded.getPriors();
      expect(priors.flash.alpha).toBeGreaterThan(2);
    } finally {
      const { rmSync } = require("node:fs");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("decideAgent — codemod short-circuit covers all three intents", () => {
  test.each([
    ["convert var to const", "var-to-const"],
    ["remove console.log calls", "remove-console"],
    ["add logging to the handler", "add-logging"],
  ])("codemod surface for: %s", (prompt, expected) => {
    const mr = new ModelRouter({ seed: 42 });
    const qr = new QLearningRouter({ seed: 42 });
    const d = decideAgentWith(mr, qr, { task: prompt });
    expect(d.codemodIntent).toBe(expected);
    expect(d.agent).toBe("heimdall");
  });
});
