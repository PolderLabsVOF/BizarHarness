/**
 * eval-gate.mjs — Verify passing features have reproducible evidence.
 *
 * For each feature with state === "passing", checks that:
 *   1. A local .harness/evals/<id>.jsonl record meets the pass-rate threshold,
 *      when that ignored runtime artifact exists; or
 *   2. The tracked feature ledger contains both evidence and a commit hash.
 *
 * Usage:
 *   bun run scripts/eval-gate.mjs [--threshold=0.9] [--dry-run] [--json]
 *   make eval-gate
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FEATURE_LIST_PATH = join(ROOT, "feature_list.json");
const EVALS_DIR = join(ROOT, ".harness", "evals");

const DEFAULT_THRESHOLD = 0.9;

function readJson(/** @type {string} */ path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * @param {{ id: string, behavior: string, state: string, evidence?: string, commit?: string }} feature
 * @param {number} threshold
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
function checkFeature(feature, threshold) {
  if (feature.state !== "passing") {
    return { ok: true };
  }

  const evalPath = join(EVALS_DIR, `${feature.id}.jsonl`);

  if (!existsSync(evalPath)) {
    if (feature.evidence?.trim() && feature.commit?.trim()) {
      return { ok: true };
    }
    return { ok: false, reason: "eval file not found", detail: evalPath };
  }

  let content;
  try {
    content = readFileSync(evalPath, "utf-8");
  } catch {
    return { ok: false, reason: "eval file unreadable", detail: evalPath };
  }

  if (!content.trim()) {
    return { ok: false, reason: "eval file is empty", detail: evalPath };
  }

  const lines = content.split("\n").filter((l) => l.trim() !== "");
  let passed = 0;
  let total = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      total++;
      if (record.passed === true || record.pass === true || record.status === "pass") {
        passed++;
      }
    } catch {
      // Malformed line — skip (lenient)
    }
  }

  if (total === 0) {
    return { ok: false, reason: "eval file has no parseable records", detail: evalPath };
  }

  const rate = passed / total;
  if (rate < threshold) {
    return {
      ok: false,
      reason: `pass-rate ${rate.toFixed(3)} < threshold ${threshold}`,
      detail: evalPath,
    };
  }

  return { ok: true };
}

// CLI
const args = process.argv.slice(2);
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
const dryRun = args.includes("--dry-run");
const jsonOutput = args.includes("--json");
const threshold = thresholdArg
  ? parseFloat(thresholdArg.split("=")[1])
  : DEFAULT_THRESHOLD;

const featureList = readJson(FEATURE_LIST_PATH);
const features = /** @type {Array<{id: string, behavior: string, state: string, evidence?: string, commit?: string}>} */ (featureList.features ?? []);

const results = [];
let passCount = 0;
let failCount = 0;

for (const feature of features) {
  const result = checkFeature(feature, threshold);
  results.push({ featureId: feature.id, behavior: feature.behavior, ...result });
  if (result.ok) {
    passCount++;
  } else {
    failCount++;
  }
}

if (jsonOutput) {
  console.log(
    JSON.stringify({ threshold, total: results.length, passing: passCount, failing: failCount, results }, null, 2)
  );
} else {
  console.log(`\n▶ Eval gate — threshold: ${threshold}`);
  console.log("─".repeat(60));
  for (const r of results) {
    if (r.ok) {
      console.log(`  PASS  ${r.featureId}`);
    } else {
      console.log(`  FAIL  ${r.featureId} — ${r.reason}`);
      if (r.detail) console.log(`        (${r.detail})`);
    }
  }
  console.log("─".repeat(60));
  console.log(`  ${passCount} passing, ${failCount} failing\n`);
}

if (failCount > 0 && !dryRun) {
  process.exit(1);
}
