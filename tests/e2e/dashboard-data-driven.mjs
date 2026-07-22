/**
 * tests/e2e/dashboard-data-driven.mjs — v10.0.3-S5.
 *
 * Closes umbrella criterion #5 (data-driven dashboard surfaces).
 * The plan calls for per-day usage trendlines, per-agent metric
 * tiles, and GoalsView status coverage — all re-verified past the
 * auth gate in a logged-in browser.
 *
 * Seeds:
 *   - 5 Bizar agents with tasksSucceeded / tasksTotal / successRate
 *     so AgentCard renders the metric strip.
 *   - 7 goals across 5 status tones (active/at-risk/on-track/done
 *     /blocked) so GoalsView's filter chips each have ≥1 card.
 *   - 7 days of usage JSONL so /api/usage?range=7d returns ≥7
 *     daily buckets (proves the Overview sparkline data path).
 *
 * Assertions:
 *   - AgentsView shows ≥5 [data-testid^=agent-card-tasks] rows.
 *   - AgentsView shows ≥5 [data-testid^=agent-card-success] rows.
 *   - GoalsView main innerText contains ≥4 of the 5 status tone
 *     labels (on-track / at-risk / done / blocked / off-track).
 *   - OverviewView shows [data-testid=overview-tokens-sparkline].
 *
 * Outputs: /tmp/bh-data-<pid>/*.png + results.json.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SHOT_DIR = join(tmpdir(), `bh-data-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-data-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-data-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-data-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.BIZAR_HEADROOM_AUTOSTART = '0';
if (!process.env.BIZAR_STORE_HOME) {
  process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
}
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// ─── Seed stores ──────────────────────────────────────────────────
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'agents'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.local', 'share', 'bizar'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

const agents = [
  { name: 'mike',   successRate: 1.0 },
  { name: 'todd',   successRate: 0.9 },
  { name: 'susan',  successRate: 0.7 },
  { name: 'loki',   successRate: 0.4 },
  { name: 'karen',    successRate: 1.0 },
];
const now = Date.now();
const status = {};
for (const a of agents) {
  writeFileSync(
    join(HOME_OVERRIDE, '.config', 'cline', 'agents', `${a.name}.md`),
    `---\ndescription: ${a.name}\nmode: subagent\ntags: [walk]\ncategory: data\n---\nMetric strip seed.\n`,
    'utf8',
  );
  status[a.name] = {
    status: 'idle',
    currentTaskId: null,
    lastSeen: now,
    heartbeat: now,
    currentTaskStartedAt: null,
    lastError: null,
    lastTask: null,
    tasksTotal: 10,
    tasksSucceeded: Math.round(10 * a.successRate),
    tasksFailed: Math.round(10 * (1 - a.successRate)),
    successRate: a.successRate,
  };
}
writeFileSync(
  join(HOME_OVERRIDE, '.config', 'bizar', 'agent-status.json'),
  JSON.stringify(status, null, 2),
  'utf8',
);

// 7 goals across 5 status tones.
writeFileSync(
  join(projectRoot, '.bizar', 'PROGRESS.md'),
  `# Cross-session progress

## G-001 — done goal (Sprint S9 Done)

Goal is **done**

- [x] shipped

## G-002 — on-track goal (Sprint S10 In Progress)

Goal is **on-track**

- [x] coverage proof

## G-003 — at-risk goal (Sprint S10 In Progress)

Goal is **at-risk**

- [x] three of four pieces

## G-004 — blocked goal (Sprint S10 In Progress)

Goal is **blocked**

- [ ] waiting on api review

## G-005 — off-track goal (Sprint S11 In Progress)

Goal is **off-track**

- [ ] redesign needed

## G-006 — active goal (Sprint S10 Active)

Goal is **active**

- [x] first deliverable

## G-007 — second at-risk goal (Sprint S10 In Progress)

Goal is **at-risk**

- [x] partial progress
- [ ] outside commitment pending
`,
  'utf8',
);

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{
      id: 'bh-data-proj',
      name: 'bh-data-proj',
      path: projectRoot,
      root: projectRoot,
      cwd: projectRoot,
      addedAt: Date.now(),
    }],
    active: 'bh-data-proj',
  }, null, 2),
  'utf8',
);

// 7 days of usage JSONL — guarantees ≥7 daily buckets for the
// /api/usage?range=7d call OverviewView makes.
const usageLines = [];
for (let day = 6; day >= 0; day--) {
  const ts = now - day * 86_400_000;
  for (let h = 0; h < 6; h++) {
    usageLines.push(JSON.stringify({
      providerId: 'minimax',
      modelId: 'MiniMax-M3',
      promptTokens: 2000 + h * 500 + day * 200,
      completionTokens: 800 + h * 200,
      cached: false,
      error: false,
      ts,
      requestId: `seed-${day}-${h}`,
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
const PORT = 4216;
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

try {
  // API sanity: 7 days of usage daily.
  await check('data.api.usage_daily_buckets', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/usage?range=7d`);
    const body = await r.json();
    const days = (body.daily || []).length;
    if (days < 7) throw new Error(`expected ≥7 daily buckets, got ${days}`);
    return `days=${days}`;
  });

  await check('data.api.agents_have_metrics', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
    const body = await r.json();
    const agentsWithMetrics = (body.agents || []).filter(
      (a) => typeof a.tasksTotal === 'number' && typeof a.successRate === 'number'
    );
    if (agentsWithMetrics.length < 5) {
      throw new Error(`expected ≥5 agents with metrics, got ${agentsWithMetrics.length}`);
    }
    return `agentsWithMetrics=${agentsWithMetrics.length}`;
  });

  await check('data.api.goals_status_tones', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/goals`);
    const body = await r.json();
    const tones = new Set((body.goals || []).map((g) => g.status));
    const expected = ['on-track', 'at-risk', 'done', 'blocked', 'off-track'];
    const present = expected.filter((t) => tones.has(t));
    if (present.length < 4) {
      throw new Error(`expected ≥4 of ${expected.join(',')}, got ${present.join(',')}`);
    }
    return `tones=${present.join(',')} total=${(body.goals || []).length}`;
  });

  // Open SPA, walk views.
  await sh('kevin', ['set', 'viewport', '1440', '900']);
  await sh('kevin', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 2000));

  await check('data.ui.agents_metric_tiles', async () => {
    await sh('kevin', ['click', 'button[data-sidebar-item="agents"]']);
    await new Promise((r) => setTimeout(r, 2000));
    await sh('kevin', ['screenshot', join(SHOT_DIR, 'agents-metrics.png')]);

    const counts = await agentBrowserEval(
      String.raw`JSON.stringify({ tasks: document.querySelectorAll('[data-testid="agent-card-tasks"]').length, success: document.querySelectorAll('[data-testid="agent-card-success"]').length, lastSeen: document.querySelectorAll('[data-testid="agent-card-lastseen"]').length })`
    );
    const parsed = JSON.parse(counts);
    if (parsed.tasks < 5 || parsed.success < 5) {
      throw new Error(`expected ≥5 tasks/success tiles, got tasks=${parsed.tasks} success=${parsed.success}`);
    }
    return `tasks=${parsed.tasks} success=${parsed.success} lastSeen=${parsed.lastSeen}`;
  });

  await check('data.ui.goals_status_coverage', async () => {
    await sh('kevin', ['click', 'button[data-sidebar-item="goals"]']);
    await new Promise((r) => setTimeout(r, 1800));
    await sh('kevin', ['screenshot', join(SHOT_DIR, 'goals-coverage.png')]);

    const main = await agentBrowserEval(
      String.raw`(document.querySelector('main')?.innerText || document.body.innerText || '')`
    );
    const text = String(main).toLowerCase();
    const tones = ['on-track', 'at-risk', 'done', 'blocked', 'off-track'];
    const present = tones.filter((t) => text.includes(t));
    if (present.length < 4) {
      throw new Error(`expected ≥4 tones in GoalsView, got ${present.join(',')}`);
    }
    return `tones=${present.join(',')} mainBytes=${String(main).length}`;
  });

  await check('data.ui.overview_sparkline', async () => {
    await sh('kevin', ['click', 'button[data-sidebar-item="overview"]']);
    await new Promise((r) => setTimeout(r, 1800));
    await sh('kevin', ['screenshot', join(SHOT_DIR, 'overview-sparkline.png')]);

    const sparklineCount = parseInt(await agentBrowserEval(
      String.raw`document.querySelectorAll('[data-testid="overview-tokens-sparkline"]').length`
    ), 10);
    if (sparklineCount < 1) throw new Error('expected ≥1 tokens sparkline');
    return `sparkline=${sparklineCount}`;
  });
} catch (err) {
  results.push({ name: 'data.error', ok: false, detail: err.message });
  console.error('data error:', err.message);
} finally {
  await sh('kevin', ['close', '--all']).catch(() => {});
  await boot.close?.();
  writeFileSync(join(SHOT_DIR, 'results.json'),
    JSON.stringify({ results, shots: SHOT_DIR, projectRoot, homeOverride: HOME_OVERRIDE }, null, 2));
  console.log(`\nshots in: ${SHOT_DIR}`);
  console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} data-driven checks passed`);
process.exit(failed.length > 0 ? 1 : 0);