/**
 * src/server/plugins/store.mjs
 *
 * v5.0.0 — Plugin store: install / uninstall / list / update / invoke.
 *
 * Plugins live under `~/.local/share/bizar/plugins/<id>/` by default.
 * Override with the `BIZAR_PLUGIN_HOME` env var (used by tests).
 *
 * Disk layout:
 *   $PLUGIN_HOME/
 *     installed.json                  # registry of every installed plugin
 *     <id>/
 *       plugin.json                   # the plugin's manifest (from tarball)
 *       index.js                      # the plugin's main entry (from tarball)
 *       ...                           # whatever else the tarball shipped
 *
 * `installed.json` shape:
 *   {
 *     "plugins": [
 *       {
 *         "id": "vercel-deploy",
 *         "version": "1.0.0",
 *         "installedAt": "2026-...",
 *         "updatedAt": "2026-...",
 *         "config": { "apiKey": "..." },
 *         "permissions": ["net"]
 *       }
 *     ]
 *   }
 *
 * Install flow:
 *   1. Look up plugin in the registry.
 *   2. Download tarball (stream to a tmp file).
 *   3. Verify SHA-256 matches registry.checksum.
 *   4. Extract into a staging dir.
 *   5. Validate plugin.json (must declare id+name+version+main).
 *   6. Atomically move into $PLUGIN_HOME/<id>/.
 *   7. Register in installed.json (merging any existing config).
 *   8. Smoke-test: load the plugin in the sandbox and call `init` if
 *      exported. Failures here don't roll back the install — they're
 *      logged so the operator sees them.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  createWriteStream,
  createReadStream,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as pathResolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { extract as tarExtract, pack as tarPack } from 'tar-stream';

import * as registry from './registry.mjs';
import { loadPlugin, readManifest, safeInvoke } from './sandbox.mjs';
import * as logger from '../logger.mjs';

/**
 * Resolve the plugin home directory. Tests set BIZAR_PLUGIN_HOME
 * to a tmpdir before importing this module.
 */
export function getPluginHome() {
  if (process.env.BIZAR_PLUGIN_HOME && process.env.BIZAR_PLUGIN_HOME.trim()) {
    return process.env.BIZAR_PLUGIN_HOME.trim();
  }
  const home = process.env.HOME || '/tmp';
  const xdgData = process.env.XDG_DATA_HOME;
  const base = xdgData && xdgData.trim()
    ? join(xdgData, 'bizar', 'plugins')
    : join(home, '.local', 'share', 'bizar', 'plugins');
  return base;
}

/** Path to installed.json (the plugin registry on this machine). */
export function getInstalledJsonPath() {
  return join(getPluginHome(), 'installed.json');
}

/** Path to a specific plugin's install dir. */
export function getPluginDir(id) {
  return join(getPluginHome(), id);
}

/**
 * Atomic write: serialize `data` to `filePath` via a temp + rename.
 * Prevents half-written JSON from corrupting installed.json if the
 * process dies mid-write.
 *
 * @param {string} filePath
 * @param {unknown} data
 */
function atomicWriteJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Safe JSON read with fallback.
 *
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @returns {T}
 */
