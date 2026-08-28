/**
 * cli/commands/models.mjs
 *
 * `bizar models` — user-controlled model picker.
 *
 *   bizar models                # interactive: list + multi-select picker
 *   bizar models --list         # non-interactive: list candidate IDs (one per line)
 *   bizar models --set id1,id2  # non-interactive: set the user-selected list directly
 *   bizar models --clear        # clear userSelected, fall back to session-only
 *   bizar models --json         # machine-readable output for any subcommand
 *
 * The picked IDs persist under `config/claude/model-router.json#userSelected`.
 * The orchestrator (Mike) dispatches subagents using ONLY these user-selected
 * models. The `bizar_model_list` MCP tool also surfaces only these IDs.
 *
 * The picker is the discovery surface — live discovery from the gateway is
 * optional and only used to populate the candidate pool. It is not used to
 * reject user-selected IDs.
 */
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import readline from 'node:readline';

import {
  rankUserSelectedForRole as rankUserSelectedForRoleMirror,
} from '../../packages/sdk/dist/router/failover-mirror.mjs';

// ── Endpoint resolution ──────────────────────────────────────────────────────

/**
 * Read env vars, then fall back to ~/.claude/settings.json, then to the
 * defaults baked into model-router.json#endpoint.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, settingsJsonPath?: string }} opts
 * @returns {{ endpoint: string, authToken: string|null, source: string }}
 */
export function resolveEndpoint(opts = {}) {
  const env = opts.env || process.env;
  const fromEnvUrl = env.BIZAR_MODEL_ROUTER_URL || env.ANTHROPIC_BASE_URL || null;
  const fromEnvToken = env.ANTHROPIC_AUTH_TOKEN || null;

  let settings = null;
  const settingsPath = opts.settingsJsonPath || join(homedir(), '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (raw && typeof raw === 'object') settings = raw;
    } catch {
      settings = null;
    }
  }
  const settingsEnv = settings && settings.env && typeof settings.env === 'object' ? settings.env : {};
  const fromSettingsUrl = settingsEnv.BIZAR_MODEL_ROUTER_URL || settingsEnv.ANTHROPIC_BASE_URL || null;
  const fromSettingsToken = settingsEnv.ANTHROPIC_AUTH_TOKEN || null;

  let fromRouterUrl = null;
  const routerPath = resolveRouterPath(opts.cwd || process.cwd());
  if (existsSync(routerPath)) {
    try {
      const router = JSON.parse(readFileSync(routerPath, 'utf8'));
      if (router && typeof router === 'object' && typeof router.endpoint === 'string') {
        fromRouterUrl = router.endpoint;
      }
    } catch {
      fromRouterUrl = null;
    }
  }

  const url = fromEnvUrl || fromSettingsUrl || fromRouterUrl || 'http://localhost:20128/v1';
  const token = fromEnvToken || fromSettingsToken;
  const source = fromEnvUrl ? 'env'
    : fromSettingsUrl ? 'settings.json'
    : fromRouterUrl ? 'model-router.json'
    : 'default';
  return { endpoint: url, authToken: token, source };
}

export function resolveRouterPath(cwd) {
  const fromEnv = process.env.BIZAR_MODEL_ROUTER_CONFIG;
  if (fromEnv && typeof fromEnv === 'string') {
    return isAbsolute(fromEnv) ? fromEnv : resolve(cwd, fromEnv);
  }
  return resolve(cwd, 'config', 'claude', 'model-router.json');
}

/**
 * F-190 / IMP-017 explicit alias map reader. Reads
 * `~/.config/bizar/alias-map.json` and returns the parsed map (empty
 * object when the file is missing or unreadable). Mirrors the SDK's
 * `getAliasMap` helper — the CLI is the canonical writer so this
 * helper exists so the JS code path can stay self-contained.
 */
