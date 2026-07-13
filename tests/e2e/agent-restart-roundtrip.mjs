/**
 * tests/e2e/agent-restart-roundtrip.mjs — v10-S4.
 *
 * Cross-boundary proof that POST /api/agents/:name/restart actually
 * returns the agent to the idle state on disk AND broadcasts a
 * notification the dashboard can subscribe to. This catches the class
 * of bug where restart 200s but the runtime state never moves.
 *
 * The agents-store stores runtime status at
 * $HOME/.config/bizar/agent-status.json (hardcoded) and agent
 * metadata at $HOME/.config/cline/agents/<name>.md (hardcoded). The
 * E2E writes a fixture agent .md, mutates the runtime status file
 * directly to mark the agent "error", boots a real dashboard server,
 * POSTs restart, then asserts the persisted status is back to idle.
 *
 * Doesn't run a real Claude Code process. Validates the cross-
 * boundary contract: same restart code path the stuck-banner Restart
 * button hits from the browser.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const HOME = homedir();
const STATUS_FILE = join(HOME, '.config', 'bizar', 'agent-status.json');
const AGENT_FILE = join(HOME, '.config', 'cline', 'agents', 'bh-e2e-restart.md');

const EVIDENCE = process.env.BIZAR_E2E_EVIDENCE ||
  join(tmpdir(), `bizar-agent-restart-${process.pid}.json`);
const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] || 4186,
);

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${step}${detail ? `  -- ${detail}` : ''}`);
}

// ── fixture setup ─────────────────────────────────────────────────
// We back up the user's actual status file + clear any pre-existing
// fixture agent so a half-failed prior run doesn't poison this run.
// Everything gets restored in `finally`.
const statusBackup = STATUS_FILE + `.bak.${process.pid}`;
let statusBackupMade = false;
let agentExisted = false;
let agentOriginalContent = null;
try {
  if (existsSync(STATUS_FILE)) {
    writeFileSync(statusBackup, readFileSync(STATUS_FILE, 'utf8'), 'utf8');
    statusBackupMade = true;
  }
  mkdirSync(join(HOME, '.config', 'bizar'), { recursive: true });
  mkdirSync(join(HOME, '.config', 'cline', 'agents'), { recursive: true });
  if (existsSync(AGENT_FILE)) {
    agentExisted = true;
    agentOriginalContent = readFileSync(AGENT_FILE, 'utf8');
  }
  writeFileSync(AGENT_FILE, [
    '---',
    'description: "v10-S4 E2E fixture agent — safe to delete"',
    'model: haiku',
    'mode: subagent',
    'tools: [read]',
    'tags: [e2e, fixture]',
    '---',
    'A throwaway agent created by tests/e2e/agent-restart-roundtrip.mjs.',
    '',
  ].join('\n'), 'utf8');

  // Mark the agent as errored with an outstanding current task — the
  // exact state Restart has to unwind.
  writeFileSync(STATUS_FILE, JSON.stringify({
    'bh-e2e-restart': {
      status: 'error',
      currentTaskId: 'task-deadbeef',
      currentTaskStartedAt: Date.now() - 600_000,
      lastSeen: Date.now() - 600_000,
      heartbeat: Date.now() - 600_000,
      lastError: 'synthetic restart fixture',
      successRate: 0,
      tasksTotal: 1,
      tasksSucceeded: 0,
    },
  }, null, 2), 'utf8');
  record('fixture.setup', true, `status=${STATUS_FILE} agent=${AGENT_FILE}`);
} catch (err) {
  console.error('fixture setup failed:', err.message);
  process.exit(1);
}

const boot = await createServer({
  port: PORT,
  projectRoot: mkdtempSync(join(tmpdir(), 'bizar-e2e-agent-restart-')),
  clineConfigDir: join(HOME, '.config', 'cline'),
  bizarRoot: mkdtempSync(join(tmpdir(), 'bizar-e2e-agent-restart-bizar-')),
});
await new Promise((resolve, reject) => {
  boot.server.once('error', reject);
  boot.server.listen(PORT, '127.0.0.1', () => { boot.server.off('error', reject); resolve(); });
});

try {
  // 1. GET the fixture agent — it must surface in the roster with
  //    status='error' (the synthetic state we wrote).
  const before = await (await fetch(`http://127.0.0.1:${boot.port}/api/agents/bh-e2e-restart`)).json();
  record(
    'agents.pre_restart_state',
    before?.status === 'error' && before?.currentTaskId === 'task-deadbeef',
    `status=${before?.status} task=${before?.currentTaskId} err=${before?.lastError}`
  );

  // 2. Subscribe to WS so we can prove restart broadcasts.
  const WWebSocket = (await import('ws')).default;
  const ws = new WWebSocket(`ws://127.0.0.1:${boot.port}/ws`);
  const broadcasts = [];
  await new Promise((resolve) => {
    const to = setTimeout(() => { ws.close(); resolve(); }, 3_000);
    ws.on('open', () => { clearTimeout(to); resolve(); });
    ws.on('error', () => { clearTimeout(to); resolve(); });
  });
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg && (msg.type === 'agent:restarted' || msg.type === 'agents:change' || msg.type === 'agent:status')) {
        broadcasts.push(msg);
      }
    } catch { /* ignore */ }
  });

  // 3. POST /restart. Must 200 with the agent in idle state.
  const restart = await fetch(`http://127.0.0.1:${boot.port}/api/agents/bh-e2e-restart/restart`, {
    method: 'POST',
  });
  const restartBody = await restart.json();
  record(
    'agents.restart_response',
    restart.ok && restartBody?.status === 'idle' && restartBody?.currentTaskId === null,
    `status=${restart.status} body.status=${restartBody?.status} body.task=${restartBody?.currentTaskId}`
  );

  // 4. Wait for at least one WS broadcast announcing the restart.
  const gotBroadcast = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 2_000);
    const tick = setInterval(() => {
      if (broadcasts.some((b) => b.type === 'agent:restarted')) {
        clearTimeout(to); clearInterval(tick); resolve(true);
      }
    }, 50);
  });
  ws.close();
  record('agents.restart_broadcasts', gotBroadcast, `count=${broadcasts.length} types=${[...new Set(broadcasts.map((b) => b.type))].join(',')}`);

  // 5. The runtime status file on disk must reflect idle + cleared
  //    task — proves restart actually persisted, not just responded.
  const onDisk = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  const persisted = onDisk['bh-e2e-restart'];
  record(
    'agents.restart_persisted',
    persisted?.status === 'idle' && persisted?.currentTaskId === null && persisted?.lastError === null,
    `disk.status=${persisted?.status} disk.task=${persisted?.currentTaskId} disk.err=${persisted?.lastError}`
  );

  // 6. Re-GET after restart — server's view matches disk.
  const after = await (await fetch(`http://127.0.0.1:${boot.port}/api/agents/bh-e2e-restart`)).json();
  record(
    'agents.post_restart_state',
    after?.status === 'idle' && after?.currentTaskId === null && after?.lastError === null,
    `status=${after?.status} task=${after?.currentTaskId} err=${after?.lastError}`
  );
} catch (err) {
  record('e2e.error', false, err.message);
} finally {
  await boot.close?.();
  // Restore / clean up the user's real files.
  try {
    if (agentExisted) {
      writeFileSync(AGENT_FILE, agentOriginalContent, 'utf8');
    } else if (existsSync(AGENT_FILE)) {
      rmSync(AGENT_FILE);
    }
  } catch { /* ignore */ }
  try {
    if (statusBackupMade) {
      writeFileSync(STATUS_FILE, readFileSync(statusBackup, 'utf8'), 'utf8');
      rmSync(statusBackup);
    } else if (existsSync(STATUS_FILE)) {
      rmSync(STATUS_FILE);
    }
  } catch { /* ignore */ }
}

try {
  writeFileSync(EVIDENCE, JSON.stringify({ results, port: boot.port }, null, 2));
} catch (err) {
  console.warn('failed to write evidence:', err.message);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${results.length} steps failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} steps passed; evidence at ${EVIDENCE}`);
process.exit(0);