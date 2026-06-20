/**
 * src/server/serve-info.mjs
 *
 * v3.5.4 (bug #3) — Out-of-process reader for the plugin's `serve.json`
 * (see plugins/bizar/src/serve-info.ts). The plugin owns the `opencode serve`
 * child process; this module lets the dashboard server talk to the same
 * child so it can abort sessions, list sessions, etc.
 *
 * Why a separate file:
 *   The plugin is TypeScript, the dashboard is plain `.mjs`. We cannot share
 *   code directly. Mirroring the read logic in a small `.mjs` is the
 *   lowest-cost bridge and keeps the plugin as the single source of truth
 *   for the on-disk contract.
 *
 * Opencode HTTP API contract (verified against opencode serve 1.17.x):
 *   - Auth: `Authorization: Basic base64("opencode:<password>")`. opencode
 *     serves the realm "Secure Area" with Basic auth.
 *   - `POST /api/session/{sessionId}/abort?directory={worktree}`
 *       — Aborts the session. The directory query param scopes the call to
 *         a specific worktree (mirrors how the plugin's HttpClient calls
 *         all per-session endpoints). 2xx on success; 404 if the session
 *         is unknown; 401 if auth fails.
 *   - `GET /api/session`
 *       — Lists every session in the opencode database, regardless of who
 *         started it. Response shape: `{data: Array<SessionView>}` where
 *         SessionView is {id, projectID, parentID?, title, agent, model,
 *         time:{created,updated,archived}, location:{directory,...}, ...}.
 *
 * Both endpoints are best-effort. Failure to call them does not crash the
 * dashboard — we surface a structured `{ok:false, error}` result and let
 * the UI toast.
 *
 * Discovery:
 *   We walk the same multi-path list as BG_DIRS (see background-store.mjs):
 *     - ~/.cache/bizar/serve.json (default stateDir)
 *     - ~/.config/opencode/serve.json (fallback)
 *     - ~/.bizar/serve.json (legacy)
 *   First file that parses successfully wins.
 *
 * Freshness:
 *   We re-read the file on every call so a plugin restart picks up the
 *   new port/password automatically. No in-process caching; the file is
 *   tiny (< 1 KB).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

// Mirrors plugins/bizar/src/serve-info.ts → BG_DIRS pattern.
const SERVE_INFO_FILES = [
  join(HOME, '.cache', 'bizar', 'serve.json'),
  join(HOME, '.config', 'opencode', 'serve.json'),
  join(HOME, '.bizar', 'serve.json'),
];

/**
 * @typedef {Object} ServeInfo
 * @property {string} baseUrl     e.g. "http://127.0.0.1:4097"
 * @property {number} port
 * @property {string} password    OPENCODE_SERVER_PASSWORD (base64 secret)
 * @property {string} worktree    the plugin's cwd at start time
 * @property {number} pid
 * @property {number} startedAt   epoch ms
 */

/**
 * Read the serve-info file from any of the candidate paths.
 * Returns null when no usable file exists. Never throws.
 *
 * @returns {ServeInfo|null}
 */
