/**
 * tests/e2e/dashboard-full-surfaces.mjs — v10.0.5-S1.
 *
 * Closes umbrella criterion #1: "every Router case is reachable from
 * the sidebar + has a view root testid". Walks all 37 cases the
 * Router.tsx switch handles and asserts for each:
 *
 *   - the SPA sidebar renders a button for this view (data-sidebar-item)
 *   - clicking that button navigates the SPA to the route
 *   - the corresponding [data-view-<id>] root testid is in the DOM
 *
 * State-based router (no hash). agent-browser `click` does auto-scroll
 * but is flaky for off-canvas items; we use an eval-driven click path
 * so the test is timing-independent.
 *
 * Output: /tmp/bh-full-<pid>/<view-id>.png + results.json.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SHOT_DIR = join(tmpdir(), `bh-full-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });

if (!process.env.HOME || !process.env.HOME.includes('bh-full-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-full-home-<pid>');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
const projectRoot = mkdtempSync(join(HOME_OVERRIDE, 'bh-full-proj-'));
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
if (!process.env.BIZAR_STORE_HOME) {
  process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
}
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{
      id: 'bh-full-proj', name: 'bh-full-proj', path: projectRoot, root: projectRoot,
      cwd: projectRoot, addedAt: Date.now(),
    }],
    active: 'bh-full-proj',
  }, null, 2),
  'utf8',
);
writeFileSync(join(projectRoot, '.bizar', 'PROGRESS.md'), '# Cross-session progress\n', 'utf8');

const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
const PORT = 4388;
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

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => out += c);
    p.stderr.on('data', (c) => err += c);
    p.on('close', (code) => code === 0 ? resolve({ out, err }) : reject(new Error(`exit ${code}: ${err.slice(0, 200)}`)));
  });
}

// All 37 Router cases (mirror Router.tsx).
const VIEWS = [
  'overview', 'tasks', 'goals', 'agents', 'activity', 'memory',
  'skills', 'mcps', 'hooks',
  'settings', 'schedules', 'background',
  'doctor', 'usage', 'backup', 'notifications', 'diagnostics',
  'eval', 'chat',
  'projects-list', 'claude-sessions',
  'history', 'admin', 'auth',
  'env-vars', 'config', 'dialogs', 'providers', 'mods',
  'update', 'artifacts', 'lightrag',
  'voice', 'clipboard', 'obsidian', 'misc',
];

await sh('agent-browser', ['close', '--all']).catch(() => {});
await sh('agent-browser', ['set', 'viewport', '1440', '900']);
await sh('agent-browser', ['open', `http://127.0.0.1:${PORT}/`]);
await new Promise((r) => setTimeout(r, 2500));

// First: enumerate sidebar items via eval (one shot, prove all 37 exist).
const enumB64 = Buffer.from(
  String.raw`(function(){
    var buttons = Array.from(document.querySelectorAll('button[data-sidebar-item]'));
    return JSON.stringify({count: buttons.length, ids: buttons.map(function(b){return b.getAttribute('data-sidebar-item')})});
  })()`,
  'utf8',
).toString('base64');
const enumOut = (await sh('agent-browser', ['eval', '-b', enumB64])).out;
let enumStr = enumOut.trim();
if (enumStr.startsWith('"') && enumStr.endsWith('"')) enumStr = enumStr.slice(1, -1);
enumStr = enumStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const enumParsed = JSON.parse(enumStr);
console.log(`sidebar has ${enumParsed.count} items (expected 37)`);
if (enumParsed.count !== 37) {
  console.error(`expected 37 sidebar items, got ${enumParsed.count}: ${enumParsed.ids.join(',')}`);
  await boot.close?.();
  process.exit(1);
}

const results = {};
async function checkView(viewId) {
  // Click via eval — works for off-canvas items.
  const clickB64 = Buffer.from(
    String.raw`(function(){
      var btn = document.querySelector('button[data-sidebar-item="${viewId}"]');
      if (!btn) return JSON.stringify({ok:false, why:'no-sidebar-btn'});
      btn.click();
      return JSON.stringify({ok:true});
    })()`,
    'utf8',
  ).toString('base64');
  const clickOut = (await sh('agent-browser', ['eval', '-b', clickB64])).out;
  let s = clickOut.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const clickParsed = JSON.parse(s);
  if (!clickParsed.ok) {
    return { sidebarItem: false, viewRoot: false, detail: clickParsed.why };
  }
  // Wait for the lazy chunk + render.
  await new Promise((r) => setTimeout(r, 1500));
  const rootTestid = viewId === 'projects-list' ? 'projects-view' : `${viewId}-view`;
  const rootB64 = Buffer.from(
    String.raw`(function(){
      var el = document.querySelector('[data-testid="${rootTestid}"]');
      if (!el) {
        var all = Array.from(document.querySelectorAll('[data-testid$="-view"]')).map(function(e){return e.getAttribute('data-testid')});
        return JSON.stringify({found:false, all:all});
      }
      return JSON.stringify({found:true});
    })()`,
    'utf8',
  ).toString('base64');
  const rootOut = (await sh('agent-browser', ['eval', '-b', rootB64])).out;
  let r2 = rootOut.trim();
  if (r2.startsWith('"') && r2.endsWith('"')) r2 = r2.slice(1, -1);
  r2 = r2.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const parsed = JSON.parse(r2);
  if (parsed.found) {
    try { await sh('agent-browser', ['screenshot', join(SHOT_DIR, `${viewId}.png`)]); } catch { /* ignore */ }
    return { sidebarItem: true, viewRoot: true, detail: `testid=${rootTestid}` };
  }
  return { sidebarItem: true, viewRoot: false, detail: `missing ${rootTestid}; dom has ${JSON.stringify(parsed.all)}` };
}

let pass = 0;
let fail = 0;
const failures = [];
for (const v of VIEWS) {
  const r = await checkView(v);
  results[v] = r;
  if (r.viewRoot) {
    pass += 1;
    console.log(`\x1b[32mPASS\x1b[0m  ${v} — ${r.detail}`);
  } else {
    fail += 1;
    failures.push(v);
    console.log(`\x1b[31mFAIL\x1b[0m  ${v} — ${r.detail}`);
  }
}

try { await sh('agent-browser', ['close', '--all']); } catch { /* ignore */ }
await boot.close?.();

writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify({
  results,
  pass, fail, total: VIEWS.length,
  failures, shots: SHOT_DIR, projectRoot, homeOverride: HOME_OVERRIDE,
}, null, 2));

console.log(`\nshots in: ${SHOT_DIR}`);
console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
console.log(`\n${pass}/${VIEWS.length} surfaces have a view-root testid`);
process.exit(fail > 0 ? 1 : 0);