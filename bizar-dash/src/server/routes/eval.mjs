/**
 * src/server/routes/eval.mjs
 *
 * v5.0.0 — REST surface for the eval framework.
 *
 * Endpoints:
 *   GET  /api/eval/runs                — list recent runs
 *   GET  /api/eval/runs/:id           — get run details
 *   POST /api/eval/run                — run a suite
 *   GET  /api/eval/runs/:id/compare/:otherId — diff two runs
 *   GET  /api/eval/fixtures           — list fixtures in a suite path
 *
 * The llmCall defaults to minimax.chatCompletion but can be overridden
 * via the state for custom providers.
 */
import { Router } from 'express';
import { loadFixtures, runFixture, runSuite } from '../eval.mjs';
import { saveRun, listRuns, getRun, compareRuns, buildRunId } from '../eval-store.mjs';
import { chatCompletion } from '../minimax.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createEvalRouter({ state, broadcast }) {
  const router = Router();

  // GET /api/eval/runs — list recent runs
  router.get('/eval/runs', wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const runs = await listRuns({ limit });
    res.json({ runs });
  }));

  // GET /api/eval/runs/:id — get run details
  router.get('/eval/runs/:id', wrap(async (req, res) => {
    const run = await getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'not_found', message: `run ${req.params.id} not found` });
      return;
    }
    res.json(run);
  }));

  // GET /api/eval/fixtures — list fixtures in a suite path
  router.get('/eval/fixtures', wrap(async (req, res) => {
    const { path: suitePath } = req.query;
    if (!suitePath || typeof suitePath !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'query.path is required' });
      return;
    }
    const fixtures = loadFixtures(suitePath);
    res.json({ fixtures });
  }));

  // POST /api/eval/run — run a suite
  router.post('/eval/run', wrap(async (req, res) => {
    const { suitePath, fixtures: fixtureIds, concurrency = 5, agent = 'thor' } = req.body || {};

    if (!suitePath || typeof suitePath !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'suitePath is required' });
      return;
    }

    // Build the llmCall — use minimax by default, allow state override
    const llmCall = async (prompt, opts = {}) => {
      // Check if state has a custom eval LLM provider
      const customCall = state?.getSettings?.()?.eval?.llmCall;
      if (customCall) {
        return customCall(prompt, opts);
      }
      // Default: minimax chatCompletion
      const result = await chatCompletion({ prompt, model: 'MiniMax-M3' });
      if (!result.ok) {
        throw new Error(result.message || 'llm call failed');
      }
      return {
        content: result.content,
        usage: {
          inputTokens: result.usage?.prompt_tokens ?? 0,
          outputTokens: result.usage?.completion_tokens ?? 0,
          totalTokens: result.usage?.total_tokens ?? 0,
        },
      };
    };

    const runId = buildRunId();
    const startedAt = new Date().toISOString();

    // Load fixtures
    let fixtures = loadFixtures(suitePath);
    if (fixtureIds?.length) {
      fixtures = fixtures.filter((f) => fixtureIds.includes(f.id));
    }

    if (fixtures.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'no fixtures found in suite' });
      return;
    }

    // Broadcast start
    broadcast({ type: 'eval:run:start', runId, total: fixtures.length });

    // Run the suite
    const suiteResult = await runSuite(suitePath, {
      llmCall,
      concurrency,
      timeoutMs: 120_000,
    });

    const finishedAt = new Date().toISOString();
    const run = {
      id: runId,
      startedAt,
      finishedAt,
      suitePath,
      total: suiteResult.total,
      passed: suiteResult.passed,
      failed: suiteResult.failed,
      results: suiteResult.results,
    };

    // Persist
    await saveRun(run);

    // Broadcast complete
    broadcast({ type: 'eval:run:complete', runId, passed: run.passed, failed: run.failed });

    res.status(201).json(run);
  }));

  // GET /api/eval/runs/:id/compare/:otherId — diff two runs
  router.get('/eval/runs/:id/compare/:otherId', wrap(async (req, res) => {
    const { id, otherId } = req.params;
    const diff = await compareRuns(id, otherId);
    if (diff.error) {
      res.status(404).json({ error: 'not_found', message: diff.error });
      return;
    }
    res.json(diff);
  }));

  return router;
}
