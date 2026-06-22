/**
 * src/server/routes/config.mjs
 *
 * /api/config                           — read ~/.config/opencode/opencode.json
 * /api/config (PUT)                     — write opencode.json
 * /api/config/reload (POST)             — re-read
 * /api/config/providers                 — list providers
 * /api/config/providers (POST)          — add
 * /api/config/providers/:id (PUT)       — update
 * /api/config/providers/:id (DELETE)    — remove
 * /api/config/mcps                      — list MCP servers
 * /api/config/mcps (POST)               — add
 * /api/config/mcps/:id (PUT)            — update
 * /api/config/mcps/:id (DELETE)         — remove
 *
 * Two stores are involved: the on-disk opencode.json (read+write)
 * and the providersStore/mcpsStore in-memory registries. /api/config
 * is the former; /api/config/providers and /api/config/mcps are
 * the latter. /api/providers (without the config/ prefix) is the
 * dashboard's aggregated provider list and lives in providers.mjs.
 */
import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { providersStore, mcpsStore } from '../providers-store.mjs';
import { OPENCODE_JSON, atomicWriteJson, safeReadJSON, wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.watcher
 * @returns {import('express').Router}
 */
export function createConfigRouter({ state, watcher }) {
  const router = Router();

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
    atomicWriteJson(OPENCODE_JSON, parsed);
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

  return router;
}
