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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';

const HOME = homedir();
const CACHE_TTL_MS = 5_000;
let _cache = null; // { ts, agents, error }

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

function enrichSession(agent) {
  if (!agent || !agent.sessionId) return agent;
  const file = join(HOME, '.claude', 'sessions', agent.sessionId, 'messages.jsonl');
  if (!existsSync(file)) return agent;
  try {
    const st = statSync(file);
    agent.lastMessageAt = st.mtimeMs;
    const text = readFileSync(file, 'utf8');
    agent.messageCount = text.split('\n').filter((l) => l.trim()).length;
    // Read last assistant text snippet (best-effort).
    const lines = text.split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj?.type === 'assistant' && obj?.message?.content) {
          const c = obj.message.content;
          const txt = typeof c === 'string' ? c
            : Array.isArray(c) ? c.filter((b) => b && (b.type === 'text' || typeof b.text === 'string')).map((b) => b.text || '').join('\n')
            : '';
          if (txt) { agent.lastMessageSnippet = txt.replace(/\s+/g, ' ').trim().slice(0, 120); }
          break;
        }
      } catch { /* skip */ }
    }
  } catch { /* best effort */ }
  return agent;
}

async function listAgents({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cache.ts) < CACHE_TTL_MS) {
    return _cache;
  }
  const r = await runClaudeAgents();
  if (r.ok) {
    const agents = r.agents.map(enrichSession);
    _cache = { ts: now, agents, error: null };
  } else {
    _cache = { ts: now, agents: [], error: r.error || 'unknown' };
  }
  return _cache;
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

export const _internals = { listAgents, runClaudeAgents, enrichSession, CACHE_TTL_MS };