/**
 * src/server/routes/mods.mjs
 *
 * /api/mods                              — list
 * /api/mods/registry                     — fetch available mods from public registry
 * /api/mods/audit                        — tail the mod audit log
 * /api/mods/:id                          — metadata
 * /api/mods (POST)                       — install from path OR registry id
 * /api/mods/:id (PUT)                    — enable/disable
 * /api/mods/:id (DELETE)                 — uninstall
 * /api/mods/:id/files                    — file tree
 * /api/mods/:id/mod-file/* (GET)         — read single file (named route to avoid :id/* clash)
 * /api/mods/:id/mod-file/* (PUT)         — write single file
 * /api/mods/views                        — mod view registry
 * /api/mods/:id/mod-web/*                — serve files from mod's web/ dir
 * /api/mods/:id/instructions              — list installed instruction files (v3.20)
 * /api/mods/:id/instructions/reinstall    — force-reinstall instructions (v3.20)
 * /api/mods/:id/upgrade                   — upgrade an installed mod from the registry (v3.20.5)
 * /api/mods/:id/views/*                   — serve a mod-shipped React view (v3.20.5)
 *
 * Express-ordering note: /mods/views MUST come before /mods/:id/* —
 * actually only the literal /mods (without :id) takes precedence
 * over /mods/:id, but /mods/views is the same shape as /mods/:id so
 * we declare it before /mods/:id to be safe.
 */
import { Router } from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { homedir } from 'node:os';
import { modsLoader } from '../mods-loader.mjs';
import { wrap } from './_shared.mjs';

/**
 * Read a file at an absolute path or under $HOME. Returns null if
 * the file doesn't exist or can't be read. The path argument may
 * use `~` as a home-relative shortcut (resolved against homedir()).
 */
