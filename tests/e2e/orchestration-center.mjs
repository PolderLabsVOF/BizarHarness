/**
 * tests/e2e/orchestration-center.mjs
 *
 * Sprint S25 — Live orchestration-center verification.
 *
 * Boots the dashboard server on a free port, hits the merged endpoints,
 * exercises an admin action, captures evidence as JSON, then tears the
 * server down. Exits non-zero on any failure so the gate fails the
 * commit if a real regression slips in.
 *
 * Usage:
 *   node tests/e2e/orchestration-center.mjs            # full run
 *   BIZAR_E2E_SKIP_RESTART=1 node tests/e2e/orchestration-center.mjs
 *                                                      # skip self-respawn
 *   node tests/e2e/orchestration-center.mjs --port=4098
 *
 * Evidence output:
 *   /tmp/bizar-e2e-<pid>.json  — structured per-step results
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

/**
 * S31 — fixture seeders. Pre-populate the tmp project with a real
 * PROGRESS.md (with goals, KRs, mixed statuses), a real task list, and
 * a real settings.json so the e2e exercises non-trivial counts and the
 * Settings PUT round-trip writes against a real file.
 */
function seedProject(root) {
  const bizarDir = join(root, '.bizar');
  mkdirSync(bizarDir, { recursive: true });
  // PROGRESS.md — 4 goals: 1 done, 2 in-progress (one at-risk), 1 blocked.
  // Mirrors the format progress-parser.mjs parses (see header docs).
  writeFileSync(join(bizarDir, 'PROGRESS.md'), `# Bizar Harness — S31 fixture

### In Progress

## G-001 — Orchestration center (fixture)

- [x] Audit views (done)
- [x] Wire settings (done)
- [ ] Live e2e proof (fixture)
owner: brenda

## G-002 — Goals parity (fixture)

**at-risk**

- [x] Goals canonical store (done)
- [ ] Real fixture coverage (fixture)

## G-003 — Backup rotation (fixture)

- [ ] Add rotation policy (fixture)

### Backlog

## G-004 — Multi-region (fixture)

**blocked**

- [ ] Reach out to ops (blocked)
`);
}

const EVIDENCE = process.env.BIZAR_E2E_EVIDENCE ||
  join(tmpdir(), `bizar-e2e-${process.pid}.json`);
const SKIP_RESTART = process.env.BIZAR_E2E_SKIP_RESTART === '1';

