/**
 * src/server/providers-store.mjs
 *
 * v3.0.0 — OpenCode providers and MCPs management.
 *
 * Reads / writes the opencode.json at ~/.config/opencode/opencode.json
 * under the `provider` and `mcp` keys.
 *
 * v3.5.6 — `listAll()` falls back to inferring providers from agent
 * `.md` frontmatter (the `model: provider/model-name` line) so the
 * dashboard can surface the providers that are actually in use even
 * when the user's opencode.json has no top-level `provider` key.
 * Also tries the running `opencode serve` HTTP API for the canonical
 * list. API keys are never echoed back in full — the response masks them.
 *
 * v4.6.0 — Backup keys: each provider now exposes a `keys[]` array with
 * `{envVar, label, status, lastError, errorCount, lastUsed}`. The
 * legacy `apiKey` / `backupApiKey` scalar fields are still read and
 * written for back-compat with opencode itself and existing tests;
 * they are derived from the active key on load. Rotation helpers:
 *   - `getActiveKey(providerId)` — highest-priority usable key
 *   - `markKeyError(providerId, envVar, error)` — bumps errorCount,
 *     demotes to `cooldown` after ERROR_COOLDOWN_THRESHOLD errors
 *   - `rotateKey(providerId)` — moves to the next key, marks the
 *     current one `disabled`
 *   - `withKeyRotation(providerId, fn)` — runs `fn(key, envVar)`; on
 *     retryable errors (auth/429/quota/5xx) marks the current key as
 *     errored, rotates, and retries up to MAX_ROTATION_ATTEMPTS times
 *
 * v4.6.0 — Provider catalog: PROVIDER_CATALOG is a curated list of
 * well-known providers with `keyHint` + `docs` + curated `models[]`.
 * `searchProviders(query)` does a fuzzy match across id/name/docs.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const OPENCODE_JSON = join(HOME, '.config', 'opencode', 'opencode.json');
const OPENCODE_AGENTS_DIR = join(HOME, '.config', 'opencode', 'agents');

function safeReadJSON(file, fallback = {}) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Atomic JSON write: serialize to a sibling temp file, then rename into
// place. `rename` is atomic on POSIX (same filesystem), so a crash
// between write and rename never leaves a half-written / corrupt file.
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

// v5.0.0 — Bug S1: 1-second debounced cache for opencode.json reads.
// `list()`/`listAll()` and other consumers call `loadConfig()` on every
// WS poll (every ~5s per client) and on every route hit. With N clients
// that becomes O(N) reads per minute. The cache collapses all reads
// within a 1-second window to a single read. Writes invalidate so
// subsequent reads see the new state.
//
// The cache lives on `globalThis` so it is shared across all module
// instances of providers-store.mjs — tests and code that re-imports
// the module (e.g. via `?cb=` cache-bust) must see the same cache,
// otherwise a write on one instance becomes invisible to another.
//
// The cache also tracks the file's mtime+size and invalidates if the
// on-disk file has been modified externally (e.g. an editor saving
// opencode.json, or a test setup writing a fresh file). This prevents
// stale reads when the file changes outside our write paths.
const OPENCODE_JSON_CACHE_GLOBAL_KEY = '__bizar_opencode_json_cache__';
function _opencodeCacheSlot() {
  if (!globalThis[OPENCODE_JSON_CACHE_GLOBAL_KEY]) {
    globalThis[OPENCODE_JSON_CACHE_GLOBAL_KEY] = { entry: null, at: 0 };
  }
  return globalThis[OPENCODE_JSON_CACHE_GLOBAL_KEY];
}

const OPENCODE_JSON_CACHE_TTL_MS = 1000;

function _fileStamp(filePath) {
  // Best-effort stat — if stat fails (file missing, etc.), the caller
  // will re-read and re-populate the cache.
  try {
    const st = statSync(filePath);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function readOpencodeJsonCached(filePath = OPENCODE_JSON) {
  const slot = _opencodeCacheSlot();
  const now = Date.now();
  if (slot.entry && slot.entry.filePath === filePath) {
    const age = now - slot.at;
    if (age < OPENCODE_JSON_CACHE_TTL_MS) {
      // Fast path: still within TTL. Verify the file hasn't been
      // modified externally (e.g. another process, an editor, or a
      // test that writes the file directly). The stamp check is cheap
      // and protects correctness when the file is touched outside
      // our write paths.
      const stamp = _fileStamp(filePath);
      if (stamp === null || stamp === slot.entry.stamp) {
        return slot.entry.data;
      }
    }
  }
  const data = safeReadJSON(filePath, {});
  slot.entry = { filePath, data, stamp: _fileStamp(filePath) };
  slot.at = now;
  return data;
}

function invalidateOpencodeJsonCache() {
  const slot = _opencodeCacheSlot();
  slot.entry = null;
  slot.at = 0;
}

function loadConfig() {
  return readOpencodeJsonCached(OPENCODE_JSON);
}

function saveConfig(data) {
  mkdirSync(dirname(OPENCODE_JSON), { recursive: true });
  atomicWriteJson(OPENCODE_JSON, data);
  invalidateOpencodeJsonCache();
}

// v4.6.0 — expose the on-disk load/save helpers so route modules can
// patch the same opencode.json (e.g. the /api/llm/system-llm endpoint
// in routes/config.mjs). Prior sessions had a blocker where these
// were not exported and config.mjs referenced them implicitly.
export { loadConfig, saveConfig };

// v5.0.0 — expose cache helpers for tests and other consumers that need
// to force a re-read (e.g. settings-store after a write).
export { readOpencodeJsonCached, invalidateOpencodeJsonCache, OPENCODE_JSON_CACHE_TTL_MS };

// ── v4.6.0 Backup-key rotation constants ────────────────────────────────────
//
// ERROR_COOLDOWN_THRESHOLD: after this many recorded errors on the same
// envVar, the key is demoted to `cooldown` and `withKeyRotation` skips
// it. The operator can re-enable it via PUT
// /api/providers/:id/keys/:envVar/status with `{status: 'active'}` once
// the upstream quota/rate-limit window has reset.
//
// MAX_ROTATION_ATTEMPTS: bound on the number of times `withKeyRotation`
// will retry the user's fn with a different key before throwing. With
// `cooldown` skipping, this matches the typical "1 primary + 1 backup"
// deployment (2 attempts) with headroom for a 3rd emergency key.
//
// ROTATION_ERROR_PATTERNS: substring match against the lowercased error
// message — used as a fallback when no structured `status` is present
// (e.g. opencode-runner's pre-throw errors). Order matters only for
// readability — first match wins.
const ERROR_COOLDOWN_THRESHOLD = 3;
const MAX_ROTATION_ATTEMPTS = 5;
const ROTATION_ERROR_PATTERNS = [
  /rate[-_ ]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /\bquota\b/i,
  /\binsufficient[_ ]?credits?\b/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /\b403\b/,
  /\binvalid[_ ]?api[_ ]?key\b/i,
  /\bforbidden\b/i,
  /\b5\d{2}\b/, // 5xx
];

/**
 * Heuristic: is `err` a retryable error for key rotation?
 *
 * Accepts an Error-shaped value, a structured `{ok:false, error, status}`,
 * or a plain string. Returns true for:
 *   - HTTP status in {401, 403, 408, 409, 425, 429} (auth/rate-limit)
 *   - HTTP status in {500..599} (server errors)
 *   - error code starting with `http_4xx` / `http_5xx` (the convention
 *     minimax.mjs uses)
 *   - messages matching ROTATION_ERROR_PATTERNS
 *
 * Network errors (ECONNRESET, fetch failed, timeout) are NOT retryable
 * here — they'd fail with the next key too, and we want to surface
 * them quickly.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableError(err) {
  if (!err) return false;
  // Structured minimax.mjs result: {ok:false, error:'http_429', status:429}
  const e = /** @type {any} */ (err);
  const status = typeof e.status === 'number' ? e.status : null;
  if (status !== null) {
    if (status === 401 || status === 403 || status === 408 || status === 409 || status === 425 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  const code = typeof e.error === 'string' ? e.error : '';
  if (/^http_(401|403|408|409|425|429)$/.test(code)) return true;
  if (/^http_5\d{2}$/.test(code)) return true;
  // Fall back to message-substring match — covers opencode-runner
  // errors and unknown callers.
  const msg = (e.message || e.toString?.() || '').toString();
  if (!msg) return false;
  // Network errors are explicitly NOT retryable.
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network error|abort(ed)?/i.test(msg)) {
    return false;
  }
  return ROTATION_ERROR_PATTERNS.some((re) => re.test(msg));
}

