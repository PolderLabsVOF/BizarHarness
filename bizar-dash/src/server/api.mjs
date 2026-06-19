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
import { plansStore } from './plans-store.mjs';
import { skillsStore } from './skills-store.mjs';
import { notificationsStore } from './notifications-store.mjs';
import { updateStore } from './update-store.mjs';
import { pairStore } from './pair-store.mjs';

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
      version: '3.5.1',
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
  // Always use the package version — never let user settings override it
  merged.about.version = DEFAULT_SETTINGS.about.version;
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

  // v3.5.2 — Pair-token enrichment middleware. Does NOT block requests; the
  // dashboard itself is unauthenticated. This just tags requests with
  // req.pairToken / req.pairEntry so future handlers can recognize paired
  // companion clients and (later) scope them to a single project.
  router.use(pairStore.middleware);

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
  router.get('/tasks', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const includeArchived = req.query.archived === 'true' || req.query.archived === '1';
    const onlyArchived = req.query.archived === 'only' || req.query.archived === 'archived';
    res.json(tasksStore.loadTasks(projectId, { includeArchived, onlyArchived }));
  }));

  router.post('/tasks', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.create(projectId, req.body || {});
    broadcast({ type: 'tasks:change', task });
    res.status(201).json(task);
  }));

  // v3.2.0 — Odin task delegation. Splits the input into subtasks,
  // matches each to an agent, and dispatches them to the background
  // agent infrastructure (best-effort).
  router.post('/tasks/submit', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { taskDelegator } = await import('./task-delegator.mjs');
    try {
      const result = await taskDelegator.submit(req.body || {}, {
        projectRoot,
        projectId,
        state,
        broadcast,
      });
      res.status(201).json(result);
    } catch (err) {
      const status = err?.message?.includes('required') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? 'bad_request' : 'submission_failed',
        message: err?.message || String(err),
      });
    }
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
    if (!['queued', 'doing', 'done', 'blocked', 'archived'].includes(status)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid status' });
      return;
    }
    const task = await tasksStore.move(projectId, req.params.id, status);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    if (status === 'done' && task.recurring) {
      const next = await tasksStore.spawnNextRecurrence(projectId, task);
      if (next) broadcast({ type: 'tasks:change', task: next });
    }
    // v3.3.0 — Fire a notification on completion. The Tasks view
    // already paints the badge in real time via tasks:change; the
    // notification is the cross-tab history bit.
    if (status === 'done') {
      try {
        notificationsStore.add({
          severity: 'success',
          source: 'tasks',
          title: 'Task completed',
          message: task.title || task.id,
          meta: { taskId: task.id },
        }, { broadcast });
      } catch { /* best-effort */ }
    } else if (status === 'blocked') {
      try {
        notificationsStore.add({
          severity: 'warning',
          source: 'tasks',
          title: 'Task blocked',
          message: task.title || task.id,
          meta: { taskId: task.id },
        }, { broadcast });
      } catch { /* best-effort */ }
    }
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

  router.post('/tasks/:id/timer/start', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.startTimer(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/timer/stop', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.stopTimer(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // v3.1.0 — Archive / unarchive / bulk.
  router.post('/tasks/:id/archive', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.archive(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/unarchive', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.unarchive(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/bulk', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { ids, action, params } = req.body || {};
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'bad_request', message: 'ids[] required' });
      return;
    }
    const out = await tasksStore.bulk(projectId, ids, action, params || {});
    for (const r of out.affected) {
      if (!r.ok) continue;
      if (action === 'delete') {
        broadcast({ type: 'tasks:delete', id: r.id });
      } else {
        const all = await tasksStore.loadTasks(projectId, { includeArchived: true });
        const t = all.find((x) => x.id === r.id);
        if (t) broadcast({ type: 'tasks:change', task: t });
      }
    }
    res.json(out);
  }));

  // v3.1.0 — Mark a task as worked-on by an agent. Bumps both sides.
  router.post('/tasks/:id/work', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { agent, status, complete } = req.body || {};
    if (!agent) {
      res.status(400).json({ error: 'bad_request', message: 'agent is required' });
      return;
    }
    const task = await tasksStore.setWorkedBy(projectId, req.params.id, agent, { status, complete: !!complete });
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    let agentSnapshot = null;
    if (status === 'doing') {
      agentSnapshot = agentsStore.updateStatus(agent, 'working', task.id);
    } else if (status === 'done' || complete) {
      agentSnapshot = agentsStore.recordTaskResult(agent, task.id, complete !== false);
    } else {
      agentSnapshot = agentsStore.updateStatus(agent, 'idle', null);
    }
    if (agentSnapshot) broadcast({ type: 'agent:status', agent: agentSnapshot });
    broadcast({ type: 'tasks:change', task });
    if (task.recurring && status === 'done') {
      const next = await tasksStore.spawnNextRecurrence(projectId, task);
      if (next) broadcast({ type: 'tasks:change', task: next });
    }
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
  router.get('/schedules', wrap(async (req, res) => {
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

  // v3.1.0 — /api/agents/stuck must be defined BEFORE the /:name
  // catch-all or Express will treat "stuck" as an agent name.
  router.get('/agents/stuck', wrap(async (_req, res) => {
    res.json({ stuck: agentsStore.stuck() });
  }));

  // v3.2.0 — Agent hierarchy. Must be defined BEFORE /agents/:name
  // or Express will treat "hierarchy" as a name.
  router.get('/agents/hierarchy', wrap(async (_req, res) => {
    const { buildHierarchyTree } = await import('./agents-store.mjs');
    const agents = agentsStore.list();
    const tree = buildHierarchyTree(agents);
    res.json(tree);
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

  // v3.1.0 — Agent status (idle / working / error / stuck). The opencode
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

  router.delete('/agents/:name', wrap(async (req, res) => {
    const ok = agentsStore.delete(req.params.name);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agents:change' });
    res.status(204).end();
  }));

  // v3.2.0 — Agent hierarchy. Tree structure showing parent/child
  // reporting chains. (Mounted earlier, before /agents/:name — see
  // /agents/stuck above for the same pattern.)

  // ── /api/background (v3.2.0) ───────────────────────────────────────
  // Bridge to the plugin's background-agent infrastructure. Lists
  // active/in-flight bg instances, optionally attaches tmux hints,
  // and exposes a kill switch + message endpoint.
  router.get('/background', wrap(async (_req, res) => {
    const { backgroundStore } = await import('./background-store.mjs');
    const instances = backgroundStore.list();
    res.json({ instances, status: backgroundStore.status() });
  }));

  router.get('/background/:id', wrap(async (req, res) => {
    const { backgroundStore } = await import('./background-store.mjs');
    const inst = backgroundStore.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(inst);
  }));

  router.get('/background/:id/output', wrap(async (req, res) => {
    const { backgroundStore } = await import('./background-store.mjs');
    const lines = Math.min(500, Math.max(1, parseInt(req.query.lines || '50', 10) || 50));
    const result = backgroundStore.captureOutput(req.params.id, lines);
    res.json(result);
  }));

  router.post('/background/:id/message', wrap(async (req, res) => {
    const { backgroundStore } = await import('./background-store.mjs');
    const message = (req.body?.message || '').toString();
    if (!message.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'message required' });
      return;
    }
    const result = backgroundStore.sendMessage(req.params.id, message);
    res.json(result);
  }));

  router.delete('/background/:id', wrap(async (req, res) => {
    const { backgroundStore } = await import('./background-store.mjs');
    const result = backgroundStore.kill(req.params.id);
    if (!result.ok) {
      // 200 with ok:false is fine — the caller distinguishes via `ok`.
      res.json(result);
      return;
    }
    broadcast({ type: 'background:change', action: 'kill', id: req.params.id });
    res.json(result);
  }));

  // ── /api/activity (v3.2.0) ──────────────────────────────────────────
  // Append-only event log for the Activity tab + canvas-node details.
  router.get('/activity', wrap(async (req, res) => {
    const { activityLog } = await import('./activity-log.mjs');
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const kind = req.query.kind ? String(req.query.kind) : null;
    const nodeId = req.query.nodeId ? String(req.query.nodeId) : null;
    let events;
    if (nodeId) events = activityLog.forNode(nodeId, limit);
    else if (kind) events = activityLog.byKind(kind, limit);
    else events = activityLog.recent(limit);
    res.json({ events, stats: activityLog.stats() });
  }));

  router.post('/activity', wrap(async (req, res) => {
    const { activityLog } = await import('./activity-log.mjs');
    const event = req.body || {};
    if (!event.kind) {
      res.status(400).json({ error: 'bad_request', message: 'kind required' });
      return;
    }
    const record = activityLog.append(event);
    broadcast({ type: 'activity:change', event: record });
    res.status(201).json(record);
  }));

  // ── /api/history (v3.4.0) ────────────────────────────────────────────
  // Cross-project history view: aggregates activity log events with
  // per-project task / plan counts. Supports date filtering.
  router.get('/history', wrap(async (req, res) => {
    const { activityLog } = await import('./activity-log.mjs');
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));
    const sinceStr = req.query.since ? String(req.query.since) : null;
    const since = sinceStr ? new Date(sinceStr).getTime() : null;
    const events = activityLog.recent(limit)
      .filter((e) => {
        if (!since) return true;
        const t = new Date(e.ts).getTime();
        return Number.isFinite(t) && t >= since;
      })
      .reverse(); // oldest-first for timeline display

    // Per-project rollups
    const projectTasks = {};
    const projectPlans = {};
    const projects = projectsStore.list();
    for (const p of projects) {
      try {
        const tasks = tasksStore.loadTasks(p.id);
        projectTasks[p.id] = {
          total: tasks.length,
          done: tasks.filter((t) => t.status === 'done').length,
          doing: tasks.filter((t) => t.status === 'doing').length,
          blocked: tasks.filter((t) => t.status === 'blocked').length,
          queued: tasks.filter((t) => t.status === 'queued').length,
        };
      } catch {
        projectTasks[p.id] = { total: 0, done: 0, doing: 0, blocked: 0, queued: 0 };
      }
    }
    try {
      const plans = plansStore.list(projectRoot);
      for (const plan of plans) {
        const pid = plan.projectId || 'global';
        projectPlans[pid] = (projectPlans[pid] || 0) + 1;
      }
    } catch { /* best-effort */ }

    res.json({
      events,
      projects: projects.map((p) => ({
        ...p,
        tasks: projectTasks[p.id] || { total: 0, done: 0, doing: 0, blocked: 0, queued: 0 },
        plans: projectPlans[p.id] || 0,
      })),
      stats: activityLog.stats(),
      generatedAt: new Date().toISOString(),
    });
  }));

  // ── /api/comments (v3.2.0 — node-scoped, generic) ──────────────────
  // Comments on any node (agent, task, bg instance, etc.). Stored in
  // the activity log so they show up in the global stream and the
  // per-node drilldown.
  router.post('/comments', wrap(async (req, res) => {
    const { activityLog } = await import('./activity-log.mjs');
    const { nodeId, text, author } = req.body || {};
    if (!nodeId || !text) {
      res.status(400).json({ error: 'bad_request', message: 'nodeId and text required' });
      return;
    }
    const record = activityLog.append({
      kind: 'node.comment',
      nodeId,
      author: author || 'user',
      text: String(text).slice(0, 4000),
    });
    broadcast({ type: 'comment:new', comment: record });
    res.status(201).json(record);
  }));

  // v3.2.0 — Create a task from a canvas node (used by the Activity
  // tab to spin up follow-up tasks).
  router.post('/nodes/:nodeId/tasks', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { title, description, priority, assignee } = req.body || {};
    if (!title) {
      res.status(400).json({ error: 'bad_request', message: 'title required' });
      return;
    }
    const task = await tasksStore.create(projectId, {
      title,
      description: description || '',
      priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
      assignee: assignee || null,
      tags: [`node:${req.params.nodeId}`],
    });
    // Record in the activity log so it shows up under this node.
    try {
      const { activityLog } = await import('./activity-log.mjs');
      activityLog.append({
        kind: 'node.task',
        nodeId: req.params.nodeId,
        taskId: task.id,
        title: task.title,
      });
    } catch { /* best-effort */ }
    broadcast({ type: 'tasks:change', task });
    res.status(201).json(task);
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

  // ── /api/plans ───────────────────────────────────────────────────────
  router.get('/plans', wrap(async (_req, res) => {
    res.json({ plans: plansStore.list(projectRoot) });
  }));

  router.get('/plans/:slug', wrap(async (req, res) => {
    const plan = plansStore.get(req.params.slug, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(plan);
  }));

  // v3.1.0 — Full plan CRUD + canvas editing.
  router.post('/plans', wrap(async (req, res) => {
    const slug = (req.body?.slug || '').trim();
    try {
      const plan = plansStore.create(slug, req.body || {}, projectRoot);
      broadcast({ type: 'plan:change', slug });
      res.status(201).json(plan);
    } catch (err) {
      res.status(err.status || 500).json({ error: 'create_failed', message: err.message });
    }
  }));

  router.put('/plans/:slug', wrap(async (req, res) => {
    const plan = plansStore.updateMeta(req.params.slug, req.body || {}, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(plan);
  }));

  router.delete('/plans/:slug', wrap(async (req, res) => {
    const ok = plansStore.delete(req.params.slug, projectRoot);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug, deleted: true });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/canvas ──────────────────────────────────────────
  router.get('/plans/:slug/canvas', wrap(async (req, res) => {
    const canvas = plansStore.getCanvas(req.params.slug, projectRoot);
    if (!canvas) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ canvas });
  }));

  router.put('/plans/:slug/canvas', wrap(async (req, res) => {
    const plan = plansStore.saveCanvas(req.params.slug, req.body?.canvas, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(plan);
  }));

  // ── /api/plans/:slug/elements ────────────────────────────────────────
  router.post('/plans/:slug/elements', wrap(async (req, res) => {
    const out = plansStore.addElement(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.put('/plans/:slug/elements/:id', wrap(async (req, res) => {
    const out = plansStore.updateElement(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  router.delete('/plans/:slug/elements/:id', wrap(async (req, res) => {
    const out = plansStore.deleteElement(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/position — bulk update positions (drag end) ─────
  router.put('/plans/:slug/position', wrap(async (req, res) => {
    const out = plansStore.updatePositions(req.params.slug, req.body?.positions, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  // ── /api/plans/:slug/connections ─────────────────────────────────────
  router.post('/plans/:slug/connections', wrap(async (req, res) => {
    const out = plansStore.addConnection(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'from and to are required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/connections/:id', wrap(async (req, res) => {
    const out = plansStore.deleteConnection(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/elements/:id/comments ───────────────────────────
  router.post('/plans/:slug/elements/:id/comments', wrap(async (req, res) => {
    const out = plansStore.addComment(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/elements/:id/comments/:cid', wrap(async (req, res) => {
    const out = plansStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // Canvas-level comments (no elementId) — POST /plans/:slug/comments
  router.post('/plans/:slug/comments', wrap(async (req, res) => {
    const out = plansStore.addComment(req.params.slug, null, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/comments/:cid', wrap(async (req, res) => {
    const out = plansStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/updates (v3.3.3) ──────────────────────────────────────────
  router.get('/updates/status', wrap(async (_req, res) => {
    res.json({ current: updateStore.current() });
  }));

  router.get('/updates/check', wrap(async (_req, res) => {
    try {
      const current = updateStore.current();
      const latest = await updateStore.latest();
      res.json({
        current,
        latest,
        hasUpdates: updateStore.hasUpdates(current, latest),
      });
    } catch (err) {
      res.status(500).json({ error: 'check_failed', message: err.message });
    }
  }));

  router.post('/updates/apply', wrap(async (req, res) => {
    const packages = req.body?.packages || ['bizar', 'bizar-dash'];
    try {
      const result = await updateStore.apply({
        packages,
        broadcast: (msg) => {
          if (typeof broadcast === 'function') broadcast(msg);
        },
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'apply_failed', message: err.message });
    }
  }));

  // ── /api/health ───────────────────────────────────────────────────────
  router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // ── /api/skills ──────────────────────────────────────────────────────
  // v3.3.0 — `?category=foo` filters the list server-side. The
  // frontend uses this to power the collapsible categories view
  // (the old "all in one list" mode is now the default "Show all"
  // toggle in the UI).
  router.get('/skills', wrap(async (req, res) => {
    const skills = await skillsStore.list();
    let out = skills;
    if (req.query.category) {
      const wanted = String(req.query.category).toLowerCase();
      if (wanted !== 'all') {
        out = skills.filter((s) => (s.category || '').toLowerCase() === wanted);
      }
    }
    res.json({ skills: out, categories: skillsStore.CATEGORIES, total: skills.length });
  }));

  router.get('/skills/search', wrap(async (req, res) => {
    const q = (req.query.q || '').toString();
    const results = await skillsStore.search(q);
    res.json({ results, query: q, categories: skillsStore.CATEGORIES });
  }));

  router.post('/skills/install', wrap(async (req, res) => {
    const { name, source } = req.body || {};
    if (!name && !source) {
      res.status(400).json({ error: 'bad_request', message: 'name or source is required' });
      return;
    }
    try {
      const result = await skillsStore.install(name, source);
      broadcast({ type: 'skills:change' });
      res.status(202).json(result);
    } catch (err) {
      res.status(500).json({ error: 'install_failed', message: err.message });
    }
  }));

  router.post('/skills/:id/disable', wrap(async (req, res) => {
    const out = skillsStore.disable(req.params.id);
    broadcast({ type: 'skills:change' });
    res.json(out);
  }));

  router.post('/skills/:id/enable', wrap(async (req, res) => {
    const out = skillsStore.enable(req.params.id);
    broadcast({ type: 'skills:change' });
    res.json(out);
  }));

  // ── /api/notifications (v3.3.0) ────────────────────────────────────
  // Per-user notification stream. Backed by an append-only JSONL log
  // at ~/.config/bizar/notifications.jsonl. Read state is persisted
  // separately at notifications.read.json.
  router.get('/notifications', wrap(async (req, res) => {
    const unread = req.query.unread === 'true' || req.query.unread === '1';
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10) || 200));
    const items = notificationsStore.list({ unread, limit });
    res.json({ notifications: items, stats: notificationsStore.stats() });
  }));

  router.post('/notifications/:id/read', wrap(async (req, res) => {
    const ok = notificationsStore.markRead(req.params.id);
    res.json({ ok });
  }));

  router.post('/notifications/read-all', wrap(async (_req, res) => {
    const marked = notificationsStore.markAllRead();
    broadcast({ type: 'notifications:change' });
    res.json({ ok: true, marked });
  }));

  router.delete('/notifications/:id', wrap(async (req, res) => {
    const ok = notificationsStore.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // ── /api/themes (v3.3.0) ───────────────────────────────────────────
  // Named custom themes. The active theme lives in settings.json as
  // before; this is the registry of saved themes the user can apply
  // with one click.
  router.get('/themes', wrap(async (_req, res) => {
    res.json(state.getThemes());
  }));

  router.post('/themes', wrap(async (req, res) => {
    const { name, colors } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'name is required' });
      return;
    }
    if (!colors || typeof colors !== 'object') {
      res.status(400).json({ error: 'bad_request', message: 'colors object is required' });
      return;
    }
    const out = state.addTheme(name.trim().slice(0, 60), colors);
    res.status(201).json(out);
  }));

  router.delete('/themes/:name', wrap(async (req, res) => {
    const out = state.removeTheme(decodeURIComponent(req.params.name));
    if (!out.removed) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // ── /api/activity/session (v3.3.0) ────────────────────────────────
  // Returns activity events scoped to the "current session". A
  // session is the most recent hour of activity, or — if the
  // caller provides `?since=<iso>` — the events since that
  // timestamp. Used by the Activity tab to drive the new
  // "session timeline" view.
  router.get('/activity/session', wrap(async (req, res) => {
    const { activityLog } = await import('./activity-log.mjs');
    const sinceParam = req.query.since ? new Date(String(req.query.since)) : null;
    const sinceTs = sinceParam && !Number.isNaN(sinceParam.getTime())
      ? sinceParam.getTime()
      : Date.now() - 60 * 60 * 1000; // 1h default
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10) || 200));
    const recent = activityLog.recent(limit * 4);
    const events = recent
      .filter((e) => {
        const t = e.ts ? new Date(e.ts).getTime() : 0;
        return t >= sinceTs;
      })
      .slice(0, limit);
    // Group events by "agent involved" — the agent name, when
    // available, lives in `agent`, `actor`, `assignee`, or
    // `nodeId="agent:<name>"`. The Activity canvas uses this to
    // filter the graph down to session participants.
    const agents = new Set();
    for (const e of events) {
      if (typeof e.agent === 'string') agents.add(e.agent);
      if (typeof e.assignee === 'string') agents.add(e.assignee);
      if (typeof e.actor === 'string') agents.add(e.actor);
      if (typeof e.nodeId === 'string' && e.nodeId.startsWith('agent:')) {
        agents.add(e.nodeId.slice('agent:'.length));
      }
      if (typeof e.taskId && e.subtaskIds) {
        // task.delegated event — has subtaskIds
      }
    }
    res.json({
      events,
      since: new Date(sinceTs).toISOString(),
      agents: Array.from(agents),
      stats: activityLog.stats(),
    });
  }));

  // ── /api/plans/:slug/questions/:qid/respond (v3.3.0) ──────────────
  // Agent-side integration for the question element: an agent posts
  // a question via the plan's canvas; the user clicks a choice in
  // the dashboard, this endpoint records the choice, marks the
  // question resolved, and broadcasts the answer so the agent
  // (when its plugin is updated) can pick it up.
  router.post('/plans/:slug/questions/:qid/respond', wrap(async (req, res) => {
    const { choiceId, text } = req.body || {};
    const out = plansStore.respondToQuestion(
      req.params.slug,
      req.params.qid,
      { choiceId, text },
      projectRoot,
    );
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Also drop a notification so the agent can re-poll.
    try {
      notificationsStore.add({
        severity: 'info',
        source: 'plan',
        title: `Plan: ${req.params.slug}`,
        message: `Question answered: choice=${choiceId || 'freeform'}`,
        link: `/plans/${req.params.slug}`,
        meta: { slug: req.params.slug, qid: req.params.qid, choiceId, text },
      }, { broadcast });
    } catch { /* best-effort */ }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  // ── /api/tasks/:id/progress (v3.3.0) ───────────────────────────────
  // Task progress updates from agents. Updates the in-store
  // metadata.progress + metadata.currentStep and broadcasts a WS
  // event so the Tasks view can paint the progress bar in real
  // time.
  router.post('/tasks/:id/progress', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { progress, step, agent } = req.body || {};
    const task = await tasksStore.updateProgress(projectId, req.params.id, {
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      step: typeof step === 'string' ? step.slice(0, 200) : null,
      agent: typeof agent === 'string' ? agent.slice(0, 60) : null,
    });
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'task:progress', taskId: task.id, progress: task.metadata?.progress, step: task.metadata?.currentStep, agent: task.metadata?.progressAgent });
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // ── /api/pair — companion-app pairing (v3.5.2) ──────────────────────────
  // Mint a short-lived token the Bizar Companion app can use as a Bearer
  // header. The companion scans a QR containing the URL + token, calls
  // /api/pair/verify to confirm, then stores the credentials in
  // expo-secure-store.
  router.post('/pair/start', wrap(async (req, res) => {
    const port = req.app?.get('port') || (req.socket?.server?.address()?.port) || 4321;
    const publicUrl = pairStore.detectPublicUrl(req, port);
    const ttlMs = Math.max(30_000, Math.min(15 * 60 * 1000, Number(req.body?.ttlMs) || 5 * 60 * 1000));
    const entry = pairStore.mint(publicUrl, ttlMs);
    state.appendActivity({ kind: 'pair.start', publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
    broadcast({ type: 'pair:change', publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
    res.json({
      token: entry.token,
      qrPayload: entry.qrPayload,
      publicUrl: entry.publicUrl,
      expiresAt: entry.expiresAt,
    });
  }));

  // Used by the companion right after scanning the QR to confirm the token
  // works before persisting it. Returns { valid: true } on success, 401
  // { error: 'expired' | 'no_token' } on failure.
  router.get('/pair/verify', wrap(async (req, res) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'no_token', message: 'missing Authorization: Bearer' });
      return;
    }
    const token = auth.slice(7).trim();
    const entry = pairStore.verify(token);
    if (!entry) {
      res.status(401).json({ error: 'expired', message: 'pair token invalid or expired' });
      return;
    }
    res.json({ valid: true, publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
  }));

  // Lightweight introspection — useful for the Settings card and the TUI
  // to show "X tokens active". Always returns { active: <count> }.
  router.get('/pair/status', wrap(async (_req, res) => {
    res.json({ active: pairStore._size() });
  }));

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
