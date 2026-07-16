/**
 * src/server/dialog-store.mjs
 *
 * v3.9.0 — Persisted dialog-request store for the slash-command plugin
 * bridge. Thor's sibling plugin writes dialog requests to disk here; the
 * dialog poller picks them up and broadcasts each as a
 * `{ type: 'dialog:show', dialog }` WS message.
 *
 * Storage:
 *   ~/.cache/bizar/dialogs/<iso-ts>-<rand>.json
 *
 * Each entry:
 *   { id, ts, title, command, component, data? }
 *
 * Each entry is a single one-shot event: the poller removes the file
 * after the broadcast succeeds. There is no ack/retry — if the WS is
 * offline, the dialog is still on disk and will be delivered on the
 * next tick. Operators who care about delivery can poll
 * GET /api/dialogs for recent history.
 *
 * WIRING: this module is intentionally READ-ONLY from the perspective
 * of `server.mjs` — the file that mounts routes and starts the poller
 * is owned by the slash-command sibling. See the header comment at the
 * top of `routes/dialogs.mjs` for the exact wiring contract.
 *
 * v3.x service-mode gap: `cli/service.mjs` runs the schedule tick but
 * does NOT currently start the dialog poller. The dialog poller lives
 * in the dashboard server. Service-only deployments (no dashboard
 * running) will silently drop dialog requests until a future PR wires
 * the poller into `cli/service.mjs`.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { warn as logWarn } from './logger.mjs';

const HOME = homedir();
const DIALOG_DIR = join(HOME, '.cache', 'bizar', 'dialogs');

function ensureDir() {
  try {
    mkdirSync(DIALOG_DIR, { recursive: true });
  } catch {
    /* ignore — best-effort */
  }
}

function safeReadJSON(file) {
  try {
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function genId() {
  return `dlg_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

/** Allow-list of dialog `component` keys. The dashboard mounts each key
 *  in the Chat view; unknown keys are accepted but logged. */
// NOTE: if you add a new DialogComponent to lib/types.ts or
// plugins/bizar/src/commands.ts, mirror it here so dialog-store
// doesn't warn on every dialog of that type.
const KNOWN_COMPONENTS = new Set([
  'visual-plan',
  'plan-create',
  'plan-list',
  'help',
  'audit',
  'generic',
]);

export const dialogStore = {
  DIALOG_DIR,

  /**
   * Append a dialog request. Returns the persisted descriptor.
   * Caller is expected to provide at minimum `{ id, title, command,
   * component }`. `id` is auto-generated when missing.
   *
   * @param {{ id?: string, title: string, command: string, component: string, data?: Record<string, unknown> }} input
   */
  add(input) {
    ensureDir();
    if (!input || typeof input !== 'object') {
      throw new Error('dialog payload required');
    }
    const id = input.id || genId();
    const component = String(input.component || '');
    if (!KNOWN_COMPONENTS.has(component)) {
      // Don't reject — the desktop UI may grow new dialog components
      // before this list does. Log instead so the operator can spot it.
      console.warn(`[dialog-store] unknown dialog component: ${component}`);
    }
    const dialog = {
      id,
      ts: new Date().toISOString(),
      title: String(input.title || ''),
      command: String(input.command || ''),
      component,
      data: input.data && typeof input.data === 'object' ? input.data : undefined,
    };
    const safeTs = dialog.ts.replace(/[:.]/g, '-');
    const file = join(DIALOG_DIR, `${safeTs}-${randomBytes(3).toString('hex')}.json`);
    const tmp = `${file}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(dialog, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
    return dialog;
  },

  /** Read every queued dialog. Cheap on a phone — expected N is 0–5. */
  list() {
    ensureDir();
    let files;
    try {
      files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.decision.json'));
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      const full = join(DIALOG_DIR, f);
      const data = safeReadJSON(full);
      if (data) {
        out.push({ ...data, _file: full });
      }
    }
    // Oldest first — the poller processes in order so the user sees
    // dialogs in the same sequence the plugin emitted them.
    out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    return out;
  },

  /**
   * Remove a dialog by id. Returns true when a file was actually
   * deleted (used by the poller after a successful broadcast).
   *
   * @param {string} id
   */
  remove(id) {
    if (!id) return false;
    ensureDir();
    let files;
    try {
      files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.decision.json'));
    } catch {
      return false;
    }
    let removed = false;
    for (const f of files) {
      const full = join(DIALOG_DIR, f);
      const data = safeReadJSON(full);
      if (data && data.id === id) {
        try {
          unlinkSync(full);
          removed = true;
        } catch {
          /* best-effort */
        }
        break;
      }
    }
    return removed;
  },

  /**
   * Record a user decision (approve / deny / skip) for a queued
   * dialog. Writes a sidecar `<file>.decision.json` so consumers can
   * observe the verdict, then removes the queued dialog so the
   * poller stops re-broadcasting it. Returns the recorded decision
   * or null when the id wasn't queued.
   *
   * @param {string} id
   * @param {'approve' | 'deny' | 'skip'} verdict
   * @param {Record<string, unknown>} [extra]
   */
  decide(id, verdict, extra = {}) {
    if (!id) return null;
    if (!['approve', 'deny', 'skip'].includes(verdict)) {
      throw new Error(`invalid verdict: ${verdict}`);
    }
    ensureDir();
    let files;
    try {
      files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.decision.json'));
    } catch {
      return null;
    }
    for (const f of files) {
      const full = join(DIALOG_DIR, f);
      const data = safeReadJSON(full);
      if (data && data.id === id) {
        const decision = {
          id,
          verdict,
          ts: new Date().toISOString(),
          dialogTitle: data.title,
          dialogCommand: data.command,
          extra: extra && typeof extra === 'object' ? extra : {},
        };
        const sidecar = `${full}.decision.json`;
        try {
          writeFileSync(sidecar, JSON.stringify(decision, null, 2) + '\n', 'utf8');
        } catch (err) { logWarn('dialog-store.unlink_failed', { full, err: err.message }); }
        try {
          unlinkSync(full);
        } catch (err) {
          logger.warn('dialog-store', 'unlink failed', { full, err: err.message });
          return null;
        }
        return decision;
      }
    }
    return null;
  },

  /**
   * Patch a queued dialog's `data` field in-place. Returns the
   * updated dialog or null when the id wasn't queued.
   *
   * @param {string} id
   * @param {Record<string, unknown>} patch
   */
  patch(id, patch) {
    if (!id || !patch || typeof patch !== 'object') return null;
    ensureDir();
    let files;
    try {
      files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.decision.json'));
    } catch {
      return null;
    }
    for (const f of files) {
      const full = join(DIALOG_DIR, f);
      const data = safeReadJSON(full);
      if (data && data.id === id) {
        const next = { ...data, data: { ...(data.data || {}), ...patch }, updatedAt: new Date().toISOString() };
        const tmp = `${full}.tmp.${process.pid}`;
        writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
        renameSync(tmp, full);
        return next;
      }
    }
    return null;
  },
};