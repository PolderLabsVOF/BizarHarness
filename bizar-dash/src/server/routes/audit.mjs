/**
 * src/server/routes/audit.mjs
 *
 * GET /api/audit — returns latest harness audit score + diff vs prior.
 *
 * Reads .harness/audit/latest.json (written by `node scripts/audit.mjs --write`).
 * Returns the full audit result plus a `diff` object showing which categories
 * changed score vs the prior run (if any).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createAuditRouter({ projectRoot }) {
  const router = express.Router();
  const LATEST = join(projectRoot, '.harness', 'audit', 'latest.json');

  router.get('/audit', wrap(async (_req, res) => {
    if (!existsSync(LATEST)) {
      res.status(404).json({
        error: 'not_ready',
        message: 'No audit run yet. Run `node scripts/audit.mjs --write` first.',
      });
      return;
    }

    let latest;
    try {
      latest = JSON.parse(readFileSync(LATEST, 'utf8'));
    } catch (err) {
      res.status(500).json({ error: 'parse_error', message: err.message });
      return;
    }

    // Compute diff vs the run before last (if we have history)
    /** @type {Record<string, {current: number, prior: number, delta: number} | null>} */
    const diff = {};
    const priorPath = join(projectRoot, '.harness', 'audit', 'previous.json');

    if (existsSync(priorPath)) {
      try {
        const prior = JSON.parse(readFileSync(priorPath, 'utf8'));
        const priorScores = prior.scores ?? {};
        for (const [key, weight] of Object.entries(latest.weights ?? {})) {
          const current = latest.scores?.[key] ?? 0;
          const priorScore = priorScores[key] ?? 0;
          if (current !== priorScore) {
            diff[key] = { current, prior: priorScore, delta: current - priorScore };
          }
        }
        // Also diff total
        const currentTotal = latest.total ?? 0;
        const priorTotal = prior.total ?? 0;
        if (currentTotal !== priorTotal) {
          diff._total = { current: currentTotal, prior: priorTotal, delta: currentTotal - priorTotal };
        }
      } catch {
        // prior file unreadable — no diff
      }
    }

    res.json({
      latest,
      diff,
      _links: {
        run: 'node scripts/audit.mjs --write',
        latestPath: LATEST,
      },
    });
  }));

  return router;
}
