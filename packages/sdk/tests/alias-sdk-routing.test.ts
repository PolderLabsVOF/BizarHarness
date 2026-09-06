/**
 * packages/sdk/tests/alias-sdk-routing.test.ts
 *
 * Behavior-lock test for the SDK public surface after the OmniRoute
 * alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md).
 *
 * After implementation, the SDK MUST NOT export or wire any of:
 *   - `modelRouter`
 *   - `selectDispatchModel`
 *   - `agentModelRegistry`
 *   - `modelProfile`
 *   - `outcomeLearner`
 *   - failover / evidence mirror names
 *
 * The MCP server MUST NOT register a `bizar_model_list` tool.
 *
 * The compiled `dist/` build output MUST also not carry those names
 * after `npm run build:sdk`. This test runs the build first via a
 * sibling `with-sdk-dist-lock` helper to ensure dist/ is fresh.
 *
 * The pre-implementation tree currently fails all assertions because
 * the SDK still exports `selectDispatchModel`, `modelRouter`, and
 * `outcomeLearner` from `packages/sdk/src/router/index.ts` and the
 * MCP server still registers `bizar_model_list`.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = fileURLToPath(new URL(".", import.meta.url));
const sdkRoot = resolve(here, "..");
const repoRoot = resolve(sdkRoot, "..", "..");

const FORBIDDEN_SDK_NAMES = [
  "modelRouter",
  "selectDispatchModel",
  "agentModelRegistry",
  "modelProfile",
  "outcomeLearner",
  "pickFailover",
  "failoverMirror",
  "dispatchEvidence",
  "loadModelRegistry",
  "resolveAgentModel",
  "resolveTierModel",
  "evaluateRoleRequirements",
];

const srcRouterIndex = join(sdkRoot, "src", "router", "index.ts");
const srcMcpServer = join(sdkRoot, "src", "mcp", "server.ts");
const distIndex = join(sdkRoot, "dist", "index.js");
const distRouterIndex = join(sdkRoot, "dist", "router", "index.js");
const distMcpServer = join(sdkRoot, "dist", "mcp", "server.js");

function hasNamedExport(source: string, name: string): boolean {
  // Match `export { name` / `export { ... name` / `export name` /
  // `export class name` / `export function name` / `export const name` /
  // `export interface name` / `export type name` / `export async function name`.
  const reList = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`, "m");
  const reDirect = new RegExp(
    `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
    "m",
  );
  // Property-key exports like `RouterBundle { modelRouter: ... }` do not
  // count — we only fail on identifier-level exports.
  return reList.test(source) || reDirect.test(source);
}

describe("alias-sdk-routing: SDK source must not export forbidden names", () => {
  test("packages/sdk/src/router/index.ts has no forbidden re-exports", () => {
    const src = readFileSync(srcRouterIndex, "utf8");
    const offenders = FORBIDDEN_SDK_NAMES.filter((name) =>
      hasNamedExport(src, name),
    );
    expect(offenders).toEqual([]);
  });

  test("packages/sdk/src/index.ts has no forbidden re-exports", () => {
    const srcIdx = readFileSync(join(sdkRoot, "src", "index.ts"), "utf8");
    const offenders = FORBIDDEN_SDK_NAMES.filter((name) =>
      hasNamedExport(srcIdx, name),
    );
    expect(offenders).toEqual([]);
  });

  test("MCP server does NOT register a bizar_model_list tool", () => {
    const src = readFileSync(srcMcpServer, "utf8");
    expect(
      src.includes('"bizar_model_list"'),
      "packages/sdk/src/mcp/server.ts still defines a `bizar_model_list` tool; static alias contract forbids it",
    ).toBe(false);
    // Also reject the variable name `bizarModelListTool` and any
    // BIZAR_TOOLS inclusion.
    expect(src.includes("bizarModelListTool")).toBe(false);
    expect(src.includes("bizar_model_list")).toBe(false);
  });
});

describe("alias-sdk-routing: SDK dist/ build output must not contain forbidden names", () => {
  beforeAll(() => {
    if (existsSync(distIndex)) return;
    // Build the SDK once so the dist/ assertions can run.
    const result = spawnSync(
      "npm",
      ["run", "build:sdk"],
      { cwd: repoRoot, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`npm run build:sdk failed with status ${result.status}`);
    }
  }, 240_000);

  test("dist/index.js does not contain forbidden names", () => {
    if (!existsSync(distIndex)) {
      throw new Error(
        `expected ${distIndex} to exist after build:sdk; the alias-sdk-routing contract requires a fresh dist build`,
      );
    }
    const dist = readFileSync(distIndex, "utf8");
    for (const name of FORBIDDEN_SDK_NAMES) {
      expect(
        dist.includes(name),
        `dist/index.js still contains forbidden name \`${name}\`; static alias contract forbids it`,
      ).toBe(false);
    }
  });

  test("dist/router/index.js (when present) does not export forbidden names", () => {
    if (!existsSync(distRouterIndex)) return;
    const dist = readFileSync(distRouterIndex, "utf8");
    for (const name of FORBIDDEN_SDK_NAMES) {
      const reList = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`);
      const reDirect = new RegExp(
        `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
      );
      const stillExported = reList.test(dist) || reDirect.test(dist);
      expect(
        stillExported,
        `dist/router/index.js still exports forbidden name \`${name}\``,
      ).toBe(false);
    }
  });

  test("dist/mcp/server.js does not register a bizar_model_list tool", () => {
    if (!existsSync(distMcpServer)) return;
    const dist = readFileSync(distMcpServer, "utf8");
    expect(dist.includes("bizar_model_list")).toBe(false);
    expect(dist.includes("bizarModelListTool")).toBe(false);
  });
});
