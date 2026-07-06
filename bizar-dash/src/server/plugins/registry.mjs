/**
 * src/server/plugins/registry.mjs
 *
 * v5.0.0 — Plugin marketplace registry client.
 *
 * The marketplace registry is a single JSON document served over HTTP
 * (default: raw.githubusercontent.com) listing every installable plugin.
 * We fetch + parse + validate the shape, then cache the parsed value
 * for an hour so a dashboard boot doesn't hammer GitHub.
 *
 * Shape (see README for the full schema):
 *   {
 *     "version": 1,
 *     "updatedAt": "2026-...",
 *     "plugins": [
 *       {
 *         "id": "vercel-deploy",
 *         "name": "Vercel Deploy",
 *         "version": "1.0.0",
 *         "description": "...",
 *         "author": "...",
 *         "category": "deploy",
 *         "tags": ["vercel", "deploy"],
 *         "homepage": "https://...",
 *         "tarball": "https://.../vercel-deploy-1.0.0.tar.gz",
 *         "checksum": "sha256:abcdef...",
 *         "permissions": ["net", "fs:read"],
 *         "minBizarVersion": "4.9.0"
 *       }
 *     ]
 *   }
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from '../logger.mjs';

/**
 * Default registry URL. Override with `BIZAR_REGISTRY_URL` env var.
 *
 * Raw GitHub is intentional: the registry is small, static, and
 * versioned by commit (we point to `main/registry.json`). For private
 * deployments, point this at an internal CDN or S3 bucket.
 */
const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/DrB0rk/bizar-mods/main/registry.json';

/**
 * Fallback registry URLs tried in order when the primary URL fails.
 * BIZAR_REGISTRY_URL env var takes precedence over all if set.
 */
const FALLBACK_REGISTRY_URLS = [
  'https://bizar-plugins.bork.deno.net/registry.json',
];

/**
 * All registry URLs in priority order: explicit override (if any) first,
 * then BIZAR_REGISTRY_URL, then defaults including fallbacks.
 * @returns {string[]}
 */
function getRegistryUrls() {
  const urls = [];
  if (process.env.BIZAR_REGISTRY_URL && process.env.BIZAR_REGISTRY_URL.trim()) {
    urls.push(process.env.BIZAR_REGISTRY_URL.trim());
  }
  urls.push(DEFAULT_REGISTRY_URL, ...FALLBACK_REGISTRY_URLS);
  return urls;
}

/** Path to the on-disk registry cache. */
function getCacheFilePath() {
  const homedir = process.env.HOME || process.env.USERPROFILE || tmpdir();
  const cacheDir = join(homedir, '.cache', 'bizar');
  return join(cacheDir, 'registry.json');
}

/**
 * Read the registry from the on-disk cache file.
 * Returns null if the file doesn't exist or can't be parsed.
 * @returns {Promise<RegistryShape | null>}
 */
