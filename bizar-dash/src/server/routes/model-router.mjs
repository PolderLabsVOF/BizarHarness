/**
 * src/server/routes/model-router.mjs
 *
 * Surfaces the local model-router configuration and live model list.
 *
 *   GET /api/model-router                 — full policy + agent→model map
 *   GET /api/model-router/models          — live model list from the local router
 *   GET /api/model-router/agents          — agent→model map only
 *   GET /api/model-router/resolve/:agent  — concrete model + endpoint for an agent
 *
 * The local router URL defaults to ANTHROPIC_BASE_URL or
 * BIZAR_MODEL_ROUTER_URL or `http://localhost:20128/v1`.
 */
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrap } from './_shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// .claude/model-router.json — repo root.
// From src/server/routes/ up to repo root is 3 levels (routes -> server -> src -> repo).
const ROUTER_POLICY_PATH = resolve(__dirname, '../../../../.claude/model-router.json');

const DEFAULT_ENDPOINT = 'http://localhost:20128/v1';

function resolveEndpoint(state) {
  const fromEnv =
    process.env.BIZAR_MODEL_ROUTER_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    state?.config?.modelRouterUrl;
  return (fromEnv || DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

async function loadPolicy() {
  try {
    const raw = await readFile(ROUTER_POLICY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      version: '0.0.0',
      endpoint: DEFAULT_ENDPOINT,
      tiers: {},
      agents: {},
      policies: {},
    };
  }
}

async function fetchLiveModels(endpoint) {
  try {
    const res = await fetch(`${endpoint}/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      reachable: true,
      endpoint,
      models: Array.isArray(body?.data) ? body.data : [],
    };
  } catch (err) {
    return {
      reachable: false,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * v10.1.0 — Resolve the concrete model + endpoint for a named agent
 * directly from the on-disk policy. No SDK import needed (keeps the
 * dashboard route surface lightweight). Used by the front-end's
 * "agent fleet" view, which renders one card per agent with its
 * modelId + endpoint badge.
 */
function resolveAgentFromPolicy(policy, agent, endpoint) {
  const agents = policy?.agents || {};
  const entry = agents[agent];
  if (entry && typeof entry.model === 'string') {
    return {
      agent,
      modelId: entry.model,
      tier: typeof entry.tier === 'string' ? entry.tier : 'default',
      endpoint,
      rationale: typeof entry.rationale === 'string' ? entry.rationale : '',
    };
  }
  // Fallback: first known entry by name, otherwise the default tier.
  const fallback = Object.values(agents).find((e) => e && typeof e.model === 'string');
  if (fallback) {
    return {
      agent,
      modelId: fallback.model,
      tier: typeof fallback.tier === 'string' ? fallback.tier : 'default',
      endpoint,
      rationale: 'fallback (agent not in policy)',
    };
  }
  return {
    agent,
    modelId: 'bizar/MiniMax-M3',
    tier: 'default',
    endpoint,
    rationale: 'fallback (no policy)',
  };
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createModelRouterRouter({ state }) {
  const router = Router();

  router.get('/model-router', wrap(async (_req, res) => {
    const policy = await loadPolicy();
    const endpoint = resolveEndpoint(state);
    const live = await fetchLiveModels(endpoint);
    res.json({
      endpoint,
      policy,
      live,
      agents: policy.agents || {},
      tiers: policy.tiers || {},
    });
  }));

  router.get('/model-router/models', wrap(async (_req, res) => {
    const endpoint = resolveEndpoint(state);
    const live = await fetchLiveModels(endpoint);
    res.json(live);
  }));

  router.get('/model-router/agents', wrap(async (_req, res) => {
    const policy = await loadPolicy();
    res.json({ agents: policy.agents || {}, tiers: policy.tiers || {} });
  }));

  // v10.1.0 — Resolve one agent to its concrete model + endpoint.
  // The front-end's ModelRouter page calls this so it doesn't need to
  // duplicate the registry logic client-side.
  router.get('/model-router/resolve/:agent', wrap(async (req, res) => {
    const agent = String(req.params.agent || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(agent)) {
      res.status(400).json({ error: 'bad_slug', message: 'agent must match /^[a-z][a-z0-9_-]{0,63}$/' });
      return;
    }
    const policy = await loadPolicy();
    const endpoint = resolveEndpoint(state);
    const resolved = resolveAgentFromPolicy(policy, agent, endpoint);
    res.json(resolved);
  }));

  return router;
}