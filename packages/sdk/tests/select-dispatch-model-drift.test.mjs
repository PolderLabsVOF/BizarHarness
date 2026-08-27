/**
 * Drift guard for the central dispatch-model selector (F-188 / IMP-013).
 *
 * Every dispatch surface (workflow `agent()` wrapper, direct Agent tool
 * invocations, team-member spawns) MUST go through `selectDispatchModel`
 * — never reach into `evaluateRoleRequirements` or `pickFailover`
 * directly. This test pins that contract by scanning
 * `packages/sdk/src/` for the bypass pattern.
 *
 * The whitelist (these files are ALLOWED to call the primitives):
 *
 *   - `select-dispatch-model.ts` — the central selector itself; it is
 *     the canonical entry point and consumes both primitives.
 *   - `failover.ts` — `pickFailover` is defined here.
 *   - `agent-model-registry.ts` — `evaluateRoleRequirements` is
 *     defined here.
 *   - `failover-mirror.mjs` — JS mirror of `failover.ts` for the CLI;
 *     also a definition site, not a caller.
 *   - `index.ts` — the orchestrator that re-exports `selectDispatchModel`
 *     and is itself the canonical F-188 entry point; it does NOT call
 *     `evaluateRoleRequirements` or `pickFailover` directly.
 *
 * Any other `packages/sdk/src/` file that imports or references
 * `evaluateRoleRequirements` or `pickFailover` is a bypass and fails
 * CI on the first commit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SDK_SRC_DIR = join(import.meta.dirname, "..", "src");
const WHITELIST = new Set([
  "select-dispatch-model.ts",
  "failover.ts",
  "failover-mirror.mjs",
  "agent-model-registry.ts",
  "index.ts",
]);

const BYPASS_PATTERNS = [
  /\bevaluateRoleRequirements\s*\(/,
  /\bpickFailover\s*\(/,
];

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|mjs|cjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function isBypass(filePath, contents) {
  for (const pattern of BYPASS_PATTERNS) {
    if (!pattern.test(contents)) continue;
    // Skip the file's own definition line: the declaration is the
    // only valid occurrence in definition-site files. We allow ANY
    // reference in whitelist files (definition sites + index.ts
    // re-export + the selector itself).
    const baseName = filePath.split("/").pop();
    if (WHITELIST.has(baseName)) continue;
    return { pattern: pattern.source, baseName };
  }
  return null;
}

describe("selectDispatchModel drift guard (F-188 / IMP-013)", () => {
  it("rejects any packages/sdk/src/ file that calls evaluateRoleRequirements or pickFailover outside the whitelist", () => {
    const files = walk(SDK_SRC_DIR, []);
    const violations = [];
    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      const bypass = isBypass(file, contents);
      if (bypass) {
        violations.push({ file: file.replace(SDK_SRC_DIR + "/", ""), pattern: bypass.pattern });
      }
    }
    if (violations.length > 0) {
      const summary = violations.map((v) => `${v.file}: ${v.pattern}`).join("\n  - ");
      throw new Error(
        `Central selector bypass detected. These files must import selectDispatchModel instead of calling ${BYPASS_PATTERNS.map((p) => p.source).join(" / ")}:\n  - ${summary}\nWhitelist: ${[...WHITELIST].join(", ")}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("pins the whitelist so the drift guard itself is auditable", () => {
    expect(WHITELIST.has("select-dispatch-model.ts")).toBe(true);
    expect(WHITELIST.has("failover.ts")).toBe(true);
    expect(WHITELIST.has("failover-mirror.mjs")).toBe(true);
    expect(WHITELIST.has("agent-model-registry.ts")).toBe(true);
    expect(WHITELIST.has("index.ts")).toBe(true);
  });
});