export async function readRegistryCache() {
  try {
    const cachePath = getCacheFilePath();
    if (!existsSync(cachePath)) return null;
    const raw = readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write the registry to the on-disk cache file.
 * @param {RegistryShape} data
 */
export function writeRegistryCache(data) {
  try {
    const cachePath = getCacheFilePath();
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.warn('failed to write registry cache', { err: err.message });
  }
}

/** How long a cached registry is considered fresh. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * In-memory cache shared across all callers in this process. Tests
 * can call `__resetCache()` to force a re-fetch.
 */
let _cache = null; // { fetchedAt: number, url: string, data: RegistryShape }

/**
 * Resolve the registry URL: explicit override > env > default.
 *
 * @param {string} [override]
 * @returns {string}
 */
export function getRegistryUrl(override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (process.env.BIZAR_REGISTRY_URL && process.env.BIZAR_REGISTRY_URL.trim()) {
    return process.env.BIZAR_REGISTRY_URL.trim();
  }
  return DEFAULT_REGISTRY_URL;
}

/**
 * Validate the parsed registry JSON shape. Throws a structured Error
 * (`.code = 'invalid_registry'`) on any required-field violation. We
 * are deliberately lenient on optional fields — missing `tags`,
 * `homepage`, etc. are fine.
 *
 * @param {unknown} data
 * @returns {RegistryShape}
 */
export function validateRegistry(data) {
  if (!data || typeof data !== 'object') {
    const err = new Error('registry root must be an object');
    err.code = 'invalid_registry';
    throw err;
  }
  const root = /** @type {any} */ (data);
  if (root.version !== 1) {
    const err = new Error(`registry.version must be 1 (got ${root.version})`);
    err.code = 'invalid_registry';
    throw err;
  }
  if (typeof root.updatedAt !== 'string') {
    const err = new Error('registry.updatedAt must be a string');
    err.code = 'invalid_registry';
    throw err;
  }
  if (!Array.isArray(root.plugins)) {
    const err = new Error('registry.plugins must be an array');
    err.code = 'invalid_registry';
    throw err;
  }
  /** @type {string[]} */
  const seenIds = new Set();
  for (let i = 0; i < root.plugins.length; i++) {
    const p = root.plugins[i];
    if (!p || typeof p !== 'object') {
      const err = new Error(`registry.plugins[${i}] must be an object`);
      err.code = 'invalid_registry';
      throw err;
    }
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) {
      const err = new Error(
        `registry.plugins[${i}].id must be a kebab-case string (got ${JSON.stringify(p.id)})`,
      );
      err.code = 'invalid_registry';
      throw err;
    }
    if (seenIds.has(p.id)) {
      const err = new Error(`registry.plugins[${i}].id "${p.id}" is duplicated`);
      err.code = 'invalid_registry';
      throw err;
    }
    seenIds.add(p.id);
    for (const required of ['name', 'version', 'tarball', 'checksum']) {
      if (typeof p[required] !== 'string' || !p[required]) {
        const err = new Error(
          `registry.plugins[${i}].${required} must be a non-empty string`,
        );
        err.code = 'invalid_registry';
        throw err;
      }
    }
    if (typeof p.tarball !== 'string' || !/^https?:\/\//.test(p.tarball)) {
      const err = new Error(
        `registry.plugins[${i}].tarball must be an http(s) URL (got ${JSON.stringify(p.tarball)})`,
      );
      err.code = 'invalid_registry';
      throw err;
    }
    if (typeof p.checksum !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(p.checksum)) {
      const err = new Error(
        `registry.plugins[${i}].checksum must be sha256:<64-hex> (got ${JSON.stringify(p.checksum)})`,
      );
      err.code = 'invalid_registry';
      throw err;
    }
    if (!Array.isArray(p.permissions)) {
      const err = new Error(
        `registry.plugins[${i}].permissions must be an array`,
      );
      err.code = 'invalid_registry';
      throw err;
    }
  }
  return /** @type {RegistryShape} */ (root);
}

/**
 * Fetch the registry, returning the validated parsed shape.
 *
 * When no explicit URL is provided, iterates through all registry URLs
 * (BIZAR_REGISTRY_URL env var > defaults > fallbacks) until one succeeds.
 * On complete failure, falls back to the on-disk cache file.
 *
 * Cache: in-memory for 1 hour per URL. A `force: true` option bypasses
 * the cache (used by the `update` CLI subcommand).
 *
 * @param {object} [opts]
 * @param {string} [opts.url]   override the URL (uses all fallbacks if omitted)
 * @param {boolean} [opts.force] skip the cache
 * @param {typeof globalThis.fetch} [opts.fetch] fetch override (tests)
 * @returns {Promise<RegistryShape>}
 */
export async function fetchRegistry({ url, force = false, fetch: fetchImpl } = {}) {
  const now = Date.now();
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }

  // Determine which URLs to try: explicit url takes priority, otherwise use all
  const urls = url ? [url] : getRegistryUrls();

  // Check in-memory cache first (only valid for the first URL in the list)
  if (!force && _cache && urls.includes(_cache.url)) {
    if (now - _cache.fetchedAt < CACHE_TTL_MS) {
      return _cache.data;
    }
  }

  let lastError;
  for (const registryUrl of urls) {
    try {
      const res = await fetchFn(registryUrl, {
        headers: { 'User-Agent': 'bizar-registry-client/5.0' },
      });
      if (!res.ok) {
        logger.warn('registry fetch failed, trying next', {
          url: registryUrl,
          status: res.status,
          statusText: res.statusText,
        });
        lastError = new Error(
          `registry fetch returned ${res.status} ${res.statusText} from ${registryUrl}`,
        );
        lastError.code = 'registry_unreachable';
        lastError.status = res.status;
        continue;
      }
      let json;
      try {
        json = await res.json();
      } catch (err) {
        logger.warn('registry fetch failed, trying next', {
          url: registryUrl,
          err: err.message,
        });
        lastError = new Error(
          `registry at ${registryUrl} is not valid JSON: ${err.message}`,
        );
        lastError.code = 'invalid_registry';
        lastError.cause = err;
        continue;
      }
      const validated = validateRegistry(json);
      _cache = { fetchedAt: now, url: registryUrl, data: validated };
      writeRegistryCache(validated);
      return validated;
    } catch (err) {
      logger.warn('registry fetch failed, trying next', {
        url: registryUrl,
        err: err.message,
      });
      lastError = err;
    }
  }

  // All URLs failed — try the on-disk cache as last resort,
  // but only when no explicit URL was provided (disk cache is not
  // meaningful when the caller specified a particular endpoint).
  if (!url) {
    const cached = await readRegistryCache();
    if (cached) {
      logger.warn('all registry URLs failed, using disk cache');
      _cache = { fetchedAt: now, url: urls[0], data: cached };
      return cached;
    }
  }

  // Nothing worked — throw the last error with a helpful message
  const wrap = new Error(
    `registry fetch failed for all URLs. Last error: ${lastError?.message}`,
  );
  wrap.code = 'registry_unreachable';
  wrap.cause = lastError;
  throw wrap;
}

