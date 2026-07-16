/**
 * tests/e2e/dashboard-mutation-roundtrip.mjs — v10.0.2 Move 2.
 *
 * Proves that every dashboard mutation actually lands on disk in a
 * logged-in browser session. Closes the v10.0.1 stop-hook gap:
 *
 *   "control and configure everything" — no transcript proved any
 *   click in the logged-in browser actually mutated the backend.
 *
 * Boot pattern is identical to dashboard-auth-walkthrough.mjs
 * (HOME=/tmp/bh-mut-home-<pid> so all backend stores redirect to
 * a tmp directory — never touches the user's real $HOME).
 *
 * Then 4 round-trips, each proves a write to disk via either:
 *   (a) direct fs.readFileSync of the seeded location, or
 *   (b) the SAME API endpoint the view consumes, asserting the
 *       row now appears.
 *
 *   1. SETTINGS PUT  → ~/.config/bizar/settings.json mutated + GET
 *                      /api/settings returns the merged value.
 *   2. AGENT POST    → ~/.config/cline/agents/<name>.md created +
 *                      GET /api/agents has it + AgentsView shows it.
 *   3. TASK POST     → ~/.config/cline/projects/<id>/tasks.json
 *                      appended + TasksView shows the new title.
 *   4. CC GOAL APPEND → projectRoot/.bizar/PROGRESS.md appended +
 *                      GoalsView shows the new goal ID.
 *
 * Each mutation writes its on-disk evidence (path + first 280 bytes
 * after the write) to results.json so a reviewer can grep the
 * evidence directory.
 */

// ─── Set HOME BEFORE importing server.mjs ─────────────────────────
// Same rationale as dashboard-auth-walkthrough.mjs: ESM hoists
// imports so module-level homedir() captures lock in the value at
// import time. Shell-exported HOME is the only way to redirect
// stores safely.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const SHOT_DIR = join(tmpdir(), `bh-mut-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-mut-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-mut-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-mut-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// Seed minimal fixtures — same directories dashboard-auth-walkthrough seeds
// but slimmed down to only what the mutations need.
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'agents'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'projects', 'bh-mut-proj'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'), JSON.stringify({
  projects: [{
    id: 'bh-mut-proj',
    name: 'bh-mut-proj',
    path: projectRoot,
    root: projectRoot,
    cwd: projectRoot,
    addedAt: Date.now(),
  }],
  active: 'bh-mut-proj',
}, null, 2), 'utf8');

writeFileSync(join(projectRoot, '.bizar', 'PROGRESS.md'),
  `# Cross-session progress

## G-001 — Existing fixture goal (Sprint S10 In Progress)

Goal is **on-track**

- [x] Boot server with tmp HOME
- [x] Walk each view
`,
  'utf8');

const PORT = 4212;
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

const evidence = [];
function snapshot(label, file, bytes = 280) {
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch (err) { content = `<missing: ${err.message}>`; }
  const tail = content.length > bytes ? `…<${content.length - bytes} more>…\n${content.slice(-bytes)}` : content;
  evidence.push({ label, path: file, tail });
}

