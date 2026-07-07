/**
 * src/server/cline-sdk.mjs
 *
 * Dashboard-side wrapper that reads serve-info.mjs, constructs the
 * cline SDK instance with auth, and exports a singleton `getClineSdk()`.
 *
 * Also exports `pingClineSdk(info)` which uses the SDK's `health.check()`
 * (replaces the old `pingClineServe` from serve-info.mjs; the old name
 * is kept as a backwards-compatible alias).
 *
 * v0.1.0 — initial implementation
 * v5.5.1 — added `getClineSdkOrThrow()` and `subscribeToSession()`
 *           for the SDK-based bg spawner (see bg-spawner.mjs).
 */

import { readServeInfo, pingClineServe as _pingClineServe } from "./serve-info.mjs";

let _sdk = null;
let _sdkInfo = null;

/**
 * Lazily create and cache a Cline SDK instance from the active
 * serve-info. Returns `null` when no serve-info is available OR when
 * the SDK package is not installed (e.g. in a fresh checkout that
 * hasn't run `npm install` yet — the dashboard's serve-info read
 * succeeds but the dynamic import fails).
 *
 * @returns {Promise<import('@polderlabs/bizar-sdk').ClineSdk | null>}
 */
export async function getClineSdk() {
  const info = readServeInfo();
  if (!info) return null;

  // Re-use existing instance if serve-info hasn't changed.
  if (_sdk && _sdkInfo && _sdkInfo.password === info.password && _sdkInfo.port === info.port) {
    return _sdk;
  }

  let createClineSdk;
  try {
    const mod = await import("@polderlabs/bizar-sdk/cline");
    createClineSdk = mod.createClineSdk;
    if (typeof createClineSdk !== "function") createClineSdk = null;
  } catch {
    // SDK package not installed / not built. Return null so the caller
    // can degrade gracefully. The bg-spawner converts this into an
    // `cline_serve_unavailable` error.
    return null;
  }
  if (!createClineSdk) return null;

  const sdk = await createClineSdk({
    baseUrl: info.baseUrl,
    password: info.password,
    throwOnError: false,
  });

  _sdk = sdk;
  _sdkInfo = { password: info.password, port: info.port };
  return sdk;
}

/**
 * v5.5.1 — Same as {@link getClineSdk} but throws when no SDK is
 * available. Use this from code paths that REQUIRE the cline serve
 * (e.g. the SDK-based bg spawner) — callers want a clear error rather
 * than a silent `null` they have to remember to check.
 *
 * @returns {Promise<import('@polderlabs/bizar-sdk').ClineSdk>}
 */
export async function getClineSdkOrThrow() {
  const sdk = await getClineSdk();
  if (!sdk) {
    throw new Error(
      "cline_serve_unavailable: no serve-info file found. " +
        "The cline serve child is not running. Start it via `bizar serve` " +
        "or run a Cline session so the plugin can write serve-info.",
    );
  }
  return sdk;
}

/**
 * v5.5.1 — Subscribe to cline SSE events for a single session. Thin
 * wrapper over `sdk.events.subscribe({ sessionID })` that closes the
 * subscription cleanly when the returned async iterable is broken.
 *
 * Returns `{ stream, close }` — `stream` is an `AsyncIterable` of
 * `ClineEventEnvelope` objects; `close()` aborts the underlying SSE
 * connection.
 *
 * @param {string} sessionId
 * @returns {Promise<AsyncIterable<unknown> & { close: () => void } | null>}
 */
export async function subscribeToSession(sessionId) {
  const sdk = await getClineSdk();
  if (!sdk || !sessionId) return null;
  try {
    const sub = await sdk.events.subscribe({ sessionID: sessionId });
    return sub;
  } catch {
    return null;
  }
}

/**
 * Ping the cline serve child using the SDK's health endpoint.
 * Falls back to TCP-connect ping if the SDK health check fails.
 *
 * @param {import('./serve-info.mjs').ServeInfo} info
 * @returns {Promise<boolean>}
 */
export async function pingClineSdk(info) {
  const sdk = await getClineSdk();
  if (!sdk) return false;
  try {
    const result = await sdk.health.check();
    if (result && typeof result === "object" && "ok" in result) {
      return result.ok === true;
    }
    // BizarError shape — fall back to TCP ping
    return pingClineServe(info);
  } catch {
    return pingClineServe(info);
  }
}

/**
 * Backwards-compatible alias for `pingClineSdk`.
 * @deprecated Use `pingClineSdk` instead.
 */
export const pingClineServe = pingClineSdk;