export function loadAliasMap(home = homedir()) {
  const path = join(home, '.config', 'bizar', 'alias-map.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

// ── Discovery ────────────────────────────────────────────────────────────────

export const MODELS_DEV_CATALOG_URL = 'https://models.dev/models.json';

/**
 * F-190 / IMP-017 provider-specific serving catalogue.
 * https://models.dev/catalog.json carries per-provider rate limits,
 * gateway IDs, and provider endpoints that differ from the
 * provider-agnostic /models.json metadata. The fetch path is the same
 * shape (JSON over HTTPS, AbortController timeout) but the body is
 * stored verbatim under `serving` so the SDK can layer provider
 * overrides on top of base profiles.
 */
export const MODELS_DEV_PROVIDER_CATALOG_URL = 'https://models.dev/catalog.json';

/**
 * Fetch provider-agnostic capability metadata from Models.dev. This is
 * best-effort enrichment: gateway discovery remains authoritative for which
 * model IDs are dispatchable.
 *
 * URL resolution: explicit `url` arg → `BIZAR_MODELS_DEV_URL` env var →
 * `MODELS_DEV_CATALOG_URL` default. The env var lets tests point the
 * catalog fetch at a stub HTTP server without monkey-patching
 * `globalThis.fetch`.
 */
export async function fetchModelsDevCatalog({
  fetchFn,
  timeoutMs = 5000,
  url,
} = {}) {
  const resolvedUrl = url || process.env.BIZAR_MODELS_DEV_URL || MODELS_DEV_CATALOG_URL;
  const doFetch = fetchFn || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('no fetch implementation available in this runtime');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(resolvedUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Models.dev returned ${res.status} ${res.statusText}`);
    const body = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Models.dev returned an invalid catalogue');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch provider-specific serving metadata from
 * `https://models.dev/catalog.json`. Same shape as
 * `fetchModelsDevCatalog` but exposed separately so callers can layer
 * provider overrides on top of base profiles.
 */
export async function fetchProviderCatalog({
  fetchFn,
  timeoutMs = 5000,
  url = MODELS_DEV_PROVIDER_CATALOG_URL,
} = {}) {
  return fetchModelsDevCatalog({ fetchFn, timeoutMs, url });
}

function flattenModelsDevCatalog(catalog) {
  const entries = new Map();
  const add = (id, value) => {
    if (typeof id !== 'string' || !id.trim() || !value || typeof value !== 'object' || Array.isArray(value)) return;
    entries.set(id.trim().toLowerCase(), { id: id.trim(), ...value });
  };
  for (const [key, value] of Object.entries(catalog || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const looksLikeModel = 'name' in value || 'family' in value || 'tool_call' in value
      || 'reasoning' in value || 'limit' in value || 'modalities' in value;
    if (looksLikeModel) add(key, value);
    if (value.models && typeof value.models === 'object' && !Array.isArray(value.models)) {
      for (const [modelId, model] of Object.entries(value.models)) {
        add(modelId.includes('/') ? modelId : `${key}/${modelId}`, model);
      }
    }
  }
  return entries;
}

function normalizedModelIdentity(id) {
  const raw = String(id || '').trim().toLowerCase();
  const slash = raw.indexOf('/');
  const provider = slash >= 0 ? raw.slice(0, slash) : '';
  const model = slash >= 0 ? raw.slice(slash + 1) : raw;
  const normalizedProvider = provider.replace(/^claude-/, '').replace(/^(cx|oc)$/, '');
  return {
    full: raw,
    provider: normalizedProvider,
    model: model.replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, ''),
  };
}

function toCapabilityProfile(gatewayId, match, matchType, confidence) {
  const limit = match.limit && typeof match.limit === 'object' ? match.limit : {};
  const modalities = match.modalities && typeof match.modalities === 'object' ? match.modalities : {};
  return {
    gatewayId,
    baseModel: match.id,
    name: typeof match.name === 'string' ? match.name : match.id,
    family: typeof match.family === 'string' ? match.family : null,
    capabilities: {
      attachment: match.attachment === true,
      reasoning: match.reasoning === true,
      toolCall: match.tool_call === true,
      structuredOutput: match.structured_output === true,
      temperature: match.temperature !== false,
      inputModalities: Array.isArray(modalities.input) ? modalities.input : ['text'],
      outputModalities: Array.isArray(modalities.output) ? modalities.output : ['text'],
    },
    limits: {
      contextTokens: Number.isFinite(limit.context) ? limit.context : null,
      inputTokens: Number.isFinite(limit.input) ? limit.input : null,
      outputTokens: Number.isFinite(limit.output) ? limit.output : null,
    },
    releaseDate: typeof match.release_date === 'string' ? match.release_date : null,
    lastUpdated: typeof match.last_updated === 'string' ? match.last_updated : null,
    metadata: {
      source: 'models.dev',
      sourceUrl: MODELS_DEV_CATALOG_URL,
      retrievedAt: new Date().toISOString(),
      matchType,
      confidence,
    },
  };
}

/**
 * Enrich gateway-discovered models with Models.dev profiles. Exact IDs win.
 * A normalized/suffix match is accepted only when unique; ambiguous models
 * remain unmatched rather than receiving guessed capabilities.
 */
export function enrichModelsWithCapabilities(candidates, catalog) {
  const entries = flattenModelsDevCatalog(catalog);
  const all = [...entries.values()];
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const gatewayId = candidate.id;
    const exact = entries.get(String(gatewayId).toLowerCase());
    if (exact) {
      return { ...candidate, profile: toCapabilityProfile(gatewayId, exact, 'exact-id', 0.9) };
    }
    const wanted = normalizedModelIdentity(gatewayId);
    const matches = all.filter((entry) => {
      const found = normalizedModelIdentity(entry.id);
      if (!wanted.model || found.model !== wanted.model) return false;
      return !wanted.provider || !found.provider || found.provider === wanted.provider;
    });
    if (matches.length === 1) {
      return { ...candidate, profile: toCapabilityProfile(gatewayId, matches[0], 'unique-normalized-id', 0.7) };
    }
    return { ...candidate, profile: null };
  });
}

function capabilityLabel(profile) {
  if (!profile) return 'metadata unavailable';
  const caps = [];
  if (profile.capabilities.reasoning) caps.push('reasoning');
  if (profile.capabilities.toolCall) caps.push('tools');
  if (profile.capabilities.structuredOutput) caps.push('structured');
  if (profile.capabilities.inputModalities.some((m) => m !== 'text')) caps.push('multimodal');
  if (profile.limits.contextTokens) caps.push(`${Math.round(profile.limits.contextTokens / 1000)}k ctx`);
  return caps.length > 0 ? caps.join(', ') : 'basic text';
}

/**
 * Fetch `/models` from the gateway.
 *
 * @param {{ endpoint: string, authToken?: string|null, timeoutMs?: number, fetchFn?: typeof fetch, retryWithoutAuth?: boolean }} opts
 * @returns {Promise<Array<{ id: string, owned_by?: string, kind?: string }>>}
 */
export async function listModels({ endpoint, authToken = null, timeoutMs = 3000, fetchFn, retryWithoutAuth = false } = {}) {
  if (!endpoint || typeof endpoint !== 'string') {
    throw new Error('endpoint is required');
  }
  const doFetch = fetchFn || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('no fetch implementation available in this runtime');
  }

  const base = endpoint.replace(/\/+$/, '');
  const url = `${base}/models?limit=1000`;

  // First attempt: with auth (if we have a token).
  if (authToken) {
    try {
      const result = await fetchOnce({ doFetch, url, authToken, timeoutMs });
      if (result.kind === 'ok') return normalizeModels(result.body);
      if (result.kind === 'unauthorized' && retryWithoutAuth) {
        // fall through to unauthenticated retry below
      } else if (result.kind === 'unauthorized') {
        throw new Error(`Cannot reach ${url} - check ANTHROPIC_AUTH_TOKEN or BIZAR_MODEL_ROUTER_URL (401 Unauthorized)`);
      } else {
        throw new Error(`gateway returned ${result.status} ${result.statusText}`);
      }
    } catch (err) {
      if (err.message && err.message.includes('check ANTHROPIC_AUTH_TOKEN')) throw err;
      if (err.name === 'AbortError' || String(err.message).includes('aborted')) throw err;
      throw err;
    }
  }

  // Either no auth, or retryWithoutAuth after a 401.
  const result = await fetchOnce({ doFetch, url, authToken: null, timeoutMs });
  if (result.kind === 'ok') return normalizeModels(result.body);
  if (result.kind === 'unauthorized') {
    throw new Error(`Cannot reach ${url} - check ANTHROPIC_AUTH_TOKEN or BIZAR_MODEL_ROUTER_URL (401 Unauthorized)`);
  }
  throw new Error(`gateway returned ${result.status} ${result.statusText}`);
}

async function fetchOnce({ doFetch, url, authToken, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await doFetch(url, { headers, signal: controller.signal });
    if (res.ok) {
      const body = await res.json();
      return { kind: 'ok', body };
    }
    if (res.status === 401 || res.status === 403) return { kind: 'unauthorized', status: res.status };
    return { kind: 'other', status: res.status, statusText: res.statusText };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeModels(body) {
  if (!body || typeof body !== 'object') return [];
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const owned = typeof m.owned_by === 'string' ? m.owned_by : '';
    out.push({ id, owned_by: owned, kind: classifyKind(id) });
  }
  // Stable order — by id — so the picker does not shuffle between runs.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Cheap heuristic: tag a model id with a default tier hint based on its
 * provider prefix and family name. The user can override after picking.
 *
 * IMPORTANT: checks run from most-specific to least-specific so that
 * `claude-haiku-4-5` matches `high` (haiku-4 family) and not `budget` (bare haiku).
 */
export function defaultTierHint(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return 'default';
  // Premium first — strongest model family.
  if (/(qwen3\.8|gpt-5|opus|o3-pro|o4-mini|sonnet-4)/.test(id)) return 'premium';
  // High — newer mid-tier (haiku-4 is stronger than haiku-3-5).
  if (/(haiku-4|sonnet-3-7|mini-high|m3-high|grok-3)/.test(id)) return 'high';
  // Default — mainline sonnet / gpt-4 / m3.
  if (/(sonnet|gpt-4|m3(-|$)|(^|[^a-z])default($|[^a-z]))/.test(id)) return 'default';
  // Budget — small / fast variants. Match after the default family so that
  // bare `haiku` (no version suffix) falls into budget, but `haiku-4-x` is
  // caught by the high check above.
  if (/(nano|mini[-/]|flash|lite|tiny|haiku($|[-_]\d))/.test(id)) return 'budget';
  return 'mid';
}

function classifyKind(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.startsWith('claude-')) return 'claude';
  if (id.startsWith('cx/')) return 'cx';
  if (id.startsWith('oc/')) return 'oc';
  if (id.startsWith('claude-minimax/')) return 'claude-minimax';
  if (id.startsWith('claude-qwen/')) return 'claude-qwen';
  if (id.startsWith('anthropic/')) return 'anthropic';
  return 'other';
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Read the current router file. Returns the parsed JSON or an empty default
 * shell when the file is missing or unreadable.
 */
export function loadRouter(routerPath) {
  if (!existsSync(routerPath)) return { __missing: true };
  try {
    return JSON.parse(readFileSync(routerPath, 'utf8'));
  } catch {
    return { __invalid: true };
  }
}

/**
 * Write `models` (and optional `tierHints`) into `router.userSelected`,
 * preserving every other field. Atomic replace via temp-file + rename.
 *
 * @param {{ routerPath: string, models: string[], tierHints?: Record<string,string>, profiles?: Record<string,object>, source?: string }} opts
 * @returns {{ models: string[], lastUpdated: string, source: string, tierHints: Record<string,string>, profiles: Record<string,object> }}
 */
export function applyModels({ routerPath, models, tierHints = {}, profiles = {}, source = 'live-pick' }) {
  const list = Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.trim()) : [];
  const hints = { ...(tierHints || {}) };
  for (const id of list) if (!hints[id]) hints[id] = defaultTierHint(id);
  const block = {
    models: list,
    lastUpdated: new Date().toISOString(),
    source,
    tierHints: hints,
    profiles: Object.fromEntries(list.filter((id) => profiles[id]).map((id) => [id, profiles[id]])),
  };
  const router = existsSync(routerPath)
    ? JSON.parse(readFileSync(routerPath, 'utf8'))
    : {};
  router.userSelected = block;
  if (!router.version) router.version = '13.0.0';
  if (!router.endpoint) router.endpoint = 'http://localhost:20128/v1';
  writeAtomic(routerPath, JSON.stringify(router, null, 2) + '\n');
  return block;
}

function writeAtomic(path, body) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, path);
}

