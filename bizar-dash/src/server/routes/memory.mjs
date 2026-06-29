/**
 * src/server/routes/memory.mjs
 *
 * REST surface for the Bizar Memory Service.
 *
 * Mounted at /api/memory/*.
 *
 * All note shapes returned are the "rich shape":
 * { relPath, frontmatter, body, raw, mtime, size, schemaValid }
 */

import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const memoryStore = await import(`${SERVER_ROOT}/memory-store.mjs`).then((m) => m);
const memorySchema = await import(`${SERVER_ROOT}/memory-schema.mjs`).then((m) => m);
const memorySecrets = await import(`${SERVER_ROOT}/memory-secrets.mjs`).then((m) => m);
const memoryGit = await import(`${SERVER_ROOT}/memory-git.mjs`).then((m) => m);
const { atomicWriteJson } = await import(`${SERVER_ROOT}/../../../cli/atomic.mjs`).then((m) => m);

const { wrap } = await import('./_shared.mjs').then((m) => m);

export function createMemoryRouter({ projectRoot }) {
  const router = Router();

  // GET /memory/status
  router.get('/memory/status', wrap(async (_req, res) => {
    const { loadConfig, resolveVault, listNotes } = memoryStore;
    const { isGitInstalled, status: gitStatus } = memoryGit;

    const { config, exists } = loadConfig(projectRoot);
    if (!exists) {
      res.json({ initialized: false, mode: null, projectId: null, vaultRoot: null });
      return;
    }

    const { vaultRoot, mode, projectId, branch } = resolveVault(projectRoot);
    const notes = existsSync(vaultRoot) ? listNotes(projectRoot) : [];

    let gitClean = null;
    let gitBranch = null;
    if ((mode === 'managed' || mode === 'linked') && existsSync(vaultRoot) && isGitInstalled()) {
      const gs = gitStatus(vaultRoot);
      gitClean = gs.clean;
      gitBranch = gs.branch;
    }

    const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
    const reindexMarker = join(cacheDir, 'last-reindex-attempt.json');
    let lastSecretScan = null;
    if (existsSync(reindexMarker)) {
      try {
        const data = JSON.parse(readFileSync(reindexMarker, 'utf8'));
        lastSecretScan = data.attemptedAt || null;
      } catch { /* ignore */ }
    }

    res.json({
      initialized: true,
      mode,
      projectId,
      vaultRoot,
      branch: gitBranch || branch,
      gitClean,
      noteCount: notes.length,
      lastSecretScan,
      lightrag: { enabled: false, stub: true },
    });
  }));

  // POST /memory/init
  router.post('/memory/init', wrap(async (_req, res) => {
    const { initVault } = memoryStore;
    const result = initVault(projectRoot);
    res.json({ ok: true, vaultRoot: result.vaultRoot, created: result.created });
  }));

  // GET /memory/config
  router.get('/memory/config', wrap(async (_req, res) => {
    const { loadConfig } = memoryStore;
    const { config, exists } = loadConfig(projectRoot);
    res.json({ exists, config });
  }));

  // POST /memory/config
  router.post('/memory/config', wrap(async (req, res) => {
    const { loadConfig, saveConfig } = memoryStore;
    const { config: newConfig, confirm } = req.body || {};
    if (!newConfig || typeof newConfig !== 'object') {
      res.status(400).json({ error: 'bad_request', message: 'body must include config object' });
      return;
    }

    const { config: existing } = loadConfig(projectRoot);

    // Changing mode requires confirm flag
    if (newConfig.mode && newConfig.mode !== existing.mode && !confirm) {
      res.status(400).json({
        error: 'confirm_required',
        message: 'changing mode requires confirm: true',
      });
      return;
    }

    const merged = { ...existing, ...newConfig };
    const result = saveConfig(projectRoot, merged);
    if (!result.ok) {
      res.status(500).json({ error: 'write_failed', message: result.error });
      return;
    }
    res.json({ ok: true, config: merged });
  }));

  // GET /memory/notes
  router.get('/memory/notes', wrap(async (_req, res) => {
    const { listNotes } = memoryStore;
    const notes = listNotes(projectRoot);
    res.json({ notes });
  }));

  // POST /memory/notes
  router.post('/memory/notes', wrap(async (req, res) => {
    const { writeNote } = memoryStore;
    const { path: relPath, frontmatter, body } = req.body || {};

    if (!relPath || typeof relPath !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    if (!relPath.endsWith('.md')) {
      res.status(400).json({ error: 'bad_request', message: 'path must end in .md' });
      return;
    }

    try {
      const note = writeNote(projectRoot, relPath, { frontmatter: frontmatter || {}, body: body || '' });
      res.status(201).json(note);
    } catch (err) {
      if (err.code === 'SCHEMA_VALIDATION_FAILED' || err.code === 'SECRET_DETECTED') {
        res.status(400).json({ error: err.code, message: err.message, findings: err.findings });
      } else {
        res.status(400).json({ error: 'bad_request', message: err.message });
      }
    }
  }));

  // GET /memory/notes/* — single note
  router.get('/memory/notes/*', wrap(async (req, res) => {
    const { readNote } = memoryStore;
    const relPath = req.params[0];
    const note = readNote(projectRoot, relPath);
    if (!note) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(note);
  }));

  // DELETE /memory/notes/*
  router.delete('/memory/notes/*', wrap(async (req, res) => {
    const { deleteNote } = memoryStore;
    const relPath = req.params[0];
    const ok = deleteNote(projectRoot, relPath);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  // GET /memory/search?q=...
  router.get('/memory/search', wrap(async (req, res) => {
    const { searchVault } = memoryStore;
    const q = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const results = searchVault(projectRoot, q, { limit });
    res.json({ query: q, results });
  }));

  // POST /memory/schema/validate — validate a single note
  router.post('/memory/schema/validate', wrap(async (req, res) => {
    const { readNote } = memoryStore;
    const { path: relPath } = req.body || {};
    if (!relPath) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    const note = readNote(projectRoot, relPath);
    if (!note) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = memorySchema.validateNote(note.frontmatter, note.body);
    res.json({ relPath, ...result });
  }));

  // POST /memory/secrets/scan — scan a single note
  router.post('/memory/secrets/scan', wrap(async (req, res) => {
    const { scanForSecrets } = memoryStore;
    const { path: relPath } = req.body || {};
    if (!relPath) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    const result = scanForSecrets(projectRoot, relPath);
    res.json({ relPath, ...result });
  }));

  // GET /memory/git/status
  router.get('/memory/git/status', wrap(async (_req, res) => {
    const { resolveVault } = memoryStore;
    const { isGitInstalled, status: gitStatus } = memoryGit;
    const { vaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.json({ ok: true, mode: 'local-only' });
      return;
    }

    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const gs = gitStatus(vaultRoot);
    res.json({ ok: true, mode, ...gs });
  }));

  // POST /memory/git/pull
  router.post('/memory/git/pull', wrap(async (_req, res) => {
    const { resolveVault } = memoryStore;
    const { pull, isGitInstalled } = memoryGit;
    const { vaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const result = pull(vaultRoot);
    if (!result.ok) {
      res.status(500).json({ error: 'pull_failed', message: result.error });
      return;
    }
    res.json({ ok: true, output: result.output });
  }));

  // POST /memory/git/commit — body { message? }
  router.post('/memory/git/commit', wrap(async (req, res) => {
    const { resolveVault } = memoryStore;
    const { commit: gitCommit, addAll, isGitInstalled } = memoryGit;
    const { vaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const addResult = addAll(vaultRoot);
    if (!addResult.ok) {
      res.status(500).json({ error: 'git_add_failed', message: addResult.error });
      return;
    }

    const message = req.body?.message || `[memory-sync] ${new Date().toISOString().replace(/T.*/, '')} vault sync`;
    const result = gitCommit(vaultRoot, message);
    if (!result.ok) {
      res.status(500).json({ error: 'commit_failed', message: result.error });
      return;
    }
    res.json({ ok: true, message });
  }));

  // POST /memory/git/push
  router.post('/memory/git/push', wrap(async (_req, res) => {
    const { resolveVault, loadConfig } = memoryStore;
    const { push: gitPush, isGitInstalled } = memoryGit;
    const { vaultRoot, mode, branch } = resolveVault(projectRoot);
    const { config } = loadConfig(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const result = gitPush(vaultRoot, { remote: config.gitRemote || 'origin', branch });
    if (!result.ok) {
      res.status(500).json({ error: 'push_failed', message: result.error });
      return;
    }
    res.json({ ok: true });
  }));

  // POST /memory/git/sync — full orchestrator
  router.post('/memory/git/sync', wrap(async (req, res) => {
    const { resolveVault, listNotes, validateAll, scanForSecrets } = memoryStore;
    const { pull, addAll, commit: gitCommit, push: gitPush, status: gitStatus, acquireLock, isGitInstalled } = memoryGit;
    const { vaultRoot, mode, branch } = resolveVault(projectRoot);
    const { config } = memoryStore.loadConfig(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const lock = acquireLock(vaultRoot);
    if (lock.error) {
      res.status(423).json({ error: 'locked', message: 'vault is locked by another process' });
      return;
    }

    let pushRequested = req.body?.push === true;

    try {
      // Pull
      const pullResult = pull(vaultRoot);
      if (!pullResult.ok) {
        // Non-fatal — may be up to date or have no remote
      }

      // Check status
      const gs = gitStatus(vaultRoot);
      if (gs.clean) {
        res.json({ ok: true, message: 'nothing to sync', clean: true });
        return;
      }

      // Validate changed notes
      const allNotes = listNotes(projectRoot);
      const changedSet = new Set([...gs.modified, ...gs.untracked]);
      const invalidNotes = allNotes.filter((n) => !n.schemaValid && changedSet.has(n.relPath));
      if (invalidNotes.length > 0) {
        res.status(400).json({
          error: 'schema_validation_failed',
          invalidNotes: invalidNotes.map((n) => ({ relPath: n.relPath })),
        });
        return;
      }

      // Secret scan changed files
      const allFindings = [];
      for (const relPath of changedSet) {
        const result = scanForSecrets(projectRoot, relPath);
        if (!result.safe) allFindings.push(...result.findings);
      }

      const highFindings = allFindings.filter((f) => f.severity === 'HIGH');
      if (highFindings.length > 0) {
        res.status(422).json({
          error: 'secrets_blocked',
          findings: highFindings,
        });
        return;
      }

      // Add all
      const addResult = addAll(vaultRoot);
      if (!addResult.ok) {
        res.status(500).json({ error: 'git_add_failed' });
        return;
      }

      // Commit
      const date = new Date().toISOString().replace(/T.*/, '');
      const summary = allNotes[0]?.relPath?.slice(0, 60) || 'vault sync';
      const message = `[memory-sync] ${date} ${summary}`;
      const commitResult = gitCommit(vaultRoot, message);
      if (!commitResult.ok) {
        res.status(500).json({ error: 'commit_failed', message: commitResult.error });
        return;
      }

      // Push if requested
      if (pushRequested && config.gitRemote) {
        const pushResult = gitPush(vaultRoot, { remote: config.gitRemote, branch });
        if (!pushResult.ok) {
          res.status(500).json({ error: 'push_failed', message: pushResult.error });
          return;
        }
      }

      res.json({
        ok: true,
        message,
        pushed: pushRequested && !!config.gitRemote,
        mediumFindings: allFindings.filter((f) => f.severity === 'MEDIUM'),
      });
    } finally {
      lock.release();
    }
  }));

  // GET /memory/conflicts
  router.get('/memory/conflicts', wrap(async (_req, res) => {
    const { listNotes, readNote } = memoryStore;
    const { vaultRoot } = memoryStore.resolveVault(projectRoot);
    const notes = listNotes(projectRoot);
    const conflicts = [];

    for (const note of notes) {
      if (note.frontmatter?.status === 'conflict') {
        conflicts.push({ relPath: note.relPath, reason: 'frontmatter: status=conflict' });
      }
    }

    // Check git conflict markers
    try {
      const { readFileSync: rf } = await import('node:fs');
      for (const note of notes) {
        const filePath = join(vaultRoot, note.relPath);
        const content = rf(filePath, 'utf8');
        if (/^<{7}\s|^={7}\s|>{7}\s/.test(content)) {
          conflicts.push({ relPath: note.relPath, reason: 'git conflict markers' });
        }
      }
    } catch { /* ignore */ }

    res.json({ conflicts });
  }));

  // POST /memory/reindex — STUB
  router.post('/memory/reindex', wrap(async (_req, res) => {
    const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const marker = join(cacheDir, 'last-reindex-attempt.json');
    const data = {
      attemptedAt: new Date().toISOString(),
      ok: false,
      reason: 'lightrag-not-implemented',
    };
    atomicWriteJson(marker, data);
    res.json({ ok: false, stub: true });
  }));

  // GET /memory/doctor
  router.get('/memory/doctor', wrap(async (_req, res) => {
    const { loadConfig, resolveVault, listNotes, validateAll } = memoryStore;
    const { isGitInstalled, status: gitStatus } = memoryGit;

    const checks = [];

    checks.push({
      name: 'git_binary',
      pass: isGitInstalled(),
      detail: isGitInstalled() ? 'present' : 'missing',
    });

    const { config, exists: configExists } = loadConfig(projectRoot);
    checks.push({ name: 'config_exists', pass: configExists, detail: configExists ? 'present' : 'missing' });

    if (configExists) {
      const { vaultRoot } = resolveVault(projectRoot);
      checks.push({ name: 'vault_exists', pass: existsSync(vaultRoot), detail: vaultRoot });

      if (config.mode === 'managed' || config.mode === 'linked') {
        if (existsSync(vaultRoot) && isGitInstalled()) {
          const gs = gitStatus(vaultRoot);
          checks.push({ name: 'git_repo', pass: gs.ok, detail: gs.ok ? 'yes' : 'no' });
        }
      }

      const notes = listNotes(projectRoot);
      checks.push({ name: 'note_count', pass: notes.length > 0, detail: `${notes.length} note(s)` });

      const validationResults = validateAll(projectRoot);
      checks.push({
        name: 'schema_valid',
        pass: validationResults.length === 0,
        detail: validationResults.length === 0 ? 'all valid' : `${validationResults.length} invalid`,
      });
    }

    const allPassed = checks.every((c) => c.pass);
    res.json({ ok: allPassed, checks });
  }));

  return router;
}
