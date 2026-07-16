/**
 * src/server/routes/model-router.mjs
 *
 * Surfaces the local model-router configuration and live model list.
 *
 *   GET /api/model-router                 — full policy + agent→model map
 *   GET /api/model-router/models          — live model list from the local router
 *   GET /api/model-router/agents          — agent→model map only
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

  return router;
}