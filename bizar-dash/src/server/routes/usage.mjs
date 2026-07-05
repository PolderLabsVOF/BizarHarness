/**
 * src/server/routes/usage.mjs
 *
 * Endpoints for usage analytics:
 *   GET  /api/usage                          — aggregate usage (range, from, to, providerId, modelId)
 *   GET  /api/usage/limits                 — live quota limits + usage percent (agents call this)
 *   GET  /api/usage/recent                  — last N raw records (live tail)
 *
 * The agent-awareness path (/api/usage/limits) calls fetchRemains() for
 * live quota data, then merges with the JSONL rolling totals.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';
import {
  queryUsage,
  getUsageLimitsForAgent,
} from '../minimax-usage-store.mjs';

export function createUsageRouter() {
  const router = Router();

  // GET /api/usage?range=24h|7d|30d|custom&from=&to=&providerId=&modelId=
  router.get('/usage', wrap(async (req, res) => {
    const range      = String(req.query.range      || '24h');
    const from       = req.query.from        ? Number(req.query.from)       : undefined;
    const to         = req.query.to          ? Number(req.query.to)         : undefined;
    const providerId = req.query.providerId  ? String(req.query.providerId)  : undefined;
    const modelId    = req.query.modelId     ? String(req.query.modelId)    : undefined;

    if (!['24h', '7d', '30d', 'custom'].includes(range)) {
      return res.status(400).json({ error: 'invalid_range', message: 'range must be 24h, 7d, 30d, or custom' });
    }
    if (range === 'custom' && (!from || !to)) {
      return res.status(400).json({ error: 'missing_dates', message: 'range=custom requires `from` and `to` (unix ms)' });
    }

    const opts = {
      range,
      from,
      to,
      providerId,
      modelId,
    };

    let result;
    try {
      result = queryUsage(opts);
    } catch (err) {
      return res.status(400).json({ error: 'query_error', message: String((err).message) });
    }
    return res.json(result);
  }));

  // GET /api/usage/limits
  // Returns live quota info from fetchRemains() merged with rolling usage totals.
  router.get('/usage/limits', wrap(async (_req, res) => {
    // Dynamic import to avoid pulling in the full minimax client bundle on every
    // dashboard page load. The usage store is lightweight.
    /** @type {Record<string, unknown>} */
    let remainsData = { models: [] };
    try {
      const { fetchRemains } = await import('../minimax.mjs');
      const remains = await fetchRemains({ force: false });
      if (remains.ok) {
        // Cast through unknown to avoid TypeScript pollution in plain .mjs.
        remainsData = /** @type {Record<string, unknown>} */ (remains);
      }
    } catch { /* best-effort — return zeros */ }

    // Rolling usage from JSONL.
    const agentSummary = await getUsageLimitsForAgent('minimax');

    // Merge: per-model usage from JSONL + per-model quota from remains.
    /** @type {Array<{model_name?: string, current_interval_remaining_percent?: number, current_weekly_remaining_percent?: number, intervalResetInHuman?: string, weeklyResetInHuman?: string}>} */
    const models = (remainsData.models || []);

    // Build per-model percentUsed from the JSONL per-model data.
    const usageResult = queryUsage({ range: '24h', providerId: 'minimax' });
    const perModelUsage = new Map(usageResult.perModel.map(m => [`minimax/${m.modelId}`, m]));

    const perModelLimits = models.map(m => {
      const usage = perModelUsage.get(`minimax/${m.model_name}`);
      const usedTokens = usage?.totalTokens ?? 0;
      const remainingPct = m.current_interval_remaining_percent ?? 100;
      let estimatedDailyBudget = 0;
      let percentUsed = 0;
      if (remainingPct < 100 && usedTokens > 0) {
        estimatedDailyBudget = Math.round(usedTokens / (1 - remainingPct / 100));
        percentUsed = Math.round((usedTokens / estimatedDailyBudget) * 1000) / 10;
      }
      return {
        modelId: m.model_name ?? 'unknown',
        totalTokensUsed: usedTokens,
        requestCount: usage?.requests ?? 0,
        limits: {
          dailyTokens: estimatedDailyBudget || null,
          intervalResetIn: m.intervalResetInHuman ?? null,
          weeklyResetIn: m.weeklyResetInHuman ?? null,
        },
        percentUsed24h: percentUsed,
      };
    });

    return res.json({
      provider: 'minimax',
      requestsLast5min:  agentSummary.requestsLast5min,
      tokensLast5min:    agentSummary.tokensLast5min,
      requestsLast24h:   agentSummary.requestsLast24h,
      tokensLast24h:     agentSummary.tokensLast24h,
      limits:            agentSummary.limits,
      percentUsed24h:    agentSummary.percentUsed24h,
      estimatedTimeUntilReset: agentSummary.estimatedTimeUntilReset,
      warning:           agentSummary.warning,
      perModel:          perModelLimits,
      fetchedAt:         remainsData.fetchedAt ? new Date(remainsData.fetchedAt).toISOString() : null,
    });
  }));

  // GET /api/usage/recent?limit=50
  router.get('/usage/recent', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    // Read last N lines from the JSONL.
    const { readAllRecords } = await import('../minimax-usage-store.mjs');
    const all = readAllRecords();
    const recent = all.slice(-limit).reverse(); // newest first

    return res.json({
      records: recent,
      total: all.length,
      returned: recent.length,
    });
  }));

  return router;
}
