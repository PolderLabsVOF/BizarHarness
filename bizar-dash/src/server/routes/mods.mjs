/**
 * src/server/routes/mods.mjs
 *
 * /api/mods                              — list
 * /api/mods/:id                          — metadata
 * /api/mods (POST)                       — install from path
 * /api/mods/:id (PUT)                    — enable/disable
 * /api/mods/:id (DELETE)                 — uninstall
 * /api/mods/:id/files                    — file tree
 * /api/mods/:id/mod-file/* (GET)         — read single file (named route to avoid :id/* clash)
 * /api/mods/:id/mod-file/* (PUT)         — write single file
 * /api/mods/views                        — mod view registry
 * /api/mods/:id/mod-web/*                — serve files from mod's web/ dir
 *
 * Express-ordering note: /mods/views MUST come before /mods/:id/* —
 * actually only the literal /mods (without :id) takes precedence
 * over /mods/:id, but /mods/views is the same shape as /mods/:id so
 * we declare it before /mods/:id to be safe.
 */
import { Router } from 'express';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { modsLoader } from '../mods-loader.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createModsRouter() {
  const router = Router();

  router.get('/mods', wrap(async (_req, res) => {
    res.json({ mods: modsLoader.list() });
  }));

  // /mods/views MUST come before /mods/:id — otherwise Express would
  // match "views" as an :id value.
  router.get('/mods/views', wrap(async (_req, res) => {
    const views = modsLoader.listModViews();
    res.json({ views });
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
    const webRoot = resolve(mod.path, 'web');
    const filePath = resolve(webRoot, rel);
    const relPath = relative(webRoot, filePath);
    if (relPath.startsWith('..') || relPath === '') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(filePath);
  }));

  return router;
}
