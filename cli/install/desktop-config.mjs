/**
 * cli/install/desktop-config.mjs
 *
 * Desktop config library helpers for the installer.
 *
 *   mergeGatewayIntoDesktopConfig({ existing, baseUrl, apiKey, authScheme })
 *     -> pure merge; preserves every non-gateway key
 *   readActiveDesktopConfig({ env, fs })
 *     -> { activePath, config, exists: true } | { exists: false }
 *   backupActiveDesktopConfig({ path, fs, now })
 *     -> writes <path>.bak-<now>; returns the backup path
 *   detectManagedOverride({ env, fs })
 *     -> true when a platform-managed Claude Desktop settings file is
 *        present and non-empty (installer should refuse in that case
 *        unless the operator passes --force-targets desktop)
 *   writeDesktopConfigWithBackup({ path, next, fs, now })
 *     -> roundtrip read-after-write with rollback on failure (F5)
 *
 * See docs/specs/ralplan/installer-redesign-v2.md sec 4 + 7 for the
 * canonical contract. All I/O is parameterized so tests can drive the
 * same code paths against an in-memory filesystem.
 */

import nodeFs from 'node:fs';
import { join } from 'node:path';

import { resolveDesktopConfigLibrary } from '../config-paths.mjs';

/**
 * Keys the merge layer is FORBIDDEN to touch. Centralizing the list
 * keeps the contract auditable from a single location; if a future
 * Desktop release adds a new owner-managed key, appending it here is
 * the only edit needed to maintain the "never silently overwrite"
 * guarantee (Tension: Preserving `inferenceModels` verbatim ...).
 *
 *   - coworkEgressAllowedHosts: outbound egress allowlist
 *   - toolSearchEnabled:        tool-discovery toggle
 *   - telemetry keys:           *Telemetry* / analytics fields (prefix;
 *                                the merge layer simply never enumerates
 *                                them because it shallow-copies existing)
 *   - inferenceModels:          user-curated model picker
 *   - modelPrefer1mContext:     context-window preference
 *
 * The merge layer also NEVER injects `anthropicFamilyTier` on any
 * model entry -- that key is added only by the gateway surface, not by
 * the installer.
 */
const NEVER_TOUCH_KEYS = Object.freeze([
  'coworkEgressAllowedHosts',
  'toolSearchEnabled',
  'inferenceModels',
  'modelPrefer1mContext',
]);

/**
 * The four (at most) gateway keys the installer writes:
 *   - inferenceProvider           (defaults to 'gateway')
 *   - inferenceGatewayBaseUrl
 *   - inferenceGatewayApiKey
 *   - inferenceGatewayAuthScheme  (defaults to 'bearer')
 *
 * Everything else is preserved verbatim from `existing`.
 */
const GATEWAY_KEYS = Object.freeze([
  'inferenceProvider',
  'inferenceGatewayBaseUrl',
  'inferenceGatewayApiKey',
  'inferenceGatewayAuthScheme',
]);

/**
 * Merge wizard-collected gateway values into the existing Desktop
 * config object without disturbing any user-owned keys.
 *
 * F4 contract: when the wizard did not collect an explicit value for a
 * given gateway field (parameter is `undefined`), the existing value is
 * preserved verbatim. The caller can therefore pass an empty partial
 * ({}) to mean "keep whatever is there" and pass explicit values to
 * mean "set these".
 *
 * NEVER-TOUCH keys (coworkEgressAllowedHosts, toolSearchEnabled,
 * telemetry keys, inferenceModels, modelPrefer1mContext) are preserved
 * from `existing` and are NEVER replaced. The merge layer does NOT
 * inject `anthropicFamilyTier` on any model entry.
 *
 * @param {object} options
 * @param {object} [options.existing={}]      current Desktop config
 * @param {string} [options.inferenceProvider='gateway']
 * @param {string|undefined} [options.baseUrl]    wizard-collected gateway URL
 * @param {string|undefined} [options.apiKey]     wizard-collected gateway API key
 * @param {string|undefined} [options.authScheme] wizard-collected auth scheme
 * @returns {object} new config object with merged values
 */
