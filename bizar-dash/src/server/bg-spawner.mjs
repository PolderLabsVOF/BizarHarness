/**
 * src/server/bg-spawner.mjs
 *
 * v5.x — Dashboard-side background agent spawner.
 *
 * Bridges "spawn from UI" without requiring an LLM round-trip. Mirrors
 * the plugin's `opencode-runner.ts` semantics as a Node-flavoured
 * equivalent: spawns one `opencode run` subprocess per agent, captures
 * stdout/stderr to a log file, tracks the PID, and broadcasts WS events
 * for each new output line.
 *
 * Why the dashboard has its own spawner:
 *   - The plugin process (the opencode plugin) isn't always reachable
 *     from the dashboard. Spawning from UI must work even when the
 *     user is operating the dashboard before/after an opencode session.
 *   - The dashboard already has its own pid space and state directory;
 *     this module inherits the existing `~/.cache/bizar/bg/*.json`
 *     layout so the dashboard list view picks up the new instance
 *     immediately.
 *
 * Public surface:
 *   - `spawnBgAgent({...})` — create instance + subprocess, return
 *     `{ instanceId, sessionId?, processId? }`.
 *   - `killBgAgent(instanceId, { signal })`, `pauseBgAgent`,
 *     `resumeBgAgent` — control signals. POSIX-only for signal
 *     variants; Windows returns an explicit error.
 *   - `isAlive(instanceId)` — liveness check for an instance PID.
 *   - `status()` — diagnostic dump (process count, ids).
 *
 * State file: `~/.cache/bizar/bg/<instanceId>.json` — same shape
 * the plugin uses, kept compatible. We update the file as the
 * subprocess progresses (status flips, tool calls recorded, etc.).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve as pathResolve, dirname } from 'node:path';

/** Same shape the plugin uses for instance IDs. */
function generateInstanceId() {
  const bytes = randomBytes(16);
  // crockford base32: 26 chars total, take 22
  const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 0x1f];
  return 'bgr_' + out.slice(0, 22);
}

// --- Configuration -------------------------------------------------------

const HOME = homedir();
const BG_DIR_CANDIDATES = [
  pathResolve(HOME, '.cache', 'bizar', 'bg'),
  pathResolve(HOME, '.config', 'opencode', 'bg'),
  pathResolve(HOME, '.bizar', 'bg'),
];
const LOG_DIR_CANDIDATES = [
  process.env.BIZAR_LOG_DIR || pathResolve(HOME, '.cache', 'bizar', 'logs'),
];

function pickBgDir() {
  for (const dir of BG_DIR_CANDIDATES) {
    if (existsSync(dir)) return dir;
  }
  return BG_DIR_CANDIDATES[0];
}

function pickLogDir() {
  for (const dir of LOG_DIR_CANDIDATES) {
    if (existsSync(dir)) return dir;
  }
  const def = LOG_DIR_CANDIDATES[0];
  try {
    mkdirSync(def, { recursive: true });
  } catch {
    /* ignore */
  }
  return def;
}

// --- In-memory subprocess registry --------------------------------------

/**
 * @typedef {object} SpawnerRecord
 * @property {number} processId
 * @property {string} instanceId
 * @property {string} sessionId
 * @property {string} logPath
 * @property {import('node:child_process').ChildProcess} proc
 * @property {string} state — "starting" | "running" | "paused" | "done" | "failed" | "killed"
 * @property {number} startedAt
 * @property {number} [endedAt]
 * @property {number} [exitCode]
 * @property {string} [worktree]
 */

/** @type {Map<string, SpawnerRecord>} — keyed by instanceId */
const byInstanceId = new Map();
/** @type {Map<number, SpawnerRecord>} — keyed by processId */
const byPid = new Map();

// --- Public API ---------------------------------------------------------

/**
 * @typedef {object} BroadcastFn
 * @property {(msg: object) => void} [broadcast]
 */

/**
 * @param {BroadcastFn} ctx
 */
export function configureSpawner(ctx) {
  state.broadcast = ctx.broadcast || (() => {});
}

/**
 * Spawn one opencode run subprocess. Mirrors the plugin's
 * `bg-spawn.ts` semantics. Writes the initial BackgroundState JSON,
 * starts the subprocess, then patches the JSON when the session id
 * appears in stderr.
 *
 * @param {object} opts
 * @param {string} opts.agent
 * @param {string} opts.prompt
 * @param {{providerID: string, modelID: string}} [opts.model]
 * @param {string} opts.worktree
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.persistent]
 * @param {number} [opts.maxRestarts]
 * @param {string[]} [opts.tags]
 * @returns {Promise<{instanceId: string, sessionId: string|null, processId: number|null, error?: string}>}
 */
