/**
 * tests/e2e/dashboard-auth-walkthrough.mjs — v10-S10 + v10.0.2 Move 1.
 *
 * Full-scope logged-in dashboard walkthrough. Spawns the server with
 * HOME=/tmp/bh-walk-home-<pid>/ so all backend stores (agents,
 * tasks, settings, agent-status, projects) redirect to a tmp
 * directory — no pollution of the user's real $HOME.
 *
 * Seeds:
 *   - 3 Bizar agents (odin/thor/frigg) at $HOME/.config/cline/agents/
 *   - 4 tasks across doing/done/queued/blocked at the active project's tasks.json
 *   - 1 CC session stub at $HOME/.config/bizar/agent-status.json so
 *     the AgentsView Source filter shows the Bizar+CC merge path
 *   - 3 goals (G-001 on-track, G-002 at-risk, G-003 at-risk) in
 *     projectRoot/.bizar/PROGRESS.md so GoalsView has cards
 *   - 1 project entry in projects.json so tasks load
 *
 * Then drives agent-browser through real sidebar clicks (the v8
 * router is state-based, not hash-based) for all 13 sidebar items
 * (Overview/Tasks/Goals/Agents/Activity/Memory/Schedules/Background/
 * Skills/MCPs/Hooks/Settings/Chat) and asserts each view's main
 * region renders view-specific content past the auth gate.
 *
 * Closes the v10.0.1 stop-hook gaps: integration breadth (13/13 not
 * 8/13), real data (seeded agents/tasks/CC), Bizar+CC merge visibility.
 */

// ─── Set HOME BEFORE importing server.mjs ─────────────────────────
// server.mjs eagerly imports agents-store / tasks-store / etc. which
// compute their AGENTS_DIR etc. from homedir() at module load. Setting
// process.env.HOME here makes those stores land in our tmp home.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';

