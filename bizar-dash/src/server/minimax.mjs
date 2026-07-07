/**
 * src/server/minimax.mjs
 *
 * v4.5.0 — MiniMax API client.
 *
 * Owns the network calls to platform.minimax.io for the Bizar
 * dashboard. The Subscription Key is read from cline's canonical
 * auth store (`~/.local/share/cline/auth.json`) so the user only
 * enters the key once (via cline's `/connect` command) and the
 * dashboard picks it up automatically.
 *
 * Key resolution chain (in order, first match wins):
 *   1. process.env.MINIMAX_API_KEY
 *   2. process.env.ANTHROPIC_API_KEY     (MiniMax accepts Anthropic keys)
 *   3. ~/.local/share/cline/auth.json → "minimax" → "key"
 *   4. ~/.config/cline/cline.json → provider.minimax.options.apiKey
 *   5. ~/.config/cline/cline.json → provider.minimax.apiKey
 *
 * Two surfaces:
 *   - fetchRemains()       — Token Plan quota (5h + weekly per model)
 *   - chatCompletion()     — one-shot chat call for the "test prompt" UI
 *
 * All network calls are guarded by a 10s timeout so a hung API
 * never wedges the dashboard. Responses are cached in memory (60s)
 * and on disk (5min at ~/.config/bizar/minimax/remains-cache.json) so
 * renders are fast and the API isn't hammered.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const CLINE_AUTH_FILE = join(HOME, '.local', 'share', 'cline', 'auth.json');
const CLINE_CONFIG_FILE = join(HOME, '.config', 'cline', 'cline.json');
const CACHE_DIR = join(BIZAR_HOME, 'minimax');
const CACHE_FILE = join(CACHE_DIR, 'remains-cache.json');

// Default base URLs. The docs say `https://www.minimax.io/v1/token_plan/remains`
// (note: the `www` host, not `api`). The chat completions / OpenAI-format
// surface lives on api.minimax.io.
export const DEFAULT_BASE_URL = 'https://www.minimax.io';
export const DEFAULT_CHAT_BASE_URL = 'https://api.minimax.io/v1';

// Full MiniMax model list. Pulled live from /v1/models on the user's key
// and cached in the dashboard. The dashboard's "Usage" view shows
// remaining quota per-model.
export const KNOWN_MODELS = [
  'MiniMax-M3',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
  'MiniMax-M2.1',
  'MiniMax-M2.1-highspeed',
  'MiniMax-M2',
];

// Valid MiniMax API key prefixes (subscription + pay-as-you-go).
// The user's key starts with `sk-cp-` and is 125 chars long. Real
// keys have variable lengths and may include dashes, so the pattern
// only validates the prefix.
const MINIMAX_KEY_PATTERN = /^sk-(cp|ant|or)-[A-Za-z0-9_-]{20,}$/;

// ─── Key resolution ─────────────────────────────────────────────────────

function safeReadJson(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Resolve the MiniMax Subscription Key from cline's canonical store.
 * Returns `{ key: string|null, source: string, groupId: string }`.
 *
 * `source` is one of:
 *   - 'env:MINIMAX_API_KEY'
 *   - 'env:ANTHROPIC_API_KEY'
 *   - 'auth.json'
 *   - 'cline.json:options.apiKey'
 *   - 'cline.json:apiKey'
 *   - 'none'
 */
export function resolveApiKey() {
  // 1. Env vars — cline reads MINIMAX_API_KEY first
  if (process.env.MINIMAX_API_KEY && process.env.MINIMAX_API_KEY.trim()) {
    return {
      key: process.env.MINIMAX_API_KEY.trim(),
      source: 'env:MINIMAX_API_KEY',
      groupId: 'default',
    };
  }
  // 2. Anthropic key works against MiniMax's Anthropic-format surface
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return {
      key: process.env.ANTHROPIC_API_KEY.trim(),
      source: 'env:ANTHROPIC_API_KEY',
      groupId: 'default',
    };
  }
  // 3. ~/.local/share/cline/auth.json
  const auth = safeReadJson(CLINE_AUTH_FILE, null);
  if (auth && typeof auth === 'object' && auth.minimax && auth.minimax.key) {
    return {
      key: String(auth.minimax.key).trim(),
      source: 'auth.json',
      groupId: String(auth.minimax.group_id || 'default'),
    };
  }
  // 4. cline.json → provider.minimax.options.apiKey
  const cfg = safeReadJson(CLINE_CONFIG_FILE, null);
  const minimax = cfg?.provider?.minimax;
  if (minimax?.options?.apiKey) {
    return {
      key: String(minimax.options.apiKey).trim(),
      source: 'cline.json:options.apiKey',
      groupId: String(cfg.provider.minimax.group_id || 'default'),
    };
  }
  // 5. cline.json → provider.minimax.apiKey
  if (minimax?.apiKey) {
    return {
      key: String(minimax.apiKey).trim(),
      source: 'cline.json:apiKey',
      groupId: String(cfg.provider.minimax.group_id || 'default'),
    };
  }
  return { key: null, source: 'none', groupId: 'default' };
}

