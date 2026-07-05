/**
 * src/server/routes/doctor.mjs
 *
 * v6.0.0 — Doctor REST surface for the dashboard Doctor page.
 *
 *   GET  /api/doctor         — full system snapshot (collectDiagnostics)
 *   GET  /api/doctor/health  — rolled-up status + per-group issues
 *   POST /api/doctor/check   — run a single named check
 *
 * Mounted at /doctor by api.mjs. Existing /api/diagnostics/* routes
 * (legacy v3) are untouched and keep using `diagnosticsStore.snapshot()`
 * / `.health()`.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';
import { collectDiagnostics, runCheck, health } from '../diagnostics-store.mjs';
import { info } from '../logger.mjs';

/**
 * @returns {import('express').Router}
 */
export function createDoctorRouter() {
  const router = Router();

  // GET /api/doctor — full snapshot. Bounded by the underlying
  // `collectDiagnostics()` (recentErrors is capped at 50, checks at
  // ~12 entries, agent file list at directory size).
  router.get('/', wrap(async (_req, res) => {
    const snap = await collectDiagnostics();
    info('doctor.snapshot', { status: snap.health.status, issues: snap.health.issues.length });
    res.json(snap);
  }));

  // GET /api/doctor/health — rolled-up health. Cheap; the Doctor
  // page polls this on every auto-refresh tick (30s) and only
  // fetches the full snapshot when the user clicks "Refresh".
  router.get('/health', wrap(async (_req, res) => {
    const result = await health();
    res.json(result);
  }));

  // POST /api/doctor/check — run a single named check.
  //
  // Body: `{ checkName: string }`.
  //
  // Returns the single check on success, or `{ status: 'fail',
  // message: 'unknown check', error: '...' }` with HTTP 404 when
  // the name doesn't match any registered check. The dashboard
  // surfaces the message inline so the operator can fix the
  // underlying issue without leaving the Doctor page.
  router.post('/check', wrap(async (req, res) => {
    const checkName = String(req.body?.checkName || '').trim();
    if (!checkName) {
      res.status(400).json({
        status: 'fail',
        name: '',
        message: 'checkName required',
        error: 'POST body must include { checkName: string }',
      });
      return;
    }
    const result = await runCheck(checkName);
    if (result.status === 'fail' && result.message === 'unknown check') {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  }));

  return router;
}