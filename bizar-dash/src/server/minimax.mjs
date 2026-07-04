/**
 * src/server/minimax.mjs
 *
 * v4.5.0 — MiniMax API client.
 *
 * Owns the network calls to platform.minimax.io for the Bizar
 * dashboard. Two surfaces:
 *
 *  1. fetchRemains()  — the public `/v1/token_plan/remains` endpoint.
 *     Returns the user's remaining Token Plan quota per model — both
 *     5-hour rolling window and weekly window — including the reset
 *     times for each. This is the headline data the user wants to see.
 *
 *  2. chatCompletion() — a thin wrapper around `/v1/chat/completions`
 *     (OpenAI-compatible) for the dashboard's "Send a test prompt"
 *     button. Also captures the `usage` block from the response so the
 *     dashboard can show per-call consumption.
 *
 * The client always reads the API key from the user's settings
 * (settings.minimax.apiKey) and never logs it. The base URL is
 * configurable but defaults to `https://www.minimax.io` per the docs.
 *
 * Token Plan endpoints live on `www.minimax.io` (NOT `api.minimax.io`
 * — the chat completions endpoint uses that one). The default
 * `baseUrl` in the settings uses the Token Plan host so `fetchRemains`
 * works out of the box.
 *
 * All network calls are guarded by a 10s timeout so a hung API
 * never wedges the dashboard.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const CACHE_DIR = join(BIZAR_HOME, 'minimax');
const CACHE_FILE = join(CACHE_DIR, 'remains-cache.json');

// Default base URL. The docs say `https://www.minimax.io/v1/token_plan/remains`
// (note: the `www` host, not `api`). Allow override per-user in settings.
export const DEFAULT_BASE_URL = 'https://www.minimax.io';
// Chat completions / OpenAI-style surface lives on api.minimax.io.
export const DEFAULT_CHAT_BASE_URL = 'https://api.minimax.io/v1';

// Models Bizar exposes by default in the dashboard.
export const KNOWN_MODELS = [
  'MiniMax-M3',
  'MiniMax-M2.7',
  'MiniMax-M2.5',
  'MiniMax-M2.1',
  'MiniMax-M2',
];

/**
 * Read the merged settings.json and return the MiniMax config block.
 * Never throws — returns sane defaults on parse failure.
 */
export function readMinimaxSettings() {
  const file = join(BIZAR_HOME, 'settings.json');
  if (!existsSync(file)) {
    return defaultMinimaxSettings();
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const m = parsed.minimax;
    if (!m || typeof m !== 'object') return defaultMinimaxSettings();
    return {
      enabled: m.enabled !== false,
      apiKey: typeof m.apiKey === 'string' ? m.apiKey : '',
      groupId: typeof m.groupId === 'string' ? m.groupId : 'default',
      baseUrl: typeof m.baseUrl === 'string' ? m.baseUrl : DEFAULT_BASE_URL,
      chatBaseUrl: typeof m.chatBaseUrl === 'string' ? m.chatBaseUrl : DEFAULT_CHAT_BASE_URL,
    };
  } catch {
    return defaultMinimaxSettings();
  }
}

export function defaultMinimaxSettings() {
  return {
    enabled: true,
    apiKey: '',
    groupId: 'default',
    baseUrl: DEFAULT_BASE_URL,
    chatBaseUrl: DEFAULT_CHAT_BASE_URL,
  };
}

// ─── Cache (in-memory + disk) ──────────────────────────────────────────────

/**
 * In-memory snapshot of the last remains response. Avoids re-hitting the
 * API on every dashboard render.
 */
let memoryCache = null;

function readDiskCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const stat = require('node:fs').statSync(CACHE_FILE);
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
  } catch {
    /* best-effort */
  }
}

export function clearRemainsCache() {
  memoryCache = null;
  try {
    if (existsSync(CACHE_FILE)) {
      require('node:fs').unlinkSync(CACHE_FILE);
    }
  } catch { /* best-effort */ }
}