/**
 * Base URL resolution. The Token Plan endpoint lives on www.minimax.io;
 * the chat completions live on api.minimax.io/v1. If the user has
 * set a custom base URL in cline.json's `options.baseURL`, that
 * wins (with path-aware logic — we extract the host).
 */
export function resolveBaseUrls() {
  const cfg = safeReadJson(CLINE_CONFIG_FILE, null);
  const minimaxOpts = cfg?.provider?.minimax?.options || {};
  let tokenBase = DEFAULT_BASE_URL;
  let chatBase = DEFAULT_CHAT_BASE_URL;
  if (typeof minimaxOpts.baseURL === 'string' && minimaxOpts.baseURL.trim()) {
    const u = minimaxOpts.baseURL.trim();
    // If the user already points at the OpenAI-format surface, keep
    // it as chatBase. Otherwise we use it for both, falling back to
    // known hosts when the path looks like a generic base.
    try {
      const parsed = new URL(u);
      const host = parsed.host;
      if (host.startsWith('api.')) {
        chatBase = u.replace(/\/$/, '');
        tokenBase = chatBase.replace(/^https?:\/\/api\./, 'https://www.');
      } else if (host.startsWith('www.')) {
        tokenBase = u.replace(/\/$/, '');
        chatBase = tokenBase.replace(/^https?:\/\/www\./, 'https://api.') + '/v1';
      }
    } catch {
      // ignore — fall through to defaults
    }
  }
  return { tokenBase, chatBase };
}

// ─── Cache ────────────────────────────────────────────────────────────────

let memoryCache = null;

function readDiskCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const stat = statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) return null; // 5 min TTL
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeDiskCache(snapshot) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

export function clearRemainsCache() {
  memoryCache = null;
  try {
    if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE);
  } catch { /* best-effort */ }
}

export function readCachedRemains() {
  if (memoryCache) return memoryCache;
  const fromDisk = readDiskCache();
  if (fromDisk) {
    memoryCache = fromDisk;
    return fromDisk;
  }
  return null;
}

// ─── Network helpers ─────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── Auth-file writer (for onboarding) ─────────────────────────────────

/**
 * Write the MiniMax key to cline's auth store at the canonical
 * path. Returns the path that was written. Used by the dashboard's
 * onboarding wizard so the user only enters the key once.
 */