function safeReadJSON(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Read installed.json. Returns `{ plugins: [] }` if missing/malformed.
 *
 * @returns {{ plugins: InstalledPlugin[] }}
 */
export function readInstalled() {
  return safeReadJSON(getInstalledJsonPath(), { plugins: [] });
}

/**
 * Persist the entire installed.json document. Used after install /
 * uninstall / config change. Merges with any existing entries so
 * partial writes don't drop sibling plugins.
 *
 * @param {{ plugins: InstalledPlugin[] }} doc
 */
function writeInstalled(doc) {
  if (!doc || !Array.isArray(doc.plugins)) {
    throw new Error('writeInstalled: doc.plugins must be an array');
  }
  atomicWriteJson(getInstalledJsonPath(), doc);
}

/**
 * Find the installed entry for a given id.
 *
 * @param {string} id
 * @returns {InstalledPlugin | null}
 */
export function getInstalled(id) {
  const doc = readInstalled();
  return doc.plugins.find((p) => p.id === id) || null;
}

/**
 * List every installed plugin.
 *
 * @returns {InstalledPlugin[]}
 */
export function listInstalled() {
  return readInstalled().plugins;
}

/**
 * Download a URL to a local file path. Streams to disk so a large
 * plugin tarball doesn't sit in memory. Returns the downloaded path.
 *
 * @param {string} url
 * @param {string} dest
 * @param {typeof globalThis.fetch} [fetchImpl]
 */
async function downloadTo(url, dest, fetchImpl) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'bizar-plugin-installer/5.0' },
  });
  if (!res.ok) {
    const err = new Error(
      `tarball download failed: ${url} returned ${res.status} ${res.statusText}`,
    );
    err.code = 'download_failed';
    err.status = res.status;
    throw err;
  }
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
  return dest;
}

/**
 * Stream a file's SHA-256 hex digest. Used internally by installPlugin
 * to verify the tarball; also exported so callers can compute a
 * checksum independently.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha256File(filePath) {
  return new Promise((resolveP, rejectP) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', rejectP);
    stream.on('end', () => resolveP(hash.digest('hex')));
  });
}

/**
 * Extract a `.tar.gz` (or plain `.tar`) tarball into `cwd`.
 *
 * We use `tar-stream` + `node:zlib` rather than `node:tar` (which is
 * experimental and missing from some Node 24 builds). `tar-stream`
 * gives us per-entry control: we validate each entry path to defend
 * against "Zip Slip"-style attacks (entries whose names try to escape
 * `cwd` via `../`).
 *
 * @param {string} tarballPath
 * @param {string} cwd
 */
async function extractTarball(tarballPath, cwd) {
  mkdirSync(cwd, { recursive: true });
  const isGzip = /\.t?gz$/i.test(tarballPath);
  const source = createReadStream(tarballPath);
  const gunzipped = isGzip ? source.pipe(createGunzip()) : source;
  const extractor = tarExtract();
  // Track every entry's write Promise so we can await all of them
  // before reporting success. The `'finish'` event fires as soon as
  // the source stream ends, but async entry handlers (file writes)
  // may still be in flight at that point.
  const pending = [];
  await new Promise((resolveP, rejectP) => {
    extractor.on('entry', (header, stream, next) => {
      const handle = (async () => {
        try {
          if (!header.name || header.name.includes('\0')) {
            throw new Error(`tarball contains invalid entry name: ${JSON.stringify(header.name)}`);
          }
          const dest = pathResolve(cwd, header.name);
          const rel = pathResolve(cwd, '.') + '/';
          if (dest !== pathResolve(cwd, '.') && !dest.startsWith(rel)) {
            throw new Error(`tarball entry escapes cwd: ${header.name}`);
          }
          if (header.type === 'directory') {
            mkdirSync(dest, { recursive: true });
            stream.resume();
            await new Promise((r) => stream.on('end', r));
            return;
          }
          mkdirSync(dirname(dest), { recursive: true });
          await pipeline(stream, createWriteStream(dest));
        } catch (err) {
          rejectP(err);
        } finally {
          next();
        }
      })();
      pending.push(handle);
    });
    extractor.on('finish', async () => {
      try {
        await Promise.all(pending);
        resolveP();
      } catch (err) {
        rejectP(err);
      }
    });
    extractor.on('error', rejectP);
    gunzipped.on('error', rejectP);
    gunzipped.pipe(extractor);
  });
}

/**
 * Build a gzipped tarball from a directory. Used by tests; the
 * production install flow only reads tarballs, never creates them.
 *
 * @param {string} srcDir   absolute path of the directory to archive
 * @param {string} outFile  where to write the .tar.gz
 * @param {object} [opts]
 * @param {string} [opts.prefix]  strip this prefix from entry names
 */
