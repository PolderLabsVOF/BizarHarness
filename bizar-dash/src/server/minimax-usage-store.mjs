/**
 * src/server/minimax-usage-store.mjs
 *
 * JSONL append-only usage log at ~/.local/share/bizar/usage.jsonl.
 *
 * Records every MiniMax API call (chatCompletion, fetchRemains) so that:
 *   - The Usage view can show per-model/per-key analytics over 24h/7d/30d
 *   - Agents can read their own rolling usage totals via getUsageLimitsForAgent()
 *     to avoid burning through quota mid-session
 *   - Approximate USD cost estimates can be surfaced
 *
 * Record shape:
 * {
 *   ts: 1234567890,                    // unix ms
 *   providerId: "minimax",
 *   modelId: "MiniMax-M3",
 *   endpoint: "chat" | "remains" | "test",
 *   requestId: "msg_abc",
 *   promptTokens: 100,
 *   completionTokens: 200,
 *   totalTokens: 300,
 *   cachedTokens: 0,
 *   reasoningTokens: 50,
 *   latencyMs: 1234,
 *   finishReason: "stop",
 *   error: null | {code: "...", message: "..."},
 *   keyEnvVar: "BIZAR_MINIMAX_KEY",   // which env var / key slot was used
 *   isBackup: false,
 *   cached: false                      // true = returned from cache; NOT counted in cost
 * }
 *
 * Exports:
 *   recordUsage(record)            — append JSON line
 *   queryUsage({range, from, to, providerId, modelId})
 *   getUsageSummary(providerId)   — last-5-min rolling totals
 *   getUsageLimitsForAgent(providerId)  — agent-awareness compact summary
 *   pruneUsage({olderThanMs})     — remove old records
 *   __resetStoreForTests()        — wipe the JSONL (tests only)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Price map (USD per 1M tokens) ────────────────────────────────────────

/** @type {Record<string, {in: number, out: number}>} */
export const PRICE_PER_MTOK = {
  'minimax/MiniMax-M3':             { in: 1.00, out: 3.00 },
  'minimax/MiniMax-M2.7':           { in: 0.86, out: 2.59 },
  'minimax/MiniMax-M2.7-highspeed':{ in: 1.20, out: 3.60 },
  'minimax/MiniMax-M2.5':           { in: 0.59, out: 1.77 },
  'minimax/MiniMax-M2.5-highspeed':{ in: 0.86, out: 2.59 },
  'minimax/MiniMax-M2.1':           { in: 0.40, out: 1.20 },
  'minimax/MiniMax-M2.1-highspeed': { in: 0.58, out: 1.74 },
  'minimax/MiniMax-M2':             { in: 0.20, out: 0.60 },
};

// ─── Store path ─────────────────────────────────────────────────────────────

// Allow test override without patching process.env.HOME (which can be racy with
// ESM module-level evaluation order in the Node test runner).
const STORE_HOME = process.env.BIZAR_STORE_HOME
  ? process.env.BIZAR_STORE_HOME
  : join(homedir(), '.local', 'share', 'bizar');
const STORE_DIR  = STORE_HOME;
const STORE_FILE = join(STORE_DIR, 'usage.jsonl');

function ensureStoreDir() {
  // mode 0o700 — Node.js v24.16.0 has a bug where recursive+mode:0o600 fails with
  // EACCES in /tmp temp dirs even with umask 0o022; 0o700 is fine here.
  try { mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 }); } catch { /* already exists */ }
}

// ─── Cost estimation ─────────────────────────────────────────────────────────

/** Approximate USD cost for a usage record. Returns 0 if model is unknown. */
function estimateCost(record) {
  if (record.cached || record.error) return 0;
  const key = `minimax/${record.modelId}`;
  const price = PRICE_PER_MTOK[key];
  if (!price) return 0;
  const p = record.promptTokens ?? 0;
  const c = record.completionTokens ?? 0;
  return (p / 1_000_000) * price.in + (c / 1_000_000) * price.out;
}

// ─── Record ─────────────────────────────────────────────────────────────────

/**
 * Append a usage record to the JSONL store.
 * Auto-creates the parent directory on first call.
 * @param {object} record
 */