function tryRead(p) {
  try {
    const full = p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p;
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @returns {import('express').Router}
 */
export function createModsRouter() {
  const router = Router();

  router.get('/mods', wrap(async (_req, res) => {
    res.json({ mods: modsLoader.list() });
  }));

  // /mods/registry MUST come before /mods/:id — otherwise Express would
  // match "registry" as an :id value.
  router.get('/mods/registry', wrap(async (_req, res) => {
    const installed = new Set(modsLoader.list().map((m) => m.id));
    try {
      const registry = await modsLoader.fetchRegistry();
      // Annotate each entry with installed flag and (if installed) the
      // local version so the dashboard can show upgrade hints.
      const mods = (registry.mods || []).map((m) => {
        const local = installed.has(m.id) ? modsLoader.get(m.id) : null;
        return {
          ...m,
          installed: local !== null,
          installedVersion: local ? local.version : null,
          upgradeAvailable:
            local && local.version !== m.latest ? m.latest : null,
        };
      });
      res.json({
        registry: {
          version: registry.version,
          updatedAt: registry.updatedAt,
          source: modsLoader.getRegistryUrl(),
        },
        mods,
      });
    } catch (err) {
      res.status(502).json({
        error: 'registry_unreachable',
        message: err.message,
        registryUrl: modsLoader.getRegistryUrl(),
      });
    }
  }));

  // /mods/audit — tail the mod audit log. Filters by mod id if provided.
  router.get('/mods/audit', wrap(async (req, res) => {
    const logPath = join(homedir(), '.cache', 'bizar', 'logs', 'mod-audit.log');
    const modFilter = req.query?.mod;
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 2000);
    if (!existsSync(logPath)) {
      res.json({ entries: [], logPath, modFilter });
      return;
    }
    let text;
    try {
      text = readFileSync(logPath, 'utf8');
    } catch (err) {
      res.status(500).json({ error: 'read_failed', message: err.message });
      return;
    }
    const lines = text.split(/\r?\n/).filter(Boolean).reverse();
    const out = [];
    for (const line of lines) {
      if (out.length >= limit) break;
      try {
        const entry = JSON.parse(line);
        if (modFilter && entry.mod !== modFilter) continue;
        out.push(entry);
      } catch {
        /* skip malformed lines */
      }
    }
    res.json({ entries: out.reverse(), logPath, modFilter });
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
    // Two install paths:
    //   { path: "/local/path" }       — install from a local directory
    //   { id: "registry-id" }         — install from the public registry
    if (req.body?.id) {
      try {
        const mod = await modsLoader.installFromRegistry(req.body.id);
        res.status(201).json(mod);
      } catch (err) {
        res.status(500).json({ error: 'install_failed', message: err.message });
      }
      return;
    }
    const path = req.body?.path;
    if (!path) {
      res.status(400).json({
        error: 'bad_request',
        message: 'either "id" (registry install) or "path" (local install) is required',
      });
      return;
    }
    try {
      const mod = modsLoader.installFromPath(path);
      res.status(201).json(mod);
    } catch (err) {
      res.status(500).json({ error: 'install_failed', message: err.message });
    }
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

  // ── v3.20 — Mod instructions (agents/commands/skills installed by this mod)
  router.get('/mods/:id/instructions', wrap(async (req, res) => {
    const mod = modsLoader.get(req.params.id);
    if (!mod) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const installed = modsLoader.listModInstructions(req.params.id);
    // For each installed file, try to read its content so the UI can
    // preview it without an extra round-trip.
    const annotated = {
      agents: installed.agents.map((f) => ({
        filename: f,
        path: join('agents', f),
        fullPath: `~/.config/opencode/agents/${f}`,
        content: tryRead(`~/.config/opencode/agents/${f}`),
      })),
      commands: installed.commands.map((f) => ({
        filename: f,
        path: join('commands', f),
        fullPath: `~/.config/opencode/commands/${f}`,
        content: tryRead(`~/.config/opencode/commands/${f}`),
      })),
      skills: installed.skills.map((d) => ({
        name: d,
        fullPath: `~/.opencode/skills/${d}`,
        content: tryRead(`~/.opencode/skills/${d}/SKILL.md`),
      })),
    };
    res.json({
      modId: req.params.id,
      modName: mod.name,
      total: annotated.agents.length + annotated.commands.length + annotated.skills.length,
      ...annotated,
    });
  }));

  // v3.20 — Force-reinstall the mod's instructions into opencode config
  // (useful after editing files inside the mod's agents/commands/skills).
  router.post('/mods/:id/instructions/reinstall', wrap(async (req, res) => {
    const counts = modsLoader.reinstallInstructions(req.params.id);
    if (counts === null) {
      res.status(404).json({ error: 'not_found', message: `mod "${req.params.id}" not installed` });
      return;
    }
    res.json({ ok: true, counts });
  }));

  // v3.20.5 — Upgrade an installed mod from the registry. Body opts:
  //   { backup?: boolean, url?: string }
  // backup: if true, copy the existing mod folder into
  //   ~/.config/bizar/mods/.backup/<id>-<timestamp>/ before replacing.
  // url:    optional override for the registry URL.
  // Returns { from, to, backupPath?, mod } on success.
  router.post('/mods/:id/upgrade', wrap(async (req, res) => {
    try {
      const result = await modsLoader.upgradeFromRegistry(req.params.id, {
        backup: !!req.body?.backup,
        url: typeof req.body?.url === 'string' ? req.body.url : undefined,
      });
      res.json({
        ok: true,
        modId: req.params.id,
        from: result.from,
        to: result.to,
        backupPath: result.backupPath,
        mod: result.mod,
      });
    } catch (err) {
      const code = /not installed/i.test(err.message) ? 404 : 500;
      res.status(code).json({ error: 'upgrade_failed', message: err.message });
    }
  }));

  // ── /api/mods/:id/mod-web/* and /api/mods/:id/web/* ────────────────
  // Serve files from each mod's web/ directory (for iframe embedding).
  // Two aliases — `mod-web` (explicit, won't collide with mod routes) and
  // bare `web` (intuitive, what users actually type). They serve identical
  // content so the mod author can use either.
  const webHandler = wrap(async (req, res) => {
    const mod = modsLoader.get(req.params.id);
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'not_found', message: `mod "${req.params.id}" not found or disabled` });
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
      res.status(404).json({ error: 'not_found', message: `file not found: ${rel}` });
      return;
    }
    res.sendFile(filePath);
  });
  router.get('/mods/:id/mod-web/*', webHandler);
  router.get('/mods/:id/web/*', webHandler);

  // v3.20.5 — Serve a mod-shipped React view as an ES module. Mods
  // declare view components in views/registry.json (e.g.
  //   { id: "graph", component: "GraphView.js" }
  // ) and ship the built file at views/<component>. The dashboard
  // dynamically imports it on demand and renders it inside ModView.
  //
  // The file is served with Content-Type: application/javascript so
  // the browser treats it as a real ES module. Mods are expected to
  // ship pre-built code (no JSX) and use React.createElement (or htm
  // with React.createElement) for composition. React itself is loaded
  // as part of the dashboard bundle — see /assets/*.js on first load.
  const viewsHandler = wrap(async (req, res) => {
    const mod = modsLoader.get(req.params.id);
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'not_found', message: `mod "${req.params.id}" not found or disabled` });
      return;
    }
    const rel = req.params[0] || '';
    if (!rel || rel.endsWith('/')) {
      res.status(400).json({ error: 'bad_request', message: 'file path required' });
      return;
    }
    // Allow only .js / .mjs / .jsx / .tsx files — anything else is
    // a misconfiguration or attack attempt.
    if (!/\.(js|mjs|jsx|tsx)$/i.test(rel)) {
      res.status(403).json({ error: 'forbidden', message: 'only JS-family files may be served as views' });
      return;
    }
    const viewsRoot = resolve(mod.path, 'views');
    const filePath = resolve(viewsRoot, rel);
    const relPath = relative(viewsRoot, filePath);
    if (relPath.startsWith('..') || relPath === '') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'not_found', message: `view not found: ${rel}` });
      return;
    }
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.sendFile(filePath);
  });
  router.get('/mods/:id/views/*', viewsHandler);

  return router;
}
