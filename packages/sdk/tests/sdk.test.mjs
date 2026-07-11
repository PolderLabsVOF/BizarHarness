/**
 * SDK smoke tests — exercise the public surface.
 *
 * Run via:  npm run test:sdk
 *          (or: node --test packages/sdk/tests/sdk.test.mjs)
 *
 * Uses vitest. The suite covers:
 *   - dist artefacts present after build:sdk
 *   - package.json exports map
 *   - SDK module surfaces (memory, fingerprint, dangerous-patterns, mcp)
 *   - dangerous-pattern behaviour (rm -rf / denied)
 *   - fingerprint stability
 *   - frontmatter round-trip
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
      "memory/index.js", "memory/index.d.ts",
      "mcp/server.js", "mcp/server.d.ts",
      "mcp/bin.js", "mcp/bin.d.ts",
    ]) {
      expect(existsSync(join(distDir, f))).toBe(true);
    }
  });

  test("package.json exports map declares memory, mcp, dangerous-patterns", async () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@polderlabs/bizar-sdk");
    expect(pkg.exports["."]).toBeTruthy();
    expect(pkg.exports["./memory"]).toBeTruthy();
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

  test("memory module exports vault helpers", async () => {
    const mod = await import("../dist/memory/index.js");
    expect(typeof mod.readNote).toBe("function");
    expect(typeof mod.writeNote).toBe("function");
    expect(typeof mod.listNotes).toBe("function");
    expect(typeof mod.searchNotes).toBe("function");
    expect(typeof mod.parseFrontmatter).toBe("function");
    expect(typeof mod.serializeFrontmatter).toBe("function");
    expect(typeof mod.resolveVaultRoot).toBe("function");
    expect(typeof mod.DEFAULT_MEMORY_VAULT).toBe("string");
  });

  test("MCP server module exposes ≥13 BIZAR_TOOLS", async () => {
    const mod = await import("../dist/mcp/server.js");
    expect(Array.isArray(mod.BIZAR_TOOLS)).toBe(true);
    expect(mod.BIZAR_TOOLS.length).toBeGreaterThanOrEqual(13);
    expect(typeof mod.createBizarMcpServer).toBe("function");
    expect(typeof mod.createBizarMcpServerConfig).toBe("function");
    expect(typeof mod.defineTool).toBe("function");
    expect(typeof mod.getBizarMcpToolSummary).toBe("function");

    const expectedNames = new Set([
      "memory_read", "memory_write", "memory_list", "memory_search",
      "plan_action", "open_kb",
      "loop_list", "loop_status", "loop_start", "loop_stop",
      "graph_query", "graph_path", "danger_check",
    ]);
    const have = new Set(mod.BIZAR_TOOLS.map((t) => t.name));
    for (const n of expectedNames) {
      expect(have.has(n)).toBe(true);
    }
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

describe("frontmatter round-trip", () => {
  test("parses simple values", async () => {
    const { parseFrontmatter } = await import("../dist/memory/index.js");
    const md = "---\ntitle: Test\ncount: 3\n---\nHello world";
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter.title).toBe("Test");
    expect(parsed.frontmatter.count).toBe("3");
    expect(parsed.body.trim()).toBe("Hello world");
  });

  test("serialize + parse preserves array form", async () => {
    const { parseFrontmatter, serializeFrontmatter } = await import("../dist/memory/index.js");
    const md = serializeFrontmatter({ title: "Test", tags: ["a", "b"] }, "\nbody");
    expect(md.startsWith("---")).toBe(true);
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter.title).toBe("Test");
    expect(md.includes("tags: [a, b]")).toBe(true);
  });
});