export function writeAuthFile(key, groupId = 'default') {
  mkdirSync(dirname(CLINE_AUTH_FILE), { recursive: true });
  const cur = safeReadJson(CLINE_AUTH_FILE, {}) || {};
  cur.minimax = {
    type: 'api',
    key: String(key).trim(),
  };
  if (groupId) cur.minimax.group_id = groupId;
  writeFileSync(CLINE_AUTH_FILE, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  return CLINE_AUTH_FILE;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Read the dashboard-side config that cline doesn't own:
 *   - the onboarding "dismissed" flag (so we don't keep nagging the
 *     user with the first-run wizard after they've seen it once)
 *   - the per-model enabled flag (so the user can hide a model
 *     they don't want to track)
 *
 * Stored at ~/.config/bizar/minimax/onboarding.json.
 */
export function readOnboarding() {
  return safeReadJson(join(BIZAR_HOME, 'minimax', 'onboarding.json'), {
    dismissedAt: null,
    hiddenModels: [],
  });
}

export function writeOnboarding(patch) {
  const cur = readOnboarding();
  const next = { ...cur, ...patch };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(BIZAR_HOME, 'minimax', 'onboarding.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/**
 * Snapshot of the current MiniMax state for the dashboard. The
 * `status` route returns this so the React view knows whether to
 * show the wizard, the live dashboard, or a "needs configuration"
 * banner.
 */
export function getStatus() {
  const resolved = resolveApiKey();
  const urls = resolveBaseUrls();
  const cached = readCachedRemains();
  return {
    configured: !!resolved.key,
    apiKeyHint: maskKey(resolved.key),
    source: resolved.source,
    groupId: resolved.groupId,
    tokenBaseUrl: urls.tokenBase,
    chatBaseUrl: urls.chatBase,
    knownModels: KNOWN_MODELS,
    keyPatternValid: resolved.key ? MINIMAX_KEY_PATTERN.test(resolved.key) : null,
    cache: cached
      ? {
          fetchedAt: cached.fetchedAt,
          apiKeyHint: cached.apiKeyHint,
          modelCount: (cached.models || []).length,
        }
      : null,
  };
}

/**
 * Hit /v1/token_plan/remains with the user's resolved key.
 *
 * Returns the raw response, augmented with `fetchedAt`, ISO timestamps
 * for the reset windows, and pre-computed consumed-percent fields so
 * the UI doesn't have to do arithmetic on every cell.
 */
export async function fetchRemains({ force = false } = {}) {
  const resolved = resolveApiKey();
  if (!resolved.key) {
    return { ok: false, error: 'no_api_key', message: 'MiniMax Subscription Key is not configured. Run `bizar setup` or add it via the dashboard onboarding.' };
  }
  if (!MINIMAX_KEY_PATTERN.test(resolved.key)) {
    return { ok: false, error: 'invalid_key_format', message: 'MiniMax key does not look right. Expected sk-cp-…, sk-ant-…, or sk-or-… prefix.' };
  }
  if (!force) {
    const cached = readCachedRemains();
    if (cached && cached.apiKeyHint === maskKey(resolved.key) && (Date.now() - cached.fetchedAt) < 60_000) {
      // Cached — still record it so usage totals stay honest.
      await recordUsageDynamic({
        providerId: 'minimax',
        modelId: 'unknown',
        endpoint: 'remains',
        requestId: `rem_${Math.random().toString(36).slice(2, 9)}`,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        latencyMs: 0,
        finishReason: null,
        error: null,
        keyEnvVar: resolved.source,
        isBackup: false,
        cached: true,
      });
      return { ok: true, cached: true, ...cached };
    }
  }
  const urls = resolveBaseUrls();
  const url = `${urls.tokenBase.replace(/\/$/, '')}/v1/token_plan/remains?group_id=${encodeURIComponent(resolved.groupId)}`;
  const requestId = `rem_${Math.random().toString(36).slice(2, 9)}`;
  const startMs = Date.now();
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: 'unknown',
      endpoint: 'remains',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs,
      finishReason: null,
      error: { code: 'network_error', message: err.message || 'fetch failed' },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return { ok: false, error: 'network_error', message: err.message || 'fetch failed' };
  }
  const latencyMs = Date.now() - startMs;
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep as null */ }
  if (!resp.ok) {
    // v5.5.2 — Provide descriptive messages for common failure modes
    // rather than surfacing raw HTTP status text.
    let errMsg;
    if (resp.status === 404) {
      errMsg =
        'MiniMax token plan API returned 404. The endpoint may have changed — ' +
        'this may require a BizarHarness update. group_id=' +
        encodeURIComponent(resolved.groupId);
    } else if (resp.status === 401 || resp.status === 403) {
      errMsg = 'MiniMax API key is invalid or expired. Check your key in the dashboard onboarding.';
    } else if (resp.status === 429) {
      errMsg = 'MiniMax API rate limit hit. Try again in a few minutes.';
    } else {
      errMsg = body?.base_resp?.status_msg || resp.statusText || 'request failed';
    }
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: 'unknown',
      endpoint: 'remains',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs,
      finishReason: null,
      error: { code: `http_${resp.status}`, message: errMsg },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return {
      ok: false,
      error: `http_${resp.status}`,
      message: errMsg,
      status: resp.status,
    };
  }
  if (!body || body.base_resp?.status_code !== 0) {
    const errMsg = body?.base_resp?.status_msg || 'unknown error';
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: 'unknown',
      endpoint: 'remains',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs,
      finishReason: null,
      error: { code: 'api_error', message: errMsg },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return {
      ok: false,
      error: 'api_error',
      message: errMsg,
      raw: body,
    };
  }

  // Record success for remains (no token metering — it's a quota check).
  await recordUsageDynamic({
    providerId: 'minimax',
    modelId: 'unknown',
    endpoint: 'remains',
    requestId,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    latencyMs,
    finishReason: null,
    error: null,
    keyEnvVar: resolved.source,
    isBackup: false,
    cached: false,
  });

  // Augment with ISO timestamps + human labels for the UI.
  const models = (body.model_remains || []).map((m) => ({
    ...m,
    endTimeISO: new Date(m.end_time).toISOString(),
    weeklyEndTimeISO: new Date(m.weekly_end_time).toISOString(),
    intervalResetInMs: m.remains_time,
    weeklyResetInMs: m.weekly_remains_time,
    intervalResetInHuman: humanizeDuration(m.remains_time),
    weeklyResetInHuman: humanizeDuration(m.weekly_remains_time),
    intervalConsumedPercent: clamp(100 - (m.current_interval_remaining_percent || 0), 0, 100),
    weeklyConsumedPercent: clamp(100 - (m.current_weekly_remaining_percent || 0), 0, 100),
    intervalUsed: m.current_interval_usage_count || 0,
    intervalTotal: m.current_interval_total_count || 0,
    weeklyUsed: m.current_weekly_usage_count || 0,
    weeklyTotal: m.current_weekly_total_count || 0,
  }));

  const snapshot = {
    ok: true,
    fetchedAt: Date.now(),
    apiKeyHint: maskKey(resolved.key),
    keySource: resolved.source,
    groupId: resolved.groupId,
    baseUrl: urls.tokenBase,
    models,
    baseResp: body.base_resp,
  };
  memoryCache = snapshot;
  writeDiskCache(snapshot);
  return snapshot;
}

/**
 * Send a single chat-completion to /v1/chat/completions and return
 * the parsed response + parsed `usage` block. Used by the dashboard's
 * "Send a test prompt" button.
 */
export async function chatCompletion({
  prompt,
  model = 'MiniMax-M3',
  maxTokens = 256,
} = {}) {
  const resolved = resolveApiKey();
  if (!resolved.key) {
    return { ok: false, error: 'no_api_key', message: 'MiniMax Subscription Key is not configured.' };
  }
  if (!prompt || !prompt.trim()) {
    return { ok: false, error: 'no_prompt', message: 'prompt is empty' };
  }
  const urls = resolveBaseUrls();
  const url = `${urls.chatBase.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: maxTokens,
    stream: false,
  });
  const requestId = `msg_${Math.random().toString(36).slice(2, 9)}`;
  const startMs = Date.now();
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    // Record error usage.
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: model,
      endpoint: 'chat',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs: Date.now() - startMs,
      finishReason: null,
      error: { code: 'network_error', message: err.message || 'fetch failed' },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return { ok: false, error: 'network_error', message: err.message || 'fetch failed' };
  }
  const latencyMs = Date.now() - startMs;
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!resp.ok) {
    const errMsg = data?.base_resp?.status_msg || resp.statusText || 'request failed';
    // Record error usage.
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: model,
      endpoint: 'chat',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs,
      finishReason: null,
      error: { code: `http_${resp.status}`, message: errMsg },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return {
      ok: false,
      error: `http_${resp.status}`,
      message: errMsg,
      status: resp.status,
      raw: data,
    };
  }
  if (!data || data.base_resp?.status_code !== 0) {
    const errMsg = data?.base_resp?.status_msg || 'unknown error';
    // Record error usage.
    await recordUsageDynamic({
      providerId: 'minimax',
      modelId: model,
      endpoint: 'chat',
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      latencyMs,
      finishReason: null,
      error: { code: 'api_error', message: errMsg },
      keyEnvVar: resolved.source,
      isBackup: false,
      cached: false,
    });
    return {
      ok: false,
      error: 'api_error',
      message: errMsg,
      raw: data,
    };
  }
  const choice = (data.choices || [])[0] || {};
  const content = choice?.message?.content || '';
  const usage = data.usage || null;
  const promptTokens     = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens     = usage?.total_tokens ?? promptTokens + completionTokens;
  const cachedTokens    = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  // Record success usage.
  await recordUsageDynamic({
    providerId: 'minimax',
    modelId: data.model || model,
    endpoint: 'chat',
    requestId,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
    latencyMs,
    finishReason: choice?.finish_reason || null,
    error: null,
    keyEnvVar: resolved.source,
    isBackup: false,
    cached: false,
  });

  return {
    ok: true,
    model: data.model || model,
    content,
    reasoning: choice?.message?.reasoning_content || null,
    finishReason: choice?.finish_reason || null,
    usage,
    baseResp: data.base_resp,
  };
}

/**
 * Dynamically import the usage store and record a usage entry.
 * Separated from chatCompletion() to avoid a circular import.
 * @param {object} record
 */
async function recordUsageDynamic(record) {
  try {
    const { recordUsage } = await import('./minimax-usage-store.mjs');
    recordUsage(record);
  } catch { /* best-effort — usage recording must never break the API */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mask the API key for safe logging / display. Shows last 4 chars. */
export function maskKey(key) {
  if (!key) return '';
  const trimmed = String(key).trim();
  if (trimmed.length <= 6) return '****';
  return `****${trimmed.slice(-4)}`;
}

/** Convert a millisecond duration into a compact human label. */
export function humanizeDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'now';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day >= 1) return `${day}d ${hr % 24}h`;
  if (hr >= 1) return `${hr}h ${min % 60}m`;
  if (min >= 1) return `${min}m`;
  return `${sec}s`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
