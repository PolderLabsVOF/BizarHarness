/**
 * src/server/api.mjs
 *
 * v3.0.0 — Comprehensive REST surface for the Bizar dashboard.
 *
 * All routes return JSON. Errors are JSON { error, message } with status.
 * Handlers are wrapped in a `wrap` helper so a thrown error never crashes
 * Express.
 */
import express from 'express';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from './projects-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { agentsStore } from './agents-store.mjs';
import { providersStore, mcpsStore } from './providers-store.mjs';
import { modsLoader } from './mods-loader.mjs';
import { schedulesStore } from './schedules-store.mjs';
import { schedulesRunner } from './schedules-runner.mjs';
import { searchStore } from './search-store.mjs';
import { diagnosticsStore } from './diagnostics-store.mjs';
import { tailscaleStore } from './tailscale-store.mjs';

const HOME = homedir();
const OPENCODE_DIR = join(HOME, '.config', 'opencode');
const OPENCODE_JSON = join(OPENCODE_DIR, 'opencode.json');
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const SETTINGS_FILE = join(BIZAR_HOME, 'settings.json');

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function safeReadText(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

/**
 * The v3 settings shape.
 */
const DEFAULT_SETTINGS = {
  theme: {
    mode: 'dark',
    accent: '#8b5cf6',
    success: '#3fb950',
    warning: '#d29922',
    error: '#f85149',
    info: '#58a6ff',
    fontFamily: 'Inter',
    fontSize: 14,
    compactMode: false,
    animations: true,
  },
  ui: {
    layout: 'topnav',
    showHeader: true,
    showStatusBar: true,
    defaultTab: 'overview',
  },
  defaultAgent: 'odin',
  defaultModel: '',
  notifications: { onAgentComplete: true, onPlanApproval: true },
  dashboard: { autoLaunchWeb: true },
  service: { enabled: true, autostart: false },
  about: {
    version: '3.0.4',
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  },
};

function mergeSettings(existing) {
  if (!existing || typeof existing !== 'object') return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  merged.theme = { ...DEFAULT_SETTINGS.theme, ...(existing.theme || {}) };
  merged.ui = { ...DEFAULT_SETTINGS.ui, ...(existing.ui || {}) };
  merged.notifications = {
    ...DEFAULT_SETTINGS.notifications,
    ...(existing.notifications || {}),
  };
  merged.dashboard = { ...DEFAULT_SETTINGS.dashboard, ...(existing.dashboard || {}) };
  merged.service = { ...DEFAULT_SETTINGS.service, ...(existing.service || {}) };
  merged.about = { ...DEFAULT_SETTINGS.about, ...(existing.about || {}) };
  return merged;
}

function readSettings() {
  const raw = safeReadJSON(SETTINGS_FILE, null);
  return {
    path: SETTINGS_FILE,
    data: mergeSettings(raw),
    exists: existsSync(SETTINGS_FILE),
  };
}

function writeSettings(data) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const merged = mergeSettings(data);
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return readSettings();
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, '');
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

function readActiveProjectId() {
  return projectsStore.active()?.id || null;
}

