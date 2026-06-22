/**
 * src/server/routes/background.mjs
 *
 * /api/background                          — list
 * /api/background/:id                      — single instance
 * /api/background/:id/output               — tail captured output
 * /api/background/:id/tmux                 — tmux attach metadata
 * /api/background/:id/message (POST)       — send a follow-up message
 * /api/background/:id (DELETE)             — kill
 *
 * Backed by the opencode-plugin's bg instance store. Imports the
 * store lazily so this module loads even when the plugin is offline.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createBackgroundRouter({ broadcast }) {
  const router = Router();

  router.get('/background', wrap(async (_req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const instances = await backgroundStore.list();
    res.json({ instances, status: backgroundStore.status() });
  }));

  router.get('/background/:id', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const inst = backgroundStore.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(inst);
  }));

  router.get('/background/:id/output', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const lines = Math.min(500, Math.max(1, parseInt(req.query.lines || '50', 10) || 50));
    const result = backgroundStore.captureOutput(req.params.id, lines);
    res.json(result);
  }));

  // v3.5.5 — Tmux session metadata. The UI uses this to render an
  // "Attach" button next to a running bg instance. Returns the
  // computed session name, the local attach command, and whether
  // the session actually exists right now. Always 200 — the caller
  // can tell `exists: false` apart from a missing instance.
  router.get('/background/:id/tmux', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const info = backgroundStore.tmuxAttachInfo(req.params.id);
    res.json(info);
  }));

  router.post('/background/:id/message', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const message = (req.body?.message || '').toString();
    if (!message.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'message required' });
      return;
    }
    const result = backgroundStore.sendMessage(req.params.id, message);
    res.json(result);
  }));

  router.delete('/background/:id', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    // v3.5.4 (bug #3) — `kill()` is now async (it awaits the abortSession
    // HTTP call to opencode serve, then deletes the state file, then
    // best-effort tmux). The result includes a `steps[]` array so the UI
    // can report exactly what happened.
    //
    // We always return 200 — the result body's `ok` distinguishes
    // success from partial failure (e.g. abort succeeded but tmux kill
    // did not). Returning 502 would force the fetch wrapper into its
    // error branch and we'd lose the `steps[]` diagnostic.
    const result = await backgroundStore.kill(req.params.id);
    if (result.ok) {
      broadcast({ type: 'background:change', action: 'kill', id: req.params.id });
    }
    res.json(result);
  }));

  // v0.5.5 — Cleanup old terminal instances. The UI calls this from
  // the Settings "Background Agents" card.
  router.post('/background/cleanup', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const maxAgeDays = Number(req.body?.maxAgeDays) || 7;
    const result = backgroundStore.cleanup(maxAgeDays);
    broadcast({ type: 'background:cleanup', deleted: result.deleted });
    res.json(result);
  }));

  // v0.5.5 — Summary with status counts. The UI calls this for the
  // Background Agents overview in Settings.
  router.get('/background/summary', wrap(async (_req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const summary = backgroundStore.listWithStatusCounts();
    res.json(summary);
  }));

  return router;
}