export async function _buildTarball(srcDir, outFile, opts = {}) {
  // Used in tests; also handy as a developer util. Implementation
  // intentionally lives here so callers don't need a separate tar
  // dependency.
  const { readdirSync, statSync } = await import('node:fs');
  const packer = tarPack();
  const gzip = createGzip();
  const out = createWriteStream(outFile);
  const finished = pipeline(packer, gzip, out);

  async function addEntry(absPath, nameInArchive) {
    const st = statSync(absPath);
    if (st.isDirectory()) {
      packer.entry({ name: `${nameInArchive}/` });
      for (const child of readdirSync(absPath)) {
        await addEntry(join(absPath, child), `${nameInArchive}/${child}`);
      }
      return;
    }
    packer.entry({ name: nameInArchive, size: st.size }, readFileSync(absPath));
  }
  await addEntry(srcDir, opts.prefix || '');
  packer.finalize();
  await finished;
  return outFile;
}

/**
 * Find the directory containing `plugin.json` inside an extracted
 * tree. Tarballs often wrap everything in a top-level folder; we
 * allow that and return the inner dir.
 *
 * Returns null if no plugin.json is found within 2 levels of cwd.
 *
 * @param {string} cwd
 * @returns {string | null}
 */
function findPluginManifestDir(cwd) {
  // First check cwd directly.
  if (existsSync(join(cwd, 'plugin.json'))) return cwd;
  // Then check each top-level subdir.
  let entries;
  try {
    entries = readdirSync(cwd, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(cwd, e.name);
    if (existsSync(join(candidate, 'plugin.json'))) return candidate;
  }
  return null;
}

/**
 * Install a plugin from the registry.
 *
 * @param {string} pluginId
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]  reinstall even if already installed
 * @param {string} [opts.url]            override the registry URL
 * @param {typeof globalThis.fetch} [opts.fetchImpl]
 * @returns {Promise<InstalledPlugin>}
 */
export async function installPlugin(pluginId, { force = false, url, fetchImpl } = {}) {
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('installPlugin: pluginId is required');
  }
  const childLog = logger.child({ module: 'plugin-store', pluginId });
  childLog.info('installing plugin');

  // 1. Already-installed check (unless force)
  const existing = getInstalled(pluginId);
  if (existing && !force) {
    const err = new Error(
      `plugin "${pluginId}" is already installed (v${existing.version}); pass { force: true } to reinstall`,
    );
    err.code = 'already_installed';
    err.existing = existing;
    throw err;
  }

  // 2. Look up in the registry.
  const entry = await registry.getPlugin(pluginId, { url, fetch: fetchImpl });
  if (!entry) {
    const err = new Error(`plugin "${pluginId}" not found in registry`);
    err.code = 'not_found';
    throw err;
  }

  // 3. Download to a unique tmp file.
  const tmpTarball = join(tmpdir(), `bizar-plugin-${pluginId}-${Date.now()}-${randomUUID()}.tar.gz`);
  await downloadTo(entry.tarball, tmpTarball, fetchImpl);

  // 4. Verify checksum BEFORE extracting anything.
  const expected = entry.checksum.replace(/^sha256:/, '');
  const actual = await sha256File(tmpTarball);
  if (actual !== expected) {
    rmSync(tmpTarball, { force: true });
    const err = new Error(
      `checksum mismatch for "${pluginId}": expected ${expected}, got ${actual}`,
    );
    err.code = 'checksum_mismatch';
    throw err;
  }

  // 5. Extract to a staging dir, find plugin.json, validate.
  const stagingDir = join(tmpdir(), `bizar-plugin-stage-${pluginId}-${randomUUID()}`);
  try {
    await extractTarball(tmpTarball, stagingDir);
    const manifestDir = findPluginManifestDir(stagingDir);
    if (!manifestDir) {
      throw new Error(
        `tarball for "${pluginId}" contains no plugin.json at the root or one level deep`,
      );
    }
    const manifestPath = join(manifestDir, 'plugin.json');
    const manifest = readManifest(manifestPath);
    if (manifest.id !== pluginId) {
      throw new Error(
        `plugin.json id mismatch: registry says "${pluginId}" but plugin.json says "${manifest.id}"`,
      );
    }

    // 6. Move staging → real plugin dir (atomic rename when possible).
    const pluginDir = getPluginDir(pluginId);
    if (existsSync(pluginDir)) {
      // Wipe the existing dir so we get a clean install. We keep
      // installed.json's previous config separately.
      rmSync(pluginDir, { recursive: true, force: true });
    }
    renameSync(manifestDir, pluginDir);
    childLog.info('extracted plugin', { to: pluginDir, version: entry.version });

    // 7. Register in installed.json (merge with previous config).
    const prevConfig = (existing && existing.config) || {};
    const installed = {
      id: pluginId,
      version: entry.version,
      installedAt: (existing && existing.installedAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: prevConfig,
      permissions: entry.permissions || [],
      path: pluginDir,
    };
    upsertInstalled(installed);

    // 8. Smoke test: load the plugin in the sandbox.
    try {
      const loaded = await loadPlugin({
        mainFile: pathResolve(pluginDir, manifest.main),
        config: prevConfig,
        permissions: entry.permissions,
        pluginId,
        pluginRoot: pluginDir,
        fetchImpl,
      });
      childLog.info('plugin loaded into sandbox', {
        methods: Object.keys(loaded.exports),
        invalidPermissions: loaded.invalidPermissions,
      });
      if (typeof loaded.exports.init === 'function') {
        const r = await safeInvoke(loaded, 'init', [], 10_000);
        if (!r.ok) {
          childLog.warn('plugin init() failed', { error: r.error, code: r.code });
        }
      }
    } catch (err) {
      childLog.warn('plugin sandbox smoke-test failed', {
        error: err.message,
        code: err.code,
      });
    }
    return installed;
  } finally {
    // Clean up staging + tarball regardless of outcome.
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(tmpTarball, { force: true });
  }
}

/**
 * Insert or update an installed entry.
 *
 * @param {InstalledPlugin} entry
 */
function upsertInstalled(entry) {
  const doc = readInstalled();
  const idx = doc.plugins.findIndex((p) => p.id === entry.id);
  if (idx === -1) doc.plugins.push(entry);
  else doc.plugins[idx] = entry;
  writeInstalled(doc);
}

/**
 * Remove a plugin from disk + installed.json.
 *
 * @param {string} pluginId
 * @returns {boolean}  true if removed, false if wasn't installed
 */
export function uninstallPlugin(pluginId) {
  if (!pluginId) return false;
  const doc = readInstalled();
  const idx = doc.plugins.findIndex((p) => p.id === pluginId);
  if (idx === -1) return false;
  doc.plugins.splice(idx, 1);
  writeInstalled(doc);
  const dir = getPluginDir(pluginId);
  rmSync(dir, { recursive: true, force: true });
  logger.info('plugin uninstalled', { module: 'plugin-store', pluginId });
  return true;
}

/**
 * Update a plugin to the latest registry version. Equivalent to
 * installPlugin(force: true) but preserves config.
 *
 * @param {string} pluginId
 * @param {object} [opts]
 * @param {typeof globalThis.fetch} [opts.fetchImpl]
 * @returns {Promise<{ from: string, to: string, plugin: InstalledPlugin }>}
 */
export async function updatePlugin(pluginId, opts = {}) {
  const existing = getInstalled(pluginId);
  if (!existing) {
    const err = new Error(`plugin "${pluginId}" is not installed`);
    err.code = 'not_installed';
    throw err;
  }
  const prevVersion = existing.version;
  const prevConfig = existing.config || {};
  const installed = await installPlugin(pluginId, { ...opts, force: true });
  // installPlugin with force: true wipes config; we restore it here.
  if (Object.keys(prevConfig).length) {
    installed.config = prevConfig;
    upsertInstalled(installed);
  }
  return { from: prevVersion, to: installed.version, plugin: installed };
}

/**
 * Set a config value (dot-path) on an installed plugin. Persists
 * immediately so the value survives a dashboard restart.
 *
 * @param {string} pluginId
 * @param {string} key
 * @param {unknown} value
 */
export function setConfig(pluginId, key, value) {
  const existing = getInstalled(pluginId);
  if (!existing) {
    const err = new Error(`plugin "${pluginId}" is not installed`);
    err.code = 'not_installed';
    throw err;
  }
  const parts = key.split('.');
  let cur = existing.config;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  existing.updatedAt = new Date().toISOString();
  upsertInstalled(existing);
  return existing;
}

/**
 * Replace the entire config object on an installed plugin. Used by
 * `PUT /api/plugins/:id` with `action: 'config'`. Returns the
 * updated installed entry.
 *
 * @param {string} pluginId
 * @param {Record<string, unknown>} config
 */
export function replaceConfig(pluginId, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    const err = new Error('config must be a plain object');
    err.code = 'bad_request';
    throw err;
  }
  const existing = getInstalled(pluginId);
  if (!existing) {
    const err = new Error(`plugin "${pluginId}" is not installed`);
    err.code = 'not_installed';
    throw err;
  }
  existing.config = JSON.parse(JSON.stringify(config));
  existing.updatedAt = new Date().toISOString();
  upsertInstalled(existing);
  return existing;
}

