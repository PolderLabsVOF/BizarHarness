/**
 * tests/e2e/dashboard-activity-lanes.mjs — v10.0.7-S1.
 *
 * Verifies the activity-flow rebuild:
 *   1. /api/activity returns { items, total, limit, since } (not legacy
 *      `events`).
 *   2. `?limit=N` honored.
 *   3. `?since=ISO` filters out older items.
 *   4. Invalid limit falls back to default 200.
 *   5. Oversized limit clamps to 1000.
 *   6. Activity sort order is newest-first.
 *
 * No SPA render — this is an HTTP contract test. SPA coverage is
 * exercised manually via the BROWSER_VERIFICATION.md walkthrough.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

const SHOT_DIR = join(tmpdir(), `bh-activity-lanes-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-activity-lanes-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-activity-lanes-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-activity-lanes-home-<pid>');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.BIZAR_HEADROOM_AUTOSTART = '0';
process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
process.env.BIZAR_CC_HOME = HOME_OVERRIDE;

mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

// ─── Boot server in-process ────────────────────────────────────────
const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
const PORT = 4221;
const boot = await createServer({
  port: PORT,
  projectRoot,
  clineConfigDir: join(HOME_OVERRIDE, '.config', 'cline'),
  bizarRoot: projectRoot,
});
await new Promise((resolve, reject) => {
  boot.server.once('error', reject);
  boot.server.once('listening', () => { boot.server.off('error', reject); resolve(); });
  boot.server.listen(PORT, '127.0.0.1');
});
await new Promise((r) => setTimeout(r, 400));

const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
    console.log(`\x1b[32mPASS\x1b[0m  ${name}${detail ? `  -- ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`\x1b[31mFAIL\x1b[0m  ${name}  -- ${err.message}`);
  }
}

try {
  // ─── 1: contract shape ──────────────────────────────────────────
  await check('activity.contract', async () => {
    const r = await fetch(`${BASE}/api/activity?limit=50`);
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.items)) throw new Error('items[] missing');
    if (typeof body.total !== 'number') throw new Error('total missing');
    if (body.limit !== 50) throw new Error(`limit not honored: ${body.limit}`);
    if (!('since' in body)) throw new Error('since field missing');
    return `items=${body.items.length} total=${body.total} limit=${body.limit}`;
  });

  // ─── 2: limit honored ───────────────────────────────────────────
  await check('activity.limit_cap', async () => {
    const r = await fetch(`${BASE}/api/activity?limit=5`);
    const body = await r.json();
    if (body.items.length > 5) throw new Error(`returned ${body.items.length} items > 5`);
    if (body.limit !== 5) throw new Error(`limit field=${body.limit} expected 5`);
    return `items=${body.items.length} limit=${body.limit}`;
  });

  // ─── 3: since filters ───────────────────────────────────────────
  await check('activity.since_filter', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const r = await fetch(`${BASE}/api/activity?since=${encodeURIComponent(future)}`);
    const body = await r.json();
    if (!Array.isArray(body.items)) throw new Error('items[] missing');
    if (body.items.length !== 0) throw new Error(`expected 0 items past since=future, got ${body.items.length}`);
    if (body.since !== future) throw new Error(`since echoed wrong: ${body.since}`);
    return `since filtered → items=0`;
  });

  // ─── 4: invalid limit falls back to default ─────────────────────
  await check('activity.bad_limit_default', async () => {
    const r = await fetch(`${BASE}/api/activity?limit=abc`);
    const body = await r.json();
    if (body.limit !== 200) throw new Error(`bad limit didn't fall back: ${body.limit}`);
    return `limit=${body.limit}`;
  });

  // ─── 5: oversized limit clamped to 1000 ────────────────────────
  await check('activity.limit_clamp', async () => {
    const r = await fetch(`${BASE}/api/activity?limit=999999`);
    const body = await r.json();
    if (body.limit !== 1000) throw new Error(`limit not clamped: ${body.limit}`);
    return `limit=${body.limit}`;
  });

  // ─── 6: items sorted newest-first when ts present ───────────────
  await check('activity.sort_newest_first', async () => {
    const r = await fetch(`${BASE}/api/activity?limit=1000`);
    const body = await r.json();
    const withTs = body.items.filter((e) => typeof e.ts === 'number');
    if (withTs.length < 2) return `skipped (only ${withTs.length} items with ts)`;
    for (let i = 1; i < withTs.length; i++) {
      if (withTs[i - 1].ts < withTs[i].ts) {
        throw new Error(`out of order at index ${i}: ${withTs[i - 1].ts} < ${withTs[i].ts}`);
      }
    }
    return `checked ${withTs.length} items, descending`;
  });
} finally {
  boot.server.close();
  writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log(`results: ${join(SHOT_DIR, 'results.json')}`);
  process.exit(passed === results.length ? 0 : 1);
}