export async function spawnBgAgent(opts) {
  if (!opts || !opts.agent || !opts.prompt || !opts.worktree) {
    return { instanceId: '', sessionId: null, processId: null, error: 'missing_required_fields' };
  }
  const instanceId = generateInstanceId();
  const logDir = pickLogDir();
  const logPath = pathResolve(logDir, `${instanceId}.log`);
  const now = Date.now();
  /** @type {BackgroundState} */
  const initial = {
    instanceId,
    sessionId: '',
    agent: opts.agent,
    model: opts.model
      ? `${opts.model.providerID}/${opts.model.modelID}`
      : 'agent-default',
    promptPreview: String(opts.prompt).slice(0, 200),
    prompt: String(opts.prompt),
    parentAgent: 'dashboard',
    logPath,
    timeoutMs: Math.max(1000, Math.floor(opts.timeoutMs ?? 300_000)),
    toolCallCount: 0,
    status: 'pending',
    startedAt: now,
    lastEventAt: now,
    lastToolOrTextAt: now,
    interventionCount: 0,
    persistent: Boolean(opts.persistent),
    maxRestarts: Math.max(1, Math.floor(opts.maxRestarts ?? 3)),
    restartCount: 0,
    runnerState: 'starting',
    spawnedAt: now,
    progress: 0,
    toolCalls: [],
    tags: Array.isArray(opts.tags) ? opts.tags.slice(0, 10) : undefined,
    source: 'dashboard',
  };

  await writeStateFile(initial);
  broadcast({ type: 'background:change', id: instanceId, status: 'pending', source: 'dashboard' });

  // Build argv — mirror plugins/bizar/src/opencode-runner.ts buildOpencodeRunArgs.
  const args = [
    'opencode',
    'run',
    '--dir', opts.worktree,
    '--print-logs',
    '--log-level', 'INFO',
    '--title', `bgr:${opts.agent}:${instanceId}`,
    '--agent', opts.agent,
  ];
  if (opts.model) args.push('--model', `${opts.model.providerID}/${opts.model.modelID}`);
  args.push('--', String(opts.prompt));

  // For subagents, wrap with delegation prompt (mirroring bg-spawn.ts).
  const PRIMARY = new Set(['odin', 'quick', 'browser-harness']);
  let finalPrompt = String(opts.prompt);
  let wrapperAgent = opts.agent;
  if (!PRIMARY.has(opts.agent)) {
    wrapperAgent = 'odin';
    finalPrompt = [
      'You are Odin, the BizarHarness router.',
      '',
      'A background agent session has been requested with a SPECIFIC subagent.',
      'Your only job is to delegate to that subagent using the `task` tool. Do NOT',
      'perform the work yourself. Do NOT interpret the user\'s prompt.',
      '',
      `Requested subagent: ${opts.agent}`,
      '',
      'Task prompt to pass verbatim:',
      '--- BEGIN USER PROMPT ---',
      String(opts.prompt),
      '--- END USER PROMPT ---',
      '',
      `Use the task tool with agent="${opts.agent}" and the exact prompt above.`,
    ].join('\n');
    args[args.indexOf('--agent') + 1] = wrapperAgent;
    // Replace the trailing "-- <prompt>" with the wrapped prompt.
    const dashIdx = args.indexOf('--', args.indexOf('--agent'));
    if (dashIdx >= 0) {
      args.splice(dashIdx + 1, 1, finalPrompt);
    }
  }

  let proc;
  try {
    proc = spawn(args[0], args.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    await patchState(instanceId, {
      status: 'failed',
      error: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      completedAt: Date.now(),
    });
    broadcast({ type: 'background:change', id: instanceId, status: 'failed', error: err.message });
    return { instanceId, sessionId: null, processId: null, error: err.message };
  }

  /** @type {SpawnerRecord} */
  const rec = {
    processId: proc.pid,
    instanceId,
    sessionId: '',
    logPath,
    proc,
    state: 'starting',
    startedAt: Date.now(),
    worktree: opts.worktree,
  };
  byInstanceId.set(instanceId, rec);
  byPid.set(proc.pid, rec);

  const sessionIdRegex = /message=created id=(ses_[A-Za-z0-9_]+)/;
  let buf = '';
  let appendOffset = 0;

  // Helper: append a line to the log file AND broadcast ws event.
  const emit = (label, chunk) => {
    if (!chunk) return;
    const text = chunk.toString('utf-8');
    appendFileSync(logPath, `[${label}] ${text}`);
    appendOffset += Buffer.byteLength(text, 'utf-8');
    // Per-line broadcast: split on newlines.
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      broadcast({
        type: 'bg:output',
        instanceId,
        line,
        ts: Date.now(),
        byteOffset: appendOffset,
        stream: label,
      });
    }
  };

  proc.stdout.on('data', (chunk) => emit('stdout', chunk));
  proc.stderr.on('data', (chunk) => {
    emit('stderr', chunk);
    const text = chunk.toString('utf-8');
    buf += text;
    const m = buf.match(sessionIdRegex);
    if (m && m[1] && !rec.sessionId) {
      rec.sessionId = m[1];
      const sid = m[1];
      patchState(instanceId, {
        sessionId: sid,
        status: 'running',
        runnerState: 'running',
        processId: proc.pid,
        sessionIdAt: Date.now(),
      }).then(() => {
        broadcast({ type: 'background:change', id: instanceId, status: 'running', sessionId: sid });
      });
    }
  });

  proc.on('exit', async (code, signal) => {
    rec.state = signal === 'SIGTERM' || signal === 'SIGKILL' ? 'killed' : (code === 0 ? 'done' : 'failed');
    rec.endedAt = Date.now();
    rec.exitCode = code ?? undefined;
    byPid.delete(proc.pid);
    const wasAdopted = false;
    const update = {
      runnerState: rec.state,
      completedAt: rec.endedAt,
      ...(code != null ? { exitCode: code } : {}),
    };
    if (signal) update.exitSignal = signal;
    // Don't clobber "steered" status.
    const cur = readStateFile(instanceId);
    if (cur && cur.status !== 'steered' && cur.status !== 'killed' && cur.status !== 'failed') {
      update.status = rec.state === 'killed' ? 'killed' : rec.state === 'done' ? 'done' : 'failed';
    }
    await patchState(instanceId, update);
    broadcast({
      type: 'background:change',
      id: instanceId,
      status: update.status,
      processId: proc.pid,
      exitCode: code,
      ...(rec.sessionId ? { sessionId: rec.sessionId } : {}),
    });
    void wasAdopted;
  });

  proc.on('error', (err) => {
    broadcast({ type: 'bg:error', instanceId, error: err.message });
  });

  return { instanceId, sessionId: null, processId: proc.pid };
}

