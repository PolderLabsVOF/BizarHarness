/**
 * src/server/routes/agents-cc.mjs
 *
 * Sprint S10/S11 — Claude Code-native background agents.
 *
 * Reads the live agent roster via `claude agents --json`. Caches the
 * result for 5s so the dashboard can poll every render without forking
 * a subprocess per view. Provides unified `GET /api/cc-agents` that
 * merges with session metadata so the dashboard shows a full picture
 * (agent name, cwd, session id, status, started-at, etc).
 *
 * S11 — adds `POST /api/cc-agents/:id/kill` and
 * `POST /api/cc-agents/:id/send` for the AgentDetail control plane.
 */

import { Router } from 'express';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { wrap } from './_shared.mjs';

const HOME = homedir();
const CACHE_TTL_MS = 5_000;
let _cache = null; // { ts, agents, error }

/**
 * v10.0.6 — `shouldIncludeAgent` filters out CC sessions whose `cwd`
 * lives under the OS temp directory. The disk fallback in
 * `listAgentsFromDisk` used to surface whatever JSON envelope sat in
 * `$HOME/.claude/sessions/`, which includes scratch /tmp sessions that
 * aren't really live agent runs — they pollute the roster.
 *
 * Opt-out via `BIZAR_CC_INCLUDE_TMP=1` (used by tests + debug).
 */
function isTmpPath(p) {
  if (!p) return false;
  const s = String(p);
  const tmp = tmpdir();
  return s === tmp || s.startsWith(tmp + '/') || s === '/tmp' || s.startsWith('/tmp/');
}
function shouldIncludeAgent(agent) {
  if (process.env.BIZAR_CC_INCLUDE_TMP === '1') return true;
  const cwd = agent && agent.cwd;
  return !isTmpPath(cwd);
}

/** Resolve the CC home directory. Honours `BIZAR_CC_HOME` (used in
 *  tests to redirect `$HOME/.claude` into a temp dir) before falling
 *  back to `homedir()`. */
function ccHome() {
  return process.env.BIZAR_CC_HOME || HOME;
}

function runClaudeAgents() {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    try {
      const proc = spawn('claude', ['agents', '--json', '--all'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        if (!done) { done = true; try { proc.kill('SIGTERM'); } catch { /* */ } resolve({ ok: false, error: 'timeout', stderr: stderr.slice(0, 500) }); }
      }, 4_000);
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      proc.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, stderr });
      });
      proc.on('exit', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ ok: false, error: `exit ${code}`, stderr: stderr.slice(0, 500), stdout: stdout.slice(0, 500) });
          return;
        }
        try {
          const parsed = JSON.parse(stdout || '[]');
          if (!Array.isArray(parsed)) {
            resolve({ ok: false, error: 'unexpected shape', stdout: stdout.slice(0, 200) });
            return;
          }
          resolve({ ok: true, agents: parsed });
        } catch (err) {
          resolve({ ok: false, error: `parse: ${err.message}`, stdout: stdout.slice(0, 200) });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/** Extract a snippet from the last assistant text block in a JSONL log.
 *  Best-effort — returns undefined if no assistant message is found.
 *  Reused by `enrichSession` (live roster) and `listAgentsFromDisk`
 *  (disk fallback) so the shape stays identical. */
function extractLastSnippet(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj?.type === 'assistant' && obj?.message?.content) {
        const c = obj.message.content;
        const txt = typeof c === 'string' ? c
          : Array.isArray(c) ? c.filter((b) => b && (b.type === 'text' || typeof b.text === 'string')).map((b) => b.text || '').join('\n')
          : '';
        if (txt) return txt.replace(/\s+/g, ' ').trim().slice(0, 120);
      }
    } catch { /* skip */ }
  }
  return undefined;
}

function enrichSession(agent) {
  if (!agent || !agent.sessionId) return agent;
  // v10.0.4 — real CC session logs live at
  //   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
  // not at ~/.claude/sessions/<sid>/messages.jsonl (which never exists).
  // `resolveSessionLog` already encodes the cwd correctly.
  const logPath = resolveSessionLog(agent.sessionId, agent.cwd);
  if (!logPath || !existsSync(logPath)) return agent;
  try {
    const st = statSync(logPath);
    const text = readFileSync(logPath, 'utf8');
    agent.lastMessageAt = st.mtimeMs;
    agent.messageCount = text.split('\n').filter((l) => l.trim()).length;
    const snippet = extractLastSnippet(text);
    if (snippet) agent.lastMessageSnippet = snippet;
    agent.logPath = logPath;
  } catch { /* best effort */ }
  return agent;
}

