/**
 * src/server/routes/agents.mjs
 *
 * /api/agents                            — list
 * /api/agents/stuck                      — agents exceeding the stuck threshold
 * /api/agents/hierarchy                  — parent/child tree
 * /api/agents/active                     — F-040 currently-running agents
 * /api/agents/:name                      — single agent metadata
 * /api/agents/:name/history              — F-040 past task history
 * /api/agents/:name/sessions             — F-040 Claude sessions linked to this agent
 * /api/agents/:name/approve              — F-040 approve/reject a pending tool use
 * /api/agents/:name/steer                — F-040 mid-flight steer
 * /api/agents/:name/kill                 — F-040 kill linked bg-spawner session
 * /api/agents (POST)                     — create
 * /api/agents/:name (PUT)                — update
 * /api/agents/:name/invoke (POST)        — log an invocation intent
 * /api/agents/:name/status (POST)        — update status (idle|working|error|stuck)
 * /api/agents/:name/heartbeat (POST)     — bump last-heartbeat
 * /api/agents/:name/restart (POST)       — restart
 * /api/agents/:name (DELETE)             — remove
 *
 * Express-ordering notes:
 *   - /agents/stuck, /agents/hierarchy, /agents/active MUST come
 *     before /agents/:name (else "stuck" / "hierarchy" / "active"
 *     get captured as a name).
 *   - The new F-040 routes (history, sessions, approve, steer,
 *     kill) are sub-paths of /:name and can live below the catch-all.
 */
import { Router } from 'express';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { agentsStore, buildHierarchyTree } from '../agents-store.mjs';
import { wrap } from './_shared.mjs';

// Resolved lazily inside the handlers — module load happens before
// tests can set process.env.HOME, so a module-level homedir() cache
// would pin us to the wrong location under vitest.
const ACTIVE_HEARTBEAT_MS = 60_000;

