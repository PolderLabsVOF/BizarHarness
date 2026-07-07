/**
 * src/server/serve-info.mjs
 *
 * v3.5.4 (bug #3) — Out-of-process reader for the plugin's `serve.json`
 * (see plugins/bizar/src/serve-info.ts). The plugin owns the `cline serve`
 * child process; this module lets the dashboard server talk to the same
 * child so it can abort sessions, list sessions, etc.
 *
 * Why a separate file:
 *   The plugin is TypeScript, the dashboard is plain `.mjs`. We cannot share
 *   code directly. Mirroring the read logic in a small `.mjs` is the
 *   lowest-cost bridge and keeps the plugin as the single source of truth
 *   for the on-disk contract.
 *
 * Cline HTTP API contract (verified against cline serve 1.17.x):
 *   - Auth: `Authorization: Basic base64("cline:<password>")`. cline
 *     serves the realm "Secure Area" with Basic auth.
 *   - `POST /api/session/{sessionId}/abort?directory={worktree}`
 *       — Aborts the session. The directory query param scopes the call to
 *         a specific worktree (mirrors how the plugin's HttpClient calls
 *         all per-session endpoints). 2xx on success; 404 if the session
 *         is unknown; 401 if auth fails.
 *   - `GET /api/session`
 *       — Lists every session in the cline database, regardless of who
 *         started it. Response shape: `{data: Array<SessionView>}` where
 *         SessionView is {id, projectID, parentID?, title, agent, model,
 *         time:{created,updated,archived}, location:{directory,...}, ...}.
 *   - `GET /api/session/{sessionId}/message?directory={worktree}`
 *       — Lists every message in a session. Response shape:
 *         `{data: Array<{info, parts}>}` where info is
 *         {id, role, time:{created,...}} and parts is
 *         `Array<{type, text}>` (text-bearing parts only contribute to
 *         the chat display; tool/agent parts are ignored by the chat
 *         layer but still in the response). Used by the chat endpoint
 *         to poll for assistant responses, and by the bg-poller to scan
 *         the final assistant message for an `html-artifact` block.
 *
 * Both endpoints are best-effort. Failure to call them does not crash the
 * dashboard — we surface a structured `{ok:false, error}` result and let
 * the UI toast.
 *
 * Discovery:
 *   We walk the same multi-path list as BG_DIRS (see background-store.mjs):
 *     - ~/.cache/bizar/serve.json (default stateDir)
 *     - ~/.config/cline/serve.json (fallback)
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
import { createConnection, isIP } from 'node:net';
import { warn as loggerWarn, error as loggerError } from './logger.mjs';

const HOME = homedir();

// Mirrors plugins/bizar/src/serve-info.ts → BG_DIRS pattern.
const DEFAULT_SERVE_INFO_FILES = [
  join(HOME, '.cache', 'bizar', 'serve.json'),
  join(HOME, '.config', 'cline', 'serve.json'),
  join(HOME, '.bizar', 'serve.json'),
];

/**
 * Resolve the serve.json candidate paths at call time so test
 * suites can override with `BIZAR_SERVE_JSON_PATH=/tmp/...json`.
 * Order: env override (if set and exists) → default search list.
 *
 * @returns {string[]}
 */
function serveInfoFiles() {
  const override = process.env.BIZAR_SERVE_JSON_PATH;
  if (override && typeof override === 'string' && override.length > 0) {
    return [override];
  }
  return DEFAULT_SERVE_INFO_FILES;
}

/**
 * @typedef {Object} ServeInfo
 * @property {string} baseUrl     e.g. "http://127.0.0.1:4097"
 * @property {number} port
 * @property {string} password    CLINE_SERVER_PASSWORD (base64 secret)
 * @property {string} worktree    the plugin's cwd at start time
 * @property {number} pid
 * @property {number} startedAt   epoch ms
 */

