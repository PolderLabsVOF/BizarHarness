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
import { createConnection, isIP } from 'node:net';

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
  for (const file of SERVE_INFO_FILES) {
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

// ── v3.5.5 — chat + artifact integration ──────────────────────────────
//
// The chat endpoint (POST /api/chat) and the bg-poller both need to
// read the opencode session's message list so they can:
//   1. Capture the assistant's reply to a user prompt (chat polling).
//   2. Scan the final assistant message for an `html-artifact` block
//      that the agent emitted to declare a tangible artifact.
//
// `listOpencodeMessages` is a thin fetch wrapper over
// `GET /api/session/{id}/message?directory=...`. The response shape
// (per the plugin's own http-client.ts → listMessages()) is either a
// raw `Array<{ info, parts }>` or `{ data: Array<{ info, parts }> }`.
// We accept both.
//
// `extractContentFromOpencodeMessage` flattens the `parts[]` array
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
export async function listOpencodeMessages(info, sessionId, directory, timeoutMs = 8_000) {
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
    return {
      ok: false,
      error: isAbort ? `listMessages timed out after ${timeoutMs}ms` : `listMessages network error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flatten an opencode message's `parts[]` into a single string.
 *
 * Opencode v2 messages look like:
 *   { info: { id, role, time }, parts: [{type, text}, {type, text}, ...] }
 *
 * We concatenate every `text` part in order, joined by `\n\n`. Non-text
 * parts (tool calls, etc.) are skipped — they don't contribute to a
 * human-readable chat or artifact scan.
 *
 * @param {object} msg  one entry from `listOpencodeMessages().messages`
 * @returns {string}
 */
export function extractContentFromOpencodeMessage(msg) {
  if (!msg) return '';
  // Some opencode v1 builds put text directly on the message itself.
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
 * Some opencode builds (and the M3 model specifically) emit inline
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
 * Normalize an opencode message into the dashboard's chat shape:
 *   { id, role, content, ts, agent? }
 *
 * Used by GET /api/tasks/:id/chat to surface a bg instance's opencode
 * session inside the chat UI.
 *
 * @param {object} msg
 * @returns {{id:string,role:string,content:string,ts:number}}
 */
export function normalizeOpencodeMessage(msg) {
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
    content: extractContentFromOpencodeMessage(msg),
    ts: typeof ts === 'number' ? ts : Date.now(),
  };
}

/**
 * `GET /health` — used by the dispatcher startup check to verify the
 * serve child is actually reachable before we try to enqueue work.
 *
 * v3.11.0 — Replaced the HTTP `GET /health` probe with a TCP-connect
 * port-open check via `net.createConnection`. Rationale:
 *   - The pre-v3.11.0 implementation sent `GET /health` with the
 *     Basic-auth header from `serve.json`. If the opencode serve
 *     instance rejected the auth (e.g. a stale password file, a
 *     plugin version mismatch, or a 401 from a different auth realm),
 *     the probe returned `false` even when the opencode process was
 *     perfectly healthy and answering other requests. That cascaded
 *     into every background dispatch short-circuiting on the
 *     `if (serveInfo && serveReachable)` guard at
 *     `task-delegator.mjs:563` and being marked `dispatchPending: true`.
 *   - TCP-connect is the standard "is this port alive" check. It does
 *     not depend on HTTP auth, the opencode version's endpoint shape,
 *     or the path being correct. If the opencode process is bound to
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
export function pingOpencodeServe(info, timeoutMs = 1_500) {
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