/** v10.0.4 — enumerate `$HOME/.claude/sessions/*.json` to mint a CC
 *  roster when the `claude agents --json` CLI is absent (or returns
 *  ENOENT). Each session JSON envelope carries sessionId + cwd + name +
 *  status; we also probe the JSONL log via `resolveSessionLog` so the
 *  messageCount/lastMessageAt/lastMessageSnippet fields populate the
 *  same way the live-roster path does. Best-effort: malformed JSON or
 *  missing log files are skipped silently. */
function listAgentsFromDisk() {
  const sessionsDir = join(ccHome(), '.claude', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const out = [];
  let entries;
  try { entries = readdirSync(sessionsDir); } catch { return []; }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    let env;
    try {
      env = JSON.parse(readFileSync(join(sessionsDir, entry), 'utf8'));
    } catch { continue; }
    const sid = String(env?.sessionId || entry.replace(/\.json$/, ''));
    const cwd = String(env?.cwd || ccHome());
    const a = {
      id: sid,
      sessionId: sid,
      name: String(env?.name || sid),
      cwd,
      status: String(env?.status || 'unknown'),
      startedAt: env?.startedAt ?? null,
      updatedAt: env?.updatedAt ?? null,
      kind: String(env?.kind || 'bg'),
      source: 'disk',
    };
    // v10.0.6 — drop /tmp scratch sessions from disk roster.
    if (!shouldIncludeAgent(a)) continue;
    const logPath = resolveSessionLog(sid, cwd);
    if (logPath && existsSync(logPath)) {
      try {
        const st = statSync(logPath);
        const text = readFileSync(logPath, 'utf8');
        a.lastMessageAt = st.mtimeMs;
        a.messageCount = text.split('\n').filter((l) => l.trim()).length;
        const snippet = extractLastSnippet(text);
        if (snippet) a.lastMessageSnippet = snippet;
        a.logPath = logPath;
      } catch { /* best effort */ }
    }
    out.push(a);
  }
  return out;
}

async function listAgents({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cache.ts) < CACHE_TTL_MS) {
    return _cache;
  }
  const r = await runClaudeAgents();
  if (r.ok) {
    const agents = r.agents.map(enrichSession).filter(shouldIncludeAgent);
    // v10.0.4 — always merge disk fallback on top. CLI roster is the
    // authoritative source when present, but session JSON envelopes
    // (the `claude agents --json` output does NOT include all on-disk
    // sessions — e.g. finished/closed sessions persist on disk after
    // the CLI stops tracking them). Merge by sessionId so duplicates
    // collapse and disk-only fields (lastMessageAt/messageCount/
    // lastMessageSnippet) win when the CLI didn't populate them.
    const disk = listAgentsFromDisk();
    const byId = new Map(agents.map((a) => [a.sessionId || a.id, a]));
    for (const d of disk) {
      const key = d.sessionId || d.id;
      const existing = byId.get(key);
      if (existing) {
        if (!existing.lastMessageAt && d.lastMessageAt) existing.lastMessageAt = d.lastMessageAt;
        if (!existing.messageCount && d.messageCount) existing.messageCount = d.messageCount;
        if (!existing.lastMessageSnippet && d.lastMessageSnippet) existing.lastMessageSnippet = d.lastMessageSnippet;
      } else {
        byId.set(key, d);
      }
    }
    _cache = { ts: now, agents: [...byId.values()], error: null };
  } else {
    // v10.0.4 — when the `claude` CLI is absent (ENOENT) or returns
    // an error, fall back to enumerating `$HOME/.claude/sessions/*.json`
    // so the dashboard still renders a roster. The `error` field is
    // preserved so the UI can show a small "CLI unavailable" hint.
    const disk = listAgentsFromDisk();
    _cache = { ts: now, agents: disk, error: r.error || 'unknown' };
  }
  return _cache;
}

/** Read-only view of the last cached CC roster. Synchronous, returns
 *  { agents, error, ts } or null when no fetch has happened yet.
 *  Used by the overview snapshot to merge Bizar + CC without forking
 *  a subprocess per request. */
export function peekCachedAgents() {
  return _cache ? { ..._cache, agents: _cache.agents.slice() } : null;
}

/**
 * @param {{ broadcast?: Function }} deps
 */
