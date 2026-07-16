/**
 * tests/e2e/dashboard-cc-disk-fallback.mjs — v10.0.4-S1.
 *
 * Closes umbrella criterion #1 (CC source visibility). The previous
 * build called `claude agents --json --all` and returned an empty
 * roster when the CLI was absent (CI / sandboxed dev boxes). v10.0.4
 * adds a disk fallback in `agents-cc.mjs:listAgentsFromDisk()` that
 * enumerates `$HOME/.claude/sessions/*.json` so the dashboard still
 * renders a roster. This E2E proves:
 *
 *   1. empty HOME/.claude/sessions/  → 200 OK, agents=[], error present
 *   2. seeded session JSON           → count=1, agent has sessionId+name
 *   3. seed a JSONL log under        → lastMessageAt + messageCount
 *      projects/<enc>/<sid>.jsonl      populated
 *   4. assistant text block          → lastMessageSnippet populated
 *      in that JSONL log
 *   5. AgentsView UI shows the       → AgentsView main region contains
 *      seeded agent via SPA render     the session name
 *
 * Outputs: /tmp/bh-cc-disk-<pid>/*.png + results.json.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SHOT_DIR = join(tmpdir(), `bh-cc-disk-${process.pid}`);
mkdirSync(SHOT_DIR, { recursive: true });
const projectRoot = mkdtempSync(join(tmpdir(), 'bh-cc-disk-proj-'));
if (!process.env.HOME || !process.env.HOME.includes('bh-cc-disk-home')) {
  console.error('FATAL: HOME must be set to /tmp/bh-cc-disk-home-<pid> before invoking node');
  process.exit(1);
}
const HOME_OVERRIDE = process.env.HOME;
process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
process.env.BIZAR_HEADROOM_AUTOSTART = '0';
if (!process.env.BIZAR_STORE_HOME) {
  process.env.BIZAR_STORE_HOME = join(HOME_OVERRIDE, '.local', 'share', 'bizar');
}
// agents-cc.mjs reads CC session state from $HOME/.claude by default.
// Redirect via BIZAR_CC_HOME so the test seed lives in HOME_OVERRIDE.
process.env.BIZAR_CC_HOME = HOME_OVERRIDE;
process.env.AGENT_BROWSER_EXECUTABLE_PATH = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  || '/home/drb0rk/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// ─── Seed a minimal store layout (Bizar agents + project only) ────
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline', 'agents'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'cline'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.config', 'bizar'), { recursive: true });
mkdirSync(join(HOME_OVERRIDE, '.claude', 'sessions'), { recursive: true });
mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

writeFileSync(
  join(HOME_OVERRIDE, '.config', 'cline', 'projects.json'),
  JSON.stringify({
    projects: [{
      id: 'bh-cc-disk-proj',
      name: 'bh-cc-disk-proj',
      path: projectRoot,
      root: projectRoot,
      cwd: projectRoot,
      addedAt: Date.now(),
    }],
    active: 'bh-cc-disk-proj',
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

// ─── Boot server ──────────────────────────────────────────────────
const { createServer } = await import('../../bizar-dash/src/server/server.mjs');
const PORT = 4220;
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

// ─── 1: empty sessions dir → 200 + agents=[] + error present ─────
let firstError;
await check('cc-disk.empty_dir', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/cc-agents`);
  if (r.status !== 200) throw new Error(`expected 200 got ${r.status}`);
  const body = await r.json();
  if (!Array.isArray(body.agents)) throw new Error(`agents[] expected, got ${typeof body.agents}`);
  if (body.agents.length !== 0) throw new Error(`expected 0 agents, got ${body.agents.length}`);
  // Either we got a CLI ENOENT error or `null` (CLI present + empty roster).
  // Either is fine for the empty-dir assertion.
  firstError = body.error;
  return `count=0 error=${firstError ?? 'null'}`;
});

// ─── 2: seed one CC session JSON → count=1 with id+name ──────────
const SESSION_ID = 'sid-disk-001';
const CC_NAME = 'disk-fallback-agent';
const SESSION_JSON = {
  pid: 4242,
  sessionId: SESSION_ID,
  cwd: projectRoot,
  startedAt: new Date().toISOString(),
  procStart: new Date().toISOString(),
  version: '2.1.207',
  peerProtocol: 'test',
  kind: 'bg',
  entrypoint: 'cli',
  name: CC_NAME,
  jobId: 'job-disk-001',
  status: 'working',
  updatedAt: new Date().toISOString(),
  statusUpdatedAt: new Date().toISOString(),
};
writeFileSync(
  join(HOME_OVERRIDE, '.claude', 'sessions', `${SESSION_ID}.json`),
  JSON.stringify(SESSION_JSON, null, 2),
  'utf8',
);

// Compute encoded cwd the way agents-cc.mjs:259 does: every `/` -> `-`,
// leading `-` preserved.
const encCwd = String(projectRoot).replace(/\//g, '-').replace(/^-/, '-');
const projectDir = join(HOME_OVERRIDE, '.claude', 'projects', encCwd);
mkdirSync(projectDir, { recursive: true });

const SNIPPET_TEXT = 'Disk fallback snippet: I just shipped v10.0.4 and the disk path works.';
const JSONL_LINES = [
  JSON.stringify({ ts: new Date().toISOString(), type: 'system', summary: 'session start' }),
  JSON.stringify({
    ts: new Date().toISOString(),
    type: 'user',
    message: { role: 'user', content: 'ship it' },
  }),
  JSON.stringify({
    ts: new Date().toISOString(),
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: SNIPPET_TEXT }],
    },
  }),
  JSON.stringify({
    ts: new Date().toISOString(),
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/etc/hostname' } }],
    },
  }),
];
writeFileSync(
  join(projectDir, `${SESSION_ID}.jsonl`),
  JSONL_LINES.join('\n') + '\n',
  'utf8',
);

await check('cc-disk.seeded_session', async () => {
  // Bust the 5s cache so the merge re-runs against the freshly-seeded
  // session JSON. The first /api/cc-agents call (empty_dir) populated
  // the cache before we wrote the seed file.
  await new Promise((r) => setTimeout(r, 5100));
  const r = await fetch(`http://127.0.0.1:${PORT}/api/cc-agents`);
  if (r.status !== 200) throw new Error(`expected 200 got ${r.status}`);
  const body = await r.json();
  if (!Array.isArray(body.agents)) throw new Error('agents[] missing');
  const a = body.agents.find((x) => x.sessionId === SESSION_ID);
  if (!a) {
    throw new Error(`expected sessionId=${SESSION_ID} in roster, got: ${JSON.stringify(body.agents.map((x) => x.sessionId))}`);
  }
  if (a.name !== CC_NAME) throw new Error(`name mismatch: ${a.name}`);
  if (a.cwd !== projectRoot) throw new Error(`cwd mismatch: ${a.cwd}`);
  if (a.source !== 'disk') throw new Error(`source mismatch: ${a.source}`);
  return `name=${a.name} sessionId=${a.sessionId}`;
});

await check('cc-disk.enriched_log', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/cc-agents`);
  const body = await r.json();
  const a = body.agents[0];
  if (typeof a.lastMessageAt !== 'number') throw new Error(`lastMessageAt missing: ${a.lastMessageAt}`);
  if (a.messageCount !== 4) throw new Error(`messageCount mismatch: ${a.messageCount}`);
  return `lastMessageAt=${a.lastMessageAt} messageCount=${a.messageCount}`;
});

await check('cc-disk.last_snippet', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/cc-agents`);
  const body = await r.json();
  const a = body.agents[0];
  if (typeof a.lastMessageSnippet !== 'string') {
    throw new Error(`lastMessageSnippet missing: ${a.lastMessageSnippet}`);
  }
  if (!a.lastMessageSnippet.includes('v10.0.4')) {
    throw new Error(`snippet text mismatch: ${a.lastMessageSnippet}`);
  }
  return `snippet="${a.lastMessageSnippet}"`;
});

// ─── 5: SPA render — AgentsView sees the disk agent ──────────────
await check('cc-disk.ui_chip_renders', async () => {
  try { await sh('agent-browser', ['close', '--all']); } catch { /* ignore */ }
  await sh('agent-browser', ['set', 'viewport', '1440', '900']);
  await sh('agent-browser', ['open', `http://127.0.0.1:${PORT}/`]);
  await new Promise((r) => setTimeout(r, 2500));
  try {
    await sh('agent-browser', ['click', 'button[data-sidebar-item="agents"]']);
  } catch (err) {
    throw new Error(`sidebar click failed: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1800));
  await sh('agent-browser', ['screenshot', join(SHOT_DIR, 'agents-disk.png')]);

  const b64 = Buffer.from(
    String.raw`(document.querySelector('main')?.innerText || document.body.innerText || '')`,
    'utf8',
  ).toString('base64');
  const { out } = await sh('agent-browser', ['eval', '-b', b64]);
  let s = out.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const text = String(s);
  if (text.length < 100) throw new Error(`main.innerText too short: ${text.length}`);
  if (!text.includes(CC_NAME) && !text.includes(SESSION_ID)) {
    throw new Error(`disk agent name/sessionId missing in AgentsView: ${text.slice(0, 400)}`);
  }
  return `bytes=${text.length} contains=${CC_NAME}`;
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
  sessionId: SESSION_ID,
  encCwd,
}, null, 2));

const failed = results.filter((r) => !r.ok);
console.log(`\nshots in: ${SHOT_DIR}`);
console.log(`evidence: ${join(SHOT_DIR, 'results.json')}`);
console.log(`\n${results.length - failed.length}/${results.length} cc-disk-fallback checks passed`);
process.exit(failed.length > 0 ? 1 : 0);