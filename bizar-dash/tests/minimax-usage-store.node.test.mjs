/**
 * minimax-usage-store.node.test.mjs
 *
 * Tests for the JSONL usage store.
 *
 * Run with: node --test bizar-dash/tests/minimax-usage-store.node.test.mjs
 *
 * Strategy: we avoid ESM dynamic-import cache issues by writing JSONL lines
 * directly to the store file path (derived from BIZAR_STORE_HOME env var)
 * and importing the store module only to call its pure/stateless helper
 * functions (computeTotals, computePerModel, etc.).  recordUsage and queryUsage
 * are tested via direct file I/O so the ESM module loader never interferes.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Allow tests to run without polluting the real store.
// NOTE: STORE_FILE is computed lazily inside functions, NOT at module level,
// because process.env.BIZAR_STORE_HOME is set in the `before` hook which
// runs AFTER module-level code.
let SANDBOX_HOME;
let ORIGINAL_BIZAR_STORE_HOME;

/** The store file path, resolved after BIZAR_STORE_HOME is set by `before`. */
function storeFile() {
  return join(process.env.BIZAR_STORE_HOME, 'usage.jsonl');
}

const RECORD_BASE = {
  ts: Date.now(),                  // required for queryUsage range filters
  providerId: 'minimax',
  modelId: 'MiniMax-M3',
  endpoint: 'chat',
  requestId: 'msg_test1',
  promptTokens: 100,
  completionTokens: 200,
  totalTokens: 300,
  cachedTokens: 0,
  reasoningTokens: 50,
  latencyMs: 1234,
  finishReason: 'stop',
  error: null,
  keyEnvVar: 'env:MINIMAX_API_KEY',
  isBackup: false,
  cached: false,
};