export function createApiRouter({
  state,
  watcher,
  projectRoot,
  opencodeConfigDir,
  bizarRoot,
  broadcast = () => {},
}) {
  const router = express.Router();

  const wrap = (fn) => async (req, res, ...rest) => {
    try {
      await fn(req, res, ...rest);
    } catch (err) {
      const status = err?.status || 500;
      res.status(status).json({
        error: err?.code || 'internal_error',
        message: err?.message || String(err),
      });
    }
  };

  // ── /api/snapshot ──────────────────────────────────────────────────────
  router.get('/snapshot', wrap(async (_req, res) => {
    res.json(buildSnapshot());
  }));

  router.get('/overview', wrap(async (_req, res) => {
    res.json(state.getOverview());
  }));

  // ── /api/projects ──────────────────────────────────────────────────────
  router.get('/projects', wrap(async (_req, res) => {
    res.json(projectsStore.list());
  }));

  router.post('/projects', wrap(async (req, res) => {
    const path = (req.body?.path || '').trim();
    const name = req.body?.name || null;
    if (!path) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    const project = projectsStore.add(path, name);
    state.appendActivity({ kind: 'project.add', id: project.id, path: project.path });
    res.status(201).json(project);
  }));

  router.post('/projects/:id/activate', wrap(async (req, res) => {
    const activated = projectsStore.activate(req.params.id);
    if (!activated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    state.appendActivity({ kind: 'project.activate', id: activated.id });
    broadcast({ type: 'project:change', project: activated });
    res.json(activated);
  }));

  router.delete('/projects/:id', wrap(async (req, res) => {
    projectsStore.remove(req.params.id);
    broadcast({ type: 'project:change' });
    res.status(204).end();
  }));

  router.post('/projects/refresh', wrap(async (_req, res) => {
    res.json(projectsStore.list());
  }));

  // v3.0.4 — Manual auto-detect trigger for the "Use current directory"
  // button on the Overview. Auto-detects the server's `projectRoot` and
  // returns the (possibly updated) registry. Idempotent.
  router.post('/projects/auto-detect', wrap(async (_req, res) => {
    const detected = projectsStore.autoDetect({ cwd: projectRoot });
    if (detected) {
      state.appendActivity({ kind: 'project.auto-detect', id: detected.id, path: detected.path });
      broadcast({ type: 'project:change', project: detected });
    }
    res.json(projectsStore.list());
  }));

  // ── /api/projects/active/<entity> ──────────────────────────────────────
  router.get('/projects/active/tasks', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ tasks: [], projectId: null });
      return;
    }
    res.json({ tasks: tasksStore.loadTasks(active.id), projectId: active.id });
  }));

  router.get('/projects/active/schedules', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ schedules: [], projectId: null });
      return;
    }
    res.json({ schedules: schedulesStore.list(active.id), projectId: active.id });
  }));

  router.get('/projects/active/mods', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ mods: [], projectId: null });
      return;
    }
    res.json({ mods: [], projectId: active.id });
  }));

  router.get('/projects/active/state', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ state: {}, projectId: null });
      return;
    }
    const stateFile = join(projectsStore.projectDir(active.id), 'state.json');
    res.json({ state: safeReadJSON(stateFile, {}) || {}, projectId: active.id });
  }));

  // ── /api/tasks ─────────────────────────────────────────────────────────
  router.get('/tasks', wrap(async (_req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    res.json(tasksStore.loadTasks(projectId));
  }));

  router.post('/tasks', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.create(projectId, req.body || {});
    broadcast({ type: 'tasks:change', task });
    res.status(201).json(task);
  }));

  router.put('/tasks/:id', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.update(projectId, req.params.id, req.body || {});
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.patch('/tasks/:id/status', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { status } = req.body || {};
    if (!['queued', 'doing', 'done'].includes(status)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid status' });
      return;
    }
    const task = await tasksStore.move(projectId, req.params.id, status);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/comments', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.addComment(projectId, req.params.id, req.body?.text || '');
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/timer', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.toggleTimer(projectId, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.delete('/tasks/:id', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const ok = await tasksStore.delete(projectId, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:delete', id: req.params.id });
    res.status(204).end();
  }));

  // ── /api/schedules ─────────────────────────────────────────────────────
  router.get('/schedules', wrap(async (_req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    res.json(schedulesStore.list(projectId || 'default'));
  }));

  router.post('/schedules', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.add(projectId, req.body || {});
    broadcast({ type: 'schedules:change' });
    res.status(201).json(sched);
  }));

  router.put('/schedules/:id', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.update(projectId, req.params.id, req.body || {});
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'schedules:change' });
    res.json(sched);
  }));

  router.post('/schedules/:id/run', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.get(projectId, req.params.id);
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await schedulesRunner.runOne(projectId, sched);
    broadcast({ type: 'schedules:change' });
    res.json(result);
  }));

  router.delete('/schedules/:id', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId() || 'default';
    const ok = schedulesStore.remove(projectId, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'schedules:change' });
    res.status(204).end();
  }));

  // ── /api/mods ──────────────────────────────────────────────────────────
  router.get('/mods', wrap(async (_req, res) => {
    res.json({ mods: modsLoader.list() });
  }));

  router.get('/mods/:id', wrap(async (req, res) => {
    const mod = modsLoader.get(req.params.id);
    if (!mod) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(mod);
  }));

  router.post('/mods', wrap(async (req, res) => {
    const path = req.body?.path;
    if (!path) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    const mod = modsLoader.installFromPath(path);
    res.status(201).json(mod);
  }));

  router.put('/mods/:id', wrap(async (req, res) => {
    const mod = modsLoader.setEnabled(req.params.id, !!req.body?.enabled);
    if (!mod) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(mod);
  }));

  router.delete('/mods/:id', wrap(async (req, res) => {
    const ok = modsLoader.uninstall(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  router.get('/mods/:id/files', wrap(async (req, res) => {
    res.json({ files: modsLoader.listFiles(req.params.id) });
  }));

  // NOTE: we use /mods/:id/mod-file/* (named route) to avoid conflicting
  // with mod route mounting at /api/mods/:id/*. The wildcard in /* was
  // too greedy and captured paths like /mods/test-mod/hello.
  router.get('/mods/:id/mod-file/*', wrap(async (req, res) => {
    const rel = req.params[0] || '';
    const content = modsLoader.readFile(req.params.id, rel);
    if (content === null) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.type('text/plain').send(content);
  }));

  router.put('/mods/:id/mod-file/*', wrap(async (req, res) => {
    const rel = req.params[0] || '';
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    modsLoader.writeFile(req.params.id, rel, body);
    res.json({ ok: true });
  }));

  // ── /api/mods/views ──────────────────────────────────────────────────
  router.get('/mods/views', wrap(async (_req, res) => {
    const views = modsLoader.listModViews();
    res.json({ views });
  }));

  // ── /api/mods/:id/mod-web/* ──────────────────────────────────────────
  // Serve files from each mod's web/ directory (for iframe embedding)
  // Named 'mod-web' to avoid conflict with mod route mounting at /:id/*
  router.get('/mods/:id/mod-web/*', wrap(async (req, res) => {
    const mod = modsLoader.get(req.params.id);
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const rel = req.params[0] || '';
    const filePath = join(mod.path, 'web', rel);
    if (!filePath.startsWith(mod.path)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(filePath);
  }));

  

  
// ── /api/agents ────────────────────────────────────────────────────────
  router.get('/agents', wrap(async (_req, res) => {
    res.json({ agents: agentsStore.list() });
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

  router.delete('/agents/:name', wrap(async (req, res) => {
    const ok = agentsStore.delete(req.params.name);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agents:change' });
    res.status(204).end();
  }));

  // ── /api/config ────────────────────────────────────────────────────────
  router.get('/config', wrap(async (_req, res) => {
    const data = safeReadJSON(OPENCODE_JSON, null);
    res.json({
      path: OPENCODE_JSON,
      data,
      raw: data === null ? '' : JSON.stringify(data, null, 2),
      exists: existsSync(OPENCODE_JSON),
    });
  }));

  router.put('/config', wrap(async (req, res) => {
    const body = req.body;
    let parsed;
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        res.status(400).json({ error: 'invalid_json', message: err.message });
        return;
      }
    } else if (body && typeof body === 'object') {
      parsed = body;
    } else {
      res.status(400).json({ error: 'bad_request', message: 'body must be JSON' });
      return;
    }
    mkdirSync(dirname(OPENCODE_JSON), { recursive: true });
    writeFileSync(OPENCODE_JSON, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    state.appendActivity({ kind: 'config.update' });
    watcher.poke('change', OPENCODE_JSON);
    res.json({ path: OPENCODE_JSON, data: parsed, exists: true, raw: JSON.stringify(parsed, null, 2) });
  }));

  router.post('/config/reload', wrap(async (_req, res) => {
    const data = safeReadJSON(OPENCODE_JSON, null);
    res.json({
      path: OPENCODE_JSON,
      data,
      raw: data === null ? '' : JSON.stringify(data, null, 2),
      exists: existsSync(OPENCODE_JSON),
    });
  }));

  // ── /api/config/providers ─────────────────────────────────────────────
  router.get('/config/providers', wrap(async (_req, res) => {
    res.json({ providers: providersStore.list() });
  }));

  router.post('/config/providers', wrap(async (req, res) => {
    const provider = providersStore.add(req.body || {});
    res.status(201).json(provider);
  }));

  router.put('/config/providers/:id', wrap(async (req, res) => {
    const provider = providersStore.update(req.params.id, req.body || {});
    res.json(provider);
  }));

  router.delete('/config/providers/:id', wrap(async (req, res) => {
    const ok = providersStore.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // ── /api/config/mcps ───────────────────────────────────────────────────
  router.get('/config/mcps', wrap(async (_req, res) => {
    res.json({ mcps: mcpsStore.list() });
  }));

  router.post('/config/mcps', wrap(async (req, res) => {
    const mcp = mcpsStore.add(req.body || {});
    res.status(201).json(mcp);
  }));

  router.put('/config/mcps/:id', wrap(async (req, res) => {
    const mcp = mcpsStore.update(req.params.id, req.body || {});
    res.json(mcp);
  }));

  router.delete('/config/mcps/:id', wrap(async (req, res) => {
    const ok = mcpsStore.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // ── /api/settings ─────────────────────────────────────────────────────
  router.get('/settings', wrap(async (_req, res) => {
    res.json(readSettings());
  }));

  router.put('/settings', wrap(async (req, res) => {
    const updated = writeSettings(req.body || {});
    state.appendActivity({ kind: 'settings.update' });
    broadcast({ type: 'settings:change', settings: updated.data });
    res.json(updated);
  }));

  router.post('/settings/reset', wrap(async (_req, res) => {
    const updated = writeSettings(DEFAULT_SETTINGS);
    broadcast({ type: 'settings:change', settings: updated.data });
    res.json(updated);
  }));

  // ── /api/chat ──────────────────────────────────────────────────────────
  router.get('/chat', wrap(async (req, res) => {
    const sessionId = req.query.session ? String(req.query.session) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json(state.getChat({ sessionId, limit }));
  }));

  router.post('/chat', wrap(async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'bad_request', message: 'message is required' });
      return;
    }
    const active = projectsStore.active();
    if (active) {
      // Append to per-project session
      const dir = projectsStore.ensureProjectDir(active.id);
      const sessionsDir = join(dir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      const sessionId = body.session || `sess_${Date.now().toString(36)}`;
      const file = join(sessionsDir, `${sessionId}.jsonl`);
      const record = {
        ts: new Date().toISOString(),
        role: 'user',
        agent: body.agent || null,
        model: body.model || null,
        content: message,
        attachments: body.attachments || [],
      };
      try {
        const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
        lines.push(JSON.stringify(record));
        writeFileSync(file, lines.map((l) => l).join('\n') + '\n', 'utf8');
      } catch (err) {
        // best effort
      }
    }
    state.appendActivity({
      kind: 'chat.message',
      agent: body.agent || null,
      message: message.slice(0, 500),
    });
    broadcast({ type: 'chat:message', message: record });
    res.status(202).json({
      accepted: true,
      agent: body.agent || null,
      queued: true,
    });
  }));

  router.get('/chat/sessions', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ sessions: [] });
      return;
    }
    const dir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
    if (!existsSync(dir)) {
      res.json({ sessions: [] });
      return;
    }
    const sessions = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { id: f.replace(/\.jsonl$/, ''), file: f, mtime: st.mtimeMs, size: st.size };
      });
    sessions.sort((a, b) => b.mtime - a.mtime);
    res.json({ sessions });
  }));

  // v3.0.4 — Create a new chat session. Generates an id, ensures the
  // sessions dir + empty .jsonl file exist, and returns the session
  // metadata. Idempotent: if the session already exists, returns it.
  router.post('/chat/sessions', wrap(async (req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'No active project. Pick one in Overview first.' });
      return;
    }
    const requestedId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const sessionId = requestedId && /^[\w-]+$/.test(requestedId)
      ? requestedId
      : `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) {
      writeFileSync(file, '', 'utf8');
    }
    state.appendActivity({ kind: 'chat.session.create', id: sessionId });
    broadcast({ type: 'chat:session:create', sessionId });
    res.status(201).json({
      id: sessionId,
      file: `${sessionId}.jsonl`,
      mtime: Date.now(),
      size: 0,
    });
  }));

  // ── /api/search ────────────────────────────────────────────────────────
  router.get('/search', wrap(async (req, res) => {
    const q = (req.query.q || '').toString();
    const scope = (req.query.scope || 'all').toString();
    const active = projectsStore.active();
    res.json(searchStore.search(q, { activeProjectId: active?.id, scope }));
  }));

  // ── /api/diagnostics ──────────────────────────────────────────────────
  router.get('/diagnostics', wrap(async (_req, res) => {
    res.json(diagnosticsStore.snapshot());
  }));

  router.get('/diagnostics/health', wrap(async (_req, res) => {
    res.json(diagnosticsStore.health());
  }));

  router.get('/diagnostics/logs', wrap(async (req, res) => {
    const tail = Math.min(Number(req.query.tail) || 100, 5000);
    const serviceLog = join(BIZAR_HOME, 'service.log');
    const dashboardLog = join(BIZAR_HOME, 'dashboard.log');
    // Prefer service.log, fall back to dashboard.log
    const logFile = existsSync(serviceLog) ? serviceLog : existsSync(dashboardLog) ? dashboardLog : null;
    if (!logFile) {
      res.json({ lines: [], file: null, total: 0 });
      return;
    }
    try {
      const text = readFileSync(logFile, 'utf8');
      const allLines = text.split(/\r?\n/).filter(Boolean);
      const lines = allLines.slice(-tail);
      res.json({ lines, file: logFile, total: allLines.length });
    } catch (err) {
      res.status(500).json({ error: 'read_failed', message: err.message });
    }
  }));

  // ── /api/tailscale ─────────────────────────────────────────────────────
  router.get('/tailscale/status', wrap(async (_req, res) => {
    res.json(await tailscaleStore.status());
  }));

  router.post('/tailscale/enable', wrap(async (req, res) => {
    res.json(await tailscaleStore.enable(req.body || {}));
  }));

  router.post('/tailscale/disable', wrap(async (_req, res) => {
    res.json(await tailscaleStore.disable());
  }));

  // ── /api/chat/regenerate ─────────────────────────────────────────────
  // v3.0.0: re-dispatches the last user message before messageId via POST /chat.
  // Full opencode re-dispatch lands in v3.1 when the plugin exposes a stable HTTP API.
  router.post('/chat/regenerate', wrap(async (req, res) => {
    const { sessionId, messageId } = req.body || {};
    if (!messageId) {
      res.status(400).json({ error: 'bad_request', message: 'messageId is required' });
      return;
    }
    const active = projectsStore.active();
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'no active project' });
      return;
    }
    const dir = projectsStore.ensureProjectDir(active.id);
    const sessionsDir = join(dir, 'sessions');
    if (!existsSync(sessionsDir)) {
      res.status(404).json({ error: 'not_found', message: 'no sessions found' });
      return;
    }
    const allFiles = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    const targetFiles = sessionId ? allFiles.filter((f) => f === `${sessionId}.jsonl`) : allFiles;
    if (!targetFiles.length) {
      res.status(404).json({ error: 'not_found', message: 'session not found' });
      return;
    }
    // Read the session file and find the last user message before messageId
    const full = join(sessionsDir, targetFiles[0]);
    let lastUserMessage = null;
    let foundTarget = false;
    try {
      const lines = readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          const msg = JSON.parse(lines[i]);
          if (msg.id === messageId || (messageId && String(msg.ts) === String(messageId))) {
            foundTarget = true;
            for (let j = i - 1; j >= 0; j--) {
              try {
                const prev = JSON.parse(lines[j]);
                if (prev.role === 'user') {
                  lastUserMessage = prev;
                  break;
                }
              } catch {
                /* skip */
              }
            }
            break;
          }
        } catch {
          /* skip */
        }
      }
    } catch (err) {
      res.status(500).json({ error: 'read_failed', message: err.message });
      return;
    }
    // Fallback: find last user message
    if (!lastUserMessage) {
      try {
        const lines = readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean).reverse();
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.role === 'user') {
              lastUserMessage = msg;
              break;
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!lastUserMessage) {
      res.status(404).json({ error: 'not_found', message: 'no user message found to regenerate' });
      return;
    }
    // Re-post via POST /chat (queued for agent processing)
    const record = {
      ts: new Date().toISOString(),
      role: 'user',
      agent: lastUserMessage.agent || null,
      model: lastUserMessage.model || null,
      content: lastUserMessage.content || lastUserMessage.message || '',
      attachments: lastUserMessage.attachments || [],
    };
    try {
      const lines = existsSync(full) ? readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean) : [];
      lines.push(JSON.stringify(record));
      writeFileSync(full, lines.join('\n') + '\n', 'utf8');
    } catch {
      /* best effort */
    }
    state.appendActivity({
      kind: 'chat.regenerate',
      agent: lastUserMessage.agent || null,
      message: (lastUserMessage.content || '').slice(0, 500),
    });
    broadcast({ type: 'chat:regenerate', message: record });
    res.status(202).json({ accepted: true, regeneratedMessage: record });
  }));

  // ── /api/plans (kept from v2.x) ───────────────────────────────────────
  router.get('/plans', wrap(async (_req, res) => {
    res.json({ plans: state.getPlans() });
  }));

  router.get('/plans/:slug', wrap(async (req, res) => {
    const slug = req.params.slug;
    const local = join(state.paths.plansDir, slug);
    const global = join(state.paths.globalPlansDir, slug);
    const dir = existsSync(local) ? local : existsSync(global) ? global : null;
    if (!dir) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const meta = safeReadJSON(join(dir, 'meta.json'), null);
    const planMdx = safeReadText(join(dir, 'plan.mdx'));
    res.json({ slug, dir, meta, planMdx });
  }));

  // ── /api/health ───────────────────────────────────────────────────────
  router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  router.use((req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: `no route for ${req.method} ${req.originalUrl}`,
    });
  });

  function buildSnapshot() {
    const cfg = safeReadJSON(OPENCODE_JSON, null);
    const active = projectsStore.active();
    return {
      overview: state.getOverview(),
      agents: agentsStore.list(),
      plans: state.getPlans(),
      projects: projectsStore.list().projects,
      activeProject: active,
      config: {
        path: OPENCODE_JSON,
        data: cfg,
        raw: cfg === null ? '' : JSON.stringify(cfg, null, 2),
        exists: existsSync(OPENCODE_JSON),
      },
      settings: readSettings(),
      tasks: active ? tasksStore.loadTasks(active.id) : [],
      mods: modsLoader.list(),
      schedules: active ? schedulesStore.list(active.id) : [],
      providers: providersStore.list(),
      mcps: mcpsStore.list(),
    };
  }

  return router;
}
