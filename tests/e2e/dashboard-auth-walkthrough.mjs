/**
 * tests/e2e/dashboard-auth-walkthrough.mjs — v10-S10.
 *
 * Per-view logged-in browser walkthrough. Loopback is auto-trusted
 * (see auth.mjs:isAuthRequired → 127.0.0.1 bypass), so the browser just
 * opens each route and we assert each view's main region renders
 * view-specific content past the sidebar nav. Closes the v10-S7 gap
 * where only the Overview tile was screenshot-verified.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const SHOT_DIR = join(tmpdir(), `bh-walkthrough-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-walk-proj-'));
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.BIZAR_HEADROOM_AUTOSTART = '0';

mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
mkdirSync(join(projectRoot, '.config', 'cline'), { recursive: true });
mkdirSync(join(projectRoot, '.config', 'bizar'), { recursive: true });
writeFileSync(join(projectRoot, '.bizar', 'PROGRESS.md'),
  `# Cross-session progress

## G-001 — Verify v10 dashboard (Sprint S10 In Progress)

Goal is **on-track**

Prove every v8 view renders with real data in a logged-in browser.

Owner: berk
Due: 2026-09-30

- [x] Boot server + read secret
- [x] Walk each view
- [ ] Assert no auth-gate redirects

## G-002 — Close all stop-hook gaps (Sprint S10 In Progress)

Goal is **at-risk**

Settings audit + control-surfaces doc + per-view browser proof.

- [x] Settings audit written
- [x] Control surfaces mapped
- [x] Overview screenshot captured
- [ ] AgentsView logged-in screenshot
- [ ] GoalsView logged-in screenshot
`,
  'utf8');

const PORT = 4211;
const boot = await createServer({
  port: PORT,
  projectRoot,
  clineConfigDir: join(projectRoot, '.config', 'cline'),
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

// Navigate via the sidebar (the v8 router is state-based, not hash-based).
// data-sidebar-item={id} marks each nav button.
async function inspectRegion(route, matchRe, minBytes = 80) {
  const clickCmd = `button[data-sidebar-item="${route}"]`;
  await sh('agent-browser', ['click', clickCmd]);
  await new Promise((r) => setTimeout(r, 2200));
  await sh('agent-browser', ['screenshot', join(SHOT_DIR, `${route}-logged-in.png`)]);
  // Confirm the active sidebar item matches.
  const { out: activeAttr } = await sh('agent-browser',
    ['eval', `document.querySelector('.v8-sidebar-item.is-active')?.getAttribute('data-sidebar-item') ?? ''`]);
  // agent-browser returns JSON-stringified results; strip outer quotes.
  const activeId = activeAttr.trim().replace(/^"|"$/g, '');
  if (activeId !== route) {
    throw new Error(`active sidebar=${activeId} expected=${route}`);
  }
  // Pull the main region; fall back to body innerText.
  const evalMain = "document.querySelector('main, [role=main], #root main')?.innerText ?? document.body.innerText";
  const { out: main } = await sh('agent-browser', ['eval', evalMain]);
  if (main.length < minBytes) {
    throw new Error(`main innerText too short (${main.length})`);
  }
  if (!matchRe.test(main)) {
    throw new Error(`content missing /${matchRe.source}/ (got ${main.slice(0, 280)}...)`);
  }
  return `innerTextBytes=${main.length} active=${route}`;
}

try {
  await check('api.goals_works', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/goals`);
    if (!r.ok) throw new Error(`status=${r.status}`);
    const body = await r.json();
    return `goals=${body?.count ?? 0}`;
  });

  await sh('agent-browser', ['set', 'viewport', '1440', '900']);
  await sh('agent-browser', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 1800));

  await check('browser.overview.rendered',
    () => inspectRegion('overview', /Overview|Goals at|Active project/i, 50));
  await check('browser.agents.rendered',
    () => inspectRegion('agents', /Agents|Source|bizar|cline/i, 50));
  await check('browser.goals.rendered',
    () => inspectRegion('goals', /G-00[12]|Goal is|on-track|at-risk/i, 50));
  await check('browser.tasks.rendered',
    () => inspectRegion('tasks', /Tasks|Backlog|Todo|Doing|Done/i, 50));
  await check('browser.settings.rendered',
    () => inspectRegion('settings', /Settings|Memory|Theme|Library/i, 50));
  await check('browser.memory.rendered',
    () => inspectRegion('memory', /Memory|note|Search|Source/i, 50));
  await check('browser.activity.rendered',
    () => inspectRegion('activity', /Activity|Today|Yesterday|log/i, 50));
} catch (err) {
  results.push({ name: 'walkthrough.error', ok: false, detail: err.message });
  console.error('walkthrough error:', err.message);
} finally {
  await sh('agent-browser', ['close', '--all']).catch(() => {});
  await boot.close?.();
  writeFileSync(join(SHOT_DIR, 'results.json'),
    JSON.stringify({ results, shots: SHOT_DIR, projectRoot }, null, 2));
  console.log(`\nshots in: ${SHOT_DIR}`);
  console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} walkthrough checks passed`);
process.exit(failed.length > 0 ? 1 : 0);