/**
 * Read the serve-info file from any of the candidate paths.
 * Returns null when no usable file exists. Never throws.
 *
 * v3.11.0 — schema relaxed to derive missing fields. The plugin's
 * `writeServeInfo` is supposed to write `{baseUrl, port, password,
 * worktree, pid, startedAt}`, but older builds (and the version
 * currently shipping on the user's install) wrote only
 * `{password, pid, port}`. The strict pre-v3.11.0 schema then caused
 * `readServeInfo()` to return `null`, which cascaded into
 * `dispatchToBackground` marking every subtask as `dispatchPending: true`
 * (see `task-delegator.mjs:563`). We now:
 *   - Require only `password` (string) and `port` (number)
 *   - Derive `baseUrl` from `port` (`http://127.0.0.1:<port>`)
 *     when the on-disk file omits it
 *   - Treat `worktree` and `startedAt` as optional, defaulting to `''`
 *     and `0` respectively when missing. Callers that need a real
 *     worktree (the bg-retry loop) must fill it in from their own
 *     state — never assume the value here.
 *   - Still validate that the derived `baseUrl` is loopback-safe.
 *
 * @returns {ServeInfo|null}
 */
export function readServeInfo() {
  for (const file of serveInfoFiles()) {
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.password !== 'string' ||
        typeof parsed?.port !== 'number'
      ) {
        continue;
      }
      // Derive baseUrl from port when the file omits it (older plugin
      // builds write `{password, pid, port}` only).
      let baseUrl = typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0
        ? parsed.baseUrl
        : `http://127.0.0.1:${parsed.port}`;
      if (!isSafeServeBaseUrl(baseUrl)) continue;
      return {
        baseUrl,
        port: parsed.port,
        password: parsed.password,
        worktree: typeof parsed.worktree === 'string' ? parsed.worktree : '',
        pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

function isSafeServeBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host === '::ffff:127.0.0.1' || host === '::ffff:7f00:1') return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return host.startsWith('127.');
  if (ipVersion === 6) return host === '::1';
  return false;
}

/**
 * @typedef {Object} AbortResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [status]
 * @property {string} [note]
 */

/**
 * POST /api/session/{sessionId}/abort?directory={worktree} on the cline
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
  const auth = `Basic ${Buffer.from(`cline:${info.password}`).toString('base64')}`;
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
 * @typedef {Object} ClineSession
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
 * GET /api/session on the cline serve child. Returns the raw session
 * list (each entry is a SessionView from cline). Returns null when
 * no serve is reachable or auth fails. Never throws.
 *
 * Used by Bug #5 to merge sessions started directly from cline (CLI,
 * MCP, etc.) into the dashboard's bg-instance list.
 *
 * @param {ServeInfo} info
 * @param {number} [timeoutMs]
 * @returns {Promise<ClineSession[]|null>}
 */
