/**
 * bizar-dash/src/server/claude-runner.mjs
 *
 * v6.3.0 — Claude Code-native agent runner. Replaces the legacy
 * cline-runner.mjs that spawned `cline run` subprocesses. This module
 * spawns `claude -p` (print mode, blocking) or `claude --bg`
 * (background, returns session id immediately).
 *
 * Claude Code's CLI flags (from https://code.claude.com/docs/en/cli-reference):
 *   -p "<prompt>"        : print mode (run, output, exit)
 *   --output-format json : JSON-lines output (one message per line)
 *   --model <model>      : sonnet | opus | haiku (or full ID)
 *   --agent <name>       : pre-defined subagent name from .claude/agents/
 *   --add-dir <path>     : add a working directory
 *   --mcp-config <path>  : load MCP config from JSON
 *   --session-id <id>    : resume a specific session
 *   --verbose            : verbose logging to stderr
 *
 * Background mode (--bg) keeps the agent alive in a daemon process.
 * The output is monitored via the SDK (query() streams events) — for
 * the dashboard's HTTP layer we just need: spawn, list, kill, status.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {'starting'|'running'|'done'|'failed'|'killed'} AgentState
 *
 * @typedef {Object} AgentStatus
 * @property {AgentState} state
 * @property {string} [sessionId]
 * @property {number} processId
 * @property {number} startedAt
 * @property {number} [endedAt]
 * @property {number} [exitCode]
 * @property {string} [error]
 *
 * @typedef {Object} SpawnAgentOptions
 * @property {string} prompt
 * @property {string} [agent]          subagent name from .claude/agents/
 * @property {string} [model]          sonnet | opus | haiku | provider/model
 * @property {string} worktree
 * @property {string} logPath
 * @property {string} [title]
 * @property {Object<string,string>} [env]
 * @property {boolean} [background]    if true, run via `claude --bg` (persistent)
 * @property {number} [sessionIdTimeoutMs]
 *
 * @typedef {Object} SpawnAgentResult
 * @property {boolean} ok
 * @property {string} [sessionId]
 * @property {number} [processId]
 * @property {string} [error]
 */

/** @type {Map<number, { status: AgentStatus, proc: import('node:child_process').ChildProcess, onExit: Function[], spawnResolvers: Function[] }>} */
const agents = new Map();

/**
 * Spawn a single `claude` (or `claude --bg`) process. Resolves once
 * the child has reported its session id in the JSON output stream
 * (or once the process exits before that).
 *
 * @param {SpawnAgentOptions} opts
 * @returns {Promise<SpawnAgentResult>}
 */