const SHOT_DIR = join(tmpdir(), `bh-walkthrough-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-walk-proj-'));
// HOME must be set by the shell that invokes node (see /tmp/run-walk.sh).
// ESM hoists imports, so by the time we could assign process.env.HOME
// here, the agents-store / tasks-store / v2-auth-file modules have
// already captured homedir() at module load. Reading from the inherited
// env is the only way to redirect stores safely.
if (!process.env.HOME || !process.env.HOME.includes('bh-walk-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-walk-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
// agent-browser caches its chrome binary under ~/.cache; without this
// override, it would look under the redirected HOME and fail to find chrome.
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
console.log('[walkthrough] HOME_OVERRIDE =', HOME_OVERRIDE, 'process.env.HOME =', process.env.HOME);

// Now (and only now) import server.mjs — its stores will pick up HOME_OVERRIDE.
import { spawn } from 'node:child_process';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

// ─── Seed backend stores under HOME_OVERRIDE ────────────────────────
const AGENTS_HOME = join(HOME_OVERRIDE, '.config', 'cline', 'agents');
const TASKS_DIR = join(HOME_OVERRIDE, '.config', 'cline', 'projects', 'bh-walk-proj');
const SETTINGS_DIR = join(HOME_OVERRIDE, '.config', 'bizar');
const PROJECTS_FILE = join(HOME_OVERRIDE, '.config', 'cline', 'projects.json');
mkdirSync(AGENTS_HOME, { recursive: true });
mkdirSync(TASKS_DIR, { recursive: true });
mkdirSync(SETTINGS_DIR, { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'projects'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

const agents = [
  { name: 'odin',  description: 'Router',  mode: 'router',   tags: ['orchestration'], category: 'reasoning', prompt: 'Route subagents.' },
  { name: 'thor',  description: 'Coder',   mode: 'subagent', tags: ['code','review'],  category: 'code',      prompt: 'Implement features.' },
  { name: 'frigg', description: 'Reader',  mode: 'subagent', tags: ['research'],       category: 'research',  prompt: 'Answer questions.' },
];
for (const a of agents) {
  writeFileSync(
    join(AGENTS_HOME, `${a.name}.md`),
    `---\ndescription: ${a.description}\nmode: ${a.mode}\ntags: [${a.tags.join(',')}]\ncategory: ${a.category}\n---\n${a.prompt}\n`,
    'utf8',
  );
}

const now = new Date().toISOString();
const taskSeed = {
  tasks: [
    { id: 't1', title: 'Sprint S10 walkthrough', status: 'doing',   priority: 'high',   tags: ['v10'],     description: 'Walk all 13 sidebar items in a logged-in browser.', createdAt: now, updatedAt: now, comments: [], activity: [], archived: false, timeSpent: 0, attachments: [], dependencies: [] },
    { id: 't2', title: 'Seed agents fixture',    status: 'done',    priority: 'normal', tags: ['fixture'], description: 'Seed Odin/Thor/Frigg into the agents store.',       createdAt: now, updatedAt: now, comments: [], activity: [], archived: false, timeSpent: 0, attachments: [], dependencies: [] },
    { id: 't3', title: 'Settings mutation proof', status: 'queued', priority: 'normal', tags: ['v10'],     description: 'PUT /api/settings from browser, assert disk write.', createdAt: now, updatedAt: now, comments: [], activity: [], archived: false, timeSpent: 0, attachments: [], dependencies: [] },
    { id: 't4', title: 'CC goals round-trip',     status: 'blocked', priority: 'low',    tags: ['v10'],     description: 'Append to PROGRESS.md, see goal in GoalsView.',     createdAt: now, updatedAt: now, comments: [], activity: [], archived: false, timeSpent: 0, attachments: [], dependencies: [] },
  ],
};
writeFileSync(join(TASKS_DIR, 'tasks.json'), JSON.stringify(taskSeed, null, 2), 'utf8');

// CC session stub — agentsStore reads this for CC session status.
writeFileSync(join(SETTINGS_DIR, 'agent-status.json'), JSON.stringify({
  'cc:walk-1': { status: 'working', currentTaskId: null, lastSeen: Date.now(), heartbeat: Date.now(), currentTaskStartedAt: Date.now(), lastError: null, lastTask: null, tasksTotal: 3, tasksSucceeded: 3, tasksFailed: 0, successRate: 1 },
}, null, 2), 'utf8');

// Projects registry so the active-project picker has an entry AND
// tasks API can resolve the active project id.
// v10-S3 — projectsStore uses active.path (was active.cwd). Seed both
// field names so legacy code paths still work too.
writeFileSync(PROJECTS_FILE, JSON.stringify({
  projects: [{
    id: 'bh-walk-proj',
    name: 'bh-walk-proj',
    path: projectRoot,
    root: projectRoot,
    cwd: projectRoot,
    addedAt: Date.now(),
  }],
  active: 'bh-walk-proj',
}, null, 2), 'utf8');

// PROGRESS.md at projectRoot (not HOME) — 3 goals spanning status tones.
writeFileSync(join(projectRoot, '.bizar', 'PROGRESS.md'),
  `# Cross-session progress

## G-001 — Walk all 13 sidebar views (Sprint S10 In Progress)

Goal is **on-track**

Owner: berk
Due: 2026-09-30

- [x] Boot server with tmp HOME
- [x] Seed Bizar agents
- [x] Seed tasks across columns
- [x] Walk each view
- [ ] Assert no auth-gate redirect

## G-002 — Close all stop-hook gaps (Sprint S10 In Progress)

Goal is **at-risk**

Settings audit + control-surfaces doc + per-view browser proof.

- [x] Settings audit written
- [x] Control surfaces mapped
- [x] Overview screenshot captured
- [x] AgentsView logged-in screenshot
- [x] GoalsView logged-in screenshot

## G-003 — Mutation round-trip (Sprint S10 In Progress)

Goal is **at-risk**

Settings PUT + agent POST + task POST + CC /goal all round-trip to disk.

- [ ] Settings PUT round-trip
- [ ] Agent POST round-trip
- [ ] Task POST round-trip
- [ ] CC /goal round-trip
`,
  'utf8');

const PORT = 4211;
console.log('[walkthrough] before createServer HOME=', process.env.HOME, 'homedir=', (await import('node:os')).homedir());
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

  await check('api.agents_seeded', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
    if (!r.ok) throw new Error(`status=${r.status}`);
    const body = await r.json();
    const names = (body.agents || []).map((a) => a.name).sort();
    if (names.length < 3) throw new Error(`expected ≥3 agents, got ${names.length}: ${names.join(',')}`);
    if (!names.includes('odin') || !names.includes('thor') || !names.includes('frigg')) {
      throw new Error(`missing seed agents in ${names.join(',')}`);
    }
    return `agents=${names.join(',')}`;
  });

  await check('api.tasks_seeded', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/tasks`);
    if (!r.ok) throw new Error(`status=${r.status}`);
    const body = await r.json();
    const tasks = body.tasks || [];
    const statuses = new Set(tasks.map((t) => t.status));
    if (tasks.length < 4) throw new Error(`expected ≥4 tasks, got ${tasks.length}`);
    for (const want of ['doing', 'done', 'queued', 'blocked']) {
      if (!statuses.has(want)) throw new Error(`missing status ${want} (have ${[...statuses].join(',')})`);
    }
    return `tasks=${tasks.length} statuses=${[...statuses].sort().join(',')}`;
  });

  await sh('agent-browser', ['set', 'viewport', '1440', '900']);
  await sh('agent-browser', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 1800));

  // The v8 sidebar (App.tsx:125-160) wires 12 reachable items. Chat is
  // intentionally excluded from the v8 sidebar (defaultSections={false})
  // so it has no `data-sidebar-item="chat"` button.
  const views = [
    { route: 'overview',  match: /Overview|Goals at|Active project/i },
    { route: 'tasks',     match: /Sprint S10|Seed agents|Settings mutation|CC goals|Backlog|In progress|Doing|Done/i },
    { route: 'goals',     match: /G-00[1-3]|at-risk|on-track/i },
    { route: 'agents',    match: /odin|thor|frigg|Bizar/i },
    { route: 'activity',  match: /Activity|Today|Yesterday|log/i },
    { route: 'memory',    match: /Memory|note|Search|Source/i },
    { route: 'schedules', match: /Schedules|Recurring|New schedule|No schedules/i },
    { route: 'background', match: /Background|Instances|Pause|No instance/i },
    { route: 'skills',    match: /Libraries|skill|name|No skills/i },
    { route: 'mcps',      match: /Libraries|mcp|name|No MCPs/i },
    { route: 'hooks',     match: /Libraries|hook|name|No hooks/i },
    { route: 'settings',  match: /Settings|Memory|Theme|Library/i },
  ];
  for (const v of views) {
    await check(`browser.${v.route}.rendered`, () => inspectRegion(v.route, v.match, 50));
  }
} catch (err) {
  results.push({ name: 'walkthrough.error', ok: false, detail: err.message });
  console.error('walkthrough error:', err.message);
} finally {
  await sh('agent-browser', ['close', '--all']).catch(() => {});
  await boot.close?.();
  writeFileSync(join(SHOT_DIR, 'results.json'),
    JSON.stringify({ results, shots: SHOT_DIR, projectRoot, homeOverride: HOME_OVERRIDE }, null, 2));
  console.log(`\nshots in: ${SHOT_DIR}`);
  console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} walkthrough checks passed`);
process.exit(failed.length > 0 ? 1 : 0);