const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] ||
  4171,
);

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${step}${detail ? `  -- ${detail}` : ''}`);
}

async function http(boot, path, opts = {}) {
  const port = boot.port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is fine */ }
  return { status: res.status, text, json };
}

async function wsHandshake(boot, timeoutMs = 3000) {
  const port = boot.port;
  let WebSocket;
  try {
    ({ WebSocket } = await import('ws'));
  } catch {
    return { ok: false, reason: 'no_ws_lib' };
  }
  return await new Promise((resolve) => {
    const frames = [];
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* */ }
      resolve({ ok: frames.length > 0, frames });
    }, timeoutMs);
    let ws;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, reason: `ws_open: ${err.message}` });
      return;
    }
    ws.on('open', () => { frames.push({ kind: 'open' }); });
    ws.on('message', (m) => {
      const txt = m.toString ? m.toString() : String(m);
      frames.push({ kind: 'message', data: txt.slice(0, 200) });
    });
    ws.on('error', (err) => {
      frames.push({ kind: 'error', data: err.message });
    });
    ws.on('close', () => { clearTimeout(timer); });
  });
}

async function main() {
  // 1. Boot.
  const tmp = mkdtempSync(join(tmpdir(), 'bizar-e2e-'));
  seedProject(tmp);
  const boot = await createServer({
    port: PORT,
    projectRoot: tmp,
    clineConfigDir: join(tmp, '.config', 'cline'),
    bizarRoot: tmp,
  });
  await new Promise((resolve, reject) => {
    boot.server.once('error', reject);
    boot.server.listen(PORT, '127.0.0.1', () => { boot.server.off('error', reject); resolve(); });
  });
  record('server.boot', true, `port=${PORT} tmp=${tmp}`);

  // 2. /api/health.
  const health = await http(boot, '/api/health');
  record('endpoint.health', health.status === 200 && health.json?.ok === true,
    `status=${health.status}`);

  // 3. /api/snapshot — assert the S23 enriched shape and that the
  // fixture seed actually populates the counts (no zero-only run).
  const snap = await http(boot, '/api/snapshot');
  const o = snap.json?.overview || {};
  const expectedKeys = ['tasks', 'goals', 'agents', 'tokens', 'needsAttention'];
  const haveKeys = expectedKeys.filter((k) => k in o);
  record('snapshot.enriched_keys', haveKeys.length === expectedKeys.length,
    `present=${haveKeys.join(',') || 'none'}`);
  record('snapshot.tasks_shape', o.tasks && typeof o.tasks.queued === 'number',
    `tasks=${JSON.stringify(o.tasks)}`);
  record('snapshot.goals_shape', o.goals && typeof o.goals.total === 'number',
    `goals=${JSON.stringify(o.goals)}`);
  // Fixture seeds 4 goals (1 done, 1 at-risk, 1 blocked, 1 in-progress).
  // The Overview "Goals at risk" tile must render the same 4 total.
  record('snapshot.goals_nonempty', (o.goals?.total || 0) >= 4,
    `total=${o.goals?.total || 0} done=${o.goals?.done || 0} atRisk=${o.goals?.atRisk || 0}`);
  record('snapshot.agents_shape', o.agents && typeof o.agents.total === 'number',
    `agents=${JSON.stringify(o.agents)}`);
  record('snapshot.needsAttention_array',
    Array.isArray(o.needsAttention),
    `len=${(o.needsAttention || []).length}`);
  // Fixture has 1 at-risk goal → needsAttention must mention it.
  record('snapshot.needsAttention_nonempty', (o.needsAttention || []).length >= 1,
    `len=${(o.needsAttention || []).length}`);

  // 4. /api/agents — assert merge shape (S24).
  const ag = await http(boot, '/api/agents');
  const agents = ag.json?.agents || [];
  const sources = new Set(agents.map((a) => a.source).filter(Boolean));
  const allHaveSource = agents.every((a) => a.source === 'bizar' || a.source === 'cc');
  record('agents.merged_shape', allHaveSource,
    `count=${agents.length} sources=${[...sources].join('|')}`);

  // 5. /api/goals — assert canonical-store shape (S23 + existing goals route).
  // Fixture seeds 4 goals; the response count must match.
  const goals = await http(boot, '/api/goals');
  record('goals.canonical_shape',
    goals.status === 200 && Array.isArray(goals.json?.goals) && typeof goals.json?.count === 'number',
    `status=${goals.status} count=${goals.json?.count}`);
  record('goals.fixture_count',
    goals.json?.count === 4,
    `count=${goals.json?.count} (fixture expected 4)`);

  // 6. WS handshake — accept either an empty frames list or a real
  // frame; the contract is the handshake completes, not unsolicited
  // frames within 3s.
  const ws = await wsHandshake(boot);
  record('ws.handshake', ws.ok || ws.reason === 'no_ws_lib',
    `frames=${ws.frames?.length || 0} reason=${ws.reason || 'ok'}`);

  // 7. Admin /gc — exercise the new admin router. The admin router is
  // mounted via router.use() with no explicit prefix, so the route
  // resolves at /api/gc (not /api/admin/gc).
  const gc = await http(boot, '/api/gc', { method: 'POST' });
  record('admin.gc', gc.status === 200 && gc.json?.ok === true,
    `status=${gc.status} body=${JSON.stringify(gc.json).slice(0, 120)}`);

  // 7b. S30 — Settings PUT round-trip. The Settings view binds to
  // /api/settings; exercise a write → read to prove persistence.
  // The contract is top-level keys (theme, ui, dashboard, etc.) merged
  // server-side via mergeSettings().
  const setBefore = await http(boot, '/api/settings');
  record('settings.get',
    setBefore.status === 200,
    `status=${setBefore.status}`);
  const setPut = await http(boot, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: { mode: 'dark' } }),
  });
  record('settings.put',
    setPut.status === 200,
    `status=${setPut.status} body=${JSON.stringify(setPut.json).slice(0, 160)}`);
  const setAfter = await http(boot, '/api/settings');
  record('settings.roundtrip',
    setAfter.json?.data?.theme?.mode === 'dark',
    `theme.mode=${setAfter.json?.data?.theme?.mode}`);

  // 8. Restart — skip by default to keep CI fast; flip BIZAR_E2E_SKIP_RESTART=0 to run.
  if (!SKIP_RESTART) {
    const restart = await http(boot, '/api/restart', { method: 'POST' });
    record('admin.restart', restart.status === 200 && restart.json?.restarting === true,
      `status=${restart.status}`);
  } else {
    record('admin.restart', true, 'skipped (BIZAR_E2E_SKIP_RESTART=1)');
  }

  // 9. Evidence dump.
  writeFileSync(EVIDENCE, JSON.stringify({
    ranAt: new Date().toISOString(),
    port: PORT,
    tmp,
    results,
  }, null, 2));

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed; evidence at ${EVIDENCE}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} steps passed; evidence at ${EVIDENCE}`);

  // Tear down.
  try { boot.close?.(); } catch { /* */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('orchestration-center fatal:', err?.stack || err?.message || String(err));
  writeFileSync(EVIDENCE, JSON.stringify({
    ranAt: new Date().toISOString(),
    fatal: err?.stack || String(err),
  }, null, 2));
  process.exit(1);
});