/**
 * cli/commands/models.mjs
 *
 * `bizar models` — user-controlled model picker.
 *
 *   bizar models                # interactive: list + multi-select picker
 *   bizar models --list         # non-interactive: list candidate IDs (one per line)
 *   bizar models --set id1,id2  # non-interactive: set the user-selected list directly
 *   bizar models --clear        # clear userSelected and apply a configured fallback
 *   bizar models --json         # machine-readable output for any subcommand
 *
 * The picked IDs persist under the global Bizar model router's `userSelected` block.
 * The orchestrator (Mike) dispatches subagents using ONLY these user-selected
 * models. The `bizar_model_list` MCP tool also surfaces only these IDs.
 *
 * The picker is the discovery surface — live discovery from the gateway is
 * optional and only used to populate the candidate pool. It is not used to
 * reject user-selected IDs.
 */
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

import { resolveClaudeConfigDir, resolveGlobalModelRouter, resolveBizarHome } from '../config-paths.mjs';

import {
  rankUserSelectedForRole as rankUserSelectedForRoleMirror,
} from '../../packages/sdk/dist/router/failover-mirror.mjs';

// ── Endpoint resolution ──────────────────────────────────────────────────────

/**
 * Read env vars, then fall back to ~/.claude/settings.json, then to the
 * defaults baked into model-router.json#endpoint.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, settingsJsonPath?: string, routerPath?: string }} opts
 * @returns {{ endpoint: string, authToken: string|null, source: string }}
 */
export function resolveEndpoint(opts = {}) {
  const env = opts.env || process.env;
  const fromEnvUrl = env.BIZAR_MODEL_ROUTER_URL || env.ANTHROPIC_BASE_URL || null;
  const fromEnvToken = env.ANTHROPIC_AUTH_TOKEN || null;

  let settings = null;
  const settingsPath = opts.settingsJsonPath || join(resolveClaudeConfigDir({ env, cwd: opts.cwd || process.cwd() }), 'settings.json');
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
  // Tests pass an explicit `routerPath` so they don't have to write into the
  // real BIZAR_HOME. Runtime callers leave it unset and get the BIZAR_HOME
  // default via `resolveRouterPath`.
  const routerPath = opts.routerPath || resolveRouterPath(opts.cwd || process.cwd());
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

  const url = fromEnvUrl || fromSettingsUrl || fromRouterUrl || null;
  const token = fromEnvToken || fromSettingsToken;
  const source = fromEnvUrl ? 'env'
    : fromSettingsUrl ? 'settings.json'
    : fromRouterUrl ? 'model-router.json'
    : 'unconfigured';
  return { endpoint: url, authToken: token, source };
}

/**
 * Resolve the on-disk path of `model-router.json`.
 *
 * Precedence:
 *   1. `BIZAR_MODEL_ROUTER_CONFIG` (absolute path) — verbatim.
 *   2. `BIZAR_MODEL_ROUTER_CONFIG` (relative path) — resolved against `cwd`.
 *   3. `$BIZAR_HOME/config/claude/model-router.json` — the global default.
 *
 * The default lives under `BIZAR_HOME` (not `cwd`) because the router file
 * holds operator-controlled state (the `userSelected` block, refresh
 * provenance, endpoint override) that must survive cwd changes AND
 * `bizar install --force` clean runs — see
 * `cli/provision.mjs#FORCE_CLEAN_PRESERVE_ENV_KEYS`.
 *
 * `cwd` is retained as the resolution root for relative overrides so tests
 * that pre-stage a router file in a tmp dir keep working; it is NOT used as
 * the default anchor.
 *
 * @param {string} [cwd] - resolution root for relative `BIZAR_MODEL_ROUTER_CONFIG` overrides.
 * @returns {string}
 */
export function resolveRouterPath(cwd = process.cwd(), env = process.env) {
  return resolveGlobalModelRouter({ cwd, env });
}

/**
 * F-190 / IMP-017 explicit alias map reader. Reads
 * `~/.config/bizar/alias-map.json` and returns the parsed map (empty
 * object when the file is missing or unreadable). Mirrors the SDK's
 * `getAliasMap` helper — the CLI is the canonical writer so this
 * helper exists so the JS code path can stay self-contained.
 */
export function loadAliasMap(home) {
  const path = home ? join(home, '.config', 'bizar', 'alias-map.json') : join(resolveBizarHome(), 'alias-map.json');
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

function flattenModelsDevCatalog(catalog, { providerCatalog = false } = {}) {
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
    // Current Models.dev files use a top-level `models` map, while
    // `catalog.json` additionally nests model maps under `providers.<id>`.
    // Handle both envelopes explicitly; the previous walker silently skipped
    // the top-level map because it expected a second `.models` property.
    if (key === 'models') {
      for (const [modelId, model] of Object.entries(value)) add(modelId, model);
    }
    if (key === 'providers') {
      for (const [providerId, provider] of Object.entries(value)) {
        if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue;
        for (const [modelId, model] of Object.entries(provider.models || {})) {
          // catalog.json commonly uses the same bare model id under several
          // providers. Keep that identity in the key: a bare-id map would be
          // last-writer-wins and could attach one provider's serving facts to
          // another provider's model.
          const qualifiedId = providerCatalog && !modelId.includes('/')
            ? `${providerId}/${modelId}`
            : modelId;
          add(qualifiedId, { provider: providerId, ...model });
        }
      }
    }
  }
  return entries;
}