// ── F-190 / IMP-017 refresh + operator-override preservation ────────────────

/**
 * Decide whether a stored profile needs to be re-fetched. Profiles
 * carry a `provenance.refreshRequiredAfter` timestamp; when the supplied
 * `now` is past it the entry is stale. Operator-only profiles (source
 * 'operator' / 'alias-map' / 'manual') never need a refresh — their
 * `refreshRequiredAfter` is set to the far future by the picker.
 */
function profileNeedsRefresh(profile, now = new Date()) {
  if (!profile || typeof profile !== 'object') return false;
  const prov = profile.provenance;
  if (!prov || typeof prov !== 'object') return false;
  const source = prov.source;
  if (source === 'operator' || source === 'alias-map') return false;
  const required = Date.parse(prov.refreshRequiredAfter);
  if (!Number.isFinite(required)) return false;
  return now.getTime() >= required;
}

/**
 * Apply the refresh. Re-fetches only stale profiles; preserves
 * operator-set fields on every entry. The summary is the JSON shape
 * `bizar models --refresh` prints in non-interactive mode.
 *
 * @param {{ routerPath: string, candidates: Array<{ id: string, profile?: object }>, catalog: object, aliasMap?: object, now?: Date }} opts
 * @returns {{ refreshed: string[], preservedOperator: string[], skippedFresh: string[], error?: string }}
 */
