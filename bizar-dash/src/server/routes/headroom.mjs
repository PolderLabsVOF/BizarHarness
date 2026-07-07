/**
 * src/server/routes/headroom.mjs
 *
 * v1.0.0 — REST endpoints for Headroom management.
 *
 * Mounted at /api/headroom/* by api.mjs.
 */
import { Router } from 'express';
import {
  getHeadroomStatus,
  getHeadroomStats,
  installHeadroom,
  wrapCline,
  unwrapCline,
  startProxy,
  stopProxy,
  getClineConfig,
  headroomStartupHook,
} from '../headroom.mjs';
import { wrap } from './_shared.mjs';

export function createHeadroomRouter() {
  const router = Router();

  // GET /api/headroom/status
  router.get('/status', wrap(async (_req, res) => {
    const status = await getHeadroomStatus();
    res.json(status);
  }));

  // GET /api/headroom/stats?hours=24
  router.get('/stats', wrap(async (req, res) => {
    const hours = Math.max(1, Math.min(parseInt(req.query.hours, 10) || 24, 720));
    const stats = await getHeadroomStats({ hours });
    res.json(stats);
  }));

  // POST /api/headroom/install
  router.post('/install', wrap(async (req, res) => {
    const { force = false } = req.body || {};
    const result = await installHeadroom({ force: Boolean(force) });
    res.json(result);
  }));

  // POST /api/headroom/wrap
  router.post('/wrap', wrap(async (req, res) => {
    const { port } = req.body || {};
    const result = await wrapCline({
      port: port ? Math.max(1, Math.min(parseInt(port, 10), 65535)) : 8787,
    });
    res.json(result);
  }));

  // POST /api/headroom/unwrap
  router.post('/unwrap', wrap(async (_req, res) => {
    const result = await unwrapCline();
    res.json(result);
  }));

  // POST /api/headroom/proxy/start
  router.post('/proxy/start', wrap(async (req, res) => {
    const { port, host } = req.body || {};
    const result = await startProxy({
      port: port ? Math.max(1, Math.min(parseInt(port, 10), 65535)) : 8787,
      host: typeof host === 'string' && host ? host : '127.0.0.1',
    });
    res.json(result);
  }));

  // POST /api/headroom/proxy/stop
  router.post('/proxy/stop', wrap(async (_req, res) => {
    const result = await stopProxy();
    res.json(result);
  }));

  // GET /api/headroom/cline-config
  router.get('/cline-config', wrap(async (_req, res) => {
    const config = await getClineConfig();
    res.json(config);
  }));

  // POST /api/headroom/auto-route — configure all providers to route through Headroom
  router.post('/auto-route', wrap(async (_req, res) => {
    const { loadConfig, saveConfig } = await import('../providers-store.mjs');
    const cfg = loadConfig();
    const headroomPort = 8787;
    const proxyUrl = `http://127.0.0.1:${headroomPort}/v1`;

    // For each provider, prepend the headroom proxy URL to baseURL
    const providers = cfg.provider || {};
    let changed = 0;
    for (const [id, p] of Object.entries(providers)) {
      if (!p || typeof p !== 'object') continue;
      const baseURL = p.baseURL || p.options?.baseURL || '';
      // Only update if not already routed
      if (baseURL && !baseURL.includes('127.0.0.1:8787') && !baseURL.includes('localhost:8787')) {
        const newBaseURL = `${proxyUrl}/${baseURL.replace(/^https?:\/\//, '')}`;
        if (p.options) {
          providers[id] = { ...p, options: { ...p.options, baseURL: newBaseURL } };
        } else {
          providers[id] = { ...p, baseURL: newBaseURL };
        }
        changed++;
      }
    }
    cfg.provider = providers;
    saveConfig(cfg);

    res.json({ ok: true, changed, message: `Updated ${changed} provider(s) to route through Headroom proxy.` });
  }));

  // POST /api/headroom/startup-hook — trigger the startup hook programmatically
  router.post('/startup-hook', wrap(async (_req, res) => {
    const { readSettings } = await import('./_shared.mjs');
    const settings = readSettings();
    const headroomSettings = settings?.data?.headroom;
    if (!headroomSettings) {
      res.status(400).json({ error: 'bad_request', message: 'Headroom settings not found in settings.json' });
      return;
    }
    const result = await headroomStartupHook(headroomSettings);
    res.json(result);
  }));

  return router;
}