/**
 * Reset the in-memory cache. Tests use this to force a re-fetch after
 * stubbing globalThis.fetch. Production code shouldn't need it.
 */
export function __resetCache() {
  _cache = null;
}

/**
 * Normalize a string for fuzzy search comparison. Lowercases, strips
 * punctuation, collapses whitespace.
 *
 * @param {string} s
 */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Does the plugin match the query? Match is by substring on name +
 * description + id, after normalization. Empty query matches all.
 *
 * @param {RegistryPlugin} plugin
 * @param {string} query
 */
function matchesQuery(plugin, query) {
  if (!query) return true;
  const n = normalize(query);
  const haystack = `${plugin.id} ${plugin.name} ${plugin.description || ''} ${(plugin.tags || []).join(' ')}`;
  const h = normalize(haystack);
  // Substring match is enough for a v1 marketplace. v2 can swap in fuse.js.
  return h.includes(n);
}

/**
 * Search the registry. Returns the matching plugins in registry order.
 *
 * @param {string} [query]
 * @param {object} [opts]
 * @param {string} [opts.category] filter by exact category
 * @param {string} [opts.tag]      filter by tag (exact)
 * @param {string} [opts.url]      registry URL override
 * @returns {Promise<RegistryPlugin[]>}
 */
export async function searchPlugins(query = '', opts = {}) {
  const registry = await fetchRegistry({ url: opts.url });
  const { category, tag } = opts;
  return registry.plugins.filter((p) => {
    if (category && p.category !== category) return false;
    if (tag && !(Array.isArray(p.tags) && p.tags.includes(tag))) return false;
    if (!matchesQuery(p, query)) return false;
    return true;
  });
}

/**
 * Get a single plugin by id from the registry. Returns null if not found.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {string} [opts.url]
 * @param {typeof globalThis.fetch} [opts.fetch]  override fetch (tests)
 * @returns {Promise<RegistryPlugin | null>}
 */
export async function getPlugin(id, opts = {}) {
  if (!id || typeof id !== 'string') return null;
  const registry = await fetchRegistry({ url: opts.url, fetch: opts.fetch });
  return registry.plugins.find((p) => p.id === id) || null;
}

/**
 * Stream a file from disk, compute its SHA-256, and compare against the
 * expected `<algo>:<hex>` string. Returns true on match, false on
 * mismatch. Throws on unsupported algorithm or file-read error.
 *
 * The expected format is `sha256:<64-lowercase-hex>`. Other algorithms
 * are rejected up front rather than silently miscomputed.
 *
 * @param {string} filePath
 * @param {string} expected  e.g. "sha256:abc..."
 * @returns {Promise<boolean>}
 */
export function verifyChecksum(filePath, expected) {
  return new Promise((resolveP, rejectP) => {
    if (typeof expected !== 'string' || !expected.includes(':')) {
      rejectP(new Error(`checksum must be <algo>:<hex> (got ${JSON.stringify(expected)})`));
      return;
    }
    const [algo, expectedHex] = expected.split(':', 2);
    if (algo !== 'sha256') {
      rejectP(new Error(`only sha256 checksums are supported (got "${algo}")`));
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(expectedHex)) {
      rejectP(new Error(`sha256 checksum must be 64 lowercase hex chars`));
      return;
    }
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => rejectP(err));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      resolveP(actual === expectedHex);
    });
  });
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   version: string,
 *   description?: string,
 *   author?: string,
 *   category?: string,
 *   tags?: string[],
 *   homepage?: string,
 *   tarball: string,
 *   checksum: string,
 *   permissions: string[],
 *   minBizarVersion?: string
 * }} RegistryPlugin
 *
 * @typedef {{
 *   version: number,
 *   updatedAt: string,
 *   plugins: RegistryPlugin[]
 * }} RegistryShape
 */

// Export the symbol type aliases for downstream tooling.
export const __types = /** @type {{
  RegistryPlugin: null,
  RegistryShape: null,
}} */ ({});

export const __testing = {
  CACHE_TTL_MS,
  DEFAULT_REGISTRY_URL,
};