function uniqueCatalogMatch(entries, gatewayId, { requireProvider = false } = {}) {
  const raw = String(gatewayId || '').trim().toLowerCase();
  if (!raw) return null;
  const exact = entries.get(raw);
  if (exact) return exact;

  const wanted = normalizedModelIdentity(raw);
  const values = [...entries.values()];
  const providerMatches = wanted.provider
    ? values.filter((entry) => {
      const found = normalizedModelIdentity(entry.id);
      return found.model === wanted.model && found.provider === wanted.provider;
    })
    : [];
  if (providerMatches.length === 1) return providerMatches[0];
  if (requireProvider) return null;

  // Wrapper namespaces (for example cx/ or a gateway-specific prefix) are
  // not canonical providers. A canonical suffix is still safe when exactly
  // one catalog entry owns it; collisions deliberately remain unmatched.
  const suffixMatches = values.filter((entry) => normalizedModelIdentity(entry.id).model === wanted.model);
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
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

/**
 * Build a per-model profile object from a Models.dev catalog row.
 *
 * Phase 1 (v10.19.7): in addition to the long-standing `name` / `family` /
 * `capabilities` / `limits` / `metadata` fields, propagate Models.dev's
 * `description` and `summary` onto the profile so Phase 3's status screen
 * (10.19.9) can render the description without re-querying the catalog.
 */
export function toCapabilityProfile(gatewayId, match, matchType, confidence) {
  const limit = match.limit && typeof match.limit === 'object' ? match.limit : {};
  const modalities = match.modalities && typeof match.modalities === 'object' ? match.modalities : {};
  return {
    gatewayId,
    baseModel: match.id,
    name: typeof match.name === 'string' ? match.name : match.id,
    family: typeof match.family === 'string' ? match.family : null,
    description: typeof match.description === 'string' ? match.description : null,
    summary: typeof match.summary === 'string' ? match.summary : null,
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
    knowledge: typeof match.knowledge === 'string' ? match.knowledge : null,
    openWeights: match.open_weights === true,
    reasoningOptions: Array.isArray(match.reasoning_options) ? match.reasoning_options : [],
    interleaved: match.interleaved && typeof match.interleaved === 'object' ? match.interleaved : null,
    weights: Array.isArray(match.weights) ? match.weights : [],
    benchmarks: Array.isArray(match.benchmarks) ? match.benchmarks : [],
    cost: match.cost && typeof match.cost === 'object' ? match.cost : null,
    serving: match.serving && typeof match.serving === 'object' ? match.serving : null,
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
 *
 * Phase 1 (v10.19.7): when Models.dev has no row for the candidate AND the
 * candidate carries gateway-supplied `_gateway.name` / `_gateway.description`,
 * build a minimal `profile` so the picker row renderer can read
 * `profile.name` / `profile.description` directly without dereferencing
 * `_gateway`. Candidates whose `normalizeModels` output had no `_gateway`
 * fields keep the legacy `profile === null` contract so `capabilityLabel`
 * still returns `'metadata unavailable'` (Phase 2 owns the rewrite that
 * lets a non-null profile render the `'metadata unavailable'` label).
 */
export function enrichModelsWithCapabilities(candidates, catalog) {
  const entries = flattenModelsDevCatalog(catalog);
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const gatewayId = candidate.id;
    const exact = entries.get(String(gatewayId).toLowerCase());
    if (exact) {
      const profile = toCapabilityProfile(gatewayId, exact, 'exact-id', 0.9);
      return { ...candidate, profile, contextWindow: profile.limits.contextTokens };
    }
    const match = uniqueCatalogMatch(entries, gatewayId);
    if (match) {
      const profile = toCapabilityProfile(gatewayId, match, 'unique-normalized-id', 0.7);
      return { ...candidate, profile, contextWindow: profile.limits.contextTokens };
    }
    // Models.dev miss: if the candidate carries gateway-supplied label /
    // description, build a minimal `profile` so the picker row renderer
    // can read `profile.name` / `profile.description` directly. Candidates
    // that arrived from `normalizeModels` WITHOUT any `_gateway` data keep
    // the legacy `profile === null` contract so `capabilityLabel(null)`
    // still returns `'metadata unavailable'` (Phase 2 owns that rewrite).
    const gw = (candidate && typeof candidate._gateway === 'object' && candidate._gateway) || {};
    const gatewayName = typeof gw.name === 'string' ? gw.name
      : (typeof gw.display_name === 'string' ? gw.display_name : null);
    const gatewayDescription = typeof gw.description === 'string' ? gw.description : null;
    if (gatewayName === null && gatewayDescription === null) {
      return { ...candidate, profile: null, contextWindow: null };
    }
    const fallbackProfile = {
      gatewayId,
      baseModel: gatewayId,
      name: gatewayName,
      family: null,
      description: gatewayDescription,
      summary: null,
      capabilities: {
        attachment: false,
        reasoning: false,
        toolCall: false,
        structuredOutput: false,
        temperature: true,
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      limits: { contextTokens: null, inputTokens: null, outputTokens: null },
      releaseDate: null,
      lastUpdated: null,
      metadata: {
        source: 'gateway-fallback',
        sourceUrl: null,
        retrievedAt: new Date().toISOString(),
        matchType: 'gateway-fallback',
        confidence: 0,
      },
    };
    return { ...candidate, profile: fallbackProfile, contextWindow: null };
  });
}

function gatewayFallbackProfile(candidate) {
  if (!candidate?._gateway) return null;
  return {
    gatewayId: candidate.id,
    baseModel: candidate.id,
    name: candidate._gateway.name ?? candidate._gateway.display_name ?? null,
    family: null,
    description: candidate._gateway.description ?? null,
    summary: null,
    capabilities: {
      attachment: false,
      reasoning: false,
      toolCall: false,
      structuredOutput: false,
      temperature: true,
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
    limits: { contextTokens: null, inputTokens: null, outputTokens: null },
    metadata: { source: 'gateway-fallback', matchType: 'gateway-fallback', confidence: 0 },
  };
}

function withClearedTimeout(work, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Best-effort metadata enrichment. Interactive callers pass the complete
 * candidate set before rendering; non-interactive callers may pass only the
 * IDs they need. Empty input is returned without contacting Models.dev.
 *
 * The base and provider catalogs are fetched concurrently exactly once. Their
 * timeout handles are cleared as soon as each request settles. Catalog misses
 * fall back to the gateway's renderer-safe profile shape.
 *
 * @param {{
 *   candidates: Array<{ id: string, owned_by?: string|null, _gateway?: { name?: string|null, display_name?: string|null, description?: string|null } }>,
 *   pickedIds: string[],
 *   fetchFn?: typeof fetchModelsDevCatalog,
 *   timeoutMs?: number,
 *   concurrency?: number,
 *   now?: () => number,
 * }} opts
 * @returns {Promise<{ profiles: Map<string, object|null>, modelsDev: object }>}
 */
export async function enrichPicksByMetadata({
  candidates,
  pickedIds,
  fetchFn = fetchModelsDevCatalog,
  providerFetchFn,
  timeoutMs = 3000,
  concurrency = 8,
} = {}) {
  const out = new Map();
  const ids = Array.isArray(pickedIds) ? pickedIds.filter((id) => typeof id === 'string' && id) : [];
  if (ids.length === 0) return { profiles: out, modelsDev: {}, providerCatalog: {} };

  // Wholesale catalog fetch — best-effort. A network failure on the
  // initial fetch degrades to an empty map; per-id timeouts on the
  // downstream enrichment path fall back to `_gateway.name`.
  // The wholesale fetch inherits `timeoutMs` so a hung stub does not
  // block the picker-confirmation step indefinitely.
  const fetchWithTimeout = (fn, label) => withClearedTimeout(
    () => fn({ timeoutMs }),
    timeoutMs,
    `enrichPicksByMetadata: ${label} fetch`,
  ).catch(() => ({}));
  const [catalog, providerCatalog] = await Promise.all([
    fetchWithTimeout(fetchFn, 'base catalog'),
    typeof providerFetchFn === 'function' ? fetchWithTimeout(providerFetchFn, 'provider catalog') : Promise.resolve({}),
  ]);
  const catalogMap = flattenModelsDevCatalog(catalog);
  const providerMap = flattenModelsDevCatalog(providerCatalog, { providerCatalog: true });
  // Stable order so the work array indexes are predictable for the
  // bounded runner below.
  const work = ids.map((id, index) => ({ id, index }));
  const findCandidate = (id) => (Array.isArray(candidates) ? candidates.find((c) => c && c.id === id) : null);

  // Bounded-concurrency worker pool. Each worker pulls jobs off the
  // queue until empty. Per-id failure (timeout or thrown) falls back to
  // the candidate's `_gateway` block when present, otherwise leaves
  // the profile as `null`.
  const queue = [...work];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) return;
      const { id } = job;
      const candidate = findCandidate(id);
      if (!candidate) {
        out.set(id, null);
        continue;
      }
      try {
        await Promise.resolve().then(() => {
            const baseMatch = uniqueCatalogMatch(catalogMap, id);
            // Serving metadata is provider-specific. It is eligible only
            // for an exact or normalized explicit provider match; suffix-only
            // matching here would reintroduce cross-provider collisions.
            const providerMatch = uniqueCatalogMatch(providerMap, id, { requireProvider: true });
            const match = baseMatch
              ? { ...baseMatch, ...(providerMatch ? { serving: providerMatch, cost: providerMatch.cost ?? baseMatch.cost } : {}) }
              : providerMatch;
            let profile;
            if (match) {
              // Re-use the existing capability-profile shape; the new
              // helper differs from `enrichModelsWithCapabilities` only
              // in WHEN the catalog is fetched and WHICH ids are
              // enriched (confirmed picks only).
              profile = toCapabilityProfile(id, match, 'exact-id', 0.9);
            } else if (candidate._gateway) {
              profile = gatewayFallbackProfile(candidate);
            } else {
              profile = null;
            }
            out.set(id, profile);
          });
      } catch {
        // Per-id failure (timeout or thrown). Fall back to `_gateway.name`
        // when present so the Phase 1 contract still surfaces a name;
        // otherwise the profile is null.
        if (candidate._gateway) {
          out.set(id, gatewayFallbackProfile(candidate));
        } else {
          out.set(id, null);
        }
      }
    }
  });
  await Promise.all(workers);
  return { profiles: out, modelsDev: catalog, providerCatalog };
}

function capabilityLabel(profile) {
  if (!profile) return 'metadata unavailable';
  const capabilities = profile.capabilities || {};
  const modalities = Array.isArray(capabilities.inputModalities) ? capabilities.inputModalities : [];
  const limits = profile.limits || {};
  const caps = [];
  if (capabilities.reasoning) caps.push('reasoning');
  if (capabilities.toolCall) caps.push('tools');
  if (capabilities.structuredOutput) caps.push('structured');
  if (modalities.some((m) => m !== 'text')) caps.push('multimodal');
  if (limits.contextTokens) caps.push(formatContextTokens(limits.contextTokens));
  return caps.length > 0 ? caps.join(', ') : 'basic text';
}

/**
 * Format a context-window token count for the picker / capability label.
 * 1_048_576 → `1M ctx`, 200_000 → `200k ctx`, 32_000 → `32k ctx`. Trailing
 * `.0` is dropped from the M-suffix so 2_048_576 renders as `2M ctx`.
 */