export function recordUsage(record) {
  ensureStoreDir();
  const line = JSON.stringify(record) + '\n';
  appendFileSync(STORE_FILE, line, 'utf8');
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

/** @returns {object[]} */
export function readAllRecords() {
  if (!existsSync(STORE_FILE)) return [];
  try {
    const raw = readFileSync(STORE_FILE, 'utf8');
    return raw.split('\n').map(parseLine).filter(r => r !== null);
  } catch { return []; }
}

// ─── Range helpers ───────────────────────────────────────────────────────────

function msForRange(range) {
  const map = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_600_000 };
  return map[range] ?? 86_400_000;
}

function dateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function computeTotals(records) {
  if (records.length === 0) {
    return { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0,
             totalTokens: 0, cachedTokens: 0, reasoningTokens: 0,
             avgLatencyMs: 0, p95LatencyMs: 0, costEstimate: 0 };
  }
  const errors    = records.filter(r => r.error !== null).length;
  const latencies = records.map(r => r.latencyMs).filter(l => l >= 0).sort((a, b) => a - b);
  const avg       = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const p95Idx    = Math.floor(latencies.length * 0.95);
  const p95       = latencies[p95Idx] ?? 0;
  const cost      = records.reduce((sum, r) => sum + estimateCost(r), 0);
  return {
    requests:        records.length,
    errors,
    promptTokens:    records.reduce((s, r) => s + (r.promptTokens ?? 0), 0),
    completionTokens: records.reduce((s, r) => s + (r.completionTokens ?? 0), 0),
    totalTokens:     records.reduce((s, r) => s + (r.totalTokens ?? 0), 0),
    cachedTokens:    records.reduce((s, r) => s + (r.cachedTokens ?? 0), 0),
    reasoningTokens: records.reduce((s, r) => s + (r.reasoningTokens ?? 0), 0),
    avgLatencyMs:    Math.round(avg),
    p95LatencyMs:    Math.round(p95),
    costEstimate:    Math.round(cost * 100_000) / 100_000,
  };
}

function computeDaily(records) {
  const byDate = new Map();
  for (const r of records) {
    const d = dateStr(r.ts);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, recs]) => {
      const t = computeTotals(recs);
      return { date, requests: t.requests, totalTokens: t.totalTokens,
               promptTokens: t.promptTokens, completionTokens: t.completionTokens,
               errors: t.errors, avgLatencyMs: t.avgLatencyMs };
    });
}

function computePerModel(records) {
  const byModel = new Map();
  for (const r of records) {
    const key = `${r.providerId}::${r.modelId}`;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(r);
  }
  return Array.from(byModel.entries())
    .map(([key, recs]) => {
      const [providerId, modelId] = key.split('::');
      const t = computeTotals(recs);
      return { providerId, modelId, requests: t.requests, totalTokens: t.totalTokens,
               promptTokens: t.promptTokens, completionTokens: t.completionTokens,
               errors: t.errors, avgLatencyMs: t.avgLatencyMs };
    })
    .sort((a, b) => b.requests - a.requests);
}