// ── v4.6.0 keys[] shape helpers ─────────────────────────────────────────────
//
// Each provider entry may have a `keys[]` array. Every entry is
//   { envVar, label, status, lastError, errorCount, lastUsed }
// where:
//   - envVar:       the env var name the caller reads at request time
//                   (e.g. "BIZAR_MINIMAX_KEY"). The actual key value is
//                   NEVER stored — we always go through env at request time.
//   - label:        free-text ("Primary", "Backup", "Work laptop")
//   - status:       'active' | 'standby' | 'disabled' | 'cooldown'
//                   - active   — used by default
//                   - standby  — rotated to when the active key fails
//                   - disabled — operator disabled, never auto-selected
//                   - cooldown — auto-disabled after ERROR_COOLDOWN_THRESHOLD errors
//   - lastError:    string | null — last error message recorded
//   - errorCount:   integer — total errors recorded
//   - lastUsed:     number | null — epoch ms of last successful use
//
// The legacy `apiKey`/`backupApiKey` string fields are still kept on disk
// for back-compat with opencode itself (which reads them) and the
// existing test suite. `migrateKeysShape()` synthesizes a `keys[]` from
// those fields whenever the provider is loaded.

const VALID_KEY_STATUSES = new Set(['active', 'standby', 'disabled', 'cooldown']);

/**
 * Build a normalized `keys[]` array from a raw provider entry.
 * Pure function — no side effects. Used by loadConfig() to normalize.
 *
 * @param {Record<string, any> | null | undefined} p
 * @returns {Array<{envVar: string, label: string, status: string, lastError: string|null, errorCount: number, lastUsed: number|null}>}
 */
export function keysFromProvider(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.keys) && p.keys.length > 0) {
    return p.keys
      .filter((k) => k && typeof k === 'object' && typeof k.envVar === 'string')
      .map((k) => ({
        envVar: String(k.envVar),
        label: typeof k.label === 'string' ? k.label : 'Key',
        status: VALID_KEY_STATUSES.has(k.status) ? k.status : 'standby',
        lastError: typeof k.lastError === 'string' ? k.lastError : null,
        errorCount: Number.isFinite(k.errorCount) ? Number(k.errorCount) : 0,
        lastUsed: Number.isFinite(k.lastUsed) ? Number(k.lastUsed) : null,
      }));
  }
  // Migrate legacy shape: apiKey/backupApiKey → keys[]
  const out = [];
  if (p.apiKey) {
    out.push({
      envVar: '',
      label: 'Primary',
      status: 'active',
      lastError: null,
      errorCount: 0,
      lastUsed: null,
    });
  }
  if (p.backupApiKey) {
    out.push({
      envVar: '',
      label: 'Backup',
      status: 'standby',
      lastError: null,
      errorCount: 0,
      lastUsed: null,
    });
  }
  return out;
}

/**
 * Sync the legacy `apiKey`/`backupApiKey` fields from the `keys[]`
 * array. The active key becomes `apiKey`; the first standby key
 * becomes `backupApiKey`. Other entries are not persisted to the
 * legacy shape (they only live in `keys[]`).
 *
 * Returns a new provider object — pure function. Callers that mutate
 * the cfg in place should assign the result back.
 *
 * @param {Record<string, any>} p
 * @returns {Record<string, any>}
 */
export function syncLegacyKeys(p) {
  if (!p || typeof p !== 'object') return p;
  if (!Array.isArray(p.keys) || p.keys.length === 0) return p;
  const next = { ...p };
  const active = p.keys.find((k) => k.status === 'active');
  const standby = p.keys.find((k) => k.status === 'standby');
  // We DO NOT write the actual key value to `apiKey` — that lives in
  // the env var. We only mirror whether a key is configured (truthy
  // string) so opencode's `options.apiKey` check sees a key present.
  // Existing code that reads `apiKey`/`backupApiKey` and treats
  // truthy-as-configured continues to work.
  next.apiKey = active && active.envVar ? `<env:${active.envVar}>` : '';
  next.backupApiKey = standby && standby.envVar ? `<env:${standby.envVar}>` : '';
  return next;
}

// ── MiniMax model constants ──────────────────────────────────────────────────
//
// Cheap/fast everyday model — agents that need a lightweight workhorse.
export const MINIMAX_DEFAULT = 'MiniMax-M2.7';

// ── v4.6.0 Provider catalog ─────────────────────────────────────────────────
//
// Curated list of well-known providers. The dashboard's "Add provider"
// wizard surfaces this so the user can pick instead of typing every
// field. The catalog entry's `keyPattern` is a RegExp that rejects keys
// of the wrong shape (e.g. non-sk- prefix for OpenAI) before they reach
// the disk.
//
// `keyHint` is the human-readable example shown next to the paste box.
// `docs` is the marketing/docs URL surfaced as a link. `models` is the
// curated short list (the live probe may add more on top of this).