export function spawnAgent(opts) {
  // 1. Pre-flight: log dir must exist.
  const logDir = dirname(opts.logPath);
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (err) {
      return Promise.resolve({
        ok: false,
        error: `cannot create log dir ${logDir}: ${err.message}`,
      });
    }
  }

  // 2. Build argv. `claude --bg` keeps the session alive as a daemon;
  // `claude -p` runs to completion and exits.
  const args = [];
  if (opts.background) args.push('--bg');
  else args.push('-p', opts.prompt);

  args.push('--output-format', 'json');
  args.push('--verbose');
  args.push('--add-dir', opts.worktree);
  if (opts.title) args.push('--session-title', opts.title);
  if (opts.agent) args.push('--agent', opts.agent);
  if (opts.model) args.push('--model', opts.model);
  if (Array.isArray(opts.extraArgs) && opts.extraArgs.length > 0) {
    for (const a of opts.extraArgs) {
      if (typeof a === 'string' && a.length > 0) args.push(a);
    }
  }

  // 3. Spawn the process. Prefer the `claude` binary on PATH; fall
  //    back to `npx @anthropic-ai/claude-agent-sdk/cli` if not found.
  let proc;
  try {
    proc = spawn('claude', args, {
      cwd: opts.worktree,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
    });
  } catch (err) {
    return Promise.resolve({
      ok: false,
      error: `failed to spawn claude: ${err.message}`,
    });
  }

  // 4. Track the agent.
  const rec = {
    status: { state: 'starting', processId: proc.pid, startedAt: Date.now() },
    proc,
    onExit: [],
    spawnResolvers: [],
  };
  agents.set(proc.pid, rec);

  // 5. Pipe stdout+stderr to the log file.
  const logStream = createWriteStream(opts.logPath, { flags: 'a' });

  // Claude Code prints session-id in the JSON-line stream as soon as
  // the run starts. Pattern: {"type":"system","subtype":"init","session_id":"..."}
  const sessionIdRegex = /"session_id"\s*:\s*"([A-Za-z0-9_-]{6,})"/;
  let sessionId;

  const resolveSpawnIfReady = (forceError) => {
    const resolvers = rec.spawnResolvers.splice(0);
    if (resolvers.length === 0) return;
    if (forceError) {
      for (const r of resolvers) r({ ok: false, processId: proc.pid, error: forceError });
      return;
    }
    if (sessionId) {
      rec.status.state = 'running';
      for (const r of resolvers) r({ ok: true, sessionId, processId: proc.pid });
    }
  };

  // 6. Stream readers — line-buffered by splitting on newlines.
  const attachLineReader = (stream, label) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      logStream.write(`[${label}] ${text}`);
      if (!sessionId) {
        buf += text;
        const m = buf.match(sessionIdRegex);
        if (m && m[1]) {
          sessionId = m[1];
          rec.status.sessionId = sessionId;
          resolveSpawnIfReady();
        }
      }
    });
    stream.on('end', () => {
      if (!sessionId && buf) {
        const m = buf.match(sessionIdRegex);
        if (m && m[1]) {
          sessionId = m[1];
          rec.status.sessionId = sessionId;
          resolveSpawnIfReady();
        }
      }
    });
    stream.on('error', (err) => {
      logStream.write(`[${label}] <stream error: ${err.message}>\n`);
    });
  };

  if (proc.stdout) attachLineReader(proc.stdout, 'stdout');
  if (proc.stderr) attachLineReader(proc.stderr, 'stderr');

  // 7. Exit handler.
  proc.on('exit', (exitCode, signal) => {
    rec.status.exitCode = exitCode ?? undefined;
    rec.status.endedAt = Date.now();
    if (rec.status.state !== 'killed') {
      if (signal) {
        rec.status.state = 'killed';
      } else if (exitCode === 0) {
        rec.status.state = 'done';
      } else {
        rec.status.state = 'failed';
        rec.status.error = rec.status.error || `claude exited with code ${exitCode}`;
      }
    }
    if (!sessionId) {
      resolveSpawnIfReady(rec.status.error || 'claude exited before reporting session id');
    }
    const cbs = rec.onExit.splice(0);
    for (const cb of cbs) {
      try { cb({ ...rec.status }); } catch { /* ignore */ }
    }
    try { logStream.end(); } catch { /* ignore */ }
  });
  proc.on('error', (err) => {
    rec.status.error = err.message;
    rec.status.endedAt = Date.now();
    rec.status.state = 'failed';
    if (!sessionId) resolveSpawnIfReady(err.message);
    const cbs = rec.onExit.splice(0);
    for (const cb of cbs) try { cb({ ...rec.status }); } catch { /* ignore */ }
  });

  // 8. Race against a timeout.
  const sessionIdTimeoutMs = opts.sessionIdTimeoutMs ?? 10_000;
  return new Promise((resolve) => {
    rec.spawnResolvers.push(resolve);
    setTimeout(() => {
      if (!sessionId) {
        resolveSpawnIfReady(
          `claude did not report a session id within ${sessionIdTimeoutMs}ms`,
        );
      }
    }, sessionIdTimeoutMs);
  });
}

/**
 * Snapshot the current status of an agent.
 */
export function getStatus(processId) {
  const rec = agents.get(processId);
  if (!rec) return null;
  return { ...rec.status };
}

/**
 * Subscribe to the exit event. Callback fires exactly once when the
 * process exits.
 */
export function onExit(processId, cb) {
  const rec = agents.get(processId);
  if (!rec) return () => undefined;
  rec.onExit.push(cb);
  if (rec.status.endedAt !== undefined) {
    queueMicrotask(() => {
      try { cb({ ...rec.status }); } catch { /* ignore */ }
    });
  }
  return () => {
    const i = rec.onExit.indexOf(cb);
    if (i >= 0) rec.onExit.splice(i, 1);
  };
}

/**
 * Kill the agent. Sends SIGTERM, waits up to 5s, then SIGKILL.
 */
export function killAgent(processId, signal = 'SIGTERM') {
  const rec = agents.get(processId);
  if (!rec) return { ok: true, error: 'no such process tracked' };
  if (rec.status.endedAt !== undefined) {
    return { ok: true, error: 'process already exited' };
  }
  rec.status.state = 'killed';
  try {
    rec.proc.kill(signal);
  } catch (err) {
    return { ok: false, error: `kill(${signal}) failed: ${err.message}` };
  }
  setTimeout(() => {
    if (rec.status.endedAt === undefined) {
      try { rec.proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }, 5_000);
  return { ok: true };
}

/**
 * List every tracked agent.
 */
export function list() {
  return Array.from(agents.values()).map((r) => ({ ...r.status }));
}

/** For tests: clear the in-memory registry. */
export function _resetForTests() {
  agents.clear();
}