export function readServeInfo() {
  for (const file of SERVE_INFO_FILES) {
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.baseUrl === 'string' &&
        typeof parsed?.port === 'number' &&
        typeof parsed?.password === 'string' &&
        typeof parsed?.worktree === 'string' &&
        typeof parsed?.pid === 'number' &&
        typeof parsed?.startedAt === 'number'
      ) {
        return parsed;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * @typedef {Object} AbortResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [status]
 * @property {string} [note]
 */

/**
 * POST /api/session/{sessionId}/abort?directory={worktree} on the opencode
 * serve child described by `info`. Best-effort; never throws.
 *
 * Idempotent: if the session is already gone (404), we treat it as success
 * (the desired terminal state was already achieved).
 *
 * @param {ServeInfo} info
 * @param {string} sessionId
 * @param {string} [worktreeOverride]  defaults to info.worktree
 * @param {number} [timeoutMs]         defaults to 8000
 * @returns {Promise<AbortResult>}
 */
export async function abortSession(info, sessionId, worktreeOverride, timeoutMs = 8000) {
  if (!info || !sessionId) {
    return { ok: false, error: 'missing info or sessionId' };
  }
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(
    worktreeOverride || info.worktree || '',
  )}`;
  const auth = `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    // 404: session already gone — treat as idempotent success.
    if (res.status === 404) {
      return { ok: true, status: 404, note: 'session already absent' };
    }
    // Drain for diagnostics
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      status: res.status,
      error: `abort failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `abort timed out after ${timeoutMs}ms` : `abort network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {Object} OpencodeSession
 * @property {string} id
 * @property {string} projectID
 * @property {string|null} parentID
 * @property {string} title
 * @property {string} [agent]
 * @property {{id:string,providerID:string,variant?:string}} [model]
 * @property {{created:number,updated:number,archived:number|null}} time
 * @property {{directory:string,workspaceID?:string|null}} location
 */

/**
 * GET /api/session on the opencode serve child. Returns the raw session
 * list (each entry is a SessionView from opencode). Returns null when
 * no serve is reachable or auth fails. Never throws.
 *
 * Used by Bug #5 to merge sessions started directly from opencode (CLI,
 * MCP, etc.) into the dashboard's bg-instance list.
 *
 * @param {ServeInfo} info
 * @param {number} [timeoutMs]
 * @returns {Promise<OpencodeSession[]|null>}
 */
export async function listOpencodeSessions(info, timeoutMs = 5000) {
  if (!info) return null;
  const url = `${info.baseUrl}/api/session`;
  const auth = `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!body) return null;
    // v2 wraps in {data: [...]}; defensive fallback to top-level array.
    const arr = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
    if (!arr) return null;
    // Normalize to a flat shape so callers don't have to know about v1/v2.
    return arr.map((s) => ({
      id: s?.id,
      projectID: s?.projectID ?? s?.project_id ?? null,
      parentID: s?.parentID ?? s?.parent_id ?? null,
      title: s?.title ?? '',
      agent: s?.agent ?? null,
      model:
        s?.model && typeof s.model === 'object'
          ? {
              id: s.model.id,
              providerID: s.model.providerID ?? s.model.provider_id ?? '',
              variant: s.model.variant ?? null,
            }
          : null,
      time: {
        created: s?.time?.created ?? 0,
        updated: s?.time?.updated ?? 0,
        archived: s?.time?.archived ?? null,
      },
      location: {
        directory: s?.location?.directory ?? '',
        workspaceID: s?.location?.workspaceID ?? s?.location?.workspace_id ?? null,
      },
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const SERVE_INFO_FILE_PATHS = SERVE_INFO_FILES;

// ── v3.5.4 (bug: dispatch stuck) — spawn helpers ─────────────────────────
//
// The dashboard's task delegator used to shell out to
// `node plugins/bizar/dist/cli.js bg enqueue`. That CLI does not exist
// (the plugin is a Bun-native TS project with no compiled dist), so every
// spawn silently failed and subtasks got stuck at `doing 5% Dispatched`
// forever.
//
// The fix is to talk to the opencode serve child the plugin owns directly
// — the plugin already spawns `opencode serve` on init and publishes the
// port + password via serve-info. The endpoints below mirror what the
// plugin's own `bizar_spawn_background` MCP tool does in-process
// (plugins/bizar/src/http-client.ts → `createSession` + `sendPrompt`).
//
// All helpers are best-effort. A failure to reach the serve child
// returns a structured `{ ok: false, error, status? }` so callers can log
// the cause instead of swallowing it.

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Build the Authorization header for the opencode serve child. The wire
 * format is `Basic base64("opencode:<password>")` (matches what the
 * plugin's own HttpClient uses; see plugins/bizar/src/http-client.ts).
 */
function buildAuthHeader(info) {
  const creds = `opencode:${info.password}`;
  return `Basic ${Buffer.from(creds).toString('base64')}`;
}

/**
 * `POST /api/session?directory=...` — create a new background session.
 *
 * v2 wire format (per plugins/bizar/src/http-client.ts): request body is
 * `{ title, agent, parentID?, model? }`; response is `{ data: { id, ... } }`
 * or the session at top level. We unwrap defensively.
 *
 * @param {ServeInfo} info
 * @param {{ title: string, agent: string, parentID?: string }} opts
 * @param {string} [directory]  defaults to info.worktree
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:true,sessionId:string}|{ok:false,error:string,status?:number}>}
 */
export async function createOpencodeSession(info, opts, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!info) return { ok: false, error: 'serve-info not available — plugin is not running' };
  if (!opts || typeof opts.agent !== 'string' || opts.agent.length === 0) {
    return { ok: false, error: 'agent is required' };
  }
  const title = (opts.title || `${opts.agent}: bg-session`).toString().slice(0, 200);
  const dir = directory || info.worktree || '';
  const url = `${info.baseUrl}/api/session?directory=${encodeURIComponent(dir)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const body = { title, agent: opts.agent };
    if (opts.parentID) body.parentID = opts.parentID;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(info),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      return {
        ok: false,
        status: res.status,
        error: `POST /api/session failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
      };
    }
    const parsed = await res.json().catch(() => null);
    const sessionId =
      (parsed && typeof parsed === 'object' && (parsed.data?.id || parsed.id)) ||
      null;
    if (!sessionId) {
      return { ok: false, status: res.status, error: 'POST /api/session: response missing id' };
    }
    return { ok: true, sessionId: String(sessionId) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `createSession timed out after ${timeoutMs}ms` : `createSession network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `POST /api/session/{id}/prompt?directory=...` — fire the prompt.
 *
 * v2 wire format (per plugins/bizar/src/http-client.ts): body is
 * `{ id: <messageID>, prompt: { text }, agent, model? }`. The `id` is a
 * client-generated message ID; the dashboard already has its own task ID
 * scheme, so we just synthesize a unique one.
 *
 * @param {ServeInfo} info
 * @param {{ sessionId: string, agent: string, text: string, messageID?: string }} opts
 * @param {string} [directory]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:true,messageId:string}|{ok:false,error:string,status?:number}>}
 */
export async function sendOpencodePrompt(info, opts, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!info) return { ok: false, error: 'serve-info not available — plugin is not running' };
  if (!opts || !opts.sessionId || !opts.agent || !opts.text) {
    return { ok: false, error: 'sessionId, agent, and text are required' };
  }
  const dir = directory || info.worktree || '';
  const messageID = opts.messageID || `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(opts.sessionId)}/prompt?directory=${encodeURIComponent(dir)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const body = {
      id: messageID,
      prompt: { text: String(opts.text).slice(0, 200_000) },
      agent: opts.agent,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(info),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      return {
        ok: false,
        status: res.status,
        error: `POST /api/session/${opts.sessionId}/prompt failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
      };
    }
    return { ok: true, messageId: messageID };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `sendPrompt timed out after ${timeoutMs}ms` : `sendPrompt network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /health` — used by the dispatcher startup check to verify the
 * serve child is actually reachable before we try to enqueue work.
 *
 * @param {ServeInfo} info
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function pingOpencodeServe(info, timeoutMs = 3_000) {
  if (!info) return false;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${info.baseUrl}/health`, {
      method: 'GET',
      headers: { Authorization: buildAuthHeader(info) },
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}