/**
 * src/server/opencode-sdk.mjs
 *
 * Dashboard-side wrapper that reads serve-info.mjs, constructs the
 * opencode SDK instance with auth, and exports a singleton `getOpencodeSdk()`.
 *
 * Also exports `pingOpencodeSdk(info)` which uses the SDK's `health.check()`
 * (replaces the old `pingOpencodeServe` from serve-info.mjs; the old name
 * is kept as a backwards-compatible alias).
 *
 * v0.1.0 — initial implementation
 * v5.5.1 — added `getOpencodeSdkOrThrow()` and `subscribeToSession()`
 *           for the SDK-based bg spawner (see bg-spawner.mjs).
 */

import { readServeInfo, pingOpencodeServe as _pingOpencodeServe } from "./serve-info.mjs";

let _sdk = null;
let _sdkInfo = null;

/**
 * Lazily create and cache an opencode SDK instance from the active
 * serve-info. Returns `null` when no serve-info is available OR when
 * the SDK package is not installed (e.g. in a fresh checkout that
 * hasn't run `npm install` yet — the dashboard's serve-info read
 * succeeds but the dynamic import fails).
 *
 * @returns {Promise<import('@polderlabs/bizar-sdk').OpencodeSdk | null>}
 */
export async function getOpencodeSdk() {
  const info = readServeInfo();
  if (!info) return null;

  // Re-use existing instance if serve-info hasn't changed.
  if (_sdk && _sdkInfo && _sdkInfo.password === info.password && _sdkInfo.port === info.port) {
    return _sdk;
  }

  let createOpencodeSdk;
  try {
    const mod = await import("@polderlabs/bizar-sdk/opencode");
    createOpencodeSdk = mod.createOpencodeSdk;
    if (typeof createOpencodeSdk !== "function") createOpencodeSdk = null;
  } catch {
    // SDK package not installed / not built. Return null so the caller
    // can degrade gracefully. The bg-spawner converts this into an
    // `opencode_serve_unavailable` error.
    return null;
  }
  if (!createOpencodeSdk) return null;

  const sdk = await createOpencodeSdk({
    baseUrl: info.baseUrl,
    password: info.password,
    throwOnError: false,
  });

  _sdk = sdk;
  _sdkInfo = { password: info.password, port: info.port };
  return sdk;
}

/**
 * v5.5.1 — Same as {@link getOpencodeSdk} but throws when no SDK is
 * available. Use this from code paths that REQUIRE the opencode serve
 * (e.g. the SDK-based bg spawner) — callers want a clear error rather
 * than a silent `null` they have to remember to check.
 *
 * @returns {Promise<import('@polderlabs/bizar-sdk').OpencodeSdk>}
 */
export async function getOpencodeSdkOrThrow() {
  const sdk = await getOpencodeSdk();
  if (!sdk) {
    throw new Error(
      "opencode_serve_unavailable: no serve-info file found. " +
        "The opencode serve child is not running. Start it via `bizar serve` " +
        "or run an opencode session so the plugin can write serve-info.",
    );
  }
  return sdk;
}

/**
 * v5.5.1 — Subscribe to opencode SSE events for a single session. Thin
 * wrapper over `sdk.events.subscribe({ sessionID })` that closes the
 * subscription cleanly when the returned async iterable is broken.
 *
 * Returns `{ stream, close }` — `stream` is an `AsyncIterable` of
 * `OpencodeEventEnvelope` objects; `close()` aborts the underlying SSE
 * connection.
 *
 * @param {string} sessionId
 * @returns {Promise<AsyncIterable<unknown> & { close: () => void } | null>}
 */
export async function subscribeToSession(sessionId) {
  const sdk = await getOpencodeSdk();
  if (!sdk || !sessionId) return null;
  try {
    const sub = await sdk.events.subscribe({ sessionID: sessionId });
    return sub;
  } catch {
    return null;
  }
}

/**
 * Ping the opencode serve child using the SDK's health endpoint.
 * Falls back to TCP-connect ping if the SDK health check fails.
 *
 * @param {import('./serve-info.mjs').ServeInfo} info
 * @returns {Promise<boolean>}
 */
export async function pingOpencodeSdk(info) {
  const sdk = await getOpencodeSdk();
  if (!sdk) return false;
  try {
    const result = await sdk.health.check();
    if (result && typeof result === "object" && "ok" in result) {
      return result.ok === true;
    }
    // BizarError shape — fall back to TCP ping
    return pingOpencodeServe(info);
  } catch {
    return pingOpencodeServe(info);
  }
}

/**
 * Backwards-compatible alias for `pingOpencodeSdk`.
 * @deprecated Use `pingOpencodeSdk` instead.
 */
export const pingOpencodeServe = pingOpencodeSdk;