export const PROVIDER_CATALOG = Object.freeze([
  Object.freeze({
    id: 'opencode',
    name: 'OpenCode Zen',
    baseURL: 'https://opencode.ai/zen/v1',
    keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    keyHint: 'sk-…',
    docs: 'https://opencode.ai/zen',
    models: [
      'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
      'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex',
      'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
      'gpt-5', 'gpt-5-codex', 'gpt-5-nano',
      'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
      'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
      'gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3-flash',
      'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus',
      'deepseek-v4-pro', 'deepseek-v4-flash',
      'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
      'glm-5.2', 'glm-5.1', 'glm-5',
      'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5',
      'grok-build-0.1',
      'big-pickle', 'mimo-v2.5-free', 'north-mini-code-free', 'nemotron-3-ultra-free', 'deepseek-v4-flash-free',
    ],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    keyHint: 'sk-ant-…',
    docs: 'https://docs.anthropic.com',
    models: [
      'claude-fable-5',
      'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
      'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
    ],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    keyHint: 'sk-…',
    docs: 'https://platform.openai.com',
    models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/,
    keyHint: 'AIza…',
    docs: 'https://ai.google.dev',
    models: ['gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-2.5-pro'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.io/v1',
    keyPattern: /^sk-(cp|ant|or)-[A-Za-z0-9_-]{20,}$/,
    keyHint: 'sk-cp-…, sk-ant-…, or sk-or-…',
    docs: 'https://api.minimax.io',
    models: [
      Object.freeze({ id: 'MiniMax-M2.7-Flash', name: 'MiniMax M2.7 Flash', tier: 'cheap', recommended: true }),
      Object.freeze({ id: 'MiniMax-M2.7', name: 'MiniMax M2.7', tier: 'cheap' }),
      Object.freeze({ id: 'MiniMax-M3', name: 'MiniMax M3', tier: 'mid' }),
      Object.freeze({ id: 'MiniMax-M3-Reasoning', name: 'MiniMax M3 Reasoning', tier: 'premium' }),
    ],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    keyPattern: /^gsk_[A-Za-z0-9]{20,}$/,
    keyHint: 'gsk_…',
    docs: 'https://console.groq.com',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    keyPattern: /^[A-Za-z0-9]{20,}$/,
    keyHint: '20+ alphanumeric chars',
    docs: 'https://docs.mistral.ai',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'cohere',
    name: 'Cohere',
    baseURL: 'https://api.cohere.ai/v1',
    keyPattern: /^[A-Za-z0-9-]{20,}$/,
    keyHint: '20+ alphanumeric/dash chars',
    docs: 'https://docs.cohere.com',
    models: ['command-r-plus', 'command-r', 'command', 'embed-english-v3.0'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/,
    keyHint: 'sk-or-…',
    docs: 'https://openrouter.ai',
    models: ['openai/gpt-5', 'anthropic/claude-opus-4-7', 'google/gemini-3-pro'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    keyHint: 'sk-…',
    docs: 'https://platform.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
    requiresKey: true,
  }),
  Object.freeze({
    id: 'ollama',
    name: 'Ollama (local)',
    baseURL: 'http://localhost:11434/v1',
    keyPattern: /^.*$/,
    keyHint: 'no key needed (any value works)',
    docs: 'https://ollama.com',
    models: ['llama3.3', 'qwen2.5', 'mistral', 'codellama', 'phi3'],
    requiresKey: false,
  }),
  Object.freeze({
    id: 'lmstudio',
    name: 'LM Studio (local)',
    baseURL: 'http://localhost:1234/v1',
    keyPattern: /^.*$/,
    keyHint: 'no key needed (any value works)',
    docs: 'https://lmstudio.ai',
    models: [],
    requiresKey: false,
  }),
  Object.freeze({
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseURL: '',
    keyPattern: /^.*$/,
    keyHint: 'paste your key (any format)',
    docs: '',
    models: [],
    requiresKey: true,
  }),
]);

/**
 * Find a catalog entry by id.
 *
 * @param {string} id
 * @returns {Record<string, any> | null}
 */
export function findCatalogEntry(id) {
  if (!id || typeof id !== 'string') return null;
  return PROVIDER_CATALOG.find((p) => p.id === id) || null;
}

/**
 * Project a catalog entry to the safe shape returned to the UI.
 * Strips `keyPattern` (a RegExp) so it survives JSON.stringify.
 *
 * @param {Record<string, any>} entry
 */
function catalogPublicShape(entry) {
  return {
    id: entry.id,
    name: entry.name,
    baseURL: entry.baseURL,
    keyHint: entry.keyHint,
    docs: entry.docs,
    models: Array.isArray(entry.models) ? entry.models.slice() : [],
    requiresKey: entry.requiresKey !== false,
  };
}

/**
 * Return the full catalog in the UI-safe shape.
 *
 * @returns {Array<{id, name, baseURL, keyHint, docs, models, requiresKey}>}
 */
export function listCatalog() {
  return PROVIDER_CATALOG.map(catalogPublicShape);
}

/**
 * Fuzzy-search the provider catalog. Match against id, name, and docs
 * using case-insensitive substring matching with a simple relevance
 * score. Empty query returns the full catalog in id order.
 *
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{id, name, baseURL, keyHint, docs, models, requiresKey, score: number}>}
 */
export function searchProviders(query, { limit = 20 } = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return listCatalog().slice(0, limit);
  }
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 1);
  const out = [];
  for (const entry of PROVIDER_CATALOG) {
    let score = 0;
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase();
    const docs = (entry.docs || '').toLowerCase();
    const models = (entry.models || []).map((m) => String(m).toLowerCase());
    for (const t of tokens) {
      if (id === t) score += 100;
      else if (id.startsWith(t)) score += 30;
      else if (id.includes(t)) score += 10;
      if (name.startsWith(t)) score += 20;
      else if (name.includes(t)) score += 8;
      if (docs.includes(t)) score += 3;
      // Model name matches — lower weight because models are noisy
      // (e.g. "gpt" matches lots of providers), but useful for the
      // "I want a provider that offers claude" use case.
      for (const m of models) {
        if (m === t) score += 15;
        else if (m.startsWith(t)) score += 5;
        else if (m.includes(t)) score += 2;
      }
    }
    if (score > 0) {
      out.push({ ...catalogPublicShape(entry), score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}

// ── v4.6.0 Rotation exports (top-level so they're importable) ────────────────

function getRawProvider(providerId) {
  const cfg = loadConfig();
  const p = cfg?.provider?.[providerId];
  return p ? { cfg, provider: p } : null;
}

/**
 * Return the highest-priority usable key for `providerId`.
 *
 * Priority order:
 *   1. first key with status === 'active'
 *   2. first key with status === 'standby'
 *   3. first key with status === 'cooldown' (better than nothing)
 *
 * Returns `{envVar, label, status, key}` where `key` is the resolved
 * value from `process.env[envVar]` (empty string if not set). Returns
 * `null` if no key is configured at all.
 *
 * @param {string} providerId
 * @returns {{envVar: string, label: string, status: string, key: string} | null}
 */
export function getActiveKey(providerId) {
  const got = getRawProvider(providerId);
  if (!got) return null;
  const keys = keysFromProvider(got.provider);
  if (keys.length === 0) return null;
  const order = ['active', 'standby', 'cooldown'];
  for (const want of order) {
    const k = keys.find((kk) => kk.status === want);
    if (k) {
      return {
        envVar: k.envVar,
        label: k.label,
        status: k.status,
        key: process.env[k.envVar] || '',
      };
    }
  }
  // All keys disabled — fall through to the first one (manual override)
  const first = keys[0];
  return {
    envVar: first.envVar,
    label: first.label,
    status: first.status,
    key: process.env[first.envVar] || '',
  };
}

/**
 * Persist a change to the provider's `keys[]` array.
 * Re-syncs the legacy `apiKey`/`backupApiKey` fields and writes the
 * entire config back atomically.
 *
 * @param {string} providerId
 * @param {(keys: Array) => Array} mutator
 */
function updateKeys(providerId, mutator) {
  const cfg = loadConfig();
  cfg.provider = cfg.provider || {};
  const cur = cfg.provider[providerId];
  if (!cur) throw new Error(`provider "${providerId}" not found`);
  const nextKeys = mutator(keysFromProvider(cur));
  const nextProvider = { ...cur, keys: nextKeys };
  cfg.provider[providerId] = syncLegacyKeys(nextProvider);
  saveConfig(cfg);
  return cfg.provider[providerId];
}

/**
 * Record an error on a specific key. Bumps `errorCount`, sets
 * `lastError`, and demotes `status` to `cooldown` once the threshold
 * is hit. Returns the (possibly updated) key entry.
 *
 * @param {string} providerId
 * @param {string} envVar
 * @param {string | Error} error
 * @returns {{envVar: string, label: string, status: string, lastError: string|null, errorCount: number, lastUsed: number|null} | null}
 */
export function markKeyError(providerId, envVar, error) {
  if (!providerId || !envVar) return null;
  const errMsg = error instanceof Error ? error.message : String(error || '');
  return updateKeys(providerId, (keys) => {
    const idx = keys.findIndex((k) => k.envVar === envVar);
    if (idx === -1) return keys; // unknown envVar — no-op
    const cur = keys[idx];
    const errorCount = (cur.errorCount || 0) + 1;
    const status = errorCount >= ERROR_COOLDOWN_THRESHOLD ? 'cooldown' : cur.status;
    const next = {
      ...cur,
      errorCount,
      lastError: errMsg.slice(0, 500),
      status,
    };
    const out = keys.slice();
    out[idx] = next;
    return out;
  })?.keys?.find((k) => k.envVar === envVar) || null;
}

/**
 * Mark a key as used successfully (clears errorCount).
 *
 * @param {string} providerId
 * @param {string} envVar
 */
export function markKeySuccess(providerId, envVar) {
  if (!providerId || !envVar) return;
  updateKeys(providerId, (keys) => {
    const idx = keys.findIndex((k) => k.envVar === envVar);
    if (idx === -1) return keys;
    const cur = keys[idx];
    const out = keys.slice();
    out[idx] = {
      ...cur,
      errorCount: 0,
      lastError: null,
      lastUsed: Date.now(),
    };
    return out;
  });
}

/**
 * Rotate to the next usable key. Marks the current active key as
 * `disabled` and promotes the first `standby` (or any non-active
 * non-disabled key) to `active`. Returns the new active key, or null
 * if no keys remain.
 *
 * @param {string} providerId
 * @returns {{envVar: string, label: string, status: string} | null}
 */
export function rotateKey(providerId) {
  const got = getRawProvider(providerId);
  if (!got) return null;
  let result = null;
  updateKeys(providerId, (keys) => {
    if (keys.length === 0) return keys;
    const curIdx = keys.findIndex((k) => k.status === 'active');
    const out = keys.map((k) => ({ ...k }));
    if (curIdx !== -1) out[curIdx] = { ...out[curIdx], status: 'disabled' };
    // Find next candidate: prefer standby, then anything not already
    // active/disabled. We avoid `cooldown` if there are other options.
    const nextIdx = out.findIndex((k, i) => i !== curIdx && k.status === 'standby');
    const fallbackIdx = nextIdx === -1
      ? out.findIndex((k, i) => i !== curIdx && k.status !== 'disabled' && k.status !== 'active')
      : -1;
    const promoteIdx = nextIdx !== -1 ? nextIdx : fallbackIdx;
    if (promoteIdx === -1) return out; // nothing to rotate to
    out[promoteIdx] = { ...out[promoteIdx], status: 'active' };
    result = {
      envVar: out[promoteIdx].envVar,
      label: out[promoteIdx].label,
      status: 'active',
    };
    return out;
  });
  return result;
}

/**
 * Add a backup key to a provider. Creates the `keys[]` array from the
 * legacy `apiKey` if it doesn't exist yet. Returns the inserted key
 * entry.
 *
 * @param {string} providerId
 * @param {string} envVar
 * @param {string} [label]
 * @returns {{envVar: string, label: string, status: string}}
 */
export function addBackupKey(providerId, envVar, label) {
  if (!providerId) throw new Error('providerId required');
  if (!envVar || typeof envVar !== 'string') throw new Error('envVar required');
  let inserted = null;
  updateKeys(providerId, (keys) => {
    if (keys.some((k) => k.envVar === envVar)) {
      throw new Error(`key with envVar "${envVar}" already exists`);
    }
    // New key is standby by default; the active key stays primary.
    const next = [
      ...keys,
      {
        envVar,
        label: typeof label === 'string' && label.trim() ? label.trim() : `Backup ${keys.length}`,
        status: 'standby',
        lastError: null,
        errorCount: 0,
        lastUsed: null,
      },
    ];
    inserted = next[next.length - 1];
    return next;
  });
  return inserted;
}

/**
 * Remove a key from a provider. Refuses to remove the last remaining
 * key (would leave the provider with no way to authenticate).
 *
 * @param {string} providerId
 * @param {string} envVar
 * @returns {boolean} true if removed
 */
export function removeBackupKey(providerId, envVar) {
  if (!providerId || !envVar) throw new Error('providerId and envVar required');
  let removed = false;
  try {
    updateKeys(providerId, (keys) => {
      if (keys.length <= 1) {
        throw new Error('cannot remove the last key — at least one key must remain');
      }
      const next = keys.filter((k) => k.envVar !== envVar);
      if (next.length === keys.length) {
        throw new Error(`key with envVar "${envVar}" not found`);
      }
      removed = true;
      return next;
    });
  } catch (err) {
    if (removed) throw err; // re-throw real errors
    throw err;
  }
  return removed;
}

/**
 * Set a key's status manually (operator override).
 *
 * @param {string} providerId
 * @param {string} envVar
 * @param {'active'|'standby'|'disabled'|'cooldown'} status
 */
export function setKeyStatus(providerId, envVar, status) {
  if (!VALID_KEY_STATUSES.has(status)) {
    throw new Error(`invalid status "${status}"`);
  }
  return updateKeys(providerId, (keys) => {
    const idx = keys.findIndex((k) => k.envVar === envVar);
    if (idx === -1) throw new Error(`key with envVar "${envVar}" not found`);
    const out = keys.slice();
    // When promoting to active, demote any other active key.
    if (status === 'active') {
      for (let i = 0; i < out.length; i++) {
        if (i !== idx && out[i].status === 'active') {
          out[i] = { ...out[i], status: 'standby' };
        }
      }
    }
    const cur = out[idx];
    out[idx] = {
      ...cur,
      status,
      // Resetting status clears the error bookkeeping.
      errorCount: status === 'active' ? 0 : cur.errorCount,
      lastError: status === 'active' ? null : cur.lastError,
    };
    return out;
  })?.keys?.find((k) => k.envVar === envVar) || null;
}

/**
 * Run `fn(key, envVar)` against the active key. On a retryable error
 * (`isRetryableError`), mark the error and rotate to the next key —
 * retrying up to `MAX_ROTATION_ATTEMPTS` times. Returns the first
 * successful result, or throws the last error if all keys failed.
 *
 * Usage:
 *   const text = await withKeyRotation('minimax', async (key, envVar) => {
 *     return await callProvider(apiKey=key);
 *   });
 *
 * @template T
 * @param {string} providerId
 * @param {(key: string, envVar: string) => Promise<T>} fn
 * @param {{ maxAttempts?: number, isRetryable?: (err: unknown) => boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function withKeyRotation(providerId, fn, opts = {}) {
  if (typeof fn !== 'function') throw new Error('fn must be a function');
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts || MAX_ROTATION_ATTEMPTS, 16));
  const retryable = opts.isRetryable || isRetryableError;
  const tried = new Set();
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const active = getActiveKey(providerId);
    if (!active) {
      const err = new Error(`no keys configured for provider "${providerId}"`);
      err.code = 'no_keys';
      throw err;
    }
    if (tried.has(active.envVar)) {
      // We've already tried this envVar — no more rotation candidates.
      break;
    }
    tried.add(active.envVar);
    try {
      const result = await fn(active.key, active.envVar);
      // Success — clear error bookkeeping on the key we used.
      markKeySuccess(providerId, active.envVar);
      return result;
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) throw err;
      markKeyError(providerId, active.envVar, err);
      const rotated = rotateKey(providerId);
      if (!rotated) break;
    }
  }
  // Exhausted all candidates
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  err.code = err.code || 'rotation_exhausted';
  err.attempts = tried.size;
  throw err;
}

function mask(value) {
  if (typeof value !== 'string' || !value) return '';
  // Short keys (≤8 chars) get a distinct indicator so the UI can show
  // "***short***" instead of looking like the field is empty.
  if (value.length <= 8) return '***short***';
  return value.slice(0, 2) + '...' + value.slice(-2);
}

function unmask(stored, incoming) {
  // Incoming is the user-typed value. If it's the masked form, keep stored.
  if (typeof incoming === 'string' && incoming.startsWith('***') && incoming.endsWith('***')) {
    return stored;
  }
  return incoming;
}

/**
 * v3.20.10 — Three-way merge for fields that may be missing from a
 * patch object. Used by `update()` so an operator who submits
 * `{ backupApiKey: 'new-key' }` (without re-supplying `apiKey`)
 * doesn't accidentally clear the stored `apiKey` to undefined.
 *
 *   stored       — current on-disk value (string)
 *   incoming     — patch value (string | undefined)
 *   Returns:
 *     - `stored`   if `incoming` is undefined (field not in patch)
 *     - `stored`   if `incoming` is the masked `***...***` placeholder
 *     - `incoming` otherwise (real value to replace)
 *
 * Replaces the previous `unmask(stored, patch.apiKey)` which returned
 * undefined whenever the patch didn't include apiKey — that lost the
 * stored key on every partial-update. Same issue applied to the new
 * `backupApiKey` field, so the helper covers both.
 */
function preserveOrReplace(stored, incoming) {
  if (incoming === undefined) return stored;
  return unmask(stored, incoming);
}

export const providersStore = {
  OPENCODE_JSON,

  list() {
    const cfg = loadConfig();
    const providers = cfg.provider || {};
    return Object.entries(providers).map(([id, p]) => ({
      id,
      name: p.name || id,
      baseURL: p.baseURL || p.options?.baseURL || '',
      // Legacy back-compat fields — read from disk as-is so existing
      // tests pass and the UI keeps working. These are the actual key
      // values, masked for display.
      apiKey: mask(p.apiKey || p.options?.apiKey || ''),
      backupApiKey: mask(p.backupApiKey || p.options?.backupApiKey || ''),
      // v4.6.0 — full keys[] array. Synthesized from apiKey/backupApiKey
      // if absent; never echoes the key value itself.
      keys: keysFromProvider(p),
      models: Array.isArray(p.models) ? p.models : [],
      enabled: p.enabled !== false,
    }));
  },

  /**
   * v3.5.6 — Robust provider discovery. Tries three sources in order
   * and merges them so the dashboard shows every provider that is
   * actually in use, even when opencode.json has no `provider` key.
   *
   *  1. opencode.json `provider` / `providers` key — explicit config.
   *  2. Agent `.md` frontmatter — every `model: provider/model` line
   *     implies a usable provider + model pair.
   *  3. opencode serve HTTP `/api/providers` (best-effort, 1.5s timeout).
   *
   * Each source contributes providers; duplicates (by id) are merged so
   * the explicit config wins on baseURL/apiKey and the inferred sources
   * contribute their known models.
   *
   * Returns an array of:
   *   { id, name, baseURL, apiKey, models: [{id, name, source?}],
   *     source: 'config'|'agents'|'serve'|'config+agents' }
   */
  async listAll() {
    const byId = new Map();

    const upsert = (id, patch, source) => {
      const cur = byId.get(id) || {
        id,
        name: id,
        baseURL: '',
        apiKey: '',
        backupApiKey: '',
        keys: [],
        models: [],
        enabled: true,
        source: '',
      };
      const next = { ...cur, ...patch };
      // Merge models by id
      const modelMap = new Map();
      for (const m of cur.models) modelMap.set(m.id, m);
      for (const m of patch.models || []) {
        const existing = modelMap.get(m.id);
        modelMap.set(m.id, existing ? { ...existing, ...m } : m);
      }
      next.models = Array.from(modelMap.values());
      next.source = cur.source
        ? cur.source.includes(source)
          ? cur.source
          : `${cur.source}+${source}`
        : source;
      byId.set(id, next);
    };

    // Source 1: opencode.json provider/providers key
    try {
      const cfg = loadConfig();
      const explicit = cfg.provider || cfg.providers || {};
      for (const [id, p] of Object.entries(explicit)) {
        if (!p || typeof p !== 'object') continue;
        upsert(
          id,
          {
            name: p.name || id,
            baseURL: p.baseURL || p.options?.baseURL || '',
            apiKey: mask(p.apiKey || p.options?.apiKey || ''),
            backupApiKey: mask(p.backupApiKey || p.options?.backupApiKey || ''),
            // v4.6.0 — include keys[] alongside the legacy fields
            keys: keysFromProvider(p),
            models: (Array.isArray(p.models) ? p.models : []).map((m) => ({
              id: typeof m === 'string' ? m : m.id || m.name || String(m),
              name: typeof m === 'string' ? m : m.name || m.id || String(m),
            })),
            enabled: p.enabled !== false,
          },
          'config',
        );
      }
    } catch {
      /* best-effort */
    }

    // Source 2: agent .md frontmatter
    try {
      if (existsSync(OPENCODE_AGENTS_DIR)) {
        for (const file of readdirSync(OPENCODE_AGENTS_DIR)) {
          if (!file.endsWith('.md')) continue;
          const full = join(OPENCODE_AGENTS_DIR, file);
          let raw;
          try {
            raw = readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          const modelMatch = raw.match(/^model:\s*([^\s#]+)/m);
          if (!modelMatch) continue;
          const modelRef = modelMatch[1].trim();
          const slashIdx = modelRef.indexOf('/');
          if (slashIdx <= 0) continue;
          const providerId = modelRef.slice(0, slashIdx);
          const modelId = modelRef.slice(slashIdx + 1);
          if (!providerId || !modelId) continue;
          upsert(
            providerId,
            {
              models: [{ id: modelId, name: modelId, source: `agents/${file.replace(/\.md$/, '')}` }],
            },
            'agents',
          );
        }
      }
    } catch {
      /* best-effort */
    }

    // Source 3: opencode serve HTTP API
    try {
      const { readServeInfo } = await import('./serve-info.mjs');
      const info = readServeInfo();
      if (info && info.baseUrl) {
        const auth = 'Basic ' + Buffer.from(`opencode:${info.password || ''}`).toString('base64');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        try {
          const resp = await fetch(`${info.baseUrl}/api/providers`, {
            headers: { Authorization: auth },
            signal: ctrl.signal,
          });
          if (resp.ok) {
            const body = await resp.json().catch(() => null);
            const list = Array.isArray(body?.providers)
              ? body.providers
              : Array.isArray(body?.data)
              ? body.data
              : Array.isArray(body)
              ? body
              : [];
            for (const p of list) {
              if (!p || typeof p !== 'object') continue;
              const id = p.id || p.name;
              if (!id) continue;
              const models = (Array.isArray(p.models) ? p.models : []).map((m) => {
                if (typeof m === 'string') return { id: m, name: m };
                return {
                  id: m.id || m.name || String(m),
                  name: m.name || m.id || String(m),
                };
              });
              upsert(
                id,
                {
                  name: p.name || id,
                  baseURL: p.baseURL || '',
                  models,
                },
                'serve',
              );
            }
          }
        } catch {
          /* serve unreachable — fall through */
        } finally {
          clearTimeout(timer);
        }
      }
    } catch {
      /* best-effort */
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  },

  /**
   * v3.5.6 — Return the currently configured default provider + model.
   * Reads from opencode.json (`model`, `provider`, `small_model`).
   * Falls back to scanning agents to find the default_agent's model.
   *
   * Returns: { providerId, modelId, source, agent?, smallModel? } or
   *          null if nothing can be determined.
   */
  async getActive() {
    let providerId = null;
    let modelId = null;
    let source = null;

    try {
      const cfg = loadConfig();
      const m = typeof cfg.model === 'string' ? cfg.model : '';
      if (m && m.includes('/')) {
        const slashIdx = m.indexOf('/');
        providerId = m.slice(0, slashIdx);
        modelId = m.slice(slashIdx + 1);
        source = 'opencode.json';
      } else if (cfg.provider && typeof cfg.provider === 'object') {
        const firstId = Object.keys(cfg.provider)[0];
        if (firstId) {
          providerId = firstId;
          source = 'opencode.json:provider';
        }
      }

      let smallModel = null;
      if (typeof cfg.small_model === 'string' && cfg.small_model.includes('/')) {
        smallModel = cfg.small_model;
      }

      let defaultAgent = typeof cfg.default_agent === 'string' ? cfg.default_agent : null;

      // If we got a providerId but no modelId, look up the default_agent's model
      let agentModel = null;
      if (providerId && !modelId && defaultAgent && existsSync(OPENCODE_AGENTS_DIR)) {
        try {
          const file = join(OPENCODE_AGENTS_DIR, `${defaultAgent}.md`);
          if (existsSync(file)) {
            const raw = readFileSync(file, 'utf8');
            const match = raw.match(/^model:\s*([^\s#]+)/m);
            if (match) {
              agentModel = match[1].trim();
              if (agentModel.includes('/')) {
                const slashIdx = agentModel.indexOf('/');
                const inferredProvider = agentModel.slice(0, slashIdx);
                if (!providerId) providerId = inferredProvider;
                modelId = agentModel.slice(slashIdx + 1);
                source = `agents/${defaultAgent}`;
              }
            }
          }
        } catch {
          /* best-effort */
        }
      }

      if (providerId) {
        return {
          providerId,
          modelId: modelId || null,
          source,
          agent: defaultAgent || null,
          smallModel,
        };
      }
    } catch {
      /* best-effort */
    }

    // Last-resort: scan all agents, pick the most-referenced provider/model
    try {
      if (existsSync(OPENCODE_AGENTS_DIR)) {
        const counts = new Map(); // 'provider/model' -> count
        for (const file of readdirSync(OPENCODE_AGENTS_DIR)) {
          if (!file.endsWith('.md')) continue;
          try {
            const raw = readFileSync(join(OPENCODE_AGENTS_DIR, file), 'utf8');
            const m = raw.match(/^model:\s*([^\s#]+)/m);
            if (m) {
              const ref = m[1].trim();
              counts.set(ref, (counts.get(ref) || 0) + 1);
            }
          } catch {
            /* skip */
          }
        }
        if (counts.size > 0) {
          const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
          const [ref] = top;
          if (ref.includes('/')) {
            const slashIdx = ref.indexOf('/');
            return {
              providerId: ref.slice(0, slashIdx),
              modelId: ref.slice(slashIdx + 1),
              source: 'agents:inferred',
              agent: null,
              smallModel: null,
            };
          }
        }
      }
    } catch {
      /* best-effort */
    }

    return null;
  },

  get(id) {
    return this.list().find((p) => p.id === id) || null;
  },

  add(input) {
    if (!input || typeof input !== 'object') throw new Error('input required');
    // Auto-generate id from name if not provided
    const id = input.id || (input.name ? input.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-') : `provider_${Date.now().toString(36)}`);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
      throw new Error('invalid id');
    }
    const cfg = loadConfig();
    cfg.provider = cfg.provider || {};
    if (cfg.provider[id]) throw new Error(`provider "${id}" exists`);
    cfg.provider[id] = {
      name: input.name || id,
      baseURL: input.baseURL || '',
      apiKey: input.apiKey || '',
      // v3.20.10 — backup key slot. Optional. Stored verbatim; masked
      // by list() / listAll(). If both keys are present, the operator
      // can swap them manually via the dashboard if the primary hits
      // a rate limit or quota.
      backupApiKey: input.backupApiKey || '',
      // v4.6.0 — also write a keys[] array so new code that consumes
      // the rotation-aware shape gets a normalized view. If the
      // caller also passed `keys[]` in the input, prefer that.
      keys: Array.isArray(input.keys) && input.keys.length > 0
        ? input.keys.map((k) => ({
            envVar: typeof k.envVar === 'string' ? k.envVar : '',
            label: typeof k.label === 'string' ? k.label : 'Key',
            status: VALID_KEY_STATUSES.has(k.status) ? k.status : 'standby',
            lastError: typeof k.lastError === 'string' ? k.lastError : null,
            errorCount: Number.isFinite(k.errorCount) ? Number(k.errorCount) : 0,
            lastUsed: Number.isFinite(k.lastUsed) ? Number(k.lastUsed) : null,
          }))
        : keysFromProvider({ apiKey: input.apiKey, backupApiKey: input.backupApiKey }),
      models: Array.isArray(input.models) ? input.models : [],
      enabled: input.enabled !== false,
    };
    saveConfig(cfg);
    return this.get(id);
  },

  update(id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch required');
    const cfg = loadConfig();
    cfg.provider = cfg.provider || {};
    const cur = cfg.provider[id];
    if (!cur) throw new Error(`provider "${id}" not found`);
    cfg.provider[id] = {
      ...cur,
      name: patch.name ?? cur.name,
      baseURL: patch.baseURL ?? cur.baseURL,
      // v3.20.10 — preserveOrReplace: don't lose the stored key when
      // the patch omits the field. See preserveOrReplace() above.
      apiKey: preserveOrReplace(cur.apiKey, patch.apiKey),
      backupApiKey: preserveOrReplace(cur.backupApiKey, patch.backupApiKey),
      models: Array.isArray(patch.models) ? patch.models : cur.models,
      enabled: patch.enabled ?? cur.enabled,
    };
    saveConfig(cfg);
    return this.get(id);
  },

  remove(id) {
    const cfg = loadConfig();
    if (!cfg.provider || !cfg.provider[id]) return false;
    delete cfg.provider[id];
    saveConfig(cfg);
    return true;
  },

  /**
   * v4.4.14 — Add (or update) a provider with a user-supplied key.
   * Auto-fills the rest from the canonical preset + a live model
   * discovery probe. The user pastes the key; we figure out:
   *   - the id (from name or explicit override)
   *   - the display name (from preset)
   *   - the baseURL (from preset)
   *   - the model list (probes /v1/models and falls back to preset defaults)
   *   - whether to set systemLlm to use this provider+model
   *
   * Returns the resulting provider plus a `probe` field describing
   * whether the model discovery succeeded and the models found.
   */
  async addWithAuto({ id, name, apiKey, groupId = 'default', setAsSystemLlm = true, preferredModel, systemLlmModel, timeoutMs = 8000 } = {}) {
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: 'no_api_key', message: 'API key is required' };
    }
    // Resolve the preset by id (or by name as a fallback for unknown ids).
    const spec =
      this.KNOWN_PROVIDERS.find((p) => p.id === id) ||
      this.KNOWN_PROVIDERS.find((p) => (name || '').toLowerCase().includes((p.name || '').toLowerCase()));
    if (!spec) {
      return {
        ok: false,
        error: 'unknown_provider',
        message: `Unknown provider id "${id}". Known: ${this.KNOWN_PROVIDERS.map((p) => p.id).join(', ')}`,
      };
    }
    if (spec.keyPattern && !spec.keyPattern.test(apiKey)) {
      return {
        ok: false,
        error: 'invalid_key_format',
        message: `Key doesn't match expected pattern for ${spec.name} (${spec.keyPattern}).`,
      };
    }
    const finalId = spec.id; // always use the canonical id (e.g. "minimax", "opencode")
    const baseURL = spec.baseURL;
    const finalName = spec.name;

    // Probe /v1/models to discover the live model list. Falls back to
    // the preset's knownModels if the probe fails.
    let probeModels = [];
    let probeStatus = 'unknown';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const headers = { accept: 'application/json' };
      if (spec.id !== 'anthropic') headers['Authorization'] = `Bearer ${apiKey}`;
      const resp = await fetch(`${baseURL}/models`, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const body = await resp.json().catch(() => null);
        const arr = Array.isArray(body?.data) ? body.data
          : Array.isArray(body) ? body
          : null;
        if (arr) {
          probeModels = arr.map((m) => m.id).filter(Boolean);
          probeStatus = 'ok';
        } else {
          probeStatus = 'unparseable';
        }
      } else {
        probeStatus = `http_${resp.status}`;
      }
    } catch (err) {
      probeStatus = err?.name === 'AbortError' ? 'timeout' : 'network';
    }

    const models = probeModels.length > 0
      ? probeModels
      : Array.isArray(spec.defaultModels) ? spec.defaultModels
      : Array.isArray(spec.knownModels) ? spec.knownModels
      : [];

    // Persist.
    const cfg = loadConfig();
    cfg.provider = cfg.provider || {};
    const cur = cfg.provider[finalId] || {};
    cfg.provider[finalId] = {
      name: finalName,
      baseURL,
      apiKey: apiKey.trim(),
      backupApiKey: cur.backupApiKey || '',
      // v4.6.0 — write a keys[] array. The active key's envVar is
      // empty here because the API key was pasted inline (not via
      // env var); backup keys carried over from a previous config
      // are preserved with their envVars.
      keys: keysFromProvider({
        apiKey: apiKey.trim(),
        backupApiKey: cur.backupApiKey || '',
      }),
      models,
      enabled: true,
    };
    if (groupId) cfg.provider[finalId].options = { ...(cfg.provider[finalId].options || {}), groupId };

    // Apply system LLM config so the rest of the dashboard's
    // /api/llm/* calls (auto-title, enhance-prompt) hit this provider.
    if (setAsSystemLlm) {
      cfg.systemLlm = cfg.systemLlm || {};
      cfg.systemLlm.enabled = true;
      cfg.systemLlm.provider = finalId;
      const model = systemLlmModel
        || preferredModel
        || (Array.isArray(models) ? models[0] : null)
        || spec.defaultModel
        || 'MiniMax-M3';
      cfg.systemLlm.model = `${finalId}/${model}`;
    }
    saveConfig(cfg);
    return {
      ok: true,
      provider: cfg.provider[finalId],
      probe: {
        status: probeStatus,
        modelCount: probeModels.length,
        models,
      },
      systemLlm: cfg.systemLlm,
    };
  },

  /**
   * v3.16.0 — Auto-detect providers from environment variables.
   *
   * Recognised API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY,
   * GEMINI_API_KEY / GOOGLE_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY,
   * COHERE_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY,
   * MINIMAX_API_KEY.
   *
   * v3.20.10 — Backup keys: every KNOWN_PROVIDER also accepts a
   * `<NAME>_BACKUP_API_KEY` env var (e.g. `MINIMAX_API_KEY_BACKUP`)
   * and a `backupApiKey` field in the config. autoDetect() returns
   * both, and the dashboard UI surfaces them in the Providers page
   * so the operator knows "if the primary hits a rate limit, swap in
   * the backup manually" without having to dig through shell history.
   *
   * Detection order (highest priority first):
   *   1. config.provider.<id>.apiKey
   *   2. config.provider.<id>.backupApiKey
   *   3. process.env[envKey]        (primary)
   *   4. process.env[backupEnvKey]  (backup)
   *
   * Each entry has a status:
   *   - 'configured' — key present AND format checks out
   *   - 'unknown'    — env var set but format doesn't match known patterns
   *   - 'no-key'     — provider known but no key in env or config
   *
   * Probes the canonical /models endpoint with a 1.5s timeout to confirm
   * the key actually works. Probes are best-effort — failures don't
   * downgrade status from 'configured' to 'no-key'.
   */
  KNOWN_PROVIDERS: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      envKeys: ['ANTHROPIC_API_KEY'],
      backupEnvKeys: ['ANTHROPIC_API_KEY_BACKUP', 'ANTHROPIC_BACKUP_API_KEY'],
      baseURL: 'https://api.anthropic.com/v1',
      keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      envKeys: ['OPENAI_API_KEY'],
      backupEnvKeys: ['OPENAI_API_KEY_BACKUP', 'OPENAI_BACKUP_API_KEY'],
      baseURL: 'https://api.openai.com/v1',
      keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    },
    {
      id: 'google',
      name: 'Google AI',
      envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      backupEnvKeys: ['GEMINI_API_KEY_BACKUP', 'GOOGLE_API_KEY_BACKUP'],
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/,
    },
    {
      id: 'mistral',
      name: 'Mistral',
      envKeys: ['MISTRAL_API_KEY'],
      backupEnvKeys: ['MISTRAL_API_KEY_BACKUP'],
      baseURL: 'https://api.mistral.ai/v1',
      keyPattern: /^[A-Za-z0-9]{20,}$/,
    },
    {
      id: 'groq',
      name: 'Groq',
      envKeys: ['GROQ_API_KEY'],
      backupEnvKeys: ['GROQ_API_KEY_BACKUP'],
      baseURL: 'https://api.groq.com/openai/v1',
      keyPattern: /^gsk_[A-Za-z0-9]{20,}$/,
    },
    {
      id: 'cohere',
      name: 'Cohere',
      envKeys: ['COHERE_API_KEY'],
      backupEnvKeys: ['COHERE_API_KEY_BACKUP'],
      baseURL: 'https://api.cohere.com/v1',
      keyPattern: /^[A-Za-z0-9]{20,}$/,
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      envKeys: ['OPENROUTER_API_KEY'],
      backupEnvKeys: ['OPENROUTER_API_KEY_BACKUP'],
      baseURL: 'https://openrouter.ai/api/v1',
      keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/,
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      envKeys: ['DEEPSEEK_API_KEY'],
      backupEnvKeys: ['DEEPSEEK_API_KEY_BACKUP'],
      baseURL: 'https://api.deepseek.com/v1',
      keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    },
    {
      // v4.5.0 — MiniMax provider, fully implemented. The dashboard
      // onboarding wizard writes the Subscription Key to
      // ~/.local/share/opencode/auth.json (the canonical store written
      // by opencode's `/connect` command). The MiniMax key has a
      // variable-length format; valid prefixes are `sk-cp-` (Token
      // Plan + Coding Plan), `sk-ant-` (Anthropic-format compatible),
      // and `sk-or-` (OpenRouter-style). The chat completions host
      // is `api.minimax.io/v1` (NOT `api.minimax.chat` which 404s).
      id: 'minimax',
      name: 'MiniMax',
      envKeys: ['MINIMAX_API_KEY', 'ANTHROPIC_API_KEY'],
      backupEnvKeys: ['MINIMAX_API_KEY_BACKUP', 'MINIMAX_BACKUP_API_KEY', 'ANTHROPIC_API_KEY_BACKUP'],
      baseURL: 'https://api.minimax.io/v1',
      keyPattern: /^sk-(cp|ant|or)-[A-Za-z0-9_-]{20,}$/,
      defaultModel: 'MiniMax-M3',
      defaultModels: [
        'MiniMax-M2.7-Flash', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed',
        'MiniMax-M3', 'MiniMax-M3-Reasoning',
        'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1',
        'MiniMax-M2.1-highspeed', 'MiniMax-M2',
      ],
    },
    {
      // v4.4.14 — OpenCode Zen. Free tier (per-model free quota + paid
      // top-up). The user signs in to https://opencode.ai/auth and gets
      // an API key, but the dashboard does NOT require a key to add the
      // provider — we generate a placeholder that the user replaces via
      // `bizar minimax config` or the dashboard's edit modal. The base
      // URL is the public Zen endpoint; the model list is from the docs
      // and refreshes on each provider add (probes /v1/models).
      id: 'opencode',
      name: 'OpenCode Zen',
      envKeys: ['OPENCODE_API_KEY'],
      backupEnvKeys: ['OPENCODE_API_KEY_BACKUP'],
      baseURL: 'https://opencode.ai/zen/v1',
      keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
      // Zen uses two base URLs depending on model family:
      //   - OpenAI-compatible: /v1/chat/completions  (M3, M2.x, GLM, Kimi, Grok, DeepSeek, Gemini 3 Flash, Big Pickle, MiMo, North, Nemotron)
      //   - Anthropic-format:  /v1/messages          (Claude family, Qwen3.7, Kimi K2.7)
      //   - Gemini vertex:     /v1/models/gemini-3.5-flash, gemini-3.1-pro, gemini-3-flash
      // The baseURL we store is the OpenAI-compatible path. Mods from
      // Anthropic/Gemini are still selectable (opencode routes internally
      // to the right URL per model). Users with their own OpenAI/
      // Anthropic keys can also use Zen as a pass-through.
      defaultModel: 'gpt-5.5',
      defaultModels: [
        'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
        'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex',
        'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
        'gpt-5', 'gpt-5-codex', 'gpt-5-nano',
        'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
        'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
        'gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3-flash',
        'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus',
        'deepseek-v4-pro', 'deepseek-v4-flash',
        'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
        'glm-5.2', 'glm-5.1', 'glm-5',
        'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5',
        'grok-build-0.1',
        'big-pickle', 'mimo-v2.5-free', 'north-mini-code-free', 'nemotron-3-ultra-free', 'deepseek-v4-flash-free',
      ],
    },
  ],

  async autoDetect({ probe = true } = {}) {
    const result = [];
    for (const spec of this.KNOWN_PROVIDERS) {
      const cfgInfo = (() => {
        try {
          const cfg = loadConfig();
          const cfgProvider = cfg.provider?.[spec.id];
          if (!cfgProvider) return { apiKey: '', backupApiKey: '' };
          return {
            apiKey: cfgProvider.apiKey || cfgProvider.options?.apiKey || '',
            backupApiKey: cfgProvider.backupApiKey || cfgProvider.options?.backupApiKey || '',
          };
        } catch {
          return { apiKey: '', backupApiKey: '' };
        }
      })();

      // Primary: config > env
      let apiKey = cfgInfo.apiKey;
      let keySource = cfgInfo.apiKey ? 'config' : '';
      if (!apiKey) {
        for (const k of spec.envKeys) {
          const v = process.env[k];
          if (typeof v === 'string' && v.length > 0) {
            apiKey = v;
            keySource = `env:${k}`;
            break;
          }
        }
      }

      // Backup: config > env (independent from primary; you can have
      // a backup key without a primary, e.g. if you rotate).
      let backupApiKey = cfgInfo.backupApiKey;
      let backupSource = cfgInfo.backupApiKey ? 'config' : '';
      if (!backupApiKey) {
        for (const k of spec.backupEnvKeys || []) {
          const v = process.env[k];
          if (typeof v === 'string' && v.length > 0) {
            backupApiKey = v;
            backupSource = `env:${k}`;
            break;
          }
        }
      }

      const status = !apiKey
        ? 'no-key'
        : spec.keyPattern && !spec.keyPattern.test(apiKey)
        ? 'unknown'
        : 'configured';
      const backupStatus = !backupApiKey
        ? 'no-key'
        : spec.keyPattern && !spec.keyPattern.test(backupApiKey)
        ? 'unknown'
        : 'configured';

      // Probe primary
      const probeResult = await this._probeKey(spec, apiKey, probe && status === 'configured');
      const backupProbe = await this._probeKey(spec, backupApiKey, probe && backupStatus === 'configured');

      result.push({
        id: spec.id,
        name: spec.name,
        baseURL: spec.baseURL,
        envKeys: spec.envKeys,
        backupEnvKeys: spec.backupEnvKeys || [],
        status,
        keySource,
        hasKey: !!apiKey,
        probed: probeResult,
        backup: {
          status: backupStatus,
          source: backupSource,
          hasKey: !!backupApiKey,
          probed: backupProbe,
        },
      });
    }
    return result;
  },

  /**
   * v3.20.10 — Probe a single key against the provider's /models endpoint.
   * Returns { ok, status, modelCount? } or { ok: false, reason }.
   * Exposed as a separate helper so primary + backup keys can be
   * probed independently (each gets its own timeout + result).
   */
  async _probeKey(spec, apiKey, shouldProbe) {
    if (!shouldProbe || !apiKey || !spec.baseURL) return null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const url = `${spec.baseURL}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const out = { ok: resp.ok, status: resp.status };
      if (resp.ok) {
        try {
          const body = await resp.json();
          if (Array.isArray(body?.data)) out.modelCount = body.data.length;
          else if (Array.isArray(body)) out.modelCount = body.length;
        } catch { /* ignore parse */ }
      } else {
        out.reason = `HTTP ${resp.status}`;
      }
      return out;
    } catch (err) {
      return {
        ok: false,
        reason: err && err.name === 'AbortError' ? 'timeout' : 'network',
      };
    }
  },
};

export const mcpsStore = {
  OPENCODE_JSON,

  list() {
    const cfg = loadConfig();
    const mcps = cfg.mcp || {};
    return Object.entries(mcps).map(([id, m]) => {
      const isRemote = m?.type === 'remote';
      // Local MCP: command is an array in newer opencode.json. Older
      // format had separate `command` (string) + `args` (array). Normalize.
      const command = isRemote
        ? ''
        : Array.isArray(m.command)
          ? m.command.join(' ')
          : (m.command || '');
      const args = isRemote
        ? []
        : Array.isArray(m.command)
          ? m.command
          : Array.isArray(m.args)
            ? m.args
            : [];
      return {
        id,
        type: isRemote ? 'remote' : 'local',
        command,
        args,
        env: m.env || {},
        url: m.url || '',
        headers: m.headers || {},
        oauth: !!m.oauth,
        enabled: m.enabled !== false,
      };
    });
  },

  get(id) {
    return this.list().find((m) => m.id === id) || null;
  },

  add(input) {
    if (!input || !input.id) throw new Error('id is required');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input.id)) {
      throw new Error('invalid id');
    }
    const cfg = loadConfig();
    cfg.mcp = cfg.mcp || {};
    if (cfg.mcp[input.id]) throw new Error(`mcp "${input.id}" exists`);
    const isRemote = input.type === 'remote';
    cfg.mcp[input.id] = isRemote
      ? {
          type: 'remote',
          url: input.url || '',
          headers: input.headers || {},
          oauth: !!input.oauth,
          enabled: input.enabled !== false,
        }
      : {
          type: 'local',
          command: Array.isArray(input.args) && input.args.length > 0
            ? [input.command || '', ...input.args].filter(Boolean)
            : (input.command || ''),
          enabled: input.enabled !== false,
          ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
        };
    saveConfig(cfg);
    return this.get(input.id);
  },

  update(id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch required');
    const cfg = loadConfig();
    cfg.mcp = cfg.mcp || {};
    const cur = cfg.mcp[id];
    if (!cur) throw new Error(`mcp "${id}" not found`);
    const wasRemote = cur.type === 'remote';
    const isRemote = patch.type ? patch.type === 'remote' : wasRemote;
    if (isRemote) {
      cfg.mcp[id] = {
        type: 'remote',
        url: patch.url ?? cur.url ?? '',
        headers: patch.headers ?? cur.headers ?? {},
        oauth: patch.oauth ?? cur.oauth ?? false,
        enabled: patch.enabled ?? cur.enabled ?? true,
      };
    } else {
      const nextCommand = Array.isArray(patch.args) && patch.args.length > 0
        ? [patch.command ?? cur.command ?? '', ...patch.args].filter(Boolean)
        : (patch.command ?? cur.command ?? '');
      cfg.mcp[id] = {
        type: 'local',
        command: nextCommand,
        enabled: patch.enabled ?? cur.enabled ?? true,
        ...((patch.env && Object.keys(patch.env).length > 0) || cur.env
          ? { env: patch.env ?? cur.env ?? {} }
          : {}),
      };
    }
    saveConfig(cfg);
    return this.get(id);
  },

  remove(id) {
    const cfg = loadConfig();
    if (!cfg.mcp || !cfg.mcp[id]) return false;
    delete cfg.mcp[id];
    saveConfig(cfg);
    return true;
  },
};
