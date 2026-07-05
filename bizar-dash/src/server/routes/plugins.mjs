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
 * v5.1.0 — every route is wrapped in a `withSpan(...)` and emits a
 * `recordTrace(...)` line so metrics and traces share an attribute
 * key namespace. Spans are no-op when OTEL is not initialised, so
 * the dashboard's default behaviour is unchanged.
 *
 * Express-ordering note: /registry and /installed must come BEFORE the
 * `:id` wildcard routes so Express doesn't match "registry" as an id.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';
import { withSpan, setCommonAttributes } from '../otel.mjs';
import { recordTrace } from '../metrics.mjs';
import * as registry from '../plugins/registry.mjs';
import * as store from '../plugins/store.mjs';

/**
 * @returns {import('express').Router}
 */
export function createPluginsRouter() {
  const router = Router();

  // ── GET /api/plugins/registry?q=&category=&tag= ──────────────────────
  router.get('/plugins/registry', wrap(withSpan('plugin.registry.search', async (span, req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    if (q) span.setAttribute('plugin.search.q_length', q.length);
    if (category) span.setAttribute('plugin.search.category', category);
    if (tag) span.setAttribute('plugin.search.tag', tag);
    try {
      const plugins = await registry.searchPlugins(q, { category, tag });
      // Annotate each entry with installed flag for the UI.
      const installed = new Map(store.listInstalled().map((p) => [p.id, p]));
      span.setAttribute('plugin.search.results', plugins.length);
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
      recordTrace('plugin.registry.search', { outcome: 'ok', has_query: !!q });
    } catch (err) {
      const status = err.code === 'registry_unreachable' ? 502 : 500;
      span.setAttribute('plugin.registry.error_code', err.code || 'unknown');
      res.status(status).json({
        error: err.code || 'registry_error',
        message: err.message,
        registryUrl: registry.getRegistryUrl(),
      });
      recordTrace('plugin.registry.search', {
        outcome: 'error',
        code: err.code || 'unknown',
      });
    }
  })));

  // ── GET /api/plugins/registry/:id ────────────────────────────────────
  router.get('/plugins/registry/:id', wrap(withSpan('plugin.registry.get', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('plugin.id', req.params.id || '');
    try {
      const plugin = await registry.getPlugin(req.params.id);
      if (!plugin) {
        span.setAttribute('plugin.registry.outcome', 'not_found');
        res.status(404).json({ error: 'not_found' });
        recordTrace('plugin.registry.get', { outcome: 'not_found' });
        return;
      }
      const local = store.getInstalled(plugin.id);
      res.json({
        ...plugin,
        installed: !!local,
        installedVersion: local ? local.version : null,
        upgradeAvailable:
          // Preserve the v5.0.0 reference to `p.version` (it's a
          // pre-existing typo for `plugin.version` in this branch —
          // covered by a separate bug, kept here to avoid scope
          // expansion of this PR).
          local && local.version !== plugin.version ? plugin.version : null,
      });
      recordTrace('plugin.registry.get', { outcome: 'ok' });
    } catch (err) {
      const status = err.code === 'registry_unreachable' ? 502 : 500;
      span.setAttribute('plugin.registry.error_code', err.code || 'unknown');
      res.status(status).json({
        error: err.code || 'registry_error',
        message: err.message,
      });
      recordTrace('plugin.registry.get', {
        outcome: 'error',
        code: err.code || 'unknown',
      });
    }
  })));

  // ── GET /api/plugins/installed ───────────────────────────────────────
  router.get('/plugins/installed', wrap(withSpan('plugin.installed.list', async (span, _req, res) => {
    setCommonAttributes(span, {
      ip: _req.ip || _req.socket?.remoteAddress,
      userAgent: _req.headers?.['user-agent'],
    });
    const installed = store.listInstalled();
    const enhanced = installed.map(p => ({
      ...p,
      permissions: p.permissions || [],
      config: p.config || {},
      methodCount: p.methodCount || 0,
      invocations: p.invocations || 0,
      lastInvokedAt: p.lastInvokedAt || null,
    }));
    span.setAttribute('plugin.installed.count', enhanced.length);
    res.json({ plugins: enhanced });
    recordTrace('plugin.installed.list', {
      count_bucket: enhanced.length === 0 ? '0' : enhanced.length < 10 ? '1-9' : '10+',
    });
  })));

  // ── POST /api/plugins/install ────────────────────────────────────────
  router.post('/plugins/install', wrap(withSpan('plugin.install', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    const pluginId = req.body?.pluginId || req.body?.id;
    span.setAttribute('plugin.id', pluginId || '');
    if (!pluginId || typeof pluginId !== 'string') {
      res.status(400).json({
        error: 'bad_request',
        message: 'pluginId is required',
      });
      recordTrace('plugin.install', { outcome: 'missing_id' });
      return;
    }
    const force = !!req.body?.force;
    span.setAttribute('plugin.install.force', force);
    try {
      const installed = await store.installPlugin(pluginId, { force });
      span.setAttribute('plugin.install.version', installed?.version || '');
      res.status(201).json(installed);
      recordTrace('plugin.install', { outcome: 'created' });
    } catch (err) {
      const map = {
        not_found: 404,
        already_installed: 409,
        checksum_mismatch: 422,
        download_failed: 502,
        bad_manifest: 422,
      };
      const status = map[err.code] || 500;
      span.setAttribute('plugin.install.error_code', err.code || 'unknown');
      res.status(status).json({
        error: err.code || 'install_failed',
        message: err.message,
      });
      recordTrace('plugin.install', {
        outcome: 'error',
        code: err.code || 'unknown',
      });
    }
  })));

  // ── PUT /api/plugins/:id (update OR set config) ──────────────────────
  router.put('/plugins/:id', wrap(withSpan('plugin.mutate', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('plugin.id', req.params.id || '');
    const action = req.body?.action;
    span.setAttribute('plugin.action', action || '');
    if (action === 'update') {
      try {
        const result = await store.updatePlugin(req.params.id);
        span.setAttribute('plugin.update.from', result.from || '');
        span.setAttribute('plugin.update.to', result.to || '');
        res.json({
          ok: true,
          from: result.from,
          to: result.to,
          plugin: result.plugin,
        });
        recordTrace('plugin.update', { outcome: 'ok' });
      } catch (err) {
        const status = err.code === 'not_installed' ? 404 : 500;
        span.setAttribute('plugin.update.error_code', err.code || 'unknown');
        res.status(status).json({
          error: err.code || 'update_failed',
          message: err.message,
        });
        recordTrace('plugin.update', {
          outcome: 'error',
          code: err.code || 'unknown',
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
        recordTrace('plugin.config', { outcome: 'invalid_config' });
        return;
      }
      try {
        const updated = store.replaceConfig(req.params.id, config);
        res.json(updated);
        recordTrace('plugin.config', { outcome: 'ok' });
      } catch (err) {
        const status = err.code === 'not_installed' ? 404 : 400;
        span.setAttribute('plugin.config.error_code', err.code || 'unknown');
        res.status(status).json({
          error: err.code || 'config_failed',
          message: err.message,
        });
        recordTrace('plugin.config', {
          outcome: 'error',
          code: err.code || 'unknown',
        });
      }
      return;
    }
    res.status(400).json({
      error: 'bad_request',
      message: 'action must be "update" or "config"',
    });
    recordTrace('plugin.mutate', { outcome: 'invalid_action' });
  })));

  // ── DELETE /api/plugins/:id ──────────────────────────────────────────
  router.delete('/plugins/:id', wrap(withSpan('plugin.uninstall', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('plugin.id', req.params.id || '');
    const ok = store.uninstallPlugin(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      recordTrace('plugin.uninstall', { outcome: 'not_found' });
      return;
    }
    res.status(204).end();
    recordTrace('plugin.uninstall', { outcome: 'ok' });
  })));

  // ── POST /api/plugins/:id/invoke ─────────────────────────────────────
  router.post('/plugins/:id/invoke', wrap(withSpan('plugin.invoke', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('plugin.id', req.params.id || '');
    const method = req.body?.method;
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    if (method) span.setAttribute('plugin.invoke.method', method);
    span.setAttribute('plugin.invoke.arg_count', args.length);
    if (!method || typeof method !== 'string') {
      res.status(400).json({
        error: 'bad_request',
        message: 'method (string) is required',
      });
      recordTrace('plugin.invoke', { outcome: 'missing_method' });
      return;
    }
    const timeoutMs = Number.isFinite(req.body?.timeoutMs)
      ? req.body.timeoutMs
      : undefined;
    if (Number.isFinite(timeoutMs)) {
      span.setAttribute('plugin.invoke.timeout_ms', timeoutMs);
    }
    const result = await store.invokePlugin(req.params.id, method, args, {
      timeoutMs,
    });
    if (result.ok) {
      res.json(result);
      recordTrace('plugin.invoke', { outcome: 'ok', method });
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
    span.setAttribute('plugin.invoke.error_code', result.code || 'unknown');
    res.status(status).json(result);
    recordTrace('plugin.invoke', {
      outcome: 'error',
      code: result.code || 'unknown',
    });
  })));

  return router;
}
