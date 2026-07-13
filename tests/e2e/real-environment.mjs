/**
 * tests/e2e/real-environment.mjs
 *
 * Sprint S36 — Real-environment verification of the 7 v9.2.0 pages.
 *
 * Unlike the fixture-driven orchestration-center.mjs, this harness
 * points the dashboard server at a real temp project dir (so JSONL
 * logs, settings.json, notifications.jsonl are all real files on
 * disk), but otherwise runs against the live server — no mocks.
 *
 * Verifies each of the 7 new endpoint groups:
 *   1. /api/doctor/health
 *   2. /api/usage
 *   3. /api/backup/list
 *   4. /api/notifications
 *   5. /api/diagnostics
 *   6. /api/headroom/status
 *   7. /api/eval/runs
 *
 * Exits non-zero on any failure. Evidence written to /tmp.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const EVIDENCE = process.env.BIZAR_E2E_EVIDENCE ||
  join(tmpdir(), `bizar-real-env-${process.pid}.json`);

const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] ||
  4183,
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

async function main() {
  // 1. Boot against a real tmp project — no fixture, real dirs.
  const tmp = mkdtempSync(join(tmpdir(), 'bizar-real-env-'));
  // Seed the notifications log at the real location the store reads
  // from (BIZAR_HOME = ~/.config/bizar/). Use a unique id keyed by PID
  // so concurrent test runs don't clobber each other.
  const homeBizarDir = join(process.env.HOME || '/tmp', '.config', 'bizar');
  mkdirSync(homeBizarDir, { recursive: true });
  const seedId = `real-env-${process.pid}`;
  const seedEntry = JSON.stringify({ id: seedId, title: 'real-env boot', body: 'seeded', source: 'system', read: false, createdAt: new Date().toISOString() }) + '\n';
  // Append, don't overwrite — the file may already exist.
  const fs = await import('node:fs');
  fs.appendFileSync(join(homeBizarDir, 'notifications.jsonl'), seedEntry);

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

  // 2. /api/health — basic sanity.
  const health = await http(boot, '/api/health');
  record('endpoint.health', health.status === 200,
    `status=${health.status}`);

  // 3. /api/doctor/health — must return a status field.
  const doc = await http(boot, '/api/doctor/health');
  const docStatus = doc.json?.status;
  record('doctor.health', doc.status === 200 && ['ok', 'warn', 'fail'].includes(docStatus),
    `status=${doc.status} body.status=${docStatus}`);

  // 4. /api/usage — must return totals.totalTokens (defaults to 0 if no JSONL).
  const usage = await http(boot, '/api/usage?range=24h');
  record('usage.totals_shape',
    usage.status === 200 && typeof usage.json?.totals?.totalTokens === 'number',
    `status=${usage.status} totalTokens=${usage.json?.totals?.totalTokens}`);
  record('usage.perKey_array',
    Array.isArray(usage.json?.perKey),
    `len=${(usage.json?.perKey || []).length}`);

  // 5. /api/backup/list — must return { ok, backups: [] }.
  const backups = await http(boot, '/api/backup/list');
  record('backup.list_shape',
    backups.status === 200 && backups.json?.ok === true && Array.isArray(backups.json?.backups),
    `status=${backups.status} count=${backups.json?.backups?.length}`);

  // 6. /api/notifications — must return seeded notification.
  const notif = await http(boot, '/api/notifications');
  const items = notif.json?.notifications || [];
  record('notifications.list_shape',
    notif.status === 200 && Array.isArray(items),
    `status=${notif.status} count=${items.length}`);
  record('notifications.seed_present',
    items.some((n) => n.id === seedId),
    `seed=${items.some((n) => n.id === seedId)} seedId=${seedId}`);

  // 7. Notification read flow: mark seed read → unread count drops.
  const before = items.filter((n) => !n.read).length;
  const mark = await http(boot, `/api/notifications/${seedId}/read`, { method: 'POST' });
  record('notifications.mark_read_ok',
    mark.status === 200 && mark.json?.ok === true,
    `status=${mark.status}`);
  const afterList = await http(boot, '/api/notifications');
  const after = (afterList.json?.notifications || []).filter((n) => !n.read).length;
  record('notifications.unread_decreased',
    after < before,
    `before=${before} after=${after}`);

  // 8. /api/diagnostics — snapshot shape.
  const diag = await http(boot, '/api/diagnostics');
  record('diagnostics.snapshot',
    diag.status === 200 && diag.json !== null,
    `status=${diag.status} keys=${Object.keys(diag.json || {}).join(',')}`);

  // 9. /api/diagnostics/logs — log tail shape (may be empty).
  const logs = await http(boot, '/api/diagnostics/logs?tail=20');
  record('diagnostics.logs',
    logs.status === 200 && Array.isArray(logs.json?.lines),
    `status=${logs.status} lines=${logs.json?.lines?.length}`);

  // 10. /api/headroom/status — returns { installed, healthy, ... }.
  const hr = await http(boot, '/api/headroom/status');
  record('headroom.status',
    hr.status === 200 && typeof hr.json?.healthy === 'string' && typeof hr.json?.installed === 'boolean',
    `status=${hr.status} installed=${hr.json?.installed} healthy=${hr.json?.healthy}`);

  // 11. /api/eval/runs — list shape.
  const evalRuns = await http(boot, '/api/eval/runs');
  record('eval.runs_shape',
    evalRuns.status === 200 && Array.isArray(evalRuns.json?.runs),
    `status=${evalRuns.status} runs=${evalRuns.json?.runs?.length}`);

  // 12. Evidence dump.
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

  try { boot.close?.(); } catch { /* */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('real-environment fatal:', err?.stack || err?.message || String(err));
  writeFileSync(EVIDENCE, JSON.stringify({
    ranAt: new Date().toISOString(),
    fatal: err?.stack || String(err),
  }, null, 2));
  process.exit(1);
});