before(() => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-usage-test-${Date.now()}-`));
  ORIGINAL_BIZAR_STORE_HOME = process.env.BIZAR_STORE_HOME;
  // Set BIZAR_STORE_HOME before the store module is ever imported so its
  // top-level STORE_FILE computation picks up the sandbox path.
  process.env.BIZAR_STORE_HOME = join(SANDBOX_HOME, '.local', 'share', 'bizar');
});

after(() => {
  process.env.BIZAR_STORE_HOME = ORIGINAL_BIZAR_STORE_HOME ?? '';
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Wipe the JSONL store before each test.
  try { unlinkSync(storeFile()); } catch { /* ignore */ }
});

function makeRecord(overrides = {}) {
  return { ...RECORD_BASE, ...overrides };
}

/**
 * Write a JSONL line directly to the store file (bypassing the store module
 * to avoid any ESM import ordering issues).
 */
function appendJsonl(record) {
  writeFileSync(storeFile(), JSON.stringify(record) + '\n', { flag: 'a', encoding: 'utf8' });
}

/**
 * Load the store module. Uses a fresh import each time via unique cache-busting query param.
 * The BIZAR_STORE_HOME env var is set in the `before` hook before any imports happen.
 */
async function getStore() {
  const stamp = `${Date.now()}-${Math.random()}`;
  return import(`../src/server/minimax-usage-store.mjs?nocache=${stamp}`);
}

// ─── recordUsage + queryUsage ─────────────────────────────────────────

describe('recordUsage + queryUsage', () => {
  it('records a single chat usage record', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord());
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.requests, 1);
    assert.equal(result.totals.totalTokens, 300);
    assert.equal(result.totals.promptTokens, 100);
    assert.equal(result.totals.completionTokens, 200);
    assert.equal(result.totals.reasoningTokens, 50);
    assert.equal(result.totals.avgLatencyMs, 1234);
  });

  it('aggregates multiple records', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ requestId: 'r1', totalTokens: 100 }));
    store.recordUsage(makeRecord({ requestId: 'r2', totalTokens: 200 }));
    store.recordUsage(makeRecord({ requestId: 'r3', totalTokens: 300 }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.requests, 3);
    assert.equal(result.totals.totalTokens, 600);
  });

  it('filters by range — 24h excludes old records', async () => {
    const store = await getStore();
    // Write a recent record via the store.
    store.recordUsage(makeRecord({ requestId: 'recent', ts: Date.now() - 60_000 }));
    // Manually write an 8-day-old record to the file.
    appendJsonl(makeRecord({ requestId: 'old', ts: Date.now() - 8 * 86_400_000 }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.requests, 1);
    assert.equal(result.daily.length, 1);
  });

  it('supports range=7d', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ requestId: 'r1', ts: Date.now() - 2 * 86_400_000 }));
    store.recordUsage(makeRecord({ requestId: 'r2', ts: Date.now() - 6 * 86_400_000 }));
    const result = store.queryUsage({ range: '7d' });
    assert.equal(result.totals.requests, 2);
  });

  it('computes avgLatencyMs and p95LatencyMs', async () => {
    const store = await getStore();
    for (let i = 0; i < 20; i++) {
      store.recordUsage(makeRecord({ requestId: `r${i}`, latencyMs: (i + 1) * 100 }));
    }
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.avgLatencyMs, 1050);
    assert.equal(result.totals.p95LatencyMs, 2000);
  });

  it('records errors correctly', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ requestId: 'e1', error: { code: 'http_429', message: 'rate limited' } }));
    store.recordUsage(makeRecord({ requestId: 'e2', error: { code: 'http_500', message: 'server error' } }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.errors, 2);
    assert.equal(result.totals.requests, 2);
    assert.equal(result.errors.length, 2);
  });

  it('records cached=true correctly', async () => {
    const store = await getStore();
    // Both records are cached so cost is 0 (uncached record would cost > 0).
    store.recordUsage(makeRecord({ requestId: 'c1', cached: true }));
    store.recordUsage(makeRecord({ requestId: 'c2', cached: true }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.requests, 2);
    // Cost should be 0 for cached records.
    assert.equal(result.totals.costEstimate, 0);
  });

  it('computes per-model buckets', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ modelId: 'MiniMax-M3', totalTokens: 100 }));
    store.recordUsage(makeRecord({ modelId: 'MiniMax-M3', totalTokens: 200 }));
    store.recordUsage(makeRecord({ modelId: 'MiniMax-M2.7', totalTokens: 50 }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.perModel.length, 2);
    const m3 = result.perModel.find(m => m.modelId === 'MiniMax-M3');
    assert.ok(m3);
    assert.equal(m3.totalTokens, 300);
    assert.equal(m3.requests, 2);
  });

  it('computes per-key buckets', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ keyEnvVar: 'MINIMAX_API_KEY', isBackup: false, totalTokens: 100 }));
    store.recordUsage(makeRecord({ keyEnvVar: 'MINIMAX_API_KEY_BACKUP', isBackup: true, totalTokens: 50 }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.perKey.length, 2);
    const primary = result.perKey.find(k => k.keyEnvVar === 'MINIMAX_API_KEY' && !k.isBackup);
    assert.ok(primary);
    assert.equal(primary.requests, 1);
  });
});

// ─── getUsageSummary ──────────────────────────────────────────────────

describe('getUsageSummary', () => {
  it('returns zeros when no records', async () => {
    const store = await getStore();
    const s = store.getUsageSummary('minimax');
    assert.equal(s.requests, 0);
    assert.equal(s.tokens, 0);
  });

  it('returns last-5-min rolling totals', async () => {
    const store = await getStore();
    // 10 minutes ago — should NOT be in 5-min window.
    store.recordUsage(makeRecord({ requestId: 'old', ts: Date.now() - 10 * 60_000, totalTokens: 9999 }));
    // 2 minutes ago — should be in 5-min window.
    store.recordUsage(makeRecord({ requestId: 'recent', ts: Date.now() - 2 * 60_000, totalTokens: 500 }));
    const s = store.getUsageSummary('minimax');
    assert.equal(s.requests, 1);
    assert.equal(s.tokens, 500);
  });
});

// ─── getUsageLimitsForAgent ───────────────────────────────────────────

describe('getUsageLimitsForAgent', () => {
  it('returns a valid summary', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ totalTokens: 10_000 }));
    const s = await store.getUsageLimitsForAgent('minimax');
    assert.equal(s.provider, 'minimax');
    assert.equal(s.tokensLast24h, 10_000);
    assert.equal(s.requestsLast24h, 1);
    assert.ok(s.limits);
    assert.equal(typeof s.percentUsed24h, 'number');
    assert.ok(s.estimatedTimeUntilReset === null || typeof s.estimatedTimeUntilReset === 'string');
    assert.ok(s.warning === null || typeof s.warning === 'string');
  });

  it('warns when 24h usage exceeds 80pct of heuristic limit', async () => {
    const store = await getStore();
    // Exceed 80% of 1_000_000 tokens.
    store.recordUsage(makeRecord({ totalTokens: 850_000 }));
    const s = await store.getUsageLimitsForAgent('minimax');
    assert.equal(s.warning, 'approaching_daily_limit');
  });
});

// ─── pruneUsage ──────────────────────────────────────────────────────

describe('pruneUsage', () => {
  it('removes records older than the cutoff', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ requestId: 'old', ts: Date.now() - 48 * 86_400_000 }));
    store.recordUsage(makeRecord({ requestId: 'recent', ts: Date.now() - 1 * 86_400_000 }));
    const removed = store.pruneUsage({ olderThanMs: 24 * 86_400_000 });
    assert.equal(removed, 1);
    const result = store.queryUsage({ range: '30d' });
    assert.equal(result.totals.requests, 1);
  });

  it('returns 0 when nothing to prune', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord());
    const removed = store.pruneUsage({ olderThanMs: 24 * 86_400_000 });
    assert.equal(removed, 0);
  });
});

// ─── __resetStoreForTests ────────────────────────────────────────────

describe('__resetStoreForTests', () => {
  it('wipes all records', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord());
    store.recordUsage(makeRecord({ requestId: 'another' }));
    assert.equal(store.queryUsage({ range: '24h' }).totals.requests, 2);
    store.__resetStoreForTests();
    assert.equal(store.queryUsage({ range: '24h' }).totals.requests, 0);
  });
});

// ─── cost estimation ─────────────────────────────────────────────────

describe('costEstimate', () => {
  it('estimates cost for MiniMax-M3', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({
      modelId: 'MiniMax-M3',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    }));
    const result = store.queryUsage({ range: '24h' });
    // 1M prompt @ $1/M = $1, 1M completion @ $3/M = $3 → $4 total
    assert.equal(result.totals.costEstimate, 4);
  });

  it('returns 0 for unknown models', async () => {
    const store = await getStore();
    store.recordUsage(makeRecord({ modelId: 'unknown-model', totalTokens: 1_000_000 }));
    const result = store.queryUsage({ range: '24h' });
    assert.equal(result.totals.costEstimate, 0);
  });
});
