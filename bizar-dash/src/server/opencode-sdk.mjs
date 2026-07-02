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
 */

import { readServeInfo, pingOpencodeServe as _pingOpencodeServe } from "./serve-info.mjs";

let _sdk = null;
let _sdkInfo = null;

/**
 * Lazily create and cache an opencode SDK instance from the active
 * serve-info. Returns `null` when no serve-info is available.
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

  const { createOpencodeSdk } = await import("@polderlabs/bizar-sdk/opencode");
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