export function mergeGatewayIntoDesktopConfig({
  existing = {},
  inferenceProvider = 'gateway',
  baseUrl,
  apiKey,
  authScheme,
} = {}) {
  // Shallow copy preserves every user-owned key (including the
  // never-touch keys) without enumeration -- the merge layer never
  // walks telemetry or inferenceModels.
  const preserved = { ...existing };

  // Always set the provider name when this function runs (the caller
  // is opting in to gateway-mode).
  preserved.inferenceProvider = inferenceProvider;

  if (baseUrl !== undefined) {
    preserved.inferenceGatewayBaseUrl = baseUrl;
  } else if (existing.inferenceGatewayBaseUrl !== undefined) {
    preserved.inferenceGatewayBaseUrl = existing.inferenceGatewayBaseUrl;
  }

  if (apiKey !== undefined) {
    preserved.inferenceGatewayApiKey = apiKey;
  } else if (existing.inferenceGatewayApiKey !== undefined) {
    preserved.inferenceGatewayApiKey = existing.inferenceGatewayApiKey;
  }

  if (authScheme !== undefined) {
    preserved.inferenceGatewayAuthScheme = authScheme;
  } else {
    preserved.inferenceGatewayAuthScheme = existing.inferenceGatewayAuthScheme ?? 'bearer';
  }

  return preserved;
}

/**
 * Read the active Claude Desktop config (the JSON pointed to by
 * `<configLibrary>/_meta.json#appliedId`).
 *
 * Returns the parsed config plus the resolved path so callers can pass
 * `activePath` straight to `backupActiveDesktopConfig` and
 * `writeDesktopConfigWithBackup` without recomputing the pointer.
 *
 * Folds every error mode (missing meta, malformed meta, appliedId not
 * in entries, active file missing, active file unparseable, active
 * payload not an object) into `{ exists: false }` so the wizard can
 * branch on presence without try/catch.
 *
 * @param {object} options
 * @param {object} [options.env=process.env]
 * @param {object} [options.fs=node:fs]
 * @param {string} [options.cwd=process.cwd()]
 * @returns {{ activePath: string, config: object, exists: true }
 *          | { exists: false }}
 */
export function readActiveDesktopConfig({
  env = process.env,
  fs = nodeFs,
  cwd = process.cwd(),
} = {}) {
  const configLibraryPath = resolveDesktopConfigLibrary({ env, cwd });
  const metaPath = join(configLibraryPath, '_meta.json');

  if (!fs.existsSync(metaPath)) return { exists: false };

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return { exists: false };
  }
  if (!meta || typeof meta.appliedId !== 'string' || !Array.isArray(meta.entries)) {
    return { exists: false };
  }

  const entry = meta.entries.find((e) => e && e.id === meta.appliedId);
  if (!entry) return { exists: false };

  const activePath = join(configLibraryPath, `${meta.appliedId}.json`);
  if (!fs.existsSync(activePath)) return { exists: false };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  } catch {
    return { exists: false };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { exists: false };
  }

  return { activePath, config, exists: true };
}

/**
 * Write a side-by-side backup of the active Desktop config:
 * `<id>.json.bak-<now>` (a sibling of the original, NOT inside the
 * configLibrary rotation). Returns the backup path so callers can
 * surface it in the wizard's success note.
 *
 * Reads the original file synchronously and writes it byte-for-byte
 * (UTF-8). Throws a clear error when the source path is missing or
 * cannot be read -- the wizard's execute step surfaces this as the
 * failed-state exit code 3 (see spec sec 5).
 *
 * @param {object} options
 * @param {string} options.path        absolute path to the active config
 * @param {object} [options.fs=node:fs]
 * @param {number} [options.now=Date.now()]
 * @returns {string} backup path
 */
export function backupActiveDesktopConfig({ path, fs = nodeFs, now = Date.now() } = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('backupActiveDesktopConfig: path is required');
  }
  const backupPath = `${path}.bak-${now}`;
  fs.writeFileSync(backupPath, fs.readFileSync(path, 'utf8'), 'utf8');
  return backupPath;
}

