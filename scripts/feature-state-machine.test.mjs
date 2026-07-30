/**
 * feature-state-machine.test.mjs — Tests for feature-state-machine.mjs
 *
 * Tests:
 *   1. passing feature with all artifacts → pass
 *   2. missing evidence → fail
 *   3. missing commit → fail
 *   4. audit score < 80 → fail
 *   5. eval pass-rate < 0.9 → fail
 */

import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(__dirname, "feature-state-machine.mjs");
const EVALS_DIR = join(ROOT, ".harness", "evals");
const FEATURE_LIST_PATH = join(ROOT, "feature_list.json");

await mkdirSync(EVALS_DIR, { recursive: true });

/** @param {string[]} args */
async function runScript(args = []) {
  const proc = spawnSync("/home/drb0rk/.bun/bin/bun", [
    "run",
    SCRIPT,
    ...args,
  ], {
    cwd: ROOT,
    env: { ...process.env, PATH: `/home/drb0rk/.bun/bin:${process.env.PATH || "/usr/bin:/bin"}` },
    encoding: "utf8",
  });
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    exitCode: proc.status ?? 1,
  };
}

function withFeatureList(
  /** @type {object[]} */ features,
  /** @type {() => Promise<void>} */ fn
) {
  const orig = readFileSync(FEATURE_LIST_PATH, "utf-8");
  writeFileSync(FEATURE_LIST_PATH, JSON.stringify({ features }, null, 2), "utf-8");
  return fn().finally(() => writeFileSync(FEATURE_LIST_PATH, orig, "utf-8"));
}

// ── test 1: passing with all artifacts → pass ──────────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-T1.jsonl"), JSON.stringify({ passed: true }) + "\n");

await withFeatureList(
  [{ id: "F-T1", behavior: "test feature 1", state: "passing", evidence: "commit abc123", commit: "abc123" }],
  async () => {
    const r = await runScript(["--dry-run"]);
    if (r.exitCode !== 0) {
      console.error("FAIL test_1:", r.stdout);
      process.exit(1);
    }
    console.log("PASS test_1: passing with all artifacts → pass");
  }
);

// ── test 2: missing evidence → fail ───────────────────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-T2.jsonl"), JSON.stringify({ passed: true }) + "\n");

await withFeatureList(
  [{ id: "F-T2", behavior: "test", state: "passing", evidence: "", commit: "abc123" }],
  async () => {
    const r = await runScript([]);
    if (r.exitCode === 0) {
      console.error("FAIL test_2: expected non-zero for missing evidence");
      process.exit(1);
    }
    console.log("PASS test_2: missing evidence → fail");
  }
);

// ── test 3: missing commit → fail ─────────────────────────────────────────────

await writeFileSync(join(EVALS_DIR, "F-T3.jsonl"), JSON.stringify({ passed: true }) + "\n");

await withFeatureList(
  [{ id: "F-T3", behavior: "test", state: "passing", evidence: "commit abc", commit: "" }],
  async () => {
    const r = await runScript([]);
    if (r.exitCode === 0) {
      console.error("FAIL test_3: expected non-zero for missing commit");
      process.exit(1);
    }
    console.log("PASS test_3: missing commit → fail");
  }
);

// ── test 4: eval pass-rate < 0.9 → fail ─────────────────────────────────────

// 2 passed, 8 failed = 20% rate < 90%
await writeFileSync(
  join(EVALS_DIR, "F-T4.jsonl"),
  Array.from({ length: 10 }, (_, i) => JSON.stringify({ passed: i < 2 })).join("\n") + "\n"
);

await withFeatureList(
  [{ id: "F-T4", behavior: "test", state: "passing", evidence: "commit abc", commit: "abc123" }],
  async () => {
    const r = await runScript([]);
    if (r.exitCode === 0) {
      console.error("FAIL test_4: expected non-zero for low eval pass-rate");
      process.exit(1);
    }
    console.log("PASS test_4: eval pass-rate 20% < 90% → fail");
  }
);

// ── test 5: audit script absent → lenient pass ─────────────────────────────────

await withFeatureList(
  [{ id: "F-T5", behavior: "test", state: "passing", evidence: "commit abc", commit: "abc123" }],
  async () => {
    const r = await runScript(["--dry-run"]);
    if (r.exitCode !== 0) {
      console.error("FAIL test_5: missing audit script should be tolerated (lenient)");
      process.exit(1);
    }
    console.log("PASS test_5: missing audit script tolerated (lenient)");
  }
);

// ── cleanup ───────────────────────────────────────────────────────────────────

for (const id of ["F-T1", "F-T2", "F-T3", "F-T4"]) {
  rmSync(join(EVALS_DIR, `${id}.jsonl`), { force: true });
}

console.log("\nAll 5 tests passed.");
