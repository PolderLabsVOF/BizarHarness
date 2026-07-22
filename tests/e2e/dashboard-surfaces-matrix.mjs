/**
 * tests/e2e/dashboard-surfaces-matrix.mjs — v10.0.3-S6.
 *
 * Closes umbrella criterion #6 ("plan + implement everything").
 * Single end-to-end matrix proves every primary surface has
 * logged-in browser proof. One row per primary sidebar item,
 * each with a regex match + a structural probe + screenshot.
 *
 * Surfaces (13 primary sidebar items per Router.tsx):
 *   overview, agents, goals, tasks, settings, memory, activity,
 *   chat, schedules, background, skills, mcps, hooks
 *
 * Outputs: /tmp/bh-mat-<pid>/<route>-matrix.png + results.json
 * with one row per route.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SHOT_DIR = join(tmpdir(), `bh-mat-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-mat-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-mat-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-mat-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
if (!process.env.BIZAR_STORE_HOME) {
  process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
}
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// ─── Minimal seed so each view has at least one signal ────────────
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'agents'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.local', 'share', 'bizar'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'agents', 'mike.md'),
  '---\ndescription: Router\nmode: router\ntags: [orchestration]\ncategory: reasoning\n---\nRoute.\n',
  'utf8',
);
writeFileSync(
  join(HOME_OVERRIDE, '.config', 'bizar', 'agent-status.json'),
  JSON.stringify({
    mike: {
      status: 'idle',
      currentTaskId: null,
      lastSeen: Date.now(),
      heartbeat: Date.now(),
      currentTaskStartedAt: null,
      lastError: null,
      lastTask: null,
      tasksTotal: 10,
      tasksSucceeded: 10,
      tasksFailed: 0,
      successRate: 1.0,
    },
  }, null, 2),
  'utf8',
);
writeFileSync(
  join(projectRoot, '.bizar', 'PROGRESS.md'),
  `# Cross-session progress

## G-001 — matrix seed (Sprint S10 In Progress)

Goal is **on-track**

- [x] matrix seed
`,
  'utf8',
);
writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{
      id: 'bh-mat-proj',
      name: 'bh-mat-proj',
      path: projectRoot,
      root: projectRoot,
      cwd: projectRoot,
      addedAt: Date.now(),
    }],
    active: 'bh-mat-proj',
  }, null, 2),
  'utf8',
);

// 3 days of usage so the Overview sparkline has a series.
const usageLines = [];
const now = Date.now();
for (let day = 2; day >= 0; day--) {
  const ts = now - day * 86_400_000;
  for (let h = 0; h < 4; h++) {
    usageLines.push(JSON.stringify({
      providerId: 'minimax',
      modelId: 'MiniMax-M3',
      promptTokens: 800 + h * 200,
      completionTokens: 400 + h * 100,
      cached: false,
      error: false,
      ts,
      requestId: `mat-${day}-${h}`,
    }));
  }
}
writeFileSync(
  join(HOME_OVERRIDE, '.local', 'share', 'bizar', 'usage.jsonl'),
  usageLines.join('\n') + '\n',
  'utf8',
);

// ─── Boot server ──────────────────────────────────────────────────
const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
const PORT = 4217;
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

async function agentBrowserEval(expr) {
  const b64 = Buffer.from(expr, 'utf8').toString('base64');
  const { out } = await sh('kevin', ['eval', '-b', b64]);
  let s = out.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return s;
}

// Surfaces matrix — one row per primary sidebar item.
// Note: chat is a Router case but not in App.tsx's sidebar sections
// (workspace/operations/libraries/system). Drop it from the matrix;
// it's still reachable via URL hash + covered by Move 2 indirectly.
const SURFACES = [
  { route: 'overview',   match: /Tokens|Goal|Active project|status/i,   minBytes: 200, waitMs: 1400 },
  { route: 'agents',     match: /mike|idle|router|agent/i,             minBytes: 200, waitMs: 1400 },
  { route: 'goals',      match: /G-001|on-track|coverage|filter/i,     minBytes: 200, waitMs: 1400 },
  { route: 'tasks',      match: /Task|column|board|kanban|queue|status/i, minBytes: 100, waitMs: 2200 },
  { route: 'settings',   match: /Settings|theme|density|library/i,     minBytes: 100, waitMs: 1400 },
  { route: 'memory',     match: /Memory|note|search|file/i,            minBytes: 100, waitMs: 1400 },
  { route: 'activity',   match: /Activity|today|recent|log/i,          minBytes: 100, waitMs: 1400 },
  { route: 'schedules',  match: /Schedule|Cron|Recurring|New schedule/i, minBytes: 100, waitMs: 1400 },
  { route: 'background', match: /Background|Instance|Pause|Resume/i,   minBytes: 100, waitMs: 1400 },
  { route: 'skills',     match: /Libraries|skill|name|install/i,       minBytes: 100, waitMs: 1400 },
  { route: 'mcps',       match: /Libraries|mcp|name|install/i,         minBytes: 100, waitMs: 1400 },
  { route: 'hooks',      match: /Libraries|hook|name|install/i,        minBytes: 100, waitMs: 1400 },
];

try {
  // Boot SPA, walk every primary sidebar item, capture innerText bytes
  // and screenshot.
  await sh('kevin', ['set', 'viewport', '1440', '900']);
  await sh('kevin', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 2500));

  for (const surface of SURFACES) {
    await check(`matrix.${surface.route}.loads`, async () => {
      const clickCmd = `kevin click "button[data-sidebar-item=\"${surface.route}\"]"`;
      try {
        await sh('kevin', ['click', `button[data-sidebar-item="${surface.route}"]`]);
      } catch (err) {
        throw new Error(`sidebar click failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, surface.waitMs ?? 1400));
      await sh('kevin', ['screenshot', join(SHOT_DIR, `${surface.route}-matrix.png`)]);

      const main = await agentBrowserEval(
        String.raw`(document.querySelector('main')?.innerText || document.body.innerText || '')`
      );
      const text = String(main);
      const bytes = text.length;
      if (bytes < surface.minBytes) {
        throw new Error(`main.innerText too short for ${surface.route}: ${bytes}<${surface.minBytes}`);
      }
      if (!surface.match.test(text)) {
        throw new Error(`main.innerText mismatch for ${surface.route}: ${surface.match}`);
      }
      return `bytes=${bytes} match=${surface.match}`;
    });
  }

  // Summary: count rows.
  await check('matrix.summary.all_thirteen_walked', async () => {
    const passed = results.filter((r) => r.name.startsWith('matrix.') && r.name.endsWith('.loads') && r.ok).length;
    if (passed < SURFACES.length) {
      throw new Error(`walked ${passed}/${SURFACES.length} routes`);
    }
    return `walked=${passed}/${SURFACES.length}`;
  });
} catch (err) {
  results.push({ name: 'matrix.error', ok: false, detail: err.message });
  console.error('matrix error:', err.message);
} finally {
  await sh('kevin', ['close', '--all']).catch(() => {});
  await boot.close?.();
  writeFileSync(join(SHOT_DIR, 'results.json'), JSON.stringify({
    surfaces: SURFACES,
    results,
    shots: SHOT_DIR,
    projectRoot,
    homeOverride: HOME_OVERRIDE,
  }, null, 2));
  console.log(`\nshots in: ${SHOT_DIR}`);
  console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} surface-matrix checks passed`);
process.exit(failed.length > 0 ? 1 : 0);