/**
 * src/server/routes/distill.mjs
 *
 * v6.4.0 — F-033 / ADR-174.
 *
 * REST surface for the ReasoningBank distillation pipeline.
 *
 *   POST /api/distill
 *     Triggers a single RETRIEVE → JUDGE → DISTILL → CONSOLIDATE run
 *     over the current vault. Optional JSON body:
 *       { "since": "<iso8601>" }
 *     Returns the consolidation result (same shape as the SDK
 *     `memory_distill` MCP tool plus the in-file path).
 *
 *   GET /api/distill/patterns
 *     Reads the most recent `.bizar/distilled-patterns.json` and
 *     returns its `patterns` array (filtered by `?tier=` and
 *     `?promoted=` query params). 404 if the file does not yet
 *     exist (a distillation run hasn't happened).
 *
 *   GET /api/distill/status
 *     Returns a small status object:
 *       { file: "<path or null>", patternCount, promotedCount, byTier, generatedAt }
 *
 * Mounted at /api/distill/*. The route itself is `Router()`-style so
 * it composes with the rest of the v3 dashboard API.
 */

import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SERVER_ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const memoryConsolidator = await import(`${SERVER_ROOT}/memory-consolidator.mjs`).then((m) => m);

const { wrap } = await import('./_shared.mjs').then((m) => m);

/**
 * Build the distill router. `projectRoot` is the Bizar repo root — it
 * defaults to `process.cwd()` so that `bizar dashboard --dev` "just
 * works" when launched from inside a Bizar project.
 */
export function createDistillRouter({ projectRoot } = {}) {
  const root = projectRoot ?? process.cwd();
  const router = Router();

  // ---------------------------------------------------------------------
  // POST /api/distill — run the pipeline.
  // ---------------------------------------------------------------------
  router.post('/distill', wrap(async (req, res) => {
    const since = typeof req.body?.since === 'string' ? req.body.since : undefined;
    const result = memoryConsolidator.runConsolidation({ projectRoot: root, since });

    // Side-effect: write the machine-readable log so the GET route
    // can serve it without re-running the pipeline.
    const filePath = memoryConsolidator.writeDistilledPatternsFile(result, {
      projectRoot: root,
    });

    res.json({
      distilled: result.distilled,
      promoted: result.promoted,
      patterns: result.patterns,
      byTier: result.byTier,
      written: result.written,
      file: filePath,
    });
  }));

  // ---------------------------------------------------------------------
  // GET /api/distill/patterns — return the patterns.
  // ---------------------------------------------------------------------
  router.get('/distill/patterns', wrap(async (req, res) => {
    const fp = join(root, memoryConsolidator.DISTILLED_PATTERNS_FILE);
    if (!existsSync(fp)) {
      res.status(404).json({ error: 'not_distilled_yet', file: fp });
      return;
    }
    const raw = readFileSync(fp, 'utf-8');
    let payload;
    try { payload = JSON.parse(raw); }
    catch (e) { res.status(500).json({ error: 'corrupt_distill_file', message: String(e) }); return; }

    let patterns = Array.isArray(payload.patterns) ? payload.patterns : [];

    const tier = typeof req.query.tier === 'string' ? req.query.tier : null;
    if (tier) patterns = patterns.filter((p) => p.provenance_tier === tier);

    const promoted = req.query.promoted === 'true'
      ? true
      : req.query.promoted === 'false'
      ? false
      : null;
    if (promoted !== null) patterns = patterns.filter((p) => Boolean(p.promoted) === promoted);

    res.json({
      generatedAt: payload.generatedAt,
      byTier: payload.byTier,
      patterns,
      count: patterns.length,
    });
  }));

  // ---------------------------------------------------------------------
  // GET /api/distill/status — small status object.
  // ---------------------------------------------------------------------
  router.get('/distill/status', wrap(async (_req, res) => {
    const fp = join(root, memoryConsolidator.DISTILLED_PATTERNS_FILE);
    if (!existsSync(fp)) {
      res.json({ file: null, patternCount: 0, promotedCount: 0, byTier: null, generatedAt: null });
      return;
    }
    try {
      const payload = JSON.parse(readFileSync(fp, 'utf-8'));
      const patterns = Array.isArray(payload.patterns) ? payload.patterns : [];
      res.json({
        file: fp,
        patternCount: patterns.length,
        promotedCount: patterns.filter((p) => Boolean(p.promoted)).length,
        byTier: payload.byTier,
        generatedAt: payload.generatedAt,
      });
    } catch (e) {
      res.status(500).json({ error: 'corrupt_distill_file', message: String(e) });
    }
  }));

  return router;
}