export function applyRefresh({
  routerPath,
  candidates,
  catalog,
  aliasMap = {},
  now = new Date(),
} = {}) {
  if (!routerPath || typeof routerPath !== 'string') throw new Error('routerPath is required');
  if (!Array.isArray(candidates)) throw new Error('candidates is required (array)');
  if (!catalog || typeof catalog !== 'object') throw new Error('catalog is required');

  const enriched = enrichModelsWithCapabilities(candidates, catalog);
  const enrichedById = new Map(enriched.map((entry) => [entry.id, entry]));

  const router = existsSync(routerPath)
    ? safeParseRouter(routerPath)
    : {};
  const userSelected = router.userSelected || { models: [], tierHints: {}, profiles: {} };
  const existingProfiles = userSelected.profiles && typeof userSelected.profiles === 'object'
    ? userSelected.profiles
    : {};
  const existingModels = Array.isArray(userSelected.models) ? userSelected.models : [];
  const existingTierHints = userSelected.tierHints && typeof userSelected.tierHints === 'object'
    ? userSelected.tierHints
    : {};

  const refreshed = [];
  const preservedOperator = [];
  const skippedFresh = [];
  const newProfiles = { ...existingProfiles };

  for (const id of existingModels) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const trimmed = id.trim();
    const existing = existingProfiles[trimmed];
    const enrichedEntry = enrichedById.get(trimmed);

    // Honour explicit alias mapping. The alias map's `modelId` resolves
    // to a catalogue ID; when set, we stamp provenance with the alias
    // match type and override the baseModel.
    const aliasEntry = aliasMap && aliasMap[trimmed];
    if (aliasEntry && enrichedEntry?.profile) {
      enrichedEntry.profile = {
        ...enrichedEntry.profile,
        baseModel: aliasEntry.modelId,
        metadata: {
          ...(enrichedEntry.profile.metadata || {}),
          matchType: aliasEntry.matchType || 'alias',
          confidence: Number.isFinite(aliasEntry.confidence) ? aliasEntry.confidence : 1,
        },
      };
    }

    if (!enrichedEntry?.profile) {
      skippedFresh.push(trimmed);
      continue;
    }

    if (existing && profileNeedsRefresh(existing, now)) {
      const refreshedProfile = mergePreservingOperator(existing, enrichedEntry.profile, now);
      newProfiles[trimmed] = refreshedProfile;
      refreshed.push(trimmed);
      continue;
    }

    if (existing) {
      // Operator-set fields survive. If the existing profile carries
      // operator overrides, the cached entry wins for those fields.
      newProfiles[trimmed] = mergePreservingOperator(existing, enrichedEntry.profile, now);
      if (hasOperatorOverrides(existing)) preservedOperator.push(trimmed);
      else skippedFresh.push(trimmed);
      continue;
    }

    // No existing entry — write a fresh profile with provenance.
    newProfiles[trimmed] = stampProvenance(enrichedEntry.profile, now);
    refreshed.push(trimmed);
  }

  router.userSelected = {
    ...userSelected,
    models: existingModels,
    tierHints: existingTierHints,
    profiles: newProfiles,
    lastUpdated: now.toISOString(),
    source: 'refresh',
  };
  if (!router.version) router.version = '13.0.0';
  if (!router.endpoint) router.endpoint = 'http://localhost:20128/v1';
  writeAtomic(routerPath, JSON.stringify(router, null, 2) + '\n');

  return { refreshed, preservedOperator, skippedFresh };
}