export function createCCAgentsRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  router.get('/cc-agents', wrap(async (_req, res) => {
    const r = await listAgents();
    res.json({ agents: r.agents, count: r.agents.length, error: r.error });
  }));

  router.get('/cc-agents/:id', wrap(async (req, res) => {
    const r = await listAgents();
    const agent = r.agents.find((a) => a.id === req.params.id || a.sessionId === req.params.id);
    if (!agent) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(agent);
  }));

  // S11 — kill a CC background agent.
  router.post('/cc-agents/:id/kill', wrap(async (req, res) => {
    const id = req.params.id;
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid id' });
      return;
    }
    try {
      const proc = spawn('claude', ['agents', 'kill', id], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
      const exitCode = await new Promise((resolve) => proc.on('exit', resolve));
      _cache = null; // bust cache so the next list reflects the kill
      broadcast({ type: 'agents:change' });
      if (exitCode === 0) {
        res.json({ ok: true, id });
      } else {
        res.status(502).json({ ok: false, error: `exit ${exitCode}`, stderr: stderr.slice(0, 500) });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }));

  // v9.0.5 — restart = kill + spawn a fresh session with the same prompt.
  // The dashboard's Restart button calls this; the caller supplies the
  // prompt so the new session picks up where the old one stopped.
  router.post('/cc-agents/:id/restart', wrap(async (req, res) => {
    const id = req.params.id;
    const prompt = String((req.body && req.body.prompt) || '').trim();
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid id' });
      return;
    }
    if (!prompt) {
      res.status(400).json({ error: 'bad_request', message: 'prompt is required for restart' });
      return;
    }
    try {
      const proc = spawn('claude', ['agents', 'kill', id], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise((resolve) => proc.on('exit', resolve));
    } catch {
      // best-effort kill; if it fails we still try to spawn a new one.
    }
    try {
      const { spawnAgent } = await import('../claude-runner.mjs');
      const result = await spawnAgent({
        prompt,
        agent: undefined,
        worktree: HOME,
        logPath: join(HOME, '.claude', 'sessions', '_restart', `${Date.now()}.log`),
        background: true,
        sessionIdTimeoutMs: 5_000,
      });
      _cache = null;
      broadcast({ type: 'agents:change' });
      if (!result.ok) {
        res.status(502).json({ ok: false, error: result.error || 'spawn failed' });
        return;
      }
      res.json({ ok: true, sessionId: result.sessionId, processId: result.processId });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }));

  // S11 — send a follow-up prompt to a CC background agent.
  router.post('/cc-agents/:id/send', wrap(async (req, res) => {
    const id = req.params.id;
    const prompt = String((req.body && req.body.prompt) || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'bad_request', message: 'prompt is required' });
      return;
    }
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid id' });
      return;
    }
    const { spawnAgent } = await import('../claude-runner.mjs');
    const result = await spawnAgent({
      prompt,
      agent: undefined,
      worktree: HOME,
      logPath: join(HOME, '.claude', 'sessions', '_new', `${Date.now()}.log`),
      background: true,
      sessionIdTimeoutMs: 5_000,
    });
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.error || 'spawn failed' });
      return;
    }
    _cache = null;
    broadcast({ type: 'agents:change' });
    res.json({ ok: true, sessionId: result.sessionId, processId: result.processId });
  }));

  return router;
}

/**
 * resolveSessionLog — locate the JSONL file backing a Claude Code session.
 *
 * Claude Code writes per-session logs to:
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * The agent roster (from `claude agents --json`) gives us the session id
 * and the working directory; we encode the cwd the same way Claude Code
 * does (`-` prefix + every `/` replaced with `-`) and probe the path.
 */
export function resolveSessionLog(sessionId, cwd) {
  if (!sessionId) return null;
  const enc = String(cwd || '').replace(/[/]/g, '-').replace(/^-/, '-');
  const candidate = join(ccHome(), '.claude', 'projects', enc, `${sessionId}.jsonl`);
  return existsSync(candidate) ? candidate : null;
}

/**
 * parseJsonlTail — read the last N lines of a session JSONL and shape each
 * line into the dashboard's agent-stream event:
 *
 *   { ts, kind, content, role?, toolName?, toolInput? }
 *
 * Recognised line types: assistant message, user message, tool_use,
 * tool_result, system.
 */
export function parseJsonlTail(text, limit = 100) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const slice = lines.slice(-limit);
  const out = [];
  for (const line of slice) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = typeof rec.ts === 'string'
      ? Date.parse(rec.ts)
      : (typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : Date.now());
    const msg = rec.message || rec;
    const role = msg.role || rec.role || (rec.type === 'user' ? 'user' : rec.type === 'assistant' ? 'assistant' : 'system');
    if (msg.content && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          out.push({ ts, kind: 'text', role, content: String(block.text || '').slice(0, 4000) });
        } else if (block.type === 'tool_use') {
          out.push({
            ts,
            kind: 'tool',
            role,
            toolName: String(block.name || 'tool'),
            toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}).slice(0, 4000),
          });
        } else if (block.type === 'tool_result') {
          out.push({
            ts,
            kind: 'tool-result',
            role,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '').slice(0, 4000),
            isError: block.is_error === true,
          });
        }
      }
    } else if (typeof msg.content === 'string') {
      out.push({ ts, kind: 'text', role, content: msg.content.slice(0, 4000) });
    } else if (rec.type === 'system' || rec.type === 'summary') {
      out.push({ ts, kind: 'system', role: 'system', content: typeof rec.summary === 'string' ? rec.summary : JSON.stringify(rec).slice(0, 2000) });
    }
  }
  return out;
}

