/**
 * src/server/claude-sdk.mjs
 *
 * v6.3.0 — Dashboard-side wrapper around the Claude Code Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`).
 *
 * Replaces cline-sdk.mjs (the legacy wrapper around
 * `@polderlabs/bizar-sdk/cline`). Claude Code's SDK is an in-process
 * library: it exposes `query()` for one-shot prompts and
 * `ClaudeSDKClient` for streaming sessions. There is no equivalent
 * of cline's `serve` subprocess — Claude Code runs in-process by
 * default.
 *
 * Public surface:
 *   - `getClaudeSdk()`           — returns the SDK module or `null`
 *                                   if not installed (so callers can
 *                                   degrade gracefully).
 *   - `getClaudeSdkOrThrow()`    — same, but throws when missing.
 *   - `subscribeToSession(id)`   — wraps `ClaudeSDKClient.subscribe()`
 *                                   for streaming a session's events.
 *   - `pingClaudeSdk()`          — quick health probe; uses a short
 *                                   `query()` against `--model haiku`
 *                                   to verify the SDK is reachable.
 *
 * Storage location for Claude Code sessions:
 *   - Sessions live at `~/.claude/sessions/<sessionId>/` with the
 *     conversation as `messages.jsonl`. This module does not own
 *     that directory — Claude Code writes it directly. We read it
 *     when callers ask for `listClaudeSessions` / `listClaudeMessages`.
 *
 * Environment:
 *   - Claude Code reads API keys from the environment
 *     (`ANTHROPIC_API_KEY` or the OAuth flow). We do NOT need to
 *     build an `Authorization: Basic base64("cline:<password>")`
 *     header — Claude Code handles authentication itself.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

let _sdk = null;
/** @type {Promise<any> | null} */
let _sdkPromise = null;

const HOME = homedir();
const CLAUDE_SESSIONS_DIR = join(HOME, '.claude', 'sessions');

/**
 * Lazily import the Claude Code Agent SDK. Returns the module on
 * success and `null` if the package is not installed (so callers can
 * fall back to subprocess execution via claude-runner.mjs).
 *
 * The result is cached so subsequent calls are synchronous.
 *
 * @returns {Promise<any | null>}
 */
export async function getClaudeSdk() {
  if (_sdk) return _sdk;
  if (_sdkPromise) return _sdkPromise;
  _sdkPromise = (async () => {
    try {
      const mod = await import('@anthropic-ai/claude-agent-sdk');
      _sdk = mod;
      return mod;
    } catch {
      // SDK package not installed — caller should use the
      // subprocess fallback in claude-runner.mjs.
      _sdk = null;
      return null;
    } finally {
      _sdkPromise = null;
    }
  })();
  return _sdkPromise;
}

/**
 * Same as {@link getClaudeSdk} but throws when the SDK isn't
 * available. Use this from code paths that REQUIRE the in-process
 * SDK (e.g. callers that want typed event streams rather than the
 * JSONL subprocess path).
 *
 * @returns {Promise<any>}
 */
export async function getClaudeSdkOrThrow() {
  const sdk = await getClaudeSdk();
  if (!sdk) {
    throw new Error(
      'claude_sdk_unavailable: @anthropic-ai/claude-agent-sdk is not installed. ' +
        'Run `npm install @anthropic-ai/claude-agent-sdk` at the repo root, ' +
        'or use the subprocess path (claude-runner.mjs).',
    );
  }
  return sdk;
}

/**
 * Subscribe to a Claude Code session's event stream. Thin wrapper
 * around `ClaudeSDKClient.subscribe({ sessionId })`.
 *
 * Returns `{ stream, close }` — `stream` is an `AsyncIterable` of
 * typed event envelopes; `close()` aborts the underlying subscription.
 *
 * Returns `null` when the SDK is unavailable or the session id is
 * missing — callers should fall back to the JSONL tailing path in
 * `claude-sessions.mjs`.
 *
 * @param {string} sessionId
 * @returns {Promise<AsyncIterable<unknown> & { close: () => void } | null>}
 */
export async function subscribeToSession(sessionId) {
  if (!sessionId) return null;
  const sdk = await getClaudeSdk();
  if (!sdk || typeof sdk.subscribe !== 'function') return null;
  try {
    const sub = await sdk.subscribe({ sessionId });
    return sub;
  } catch {
    return null;
  }
}

/**
 * Quick liveness probe for the Claude Code SDK. Performs a tiny
 * `query()` call against `haiku` and waits up to 1.5s for the
 * response. Returns `true` on any successful response, `false`
 * otherwise.
 *
 * Used by the dashboard's /api/health endpoint and by callers that
 * want to decide between the in-process SDK and the subprocess
 * fallback.
 *
 * @returns {Promise<boolean>}
 */
export async function pingClaudeSdk() {
  const sdk = await getClaudeSdk();
  if (!sdk || typeof sdk.query !== 'function') return false;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    try {
      const stream = sdk.query({
        prompt: 'ping',
        options: { model: 'haiku', maxTurns: 1, permissionMode: 'plan' },
      });
      // Drain the first event or the abort signal — either proves
      // the SDK is reachable.
      const result = await Promise.race([
        stream[Symbol.asyncIterator]().next().then(() => true),
        new Promise((resolve) => {
          ac.signal.addEventListener('abort', () => resolve(false));
        }),
      ]);
      // Best-effort close of the stream.
      try { await stream.close?.(); } catch { /* ignore */ }
      return Boolean(result);
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
  } catch {
    return false;
  }
}

/**
 * Return the canonical on-disk directory for Claude Code sessions.
 * Useful for callers that need to enumerate `messages.jsonl` files
 * directly (e.g. listing historical messages for a session).
 *
 * @returns {string}
 */
export function claudeSessionsDir() {
  return CLAUDE_SESSIONS_DIR;
}

/**
 * Best-effort check that the Claude Code session directory exists
 * (or its parent does). Lets callers fall back to "no sessions yet"
 * rather than throwing when the user has never run `claude`.
 *
 * @returns {boolean}
 */
export function claudeSessionsDirExists() {
  try {
    return existsSync(CLAUDE_SESSIONS_DIR) || existsSync(join(HOME, '.claude'));
  } catch {
    return false;
  }
}