function computePerKey(records) {
  const byKey = new Map();
  for (const r of records) {
    const key = `${r.keyEnvVar}::${r.isBackup}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  return Array.from(byKey.entries())
    .map(([key, recs]) => {
      const [keyEnvVar, isBackupStr] = key.split('::');
      const isBackup = isBackupStr === 'true';
      return {
        keyEnvVar,
        isBackup,
        requests: recs.length,
        errors: recs.filter(r => r.error !== null).length,
        lastUsed: recs.length ? Math.max(...recs.map(r => r.ts)) : null,
        status: isBackup ? 'backup' : 'active',
      };
    })
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
}

function computeErrors(records) {
  const byError = new Map();
  for (const r of records) {
    if (!r.error) continue;
    const key = `${r.error.code}::${r.error.message}`;
    if (!byError.has(key)) byError.set(key, { code: r.error.code, message: r.error.message, recs: [] });
    byError.get(key).recs.push(r);
  }
  return Array.from(byError.values())
    .map(({ code, message, recs }) => ({
      code, message,
      count: recs.length,
      lastOccurred: recs.length ? Math.max(...recs.map(r => r.ts)) : null,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Query ──────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {'24h'|'7d'|'30d'|'custom'} [opts.range='24h']
 * @param {number} [opts.from] — unix ms, required when range === 'custom'
 * @param {number} [opts.to]   — unix ms, required when range === 'custom'
 * @param {string} [opts.providerId]
 * @param {string} [opts.modelId]
 */
export function queryUsage(opts = {}) {
  const { range = '24h', from, to, providerId, modelId } = opts;

  let fromMs;
  let toMs;
  if (range === 'custom') {
    if (typeof from !== 'number' || typeof to !== 'number') {
      throw new Error('range=custom requires `from` and `to` (unix ms)');
    }
    fromMs = from;
    toMs = to;
  } else {
    toMs = Date.now();
    fromMs = toMs - msForRange(range);
  }

  let records = readAllRecords()
    .filter(r => r.ts >= fromMs && r.ts <= toMs);

  if (providerId) records = records.filter(r => r.providerId === providerId);
  if (modelId)    records = records.filter(r => r.modelId === modelId);

  return {
    totals:   computeTotals(records),
    daily:    computeDaily(records),
    perModel: computePerModel(records),
    perKey:   computePerKey(records),
    errors:   computeErrors(records),
  };
}

// ─── Rolling summary (for agents) ──────────────────────────────────────────

/** Last-5-minute rolling window totals — used for "agents know their limits". */
export function getUsageSummary(providerId = 'minimax') {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const records = readAllRecords()
    .filter(r => r.providerId === providerId && r.ts >= cutoff);
  const t = computeTotals(records);
  return { requests: t.requests, tokens: t.totalTokens, errors: t.errors, avgLatencyMs: t.avgLatencyMs };
}

// ─── Agent awareness ─────────────────────────────────────────────────────────

/**
 * Compact usage summary for injection into an agent's system prompt context.
 * @param {string} [providerId='minimax']
 */
export async function getUsageLimitsForAgent(providerId = 'minimax') {
  const now = Date.now();
  const cutoff5m  = now - 5 * 60 * 1000;
  const cutoff24h = now - 86_400_000;

  const all = readAllRecords().filter(r => r.providerId === providerId);

  const last5min  = all.filter(r => r.ts >= cutoff5m);
  const last24h   = all.filter(r => r.ts >= cutoff24h);

  const t5  = computeTotals(last5min);
  const t24 = computeTotals(last24h);

  // Heuristic limits: 1000 requests / 1M tokens per 24h for the free-ish tier.
  const limits = { dailyRequests: 1000, dailyTokens: 1_000_000 };

  const percentUsed24h = limits.dailyTokens > 0
    ? Math.round((t24.totalTokens / limits.dailyTokens) * 1000) / 10
    : 0;

  /** @type {null|string} */
  let warning = null;
  if (percentUsed24h >= 80) warning = 'approaching_daily_limit';
  if (last24h.filter(r => r.isBackup).length > last24h.length * 0.5) {
    warning = 'key_cycling';
  }

  // Estimate time until midnight UTC reset.
  const midnightUtc = new Date();
  midnightUtc.setUTCHours(0, 0, 0, 0);
  midnightUtc.setUTCDate(midnightUtc.getUTCDate() + 1);
  const msUntilReset = midnightUtc.getTime() - now;
  const hr = Math.floor(msUntilReset / 3_600_000);
  const min = Math.floor((msUntilReset % 3_600_000) / 60_000);
  const estimatedTimeUntilReset = msUntilReset > 0 ? `${hr}h ${min}m` : null;

  return {
    provider: providerId,
    requestsLast5min:  t5.requests,
    tokensLast5min:    t5.totalTokens,
    requestsLast24h:   t24.requests,
    tokensLast24h:     t24.totalTokens,
    limits,
    percentUsed24h,
    estimatedTimeUntilReset,
    warning,
  };
}

// ─── Prune ──────────────────────────────────────────────────────────────────

/**
 * Remove records older than `olderThanMs` from the JSONL.
 * @param {{olderThanMs?: number}} [opts]
 */
export function pruneUsage(opts = {}) {
  const { olderThanMs = Infinity } = opts;
  if (olderThanMs === Infinity) return 0;
  const cutoff = Date.now() - olderThanMs;
  const all = readAllRecords();
  const keep = all.filter(r => r.ts >= cutoff);
  const removed = all.length - keep.length;
  if (removed === 0) return 0;
  // Rewrite without the pruned records.
  ensureStoreDir();
  const tmp = STORE_FILE + '.tmp';
  const lines = keep.map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(tmp, lines, 'utf8');
  try { unlinkSync(STORE_FILE); } catch { /* ignore */ }
  try { require('node:fs').renameSync(tmp, STORE_FILE); } catch {
    writeFileSync(STORE_FILE, lines, 'utf8');
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
  return removed;
}

// ─── Test reset ─────────────────────────────────────────────────────────────

/** Wipes the entire JSONL. For tests only. */
export function __resetStoreForTests() {
  try { unlinkSync(STORE_FILE); } catch { /* ignore */ }
}
