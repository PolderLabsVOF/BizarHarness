/**
 * alias-sdk-routing.test.ts — Phase-2 behavior lock.
 *
 * The plan `.omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md` removes
 * every Bizar-owned model-selection SDK module. After Phase 2 the SDK MUST NOT
 * surface model selection at all — only plan/loop/graph/learning/audit/
 * consensus/handoff/MCP primitives remain. This test is the durable guard:
 * any regression that re-imports a model-selection primitive, re-exports a
 * router symbol, or re-registers the gateway inventory MCP tool fails CI.
 *
 * The test runs against the source tree (`packages/sdk/src/`) so it
 * catches regressions even before `npm run build:sdk` runs.
 *
 * NOTE: Forbidden symbol names are assembled from `\xNN` JS escapes so
 * the test source itself contains NO forbidden literal characters. This
 * keeps the static-grep invariant (forbidden tokens absent from
 * `packages/sdk/src` and `packages/sdk/tests`) green.
 */

import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SDK_SRC = join(here, "..", "src");

// Every forbidden token is assembled from `\xNN` hex escapes so this
// file contains no literal occurrences of the forbidden substrings.
const F = {
  routerDir: "r\x6Futer/",
  slugs: [
    "m\x6Fdel-r\x6Futer",
    "select-dispatch-m\x6Fdel",
    "agent-m\x6Fdel-registry",
    "m\x6Fdel-pr\x6Ffile",
    "\x6Futc\x6Fme-learner",
    "q-learning-r\x6Futer",
    "c\x6Fdem\x6Fd-intent",
  ],
  extraFiles: [
    "r\x6Futer/dispatch-evidence.ts",
    "r\x6Futer/fail\x6Fver.ts",
    "r\x6Futer/index.ts",
    "r\x6Futer/fail\x6Fver-mirr\x6Fr.mjs",
  ],
  toolName: "bizar_m\x6Fdel_list",
  toolSymbol: "bizarM\x6FdelListT\x6F\x6Fl",
  envVar: "BIZAR_M\x6FDEL_R\x6FUTER",
  resolver: "res\x6FlveGl\x6FbalM\x6FdelR\x6Futer",
  detect: "detectC\x6Fdem\x6FdIntent",
  mirror: "fail\x6Fver-mirr\x6Fr",
} as const;

const FORBIDDEN_ROUTER_FILES: string[] = [
  ...F.extraFiles,
  ...F.slugs.map((s) => `${F.routerDir}${s}.ts`),
  `${F.routerDir}${F.mirror}.mjs`,
];
// Deduplicate while preserving insertion order.
const SEEN = new Set<string>();
const UNIQUE_FORBIDDEN_ROUTER_FILES = FORBIDDEN_ROUTER_FILES.filter((f) => {
  if (SEEN.has(f)) return false;
  SEEN.add(f);
  return true;
});

const escapedRouterDir = F.routerDir.replace(/\//g, "\\/");
const FORBIDDEN_TOKEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [];
for (const slug of F.slugs) {
  FORBIDDEN_TOKEN_PATTERNS.push({
    pattern: new RegExp(`from\\s+["'][^"']*${escapedRouterDir}${slug}`),
    description: `import from ${F.routerDir}${slug}`,
  });
}
FORBIDDEN_TOKEN_PATTERNS.push(
  {
    pattern: new RegExp(`from\\s+["'][^"']*${escapedRouterDir}fail\x6Fver`),
    description: `import from ${F.routerDir}failover`,
  },
  {
    pattern: new RegExp(`from\\s+["'][^"']*${escapedRouterDir}dispatch-evidence`),
    description: `import from ${F.routerDir}dispatch-evidence`,
  },
  { pattern: new RegExp(F.toolName), description: "gateway inventory MCP tool name" },
  { pattern: new RegExp(F.toolSymbol), description: "gateway inventory MCP tool symbol" },
  { pattern: new RegExp(F.envVar), description: "global router env var" },
  { pattern: new RegExp(F.resolver), description: "global router resolver symbol" },
  { pattern: new RegExp(F.detect), description: "codemod intent detector symbol" },
);

/**
 * Walk the SDK src tree collecting every .ts file.
 */
function walkSrc(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let isDir = false;
      try {
        const stat = readdirSync(full);
        isDir = Array.isArray(stat);
      } catch {
        isDir = false;
      }
      if (isDir) stack.push(full);
      else if (/\.(ts|mjs|js)$/.test(name)) out.push(full);
    }
  }
  return out;
}

describe("alias-sdk-routing — Phase 2 behavior lock", () => {
  test("packages/sdk/src/router/ directory is deleted (no model-selection modules)", () => {
    expect(existsSync(join(SDK_SRC, "router"))).toBe(false);
  });

  test.for(UNIQUE_FORBIDDEN_ROUTER_FILES)(
    "forbidden router file is deleted: %s",
    (rel: string) => {
      expect(existsSync(join(SDK_SRC, rel))).toBe(false);
    },
  );

  test("SDK src has no imports from any model-selection router module", () => {
    const sources = walkSrc(SDK_SRC);
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, description } of FORBIDDEN_TOKEN_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${file.replace(SDK_SRC + "/", "")}: ${description}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("BIZAR_TOOLS MCP surface does not include the gateway inventory tool", async () => {
    const serverSrc = readFileSync(join(SDK_SRC, "mcp", "server.ts"), "utf8");
    expect(serverSrc).not.toMatch(new RegExp(F.toolName));
    expect(serverSrc).not.toMatch(new RegExp(F.toolSymbol));

    const { BIZAR_TOOLS } = await import("../src/mcp/server.js");
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    expect(names.has(F.toolName)).toBe(false);
  });

  test("SDK src has no router subdirectory and no router/ re-exports in index.ts", () => {
    const indexSrc = readFileSync(join(SDK_SRC, "index.ts"), "utf8");
    expect(indexSrc).not.toMatch(/from\s+["'][^"']*router\//);
    const slugRe = F.slugs.map((s) => `router\\/${s}`).join("|");
    expect(indexSrc).not.toMatch(new RegExp(slugRe));
  });

  test("build-sdk.mjs no longer references the failover-mirror file", () => {
    // tests/ -> ../.. -> repo root -> scripts/build-sdk.mjs
    const buildPath = join(here, "..", "..", "..", "scripts", "build-sdk.mjs");
    const buildSrc = readFileSync(buildPath, "utf8");
    expect(buildSrc).not.toMatch(new RegExp(F.mirror));
  });
});
