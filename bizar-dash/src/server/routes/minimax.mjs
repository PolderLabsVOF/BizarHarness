/**
 * src/server/routes/minimax.mjs
 *
 * v4.5.0 — REST surface for the MiniMax Token Plan integration.
 *
 * Endpoints:
 *   GET  /api/minimax/status         — current key + cached remains summary
 *   GET  /api/minimax/remains        — full remains snapshot (5h + weekly per model)
 *   POST /api/minimax/remains/refresh — force re-fetch from the API
 *   POST /api/minimax/test           — smoke-test the key with a one-shot chat call
 *   GET  /api/minimax/cache          — read the on-disk cache file (for debugging)
 *   DELETE /api/minimax/cache        — clear cache
 *   POST /api/minimax/onboarding     — onboarding wizard state (dismissed, hiddenModels)
 *   POST /api/minimax/onboarding/save-key  — write the user's key to opencode's
 *                                           auth.json (the canonical place)
 *
 * The MiniMax key is read from opencode's auth store, NOT from
 * settings.json. The dashboard's onboarding wizard writes the key
 * directly to ~/.local/share/opencode/auth.json so opencode itself
 * can pick it up — that way the user only enters the key once.
 */
import { Router } from 'express';
import {
  fetchRemains,
  chatCompletion,
  readCachedRemains,
  clearRemainsCache,
  getStatus,
  writeAuthFile,
  writeOnboarding,
  readOnboarding,
  maskKey,
  KNOWN_MODELS,
} from '../minimax.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createMinimaxRouter({ state, broadcast }) {
  const router = Router();

  // GET / — health + config summary
  router.get('/minimax/status', wrap(async (_req, res) => {
    res.json(getStatus());
  }));

  // GET /onboarding — wizard state (dismissed?, hidden models)
  router.get('/minimax/onboarding', wrap(async (_req, res) => {
    res.json(readOnboarding());
  }));

  // POST /onboarding — update wizard state
  router.post('/minimax/onboarding', wrap(async (req, res) => {
    const patch = req.body || {};
    const next = writeOnboarding(patch);
    res.json(next);
  }));

  // POST /onboarding/save-key — write the key to opencode's auth.json
  router.post('/minimax/onboarding/save-key', wrap(async (req, res) => {
    const { key, groupId } = req.body || {};
    if (typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ ok: false, error: 'no_key', message: 'Key is required' });
      return;
    }
    try {
      const path = writeAuthFile(key.trim(), groupId || 'default');
      // Clear the remains cache so the next load picks up the new key.
      clearRemainsCache();
      // Mark the onboarding as dismissed (user has the key now).
      writeOnboarding({ dismissedAt: Date.now() });
      if (broadcast) {
        broadcast({ type: 'minimax:configured', source: 'auth.json' });
      }
      res.json({ ok: true, path, apiKeyHint: maskKey(key) });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'write_failed', message: err.message });
    }
  }));

  // GET /remains — current snapshot (cache-or-fetch)
  router.get('/minimax/remains', wrap(async (_req, res) => {
    const result = await fetchRemains();
    if (broadcast && result.ok) {
      broadcast({ type: 'minimax:remains', remains: result });
    }
    res.json(result);
  }));

  // POST /remains/refresh — force re-fetch (bypass cache TTL)
  router.post('/minimax/remains/refresh', wrap(async (_req, res) => {
    const result = await fetchRemains({ force: true });
    if (broadcast && result.ok) {
      broadcast({ type: 'minimax:remains:refreshed', remains: result });
    }
    res.json(result);
  }));

  // POST /test — smoke-test the key with a chat completion
  router.post('/minimax/test', wrap(async (req, res) => {
    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt
      : 'Reply with the single word: ok';
    const model = typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : 'MiniMax-M3';
    const result = await chatCompletion({
      prompt,
      model,
      maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : 32,
    });
    res.json(result);
  }));

  // GET /cache — read the on-disk cache (debugging)
  router.get('/minimax/cache', wrap(async (_req, res) => {
    res.json(readCachedRemains() || null);
  }));

  // DELETE /cache — clear cache
  router.delete('/minimax/cache', wrap(async (_req, res) => {
    clearRemainsCache();
    if (broadcast) broadcast({ type: 'minimax:cache:cleared' });
    res.json({ ok: true });
  }));

  return router;
}