export function formatContextTokens(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const m = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${m}M ctx`;
  }
  return `${Math.round(tokens / 1000)}k ctx`;
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

/**
 * Normalize the gateway `/models` response into the candidate-pool shape
 * consumed by the picker.
 *
 * Phase 1 (v10.19.7): in addition to the existing `id` / `owned_by` / `kind`
 * fields, preserve the gateway's optional `name` / `display_name` /
 * `description` payload under a new `_gateway` sub-object. The picker row
 * renderer reads `profile.name` / `profile.description`, so when the
 * Models.dev enrichment misses (Phase 2) the renderer can still surface a
 * gateway-supplied label or description rather than an id-derived fallback.
 *
 * NOTE: `_gateway` is in-memory only. `applyModels` never writes it to
 * `model-router.json`; the persisted shape stays as it was before this
 * change. See `models-namespace-sync.test.mjs#normalizeModels does not
 * persist _gateway into userSelected on round-trip` for the regression
 * pin.
 */
export function normalizeModels(body) {
  if (!body || typeof body !== 'object') return [];
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const owned = typeof m.owned_by === 'string' ? m.owned_by : '';
    const gw = {};
    if (typeof m.name === 'string' && m.name) gw.name = m.name;
    if (typeof m.display_name === 'string' && m.display_name) gw.display_name = m.display_name;
    if (typeof m.description === 'string' && m.description) gw.description = m.description;
    out.push({ id, owned_by: owned, kind: classifyKind(id), _gateway: gw });
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

export function classifyKind(modelId) {
  const id = String(modelId || '').toLowerCase();
  // Order matters: more-specific legacy prefixes are checked BEFORE the
  // generic `claude-` catch-all so `claude-qwen/...` and
  // `claude-minimax/...` are tagged with their real family, not lumped
  // into the generic `claude` bucket. Live gateway prefixes follow the
  // same rule.
  if (id.startsWith('claude-qwen/')) return 'claude-qwen';
  if (id.startsWith('claude-minimax/')) return 'claude-minimax';
  if (id.startsWith('claude-')) return 'claude';
  if (id.startsWith('cx/')) return 'cx';
  if (id.startsWith('oc/')) return 'oc';
  if (id.startsWith('anthropic/')) return 'anthropic';
  // Live gateway namespace (10.19.2+): bare provider/model forms exposed by
  // OmniRoute at https://route.polderlabs.io/v1.
  if (id.startsWith('minimax/')) return 'minimax';
  if (id.startsWith('codex/')) return 'codex';
  if (id.startsWith('glm/')) return 'glm';
  if (id.startsWith('qct/')) return 'qct';
  if (id.startsWith('openrouter/')) return 'openrouter';
  if (id.startsWith('a/')) return 'a';
  return 'other';
}

// ── Disabled providers (10.22.0 / Phase 4) ────────────────────────────────────
//
// Operator-controllable provider disable list. Read from the top-level
// `disabledProviders: string[]` key on the model-router config. There is NO
// in-code hardcoded list — adding or removing a blocked provider is a
// single JSON edit.
//
// Dual-path read: the Bizar path (`~/.config/bizar/config/claude/model-router.json`)
// WINS when both exist, including an explicit `[]` (operators may pin
// "no providers disabled" without deleting the legacy mirror). Whitespace
// trim + lowercase normalization happens at read time so operators may
// write `"  Anthropic  "` in JSON and still match `anthropic/...` model
// ids. The comparison itself is a case-sensitive prefix filter against
// the (lowercase) disabled prefixes, so `Anthropic/claude-X` (capital A)
// is intentionally NOT stripped — pin test covers that.

/**
 * Normalize a single disabled-provider prefix: trim whitespace, lowercase.
 * Returns empty string for non-string / empty input.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeDisabledPrefix(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase();
}

/**
 * Read `disabledProviders` from a parsed router object. Returns the
 * normalized prefix array (or empty array when missing / malformed).
 * @param {unknown} router
 * @returns {string[]}
 */
function extractDisabledProviders(router) {
  if (!router || typeof router !== 'object' || Array.isArray(router)) return [];
  const raw = router.disabledProviders;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    const norm = normalizeDisabledPrefix(v);
    if (norm) out.push(norm);
  }
  return out;
}

/**
 * Read the operator's `disabledProviders` list from the model-router
 * config. Dual-path: the Bizar path wins when present (even with an
 * explicit empty array); the legacy `~/.claude/model-router.json` mirror
 * is the fallback. Both paths are normalized (trim + lowercase) at read.
 *
 * Pure function over the filesystem; returns an empty array when neither
 * file exists, when both files lack the key, or when both reads fail.
 *
 * @param {{ routerPath?: string, legacyPath?: string }} [opts]
 *   - `routerPath` defaults to the Bizar home path
 *     (`~/.config/bizar/config/claude/model-router.json`).
 *   - `legacyPath` defaults to the Claude Code mirror
 *     (`~/.claude/model-router.json`).
 * @returns {string[]} normalized disabled-provider prefixes
 */
export function readDisabledProviders({ routerPath, legacyPath } = {}) {
  const bizarPath = routerPath || resolveGlobalModelRouter();
  const fallPath = legacyPath || join(resolveClaudeConfigDir(), 'model-router.json');
  if (existsSync(bizarPath)) {
    try {
      const parsed = JSON.parse(readFileSync(bizarPath, 'utf8'));
      const extracted = extractDisabledProviders(parsed);
      // Bizar path exists — its `disabledProviders` is authoritative even
      // when explicitly `[]` (operators may pin "no providers disabled"
      // without deleting the legacy mirror). Missing key still falls back.
      if (Array.isArray(parsed && typeof parsed === 'object' ? parsed.disabledProviders : undefined)) {
        return extracted;
      }
    } catch {
      // Corrupt Bizar file — fall through to the legacy mirror.
    }
  }
  if (existsSync(fallPath)) {
    try {
      const parsed = JSON.parse(readFileSync(fallPath, 'utf8'));
      return extractDisabledProviders(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Filter a candidate id list against the disabled-providers prefix list.
 *
 * The comparison is a strict, case-sensitive prefix match against the
 * NORMALIZED (lowercase) disabled prefixes. Candidate ids are checked
 * as-given, so a candidate like `Anthropic/claude-X` (capital A) is
 * intentionally NOT stripped when `disabledProviders` is `["anthropic"]`
 * — pin test covers that. Operators who want to block mixed-case ids
 * should write the lowercase form.
 *
 * Empty / missing `disabledProviders` is a no-op (returns the input list).
 *
 * @template T extends string
 * @param {T[] | Iterable<T>} candidates
 * @param {string[]} disabledProviders  already-normalized prefixes
 * @returns {{ kept: T[], stripped: T[] }}
 */
export function filterCandidatesByDisabledProviders(candidates, disabledProviders) {
  const list = Array.isArray(candidates) ? candidates : Array.from(candidates || []);
  const prefixes = Array.isArray(disabledProviders)
    ? disabledProviders.filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  if (prefixes.length === 0) return { kept: [...list], stripped: [] };
  const kept = [];
  const stripped = [];
  for (const id of list) {
    const s = typeof id === 'string' ? id : '';
    let blocked = false;
    for (const p of prefixes) {
      if (s && s.startsWith(p)) { blocked = true; break; }
    }
    if (blocked) stripped.push(id);
    else kept.push(id);
  }
  return { kept, stripped };
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
export function applyModels({ routerPath, models, tierHints = {}, profiles = {}, source = 'live-pick', disabledProviders }) {
  const incoming = Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.trim()) : [];
  // 10.22.0 / Phase 4: strip any id whose provider prefix is on the
  // operator's disabled-providers list. The router file owns the list —
  // no in-code hardcoded families. Stripped ids never reach the picker,
  // the settings.json sync, the SessionStart hook, or the Agent guard.
  // Tests pass an explicit `disabledProviders` array to keep the contract
  // deterministic; production callers omit it and read from disk.
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: list } = filterCandidatesByDisabledProviders(incoming, disabled);
  const hints = { ...(tierHints || {}) };
  for (const id of list) if (!hints[id]) hints[id] = defaultTierHint(id);
  const router = existsSync(routerPath)
    ? JSON.parse(readFileSync(routerPath, 'utf8'))
    : {};
  const previousProfiles = router?.userSelected?.profiles || {};
  const block = {
    models: list,
    lastUpdated: new Date().toISOString(),
    source,
    tierHints: hints,
    profiles: Object.fromEntries(list
      .filter((id) => profiles[id] || previousProfiles[id])
      .map((id) => [id, profiles[id] || previousProfiles[id]])),
  };
  router.userSelected = block;
  if (!router.version) router.version = '13.0.0';
  // Do NOT auto-inject a default endpoint here. Operators configure the
  // gateway via $BIZAR_MODEL_ROUTER_URL or $ANTHROPIC_BASE_URL; if neither
  // is set, the router's `endpoint` stays null and downstream commands
  // surface a clear "no gateway configured" error.
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

// ── F-191 / 10.19.2 sync to Claude Code settings.json + stale-ID gating ─────

/**
 * Detect model IDs that the live gateway does not serve. Picker picks
 * survive gateway 404s only when the user is warned at save time. Stale
 * IDs are written into `userSelected.staleIds` (audit trail) and excluded
 * from the settings.json sync so Claude Code does not see a `[claude-code:
 * unrecognized_model]` for a known-dead ID on every turn.
 *
 * @param {{ liveIds: string[], pickedIds: string[] }} opts
 * @returns {{ liveIds: string[], staleIds: string[], unknownIds: string[] }}
 *   - `liveIds` — picks that exist in the live gateway pool.
 *   - `staleIds` — picks that were never returned by the gateway in this run.
 *   - `unknownIds` — picks whose live status is unknown (no live pool yet).
 */
export function partitionStalePicks({ liveIds, pickedIds, disabledProviders }) {
  const live = Array.isArray(liveIds) ? new Set(liveIds) : null;
  const incoming = Array.isArray(pickedIds) ? pickedIds.filter((id) => typeof id === 'string' && id.trim()) : [];
  // 10.22.0 / Phase 4: strip disabled-provider ids before partition so
  // they never reach the live pool OR the stale list — they were never
  // the operator's intent once the disable list landed.
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: picks } = filterCandidatesByDisabledProviders(incoming, disabled);
  if (!live || live.size === 0) {
    return { liveIds: [], staleIds: [], unknownIds: [...new Set(picks)] };
  }
  const liveOut = [];
  const stale = [];
  for (const id of picks) {
    if (live.has(id)) liveOut.push(id);
    else stale.push(id);
  }
  return { liveIds: liveOut, staleIds: stale, unknownIds: [] };
}

/**
 * Sync `userSelected.models` into Claude Code's settings.json under
 * `modelOverrides` using recognized Claude IDs as keys and gateway IDs as
 * values. This
 * suppresses `[claude-code:unrecognized_model]` diagnostics on every turn
 * for any picked ID the gateway serves. Stale IDs (not returned by the
 * gateway) are excluded so the diagnostic still surfaces them.
 *
 * Behavior:
 *   - Reads `settings.json` if present; preserves every other field.
 *   - Maps every recognized Claude alias into picked IDs that are also in
 *     `liveIds`, preventing internal alias normalization from reaching an
 *     unconfigured provider default.
 *   - Atomic replace via temp-file + rename (matches `applyModels`).
 *   - When `settingsJsonPath` is provided (tests), uses that instead of
 *     `~/.claude/settings.json`.
 *   - When `settingsJsonPath` is `null`, skips the sync entirely — used
 *     by tests that want to exercise the picker without touching Claude
 *     Code's real settings file.
 *
 * @param {{
 *   settingsJsonPath?: string|null,
 *   pickedIds: string[],
 *   liveIds?: string[],
 * }} opts
 * @returns {{
 *   wrote: boolean,
 *   syncedIds: string[],
 *   skippedStale: string[],
 *   skippedDisabled: string[],
 *   settingsPath: string|null,
 * }}
 */
export function applyModelOverrides({ settingsJsonPath, pickedIds, liveIds = [], disabledProviders, profiles = {} }) {
  const path = settingsJsonPath === undefined
    ? join(resolveClaudeConfigDir(), 'settings.json')
    : settingsJsonPath;
  if (path === null) {
    return { wrote: false, syncedIds: [], skippedStale: [], skippedDisabled: [], settingsPath: null };
  }
  const live = new Set(Array.isArray(liveIds) ? liveIds : []);
  const incoming = Array.isArray(pickedIds) ? pickedIds.filter((id) => typeof id === 'string' && id.trim()) : [];
  // 10.22.0 / Phase 4: strip disabled-provider ids BEFORE the mapping
  // so Claude Code never sees an `anthropic/*` override value. The
  // skipped ids are reported back so the operator can see what was
  // dropped (without crashing on the disabled list).
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: picks, stripped: skippedDisabled } = filterCandidatesByDisabledProviders(incoming, disabled);
  // Map only IDs the live gateway serves. Stale IDs intentionally stay
  // out so the `[claude-code:unrecognized_model]` diagnostic still fires
  // for them — the operator should re-run `bizar models` to drop them.
  const synced = live.size === 0
    ? picks
    : picks.filter((id) => live.has(id));
  const skipped = live.size === 0 ? [] : picks.filter((id) => !live.has(id));

  let settings = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
    } catch {
      // Corrupt settings.json — refuse to overwrite it; surface the sync
      // as a no-op so `bizar models` still completes.
      return { wrote: false, syncedIds: [], skippedStale: skipped, skippedDisabled, settingsPath: path };
    }
  }
  // Claude Code ignores unknown override keys. Recognized Anthropic model IDs
  // must be keys; configured gateway aliases are values. This also suppresses
  // print-mode `[claude-code:unrecognized_model]` diagnostics for Agent SDK calls.
  settings.modelOverrides = buildClaudeModelOverrides(synced);
  if (requiresGatewayModelDiscovery(synced)) {
    settings.env = {
      ...(settings.env || {}),
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    };
  }
  const previousModel = typeof settings.model === 'string' ? settings.model : null;
  const previousContext = profiles?.[previousModel]?.limits?.contextTokens;
  const nextModel = synced[0] || null;
  const nextContext = profiles?.[nextModel]?.limits?.contextTokens;
  const existingContext = settings.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  const previousWasManaged = Number.isSafeInteger(previousContext)
    && String(previousContext) === String(existingContext);
  const canManageContext = existingContext === undefined || previousWasManaged;

  if (nextModel) settings.model = nextModel;
  else delete settings.model;
  if (canManageContext && Number.isSafeInteger(nextContext) && nextContext >= 100_000) {
    settings.env = { ...(settings.env || {}), CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(nextContext) };
  } else if (previousWasManaged && settings.env) {
    delete settings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  writeAtomic(path, JSON.stringify(settings, null, 2) + '\n');
  return { wrote: true, syncedIds: synced, skippedStale: skipped, skippedDisabled, settingsPath: path };
}

export function configuredFallbackModels(router) {
  const disabled = extractDisabledProviders(router);
  const ids = [];
  for (const tier of Object.values(router?.tiers || {})) {
    for (const id of Array.isArray(tier?.models) ? tier.models : []) {
      if (typeof id === 'string' && id.trim() && !ids.includes(id.trim())) ids.push(id.trim());
    }
  }
  return filterCandidatesByDisabledProviders(ids, disabled).kept;
}

export function configuredEnabledModels(router) {
  const disabled = extractDisabledProviders(router);
  const selected = currentSelection(router, { disabledProviders: disabled }).models;
  return selected.length > 0 ? selected : configuredFallbackModels(router);
}

export const CLAUDE_MODEL_OVERRIDE_KEYS = Object.freeze([
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
]);

export function buildClaudeModelOverrides(modelIds) {
  const unique = [...new Set((Array.isArray(modelIds) ? modelIds : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
  if (unique.length === 0) return {};
  // Cover every built-in alias: the workflow runtime may normalize an Agent
  // request through one of these names, and no alias may escape to an
  // unconfigured Anthropic default.
  return Object.fromEntries(CLAUDE_MODEL_OVERRIDE_KEYS
    .map((key, index) => [key, unique[index % unique.length]]));
}

/** Custom gateway IDs must be discoverable to Claude's SDK/subagent path. */
export function requiresGatewayModelDiscovery(modelIds) {
  return (Array.isArray(modelIds) ? modelIds : []).some((id) => {
    if (typeof id !== 'string' || !id.trim()) return false;
    return !/^(?:claude(?:-|$)|anthropic(?:[./-]|$))/i.test(id.trim());
  });
}

/**
 * Derive a human-readable label for a model ID. Used to populate the
 * `modelPicker` array in settings.json so Claude Code's `/model` picker
 * displays picked models with something nicer than the raw `provider/name`
 * string.
 *
 *   minimax/MiniMax-M3              → "MiniMax M3"
 *   codex/gpt-5.6-sol               → "GPT 5.6 Sol"
 *   qct/qwen3.8-max-preview         → "Qwen3.8 Max Preview"
 *   openrouter/nvidia/foo:free      → "nvidia/foo:free"
 *
 * The gateway-reported `name` (when available on the picked profile) always
 * wins. Falls back to a title-cased rendering of the model segment.
 *
 * @param {string} modelId
 * @param {object} [profile] Optional profile with `name` or `displayName`
 * @returns {string}
 */
export function deriveModelLabel(modelId, profile) {
  const name = profile && typeof profile.name === 'string' && profile.name.trim();
  if (name) return name.trim();
  const displayName = profile && typeof profile.displayName === 'string' && profile.displayName.trim();
  if (displayName) return displayName.trim();
  const id = String(modelId || '').trim();
  if (!id) return '';
  // Drop the leading provider segment (`minimax/MiniMax-M3` → `MiniMax-M3`)
  // so the operator sees the model name, not the namespace.
  const slash = id.indexOf('/');
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  // Split on word boundaries (hyphens / underscores / dots / colons / path
  // separators) and join with spaces. Case is preserved verbatim — `gpt`
  // stays `gpt`, `MiniMax` stays `MiniMax`, `M2.7` stays `M2.7`. Brand
  // casing belongs to the gateway (`name` field), not us.
  return tail
    .replace(/[\\/]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sync `userSelected.models` into Claude Code's `modelPicker` setting
 * (settings.json). The picker is what populates `/model` — `modelOverrides`
 * alone only silences diagnostics, it does NOT add entries to the picker.
 *
 * Per Claude Code's settings reference: `modelPicker` is an OBJECT with an
 * `options` array. Each option has `{ model, label?, description? }`.
 * Scope is User-or-managed (settings.json is in scope). The `options`
 * array preserves the operator's pick order from `userSelected.models`.
 *
 * Behavior:
 *   - Reads settings.json; preserves every other field (env, mcpServers,
 *     permissions, hooks, etc.).
 *   - Writes `modelPicker = { options: [{ model, label }] }`.
 *   - Filters out picks the live gateway rejects (same stale-ID contract as
 *     `applyModelOverrides`); the surviving picks fill the picker.
 *   - Empty pick list → writes `modelPicker: { options: [] }` so Claude
 *     Code falls back to its built-in picker.
 *   - Atomic replace via temp-file + rename (matches `applyModels`).
 *   - Refuses to overwrite a corrupt settings.json.
 *   - When `settingsJsonPath === null`, returns a no-op (tests).
 *
 * @param {{
 *   settingsJsonPath?: string|null,
 *   pickedIds: string[],
 *   profiles?: Record<string, object>,
 *   liveIds?: string[],
 * }} opts
 * @returns {{
 *   wrote: boolean,
 *   options: Array<{model: string, label: string, description?: string}>,
 *   skippedStale: string[],
 *   skippedDisabled: string[],
 *   settingsPath: string|null,
 * }}
 */
export function applyModelPicker({ settingsJsonPath, pickedIds, profiles = {}, liveIds = [], disabledProviders }) {
  const path = settingsJsonPath === undefined
    ? join(resolveClaudeConfigDir(), 'settings.json')
    : settingsJsonPath;
  if (path === null) {
    return { wrote: false, options: [], skippedStale: [], skippedDisabled: [], settingsPath: null };
  }
  const live = new Set(Array.isArray(liveIds) ? liveIds : []);
  const incoming = Array.isArray(pickedIds) ? pickedIds.filter((id) => typeof id === 'string' && id.trim()) : [];
  // 10.22.0 / Phase 4: drop disabled-provider ids BEFORE the live-id
  // gate so Claude Code's `/model` picker never surfaces an
  // `anthropic/*` (or any other disabled) option.
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: picks, stripped: skippedDisabled } = filterCandidatesByDisabledProviders(incoming, disabled);
  const surviving = live.size === 0 ? picks : picks.filter((id) => live.has(id));
  const skipped = live.size === 0 ? [] : picks.filter((id) => !live.has(id));
  const options = surviving.map((id) => {
    const profile = profiles?.[id];
    const label = deriveModelLabel(id, profile);
    const option = { model: id, label };
    const description = profile && typeof profile.description === 'string' && profile.description.trim();
    if (description) option.description = description.trim();
    return option;
  });

  let settings = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
    } catch {
      return { wrote: false, options: [], skippedStale: skipped, skippedDisabled, settingsPath: path };
    }
  }
  settings.modelPicker = { options };
  writeAtomic(path, JSON.stringify(settings, null, 2) + '\n');
  return { wrote: true, options, skippedStale: skipped, skippedDisabled, settingsPath: path };
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
 * @returns {{ refreshed: string[], preservedOperator: string[], skippedFresh: string[], skippedDisabled: string[], error?: string }}
 */
export function applyRefresh({
  routerPath,
  candidates,
  catalog,
  aliasMap = {},
  now = new Date(),
  disabledProviders,
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
  const rawExistingModels = Array.isArray(userSelected.models) ? userSelected.models : [];
  const existingTierHints = userSelected.tierHints && typeof userSelected.tierHints === 'object'
    ? userSelected.tierHints
    : {};

  // 10.22.0 / Phase 4: filter disabled-provider ids off the existing
  // list BEFORE the refresh loop so the disabled ids never get a
  // refresh attempt, are not in the returned counts, and the persisted
  // userSelected.models reflects the operator's intent. Dropped profiles
  // are also pruned so the on-disk state does not keep growing on every
  // refresh.
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: existingModels, stripped: droppedDisabledIds } = filterCandidatesByDisabledProviders(
    rawExistingModels.filter((id) => typeof id === 'string' && id.trim()),
    disabled,
  );
  const newProfiles = { ...existingProfiles };
  for (const dropped of droppedDisabledIds) delete newProfiles[dropped];

  const refreshed = [];
  const preservedOperator = [];
  const skippedFresh = [];
  const skippedDisabled = [...droppedDisabledIds];

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
  // Do NOT auto-inject a default endpoint here either; same rationale as
  // the picker write path above.
  writeAtomic(routerPath, JSON.stringify(router, null, 2) + '\n');

  return { refreshed, preservedOperator, skippedFresh, skippedDisabled };
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
export function currentSelection(router, { disabledProviders } = {}) {
  if (!router || typeof router !== 'object') return { models: [], tierHints: {} };
  const us = router.userSelected;
  if (!us || typeof us !== 'object') return { models: [], tierHints: {} };
  const incoming = Array.isArray(us.models) ? us.models.filter((m) => typeof m === 'string') : [];
  // 10.22.0 / Phase 4: also strip disabled-provider ids on every read.
  // Callers (interactive picker, JSON envelope, audit tools) all consume
  // the filtered list so the operator's disable intent is honoured even
  // for ids already persisted in `userSelected.models` from a prior run.
  const disabled = Array.isArray(disabledProviders) ? disabledProviders : readDisabledProviders();
  const { kept: models } = filterCandidatesByDisabledProviders(incoming, disabled);
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
 * keypress-driven checklist with direct type-to-search (arrow keys / space /
 * Ctrl+A / Ctrl+N / enter / esc / backspace / ?). When stdin is not a TTY (pipes, CI,
 * tests) the picker falls
 * through to a line-mode loop that accepts a space-separated index list,
 * `all`, `none`, `toggle <i>`, `/query`, `search query`, an empty line
 * (confirm), or `q` (quit). Both
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

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Score a fuzzy query against one text field. Exact, prefix, token-prefix,
 * and substring matches lead; ordered subsequences remain useful for compact
 * queries such as `gpt56l`. A negative score means no match.
 */
function fuzzyTextScore(value, query, allowSubsequence = true) {
  const text = normalizeSearchText(value);
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  if (!text) return -1;
  if (text === needle) return 10_000;
  if (text.startsWith(needle)) return 9_000 - (text.length - needle.length);

  const tokenIndex = text.split(' ').findIndex((token) => token.startsWith(needle));
  if (tokenIndex >= 0) return 8_000 - tokenIndex * 10;

  const substringIndex = text.indexOf(needle);
  if (substringIndex >= 0) return 7_000 - substringIndex;

  // One- and two-character subsequences are too permissive across model
  // descriptions. Short searches must be contiguous.
  if (!allowSubsequence || needle.replace(/\s/g, '').length < 3) return -1;

  let textIndex = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  let boundaries = 0;
  for (const char of needle) {
    if (char === ' ') continue;
    const found = text.indexOf(char, textIndex);
    if (found < 0) return -1;
    if (first < 0) first = found;
    if (previous >= 0) gaps += found - previous - 1;
    if (found === 0 || text[found - 1] === ' ') boundaries++;
    previous = found;
    textIndex = found + 1;
  }
  const compactNeedleLength = needle.replace(/\s/g, '').length;
  if (gaps > Math.max(8, compactNeedleLength * 2)) return -1;
  return 4_000 + boundaries * 25 - first * 2 - gaps;
}

/**
 * Pure fuzzy filter used by both picker modes. Match quality determines
 * inclusion while gateway order remains stable as the query changes.
 *
 * @param {Array<{id: string, profile?: object, _gateway?: object}>} candidates
 * @param {string} query
 * @returns {Array<{id: string, profile?: object, _gateway?: object}>}
 */
export function filterModelCandidates(candidates, query) {
  if (!Array.isArray(candidates)) return [];
  const needle = normalizeSearchText(query);
  if (!needle) return [...candidates];

  return candidates
    .map((candidate, index) => {
      const profile = candidate?.profile || {};
      const gateway = candidate?._gateway || {};
      const fields = [
        [candidate?.id, 300, true],
        [profile.baseModel, 275, true],
        [profile.name, 200, true],
        [gateway.name, 200, true],
        [profile.displayName, 200, true],
        [gateway.display_name, 200, true],
        [profile.family, 175, true],
        [gateway.family, 175, true],
        [profile.description, 100, false],
        [gateway.description, 100, false],
        [profile.summary, 50, false],
        [gateway.summary, 50, false],
      ];
      const score = Math.max(...fields.map(([value, bonus, allowSubsequence]) => {
        const fieldScore = fuzzyTextScore(value, needle, allowSubsequence);
        return fieldScore < 0 ? -1 : fieldScore + bonus;
      }));
      return { candidate, index, score };
    })
    .filter((entry) => entry.score >= 0)
    // Gateway order is the stable picker contract. Fuzzy scoring decides
    // inclusion; it deliberately does not reshuffle rows while the operator
    // types, which keeps cursor movement predictable.
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.candidate);
}

async function pickModelsLineMode({ ordered, candidates, selected, lastOrder, stdin, stdout, prompt }) {
  const lines = makeLineReader(stdin);
  let query = '';
  for (;;) {
    const visibleCandidates = filterModelCandidates(candidates, query);
    const visibleIds = visibleCandidates.map((candidate) => candidate.id);
    renderPicker(stdout, visibleIds, selected, prompt, visibleCandidates, {
      query,
      total: ordered.length,
    });
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
    if (cmd === '/' || cmd === 'search' || cmd === 'clear search') {
      query = '';
      continue;
    }
    if (cmd.startsWith('/')) {
      query = cmd.slice(1).trim();
      continue;
    }
    if (cmd.startsWith('search ')) {
      query = cmd.slice('search '.length).trim();
      continue;
    }
    if (cmd.startsWith('toggle ')) {
      const idx = Number(cmd.slice('toggle '.length).trim());
      if (!Number.isInteger(idx) || idx < 1 || idx > visibleIds.length) {
        stdout.write(chalk.red(`  x index out of range\n`));
        continue;
      }
      const id = visibleIds[idx - 1];
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
      if (n < 1 || n > visibleIds.length) continue;
      const id = visibleIds[n - 1];
      if (selected.has(id)) {
        selected.delete(id);
        lastOrder = lastOrder.filter((x) => x !== id);
      } else {
        selected.add(id);
        lastOrder.push(id);
      }
      changed = true;
    }
    if (!changed) stdout.write(chalk.yellow(`  ! unrecognised input - try '/query', 'search query', 'all', 'none', 'toggle <i>', or '1 3 5'\n`));
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
  let query = '';
  let visibleCandidates = [...candidates];
  const originalIndices = new Map(candidates.map((candidate, index) => [candidate, index]));

  readline.emitKeypressEvents(stdin);
  if (typeof stdin.resume === 'function') stdin.resume();
  stdout.write(`${ERASE_SCREEN}${HIDE_CURSOR}`);

  const exitState = await new Promise((resolve) => {
    const onKey = (str, key) => {
      if (!key) return;
      // Resolve confirmation. Escape clears an active search first so a
      // typo never accidentally exits the picker.
      if (key.name === 'return') {
        return finish();
      }
      if (key.name === 'escape') {
        if (query) {
          query = '';
          refreshFilter();
          render();
          return;
        }
        return finish();
      }
      if (key.ctrl && key.name === 'c') {
        // SIGINT: discard selection and break out, but do not bubble.
        selected.clear();
        lastOrder.length = 0;
        return finish();
      }
      if (key.name === 'up' && visibleCandidates.length > 0) {
        cursor = (cursor - 1 + visibleCandidates.length) % visibleCandidates.length;
      } else if (key.name === 'down' && visibleCandidates.length > 0) {
        cursor = (cursor + 1) % visibleCandidates.length;
      } else if (key.name === 'space') {
        if (visibleCandidates.length > 0) {
          const id = visibleCandidates[cursor].id;
          if (selected.has(id)) {
            selected.delete(id);
            lastOrder = lastOrder.filter((x) => x !== id);
          } else {
            selected.add(id);
            lastOrder.push(id);
          }
        }
      } else if (key.ctrl && key.name === 'a') {
        for (const id of ordered) selected.add(id);
        lastOrder = [...ordered];
      } else if (key.ctrl && key.name === 'n') {
        selected.clear();
        lastOrder = [];
      } else if (str === '?') {
        showHelp = !showHelp;
      } else if (key.name === 'backspace' || key.name === 'delete') {
        if (!query) return;
        query = query.slice(0, -1);
        refreshFilter();
      } else if (typeof str === 'string' && str.length === 1 && !key.ctrl && !key.meta && str >= ' ') {
        query += str;
        refreshFilter();
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
    if (visibleCandidates.length === 0 || visibleCandidates.length <= VIEWPORT_SIZE) {
      scrollTop = 0;
      return;
    }
    if (cursor < scrollTop) scrollTop = cursor;
    else if (cursor >= scrollTop + VIEWPORT_SIZE) scrollTop = cursor - VIEWPORT_SIZE + 1;
    if (scrollTop < 0) scrollTop = 0;
    if (scrollTop > Math.max(0, visibleCandidates.length - VIEWPORT_SIZE)) {
      scrollTop = Math.max(0, visibleCandidates.length - VIEWPORT_SIZE);
    }
  }

  function refreshFilter() {
    visibleCandidates = filterModelCandidates(candidates, query);
    cursor = 0;
    scrollTop = 0;
  }

  function render() {
    const width = String(ordered.length).length;
    const columns = typeof stdout.columns === 'number' ? stdout.columns : 80;
    const lines = [];
    lines.push(`\x1b[K${chalk.bold(`-- ${prompt} --`)}`);
    lines.push(`\x1b[K${query ? `  Search: ${chalk.bold(query)}` : chalk.dim('  Search: type a model name or ID')}`);
    const start = scrollTop;
    const end = Math.min(visibleCandidates.length, start + VIEWPORT_SIZE);
    const above = start;
    const below = visibleCandidates.length - end;
    if (above > 0) lines.push(`\x1b[K${chalk.dim(`  ⋮ ${above} more above`)}`);
    for (let i = start; i < end; i++) {
      const candidate = visibleCandidates[i];
      const originalIndex = originalIndices.get(candidate) ?? i;
      const row = fitRow({
        i: originalIndex,
        id: candidate.id,
        profile: candidate.profile,
        width,
        isCursor: i === cursor,
        isSelected: selected.has(candidate.id),
        columns,
      });
      lines.push(`\x1b[K${row}`);
    }
    if (visibleCandidates.length === 0) lines.push(`\x1b[K${chalk.yellow('  No models match your search.')}`);
    if (below > 0) lines.push(`\x1b[K${chalk.dim(`  ⋮ ${below} more below`)}`);
    lines.push(`\x1b[K${chalk.dim(`  ${selected.size}/${ordered.length} selected · ${visibleCandidates.length}/${ordered.length} shown. ↑/↓ move · space toggle · enter confirm.`)}`);
    if (showHelp) lines.push(`\x1b[K${chalk.dim(`  Extra: type to search · backspace edit · esc clear/confirm · ctrl+a all · ctrl+n none · ? help.`)}`);
    lines.push(`\x1b[K`);

    const contentHeight = lines.length;
    while (lines.length < lastRenderHeight) lines.push('\x1b[K');
    if (lastRenderHeight > 0) {
      stdout.write(cursorUp(lastRenderHeight));
    }
    stdout.write(lines.join('\n'));
    lastRenderHeight = Math.max(lastRenderHeight, contentHeight);
  }
}

// ── 10.19.9 Phase 3: post-confirm status screen ──────────────────────────────
//
// After the operator confirms a picker selection, `bizar models` prints a
// status screen showing one row per picked ID with a ✔ / ✖ / ⤳ icon. The
// shape mirrors `cli/doctor.mjs#runDoctor` (per-row ✔ / ✖ pattern) so
// operators see a familiar surface. The renderer is CLI-only — the
// SessionStart hook has no TTY and no outbound HTTP and must NOT import
// these helpers.

const STATUS_ICON = Object.freeze({
  fresh: '✔',       // ✔
  refreshed: '✔',   // ✔
  unavailable: '✖', // ✖
  preexisting: '⤳', // ⤳
});

/**
 * Classify one picked id into the four status states the renderer can
 * print. Pure: no I/O, no side effects.
 *
 *   'preexisting'  — the operator-confirmed pick already lived in
 *                    userSelected.models BEFORE this run. Wins over every
 *                    other branch (the operator explicitly re-selected
 *                    a known-good pick).
 *   'unavailable'  — the post-confirm Models.dev enrichment returned
 *                    profile === null AND no _gateway.name fallback was
 *                    available. Surface as ✖.
 *   'refreshed'    — profile exists with metadata.source === 'gateway-
 *                    fallback' (Phase 1 contract). Models.dev missed but
 *                    the gateway's name field rescued the row. Surface
 *                    as ✔ (refreshed).
 *   'fresh'        — profile exists with metadata.source === 'models.dev'
 *                    (the Phase 2 enrichment succeeded). Surface as ✔.
 *
 * @param {string} id            the picked id (e.g. 'anthropic/claude-3-5-sonnet')
 * @param {object|null} profile  the Phase 2 enrichment result for that id
 *                               (null when both Models.dev AND _gateway.name missed)
 * @param {Set<string>} [preExisting]  snapshot of userSelected.models BEFORE applyModels
 *                                      overwrote the block; undefined is treated as empty
 * @returns {'fresh'|'refreshed'|'unavailable'|'preexisting'}
 */
export function classifyPickStatus(id, profile, preExisting) {
  if (preExisting instanceof Set && preExisting.has(id)) return 'preexisting';
  if (!profile) return 'unavailable';
  if (profile.metadata && profile.metadata.source === 'gateway-fallback') return 'refreshed';
  return 'fresh';
}

/**
 * Resolve the profile object from the heterogeneous shapes Phase 2 hands
 * us: a `Map<string, object|null>` when called from `run()`, a plain
 * object when called from a fixture, or `undefined` for "the enrichment
 * step never ran for this id".
 */
function resolveProfile(profiles, id) {
  if (!profiles) return null;
  if (profiles instanceof Map) {
    return profiles.has(id) ? profiles.get(id) : null;
  }
  if (typeof profiles === 'object') {
    return Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  }
  return null;
}

function formatStatusRow({ id, profile, status }) {
  const icon = STATUS_ICON[status];
  if (status === 'preexisting') {
    return chalk.dim(`  ${icon} ${id}  (already in userSelected)`);
  }
  if (status === 'unavailable') {
    // Profile is null AND no _gateway.name fallback. The renderer never
    // reaches this branch when Phase 2's _gateway.name plumbing survived.
    return chalk.red(`  ${icon} ${id}  (metadata unavailable)`);
  }
  // 'fresh' or 'refreshed' — both render as ✔ with the model name.
  // For 'refreshed' the only label available is the Phase 1 _gateway.name;
  // for 'fresh' we prefer Models.dev's name and fall back to _gateway.name.
  const label = (profile && profile.name)
    || (profile && profile._gateway && profile._gateway.name)
    || id;
  return chalk.green(`  ${icon} ${id}  (${label})`);
}

/**
 * Render the post-confirm status screen for one picker run.
 *
 * CLI-only surface — do NOT import from the SessionStart hook (no TTY,
 * no outbound HTTP). The helper writes to `out` based on `isTTY`:
 *   - isTTY=true  → one `  <icon> <id>  (<label>)` line per picked id
 *                   plus a footer `N passed, M failed, K skipped`.
 *   - isTTY=false → one collapsed line `  v N passed, M failed, K skipped`
 *                   appended to the existing "Saved" block (so piped
 *                   callers see one summary line, not a flood of rows).
 *
 * Always returns `{ perPick, totals, exitCode }` so `--json` callers can
 * embed the data in the JSON envelope without re-implementing the
 * classification:
 *   - status.perPick = [{ id, status, hasProfile }]
 *   - status.totals  = { passed, failed, skipped }
 *   - exitCode       = 0 when at least one ✔; 2 when EVERY row is ✖;
 *                      0 otherwise (mixed picks, or every pick ⤳).
 *
 * The caller decides whether to call `process.exit(exitCode)`; the
 * renderer never exits on its own.
 *
 * @param {object} opts
 * @param {string[]} opts.picked            ids the operator confirmed
 * @param {Map<string, object|null>|object} [opts.profiles]  Phase 2 enrichment map
 * @param {Set<string>} [opts.preExisting]  userSelected.models snapshot BEFORE applyModels
 * @param {object} [opts.fetchSummary]      unused today; reserved for Phase 4 disable surfacing
 * @param {NodeJS.WritableStream} [opts.out] defaults to process.stdout (test fixtures inject a stub)
 * @param {boolean} [opts.isTTY=true]       when false, print the single-line collapse
 * @returns {{ perPick: Array<{id:string, status:string, hasProfile:boolean}>, totals: {passed:number, failed:number, skipped:number}, exitCode: 0|2 }}
 */
export function renderPickStatusScreen({
  picked = [],
  profiles,
  preExisting,
  fetchSummary = null,
  out = process.stdout,
  isTTY = true,
} = {}) {
  const perPick = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of picked) {
    const profile = resolveProfile(profiles, id);
    const status = classifyPickStatus(id, profile, preExisting);
    const hasProfile = !!profile;
    perPick.push({ id, status, hasProfile });
    if (status === 'preexisting') skipped += 1;
    else if (status === 'unavailable') failed += 1;
    else passed += 1;
  }
  const totals = { passed, failed, skipped };

  if (isTTY) {
    for (const entry of perPick) {
      const profile = resolveProfile(profiles, entry.id);
      out.write(formatStatusRow({ id: entry.id, profile, status: entry.status }) + '\n');
    }
    const summary = chalk.dim(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
    out.write(summary + '\n');
  } else {
    const summary = chalk.dim(`  v ${passed} passed, ${failed} failed, ${skipped} skipped`);
    out.write(summary + '\n');
  }

  // Exit-code contract: 0 when at least one ✔; 2 only when EVERY row is ✖.
  // Mixed picks and all-⤳ picks both exit 0 (the operator got a usable
  // confirmation, even if some picks couldn't be enriched).
  const exitCode = (passed > 0)
    ? 0
    : (failed === picked.length && picked.length > 0)
      ? 2
      : 0;

  return { perPick, totals, exitCode };
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

function renderPicker(out, ordered, selected, prompt, candidates = [], { query = '', total = ordered.length } = {}) {
  out.write('\n' + chalk.bold(`-- ${prompt} --`) + '\n');
  out.write(query
    ? `  Search: ${chalk.bold(query)}  ${chalk.dim(`(${ordered.length}/${total} shown)`)}\n`
    : chalk.dim(`  Search: /query or search query  (${ordered.length}/${total} shown)\n`));
  const width = String(Math.max(ordered.length, 1)).length;
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (let i = 0; i < ordered.length; i++) {
    const id = ordered[i];
    const mark = selected.has(id) ? chalk.green('[x]') : '[ ]';
    const idx = String(i + 1).padStart(width, ' ');
    const profile = candidatesById.get(id)?.profile;
    out.write(`  ${mark} ${chalk.dim(idx + '.')} ${id}${chalk.dim(`  [${capabilityLabel(profile)}]`)}\n`);
  }
  if (ordered.length === 0) out.write(chalk.yellow('  No models match your search.\n'));
  out.write(chalk.dim(`\n  ${selected.size}/${total} selected. Numbers target shown rows; '/', 'all', 'none', or Enter to confirm.\n`));
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
    bizar models                    Interactive searchable picker
    bizar models --list             Print candidate IDs, one per line
    bizar models --set a,b,c        Persist the comma-separated IDs to userSelected
    bizar models --clear            Remove userSelected; use the first enabled configured-tier model
    bizar models --refresh         Re-fetch Models.dev metadata for stale profiles; preserve operator overrides
    bizar models explain <role>     Print ranked eligibility for a role (no gateway)
    bizar models --json             Machine-readable output for any subcommand
    bizar models --help             This help

  The orchestrator (@mike) prefers userSelected and otherwise uses enabled
  configured-tier candidates. Every dispatch receives an explicit model;
  Bizar never inherits an unconfigured provider default.

  Picker search: in a TTY, type a model ID or name to fuzzy-filter, use
  Backspace to edit, and Escape to clear the query (or confirm when clear).
  Arrow keys move, Space toggles, Enter confirms, and Ctrl+A/Ctrl+N select
  all or none. In line mode, use /query or "search query"; / clears search,
  and numeric choices target the currently shown rows.

  Post-confirm status screen (interactive only): after the picker saves a
  selection, every confirmed id is reported on its own row with one of:

    ✔   Models.dev profile retrieved (or carried over via the gateway
        _gateway.name fallback). The label shows the profile name.
    ✖   Models.dev miss AND no _gateway.name fallback. The row prints
        \`(metadata unavailable)\`.
    ⤳   Id was already in userSelected.models before this run
        (re-confirmed pick). Label: \`(already in userSelected)\`.

  The screen ends with a footer \`N passed, M failed, K skipped\`. In a
  TTY the screen is multi-row; in a pipe it collapses to one summary
  line appended to the existing \"Saved N model(s)\" block. \`--json\`
  carries the equivalent data in \`status.perPick\` (one entry per
  picked id) and \`status.totals\` ({passed, failed, skipped}). Exit
  code is 0 when at least one ✔ was reported, 2 when every row is ✖;
  mixed ✔+✖ still exits 0.

  Endpoint resolution order: $BIZAR_MODEL_ROUTER_URL / $ANTHROPIC_BASE_URL
    -> ~/.claude/settings.json#env.BIZAR_MODEL_ROUTER_URL
    -> model-router.json#endpoint
    If none of the above is configured, the gateway-dependent subcommands
    (probe, --refresh) exit with a configuration error rather than guessing
    a default. Bizar is provider-agnostic and ships no default gateway.

  Auth: $ANTHROPIC_AUTH_TOKEN -> settings.json#env.ANTHROPIC_AUTH_TOKEN.\n\n  Discovered models are enriched from https://models.dev/models.json.\n  Metadata lookup is best-effort and never hides gateway-reported models.

  Disable providers (10.22.0 / Phase 4): the operator's
    model-router.json#disabledProviders: string[]
  list filters out every id whose provider prefix matches (case-sensitive,
  trimmed + lowercased at read time). The filter is consulted at every
  reader site: the picker (interactive + --list), settings.json#model
  and #modelOverrides, settings.json#modelPicker.options, the
  SessionStart sync, and the Agent model guard. Empty / missing list is
  a no-op (every id passes through). Add or remove a blocked provider
  with a single JSON edit; no in-code list exists.
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

export async function run(name, args, isHelpRequest, deps = {}) {
  // `bizar model` remains a deprecated alias; `bizar models` is the canonical surface.
  // `deps` is an optional test-injection surface (10.19.8 Phase 2):
  //   - `pickModels` — override the interactive picker (for tests that
  //     auto-confirm without a TTY)
  //   - `fetchModelsDevCatalog` — override the catalog fetch (for tests
  //     that count calls or stub models.dev)
  //   - `listModels` — override the gateway `/models` fetch (for tests)
  // All three default to the module-level exports; production callers
  // see no behaviour change.
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

  // The router file lives under BIZAR_HOME (operator-controlled state that
  // must survive cwd changes and `bizar install --force`). See
  // `resolveRouterPath` for the precedence rules; `cwd` is passed only so a
  // relative `BIZAR_MODEL_ROUTER_CONFIG` override still resolves sensibly.
  const routerPath = resolveRouterPath(process.cwd());
  const { endpoint, authToken, source: endpointSource } = resolveEndpoint({ cwd: process.cwd() });

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
        console.log(chalk.yellow(`  ! userSelected is empty for role ${roleArg}; orchestrator will use configured tier fallback.`));
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
    const loadedBefore = loadRouter(routerPath);
    const before = currentSelection(loadedBefore);
    const previousProfiles = loadedBefore?.userSelected?.profiles || {};
    const router = existsSync(routerPath)
      ? JSON.parse(readFileSync(routerPath, 'utf8'))
      : {};
    delete router.userSelected;
    writeAtomic(routerPath, JSON.stringify(router, null, 2) + '\n');
    const fallback = configuredFallbackModels(router);
    const sync = applyModelOverrides({ pickedIds: fallback, liveIds: [], profiles: previousProfiles });
    const picker = applyModelPicker({ pickedIds: [], liveIds: [] });
    if (wantJson) {
      process.stdout.write(JSON.stringify({ cleared: true, previous: before.models, fallbackModel: fallback[0] || null, sync, picker }, null, 2) + '\n');
    } else {
      console.log(chalk.green('  v userSelected cleared'));
      console.log(chalk.dim(`    previous: ${before.models.length} model(s)`));
      process.stdout.write(`${chalk.dim(`    active fallback: ${fallback[0] || '(none configured)'}`)}\n`);
    }
    return true;
  }

  if (setValue !== null) {
    const ids = parseSet(setValue);
    if (ids.length === 0) {
      console.error(chalk.red('  x --set requires at least one model id'));
      process.exit(2);
    }
    const previousProfiles = loadRouter(routerPath)?.userSelected?.profiles || {};
    const block = applyModels({ routerPath, models: ids, source: 'cli-set' });
    // Sync to Claude Code's settings.json — picks survive stale-ID
    // filtering only when an empty liveIds array disables it (no
    // candidates fetched for `--set`). The orchestrator will surface
    // `[claude-code:unrecognized_model]` for any ID the gateway later
    // rejects; the operator can re-run `bizar models` to drop them.
    const sync = applyModelOverrides({ pickedIds: ids, liveIds: [], profiles: { ...previousProfiles, ...(block.profiles || {}) } });
    const picker = applyModelPicker({ pickedIds: ids, profiles: block.profiles || {}, liveIds: [] });
    if (wantJson) {
      process.stdout.write(JSON.stringify({ applied: block, sync, picker }, null, 2) + '\n');
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

  // Catalog metadata is an interactive presentation dependency. `--list`,
  // `--set`, and the deprecated list alias remain gateway-only and never
  // contact Models.dev.
  let candidates;
  let modelsDev = { status: 'skipped', matched: 0, total: 0, source: MODELS_DEV_CATALOG_URL, note: 'lazy fetch — --list does not contact models.dev' };
  try {
    // The deprecated `bizar model` alias preserves the legacy
    // "retry-without-auth on 401" behavior so existing scripts keep working.
    // The new `bizar models` surface fails fast on 401 with an actionable
    // error message (the user explicitly picks models — no silent retry).
    const listModelsFn = deps.listModels || listModels;
    candidates = await listModelsFn({ endpoint, authToken, retryWithoutAuth: isDeprecatedAlias });
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
  // 10.19.8 Phase 2: when `deps.pickModels` is provided (test injection),
  // skip the TTY guard — the test harness is responsible for the picker.
  const pickModelsFn = deps.pickModels || pickModels;
  if (!process.stdin.isTTY && !deps.pickModels) {
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
  const previousProfiles = router?.userSelected?.profiles || {};
  // 10.19.9 Phase 3: capture a snapshot of userSelected.models BEFORE
  // applyModels overwrites the block, so the post-confirm status screen
  // can classify re-confirmed picks as `preexisting` (⤳) instead of
  // `fresh` (✔). `current` is read once and shared with pickModelsFn;
  // we wrap it in a Set so classifyPickStatus can use `.has(id)`.
  const preExisting = new Set(current);
  const fetchModelsDevCatalogFn = deps.fetchModelsDevCatalog || fetchModelsDevCatalog;
  const fetchProviderCatalogFn = deps.fetchProviderCatalog
    || (deps.fetchModelsDevCatalog ? undefined : fetchProviderCatalog);
  // Fetch both catalogs once, concurrently, before rendering. Reuse this map
  // after confirmation so the picker and persisted settings see identical
  // metadata and confirmation never causes a second network round trip.
  const enrichment = await enrichPicksByMetadata({
    candidates,
    pickedIds: candidates.map((candidate) => candidate.id),
    fetchFn: fetchModelsDevCatalogFn,
    providerFetchFn: fetchProviderCatalogFn,
  });
  const profilesMap = enrichment.profiles;
  const enrichedCandidates = candidates.map((candidate) => {
    const fresh = profilesMap.get(candidate.id);
    const cached = previousProfiles[candidate.id];
    const profile = fresh?.metadata?.source === 'models.dev' ? fresh : (cached || fresh || null);
    return { ...candidate, profile, contextWindow: profile?.limits?.contextTokens ?? null };
  });
  const picked = await pickModelsFn({ candidates: enrichedCandidates, current });
  const modelsDevStatus = enrichment.modelsDev && Object.keys(enrichment.modelsDev).length > 0
    ? { status: 'ok', source: MODELS_DEV_CATALOG_URL, matched: picked.filter((id) => profilesMap.get(id)?.metadata?.source === 'models.dev').length, total: picked.length }
    : { status: 'unavailable', source: MODELS_DEV_CATALOG_URL, matched: 0, total: picked.length, note: 'wholesale fetch failed; per-id enrichment degraded to _gateway.name fallback' };

  if (picked.length === 0) {
    const block = applyModels({ routerPath, models: [], source: 'live-pick' });
    // Clear Claude Code modelOverrides + modelPicker when the picker is
    // emptied so the session no longer claims to recognise removed IDs.
    const fallback = configuredFallbackModels(loadRouter(routerPath));
    applyModelOverrides({ pickedIds: fallback, liveIds: [], profiles: previousProfiles });
    applyModelPicker({ pickedIds: [], liveIds: [] });
    if (wantJson) {
      process.stdout.write(JSON.stringify({
        applied: block,
        endpoint,
        endpointSource,
        enriched: [],
        profiles: {},
        modelsDev: modelsDevStatus,
      }, null, 2) + '\n');
    } else {
      process.stdout.write(`${chalk.yellow(`  ! No models selected - using configured fallback ${fallback[0] || '(none)'}.`)}\n`);
    }
    return true;
  }
  const tierHints = {};
  const profiles = {};
  for (const id of picked) {
    tierHints[id] = defaultTierHint(id);
    const fresh = profilesMap.get(id);
    // A transient catalog miss must not erase a previously good profile.
    // Gateway fallback data remains useful for new models, but cached
    // Models.dev/operator facts take precedence when already present.
    const profile = fresh?.metadata?.source === 'models.dev'
      ? fresh
      : (previousProfiles[id] || fresh);
    if (profile) profiles[id] = profile;
  }
  // F-191 / 10.19.2 — stale-ID detection: the picker shows candidates
  // filtered through the live gateway, but `--set` and the picker can both
  // accept IDs the gateway later rejects (e.g. `a/1`). Persist them as
  // `staleIds` for audit and skip them in the settings.json sync so Claude
  // Code still surfaces the unrecognized_model diagnostic.
  const liveIds = candidates.map((c) => c.id);
  const partition = partitionStalePicks({ liveIds, pickedIds: picked });
  const block = applyModels({ routerPath, models: picked, tierHints, profiles, source: 'live-pick' });
  if (partition.staleIds.length > 0) {
    block.staleIds = partition.staleIds;
  }
  const sync = applyModelOverrides({ pickedIds: picked, liveIds, profiles: { ...previousProfiles, ...profiles } });
  // Sync the /model picker contents (`modelPicker` setting) so the user's
  // picks drive the picker without relying on gateway discovery.
  const picker = applyModelPicker({ pickedIds: picked, profiles, liveIds });
  if (wantJson) {
    // Phase 2 (10.19.8): the interactive JSON output gains an `enriched`
    // key naming the picked IDs that received Models.dev enrichment. For
    // Phase 2 the array equals the picks list (no filtering); Phase 4
    // will filter to only the IDs that actually received a profile.
    const enriched = picked.slice();
    // 10.19.9 Phase 3: --json gains `status.perPick` + `status.totals`.
    // The renderer writes nothing to stdout in --json mode (out is a
    // no-op writable; isTTY=false keeps the single-line collapse from
    // leaking into the JSON stream). The JSON envelope carries the
    // equivalent data shape.
    const statusResult = renderPickStatusScreen({
      picked,
      profiles,
      preExisting,
      out: { write: () => true },
      isTTY: false,
    });
    process.stdout.write(JSON.stringify({
      applied: block,
      endpoint,
      endpointSource,
      enriched,
      profiles,
      modelsDev: modelsDevStatus,
      sync,
      picker,
      status: { perPick: statusResult.perPick, totals: statusResult.totals, exitCode: statusResult.exitCode },
    }, null, 2) + '\n');
    if (statusResult.exitCode !== 0) process.exitCode = statusResult.exitCode;
  } else {
    console.log(chalk.green(`\n  v Saved ${block.models.length} model(s) to ${routerPath}:`));
    console.log(chalk.dim(`    Models.dev profiles: ${Object.keys(block.profiles || {}).length}/${block.models.length}`));
    for (const id of block.models) {
      const tier = block.tierHints[id] || defaultTierHint(id);
      console.log(chalk.dim(`    ${id}  (${tier})`));
    }
    if (sync.wrote && sync.skippedStale.length > 0) {
      console.log(chalk.yellow(`    Settings sync skipped ${sync.skippedStale.length} stale id(s): ${sync.skippedStale.join(', ')}`));
    }
    if (picker.wrote) {
      console.log(chalk.dim(`    /model picker populated with ${picker.options.length} entr${picker.options.length === 1 ? 'y' : 'ies'}`));
    }
    // 10.19.9 Phase 3: post-confirm status screen. Prints one ✔ / ✖ / ⤳
    // row per picked id + an `N passed, M failed, K skipped` footer when
    // stdout is a TTY, or a single collapsed line when piped. Empty-pick
    // (the `picked.length === 0` branch above) intentionally skips the
    // screen — the chalk.yellow "No models selected" line is the only
    // operator feedback there.
    const statusResult = renderPickStatusScreen({
      picked,
      profiles,
      preExisting,
      out: process.stdout,
      isTTY: !!process.stdout.isTTY,
    });
    if (statusResult.exitCode !== 0) process.exitCode = statusResult.exitCode;
  }
  return true;
}