export async function listClineSessions(info, timeoutMs = 5000) {
  if (!info) return null;
  const url = `${info.baseUrl}/api/session`;
  const auth = `Basic ${Buffer.from(`cline:${info.password}`).toString('base64')}`;
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

export const SERVE_INFO_FILE_PATHS = DEFAULT_SERVE_INFO_FILES;

// ── v5.0.0 — bug #4 — directory resolver (shared between route modules) ──
//
// Both `routes/cline-sessions.mjs` and `routes/cline-session-detail.mjs`
// need the same logic: given a sessionId and the plugin's serve-info, figure
// out which `directory` (worktree) to pass as a `?directory=…` query param
// to cline's HTTP API. We previously had two copies of this resolver
// inline in each route; now there's one in serve-info.mjs so a fix here
// reaches both routes.
//
// Strategy (per issue #4 brief):
//   1. If serve.json has a `worktree` AND a fast probe (`GET
//      /api/session/{id}?directory=<worktree>`) succeeds (HTTP 200), use
//      the worktree — no need to list every cline session.
//   2. Otherwise, list every session via `GET /api/session` and find the
//      one whose id matches. Use its `location.directory` (or the legacy
//      `worktree` field, if present) as the directory.
//   3. If neither yields a directory, return null — callers should 503
//      so the UI can show "directory unknown" rather than sending the
//      request with a blank `?directory=` (cline 400s on that).
//
// `worktreeHasSession` is a small `GET /api/session/{id}?directory=...`
// probe used as a fast-path so we don't pay the cost of listing every
// session on every listMessages call. The endpoint returns 200 when the
// session exists in that worktree, 404 when it doesn't. We treat 2xx
// other than 200 as success (cline has shipped both `200` and `204`
// on this endpoint across versions).

/**
 * Lightweight probe — does `sessionId` exist in `worktree`?
 *
 * Implemented as `GET /api/session/{id}?directory={worktree}`. Returns
 * `true` on 2xx, `false` on 404, `null` on network / auth / other
 * errors (the caller should fall back to the slower list path and
 * trust THAT result).
 *
 * Never throws.
 *
 * @param {ServeInfo} info
 * @param {string} sessionId
 * @param {string} worktree
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean|null>}
 */
async function worktreeHasSession(info, sessionId, worktree, timeoutMs = 2_500) {
  if (!info || !sessionId || !worktree) return null;
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(worktree)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(info),
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 404) return false;
    // 401/403/5xx → don't trust the result, let the fallback path decide.
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the cline `directory` (worktree) for a session.
 *
 * Per the brief:
 *   1. If we have a worktree AND a fast probe confirms the session
 *      lives there, return it.
 *   2. Otherwise, list every session and find the matching one; use
 *      its `location.directory` (or legacy `worktree`).
 *   3. Return null if neither yields a directory.
 *
 * Signature is `(sessionId, serveInfo)` (positional, sessionId first)
 * to match the brief. Callers that only have `serveInfo` can pass
 * `null` for `sessionId` and the function will fall through to the
 * list path.
 *
 * Never throws.
 *
 * @param {string|null|undefined} sessionId
 * @param {ServeInfo|null|undefined} serveInfo
 * @returns {Promise<string|null>}
 */
export async function resolveSessionDirectory(sessionId, serveInfo) {
  if (!serveInfo) return null;

  // Fast path: probe the recorded worktree first. If the session lives
  // there, we save the round-trip to /api/session.
  if (typeof serveInfo.worktree === 'string' && serveInfo.worktree.length > 0) {
    const probe = await worktreeHasSession(serveInfo, sessionId || '', serveInfo.worktree);
    if (probe === true) return serveInfo.worktree;
  }

  // Slower fallback: list every session and find the match.
  try {
    const sessions = await listClineSessions(serveInfo, 5_000);
    if (Array.isArray(sessions)) {
      const entry = sessionId
        ? sessions.find(
            (s) =>
              s && (s.id === sessionId || (typeof s.sessionId === 'string' && s.sessionId === sessionId)),
          )
        : null;
      if (entry) {
        const dir = entry?.location?.directory;
        if (typeof dir === 'string' && dir.length > 0) return dir;
        // Defensive: some cline builds store the worktree on the
        // session at the top level instead of under `location`.
        const legacy = entry?.worktree;
        if (typeof legacy === 'string' && legacy.length > 0) return legacy;
      }
      // No matching session, but we have a worktree from serve.json —
      // last-chance fallback. This mirrors the pre-v5.0.0 inline
      // resolver behaviour so an unmatched session still routes to
      // the plugin's recorded cwd rather than 503'ing.
      if (!entry && typeof serveInfo.worktree === 'string' && serveInfo.worktree.length > 0) {
        return serveInfo.worktree;
      }
    } else if (typeof serveInfo.worktree === 'string' && serveInfo.worktree.length > 0) {
      // listClineSessions returned null (serve offline / auth fail).
      // Fall back to the worktree so we at least try the same
      // directory the plugin recorded — the upstream 404/502 will
      // surface a clearer error than a 503 directory_unknown.
      return serveInfo.worktree;
    }
  } catch (err) {
    loggerWarn('resolveSessionDirectory: listClineSessions failed', {
      sessionId: sessionId || null,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

// ── v3.5.4 (bug: dispatch stuck) — spawn helpers ─────────────────────────
//
// The dashboard's task delegator used to shell out to
// `node plugins/bizar/dist/cli.js bg enqueue`. That CLI does not exist
// (the plugin is a Bun-native TS project with no compiled dist), so every
// spawn silently failed and subtasks got stuck at `doing 5% Dispatched`
// forever.
//
// The fix is to talk to the cline serve child the plugin owns directly
// — the plugin already spawns `cline serve` on init and publishes the
// port + password via serve-info. The endpoints below mirror what the
// plugin's own `bizar_spawn_background` MCP tool does in-process
// (plugins/bizar/src/http-client.ts → `createSession` + `sendPrompt`).
//
// All helpers are best-effort. A failure to reach the serve child
// returns a structured `{ ok: false, error, status? }` so callers can log
// the cause instead of swallowing it.

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Build the Authorization header for the cline serve child. The wire
 * format is `Basic base64("cline:<password>")` (matches what the
 * plugin's own HttpClient uses; see plugins/bizar/src/http-client.ts).
 *
 * v4.2.4 — exported so the SSE proxy in `routes/cline-session-detail.mjs`
 * can authenticate upstream fetches without duplicating the formula.
 */
export function buildAuthHeader(info) {
  if (!info || typeof info.password !== 'string') return '';
  const creds = `cline:${info.password}`;
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
export async function createClineSession(info, opts, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
export async function sendClinePrompt(info, opts, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
    let cause = 'unknown';
    if (isAbort) cause = 'timeout';
    else if (err && typeof err === 'object') {
      const code = /** @type {any} */ (err).code;
      if (typeof code === 'string' && code.length > 0) {
        cause = code.startsWith('ECONN') || code.startsWith('UND_ERR') || code === 'ENOTFOUND'
          ? 'network'
          : code;
      } else {
        cause = 'network';
      }
    }
    return {
      ok: false,
      cause,
      error: isAbort ? `sendPrompt timed out after ${timeoutMs}ms` : `sendPrompt network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── v3.5.5 — chat + artifact integration ──────────────────────────────
//
// The chat endpoint (POST /api/chat) and the bg-poller both need to
// read the cline session's message list so they can:
//   1. Capture the assistant's reply to a user prompt (chat polling).
//   2. Scan the final assistant message for an `html-artifact` block
//      that the agent emitted to declare a tangible artifact.
//
// `listClineMessages` is a thin fetch wrapper over
// `GET /api/session/{id}/message?directory=...`. The response shape
// (per the plugin's own http-client.ts → listMessages()) is either a
// raw `Array<{ info, parts }>` or `{ data: Array<{ info, parts }> }`.
// We accept both.
//
// `extractContentFromClineMessage` flattens the `parts[]` array
// into a single string for chat persistence and artifact detection.

/**
 * GET /api/session/{id}/message — list the messages of a session.
 *
 * v2 wire format (per plugins/bizar/src/http-client.ts): response is
 * `{ data: Array<{ info, parts }> }` or a bare array. We accept both.
 *
 * @param {ServeInfo} info
 * @param {string} sessionId
 * @param {string} [directory]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:true,messages:Array}|{ok:false,error:string,status?:number}>}
 */
export async function listClineMessages(info, sessionId, directory, timeoutMs = 8_000) {
  if (!info) return { ok: false, error: 'serve-info not available — plugin is not running' };
  if (!sessionId) return { ok: false, error: 'sessionId is required' };
  const dir = directory || info.worktree || '';
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(dir)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(info),
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      return {
        ok: false,
        status: res.status,
        error: `GET /api/session/.../message failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
      };
    }
    const body = await res.json().catch(() => null);
    if (!body) return { ok: true, messages: [] };
    const messages = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    return { ok: true, messages };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    // v5.0.0 — bug #4: surface a structured `cause` to the route so it
    // can render a useful suggestion without substring-sniffing the
    // error message. Prefers the underlying network error code
    // (ECONNREFUSED, UND_ERR_SOCKET, …) when present.
    let cause = 'unknown';
    if (isAbort) cause = 'timeout';
    else if (err && typeof err === 'object') {
      const code = /** @type {any} */ (err).code;
      if (typeof code === 'string' && code.length > 0) {
        cause = code.startsWith('ECONN') || code.startsWith('UND_ERR') || code === 'ENOTFOUND'
          ? 'network'
          : code;
      } else {
        cause = 'network';
      }
    }
    return {
      ok: false,
      cause,
      error: isAbort ? `listMessages timed out after ${timeoutMs}ms` : `listMessages network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flatten an cline message's `parts[]` into a single string.
 *
 * Cline v2 messages look like:
 *   { info: { id, role, time }, parts: [{type, text}, {type, text}, ...] }
 *
 * We concatenate every `text` part in order, joined by `\n\n`. Non-text
 * parts (tool calls, etc.) are skipped — they don't contribute to a
 * human-readable chat or artifact scan.
 *
 * @param {object} msg  one entry from `listClineMessages().messages`
 * @returns {string}
 */
export function extractContentFromClineMessage(msg) {
  if (!msg) return '';
  // Some cline v1 builds put text directly on the message itself.
  if (typeof msg.text === 'string') return finalizeText(msg.text);
  if (typeof msg.content === 'string') return finalizeText(msg.content);
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const textParts = parts
    .filter((p) => p && (p.type === 'text' || typeof p.text === 'string'))
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean);
  return finalizeText(textParts.join('\n\n'));
}

/**
 * Strip `<thinking>...</thinking>` blocks from model output.
 *
 * Some cline builds (and the M3 model specifically) emit inline
 * `<thinking>` reasoning tags directly in the assistant text content.
 * React-markdown renders those as visible escaped HTML, so the chat UI
 * ends up showing the raw tag. The reasoning itself is also captured
 * separately as `reasoning_details` parts — we are not losing data by
 * hiding the inline tag from the rendered text.
 *
 * Handles:
 *   - `<thinking>...</thinking>` blocks (case-insensitive, multiline)
 *   - `<thinking ...attrs>` and `<thinking/>` self-closing variants
 *   - Stray closing tags like `</thinking>` with no matching opener
 *   - Multiple blocks in the same string
 *   - Empty input → empty output
 *
 * After stripping, collapses runs of 3+ newlines to 2 so we don't
 * leave huge blank gaps in the rendered output.
 */
export function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking\b[^>]*\/?>/gi, '')
    .replace(/<\/thinking>/gi, '');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function finalizeText(text) {
  return stripThinkingTags(text);
}

/**
 * Normalize an cline message into the dashboard's chat shape:
 *   { id, role, content, ts, agent? }
 *
 * Used by GET /api/tasks/:id/chat to surface a bg instance's cline
 * session inside the chat UI.
 *
 * @param {object} msg
 * @returns {{id:string,role:string,content:string,ts:number}}
 */
export function normalizeClineMessage(msg) {
  if (!msg) return { id: '', role: 'assistant', content: '', ts: Date.now() };
  const id = msg?.info?.id || msg?.id || '';
  const role = msg?.info?.role || msg?.role || 'assistant';
  const ts = msg?.info?.time?.created
    || (typeof msg?.info?.time === 'object' ? msg.info.time.created : null)
    || (typeof msg?.time?.created === 'number' ? msg.time.created : null)
    || Date.now();
  return {
    id: String(id),
    role: String(role),
    content: extractContentFromClineMessage(msg),
    ts: typeof ts === 'number' ? ts : Date.now(),
  };
}

/**
 * `DELETE /api/session/{id}?directory=...` — delete a session on the
 * cline serve child. v4.2.4 dashboard feature parity: the rail
 * menu offers delete and the chat info panel can prune finished
 * sessions from inside the dashboard.
 *
 * Idempotent: a 404 (already gone) is treated as a successful delete.
 *
 * @param {ServeInfo} info
 * @param {string} sessionId
 * @param {string} [directory]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:true,status:number}|{ok:false,error:string,status?:number}>}
 */
export async function deleteClineSession(info, sessionId, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!info) return { ok: false, error: 'serve-info not available — plugin is not running' };
  if (!sessionId) return { ok: false, error: 'sessionId is required' };
  const dir = directory || info.worktree || '';
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(dir)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: buildAuthHeader(info),
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (res.ok || res.status === 404) {
      return { ok: true, status: res.status };
    }
    let detail = '';
    try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      error: `DELETE /api/session/${sessionId} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `deleteSession timed out after ${timeoutMs}ms` : `deleteSession network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `PATCH /api/session/{id}?directory=...` — update session fields
 * (currently just `title`) on the cline serve child. Used by the
 * rail row-menu "Rename" affordance.
 *
 * @param {ServeInfo} info
 * @param {string} sessionId
 * @param {{ title?: string }} patch
 * @param {string} [directory]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:true,session:object}|{ok:false,error:string,status?:number}>}
 */
export async function updateClineSession(info, sessionId, patch, directory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!info) return { ok: false, error: 'serve-info not available — plugin is not running' };
  if (!sessionId) return { ok: false, error: 'sessionId is required' };
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch is required' };
  const dir = directory || info.worktree || '';
  const url = `${info.baseUrl}/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(dir)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const body = {};
    if (typeof patch.title === 'string') {
      const t = patch.title.trim();
      if (!t) return { ok: false, error: 'title cannot be empty' };
      if (t.length > 200) return { ok: false, error: 'title too long (> 200 chars)' };
      body.title = t;
    } else {
      return { ok: false, error: 'no supported fields in patch (only `title` is wired)' };
    }
    const res = await fetch(url, {
      method: 'PATCH',
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
        error: `PATCH /api/session/${sessionId} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
      };
    }
    let session = null;
    try { session = await res.json(); } catch { /* non-JSON body is fine — we still got 2xx */ }
    return { ok: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `updateSession timed out after ${timeoutMs}ms` : `updateSession network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /health — used by the dispatcher startup check to verify the
 * serve child is actually reachable before we try to enqueue work.
 *
 * v3.11.0 — Replaced the HTTP `GET /health` probe with a TCP-connect
 * port-open check via `net.createConnection`. Rationale:
 *   - The pre-v3.11.0 implementation sent `GET /health` with the
 *     Basic-auth header from `serve.json`. If the cline serve
 *     instance rejected the auth (e.g. a stale password file, a
 *     plugin version mismatch, or a 401 from a different auth realm),
 *     the probe returned `false` even when the cline process was
 *     perfectly healthy and answering other requests. That cascaded
 *     into every background dispatch short-circuiting on the
 *     `if (serveInfo && serveReachable)` guard at
 *     `task-delegator.mjs:563` and being marked `dispatchPending: true`.
 *   - TCP-connect is the standard "is this port alive" check. It does
 *     not depend on HTTP auth, the cline version's endpoint shape,
 *     or the path being correct. If the cline process is bound to
 *     the port, we can talk to it (auth on the actual endpoints will
 *     still be validated when we issue those calls).
 *   - 1.5s default timeout — long enough to survive a slow CI host,
 *     short enough that the dispatch path doesn't stall the user
 *     when the plugin is genuinely down.
 *
 * @param {ServeInfo} info
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function pingClineServe(info, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    if (!info || typeof info.port !== 'number') {
      resolve(false);
      return;
    }
    // We connect to 127.0.0.1 explicitly — the TCP probe must not
    // accidentally hit a remote host if the baseUrl were ever wrong.
    const host = '127.0.0.1';
    const port = info.port;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => finish(false), Math.max(50, timeoutMs));
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    // Surface any unexpected socket-level error so it doesn't crash
    // the process. `error` is already handled above, but `close`
    // can fire after `connect`/`error` without indicating failure.
    socket.once('close', () => {
      clearTimeout(timer);
      finish(settled ? false : false);
    });
  });
}

// ── v4.2.4 — SSE event unwrap (port from plugins/bizar/src/event-stream.ts) ──
//
// The dashboard's chat UI subscribes to cline's `/event?directory=...`
// SSE stream to receive live updates for a chosen session. The wire
// format has changed across cline versions; this helper normalizes
// both shapes into a single `{type, sessionID?, messageID?, part?, data}`
// envelope that the SSE proxy can filter on `sessionID` and forward.
//
// Wire format 1 (direct, older cline):
//   event: session.created
//   data: {"type":"session.created","properties":{"sessionID":"abc","title":"…"}}
//
// Wire format 2 (sync envelope, newer cline):
//   event: sync
//   data: {"type":"sync","syncEvent":{"type":"session.created.1","data":{"sessionID":"abc"}}}
//
// Sync event `type` carries a `.<n>` version suffix (e.g. `session.created.1`).
// We strip it so downstream code can match on `session.created`.
// Field names inside the payload have also varied across builds:
//   - `sessionID` vs `sessionId` vs `session_id` (and nested under `properties`)
//   - `messageID` vs `messageId` vs `message_id`
// We accept any of them defensively.
//
// Reference: plugins/bizar/src/event-stream.ts:340-399 (the TS plugin's
// `dispatchEvent` method). We re-implement the same logic in plain JS
// here so the dashboard server can use it without importing TS code.

/**
 * Unwrap and normalize a raw cline SSE event payload.
 *
 * v0.4.3 wire formats accepted (see plugins/bizar/src/event-stream.ts:365-400):
 *   1. Direct: `{type, properties: {sessionID, ...}}` — newer cline uses
 *      `data` instead of `properties`. We accept either field name.
 *   2. Sync envelope: `{type: "sync", syncEvent: {type: "x.y.1", data: {...}}}`.
 *      Unwrap to inner data; strip the `.1` version suffix from the type.
 *
 * Returns `null` if the event isn't a recognizable cline event shape
 * (e.g. non-object, missing type).
 *
 * @param {string|null} eventName  the SSE `event:` field (may be null)
 * @param {unknown} data           the parsed JSON `data:` payload
 * @returns {{type:string, sessionID?:string, messageID?:string, part?:object, data?:object}|null}
 */
export function unwrapClineSseEvent(eventName, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  let obj = /** @type {Record<string, unknown>} */ (data);

  // Step 1: detect sync wrapper and unwrap. After this, `obj` points at
  // the inner `syncEvent.data` (or remains the original on partial shape).
  let innerType = null;
  if (obj.type === 'sync' && obj.syncEvent && typeof obj.syncEvent === 'object') {
    const syncEvent = /** @type {Record<string, unknown>} */ (obj.syncEvent);
    if (typeof syncEvent.type === 'string') innerType = syncEvent.type;
    if (syncEvent.data && typeof syncEvent.data === 'object') {
      obj = /** @type {Record<string, unknown>} */ (syncEvent.data);
    }
  }

  // Step 2: resolve the event type, preferring the inner sync type.
  // Strip the trailing `.<digits>` version suffix.
  const typeFromObj = innerType ?? (typeof obj.type === 'string' ? obj.type : null);
  const rawType = typeFromObj ?? eventName ?? null;
  if (typeof rawType !== 'string' || rawType.length === 0) return null;
  const type = stripVersionSuffix(rawType);

  // Step 3: extract identifiers from any of the common key spellings.
  const sessionID = pickString(obj, [
    'sessionID', 'sessionId', 'session_id',
  ], ['properties']);
  const messageID = pickString(obj, [
    'messageID', 'messageId', 'message_id',
  ], ['properties']);
  const part = obj.part && typeof obj.part === 'object'
    ? /** @type {object} */ (obj.part)
    : undefined;

  return { type, sessionID, messageID, part, data: obj };
}

/**
 * Strip the trailing `.<digits>` version suffix from an event type
 * (e.g. `session.created.1` → `session.created`).
 *
 * @param {string} s
 * @returns {string}
 */
export function stripVersionSuffix(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\.\d+$/, '');
}

/**
 * Look up a string field on `obj`, falling back to any nested object
 * whose key is in `nestedKeys` (e.g. `['properties']`).
 *
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys            top-level keys to check first
 * @param {string[]} [nestedKeys]    optional parents to recurse into
 * @returns {string|undefined}
 */
function pickString(obj, keys, nestedKeys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  if (nestedKeys) {
    for (const nk of nestedKeys) {
      const nested = obj[nk];
      if (nested && typeof nested === 'object') {
        for (const k of keys) {
          const v = /** @type {Record<string, unknown>} */ (nested)[k];
          if (typeof v === 'string' && v.length > 0) return v;
        }
      }
    }
  }
  return undefined;
}
