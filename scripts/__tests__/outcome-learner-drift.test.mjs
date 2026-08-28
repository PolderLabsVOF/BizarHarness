/**
 * Outcome-learner drift guard — IMP-020 / F-192.
 *
 * Verifies the source-level invariants that the rest of the harness
 * depends on:
 *
 *   1. `packages/sdk/src/router/outcome-learner.ts` exists and exports
 *      `OutcomeLearner`, `OutcomeSignal`, `OutcomeLearnerState`,
 *      `Posterior`, `ContextKey`, `createInMemoryOutcomeLearner`,
 *      `createFileOutcomeLearner`, and `newRoutingDecisionId`.
 *   2. `selectDispatchModel` carries the optional `outcomeLearner?: OutcomeLearner`
 *      parameter on its input type. Removing the parameter (or the learner
 *      module itself) is a regression that disables the F-192 contextual
 *      learning entirely.
 *   3. `decideAgentWith` (or its equivalent in `router/index.ts`) threads
 *      the `outcomeLearner` through to `selectDispatchModel`.
 *   4. No production code under `packages/sdk/src/` may import a test stub
 *      of the outcome learner (the learner is pure SDK; tests under
 *      `tests/` may import anything).
 *   5. The `failoverFrom` field on `FailoverVerdict` must remain so the
 *      IMP-018 evidence store can correlate per-attempt outcomes.
 *
 * Drift-probe: removing the `outcomeLearner` parameter from
 * `selectDispatchModel` causes test (2) to fail before the F-192
 * contract breaks at runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEARNER_PATH = join(REPO_ROOT, "packages", "sdk", "src", "router", "outcome-learner.ts");
const SELECTOR_PATH = join(REPO_ROOT, "packages", "sdk", "src", "router", "select-dispatch-model.ts");
const INDEX_PATH = join(REPO_ROOT, "packages", "sdk", "src", "router", "index.ts");
const FAILOVER_PATH = join(REPO_ROOT, "packages", "sdk", "src", "router", "failover.ts");

test("outcome-learner.ts exists and exports the IMP-020 contract surface", () => {
  assert.equal(existsSync(LEARNER_PATH), true, `${LEARNER_PATH} must exist`);
  const source = readFileSync(LEARNER_PATH, "utf8");
  for (const name of [
    "export interface ContextKey",
    "export interface OutcomeSignal",
    "export interface Posterior",
    "export interface OutcomeLearnerState",
    "export interface OutcomeLearner",
    "export function createInMemoryOutcomeLearner",
    "export function createFileOutcomeLearner",
    "export function newRoutingDecisionId",
  ]) {
    assert.ok(
      source.includes(name),
      `outcome-learner.ts must export ${name}`,
    );
  }
});

test("selectDispatchModel accepts the optional outcomeLearner parameter", () => {
  const source = readFileSync(SELECTOR_PATH, "utf8");
  assert.match(
    source,
    /outcomeLearner\??:\s*OutcomeLearner/,
    "selectDispatchModel must accept outcomeLearner?: OutcomeLearner",
  );
  assert.match(
    source,
    /outcomeLearner\?\s*:\s*OutcomeLearner/,
    "outcomeLearner parameter must be OPTIONAL so legacy callers keep working",
  );
  assert.match(
    source,
    /outcomeLearner\.ranking/,
    "selectDispatchModel must call outcomeLearner.ranking(...) to re-rank eligible candidates",
  );
});

test("router/index.ts surfaces OutcomeLearner and threads it through decideAgentWith", () => {
  const source = readFileSync(INDEX_PATH, "utf8");
  assert.match(
    source,
    /OutcomeLearner/,
    "router/index.ts must surface the OutcomeLearner type",
  );
  if (/export\s+function\s+decideAgentWith\s*[<(]/.test(source) || /export\s+const\s+decideAgentWith\s*[<(]/.test(source)) {
    assert.match(
      source,
      /outcomeLearner/,
      "decideAgentWith must accept and forward outcomeLearner",
    );
  }
});

test("FailoverVerdict retains the failoverFrom field (IMP-018 correlation)", () => {
  const source = readFileSync(FAILOVER_PATH, "utf8");
  assert.match(
    source,
    /failoverFrom:\s*string\[\]/,
    "FailoverVerdict must keep failoverFrom: string[]",
  );
});

test("no production source under packages/sdk/src/ imports a learner test stub", () => {
  const stubPatterns = [
    /from\s+["'][^"']*tests\/outcome-learner/,
    /from\s+["'][^"']*__tests__\/outcome-learner/,
    /require\(\s*["'][^"']*tests\/outcome-learner/,
    /require\(\s*["'][^"']*__tests__\/outcome-learner/,
  ];
  const hits = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".") || name === "dist" || name === "out") continue;
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) visit(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) {
        const src = readFileSync(full, "utf8");
        for (const pat of stubPatterns) {
          if (pat.test(src)) hits.push(full);
        }
      }
    }
  };
  visit(join(REPO_ROOT, "packages", "sdk", "src"));
  assert.deepEqual(
    hits,
    [],
    `production sources import a test stub of the outcome learner: ${hits.join(", ")}`,
  );
});