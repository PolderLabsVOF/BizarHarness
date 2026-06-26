/**
 * src/server/routes/obsidian.mjs
 *
 * REST surface over the per-project Obsidian vault (obsidian-store.mjs).
 *
 * /api/obsidian                    — vault summary (init state, counts)
 * /api/obsidian (POST)            — init the vault (idempotent)
 * /api/obsidian/notes              — list all notes
 * /api/obsidian/notes (POST)       — create or update a note
 * /api/obsidian/notes/:path        — read a single note
 * /api/obsidian/notes/:path (DELETE) — delete a note
 * /api/obsidian/search?q=...       — full-text search across notes
 * /api/obsidian/index (POST)       — rebuild INDEX.md
 */
import { Router } from 'express';
import {
  initObsidianVault,
  listVaultNotes,
  readVaultNote,
  writeVaultNote,
  deleteVaultNote,
  searchVault,
  rebuildIndex,
  vaultStats,
} from '../obsidian-store.mjs';
import { wrap } from './_shared.mjs';

export function createObsidianRouter({ projectRoot }) {
  const router = Router();

  // GET /obsidian — vault summary
  router.get('/obsidian', wrap(async (_req, res) => {
    res.json(vaultStats(projectRoot));
  }));

  // POST /obsidian — init vault (idempotent)
  router.post('/obsidian', wrap(async (_req, res) => {
    const result = initObsidianVault(projectRoot);
    res.json(result);
  }));

  // GET /obsidian/notes
  router.get('/obsidian/notes', wrap(async (_req, res) => {
    const notes = listVaultNotes(projectRoot);
    res.json({ notes });
  }));

  // POST /obsidian/notes — create/update a note
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
      const note = writeVaultNote(projectRoot, relPath, { frontmatter, body });
      res.status(201).json(note);
    } catch (err) {
      res.status(400).json({ error: 'bad_request', message: err.message });
    }
  }));

  // GET /obsidian/notes/:path — read a single note
  router.get('/obsidian/notes/*', wrap(async (req, res) => {
    const relPath = req.params[0];
    const note = readVaultNote(projectRoot, relPath);
    if (!note) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(note);
  }));

  // DELETE /obsidian/notes/:path
  router.delete('/obsidian/notes/*', wrap(async (req, res) => {
    const relPath = req.params[0];
    const ok = deleteVaultNote(projectRoot, relPath);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // GET /obsidian/search?q=...
  router.get('/obsidian/search', wrap(async (req, res) => {
    const q = req.query.q;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const results = searchVault(projectRoot, q, { limit });
    res.json({ query: q, results });
  }));

  // POST /obsidian/index — rebuild INDEX.md
  router.post('/obsidian/index', wrap(async (_req, res) => {
    const indexPath = rebuildIndex(projectRoot);
    if (!indexPath) {
      res.status(404).json({ error: 'not_initialized' });
      return;
    }
    res.json({ ok: true, indexPath });
  }));

  return router;
}