function safeParseRouter(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function hasOperatorOverrides(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return profile.operatorOverrides && typeof profile.operatorOverrides === 'object'
    && Object.keys(profile.operatorOverrides).length > 0;
}

/**
 * Layer operator-set fields on top of a freshly-fetched profile. The
 * refresh must NEVER overwrite operator-set values — operator
 * corrections (re-enabled tool use, widened context, manual tier
 * bumps) survive catalogue refreshes verbatim.
 *
 * Strategy:
 *   - Start from the freshly-fetched profile.
 *   - For every field set in the existing profile's `operatorOverrides`,
 *     take the operator value.
 *   - For every other field, take the fresh value.
 *   - Provenance is stamped with `now` when the entry was actually
 *     refreshed; when only operator overrides change, provenance is
 *     preserved (the entry did not actually refresh).
 */
function mergePreservingOperator(existing, fresh, now) {
  const overrides = existing.operatorOverrides && typeof existing.operatorOverrides === 'object'
    ? existing.operatorOverrides
    : {};
  const protocolFresh = fresh.protocol || existing.protocol || {};
  const protocolMerged = {
    ...protocolFresh,
    ...(overrides.protocol || {}),
    contextTokens: pickNumber(overrides.protocol?.contextTokens, protocolFresh.contextTokens) ?? protocolFresh.contextTokens,
    maxOutputTokens: pickNumber(overrides.protocol?.maxOutputTokens, protocolFresh.maxOutputTokens) ?? protocolFresh.maxOutputTokens,
  };
  const measuredFresh = fresh.measured || existing.measured || {};
  const measuredMerged = { ...measuredFresh, ...(overrides.measured || {}) };

  const merged = {
    ...fresh,
    protocol: protocolMerged,
    measured: measuredMerged,
    operatorOverrides: Object.keys(overrides).length > 0 ? overrides : existing.operatorOverrides,
  };

  // Stamp provenance only when the entry actually needs a refresh —
  // fresh entries keep their existing provenance so a `--refresh`
  // call leaves up-to-date entries untouched.
  if (profileNeedsRefresh(existing, now)) {
    merged.provenance = stampProvenance(fresh, now).provenance;
  } else {
    merged.provenance = existing.provenance;
  }
  return merged;
}

function pickNumber(over, base) {
  if (typeof over === 'number' && Number.isFinite(over)) return over;
  return base;
}

function stampProvenance(profile, now) {
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const refreshRequiredAfter = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
  const prov = profile.metadata || profile.provenance || {};
  return {
    ...profile,
    metadata: {
      ...(profile.metadata || {}),
      retrievedAt,
      matchType: prov.matchType || 'exact-id',
      confidence: Number.isFinite(prov.confidence) ? prov.confidence : 0.9,
    },
    provenance: {
      source: prov.source || 'models.dev',
      retrievedAt,
      expiresAt,
      refreshRequiredAfter,
      matchType: prov.matchType || 'exact-id',
      confidence: Number.isFinite(prov.confidence) ? prov.confidence : 0.9,
    },
  };
}

// ── Interactive picker ───────────────────────────────────────────────────────

/**
 * Read the user-selected block off the router. Returns the models array
 * (possibly empty) and the tier hints.
 */
export function currentSelection(router) {
  if (!router || typeof router !== 'object') return { models: [], tierHints: {} };
  const us = router.userSelected;
  if (!us || typeof us !== 'object') return { models: [], tierHints: {} };
  const models = Array.isArray(us.models) ? us.models.filter((m) => typeof m === 'string') : [];
  const tierHints = us.tierHints && typeof us.tierHints === 'object' ? us.tierHints : {};
  return { models, tierHints };
}

/**
 * Shape of each ranked entry returned by `bizar models explain`.
 * Mirrors `packages/sdk/src/router/agent-model-registry.ts:RankedUserSelectedEntry`.
 * Adds the IMP-017 / F-190 `reasons` (protocol-floor rejects in the
 * new format), `measured` (quality breakdown), and `provenance`
 * (source / retrieval / expiry) when the discriminated profile is
 * available.
 */
function explainRankedEntry(entry) {
  const out = {
    id: entry.id,
    tier: entry.tier,
    eligible: entry.eligible,
    ineligibleReasons: Array.isArray(entry.ineligibleReasons) ? [...entry.ineligibleReasons] : [],
    capabilityScore: entry.capabilityScore,
    hasProfile: entry.hasProfile,
  };
  if (Array.isArray(entry.reasons)) out.reasons = [...entry.reasons];
  if (entry.measured && typeof entry.measured === 'object') out.measured = entry.measured;
  if (entry.provenance && typeof entry.provenance === 'object') out.provenance = entry.provenance;
  return out;
}

/**
 * Run `bizar models explain <role>`. Non-interactive: reads the persisted
 * `userSelected` block off the router file, ranks it via the JS mirror of
 * the SDK's `rankUserSelectedForRole`, and prints one row per candidate
 * showing why it would or would not be selected.
 *
 * Pure function over `routerPath` — no stdout I/O. The `run` entry point
 * owns the output and exit codes.
 *
 * The mirror lives at `packages/sdk/dist/router/failover-mirror.mjs` and is
 * byte-identical to the SDK's algorithm; if it diverges, the divergence
 * test in `cli/__tests__/models-picker.test.mjs` fails.
 *
 * @param {{ routerPath: string, role: string, requirements?: object }} opts
 * @returns {{ ranked: object[] }}
 */
export function explainSelection({ routerPath, role, requirements = {} } = {}) {
  if (!routerPath || typeof routerPath !== 'string') throw new Error('routerPath is required');
  if (!role || typeof role !== 'string') throw new Error('role is required (e.g. "todd", "mike")');
  let registry;
  try {
    const router = loadRouter(routerPath);
    if (!router || router.__missing || router.__invalid) {
      registry = { userSelected: undefined };
    } else {
      // The mirror only needs `registry.userSelected`. Pass through the
      // full router so future schema additions (e.g., gateway hint
      // resolution) flow without a wiring change.
      registry = router;
    }
  } catch {
    registry = { userSelected: undefined };
  }
  if (typeof rankUserSelectedForRoleMirror !== 'function') {
    const err = new Error('bizar models explain requires packages/sdk/dist/router/failover-mirror.mjs to be loadable');
    err.code = 'SDK_UNAVAILABLE';
    throw err;
  }
  const { ranked } = rankUserSelectedForRoleMirror(registry, role, requirements);
  return { ranked: ranked.map(explainRankedEntry) };
}

/**
 * Interactive multi-select picker. Pure function over streams — testable.
 *
 * Branching: when stdin is a TTY with raw-mode support, the picker drives a
 * keypress-driven checklist (arrow keys / j-k / space / a / n / enter / q /
 * esc / ?).  When stdin is not a TTY (pipes, CI, tests) the picker falls
 * through to a line-mode loop that accepts a space-separated index list,
 * `all`, `none`, `toggle <i>`, an empty line (confirm), or `q` (quit). Both
 * branches return the chosen IDs in the user's most-recent selection order,
 * so external callers and existing tests see a single `Promise<string[]>`.
 *
 * @param {{ candidates: Array<{ id: string }>, current?: string[], stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WriteStream, prompt?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function pickModels({ candidates, current = [], stdin, stdout, prompt = 'Select models' } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('pickModels requires at least one candidate');
  }
  const out$ = stdout || (typeof process !== 'undefined' ? process.stdout : null);
  const in$ = stdin || (typeof process !== 'undefined' ? process.stdin : null);
  if (!out$ || !in$) throw new Error('pickModels requires stdin/stdout or a process');

  const ordered = candidates.map((c) => c.id);
  const selected = new Set(current);
  let lastOrder = [...current];

  const useTty = in$.isTTY === true && typeof in$.setRawMode === 'function';
  if (!useTty) {
    return pickModelsLineMode({ ordered, candidates, selected, lastOrder, stdin: in$, stdout: out$, prompt });
  }

  // Try to enable raw mode. If that fails (rare — redirected TTY, broken
  // pseudo-terminal), fall back to the line-mode picker so the user never
  // sees a silent no-op.
  let rawOk = true;
  try {
    in$.setRawMode(true);
  } catch {
    rawOk = false;
  }
  if (!rawOk) {
    return pickModelsLineMode({ ordered, candidates, selected, lastOrder, stdin: in$, stdout: out$, prompt });
  }

  try {
    return await pickModelsInteractive({ ordered, candidates, selected, lastOrder, stdin: in$, stdout: out$, prompt });
  } finally {
    try { in$.setRawMode(false); } catch { /* swallow — terminal may already be gone */ }
  }
}