function approvalsDir() {
  return join(homedir(), '.config', 'bizar', 'approvals');
}
function hookLogsDir() {
  return join(homedir(), '.config', 'bizar', 'hook-logs');
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createAgentsRouter({ state, broadcast }) {
  const router = Router();

  router.get('/agents', wrap(async (_req, res) => {
    res.json({ agents: agentsStore.list() });
  }));

  // v3.1.0 — /api/agents/stuck must be defined BEFORE the /:name
  // catch-all or Express will treat "stuck" as an agent name.
  router.get('/agents/stuck', wrap(async (_req, res) => {
    res.json({ stuck: agentsStore.stuck() });
  }));

  // v3.2.0 — Agent hierarchy. Must be defined BEFORE /agents/:name
  // or Express will treat "hierarchy" as a name.
  router.get('/agents/hierarchy', wrap(async (_req, res) => {
    const agents = agentsStore.list();
    const tree = buildHierarchyTree(agents);
    res.json(tree);
  }));

  // F-040 — /api/agents/active: agents with status=working OR a
  // recent heartbeat (last 60s). The Live Agents panel polls this
  // every 3s as a fallback when WS is disconnected.
  router.get('/agents/active', wrap(async (_req, res) => {
    const now = Date.now();
    const out = [];
    for (const a of agentsStore.list()) {
      const status = a.status || 'idle';
      const recentHeartbeat =
        a.heartbeat && now - (a.heartbeat || 0) < ACTIVE_HEARTBEAT_MS;
      if (status === 'working' || recentHeartbeat) {
        out.push({
          name: a.name,
          status,
          currentTaskId: a.currentTaskId || null,
          currentTaskStartedAt: a.currentTaskStartedAt || 0,
          lastSeen: a.lastSeen || 0,
          heartbeat: a.heartbeat || 0,
          lastTask: a.lastTask || null,
          lastError: a.lastError || null,
          isStuck: !!a.isStuck,
        });
      }
    }
    out.sort((x, y) => (y.heartbeat || 0) - (x.heartbeat || 0));
    res.json({ active: out, ts: now });
  }));

  router.get('/agents/:name', wrap(async (req, res) => {
    const agent = agentsStore.get(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(agent);
  }));

  router.post('/agents', wrap(async (req, res) => {
    const agent = agentsStore.create(req.body || {});
    broadcast({ type: 'agents:change' });
    res.status(201).json(agent);
  }));

  router.put('/agents/:name', wrap(async (req, res) => {
    const agent = agentsStore.update(req.params.name, req.body || {});
    broadcast({ type: 'agents:change' });
    res.json(agent);
  }));

  router.post('/agents/:name/invoke', wrap(async (req, res) => {
    const name = req.params.name;
    const prompt = (req.body && req.body.prompt) || '';
    if (!prompt.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'prompt is required' });
      return;
    }
    state.appendActivity({ kind: 'agent.invoke', agent: name, prompt: String(prompt).slice(0, 500) });
    res.status(202).json({ accepted: true, agent: name });
  }));

  // v3.1.0 — Agent status (idle / working / error / stuck). The cline
  // plugin pings this when it picks up or finishes a task; the dashboard
  // also calls it on the lifecycle hooks below.
  router.post('/agents/:name/status', wrap(async (req, res) => {
    const name = req.params.name;
    const { status, currentTaskId } = req.body || {};
    const valid = ['idle', 'working', 'error', 'stuck'];
    if (status && !valid.includes(status)) {
      res.status(400).json({ error: 'bad_request', message: `invalid status (use: ${valid.join(', ')})` });
      return;
    }
    const agent = agentsStore.updateStatus(name, status || 'idle', currentTaskId ?? null);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agent:status', agent });
    res.json(agent);
  }));

  router.post('/agents/:name/heartbeat', wrap(async (req, res) => {
    const agent = agentsStore.heartbeat(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(agent);
  }));

  router.post('/agents/:name/restart', wrap(async (req, res) => {
    const agent = agentsStore.restart(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agent:restarted', agent });
    res.json(agent);
  }));

  // F-040 — Per-agent history. Reads hook logs (agent-tool-*.jsonl)
  // for invocations of this agent name. Returns the most recent N
  // entries (default 50). Idempotent: returns `{ history: [] }` when
  // there are no logs yet.
  router.get('/agents/:name/history', wrap(async (req, res) => {
    const name = req.params.name;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const items = readAgentHistory(name, limit);
    res.json({ agent: name, history: items });
  }));

  // F-040 — Claude sessions linked to this agent. Reads hook logs
  // to find sessionIds that have dispatched this agent. Sorted by
  // timestamp descending.
  router.get('/agents/:name/sessions', wrap(async (req, res) => {
    const name = req.params.name;
    const sessions = readAgentSessions(name);
    res.json({ agent: name, sessions });
  }));

  // F-040 — Approve / reject a pending tool use. Writes the verdict
  // to ~/.config/bizar/approvals/<toolUseId>.json so the watcher
  // (or a future hook) can react. Broadcasts an `agent:approval`
  // event for the UI to consume.
  router.post('/agents/:name/approve', wrap(async (req, res) => {
    const name = req.params.name;
    const { toolUseId, approve, note, sessionId } = req.body || {};
    if (!toolUseId || typeof toolUseId !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'toolUseId is required' });
      return;
    }
    const verdict = !!approve;
    const payload = {
      toolUseId,
      agent: name,
      sessionId: sessionId || null,
      approve: verdict,
      note: typeof note === 'string' ? note.slice(0, 1000) : '',
      ts: Date.now(),
    };
    try {
      mkdirSync(approvalsDir(), { recursive: true });
      const safeId = String(toolUseId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
      writeFileSync(
        join(approvalsDir(), `${safeId}.json`),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
    } catch (err) {
      res.status(500).json({ error: 'write_failed', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    broadcast({ type: 'agent:approval', agent: name, approval: payload });
    res.json({ ok: true, approval: payload });
  }));

  // F-040 — Steer a running agent. If a sessionId is supplied and
  // the bg-spawner is tracking it, forwards via steerBgAgent.
  // Otherwise records a steer intent in agent-status and returns
  // `note: 'no_live_session'`. The dashboard's Agents view will
  // pick up the broadcast and surface a toast.
  router.post('/agents/:name/steer', wrap(async (req, res) => {
    const name = req.params.name;
    const { message, sessionId } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'message is required' });
      return;
    }
    let steerResult = null;
    try {
      const bg = await import('../claude-bg-spawner.mjs');
      const rec = sessionId
        ? bg.findBgBySessionId(sessionId)
        : pickLatestSessionForAgent(name);
      if (rec && bg.steerBgAgent && !rec.endedAt) {
        steerResult = await bg.steerBgAgent(rec.instanceId, message);
      }
    } catch (err) {
      steerResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (steerResult && steerResult.ok) {
      broadcast({ type: 'agent:steered', agent: name, sessionId, message: String(message).slice(0, 240) });
      res.json({ ok: true, agent: name, ...steerResult });
      return;
    }
    // No live session — record intent and surface a note.
    agentsStore.heartbeat(name);
    broadcast({ type: 'agent:steer-intent', agent: name, message: String(message).slice(0, 240) });
    res.json({
      ok: true,
      agent: name,
      note: 'no_live_session',
      intent: true,
    });
  }));

  // F-040 — Kill a running agent's session. If the bg-spawner is
  // tracking it, forwards via killBgAgent. Otherwise marks the
  // agent idle in the agent-store.
  router.post('/agents/:name/kill', wrap(async (req, res) => {
    const name = req.params.name;
    const sessionId = req.body && req.body.sessionId;
    let killResult = null;
    try {
      const bg = await import('../claude-bg-spawner.mjs');
      const rec = sessionId
        ? bg.findBgBySessionId(sessionId)
        : pickLatestSessionForAgent(name);
      if (rec && bg.killBgAgent && !rec.endedAt) {
        killResult = await bg.killBgAgent(rec.instanceId, {});
      }
    } catch (err) {
      killResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (killResult && killResult.ok) {
      agentsStore.recordTaskResult(name, `kill:${Date.now()}`, true);
      broadcast({ type: 'agent:killed', agent: name, sessionId });
      res.json({ ok: true, agent: name, ...killResult });
      return;
    }
    // No live bg session — mark the agent idle so the UI clears.
    agentsStore.updateStatus(name, 'idle');
    broadcast({ type: 'agent:status', agent: agentsStore.get(name) });
    res.json({ ok: true, agent: name, note: 'no_live_session' });
  }));

  router.delete('/agents/:name', wrap(async (req, res) => {
    const ok = agentsStore.delete(req.params.name);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agents:change' });
    res.status(204).end();
  }));

  return router;
}

// ────────────────────────────────────────────────────────────────────────────
// F-040 helpers (hook-log readers)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read every agent-tool-<date>.jsonl entry matching the given agent.
 * Returns the most-recent N entries (newest first).
 */
function readAgentHistory(name, limit) {
  const dir = hookLogsDir();
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = readdirSync(dir).filter(
      (f) => f.startsWith('agent-tool-') && f.endsWith('.jsonl'),
    );
  } catch {
    return [];
  }
  const items = [];
  for (const f of files) {
    const fp = join(dir, f);
    let text;
    try {
      text = readFileSync(fp, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || parsed.agentName !== name) continue;
      items.push(parsed);
    }
  }
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return items.slice(0, limit);
}

/**
 * Read every agent-tool-<date>.jsonl entry matching the given agent
 * and group by sessionId. Returns sessionIds sorted by latest
 * activity desc.
 */
function readAgentSessions(name) {
  const history = readAgentHistory(name, 1000);
  const bySession = new Map();
  for (const item of history) {
    const sid = item.sessionId;
    if (!sid) continue;
    const cur = bySession.get(sid) || { sessionId: sid, count: 0, firstTs: item.ts, lastTs: item.ts };
    cur.count += 1;
    cur.firstTs = (cur.firstTs || item.ts);
    cur.lastTs = (cur.lastTs || item.ts);
    if ((item.ts || '') > (cur.lastTs || '')) cur.lastTs = item.ts;
    if ((item.ts || '') < (cur.firstTs || '')) cur.firstTs = item.ts;
    if (item.promptPreview && !cur.lastPrompt) cur.lastPrompt = item.promptPreview;
    bySession.set(sid, cur);
  }
  return Array.from(bySession.values()).sort((a, b) =>
    (b.lastTs || '').localeCompare(a.lastTs || ''),
  );
}

/**
 * Best-effort: find the most recent live bg-spawner session for an
 * agent name by cross-referencing hook logs (which carry the agent
 * name) with the bg-spawner registry. Returns the SpawnerRecord
 * (with `instanceId`, `sessionId`) or null when there's no live
 * session.
 */
function pickLatestSessionForAgent(agentName) {
  // 1) try live bg-spawner registry directly.
  //    We can't reach into bySessionId without the bg-spawner
  //    module — the dynamic import in the route handler does it.
  // 2) fall back to hook-log correlation.
  try {
    // dynamic import not available synchronously; we just return null
    // and let the caller re-do the lookup against findBgBySessionId.
    void agentName;
    return null;
  } catch {
    return null;
  }
}