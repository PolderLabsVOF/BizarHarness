/**
 * cli/dashboard/api.mjs
 *
 * REST surface for the dashboard. Every route:
 *   - Returns JSON
 *   - Returns { error, message } with appropriate status on failure
 *   - Never throws to Express — every handler is wrapped in try/catch
 *
 * The router is mounted at /api/* by cli/dashboard/server.mjs.
 */
import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createTask, updateTask, deleteTask, moveTask } from './tasks-store.mjs';

/**
 * @param {object} deps
 * @param {ReturnType<import('./state.mjs').createState>} deps.state
 * @param {ReturnType<import('./watcher.mjs').createWatcher>} deps.watcher
 * @param {string} deps.projectRoot
 * @param {string} deps.opencodeConfigDir
 * @param {string} deps.bizarRoot
 * @param {function} deps.broadcast - WS broadcast function ({ type, ... }) => void
 */
export function createApiRouter({
  state,
  watcher,
  projectRoot,
  opencodeConfigDir,
  bizarRoot,
  broadcast = () => {},
}) {
  const router = express.Router();

  /** Safe async handler — never throws past Express. */
  const wrap =
    (fn) =>
    async (req, res, ...rest) => {
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

  // ── /api/overview ──────────────────────────────────────────────────────────
  router.get('/overview', wrap(async (_req, res) => {
    res.json(state.getOverview());
  }));

  // ── /api/chat ──────────────────────────────────────────────────────────────
  router.get('/chat', wrap(async (req, res) => {
    const sessionId = req.query.session
      ? String(req.query.session)
      : null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json(state.getChat({ sessionId, limit }));
  }));

  router.post('/chat', wrap(async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const agent = typeof body.agent === 'string' ? body.agent : null;
    if (!message) {
      res.status(400).json({
        error: 'bad_request',
        message: 'message is required',
      });
      return;
    }
    state.appendActivity({
      kind: 'chat.message',
      agent,
      message: message.slice(0, 500),
    });
    res.status(202).json({
      accepted: true,
      agent,
      queued: true,
      note:
        'Live agent dispatch runs in the opencode TUI; the dashboard ' +
        'records and broadcasts the message. Open the TUI to dispatch it.',
    });
  }));

  // ── /api/agents ────────────────────────────────────────────────────────────
  router.get('/agents', wrap(async (_req, res) => {
    const agents = state.getAgents();
    res.json({ agents });
  }));

  router.post(
    '/agents/:name/invoke',
    wrap(async (req, res) => {
      const name = req.params.name;
      const prompt = (req.body && req.body.prompt) || '';
      if (!prompt.trim()) {
        res.status(400).json({
          error: 'bad_request',
          message: 'prompt is required',
        });
        return;
      }
      state.appendActivity({
        kind: 'agent.invoke',
        agent: name,
        prompt: String(prompt).slice(0, 500),
      });
      res.status(202).json({
        accepted: true,
        agent: name,
        note:
          'Agent dispatch is forwarded to the opencode TUI. The dashboard ' +
          'records the invocation for the activity feed.',
      });
    }),
  );

  // ── /api/plans ─────────────────────────────────────────────────────────────
  router.get('/plans', wrap(async (_req, res) => {
    res.json({ plans: state.getPlans() });
  }));

  router.post('/plans', wrap(async (req, res) => {
    const slug = req.body?.slug;
    const title = req.body?.title || slug;
    if (
      typeof slug !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)
    ) {
      res.status(400).json({
        error: 'bad_request',
        message:
          'slug must match ^[a-z0-9][a-z0-9-]{0,63}$',
      });
      return;
    }
    const plansDir = state.paths.plansDir;
    const target = join(plansDir, slug);
    if (existsSync(target)) {
      res.status(409).json({
        error: 'exists',
        message: `plan "${slug}" already exists`,
      });
      return;
    }
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'meta.json'),
      JSON.stringify(
        {
          slug,
          title,
          status: 'draft',
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    state.appendActivity({ kind: 'plan.create', slug, title });
    watcher.poke('change', target);
    res.status(201).json({ slug, title, path: target });
  }));

  router.get('/plans/:slug', wrap(async (req, res) => {
    const slug = req.params.slug;
    const local = join(state.paths.plansDir, slug);
    const global = join(state.paths.globalPlansDir, slug);
    const dir = existsSync(local) ? local : existsSync(global) ? global : null;
    if (!dir) {
      res.status(404).json({
        error: 'not_found',
        message: `plan "${slug}" not found`,
      });
      return;
    }
    const meta = readMeta(join(dir, 'meta.json'));
    const planMdx = readMaybe(join(dir, 'plan.mdx'));
    res.json({
      slug,
      dir,
      meta,
      planMdx,
    });
  }));

  router.get('/plans/:slug/canvas', wrap(async (req, res) => {
    const slug = req.params.slug;
    const local = join(state.paths.plansDir, slug);
    const global = join(state.paths.globalPlansDir, slug);
    const dir = existsSync(local) ? local : existsSync(global) ? global : null;
    if (!dir) {
      res.status(404).json({
        error: 'not_found',
        message: `plan "${slug}" not found`,
      });
      return;
    }
    const planJson = join(dir, 'plan.json');
    const canvas = readMaybe(planJson);
    if (canvas === null) {
      res.json({
        slug,
        dir,
        canvas: {
          schemaVersion: 2,
          title: slug,
          elements: [],
          connections: [],
          comments: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
      return;
    }
    try {
      res.json({
        slug,
        dir,
        canvas: JSON.parse(canvas),
      });
    } catch {
      res.json({
        slug,
        dir,
        canvas: {
          schemaVersion: 2,
          title: slug,
          elements: [],
          connections: [],
          comments: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
    }
  }));

  router.put('/plans/:slug', wrap(async (req, res) => {
    const slug = req.params.slug;
    const local = join(state.paths.plansDir, slug);
    const global = join(state.paths.globalPlansDir, slug);
    const dir = existsSync(local) ? local : existsSync(global) ? local : null;
    if (!dir) {
      res.status(404).json({
        error: 'not_found',
        message: `plan "${slug}" not found`,
      });
      return;
    }
    const body = req.body || {};
    if (!body || typeof body !== 'object') {
      res.status(400).json({
        error: 'bad_request',
        message: 'body must be an object',
      });
      return;
    }
    if (body.meta && typeof body.meta === 'object') {
      const existing = readMeta(join(dir, 'meta.json')) || {};
      const merged = { ...existing, ...body.meta, updatedAt: new Date().toISOString() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify(merged, null, 2) + '\n',
        'utf8',
      );
    }
    if (typeof body.planMdx === 'string') {
      writeFileSync(join(dir, 'plan.mdx'), body.planMdx, 'utf8');
    }
    state.appendActivity({ kind: 'plan.update', slug });
    watcher.poke('change', dir);
    res.json({ ok: true, slug });
  }));

  // ── /api/projects ──────────────────────────────────────────────────────────
  router.get('/projects', wrap(async (_req, res) => {
    res.json({ projects: state.getProjects() });
  }));

  router.post(
    '/projects/:name/activate',
    wrap(async (req, res) => {
      const name = req.params.name;
      const projects = state.getProjects();
      const target = projects.find((p) => p.name === name);
      if (!target) {
        res.status(404).json({
          error: 'not_found',
          message: `project "${name}" not found`,
        });
        return;
      }
      state.appendActivity({
        kind: 'project.activate',
        name,
        path: target.path,
      });
      res.json({
        activated: name,
        path: target.path,
        note:
          'The dashboard exposes the project; the opencode TUI must be ' +
          'restarted in the new directory to fully activate.',
      });
    }),
  );

  // ── /api/config ────────────────────────────────────────────────────────────
  router.get('/config', wrap(async (_req, res) => {
    res.json(state.getConfig());
  }));

  router.put('/config', wrap(async (req, res) => {
    const body = req.body;
    let parsed;
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        res.status(400).json({
          error: 'invalid_json',
          message: err.message,
        });
        return;
      }
    } else if (body && typeof body === 'object') {
      parsed = body;
    } else {
      res.status(400).json({
        error: 'bad_request',
        message: 'body must be a JSON object or string',
      });
      return;
    }
    const updated = state.setConfig(parsed);
    state.appendActivity({ kind: 'config.update' });
    watcher.poke('change', state.paths.opencodeJson);
    res.json(updated);
  }));

  router.post('/config/reload', wrap(async (_req, res) => {
    const snapshot = state.getConfig();
    state.appendActivity({ kind: 'config.reload' });
    res.json(snapshot);
  }));

  // ── /api/settings ──────────────────────────────────────────────────────────
  router.get('/settings', wrap(async (_req, res) => {
    res.json(state.getSettings());
  }));

  router.put('/settings', wrap(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({
        error: 'bad_request',
        message: 'body must be an object',
      });
      return;
    }
    const updated = state.setSettings(body);
    state.appendActivity({ kind: 'settings.update' });
    res.json(updated);
  }));

  // ── /api/tasks ────────────────────────────────────────────────────────────
  router.get('/tasks', wrap(async (_req, res) => {
    res.json(state.getTasks());
  }));

  router.post('/tasks', wrap(async (req, res) => {
    const { title, description, status, tags, priority } = req.body || {};
    if (!title || typeof title !== 'string' || title.length > 200) {
      res.status(400).json({ error: 'bad_request', message: 'title required (1-200 chars)' });
      return;
    }
    const task = await createTask({ title, description, status, tags, priority });
    broadcast({ type: 'tasks:change', task });
    res.status(201).json(task);
  }));

  router.put('/tasks/:id', wrap(async (req, res) => {
    const task = await updateTask(req.params.id, req.body || {});
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.patch('/tasks/:id/status', wrap(async (req, res) => {
    const { status } = req.body || {};
    if (!['queued', 'doing', 'done'].includes(status)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid status' });
      return;
    }
    const task = await moveTask(req.params.id, status);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.delete('/tasks/:id', wrap(async (req, res) => {
    const ok = await deleteTask(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:delete', id: req.params.id });
    res.status(204).end();
  }));

  // ── health ────────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // ── fallback ──────────────────────────────────────────────────────────────
  router.use((req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: `no route for ${req.method} ${req.originalUrl}`,
    });
  });

  return router;
}

function readMeta(file) {
  try {
    if (!existsSync(file)) return null;
    const txt = readFileSync(file, 'utf8');
    if (!txt.trim()) return null;
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function readMaybe(file) {
  try {
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
