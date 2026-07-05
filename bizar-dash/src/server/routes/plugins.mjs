/**
 * src/server/routes/plugins.mjs
 *
 * v5.0.0 — Plugin marketplace REST surface.
 *
 *   GET    /api/plugins/registry?q=&category=&tag=
 *                                             — search the public registry
 *   GET    /api/plugins/registry/:id          — get one plugin's details
 *   GET    /api/plugins/installed             — list installed plugins
 *   POST   /api/plugins/install               — install from registry
 *         body { pluginId, force? }
 *   DELETE /api/plugins/:id                   — uninstall
 *   PUT    /api/plugins/:id                   — update OR set config
 *         body { action: 'update' | 'config', config? }
 *   POST   /api/plugins/:id/invoke            — invoke a method in the sandbox
 *         body { method, args? }
 *
 * Express-ordering note: /registry and /installed must come BEFORE the
 * `:id` wildcard routes so Express doesn't match "registry" as an id.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';
import * as registry from '../plugins/registry.mjs';
import * as store from '../plugins/store.mjs';

/**
 * @returns {import('express').Router}
 */
export function createPluginsRouter() {
  const router = Router();

  // ── GET /api/plugins/registry?q=&category=&tag= ──────────────────────
  router.get('/plugins/registry', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    try {
      const plugins = await registry.searchPlugins(q, { category, tag });
      // Annotate each entry with installed flag for the UI.
      const installed = new Map(store.listInstalled().map((p) => [p.id, p]));
      res.json({
        registry: {
          source: registry.getRegistryUrl(),
          updatedAt: null, // populated only on a full fetchRegistry; ok to be null here
        },
        plugins: plugins.map((p) => {
          const local = installed.get(p.id);
          return {
            ...p,
            installed: !!local,
            installedVersion: local ? local.version : null,
            upgradeAvailable:
              local && local.version !== p.version ? p.version : null,
          };
        }),
      });
    } catch (err) {
      const status = err.code === 'registry_unreachable' ? 502 : 500;
      res.status(status).json({
        error: err.code || 'registry_error',
        message: err.message,
        registryUrl: registry.getRegistryUrl(),
      });
    }
  }));

  // ── GET /api/plugins/registry/:id ────────────────────────────────────
  router.get('/plugins/registry/:id', wrap(async (req, res) => {
    try {
      const plugin = await registry.getPlugin(req.params.id);
      if (!plugin) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const local = store.getInstalled(plugin.id);
      res.json({
        ...plugin,
        installed: !!local,
        installedVersion: local ? local.version : null,
        upgradeAvailable:
          local && local.version !== plugin.version ? plugin.version : null,
      });
    } catch (err) {
      const status = err.code === 'registry_unreachable' ? 502 : 500;
      res.status(status).json({
        error: err.code || 'registry_error',
        message: err.message,
      });
    }
  }));

  // ── GET /api/plugins/installed ───────────────────────────────────────
  router.get('/plugins/installed', wrap(async (_req, res) => {
    res.json({ plugins: store.listInstalled() });
  }));

  // ── POST /api/plugins/install ────────────────────────────────────────
  router.post('/plugins/install', wrap(async (req, res) => {
    const pluginId = req.body?.pluginId || req.body?.id;
    if (!pluginId || typeof pluginId !== 'string') {
      res.status(400).json({
        error: 'bad_request',
        message: 'pluginId is required',
      });
      return;
    }
    const force = !!req.body?.force;
    try {
      const installed = await store.installPlugin(pluginId, { force });
      res.status(201).json(installed);
    } catch (err) {
      const map = {
        not_found: 404,
        already_installed: 409,
        checksum_mismatch: 422,
        download_failed: 502,
        bad_manifest: 422,
      };
      const status = map[err.code] || 500;
      res.status(status).json({
        error: err.code || 'install_failed',
        message: err.message,
      });
    }
  }));

  // ── PUT /api/plugins/:id (update OR set config) ──────────────────────
  router.put('/plugins/:id', wrap(async (req, res) => {
    const action = req.body?.action;
    if (action === 'update') {
      try {
        const result = await store.updatePlugin(req.params.id);
        res.json({
          ok: true,
          from: result.from,
          to: result.to,
          plugin: result.plugin,
        });
      } catch (err) {
        const status = err.code === 'not_installed' ? 404 : 500;
        res.status(status).json({
          error: err.code || 'update_failed',
          message: err.message,
        });
      }
      return;
    }
    if (action === 'config') {
      const config = req.body?.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        res.status(400).json({
          error: 'bad_request',
          message: 'config must be an object',
        });
        return;
      }
      try {
        const updated = store.replaceConfig(req.params.id, config);
        res.json(updated);
      } catch (err) {
        const status = err.code === 'not_installed' ? 404 : 400;
        res.status(status).json({
          error: err.code || 'config_failed',
          message: err.message,
        });
      }
      return;
    }
    res.status(400).json({
      error: 'bad_request',
      message: 'action must be "update" or "config"',
    });
  }));

  // ── DELETE /api/plugins/:id ──────────────────────────────────────────
  router.delete('/plugins/:id', wrap(async (req, res) => {
    const ok = store.uninstallPlugin(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // ── POST /api/plugins/:id/invoke ─────────────────────────────────────
  router.post('/plugins/:id/invoke', wrap(async (req, res) => {
    const method = req.body?.method;
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    if (!method || typeof method !== 'string') {
      res.status(400).json({
        error: 'bad_request',
        message: 'method (string) is required',
      });
      return;
    }
    const timeoutMs = Number.isFinite(req.body?.timeoutMs)
      ? req.body.timeoutMs
      : undefined;
    const result = await store.invokePlugin(req.params.id, method, args, {
      timeoutMs,
    });
    if (result.ok) {
      res.json(result);
      return;
    }
    // Distinguish "this is a plugin bug" (500) from "this is a usage
    // error" (400/404) so the client can decide whether to retry.
    const usageCodes = new Set([
      'not_installed',
      'no_such_method',
      'bad_manifest',
      'permission_denied',
      'corrupt_install',
    ]);
    const status = usageCodes.has(result.code) ? 400 : 500;
    res.status(status).json(result);
  }));

  return router;
}