/**
 * createAgentStreamRouter — separate Router mounted at `/api/agent-stream`.
 * Exposes:
 *   GET /api/agent-stream/recent?sessionId=<id>&limit=<n>
 *     Buffered last-N events for a session (cheap, no file watch).
 *   GET /api/agent-stream/live?sessionId=<id>
 *     Server-Sent Events stream. Sends the buffer first, then tails the
 *     JSONL via fs.watch and pushes new lines as `event: append` frames.
 *     25s heartbeat keeps proxies from idling out the connection.
 */
export function createAgentStreamRouter() {
  const router = Router();

  router.get('/agent-stream/recent', wrap(async (req, res) => {
    const sessionId = String(req.query?.sessionId || '');
    const limit = Math.min(Math.max(parseInt(String(req.query?.limit || '50'), 10) || 50, 1), 500);
    const r = await listAgents();
    const agent = r.agents.find((a) => a.sessionId === sessionId || a.id === sessionId);
    if (!agent) { res.status(404).json({ error: 'not_found' }); return; }
    const logPath = resolveSessionLog(agent.sessionId, agent.cwd);
    if (!logPath) { res.json({ events: [], agent, logPath: null }); return; }
    const stat = statSync(logPath);
    if (!stat.isFile()) { res.json({ events: [], agent }); return; }
    const start = Math.max(0, stat.size - 256 * 1024); // last 256KB keeps it cheap
    const fd = await import('node:fs').then((m) => m.openSync(logPath, 'r'));
    const buf = Buffer.alloc(stat.size - start);
    try {
      readFileSync(fd, buf, 0, buf.length, start);
    } finally {
      (await import('node:fs')).closeSync(fd);
    }
    res.json({
      agent,
      logPath,
      events: parseJsonlTail(buf.toString('utf8'), limit),
    });
  }));

  router.get('/agent-stream/live', (req, res) => {
    const sessionId = String(req.query?.sessionId || '');
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(sessionId)) {
      res.status(400).json({ error: 'bad_request', message: 'sessionId required' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const send = (event, data) => {
      if (closed) return;
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
    };

    // Initial snapshot — last 50 events so the UI renders immediately.
    (async () => {
      const r = await listAgents();
      const agent = r.agents.find((a) => a.sessionId === sessionId || a.id === sessionId);
      if (!agent) { send('error', { error: 'not_found' }); res.end(); return; }
      const logPath = resolveSessionLog(agent.sessionId, agent.cwd);
      send('agent', agent);
      if (!logPath) { send('end', { reason: 'no_log' }); return; }
      const stat = statSync(logPath);
      let offset = stat.size;
      // Seed with the last 50 events so the user sees context.
      const start = Math.max(0, stat.size - 128 * 1024);
      const buf = Buffer.alloc(stat.size - start);
      const fd = await import('node:fs').then((m) => m.openSync(logPath, 'r'));
      try { readFileSync(fd, buf, 0, buf.length, start); } finally { (await import('node:fs')).closeSync(fd); }
      send('snapshot', { events: parseJsonlTail(buf.toString('utf8'), 50) });

      // Tail the file via fs.watch + interval poll (fs.watch is flaky on Linux
      // for files appended to by other processes; poll every 750ms as a safety net).
      const interval = setInterval(async () => {
        if (closed) return;
        try {
          const s = statSync(logPath);
          if (s.size > offset) {
            const fd2 = await import('node:fs').then((m) => m.openSync(logPath, 'r'));
            const buf2 = Buffer.alloc(s.size - offset);
            try { readFileSync(fd2, buf2, 0, buf2.length, offset); } finally { (await import('node:fs')).closeSync(fd2); }
            offset = s.size;
            send('append', { events: parseJsonlTail(buf2.toString('utf8'), 200) });
          }
        } catch {
          // file may have been rotated — close gracefully.
          send('end', { reason: 'file_gone' });
          closed = true;
          res.end();
        }
      }, 750);

      // Heartbeat keeps the connection alive through corporate proxies.
      const hb = setInterval(() => {
        if (closed) return;
        try { res.write(': ping\n\n'); } catch { closed = true; }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        clearInterval(hb);
        try { res.end(); } catch { /* */ }
      };
      req.on('close', cleanup);
      req.on('aborted', cleanup);
    })().catch((err) => {
      send('error', { error: err?.message || String(err) });
      try { res.end(); } catch { /* */ }
    });
  });

  return router;
}

export const _internals = { listAgents, runClaudeAgents, enrichSession, listAgentsFromDisk, extractLastSnippet, resolveSessionLog, peekCachedAgents, CACHE_TTL_MS };