async function pickModelsLineMode({ ordered, candidates, selected, lastOrder, stdin, stdout, prompt }) {
  const lines = makeLineReader(stdin);
  for (;;) {
    renderPicker(stdout, ordered, selected, prompt, candidates);
    const line = await readPrompt(lines, stdout, stdin.isTTY === true, '> ');
    if (line === null) break; // EOF on non-TTY
    const cmd = String(line || '').trim();
    if (cmd === '') break;
    if (cmd === 'all') {
      for (const id of ordered) selected.add(id);
      lastOrder = [...ordered];
      continue;
    }
    if (cmd === 'none') {
      selected.clear();
      lastOrder = [];
      continue;
    }
    if (cmd === 'q' || cmd === 'quit' || cmd === ':wq') break;
    if (cmd.startsWith('toggle ')) {
      const idx = Number(cmd.slice('toggle '.length).trim());
      if (!Number.isInteger(idx) || idx < 1 || idx > ordered.length) {
        stdout.write(chalk.red(`  x index out of range\n`));
        continue;
      }
      const id = ordered[idx - 1];
      if (selected.has(id)) {
        selected.delete(id);
        lastOrder = lastOrder.filter((x) => x !== id);
      } else {
        selected.add(id);
        lastOrder.push(id);
      }
      continue;
    }
    const indices = cmd.split(/\s+/).map((s) => Number(s)).filter((n) => Number.isInteger(n));
    let changed = false;
    for (const n of indices) {
      if (n < 1 || n > ordered.length) continue;
      const id = ordered[n - 1];
      if (selected.has(id)) {
        selected.delete(id);
        lastOrder = lastOrder.filter((x) => x !== id);
      } else {
        selected.add(id);
        lastOrder.push(id);
      }
      changed = true;
    }
    if (!changed) stdout.write(chalk.yellow(`  ! unrecognised input - try 'all', 'none', 'toggle <i>', or '1 3 5'\n`));
  }
  const seen = new Set();
  return lastOrder.filter((id) => {
    if (!selected.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const VIEWPORT_SIZE = 20;
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ERASE_SCREEN = '\x1b[2J\x1b[H';

function cursorUp(n) {
  return `\x1b[${n}A`;
}

function fitRow({ i, id, profile, width, isCursor, isSelected, columns }) {
  const mark = isSelected ? chalk.green('[x]') : '[ ]';
  const idx = String(i + 1).padStart(width, ' ');
  const label = capabilityLabel(profile);
  const budget = Math.max(40, (columns ?? 80) - 32);
  const idText = id.length > budget ? `${id.slice(0, Math.max(1, budget - 1))}…` : id;
  const cursorMark = isCursor ? chalk.inverse(' ▌ ') : '   ';
  return `  ${cursorMark}${mark} ${chalk.dim(`${idx}.`)} ${idText}${chalk.dim(`  [${label}]`)}`;
}

async function pickModelsInteractive({ ordered, candidates, selected, lastOrder, stdin, stdout, prompt }) {
  let cursor = 0;
  let scrollTop = 0;
  let lastRenderHeight = 0;
  let showHelp = false;

  readline.emitKeypressEvents(stdin);
  if (typeof stdin.resume === 'function') stdin.resume();
  stdout.write(`${ERASE_SCREEN}${HIDE_CURSOR}`);

  const exitState = await new Promise((resolve) => {
    const onKey = (str, key) => {
      if (!key) return;
      // Resolve confirmation
      if (key.name === 'return' || str === 'q' || key.name === 'escape') {
        return finish();
      }
      if (key.ctrl && key.name === 'c') {
        // SIGINT: discard selection and break out, but do not bubble.
        selected.clear();
        lastOrder.length = 0;
        return finish();
      }
      if (key.name === 'up' || str === 'k') {
        cursor = (cursor - 1 + ordered.length) % ordered.length;
      } else if (key.name === 'down' || str === 'j') {
        cursor = (cursor + 1) % ordered.length;
      } else if (key.name === 'space' || str === 'x') {
        const id = ordered[cursor];
        if (selected.has(id)) {
          selected.delete(id);
          lastOrder = lastOrder.filter((x) => x !== id);
        } else {
          selected.add(id);
          lastOrder.push(id);
        }
      } else if (str === 'a') {
        for (const id of ordered) selected.add(id);
        lastOrder = [...ordered];
      } else if (str === 'n') {
        selected.clear();
        lastOrder = [];
      } else if (str === '?') {
        showHelp = !showHelp;
      } else {
        return;
      }
      adjustScroll();
      render();
    };

    const finish = () => {
      stdin.removeListener('keypress', onKey);
      if (typeof stdin.pause === 'function') stdin.pause();
      resolve();
    };

    stdin.on('keypress', onKey);
    render();
  });

  stdout.write(SHOW_CURSOR);

  const seen = new Set();
  return lastOrder.filter((id) => {
    if (!selected.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  function adjustScroll() {
    if (ordered.length <= VIEWPORT_SIZE) {
      scrollTop = 0;
      return;
    }
    if (cursor < scrollTop) scrollTop = cursor;
    else if (cursor >= scrollTop + VIEWPORT_SIZE) scrollTop = cursor - VIEWPORT_SIZE + 1;
    if (scrollTop < 0) scrollTop = 0;
    if (scrollTop > Math.max(0, ordered.length - VIEWPORT_SIZE)) {
      scrollTop = Math.max(0, ordered.length - VIEWPORT_SIZE);
    }
  }

  function render() {
    const width = String(ordered.length).length;
    const columns = typeof stdout.columns === 'number' ? stdout.columns : 80;
    const lines = [];
    lines.push(`\x1b[K${chalk.bold(`-- ${prompt} --`)}`);
    const start = scrollTop;
    const end = Math.min(ordered.length, start + VIEWPORT_SIZE);
    const above = start;
    const below = ordered.length - end;
    if (above > 0) lines.push(`\x1b[K${chalk.dim(`  ⋮ ${above} more above`)}`);
    for (let i = start; i < end; i++) {
      const profile = candidates.find((candidate) => candidate.id === ordered[i])?.profile;
      const row = fitRow({
        i,
        id: ordered[i],
        profile,
        width,
        isCursor: i === cursor,
        isSelected: selected.has(ordered[i]),
        columns,
      });
      lines.push(`\x1b[K${row}`);
    }
    if (below > 0) lines.push(`\x1b[K${chalk.dim(`  ⋮ ${below} more below`)}`);
    lines.push(`\x1b[K${chalk.dim(`  ${selected.size}/${ordered.length} selected. ↑/↓ move · space toggle · a all · n none · enter confirm.`)}`);
    if (showHelp) lines.push(`\x1b[K${chalk.dim(`  Extra: j/k · x toggle · q/esc confirm · ? help.`)}`);
    lines.push(`\x1b[K`);

    if (lastRenderHeight > 0) {
      stdout.write(cursorUp(lastRenderHeight));
    }
    stdout.write(lines.join('\n'));
    lastRenderHeight = lines.length;
  }
}

/**
 * Build a small async iterator over `stdin` lines.
 * Returns null from `next()` when the stream ends.
 */
function makeLineReader(stdin) {
  const queue = [];
  let pending = null;
  let ended = false;
  let buffer = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (pending) {
        const resolveP = pending;
        pending = null;
        resolveP({ value: line, done: false });
      } else {
        queue.push(line);
      }
    }
  });
  stdin.on('end', () => {
    ended = true;
    if (buffer.length > 0) {
      const trailing = buffer;
      buffer = '';
      if (pending) {
        const resolveP = pending;
        pending = null;
        resolveP({ value: trailing, done: false });
      } else {
        queue.push(trailing);
      }
    }
    if (pending) {
      const resolveP = pending;
      pending = null;
      resolveP({ value: undefined, done: true });
    }
  });
  stdin.on('error', () => {
    ended = true;
    if (pending) {
      const resolveP = pending;
      pending = null;
      resolveP({ value: undefined, done: true });
    }
  });
  return {
    next() {
      if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolveP) => { pending = resolveP; });
    },
  };
}

async function readPrompt(lineReader, out$, isTTY, prefix) {
  if (isTTY) {
    out$.write(prefix);
  }
  const r = await lineReader.next();
  if (r.done) return null;
  return r.value;
}

function renderPicker(out, ordered, selected, prompt, candidates = []) {
  out.write('\n' + chalk.bold(`-- ${prompt} --`) + '\n');
  const width = String(ordered.length).length;
  for (let i = 0; i < ordered.length; i++) {
    const id = ordered[i];
    const mark = selected.has(id) ? chalk.green('[x]') : '[ ]';
    const idx = String(i + 1).padStart(width, ' ');
    const profile = candidates.find((candidate) => candidate.id === id)?.profile;
    out.write(`  ${mark} ${chalk.dim(idx + '.')} ${id}${chalk.dim(`  [${capabilityLabel(profile)}]`)}\n`);
  }
  out.write(chalk.dim(`\n  ${selected.size}/${ordered.length} selected. Type numbers to toggle, 'all', 'none', or Enter to confirm.\n`));
}

function askLine(rl, prefix) {
  return new Promise((resolveP) => {
    rl.question(prefix, (answer) => resolveP(answer));
  });
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function showHelp() {
  const help = `
  bizar models - User-controlled model picker

  Usage:
    bizar models                    Interactive picker (TTY: arrow keys / space / enter; pipe: line-mode)
    bizar models --list             Print candidate IDs, one per line
    bizar models --set a,b,c        Persist the comma-separated IDs to userSelected
    bizar models --clear            Remove userSelected; orchestrator falls back to session-only
    bizar models --refresh         Re-fetch Models.dev metadata for stale profiles; preserve operator overrides
    bizar models explain <role>     Print ranked eligibility for a role (no gateway)
    bizar models --json             Machine-readable output for any subcommand
    bizar models --help             This help

  The orchestrator (@mike) dispatches subagents using ONLY the models in
  userSelected. If userSelected is empty, every dispatch inherits the
  active session model.

  Endpoint resolution order: $BIZAR_MODEL_ROUTER_URL / $ANTHROPIC_BASE_URL
    -> ~/.claude/settings.json#env.BIZAR_MODEL_ROUTER_URL
    -> model-router.json#endpoint
    -> http://localhost:20128/v1

  Auth: $ANTHROPIC_AUTH_TOKEN -> settings.json#env.ANTHROPIC_AUTH_TOKEN.\n\n  Discovered models are enriched from https://models.dev/models.json.\n  Metadata lookup is best-effort and never hides gateway-reported models.
`;
  console.log(help);
}

function parseSet(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function run(name, args, isHelpRequest) {
  // `bizar model` remains a deprecated alias; `bizar models` is the canonical surface.
  if (name !== 'models' && name !== 'model') return false;
  if (isHelpRequest || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return true;
  }

  const wantJson = args.includes('--json');
  const wantList = args.includes('--list');
  const wantClear = args.includes('--clear');
  const wantRefresh = args.includes('--refresh');
  const setFlag = args.find((a) => a.startsWith('--set='));
  const setValue = setFlag ? setFlag.slice('--set='.length) : null;

  // `bizar model` without --list/--clear/--set and without --models is
  // ambiguous: the deprecated surface also takes --list. Accept either.
  const isDeprecatedAlias = name === 'model';

  const routerPath = resolveRouterPath(process.cwd());
  const { endpoint, authToken, source: endpointSource } = resolveEndpoint({});

  // F-185: `bizar models explain <role>` — non-interactive ranking.
  // Handled BEFORE the picker fetch path so it never touches the gateway.
  const explainIdx = args.findIndex((a) => a === 'explain');
  if (explainIdx !== -1) {
    const roleArg = args[explainIdx + 1];
    if (!roleArg || roleArg.startsWith('-')) {
      console.error(chalk.red('  x bizar models explain requires a role argument, e.g. `bizar models explain todd`'));
      process.exit(2);
    }
    let verdict;
    try {
      verdict = explainSelection({ routerPath, role: roleArg });
    } catch (err) {
      console.error(chalk.red(`  x ${err.message}`));
      process.exit(1);
    }
    if (wantJson) {
      process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
    } else {
      if (verdict.ranked.length === 0) {
        console.log(chalk.yellow(`  ! userSelected is empty for role ${roleArg}; orchestrator will fall back to session-only.`));
      } else {
        console.log(chalk.green(`  Ranked user-selected candidates for ${roleArg}:`));
        const pad = Math.max(8, ...verdict.ranked.map((entry) => entry.id.length));
        for (const entry of verdict.ranked) {
          const status = entry.eligible ? chalk.green('eligible  ') : chalk.yellow('ineligible');
          const profile = entry.hasProfile ? chalk.dim(' (profiled)') : chalk.dim(' (no profile)');
          console.log(`    ${entry.id.padEnd(pad)}  ${entry.tier.padEnd(10)}  score=${entry.capabilityScore.toFixed(3)}  ${status}${profile}`);
          for (const reason of entry.ineligibleReasons) console.log(chalk.dim(`        - ${reason}`));
        }
      }
    }
    return true;
  }

  // F-190 / IMP-017 `bizar models --refresh` — re-fetch stale
  // profiles from Models.dev; preserve operator overrides. The catalog
  // fetch is best-effort — a network failure exits non-zero without
  // mutating the router file.
  if (wantRefresh) {
    let router;
    try {
      router = existsSync(routerPath)
        ? JSON.parse(readFileSync(routerPath, 'utf8'))
        : {};
    } catch (parseErr) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error(chalk.red(`  x cannot read ${routerPath}: ${message}`));
      process.exit(1);
    }
    const userSelected = router && typeof router === 'object' ? router.userSelected : null;
    const selectedModels = userSelected && Array.isArray(userSelected.models)
      ? userSelected.models.filter((id) => typeof id === 'string' && id.trim())
      : [];
    if (selectedModels.length === 0) {
      if (wantJson) {
        process.stdout.write(JSON.stringify({ refreshed: [], preservedOperator: [], skippedFresh: [], note: 'no userSelected models' }, null, 2) + '\n');
      } else {
        console.log(chalk.yellow('  ! userSelected is empty; nothing to refresh'));
      }
      return true;
    }
    let catalog;
    try {
      catalog = await fetchModelsDevCatalog({});
    } catch (fetchErr) {
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(chalk.red(`  x refresh failed: ${message}`));
      if (wantJson) {
        process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
      }
      process.exit(1);
    }
    const aliasMap = loadAliasMap();
    const candidates = selectedModels.map((id) => ({ id }));
    const summary = applyRefresh({ routerPath, candidates, catalog, aliasMap });
    if (wantJson) {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
      console.log(chalk.green(`  v refresh complete:`));
      console.log(chalk.dim(`    refreshed:         ${summary.refreshed.length}`));
      for (const id of summary.refreshed) console.log(chalk.dim(`        - ${id}`));
      console.log(chalk.dim(`    preserved operator: ${summary.preservedOperator.length}`));
      for (const id of summary.preservedOperator) console.log(chalk.dim(`        - ${id}`));
      console.log(chalk.dim(`    skipped (fresh):    ${summary.skippedFresh.length}`));
      for (const id of summary.skippedFresh) console.log(chalk.dim(`        - ${id}`));
    }
    return true;
  }

  if (wantClear) {
    const before = currentSelection(loadRouter(routerPath));
    const router = existsSync(routerPath)
      ? JSON.parse(readFileSync(routerPath, 'utf8'))
      : {};
    delete router.userSelected;
    writeAtomic(routerPath, JSON.stringify(router, null, 2) + '\n');
    if (wantJson) {
      process.stdout.write(JSON.stringify({ cleared: true, previous: before.models }, null, 2) + '\n');
    } else {
      console.log(chalk.green('  v userSelected cleared'));
      console.log(chalk.dim(`    previous: ${before.models.length} model(s)`));
    }
    return true;
  }

  if (setValue !== null) {
    const ids = parseSet(setValue);
    if (ids.length === 0) {
      console.error(chalk.red('  x --set requires at least one model id'));
      process.exit(2);
    }
    const block = applyModels({ routerPath, models: ids, source: 'cli-set' });
    if (wantJson) {
      process.stdout.write(JSON.stringify({ applied: block }, null, 2) + '\n');
    } else {
      console.log(chalk.green(`  v ${block.models.length} model(s) saved to userSelected`));
      for (const id of block.models) {
        const tier = block.tierHints[id] || defaultTierHint(id);
        console.log(chalk.dim(`    ${id}  (${tier})`));
      }
    }
    return true;
  }

  // Deprecated `bizar model` without flags: print candidates (preserve the
  // legacy "list" default). The orchestrator picker lives on `bizar models`.
  // We do not short-circuit here — the code below falls into the
  // `wantList || isDeprecatedAlias` branch and prints candidate IDs.

  let candidates;
  let modelsDev = { status: 'not-attempted', matched: 0, total: 0 };
  try {
    // The deprecated `bizar model` alias preserves the legacy
    // "retry-without-auth on 401" behavior so existing scripts keep working.
    // The new `bizar models` surface fails fast on 401 with an actionable
    // error message (the user explicitly picks models — no silent retry).
    candidates = await listModels({ endpoint, authToken, retryWithoutAuth: isDeprecatedAlias });
    try {
      const catalogue = await fetchModelsDevCatalog({});
      candidates = enrichModelsWithCapabilities(candidates, catalogue);
      modelsDev = {
        status: 'ok',
        matched: candidates.filter((candidate) => candidate.profile).length,
        total: candidates.length,
        source: MODELS_DEV_CATALOG_URL,
      };
    } catch (metadataError) {
      modelsDev = {
        status: 'unavailable',
        matched: 0,
        total: candidates.length,
        source: MODELS_DEV_CATALOG_URL,
        error: metadataError instanceof Error ? metadataError.message : String(metadataError),
      };
    }
  } catch (err) {
    if (err.name === 'AbortError' || String(err.message).includes('aborted')) {
      console.error(chalk.red(`  x Request timed out after 3000ms - ${endpoint}/models`));
    } else {
      console.error(chalk.red(`  x ${err.message}`));
    }
    process.exit(1);
  }

  if (candidates.length === 0) {
    if (wantJson) {
      process.stdout.write(JSON.stringify({ endpoint, endpointSource, candidates: [], total: 0, modelsDev }, null, 2) + '\n');
    } else {
      console.error(chalk.red(`  x No models reported by ${endpoint}`));
    }
    return true;
  }

  if (wantList || isDeprecatedAlias) {
    if (wantJson) {
      process.stdout.write(JSON.stringify({ endpoint, endpointSource, candidates, total: candidates.length, modelsDev }, null, 2) + '\n');
    } else {
      for (const c of candidates) process.stdout.write(c.id + '\n');
    }
    return true;
  }

  // Interactive picker — only reached when explicitly invoked as `bizar models`
  // with NO --list / --clear / --set flags. We avoid running the picker when
  // stdin is not a TTY (e.g. CI / npm test), because readline.question would block.
  if (!process.stdin.isTTY) {
    if (wantJson) {
      process.stdout.write(JSON.stringify({
        endpoint,
        endpointSource,
        candidates,
        total: candidates.length,
        picker: 'requires-tty',
        modelsDev,
      }, null, 2) + '\n');
    } else {
      console.error(chalk.yellow('  ! Non-interactive shell detected. Re-run without a TTY and use --list / --set instead.'));
      for (const c of candidates) process.stdout.write(c.id + '\n');
    }
    return true;
  }

  const router = loadRouter(routerPath);
  const { models: current } = currentSelection(router);
  const picked = await pickModels({ candidates, current });
  if (picked.length === 0) {
    const block = applyModels({ routerPath, models: [], source: 'live-pick' });
    if (wantJson) {
      process.stdout.write(JSON.stringify({ applied: block, endpoint, endpointSource }, null, 2) + '\n');
    } else {
      console.log(chalk.yellow('  ! No models selected - userSelected is now empty; orchestrator will fall back to session-only.'));
    }
    return true;
  }
  const tierHints = {};
  const profiles = {};
  for (const id of picked) {
    tierHints[id] = defaultTierHint(id);
    const profile = candidates.find((candidate) => candidate.id === id)?.profile;
    if (profile) profiles[id] = profile;
  }
  const block = applyModels({ routerPath, models: picked, tierHints, profiles, source: 'live-pick' });
  if (wantJson) {
    process.stdout.write(JSON.stringify({ applied: block, endpoint, endpointSource }, null, 2) + '\n');
  } else {
    console.log(chalk.green(`\n  v Saved ${block.models.length} model(s) to ${routerPath}:`));
    console.log(chalk.dim(`    Models.dev profiles: ${Object.keys(block.profiles || {}).length}/${block.models.length}`));
    for (const id of block.models) {
      const tier = block.tierHints[id] || defaultTierHint(id);
      console.log(chalk.dim(`    ${id}  (${tier})`));
    }
  }
  return true;
}