/**
 * Try in-memory → disk cache. Returns the cached snapshot or null.
 */
export function readCachedRemains() {
  if (memoryCache) return memoryCache;
  const fromDisk = readDiskCache();
  if (fromDisk) {
    memoryCache = fromDisk;
    return fromDisk;
  }
  return null;
}

// ─── Network helpers ──────────────────────────────────────────────────────

/**
 * Fetch with a hard timeout. Uses undici (Node 18+ global fetch is
 * fine but AbortSignal.timeout is simpler with node:fetch).
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Hit /v1/token_plan/remains with the user's API key + group_id.
 *
 * Response shape:
 *   {
 *     model_remains: [
 *       { model_name, current_interval_remaining_percent, current_weekly_remaining_percent,
 *         start_time, end_time, remains_time, weekly_start_time, weekly_end_time,
 *         weekly_remains_time, current_interval_total_count, current_interval_usage_count,
 *         current_weekly_total_count, current_weekly_usage_count,
 *         current_interval_status, current_weekly_status },
 *       ...
 *     ],
 *     base_resp: { status_code, status_msg }
 *   }
 *
 * Returns the raw response, augmented with `fetchedAt` and (if we got
 * data) the per-model `endTimeISO` / `weeklyEndTimeISO` strings for
 * convenient rendering in the UI.
 */
export async function fetchRemains({ apiKey, groupId = 'default', baseUrl = DEFAULT_BASE_URL, force = false } = {}) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'no_api_key', message: 'MiniMax API key is not configured' };
  }
  if (!force) {
    const cached = readCachedRemains();
    if (cached && cached.apiKeyHint === maskKey(apiKey) && (Date.now() - cached.fetchedAt) < 60_000) {
      return { ok: true, cached: true, ...cached };
    }
  }
  const url = `${baseUrl.replace(/\/$/, '')}/v1/token_plan/remains?group_id=${encodeURIComponent(groupId)}`;
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message || 'fetch failed' };
  }
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep as null */ }
  if (!resp.ok) {
    return {
      ok: false,
      error: `http_${resp.status}`,
      message: body?.base_resp?.status_msg || resp.statusText || 'request failed',
      status: resp.status,
    };
  }
  if (!body || body.base_resp?.status_code !== 0) {
    return {
      ok: false,
      error: 'api_error',
      message: body?.base_resp?.status_msg || 'unknown error',
      raw: body,
    };
  }

  // Augment with ISO timestamps so the UI doesn't have to do ms → Date
  // arithmetic for every cell.
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
    apiKeyHint: maskKey(apiKey),
    groupId,
    baseUrl,
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
 * "Send a test prompt" button so the user can verify their key works
 * and see live token usage.
 */
export async function chatCompletion({
  apiKey,
  prompt,
  model = 'MiniMax-M3',
  baseUrl = DEFAULT_CHAT_BASE_URL,
  maxTokens = 256,
} = {}) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'no_api_key', message: 'MiniMax API key is not configured' };
  }
  if (!prompt || !prompt.trim()) {
    return { ok: false, error: 'no_prompt', message: 'prompt is empty' };
  }
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: maxTokens,
    stream: false,
  });
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    return { ok: false, error: 'network_error', message: err.message || 'fetch failed' };
  }
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!resp.ok) {
    return {
      ok: false,
      error: `http_${resp.status}`,
      message: data?.base_resp?.status_msg || resp.statusText || 'request failed',
      status: resp.status,
      raw: data,
    };
  }
  if (!data || data.base_resp?.status_code !== 0) {
    return {
      ok: false,
      error: 'api_error',
      message: data?.base_resp?.status_msg || 'unknown error',
      raw: data,
    };
  }
  const choice = (data.choices || [])[0] || {};
  const content = choice?.message?.content || '';
  return {
    ok: true,
    model: data.model || model,
    content,
    reasoning: choice?.message?.reasoning_content || null,
    finishReason: choice?.finish_reason || null,
    usage: data.usage || null,
    baseResp: data.base_resp,
  };
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
