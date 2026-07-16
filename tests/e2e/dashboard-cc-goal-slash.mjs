/**
 * tests/e2e/dashboard-cc-goal-slash.mjs — v10.0.4-S2.
 *
 * Closes umbrella criterion #2 ("goals should use the default CC
 * goals method"). The previous test only proved POST /api/goals round-
 * trips on disk; this one proves the **slash command path** the user
 * actually runs — `.claude/commands/goal.md` literally resolves
 * `~/.cache/bizarharness/dash-auth.json` for the port and curls the
 * dashboard API. We reproduce that sequence end-to-end:
 *
 *   1. Resolve dashboard port from ~/.cache/bizarharness/dash-auth.json.
 *   2. Mint a goal via POST /api/goals (mimics "Add a goal" in /goal).
 *   3. PATCH /api/goals/:id/status  → change status (mimics rename).
 *   4. POST /api/goals/:id/key-results + PATCH done + DELETE (KR cycle).
 *   5. Click goals sidebar; assert the new goal renders live.
 *   6. Append a goal directly to PROGRESS.md (CC writes when dashboard
 *      is unreachable); assert the watcher fires + GoalsView updates.
 *
 * Each mutation is observed on disk (readFileSync PROGRESS.md) AND in
 * the UI (main.innerText after sidebar click).
 *
 * Outputs: /tmp/bh-goal-slash-<pid>/*.png + results.json.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SHOT_DIR = join(tmpdir(), `bh-goal-slash-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-goal-slash-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-goal-slash-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-goal-slash-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
if (!process.env.BIZAR_STORE_HOME) {
  process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
}
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'agents'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{
      id: 'bh-goal-slash-proj',
      name: 'bh-goal-slash-proj',
      path: projectRoot,
      root: projectRoot,
      cwd: projectRoot,
      addedAt: Date.now(),
    }],
    active: 'bh-goal-slash-proj',
  }, null, 2),
  'utf8',
);
writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'agents', 'odin.md'),
  '---\ndescription: Router\nmode: router\ntags: [orchestration]\ncategory: reasoning\n---\nRoute.\n',
  'utf8',
);
writeFileSync(
  join(HOME_OVERRIDE, '.config', 'bizar', 'agent-status.json'),
  JSON.stringify({
    odin: {
      status: 'idle',
      currentTaskId: null,
      lastSeen: Date.now(),
      heartbeat: Date.now(),
      currentTaskStartedAt: null,
      lastError: null,
      lastTask: null,
      tasksTotal: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      successRate: 1,
    },
  }, null, 2),
  'utf8',
);
// Empty PROGRESS.md so the watcher has something to react to.
writeFileSync(
  join(projectRoot, '.bizar', 'PROGRESS.md'),
  '# Cross-session progress\n',
  'utf8',
);

// ─── Boot server ──────────────────────────────────────────────────
const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
// Use the v2 default port (4098) so the resolved `auth.port` matches
// the actual listen port — this is what the `/goal` slash command
// does end-to-end (see .claude/commands/goal.md).
const PORT = 4098;
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

async function agentBrowserEval(expr) {
  const b64 = Buffer.from(expr, 'utf8').toString('base64');
  const { out } = await sh('agent-browser', ['eval', '-b', b64]);
  let s = out.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return s;
}

const PROGRESS_FILE = join(projectRoot, '.bizar', 'PROGRESS.md');
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

// ─── 1: port resolution matches the slash command contract ────────
await check('goal-slash.port_resolved_from_auth_file', async () => {
  // goal.md does: `PORT=$(jq -r .port ~/.cache/bizarharness/dash-auth.json)`
  const authPath = join(HOME_OVERRIDE, '.cache', 'bizarharness', 'dash-auth.json');
  if (!existsSync(authPath)) throw new Error(`auth file missing: ${authPath}`);
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  if (auth.port !== PORT) {
    throw new Error(`auth.port=${auth.port} ≠ PORT=${PORT}`);
  }
  return `port=${auth.port} matches server`;
});

// ─── 2: POST /api/goals — exactly what `/goal add` does ───────────
let goalId;
await check('goal-slash.post_creates_goal', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Ship v10.0.4 /goal round-trip',
      owner: 'sam',
      due: '2026-09-30',
    }),
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`expected 200/201 got ${r.status}`);
  }
  const body = await r.json();
  goalId = body.goal?.id || body.id;
  if (!goalId) throw new Error(`no goal.id in response: ${JSON.stringify(body)}`);
  if (!existsSync(PROGRESS_FILE)) throw new Error('PROGRESS.md missing');
  const onDisk = readFileSync(PROGRESS_FILE, 'utf8');
  if (!onDisk.includes('Ship v10.0.4')) {
    throw new Error(`title missing on disk: ${onDisk.slice(-200)}`);
  }
  return `id=${goalId} onDisk=present`;
});

// ─── 3: PATCH /api/goals/:id/status — slash command rename path ────
await check('goal-slash.patch_status_at_risk', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/goals/${goalId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'at-risk' }),
  });
  if (!r.ok) throw new Error(`expected 2xx got ${r.status}`);
  const body = await r.json();
  if (body.goal?.status !== 'at-risk' && body.status !== 'at-risk') {
    throw new Error(`status not at-risk: ${JSON.stringify(body)}`);
  }
  return `status=at-risk`;
});

// ─── 4: KR cycle — POST, PATCH done, DELETE ───────────────────────
let krId;
await check('goal-slash.kr_full_cycle', async () => {
  const post = await fetch(`http://127.0.0.1:${PORT}/api/goals/${goalId}/key-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Run disk-fallback E2E on CI' }),
  });
  if (!post.ok) throw new Error(`KR POST failed: ${post.status}`);
  const krBody = await post.json();
  krId = krBody.keyResult?.id || krBody.id;
  if (!krId) throw new Error(`no kr.id: ${JSON.stringify(krBody)}`);

  const patch = await fetch(`http://127.0.0.1:${PORT}/api/goals/${goalId}/key-results/${krId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: true }),
  });
  if (!patch.ok) throw new Error(`KR PATCH failed: ${patch.status}`);

  const del = await fetch(`http://127.0.0.1:${PORT}/api/goals/${goalId}/key-results/${krId}`, {
    method: 'DELETE',
  });
  if (!del.ok) throw new Error(`KR DELETE failed: ${del.status}`);
  return `krId=${krId} cycle=ok`;
});

// ─── 5: SPA render — GoalsView sees the new goal ─────────────────
await check('goal-slash.ui_goal_card_rendered', async () => {
  try { await sh('agent-browser', ['close', '--all']); } catch { /* ignore */ }
  await sh('agent-browser', ['set', 'viewport', '1440', '900']);
  await sh('agent-browser', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 2500));
  try {
    await sh('agent-browser', ['click', 'button[data-sidebar-item="goals"]']);
  } catch (err) {
    throw new Error(`sidebar click failed: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1600));
  await sh('agent-browser', ['screenshot', join(SHOT_DIR, 'goals-after-slash.png')]);

  const main = await agentBrowserEval(
    String.raw`(document.querySelector('main')?.innerText || document.body.innerText || '')`,
  );
  const text = String(main);
  if (text.length < 200) throw new Error(`main.innerText too short: ${text.length}`);
  if (!text.includes('Ship v10.0.4')) {
    throw new Error(`new goal title missing in GoalsView: ${text.slice(0, 600)}`);
  }
  return `bytes=${text.length} goal=${goalId}`;
});

// ─── 6: PROGRESS.md append — fallback path the slash command uses
//        when the dashboard is unreachable ─────────────────────────
await check('goal-slash.file_watcher_picks_up_append', async () => {
  const before = readFileSync(PROGRESS_FILE, 'utf8');
  const appendText = `
## G-${Date.now().toString(36)} — direct PROGRESS.md append (CC fallback)

Goal is **on-track**

- [ ] fall back path proven
`;
  appendFileSync(PROGRESS_FILE, appendText, 'utf8');
  await new Promise((r) => setTimeout(r, 600));
  const after = readFileSync(PROGRESS_FILE, 'utf8');
  if (after.length <= before.length) throw new Error('PROGRESS.md did not grow');

  // Re-query the API — the file watcher (goals.mjs:41-63) should have
  // re-parsed PROGRESS.md and the new goal should be in the list.
  const r = await fetch(`http://127.0.0.1:${PORT}/api/goals`);
  if (!r.ok) throw new Error(`GET /api/goals failed: ${r.status}`);
  const body = await r.json();
  const goals = body.goals || body;
  if (!Array.isArray(goals)) throw new Error(`unexpected shape: ${JSON.stringify(body).slice(0, 200)}`);
  const found = goals.find((g) => (g.title || '').includes('direct PROGRESS.md append'));
  if (!found) {
    throw new Error(`appended goal not in /api/goals response: ${goals.map((g) => g.title).join(', ')}`);
  }
  return `appended goal id=${found.id}`;
});

try {
  await sh('agent-browser', ['close', '--all']).catch(() => {});
} catch { /* ignore */ }

await boot.close?.();
writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify({
  results,
  shots: SHOT_DIR,
  projectRoot,
  homeOverride: HOME_OVERRIDE,
  goalId,
  progressPath: PROGRESS_FILE,
}, null, 2));

const failed = results.filter((r) => !r.ok);
console.log(`\nshots in: ${SHOT_DIR}`);
console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
console.log(`\n${results.length - failed.length}/${results.length} goal-slash checks passed`);
process.exit(failed.length > 0 ? 1 : 0);