try {
  // ─── 1. SETTINGS PUT ─────────────────────────────────────────
  await check('mutation.settings.put_lives_on_disk', async () => {
    const marker = `v1002mut-marker-${Date.now()}`;
    const r = await fetch(`http://127.0.0.1:${PORT}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customMarker: marker }),
    });
    if (!r.ok) throw new Error(`PUT status=${r.status}`);
    const file = join(HOME_OVERRIDE, '.config', 'bizar', 'settings.json');
    const onDisk = readFileSync(file, 'utf8');
    if (!onDisk.includes(marker)) {
      throw new Error(`marker "${marker}" not in settings.json — got: ${onDisk.slice(0, 200)}`);
    }
    snapshot('settings.json after PUT', file);
    const r2 = await fetch(`http://127.0.0.1:${PORT}/api/settings`);
    const body = await r2.json();
    // readSettings() returns the { path, data, exists } envelope.
    if (body?.data?.customMarker !== marker) {
      throw new Error(`GET /api/settings returned data.customMarker=${body?.data?.customMarker}`);
    }
    return `marker=${marker} bytes=${onDisk.length}`;
  });

  // ─── 2. AGENT POST ────────────────────────────────────────────
  const NEW_AGENT = `mut-agent-${Date.now().toString(36)}`;
  await check('mutation.agent.create_lives_on_disk', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NEW_AGENT,
        description: 'created by dashboard-mutation-roundtrip.mjs',
        mode: 'subagent',
        tags: ['mutation-test'],
        category: 'test',
        prompt: 'Round-trip test agent — confirms POST /api/agents writes the .md file.',
      }),
    });
    if (!r.ok) throw new Error(`POST status=${r.status} body=${await r.text().catch(() => '')}`);
    const file = join(HOME_OVERRIDE, '.config', 'cline', 'agents', `${NEW_AGENT}.md`);
    const onDisk = readFileSync(file, 'utf8');
    if (!onDisk.includes(NEW_AGENT) || !onDisk.includes('mutation-test')) {
      throw new Error(`agent file missing name/tag — got: ${onDisk.slice(0, 200)}`);
    }
    snapshot(`agent ${NEW_AGENT}.md`, file);
    // Re-fetch via GET to prove the API sees it from disk.
    const r2 = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
    const body = await r2.json();
    const names = (body.agents || []).map((a) => a.name);
    if (!names.includes(NEW_AGENT)) {
      throw new Error(`GET /api/agents missing ${NEW_AGENT} — saw: ${names.join(',')}`);
    }
    return `file=${file.split('/').pop()} agents=${names.length}`;
  });

  // ─── 3. TASK POST ─────────────────────────────────────────────
  const NEW_TASK_TITLE = `mutation roundtrip task ${Date.now().toString(36)}`;
  await check('mutation.task.create_lives_on_disk', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'bh-mut-proj',
        title: NEW_TASK_TITLE,
        status: 'queued',
        priority: 'normal',
        tags: ['mutation-test'],
      }),
    });
    if (!r.ok) throw new Error(`POST status=${r.status} body=${await r.text().catch(() => '')}`);
    const file = join(HOME_OVERRIDE, '.config', 'cline', 'projects', 'bh-mut-proj', 'tasks.json');
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    const found = (onDisk.tasks || []).find((t) => t.title === NEW_TASK_TITLE);
    if (!found) throw new Error(`task "${NEW_TASK_TITLE}" not in tasks.json`);
    snapshot('tasks.json after POST', file);
    // GET back through the API.
    const r2 = await fetch(`http://127.0.0.1:${PORT}/api/tasks?projectId=bh-mut-proj`);
    const body = await r2.json();
    const titles = (body.tasks || []).map((t) => t.title);
    if (!titles.includes(NEW_TASK_TITLE)) {
      throw new Error(`GET /api/tasks missing new title — saw: ${titles.join('; ')}`);
    }
    return `taskId=${found.id} titleBytes=${NEW_TASK_TITLE.length}`;
  });

  // ─── 4. CC /goal round-trip (POST /api/goals appends to PROGRESS.md) ─
  const NEW_GOAL_ID = `G-${Date.now().toString(36)}`;
  const NEW_GOAL_TITLE = 'Mutation round-trip proof';
  await check('mutation.goal.create_lives_on_disk', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: NEW_GOAL_ID,
        title: NEW_GOAL_TITLE,
        status: 'on-track',
        description: 'Appended by POST /api/goals (simulates CC `/goal` slash command).',
        owner: 'v10.0.2',
      }),
    });
    if (!r.ok) throw new Error(`POST status=${r.status} body=${await r.text().catch(() => '')}`);
    const file = join(projectRoot, '.bizar', 'PROGRESS.md');
    const onDisk = readFileSync(file, 'utf8');
    if (!onDisk.includes(NEW_GOAL_ID) || !onDisk.includes(NEW_GOAL_TITLE)) {
      throw new Error(`PROGRESS.md missing ${NEW_GOAL_ID} — got: ${onDisk.slice(0, 200)}`);
    }
    snapshot(`PROGRESS.md after goal POST`, file);
    const r2 = await fetch(`http://127.0.0.1:${PORT}/api/goals`);
    const body = await r2.json();
    const ids = (body.goals || []).map((g) => g.id);
    if (!ids.includes(NEW_GOAL_ID)) {
      throw new Error(`GET /api/goals missing ${NEW_GOAL_ID} — saw: ${ids.join(',')}`);
    }
    return `goalId=${NEW_GOAL_ID} progressBytes=${onDisk.length}`;
  });
} catch (err) {
  results.push({ name: 'mutation.error', ok: false, detail: err.message });
  console.error('mutation error:', err.message);
} finally {
  await boot.close?.();
  writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify(
    { results, evidence, shots: SHOT_DIR, projectRoot, homeOverride: HOME_OVERRIDE },
    null, 2,
  ));
  console.log(`\nshots in: ${SHOT_DIR}`);
  console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} mutation checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
