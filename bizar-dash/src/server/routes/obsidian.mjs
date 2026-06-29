/**
 * src/server/routes/obsidian.mjs
 *
 * v2 — Backward-compatible rewrite. When `.bizar/memory.json` exists, this
 * router delegates to memory-store.mjs. When memory is not configured, it falls
 * back to the original obsidian-store.mjs behaviour.
 *
 * CRITICAL: Preserve legacy response shapes exactly. Do not change the JSON
 * structure returned by any endpoint.
 */

import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Lazy imports so circular deps are avoided and we only load memory-store.mjs
// when it is actually needed.
let _memoryStore = null;
let _obsidianStore = null;
let _wrap = null;

async function getMemoryStore() {
  if (!_memoryStore) {
    _memoryStore = await import(`${SERVER_ROOT}/memory-store.mjs`).then((m) => m);
  }
  return _memoryStore;
}

async function getObsidianStore() {
  if (!_obsidianStore) {
    _obsidianStore = await import(`${SERVER_ROOT}/obsidian-store.mjs`).then((m) => m);
  }
  return _obsidianStore;
}

async function getShared() {
  if (!_wrap) {
    const mod = await import('./_shared.mjs').then((m) => m);
    _wrap = mod.wrap;
  }
  return { wrap: _wrap };
}

/**
 * Returns true if the project has opted into the memory service via
 * `.bizar/memory.json`.
 */
async function hasMemoryConfig(projectRoot) {
  const { safeReadJSON } = await import(`${SERVER_ROOT}/yaml.mjs`).then((m) => m);
  // Use safeReadJSON from yaml.mjs is expensive — use simpler check
  const { existsSync } = await import('node:fs');
  const configPath = join(projectRoot, '.bizar', 'memory.json');
  return existsSync(configPath);
}

export async function createObsidianRouter({ projectRoot }) {
  const router = Router();
  const { wrap } = await getShared();
  const memoryEnabled = await hasMemoryConfig(projectRoot);

  if (memoryEnabled) {
    // ── Memory service is active — delegate to memory-store.mjs ──────────────
    const ms = await getMemoryStore();

    // GET /api/obsidian — vault stats
    router.get('/obsidian', wrap(async (_req, res) => {
      const { vaultRoot, mode } = ms.resolveVault(projectRoot);
      const { existsSync, readdirSync, statSync, readFileSync } = await import('node:fs');
      if (!existsSync(vaultRoot)) {
        res.json({ exists: false, vaultDir: vaultRoot, noteCount: 0, totalSize: 0 });
        return;
      }
      const notes = ms.listNotes(projectRoot);
      const totalSize = notes.reduce((acc, n) => acc + n.size, 0);
      const folders = new Set(notes.map((n) => n.relPath.split('/')[0]));
      res.json({
        exists: true,
        vaultDir: vaultRoot,
        noteCount: notes.length,
        totalSize,
        folderCount: folders.size,
        folders: [...folders].sort(),
        lastModified: notes[0]?.mtime || null,
      });
    }));

    // POST /api/obsidian — init vault
    router.post('/obsidian', wrap(async (_req, res) => {
      const result = ms.initVault(projectRoot);
      res.json({ vaultDir: result.vaultRoot, created: result.created });
    }));

    // GET /api/obsidian/notes — legacy shape: { notes: [{ path, relPath, mtime, size }] }
    router.get('/obsidian/notes', wrap(async (_req, res) => {
      const notes = ms.listNotes(projectRoot);
      // Return legacy shape
      const legacyNotes = notes.map((n) => ({
        path: n.relPath,
        relPath: n.relPath,
        mtime: n.mtime,
        size: n.size,
      }));
      res.json({ notes: legacyNotes });
    }));

    // POST /api/obsidian/notes — write note
    // CRITICAL: returns 201 with FULL note shape { relPath, frontmatter, body, raw, mtime, size }
    router.post('/obsidian/notes', wrap(async (req, res) => {
      const { path: relPath, frontmatter, body } = req.body || {};
      if (!relPath || typeof relPath !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'path is required' });
        return;
      }
      if (!relPath.endsWith('.md')) {
        res.status(400).json({ error: 'bad_request', message: 'path must end in .md' });
        return;
      }
      try {
        const note = ms.writeNote(projectRoot, relPath, { frontmatter: frontmatter || {}, body: body || '' });
        // Return FULL note shape (legacy behavior)
        res.status(201).json(note);
      } catch (err) {
        res.status(400).json({ error: 'bad_request', message: err.message });
      }
    }));

    // GET /api/obsidian/notes/:path — single note
    router.get('/obsidian/notes/*', wrap(async (req, res) => {
      const relPath = req.params[0];
      const note = ms.readNote(projectRoot, relPath);
      if (!note) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(note);
    }));

    // DELETE /api/obsidian/notes/:path
    router.delete('/obsidian/notes/*', wrap(async (req, res) => {
      const relPath = req.params[0];
      const ok = ms.deleteNote(projectRoot, relPath);
      if (!ok) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(204).end();
    }));

    // GET /api/obsidian/search?q=...
    router.get('/obsidian/search', wrap(async (req, res) => {
      const q = req.query.q || '';
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const results = ms.searchVault(projectRoot, q, { limit });
      res.json({ query: q, results });
    }));

    // POST /api/obsidian/index — rebuild index
    router.post('/obsidian/index', wrap(async (_req, res) => {
      // No-op in memory mode (INDEX.md is not maintained)
      res.json({ ok: true, indexPath: null });
    }));

  } else {
    // ── Legacy obsidian-store.mjs behaviour ───────────────────────────────────
    const os = await getObsidianStore();

    router.get('/obsidian', wrap(async (_req, res) => {
      res.json(os.vaultStats(projectRoot));
    }));

    router.post('/obsidian', wrap(async (_req, res) => {
      const result = os.initObsidianVault(projectRoot);
      res.json(result);
    }));

    router.get('/obsidian/notes', wrap(async (_req, res) => {
      const notes = os.listVaultNotes(projectRoot);
      res.json({ notes });
    }));

    router.post('/obsidian/notes', wrap(async (req, res) => {
      const { path: relPath, frontmatter, body } = req.body || {};
      if (!relPath || typeof relPath !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'path is required' });
        return;
      }
      if (!relPath.endsWith('.md')) {
        res.status(400).json({ error: 'bad_request', message: 'path must end in .md' });
        return;
      }
      try {
        const note = os.writeVaultNote(projectRoot, relPath, { frontmatter, body });
        res.status(201).json(note);
      } catch (err) {
        res.status(400).json({ error: 'bad_request', message: err.message });
      }
    }));

    router.get('/obsidian/notes/*', wrap(async (req, res) => {
      const relPath = req.params[0];
      const note = os.readVaultNote(projectRoot, relPath);
      if (!note) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(note);
    }));

    router.delete('/obsidian/notes/*', wrap(async (req, res) => {
      const relPath = req.params[0];
      const ok = os.deleteVaultNote(projectRoot, relPath);
      if (!ok) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(204).end();
    }));

    router.get('/obsidian/search', wrap(async (req, res) => {
      const q = req.query.q;
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const results = os.searchVault(projectRoot, q, { limit });
      res.json({ query: q, results });
    }));

    router.post('/obsidian/index', wrap(async (_req, res) => {
      const indexPath = os.rebuildIndex(projectRoot);
      if (!indexPath) {
        res.status(404).json({ error: 'not_initialized' });
        return;
      }
      res.json({ ok: true, indexPath });
    }));
  }

  return router;
}