/**
 * Detect whether Claude Desktop is being driven by a platform-managed
 * settings file. When this returns `true`, the installer must refuse
 * the Desktop target unless the operator passes
 * `--force-targets desktop` (T1 resolution, sec 10 Risk).
 *
 * Platform paths:
 *   - linux:   /etc/claude-desktop/managed-settings.json
 *   - darwin:  /Library/Application Support/Claude-3p/managed-settings.json
 *   - win32:   %PROGRAMDATA%/Claude-3p/managed-settings.json
 *              (falls back to $HOME/AppData/Local/Claude-3p/managed-settings.json
 *               when PROGRAMDATA is unset)
 *   - other:   falls through to linux path
 *
 * The file must exist, be non-empty, and parse as JSON for the helper
 * to report `true`. Anything else -- missing, empty, malformed -- is
 * `false`.
 *
 * @param {object} options
 * @param {object} [options.env=process.env]
 * @param {object} [options.fs=node:fs]
 * @returns {boolean}
 */
export function detectManagedOverride({ env = process.env, fs = nodeFs } = {}) {
  const platform = process.platform;
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : '';
  let managedPath;
  if (platform === 'darwin') {
    managedPath = '/Library/Application Support/Claude-3p/managed-settings.json';
  } else if (platform === 'win32') {
    const programData = typeof env.PROGRAMDATA === 'string' && env.PROGRAMDATA.trim()
      ? env.PROGRAMDATA.trim()
      : (home ? `${home}/AppData/Local` : '');
    managedPath = `${programData}/Claude-3p/managed-settings.json`;
  } else {
    managedPath = '/etc/claude-desktop/managed-settings.json';
  }

  if (!managedPath || !fs.existsSync(managedPath)) return false;

  let raw;
  try {
    raw = fs.readFileSync(managedPath, 'utf8');
  } catch {
    return false;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;

  try {
    JSON.parse(raw);
  } catch {
    return false;
  }

  return true;
}

/**
 * Backup -> write -> verify roundtrip with rollback on any failure (F5
 * resolution, sec 5). The wizard's execute step uses this helper as
 * the single touchpoint for Desktop config writes so a partial-write
 * crash cannot leave the user with a half-written active config.
 *
 * On success: returns `{ ok: true, backupPath }`.
 * On write/verify failure: rolls back from the backup and rethrows a
 *   chained error so the caller can surface the failure mode without
 *   losing the backup path. If the rollback itself fails, both errors
 *   are surfaced in the message.
 *
 * @param {object} options
 * @param {string} options.path  absolute path to the active config
 * @param {object} options.next  the merged config object to write
 * @param {object} [options.fs=node:fs]
 * @param {number} [options.now=Date.now()]
 * @returns {{ ok: true, backupPath: string }}
 */
export function writeDesktopConfigWithBackup({ path, next, fs = nodeFs, now = Date.now() } = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('writeDesktopConfigWithBackup: path is required');
  }
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('writeDesktopConfigWithBackup: next must be a plain object');
  }

  const backupPath = backupActiveDesktopConfig({ path, fs, now });
  const serialized = JSON.stringify(next, null, 2);

  try {
    fs.writeFileSync(path, serialized, 'utf8');

    // Verify: re-read and parse. If the file landed truncated or
    // corrupted (e.g. ENOSPC mid-write), JSON.parse throws and we
    // roll back.
    const verifyRaw = fs.readFileSync(path, 'utf8');
    const verify = JSON.parse(verifyRaw);

    // Spot-check the gateway keys the caller intended to set. If an
    // external process clobbered the file between writeFileSync and
    // readFileSync, we still treat that as a failure rather than
    // silently accept the surprise.
    if (verify.inferenceGatewayBaseUrl !== next.inferenceGatewayBaseUrl
        || verify.inferenceGatewayApiKey !== next.inferenceGatewayApiKey) {
      throw new Error('roundtrip mismatch: expected gateway keys not present after write');
    }

    return { ok: true, backupPath };
  } catch (err) {
    let rollbackErr;
    try {
      fs.writeFileSync(path, fs.readFileSync(backupPath, 'utf8'), 'utf8');
    } catch (rbErr) {
      rollbackErr = rbErr;
    }
    if (rollbackErr) {
      throw new Error(
        `writeDesktopConfigWithBackup: write failed AND rollback failed: ${err && err.message ? err.message : String(err)}; rollback: ${rollbackErr.message || String(rollbackErr)}`
      );
    }
    throw new Error(
      `writeDesktopConfigWithBackup: rolled back from ${backupPath}: ${err && err.message ? err.message : String(err)}`
    );
  }
}

// Exported for tests + future introspection; not part of the wizard's
// public surface.
export const _internal = Object.freeze({
  NEVER_TOUCH_KEYS,
  GATEWAY_KEYS,
});
