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
 *
 * All endpoints read the API key from settings.json (no key is ever
 * accepted as a URL param or body field — the user puts it in the
 * settings UI). Responses never echo the key back; they include a
 * masked `apiKeyHint` (last 4 chars only).
 */
import { Router } from 'express';
import {
  fetchRemains,
  chatCompletion,
  readCachedRemains,
  clearRemainsCache,
  readMinimaxSettings,
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
    const settings = readMinimaxSettings();
    const cached = readCachedRemains();
    res.json({
      enabled: settings.enabled,
      configured: !!settings.apiKey,
      apiKeyHint: maskKey(settings.apiKey),
      groupId: settings.groupId,
      baseUrl: settings.baseUrl,
      chatBaseUrl: settings.chatBaseUrl,
      knownModels: KNOWN_MODELS,
      cache: cached
        ? {
            fetchedAt: cached.fetchedAt,
            apiKeyHint: cached.apiKeyHint,
            groupId: cached.groupId,
            modelCount: (cached.models || []).length,
          }
        : null,
    });
  }));

  // GET /remains — current snapshot (cache-or-fetch)
  router.get('/minimax/remains', wrap(async (_req, res) => {
    const settings = readMinimaxSettings();
    if (!settings.enabled) {
      res.json({ ok: false, error: 'disabled', message: 'MiniMax integration is disabled in settings' });
      return;
    }
    const result = await fetchRemains({
      apiKey: settings.apiKey,
      groupId: settings.groupId,
      baseUrl: settings.baseUrl,
    });
    if (broadcast && result.ok) {
      broadcast({ type: 'minimax:remains', remains: result });
    }
    res.json(result);
  }));

  // POST /remains/refresh — force re-fetch (bypass cache TTL)
  router.post('/minimax/remains/refresh', wrap(async (_req, res) => {
    const settings = readMinimaxSettings();
    if (!settings.enabled) {
      res.json({ ok: false, error: 'disabled', message: 'MiniMax integration is disabled in settings' });
      return;
    }
    const result = await fetchRemains({
      apiKey: settings.apiKey,
      groupId: settings.groupId,
      baseUrl: settings.baseUrl,
      force: true,
    });
    if (broadcast && result.ok) {
      broadcast({ type: 'minimax:remains:refreshed', remains: result });
    }
    res.json(result);
  }));

  // POST /test — smoke-test the key with a chat completion
  router.post('/minimax/test', wrap(async (req, res) => {
    const settings = readMinimaxSettings();
    if (!settings.enabled) {
      res.json({ ok: false, error: 'disabled', message: 'MiniMax integration is disabled in settings' });
      return;
    }
    if (!settings.apiKey) {
      res.json({ ok: false, error: 'no_api_key', message: 'MiniMax API key is not configured' });
      return;
    }
    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt
      : 'Reply with the single word: ok';
    const model = typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : 'MiniMax-M3';
    const result = await chatCompletion({
      apiKey: settings.apiKey,
      prompt,
      model,
      baseUrl: settings.chatBaseUrl,
      maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : 32,
    });
    res.json(result);
  }));

  // GET /cache — read the on-disk cache (debugging)
  router.get('/minimax/cache', wrap(async (_req, res) => {
    res.json(readCachedRemains() || null);
  }));

  // DELETE /cache — clear cache (admin endpoint)
  router.delete('/minimax/cache', wrap(async (_req, res) => {
    clearRemainsCache();
    if (broadcast) broadcast({ type: 'minimax:cache:cleared' });
    res.json({ ok: true });
  }));

  return router;
}
