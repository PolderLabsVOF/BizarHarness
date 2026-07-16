/**
 * src/server/routes/dialogs.mjs
 *
 * v3.9.0 — Dialog-request HTTP routes.
 *
 *   GET    /api/dialogs            — list recent dialog history (debug)
 *   GET    /api/dialogs/queue      — list currently-queued (undelivered) dialogs
 *   POST   /api/dialogs            — enqueue a dialog (used by the slash-command plugin)
 *   DELETE /api/dialogs/:id        — remove a dialog from the queue
 *
 * WIRING (REQUIRED — read carefully):
 *
 *   This router is OWNED BY THE DIALOG SCOPE (Tyr). The route is
 *   MOUNTED BY THE SLASH-COMMAND SIBLING SCOPE (Thor). Thor owns
 *   `server.mjs`; I do NOT modify that file.
 *
 *   When Thor lands, they need to add the following to `server.mjs`:
 *
 *     import { createDialogsRouter } from './routes/dialogs.mjs';
 *     import { startDialogPoller } from './dialog-poller.mjs';
 *
 *     // …inside createServer or whatever the bootstrap is…
 *     app.use(createDialogsRouter({ broadcast }));
 *     startDialogPoller();
 *
 *   Until that's done, the router is wired but unreachable and the
 *   poller never starts. This is intentional — sibling separation
 *   prevents both of us from racing on the same file.
 *
 *   Service-mode gap: `cli/service.mjs` also does NOT start the dialog
 *   poller. If you want slash-command dialogs to flow in a service-only
 *   deployment (no dashboard), add `startDialogPoller()` to
 *   `cli/service.mjs`. Out of scope for this PR.
 */
import { Router } from 'express';
import { dialogStore } from '../dialog-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createDialogsRouter({ broadcast }) {
  const router = Router();

  // Debug / introspection — what dialogs are currently queued?
  router.get('/dialogs/queue', wrap(async (_req, res) => {
    const queue = dialogStore.list();
    res.json({ count: queue.length, queue });
  }));

  // Debug / history — what's been delivered recently? Since dialogs
  // are one-shot and removed after broadcast, this endpoint returns
  // the *currently queued* set as well; a true history view would
  // need a separate append-only log (out of scope here).
  router.get('/dialogs', wrap(async (_req, res) => {
    const queue = dialogStore.list();
    res.json({ dialogs: queue, dir: dialogStore.DIALOG_DIR });
  }));

  // Used by the slash-command plugin (Thor owns that, I just provide
  // the route). The plugin POSTs the dialog descriptor and the route
  // persists it; the poller picks it up on the next tick.
  router.post('/dialogs', wrap(async (req, res) => {
    const dialog = dialogStore.add(req.body || {});
    // Best-effort immediate broadcast — the poller will re-broadcast on
    // the next tick if this fails, but a successful immediate broadcast
    // cuts latency to ~ms for already-connected dashboards.
    try {
      broadcast({ type: 'dialog:show', dialog });
    } catch { /* best-effort */ }
    res.status(201).json(dialog);
  }));

  router.delete('/dialogs/:id', wrap(async (req, res) => {
    const ok = dialogStore.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // POST /api/dialogs/:id/approve|deny|skip — record a user decision
  // for a queued dialog. Removes the dialog so the poller stops
  // re-broadcasting it; writes a sidecar decision file for audit.
  for (const verdict of ['approve', 'deny', 'skip']) {
    router.post(`/dialogs/:id/${verdict}`, wrap(async (req, res) => {
      const decision = dialogStore.decide(req.params.id, verdict, req.body || {});
      if (!decision) {
        res.status(404).json({ error: 'not_found', verdict });
        return;
      }
      try { broadcast({ type: 'dialog:decision', decision }); } catch { /* best-effort */ }
      res.json({ ok: true, decision });
    }));
  }

  // PATCH /api/dialogs/:id — merge fields into the queued dialog's
  // `data` field. The request body shape is `{ data: {...} }` so the
  // caller can fill in payload before approving (e.g. add a comment).
  // Top-level keys in `req.body` other than `data` are merged into the
  // dialog root (e.g. `title`, `command`).
  router.patch('/dialogs/:id', wrap(async (req, res) => {
    const body = req.body || {};
    const dataPatch = body.data && typeof body.data === 'object' ? body.data : body;
    const updated = dialogStore.patch(req.params.id, dataPatch);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true, dialog: updated });
  }));

  return router;
}