/**
 * src/server/routes/diagnostics.mjs
 *
 * /api/diagnostics                       — full snapshot
 * /api/diagnostics/health                — health check
 * /api/diagnostics/logs                  — tail of the active log file
 */
import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnosticsStore } from '../diagnostics-store.mjs';
import { BIZAR_HOME, wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createDiagnosticsRouter() {
  const router = Router();

  router.get('/diagnostics', wrap(async (_req, res) => {
    res.json(diagnosticsStore.snapshot());
  }));

  router.get('/diagnostics/health', wrap(async (_req, res) => {
    res.json(diagnosticsStore.health());
  }));

  router.get('/diagnostics/logs', wrap(async (req, res) => {
    const tail = Math.min(Number(req.query.tail) || 100, 5000);
    const serviceLog = join(BIZAR_HOME, 'service.log');
    const dashboardLog = join(BIZAR_HOME, 'dashboard.log');
    // Prefer service.log, fall back to dashboard.log
    const logFile = existsSync(serviceLog) ? serviceLog : existsSync(dashboardLog) ? dashboardLog : null;
    if (!logFile) {
      res.json({ lines: [], file: null, total: 0 });
      return;
    }
    try {
      const text = readFileSync(logFile, 'utf8');
      const allLines = text.split(/\r?\n/).filter(Boolean);
      const lines = allLines.slice(-tail);
      res.json({ lines, file: logFile, total: allLines.length });
    } catch (err) {
      res.status(500).json({ error: 'read_failed', message: err.message });
    }
  }));

  return router;
}