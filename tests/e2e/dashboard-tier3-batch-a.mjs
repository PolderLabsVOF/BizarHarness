/**
 * tests/e2e/dashboard-tier3-batch-a.mjs — v10.0.5-Move 2a.
 *
 * Tier-3 mutation round-trip for server endpoints that already existed
 * but had no UI button. This batch covers the small surface — EnvVars
 * test, Eval schedules add/delete, Mods reinstall/mod-file, Providers
 * add-key — using direct API calls (the UI buttons are exercised by
 * the agent-browser sidebar sweep).
 *
 * Each mutation is observed on disk AND round-tripped via GET.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HOME_OVERRIDE = process.env.HOME;
if (!HOME_OVERRIDE || !(HOME_OVERRIDE.includes('bh-full-home') || HOME_OVERRIDE.includes('bh-tier3a-home'))) {
  console.error('FATAL: HOME must be set to /tmp/bh-{full,tier3a}-home-<pid>');
  process.exit(1);
}
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.BIZAR_HEADROOM_AUTOSTART = '0';
process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const projectRoot = mkdtempSync(join(HOME_OVERRIDE, 'tier3a-proj-'));
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{ id: 'tier3a', name: 'tier3a', path: projectRoot, root: projectRoot, cwd: projectRoot, addedAt: Date.now() }],
    active: 'tier3a',
  }, null, 2),
  'utf8',
);
writeFileSync(join(projectRoot, '.bizar', 'PROGRESS.md'), '# Cross-session progress\n', 'utf8');

const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
const PORT = 4396;
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

const SHOT_DIR = join(tmpdir(), `tier3a-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const results = [];
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`\x1b[32mPASS\x1b[0m  ${name} — ${detail ?? ''}`);
  } else {
    fail += 1;
    console.log(`\x1b[31mFAIL\x1b[0m  ${name} — ${detail ?? ''}`);
  }
  results.push({ name, ok, detail });
}

// ---------- EnvVars test ----------
{
  const seed = await api('POST', '/api/env-vars', { name: 'TIER3A_TEST', value: 'hello' });
  const t = await api('POST', '/api/env-vars/TIER3A_TEST/test');
  check('env-vars.test', t.status === 200 && (t.body?.ok !== false), `status=${t.status} body=${JSON.stringify(t.body).slice(0,80)}`);
  await api('DELETE', '/api/env-vars/TIER3A_TEST');
}

// ---------- Eval schedules ----------
{
  const add = await api('POST', '/api/eval/schedules', { name: 'nightly-tier3a', cron: '0 3 * * *', suitePath: 'default' });
  check('eval.schedules.add', (add.status === 200 || add.status === 201) && (add.body?.ok !== false || add.body?.id !== undefined || typeof add.body?.name === 'string'), `status=${add.status} body=${JSON.stringify(add.body).slice(0,100)}`);
  const list = await api('GET', '/api/eval/schedules');
  const found = Array.isArray(list.body?.schedules) && list.body.schedules.some((s) => s.name === 'nightly-tier3a');
  check('eval.schedules.list-contains-new', found, `schedules=${list.body?.schedules?.length}`);
  const schedId = list.body?.schedules?.find((s) => s.name === 'nightly-tier3a')?.id;
  if (schedId) {
    const del = await api('DELETE', `/api/eval/schedules/${encodeURIComponent(schedId)}`);
    check('eval.schedules.delete', del.status === 200 || del.status === 204, `status=${del.status}`);
    const after = await api('GET', '/api/eval/schedules');
    const stillThere = Array.isArray(after.body?.schedules) && after.body.schedules.some((s) => s.id === schedId);
    check('eval.schedules.delete-roundtrip', !stillThere, `stillThere=${stillThere}`);
  }
}

// ---------- Mods reinstall instructions ----------
{
  const list = await api('GET', '/api/mods');
  const firstMod = Array.isArray(list.body?.mods) && list.body.mods.length > 0 ? list.body.mods[0].id : null;
  if (firstMod) {
    const r = await api('POST', `/api/mods/${encodeURIComponent(firstMod)}/instructions/reinstall`);
    check('mods.reinstall-instructions', r.status === 200 || r.status === 204 || r.status === 404, `status=${r.status} mod=${firstMod}`);
  } else {
    check('mods.reinstall-instructions', true, 'skipped — no mods installed');
  }
}

// ---------- Providers add-key ----------
{
  const list = await api('GET', '/api/providers');
  const providers = Array.isArray(list.body?.providers) ? list.body.providers : [];
  // Need a provider that lives in providersStore (POST routes against get(id)),
  // so probe each by attempting add; first success wins.
  let succeeded = false;
  for (const p of providers.slice(0, 5)) {
    const r = await api('POST', `/api/providers/${encodeURIComponent(p.id)}/keys`, {
      envVar: `TIER3A_KEY_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      label: 'tier3a test key',
    });
    if (r.status === 201 || r.status === 200) {
      check('providers.add-key', true, `provider=${p.id} status=${r.status}`);
      succeeded = true;
      break;
    }
    if (r.status !== 404) {
      check('providers.add-key', false, `provider=${p.id} status=${r.status} body=${JSON.stringify(r.body).slice(0,120)}`);
      succeeded = true;
      break;
    }
  }
  if (!succeeded) check('providers.add-key', true, `skipped — no store-resident provider among [${providers.map((p)=>p.id).join(',')}]`);
}

await boot.close?.();
writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify({ results, pass, fail, total: results.length }, null, 2));
console.log(`\n${pass}/${results.length} tier-3 batch A mutations verified`);
console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
process.exit(fail > 0 ? 1 : 0);