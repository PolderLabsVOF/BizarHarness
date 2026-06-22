/**
 * src/server/dialog-poller.mjs
 *
 * v3.9.0 — Dialog-request poller.
 *
 * Mirrors the bg-poller pattern: the plugin writes dialog requests to
 * `~/.cache/bizar/dialogs/*.json`; this poller scans every second,
 * broadcasts each one as a `dialog:show` WS message, and removes the
 * file once the broadcast is dispatched.
 *
 * The dashboard's Chat view (sibling scope — Thor) listens for
 * `dialog:show` messages and mounts the dialog component keyed by
 * `dialog.component`.
 *
 * Idempotency: a dialog is a one-shot event. As soon as the broadcast
 * succeeds the file is deleted. If the WS layer is down (no clients
 * connected), the dialog stays on disk and will be delivered on the
 * next tick — at-least-once delivery is acceptable because the
 * dashboard de-duplicates by `dialog.id`.
 *
 * WIRING: this module is loaded by the dashboard's `server.mjs` (sibling
 * scope — Thor). It expects `server.mjs` to call
 * `startDialogPoller()` once at startup. The `broadcast()` function
 * is exported from `server.mjs`; we lazy-import it the same way
 * `bg-poller.mjs` does to avoid a circular dep.
 *
 * v3.x service-mode gap: `cli/service.mjs` does NOT currently start
 * the dialog poller. Service-only deployments will need to add
 * `startDialogPoller()` to `cli/service.mjs` if they want slash-
 * command dialogs to flow without a running dashboard.
 */
import { dialogStore } from './dialog-store.mjs';

const POLL_INTERVAL_MS = 1_000;

let _interval = null;

async function broadcastDialog(dialog) {
  try {
    const { broadcast } = await import('./server.mjs');
    broadcast({
      type: 'dialog:show',
      dialog: {
        id: dialog.id,
        title: dialog.title,
        command: dialog.command,
        component: dialog.component,
        data: dialog.data,
      },
    });
  } catch (err) {
    console.error('[dialog-poller] broadcast failed:', err.message);
    return false;
  }
  return true;
}

async function tick() {
  let queue;
  try {
    queue = dialogStore.list();
  } catch (err) {
    console.error('[dialog-poller] list() failed:', err.message);
    return;
  }
  if (!queue || queue.length === 0) return;
  for (const dialog of queue) {
    const ok = await broadcastDialog(dialog);
    if (!ok) continue;
    // We remove AFTER broadcast — never before. That way a crash in
    // the WS layer doesn't permanently lose a dialog.
    try {
      dialogStore.remove(dialog.id);
    } catch (err) {
      console.error('[dialog-poller] remove failed:', err.message);
    }
  }
}

export function startDialogPoller() {
  if (_interval) return; // idempotent
  // Tick once immediately so any dialog queued before startup is
  // delivered to the first WS client without waiting a full interval.
  tick().catch((err) => console.error('[dialog-poller] initial tick:', err.message));
  _interval = setInterval(() => {
    tick().catch((err) => console.error('[dialog-poller] tick:', err.message));
  }, POLL_INTERVAL_MS);
  if (_interval && typeof _interval.unref === 'function') {
    _interval.unref();
  }
  console.log(`[dialog-poller] started (interval=${POLL_INTERVAL_MS}ms)`);
}

export function stopDialogPoller() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

// Exposed for tests / introspection.
export const _pollerInternals = {
  tick,
  POLL_INTERVAL_MS,
};