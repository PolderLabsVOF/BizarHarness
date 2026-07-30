/**
 * eval-gate.test.mjs — 6 tests for eval-gate.mjs
 *
 * Tests:
 *   1. passing-feature eval present → pass
 *   2. fail-rate threshold → fail
 *   3. missing eval with no tracked evidence → fail
 *   4. missing eval with commit-backed tracked evidence → pass
 *   5. malformed JSONL tolerated → pass
 *   6. dry-run mode → no exit failure
 */

import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EVALS_DIR = join(ROOT, ".harness", "evals");
const FEATURE_LIST_PATH = join(ROOT, "feature_list.json");

await mkdirSync(EVALS_DIR, { recursive: true });

/** Run eval-gate and return { stdout, stderr, exitCode } */
async function runGate(args = []) {
  const proc = spawnSync(process.env.BUN_BIN || "bun", [
    "run",
    join(__dirname, "eval-gate.mjs"),
    ...args,
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
  });
  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";
  const exitCode = proc.status ?? 1;
  return { stdout, stderr, exitCode };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function withFeatureList(/** @type {object[]} */ features, /** @type {() => Promise<void>} */ fn) {
  const orig = readFileSync(FEATURE_LIST_PATH, "utf-8");
  writeFileSync(FEATURE_LIST_PATH, JSON.stringify({ features }, null, 2), "utf-8");
  return fn().finally(() => writeFileSync(FEATURE_LIST_PATH, orig, "utf-8"));
}

// ── test 1: passing-feature eval present → pass ──────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-001.jsonl"), JSON.stringify({ passed: true }) + "\n");

await withFeatureList(
  [{ id: "F-001", behavior: "test feature", state: "passing", evidence: "commit abc" }],
  async () => {
    const r = await runGate(["--threshold=0.9"]);
    if (r.exitCode !== 0) {
      console.error("FAIL test_1: expected exit 0, got", r.exitCode);
      console.error(r.stdout);
      process.exit(1);
    }
    console.log("PASS test_1: passing-feature with eval present → pass");
  }
);

// ── test 2: fail-rate threshold → fail ───────────────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-002.jsonl"), [
  JSON.stringify({ passed: true }),
  JSON.stringify({ passed: true }),
  JSON.stringify({ passed: false }),
].join("\n"));

await withFeatureList(
  [{ id: "F-002", behavior: "test", state: "passing" }],
  async () => {
    const r = await runGate(["--threshold=0.9"]);
    if (r.exitCode === 0) {
      console.error("FAIL test_2: expected non-zero exit for failing threshold");
      process.exit(1);
    }
    console.log("PASS test_2: fail-rate below threshold → fail");
  }
);

// ── test 3: missing eval and tracked evidence flagged → fail ─────────────────

await withFeatureList(
  [{ id: "F-999", behavior: "test", state: "passing" }],
  async () => {
    const r = await runGate();
    if (r.exitCode === 0) {
      console.error("FAIL test_3: expected non-zero exit for missing eval");
      process.exit(1);
    }
    console.log("PASS test_3: missing eval and tracked evidence → fail");
  }
);

// ── test 4: tracked evidence is the clean-checkout fallback ──────────────────

await withFeatureList(
  [{
    id: "F-998",
    behavior: "test",
    state: "passing",
    evidence: "make check and make e2e passed",
    commit: "abc1234",
  }],
  async () => {
    const r = await runGate();
    if (r.exitCode !== 0) {
      console.error("FAIL test_4: commit-backed tracked evidence should pass");
      console.error(r.stdout);
      process.exit(1);
    }
    console.log("PASS test_4: commit-backed tracked evidence → pass");
  }
);

// ── test 5: malformed JSONL tolerated → pass ─────────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-003.jsonl"), [
  JSON.stringify({ passed: true }),
  "NOT JSON",
  JSON.stringify({ passed: true }),
  "",
].join("\n"));

await withFeatureList(
  [{ id: "F-003", behavior: "test", state: "passing" }],
  async () => {
    const r = await runGate();
    if (r.exitCode !== 0) {
      console.error("FAIL test_4: malformed JSONL should be tolerated");
      process.exit(1);
    }
    console.log("PASS test_5: malformed JSONL lines tolerated → pass");
  }
);

// ── test 6: dry-run mode ─────────────────────────────────────────────────────

await withFeatureList(
  [{ id: "F-001", behavior: "test", state: "passing" }],
  async () => {
    const r = await runGate(["--dry-run"]);
    if (r.exitCode !== 0) {
      console.error("FAIL test_6: dry-run should always exit 0");
      process.exit(1);
    }
    console.log("PASS test_6: dry-run exits 0 regardless of gate state");
  }
);

// ── cleanup ───────────────────────────────────────────────────────────────────

rmSync(join(EVALS_DIR, "F-001.jsonl"), { force: true });
rmSync(join(EVALS_DIR, "F-002.jsonl"), { force: true });
rmSync(join(EVALS_DIR, "F-003.jsonl"), { force: true });

console.log("\nAll 6 tests passed.");
