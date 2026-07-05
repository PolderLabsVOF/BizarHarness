/**
 * src/server/eval-store.mjs
 *
 * v5.0.0 — Persistent storage for eval runs and results.
 *
 * Storage: ~/.local/share/bizar/eval/
 *
 * Index: ~/.local/share/bizar/eval/.index.json
 *   { "runs": [{ id, startedAt, finishedAt, suitePath, total, passed, failed }] }
 *
 * Per-run: ~/.local/share/bizar/eval/<run-id>.json
 *   Full run object with results array.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// Allow test override
const STORE_HOME = process.env.BIZAR_STORE_HOME
  ? process.env.BIZAR_STORE_HOME
  : join(homedir(), '.local', 'share', 'bizar');
const EVAL_DIR = join(STORE_HOME, 'eval');
const INDEX_FILE = join(EVAL_DIR, '.index.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function loadIndex() {
  return safeReadJSON(INDEX_FILE, { runs: [] });
}

function saveIndex(index) {
  ensureDir(EVAL_DIR);
  atomicWriteJson(INDEX_FILE, index);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save a completed run to disk.
 *
 * @param {object} run
 * @param {string} run.id
 * @param {string} run.startedAt
 * @param {string} run.finishedAt
 * @param {string} run.suitePath
 * @param {number} run.total
 * @param {number} run.passed
 * @param {number} run.failed
 * @param {object[]} run.results
 * @returns {{ ok: boolean, path: string }}
 */
export async function saveRun(run) {
  ensureDir(EVAL_DIR);

  // Write the run file
  const runPath = join(EVAL_DIR, `${run.id}.json`);
  atomicWriteJson(runPath, run);

  // Update the index
  const index = loadIndex();
  const existingIdx = index.runs.findIndex((r) => r.id === run.id);
  const indexEntry = {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    suitePath: run.suitePath,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
  };
  if (existingIdx >= 0) {
    index.runs[existingIdx] = indexEntry;
  } else {
    index.runs.unshift(indexEntry); // newest first
  }
  saveIndex(index);

  return { ok: true, path: runPath };
}

/**
 * List recent runs, newest first.
 *
 * @param {{ limit?: number }} opts
 * @returns {Promise<object[]>}
 */
export async function listRuns({ limit = 20 } = {}) {
  const index = loadIndex();
  return index.runs.slice(0, Math.max(1, limit));
}

/**
 * Get a full run by id.
 *
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getRun(id) {
  if (!id) return null;
  const runPath = join(EVAL_DIR, `${id}.json`);
  return safeReadJSON(runPath, null);
}

/**
 * Compare two runs and categorize fixtures by diff.
 *
 * @param {string} id1
 * @param {string} id2
 * @returns {Promise<{ improved: object[], regressed: object[], unchanged: object[] }>}
 */
export async function compareRuns(id1, id2) {
  const [run1, run2] = await Promise.all([getRun(id1), getRun(id2)]);

  if (!run1 || !run2) {
    return { improved: [], regressed: [], unchanged: [], error: 'run not found' };
  }

  // Build a map of fixtureId -> result for each run
  const map1 = new Map(run1.results.map((r) => [r.fixtureId, r]));
  const map2 = new Map(run2.results.map((r) => [r.fixtureId, r]));

  /** @type {object[]} */
  const improved = [];
  /** @type {object[]} */
  const regressed = [];
  /** @type {object[]} */
  const unchanged = [];

  // Check all fixtures from run1
  for (const [fixtureId, result1] of map1) {
    const result2 = map2.get(fixtureId);
    if (!result2) {
      // Fixture disappeared
      continue;
    }

    const entry = {
      fixtureId,
      run1Ok: result1.ok,
      run2Ok: result2.ok,
      run1LatencyMs: result1.latencyMs,
      run2LatencyMs: result2.latencyMs,
    };

    if (result1.ok && !result2.ok) {
      // Was passing, now failing = regressed
      regressed.push({ ...entry, kind: 'regressed' });
    } else if (!result1.ok && result2.ok) {
      // Was failing, now passing = improved
      improved.push({ ...entry, kind: 'improved' });
    } else {
      // Same result
      unchanged.push({ ...entry, kind: 'unchanged' });
    }
  }

  return { improved, regressed, unchanged };
}

/**
 * Delete a run by id.
 *
 * @param {string} id
 * @returns {{ ok: boolean }}
 */
export async function deleteRun(id) {
  if (!id) return { ok: false };
  const runPath = join(EVAL_DIR, `${id}.json`);
  try {
    if (existsSync(runPath)) unlinkSync(runPath);
  } catch { /* ignore */ }

  const index = loadIndex();
  index.runs = index.runs.filter((r) => r.id !== id);
  saveIndex(index);

  return { ok: true };
}

/**
 * Build a unique run id.
 *
 * @returns {string}
 */
export function buildRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `run_${ts}_${rand}`;
}

// ── Test reset ────────────────────────────────────────────────────────────────

/**
 * Wipe all eval data. For test isolation only.
 */
export function __resetStoreForTests() {
  try {
    const index = loadIndex();
    for (const r of index.runs) {
      try { unlinkSync(join(EVAL_DIR, `${r.id}.json`)); } catch { /* ignore */ }
    }
    try { unlinkSync(INDEX_FILE); } catch { /* ignore */ }
  } catch { /* ignore */ }
}
