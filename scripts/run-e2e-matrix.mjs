#!/usr/bin/env node
/**
 * scripts/run-e2e-matrix.mjs — IMP-022 / F-192 E2E matrix runner.
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875:
 * "Model-selection E2E matrix | Direct, workflow, and team selection
 * cases pass."
 *
 * Invokes vitest against every `tests/` test file under
 * `packages/sdk/tests/e2e/`, captures the per-file pass/fail counts,
 * and emits a JSON summary to `~/.config/bizar/evidence/e2e-matrix-<ts>.json`
 * so the test gate can be re-checked from the audit trail.
 *
 * Exit code:
 *   - 0: all tests pass
 *   - 1: at least one test failed
 *
 * Usage:
 *   node scripts/run-e2e-matrix.mjs
 *
 * The Makefile's `e2e-matrix` target is the canonical entry point.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const e2eDir = resolve(repoRoot, 'packages/sdk/tests/e2e');

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function evidenceDirPath() {
  return join(homedir(), '.config', 'bizar', 'evidence');
}

function writeSummary(summary) {
  const dir = evidenceDirPath();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `e2e-matrix-${timestampForFilename()}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  return file;
}

/**
 * Parse vitest's stdout (JSON reporter) for pass/fail counts. The
 * reporter shape (with `--reporter=json`) is a single JSON object on
 * stdout; we tolerate the multi-line variant too.
 */
function parseVitestJson(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // vitest may print a banner before the JSON; find the first '{'
    // and try to parse from there.
    const start = trimmed.indexOf('{');
    if (start < 0) return null;
    return JSON.parse(trimmed.slice(start));
  }
}

function summarize(parsed) {
  if (!parsed) {
    return { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, perFile: [] };
  }
  const perFile = Array.isArray(parsed.testResults)
    ? parsed.testResults.map((f) => {
        const results = Array.isArray(f?.assertionResults) ? f.assertionResults : [];
        const numTotal = results.length;
        const numPassed = results.filter((r) => r?.status === 'passed').length;
        const numFailed = results.filter((r) => r?.status === 'failed').length;
        const tests = results.map((r) => ({
          title: r?.title ?? '',
          fullName: r?.fullName ?? '',
          status: r?.status ?? 'unknown',
          duration: typeof r?.duration === 'number' ? r.duration : 0,
        }));
        return {
          file: f?.name ?? 'unknown',
          status: f?.status ?? 'unknown',
          duration: typeof f?.endTime === 'number' && typeof f?.startTime === 'number' ? f.endTime - f.startTime : 0,
          numTotal,
          numPassed,
          numFailed,
          tests,
        };
      })
    : [];
  return {
    numTotalTests: parsed.numTotalTests ?? perFile.reduce((a, f) => a + f.numTotal, 0),
    numPassedTests: parsed.numPassedTests ?? perFile.reduce((a, f) => a + f.numPassed, 0),
    numFailedTests: parsed.numFailedTests ?? perFile.reduce((a, f) => a + f.numFailed, 0),
    perFile,
  };
}

function main() {
  const start = Date.now();
  const vitestBin = resolve(repoRoot, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitestBin)) {
    console.error(`run-e2e-matrix: vitest not found at ${vitestBin}; run \`npm install\` first`);
    process.exit(1);
  }
  if (!existsSync(e2eDir)) {
    console.error(`run-e2e-matrix: E2E directory not found: ${e2eDir}`);
    process.exit(1);
  }

  const result = spawnSync(
    vitestBin,
    [
      'run',
      '--root', resolve(repoRoot, 'packages/sdk'),
      '--reporter=json',
      'tests/e2e/',
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    },
  );

  const parsed = parseVitestJson(result.stdout);
  const summary = summarize(parsed);
  const durationMs = Date.now() - start;
  const ok = (result.status ?? 1) === 0;

  const summaryRecord = {
    ok,
    startedAt: new Date(start).toISOString(),
    durationMs,
    command: 'vitest run --root packages/sdk --reporter=json tests/e2e/',
    e2eDir,
    totals: {
      numTotalTests: summary.numTotalTests,
      numPassedTests: summary.numPassedTests,
      numFailedTests: summary.numFailedTests,
    },
    perFile: summary.perFile,
    rawStatus: result.status,
  };

  const summaryPath = writeSummary(summaryRecord);
  console.log(`run-e2e-matrix: ${summary.numPassedTests}/${summary.numTotalTests} passing (${summary.numFailedTests} failed) in ${durationMs}ms`);
  console.log(`run-e2e-matrix: summary written to ${summaryPath}`);

  process.exit(ok ? 0 : 1);
}

main();