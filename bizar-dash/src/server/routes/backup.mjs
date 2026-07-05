/**
 * src/server/routes/backup.mjs
 *
 * v4.8.0 — Backup/restore REST surface.
 *
 * Endpoints:
 *   GET  /api/backup/list              — list available backups
 *   POST /api/backup/create           — create a new backup
 *   POST /api/backup/restore          — restore from a backup
 *   POST /api/backup/verify           — verify backup integrity
 *   DELETE /api/backup/:path           — delete a backup
 *   GET  /api/backup/manifest         — get manifest for a backup
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  verifyBackup,
  getManifest,
} from '../backup-store.mjs';

/**
 * @param {object} deps
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createBackupRouter({ projectRoot }) {
  const router = Router();

  // GET /api/backup/list
  router.get('/backup/list', wrap(async (_req, res) => {
    const backups = await listBackups();
    res.json({ ok: true, backups });
  }));

  // POST /api/backup/create
  router.post('/backup/create', wrap(async (req, res) => {
    const { label, includeProject } = req.body || {};
    const result = await createBackup({
      label: label || null,
      projectRoot: includeProject ? projectRoot : null,
    });
    res.json(result);
  }));

  // POST /api/backup/restore
  router.post('/backup/restore', wrap(async (req, res) => {
    const { backupPath, dryRun, conflictStrategy, includeProject } = req.body || {};
    if (!backupPath) {
      const err = new Error('backupPath is required');
      err.status = 400;
      err.code = 'bad_request';
      throw err;
    }
    const result = await restoreBackup({
      backupPath,
      dryRun: Boolean(dryRun),
      conflictStrategy: conflictStrategy || 'merge',
      projectRoot: includeProject ? projectRoot : null,
    });
    res.json(result);
  }));

  // POST /api/backup/verify
  router.post('/backup/verify', wrap(async (req, res) => {
    const { backupPath } = req.body || {};
    if (!backupPath) {
      const err = new Error('backupPath is required');
      err.status = 400;
      err.code = 'bad_request';
      throw err;
    }
    const result = await verifyBackup({ backupPath });
    res.json(result);
  }));

  // DELETE /api/backup/:path  (path is url-encoded)
  router.delete('/backup/:path', wrap(async (req, res) => {
    const { path: encoded } = req.params;
    const backupPath = decodeURIComponent(encoded);
    const result = await deleteBackup({ backupPath });
    if (!result.ok) {
      const err = new Error(result.error || 'Delete failed');
      err.status = 404;
      throw err;
    }
    res.json(result);
  }));

  // GET /api/backup/manifest
  router.get('/backup/manifest', wrap(async (req, res) => {
    const { backupPath } = req.query || {};
    if (!backupPath) {
      const err = new Error('backupPath query param is required');
      err.status = 400;
      err.code = 'bad_request';
      throw err;
    }
    const result = await getManifest({ backupPath });
    if (!result.ok) {
      const err = new Error(result.error || 'Manifest not found');
      err.status = 404;
      throw err;
    }
    res.json(result);
  }));

  return router;
}