/**
 * Write the entire installed.json document. Exported so route handlers
 * that need to mutate the doc outside of upsertInstalled can do so
 * (e.g. bulk admin operations added in future versions).
 *
 * @param {{ plugins: InstalledPlugin[] }} doc
 */
export { writeInstalled as _writeInstalled };

/**
 * Load a plugin from disk and invoke a method inside the sandbox.
 *
 * @param {string} pluginId
 * @param {string} method
 * @param {unknown[]} [args]
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {typeof globalThis.fetch} [opts.fetchImpl]
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string, code?: string }>}
 */
export async function invokePlugin(pluginId, method, args = [], opts = {}) {
  const installed = getInstalled(pluginId);
  if (!installed) {
    return { ok: false, error: `plugin "${pluginId}" is not installed`, code: 'not_installed' };
  }
  const pluginDir = getPluginDir(pluginId);
  if (!existsSync(join(pluginDir, 'plugin.json'))) {
    return {
      ok: false,
      error: `plugin "${pluginId}" has no plugin.json at ${pluginDir}`,
      code: 'corrupt_install',
    };
  }
  let manifest;
  try {
    manifest = readManifest(join(pluginDir, 'plugin.json'));
  } catch (err) {
    return { ok: false, error: err.message, code: 'bad_manifest' };
  }
  const mainFile = pathResolve(pluginDir, manifest.main);
  let loaded;
  try {
    loaded = await loadPlugin({
      mainFile,
      config: installed.config || {},
      permissions: installed.permissions,
      pluginId,
      pluginRoot: pluginDir,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || 'load_error' };
  }
  return safeInvoke(loaded, method, args, opts.timeoutMs);
}

/**
 * Ensure the plugin home directory exists. Idempotent.
 */
export function ensurePluginHome() {
  mkdirSync(getPluginHome(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Type doc — not enforced at runtime, just for editor intellisense.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string,
 *   version: string,
 *   installedAt: string,
 *   updatedAt: string,
 *   config: Record<string, unknown>,
 *   permissions: string[],
 *   path: string
 * }} InstalledPlugin
 */