/**
 * Kill an instance's subprocess. Sends SIGTERM, then SIGKILL after 5s.
 * @param {string} instanceId
 * @param {{signal?: 'SIGTERM' | 'SIGKILL', reason?: string}} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export async function killBgAgent(instanceId, opts = {}) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: 'instance_not_tracked' };
  if (rec.endedAt) return { ok: true, note: 'already_exited' };
  const signal = opts.signal || 'SIGTERM';
  try {
    rec.proc.kill(signal);
    rec.state = 'killed';
    if (rec.sessionId) {
      await patchState(instanceId, {
        status: 'killed',
        runnerState: 'killed',
        completedAt: Date.now(),
        exitSignal: signal,
      });
      broadcast({ type: 'background:change', id: instanceId, status: 'killed', reason: opts.reason });
    }
    setTimeout(() => {
      if (!rec.endedAt) {
        try { rec.proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 5_000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pause an instance: SIGSTOP the subprocess.
 * @param {string} instanceId
 * @returns {{ ok: boolean, error?: string }}
 */
export function pauseBgAgent(instanceId) {
  if (process.platform === 'win32') {
    return { ok: false, error: 'unsupported_on_win32' };
  }
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: 'instance_not_tracked' };
  if (rec.endedAt) return { ok: true, note: 'already_exited' };
  if (rec.state === 'paused') return { ok: true };
  try {
    rec.proc.kill('SIGSTOP');
    rec.state = 'paused';
    patchState(instanceId, {
      status: 'paused',
      pausedAt: Date.now(),
    }).then(() => {
      broadcast({ type: 'background:change', id: instanceId, status: 'paused' });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Resume an instance: SIGCONT.
 * @param {string} instanceId
 */
export function resumeBgAgent(instanceId) {
  if (process.platform === 'win32') {
    return { ok: false, error: 'unsupported_on_win32' };
  }
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: 'instance_not_tracked' };
  if (rec.endedAt) return { ok: true, note: 'already_exited' };
  if (rec.state !== 'paused') return { ok: true };
  try {
    rec.proc.kill('SIGCONT');
    rec.state = 'running';
    patchState(instanceId, {
      status: 'running',
      pausedAt: undefined,
    }).then(() => {
      broadcast({ type: 'background:change', id: instanceId, status: 'running' });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Steer an instance by killing it and spawning a new one with the
 * original prompt + a [STEERED ...] marker + the user's message
 * appended. Returns the new instance id.
 *
 * @param {string} instanceId
 * @param {string} message
 * @returns {Promise<{ ok: boolean, newInstanceId?: string, error?: string }>}
 */
export async function steerBgAgent(instanceId, message) {
  if (!message || !message.trim()) {
    return { ok: false, error: 'message_empty' };
  }
  const cur = readStateFile(instanceId);
  if (!cur) return { ok: false, error: 'instance_not_found' };
  // Persist the steered-from state.
  await patchState(instanceId, {
    status: 'steered',
    completedAt: Date.now(),
    steeredFromMessage: message.slice(0, 500),
    steeredAt: Date.now(),
  });
  broadcast({ type: 'background:change', id: instanceId, status: 'steered' });
  // Kill the current subprocess (best-effort — the new one will
  // continue regardless; we don't want to block).
  void killBgAgent(instanceId, { signal: 'SIGTERM', reason: 'steered' });
  // Spawn the steered replacement.
  const combined = [
    cur.prompt || cur.promptPreview || '',
    '',
    `[STEERED ${new Date().toISOString()}]`,
    message.trim(),
  ].join('\n');
  const res = await spawnBgAgent({
    agent: cur.agent,
    prompt: combined,
    model: cur.model && cur.model !== 'agent-default'
      ? { providerID: cur.model.split('/')[0], modelID: cur.model.split('/').slice(1).join('/') }
      : undefined,
    worktree: cur.worktree || process.cwd(),
    persistent: cur.persistent,
    maxRestarts: cur.maxRestarts,
    timeoutMs: cur.timeoutMs,
    tags: cur.tags,
  });
  if (res.error) return { ok: false, error: res.error };
  // Link the new instance to the old one in the state file.
  if (res.instanceId) {
    patchState(res.instanceId, { parentInstanceId: instanceId }).catch(() => {});
  }
  return { ok: true, newInstanceId: res.instanceId, processId: res.processId };
}

/**
 * Liveness probe.
 * @param {string} instanceId
 * @returns {boolean}
 */
export function isAlive(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return false;
  return !rec.endedAt;
}

/** Diagnostics. */
export function status() {
  return {
    count: byInstanceId.size,
    ids: Array.from(byInstanceId.keys()),
  };
}

// --- Internal helpers ----------------------------------------------------

const state = {
  /** @type {(msg: object) => void} */
  broadcast: () => {},
};

/**
 * @param {object} msg
 */
function broadcast(msg) {
  try { state.broadcast(msg); } catch { /* ignore */ }
}

function bgDir() {
  return pickBgDir();
}

function stateFile(instanceId) {
  return pathResolve(bgDir(), `${instanceId}.json`);
}

/**
 * Atomic-ish write: write to <file>.tmp then rename.
 * @param {object} bgState
 */
async function writeStateFile(bgState) {
  const dir = bgDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = stateFile(bgState.instanceId);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(bgState, null, 2), 'utf-8');
  try {
    const fs = await import('node:fs');
    fs.renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(bgState, null, 2), 'utf-8');
  }
}

/**
 * Read+modify+write the state file. Best-effort; logs on failure.
 * @param {string} instanceId
 * @param {object} patch
 */
async function patchState(instanceId, patch) {
  const file = stateFile(instanceId);
  if (!existsSync(file)) return;
  try {
    const cur = JSON.parse(readFileSync(file, 'utf-8') || '{}');
    const next = { ...cur, ...patch };
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    broadcast({ type: 'bg:error', instanceId, error: `state_patch failed: ${err.message}` });
  }
}

/**
 * @param {string} instanceId
 * @returns {object|null}
 */
function readStateFile(instanceId) {
  const file = stateFile(instanceId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

void dirname;
void statSync;
void readdirSync;
void unlinkSync;
