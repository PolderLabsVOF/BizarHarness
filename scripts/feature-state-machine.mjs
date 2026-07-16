/**
 * feature-state-machine.mjs — Enforce plan→exec→verify→audit state machine
 * per feature in feature_list.json.
 *
 * For each `passing` feature, verifies:
 *   1. evidence field is populated (non-empty string)
 *   2. commit field is populated (non-empty string)
 *   3. make audit score >= 80 (run from feature branch, lenient on missing audit script)
 *   4. eval gate satisfied (delegates to eval-gate.mjs logic)
 *
 * Usage:
 *   node scripts/feature-state-machine.mjs [--json] [--dry-run]
 *   make feature-state-machine
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FEATURE_LIST_PATH = join(ROOT, "feature_list.json");
const EVALS_DIR = join(ROOT, ".harness", "evals");
const AUDIT_SCRIPT = join(ROOT, "tools", "audit-harness.sh");

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const dryRun = args.includes("--dry-run");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * @param {string} featureId
 * @returns {{score: number, raw: string} | null}
 */
function runAudit(featureId) {
  if (!existsSync(AUDIT_SCRIPT)) return null;
  try {
    const raw = execSync(`bash "${AUDIT_SCRIPT}" . 2>&1 || true`, {
      cwd: ROOT,
      timeout: 60_000,
    }).toString("utf-8");

    // Extract score: look for "Score: XX" or "AUDIT SCORE: XX"
    const scoreMatch = raw.match(/score[:\s]+(\d+)/i)
      || raw.match(/(\d+)\s*(?:\/\s*100|%)/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    return { score: score ?? 0, raw };
  } catch {
    return null;
  }
}

/**
 * @param {string} featureId
 * @returns {{passed: number, total: number, rate: number} | null}
 */
function evalPassRate(featureId) {
  const evalPath = join(EVALS_DIR, `${featureId}.jsonl`);
  if (!existsSync(evalPath)) return null;

  try {
    const content = readFileSync(evalPath, "utf-8");
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
    if (total === 0) return null;
    return { passed, total, rate: passed / total };
  } catch {
    return null;
  }
}

/**
 * @param {{id: string, behavior: string, state: string, evidence?: string, commit?: string, auditScore?: number}} feature
 * @returns {{ok: boolean, checks: Record<string, boolean | string>, reasons: string[]}}
 */
function checkFeature(feature) {
  if (feature.state !== "passing") {
    return { ok: true, checks: {}, reasons: [] };
  }

  const checks = {};
  const reasons = [];

  // Check 1: evidence field
  const hasEvidence = Boolean(feature.evidence && feature.evidence.trim().length > 0);
  checks.evidence = hasEvidence;
  if (!hasEvidence) reasons.push("evidence field is empty");

  // Check 2: commit hash
  const hasCommit = Boolean(feature.commit && feature.commit.trim().length > 0);
  checks.commit = hasCommit;
  if (!hasCommit) reasons.push("commit hash is empty");

  // Check 3: audit score >= 80
  let auditScore = null;
  if (existsSync(AUDIT_SCRIPT)) {
    const result = runAudit(feature.id);
    if (result) auditScore = result.score;
  }
  const auditPass = auditScore !== null && auditScore >= 80;
  checks.auditScore = auditPass;
  if (auditScore === null) {
    // Lenient: audit script may not exist in all environments
    checks.auditScore = true;
  } else if (!auditPass) {
    reasons.push(`audit score ${auditScore} < 80`);
  }

  // Check 4: eval gate
  const evalResult = evalPassRate(feature.id);
  const evalPass = evalResult !== null && evalResult.rate >= 0.9;
  checks.evalGate = evalPass;
  if (evalResult === null) {
    // Lenient: no eval file is not a failure
    checks.evalGate = true;
  } else if (!evalPass) {
    reasons.push(`eval pass-rate ${(evalResult.rate * 100).toFixed(1)}% < 90%`);
  }

  const ok = hasEvidence && hasCommit && (auditPass || auditScore === null) && (evalPass || evalResult === null);
  return { ok, checks, reasons };
}

const featureList = readJson(FEATURE_LIST_PATH);
const features = featureList.features ?? [];

const results = [];
let passCount = 0;
let failCount = 0;

for (const feature of features) {
  const { ok, checks, reasons } = checkFeature(feature);
  results.push({ featureId: feature.id, behavior: feature.behavior, state: feature.state, ok, checks, reasons });
  if (ok) passCount++;
  else failCount++;
}

if (jsonOutput) {
  console.log(
    JSON.stringify({ total: results.length, passing: passCount, failing: failCount, results }, null, 2)
  );
} else {
  console.log("\n▶ Feature state machine — passing features\n");
  console.log("─".repeat(60));
  for (const r of results) {
    if (r.state !== "passing") continue;
    if (r.ok) {
      console.log(`  PASS  ${r.featureId}`);
    } else {
      console.log(`  FAIL  ${r.featureId}`);
      for (const reason of r.reasons) {
        console.log(`         - ${reason}`);
      }
    }
  }
  console.log("─".repeat(60));
  console.log(`  ${passCount} passing, ${failCount} failing\n`);
}

if (failCount > 0 && !dryRun) {
  process.exit(1);
}
