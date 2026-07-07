/**
 * plugins/bizar/src/key-rotation.ts
 *
 * Wraps a provider's fetch to automatically rotate through a list of API
 * keys when the upstream returns a retryable status (429 / 402 / 5xx).
 *
 * Why this exists
 * ───────────────
 * MiniMax (like most LLM providers) applies per-key rate limits and
 * quotas. When a key hits its limit, the request fails with 429 or 402
 * and the agent session dies — there is no way to swap keys mid-session
 * because the provider reads its key from auth.json once at init.
 *
 * cline has no built-in multi-key rotation. This wrapper fills the gap:
 *
 *   • Read N keys from env vars (MINIMAX_API_KEY, MINIMAX_API_KEY_2,
 *     ..., or MINIMAX_API_KEYS=key1,key2,...)
 *   • On the first attempt, use key #0
 *   • On 429/402/5xx response, retry with the next key (capped at N)
 *   • On 401 (unauthorized) and other 4xx, do NOT rotate — those are
 *     client errors that no key will fix
 *
 * Behaviour
 * ─────────
 * • Only POST requests targeting `/chat/completions` on a known provider
 *   URL are intercepted. Other requests pass through untouched.
 * • The `Authorization` header on the outgoing request is replaced with
 *   the currently-selected key on every attempt. All other headers
 *   (Content-Type, Accept, etc.) are preserved from the SDK.
 * • Responses are NEVER consumed by this wrapper. The caller receives
 *   the final response (success or last failure) intact, including its
 *   unconsumed body stream — safe for SSE.
 * • On a successful response, the "current key" index advances by one so
 *   the next incoming request starts on a different key, spreading load.
 * • On all-keys-exhausted, the last error response is returned so the
 *   cline SDK surfaces it normally — no special handling required
 *   downstream.
 *
 * Concurrency
 * ───────────
 * Multiple requests can be in flight. The current-key index is shared
 * state but JS is single-threaded, so a simple counter is safe. Each
 * request reads the counter once at entry and writes it on success.
 */

import type { FetchLike } from "./reasoning-clean.js";

export interface KeyRotationOptions {
  /** Provider id whose requests should be wrapped (e.g. "minimax"). */
  providerId: string;
  /**
   * List of API keys to rotate through. Must have at least 2 entries
   * for rotation to kick in. A single-entry list (or empty) makes the
   * wrapper a pass-through no-op.
   */
  apiKeys: string[];
  /** Optional debug logger. */
  debug?: (msg: string) => void;
}

/**
 * HTTP status codes that indicate "this key is exhausted, try the next".
 * 401 (unauthorized) is intentionally excluded — a bad key won't get
 * better by retrying, and surfacing the auth error to the user is more
 * useful than silently rotating past it.
 */
const RETRYABLE_STATUSES = new Set([
  429, // Too Many Requests / rate limit
  402, // Payment Required (quota exhausted)
  500, 502, 503, 504, // Server errors that may be account-specific
]);

/** Decide whether `url` targets the provider we should rotate for.
 *  Matches by substring on the provider id, mirroring the matcher in
 *  `reasoning-clean.ts` so the two wrappers stay consistent. */
function isProviderUrl(url: string, providerId: string): boolean {
  const lower = url.toLowerCase();
  const lp = providerId.toLowerCase();
  return (
    lower.includes(`/${lp}/`) ||
    lower.includes(`/${lp}?`) ||
    lower.includes(`${lp}.`) ||
    lower.includes(`-${lp}.`) ||
    lower.includes(`.${lp}/`)
  );
}

/** Return a fresh `RequestInit` whose `Authorization` header is `Bearer <key>`.
 *  Other headers from `init` are preserved. */
function injectKey(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${key}`);
  return { ...init, headers };
}

/**
 * Wrap a fetch implementation so that requests to the target provider
 * rotate through `apiKeys` on retryable status codes. Returns a function
 * with the same signature as the original fetch.
 */
export function wrapFetchForKeyRotation(
  originalFetch: FetchLike,
  options: KeyRotationOptions,
): FetchLike {
  const { providerId, apiKeys, debug } = options;

  if (apiKeys.length < 2) {
    debug?.(
      `key-rotation: apiKeys has ${apiKeys.length} entries; rotation disabled (need >= 2)`,
    );
    return originalFetch;
  }

  let currentIndex = 0;
  let successCount = 0;
  let rotationCount = 0;

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Only intercept POST chat-completions on the target provider.
    // Everything else passes through untouched so the reasoning-clean
    // wrapper (and any other wrapper) still sees the request.
    if (!/\/chat\/completions(?:\?|$)/.test(url)) return originalFetch(input, init);
    if (!isProviderUrl(url, providerId)) return originalFetch(input, init);
    if ((init?.method ?? "POST").toUpperCase() !== "POST") return originalFetch(input, init);

    const startIndex = currentIndex;
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      const keyIndex = (startIndex + attempt) % apiKeys.length;
      const key = apiKeys[keyIndex]!;
      const modifiedInit = injectKey(init, key);

      let response: Response;
      try {
        response = await originalFetch(input, modifiedInit);
      } catch (err) {
        debug?.(
          `key-rotation: fetch threw for key #${keyIndex}: ${(err as Error).message}`,
        );
        // Network errors also trigger retry with the next key.
        if (attempt < apiKeys.length - 1) continue;
        throw err;
      }

      lastResponse = response;

      if (!RETRYABLE_STATUSES.has(response.status)) {
        if (response.ok) {
          successCount++;
          // Advance the starting index so the next request begins on
          // a different key — spreads load and avoids one hot key.
          currentIndex = (keyIndex + 1) % apiKeys.length;
        }
        return response;
      }

      // Retryable status. Discard the response body and try the next key.
      rotationCount++;
      debug?.(
        `key-rotation: key #${keyIndex} returned ${response.status}; ` +
          `rotating to key #${(keyIndex + 1) % apiKeys.length}`,
      );
      // Best-effort body drain so the underlying connection can be reused.
      try {
        await response.body?.cancel();
      } catch {
        /* ignore */
      }
    }

    debug?.(
      `key-rotation: all ${apiKeys.length} keys exhausted; ` +
        `returning last ${lastResponse?.status} response`,
    );
    return lastResponse!;
  };
}

/**
 * Resolve a list of MiniMax API keys from environment variables.
 *
 * Resolution order (first non-empty wins):
 *   1. `MINIMAX_API_KEYS` — single env var holding a comma-separated list
 *   2. `MINIMAX_API_KEY` + `MINIMAX_API_KEY_2`, `_3`, ..., `_16`
 *   3. Empty array (rotation disabled)
 *
 * Whitespace around entries is trimmed; empty strings are filtered out.
 * At most 16 keys are returned as a defensive cap so a misconfigured
 * env var (e.g. an accidental comma-spam) cannot drive runaway rotation.
 */
export function discoverMiniMaxKeys(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const explicit = env.MINIMAX_API_KEYS;
  if (explicit) {
    return explicit
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 16);
  }
  const keys: string[] = [];
  const primary = env.MINIMAX_API_KEY;
  if (primary && primary.trim().length > 0) keys.push(primary.trim());
  for (let i = 2; i <= 16; i++) {
    const k = env[`MINIMAX_API_KEY_${i}`];
    if (k && k.trim().length > 0) keys.push(k.trim());
  }
  return keys;
}