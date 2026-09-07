/**
 * SDK smoke tests — exercise the public surface.
 *
 * Run via:  npm run test:sdk
 *          (or: node --test packages/sdk/tests/sdk.test.mjs)
 *
 * Uses vitest. The suite covers:
 *   - dist artefacts present after build:sdk
 *   - package.json exports map
 *   - SDK module surfaces (fingerprint, dangerous-patterns, mcp)
 *   - dangerous-pattern behaviour (rm -rf / denied)
 *   - fingerprint stability
 */

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(here, "..", "dist");
const pkgPath = join(here, "..", "package.json");

describe("SDK build", () => {
  test("all dist artefacts present", () => {
    for (const f of [
      "index.js", "index.d.ts",
      "dangerous-patterns.js", "dangerous-patterns.d.ts",
      "fingerprint.js", "fingerprint.d.ts",
      "mcp/server.js", "mcp/server.d.ts",
      "mcp/bin.js", "mcp/bin.d.ts",
      // v10.1.1 — F-034 Self-Learning (Pillar D): instincts + decisions.
      "learning/index.js", "learning/index.d.ts",
      "learning/instincts.js", "learning/instincts.d.ts",
      "learning/decisions.js", "learning/decisions.d.ts",
    ]) {
      expect(existsSync(join(distDir, f))).toBe(true);
    }
  });

  test("package.json exports map declares the retained public modules", async () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@polderlabs/bizar-sdk");
    expect(pkg.exports["."]).toBeTruthy();
    expect(pkg.exports["./memory"]).toBeUndefined();
    expect(pkg.exports["./mcp"]).toBeTruthy();
    expect(pkg.exports["./dangerous-patterns"]).toBeTruthy();
  });
});

describe("SDK module surface", () => {
  test("dangerous-patterns module exports the expected API", async () => {
    const mod = await import("../dist/dangerous-patterns.js");
    expect(typeof mod.checkDangerous).toBe("function");
    expect(typeof mod.listDangerousPatterns).toBe("function");
    expect(typeof mod.getDangerousPatternStats).toBe("function");
  });

  test("fingerprint module exports a function", async () => {
    const mod = await import("../dist/fingerprint.js");
    expect(typeof mod.fingerprint).toBe("function");
  });

  test("MCP server module exposes only the retained tool surface", async () => {
    const mod = await import("../dist/mcp/server.js");
    expect(Array.isArray(mod.BIZAR_TOOLS)).toBe(true);
    // 13 retained tools + 5 OMX Phase 1 scaffolding tools (F-202):
    //   ambiguity_score, deep_interview_status, ultragoal_status,
    //   ultragoal_steer, plus the bizplan-overhaul trio
    //   (bizplan_validate, bizplan_persist, bizplan_spawn_task) replacing
    //   the retired `ralplan_handoff_validate`.
    // The gateway inventory tool was removed with the model-selection
    // SDK surface in Phase 2 of the OmniRoute alias routing overhaul.
    expect(mod.BIZAR_TOOLS.length).toBe(20);
    expect(typeof mod.createBizarMcpServer).toBe("function");
    expect(typeof mod.createBizarMcpServerConfig).toBe("function");
    expect(typeof mod.defineTool).toBe("function");
    expect(typeof mod.getBizarMcpToolSummary).toBe("function");

    const expectedNames = new Set([
      "plan_action",
      "loop_list", "loop_status", "loop_start", "loop_stop",
      "graph_query", "graph_path",
      // Pillar D — read-back tools added in v10.3.0 audit cleanup.
      "list_instincts", "list_decisions",
      // F-146 — agent-facing CLI wrappers.
      "bizar_task", "bizar_workflow", "bizar_control",
      "bizar_audit",
      // F-202 Phase 1 — OMX adoption scaffolding tools.
      "ambiguity_score",
      "deep_interview_status",
      "ultragoal_status",
      "ultragoal_steer",
      // bizplan-overhaul — the only planning surface in Bizar.
      "bizplan_validate",
      "bizplan_persist",
      "bizplan_spawn_task",
    ]);
    const have = new Set(mod.BIZAR_TOOLS.map((t) => t.name));
    for (const n of expectedNames) {
      expect(have.has(n)).toBe(true);
    }
    // The retired `ralplan_handoff_validate` must NOT appear in the
    // retained surface; this is the canonical bizplan-overhaul gate.
    expect(have.has("ralplan_handoff_validate")).toBe(false);
  });
});

describe("dangerous-patterns behaviour", () => {
  test("denies rm -rf /", async () => {
    const { checkDangerous } = await import("../dist/dangerous-patterns.js");
    const result = checkDangerous("rm -rf /");
    expect(result.decision).toBe("deny");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("allows echo", async () => {
    const { checkDangerous } = await import("../dist/dangerous-patterns.js");
    const result = checkDangerous("echo hello world");
    expect(result.decision).toBe("allow");
  });
});

describe("fingerprint stability", () => {
  test("same input produces same fingerprint", async () => {
    const { fingerprint } = await import("../dist/fingerprint.js");
    const a = fingerprint("Bash", { command: "ls -la /tmp" });
    const b = fingerprint("Bash", { command: "ls -la /tmp" });
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThanOrEqual(16);
  });

  test("different tools produce different fingerprints", async () => {
    const { fingerprint } = await import("../dist/fingerprint.js");
    const a = fingerprint("Bash", { command: "ls" });
    const b = fingerprint("Edit", { command: "ls" });
    expect(a).not.toBe(b);
  });
});
