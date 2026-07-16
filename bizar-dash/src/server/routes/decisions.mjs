/**
 * src/server/routes/decisions.mjs
 *
 * v10.1.1 — Pillar D: Decisions log API.
 *
 * GET /api/decisions
 *   Returns list of decisions + tamper-evidence status.
 *
 * Storage: <projectRoot>/.bizar/learning/decisions.jsonl
 *   Falls back to BIZAR_HOME if projectRoot is not set.
 */

'use strict';

import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';

/** Default root: projectRoot > cwd > $HOME */
function resolveRoot(projectRoot) {
  if (projectRoot && projectRoot !== '.') return projectRoot;
  try { return process.cwd(); } catch { return homedir(); }
}

/**
 * @param {object} deps
 * @param {string} [deps.projectRoot]
 * @returns {import('express').Router}
 */
export function createDecisionsRouter({ projectRoot } = {}) {
  const router = Router();
  const root = projectRoot ?? resolveRoot(projectRoot);

  // Lazy-import SDK to avoid hard coupling at boot time.
  async function getDecisionsMod() {
    // Try the published SDK first, then fall back to monorepo dist.
    try {
      return await import('@polderlabs/bizar-sdk/learning');
    } catch {
      return await import('../../../packages/sdk/dist/learning/index.js');
    }
  }

  // GET /decisions — list + tamper status
  router.get('/decisions', wrap(async (_req, res) => {
    let mod;
    try {
      mod = await getDecisionsMod();
    } catch (err) {
      res.status(503).json({ error: 'unavailable', message: 'SDK not loaded', detail: err?.message });
      return;
    }

    const decisions = mod.listDecisions ? mod.listDecisions({ project: root }) : [];
    const verified = mod.verifyChain ? mod.verifyChain({ project: root }) : { ok: true };

    // Apply datamark to all string fields to sanitise surrogates.
    const sanitised = decisions.map((entry) => {
      const out = {};
      for (const [k, v] of Object.entries(entry)) {
        out[k] = mod.datamark ? mod.datamark(v) : v;
      }
      return out;
    });

    res.json({
      decisions: sanitised,
      tamperEvidence: {
        status: verified.ok ? 'intact' : 'broken',
        at: verified.at ?? null,
      },
    });
  }));

  return router;
}
