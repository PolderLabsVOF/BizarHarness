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
import { join, dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { warn as logWarn } from '../logger.mjs';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const memoryStore = await import(`${SERVER_ROOT}/memory-store.mjs`).then((m) => m);
const memorySchema = await import(`${SERVER_ROOT}/memory-schema.mjs`).then((m) => m);
const memorySecrets = await import(`${SERVER_ROOT}/memory-secrets.mjs`).then((m) => m);
const memoryGit = await import(`${SERVER_ROOT}/memory-git.mjs`).then((m) => m);
const { atomicWriteJson } = await import(`${SERVER_ROOT}/../../../cli/atomic.mjs`).then((m) => m);

const { wrap } = await import('./_shared.mjs').then((m) => m);

// Lazy import to avoid circular dependency with memory-lightrag.mjs
async function getMemoryLightrag() {
  return import(`${SERVER_ROOT}/memory-lightrag.mjs`).then((m) => m);
}

/**
 * Redact apiKey in the lightrag block before sending to the UI.
 * apiKey '***' means it was already redacted.
 * Any non-empty string that is not '***' is replaced with '***'.
 */
function redactLightRAGConfig(config) {
  if (!config || !config.lightrag) return config;
  const { lightrag, ...rest } = config;
  const redactedLightrag = {
    ...lightrag,
    apiKey: lightrag.apiKey && lightrag.apiKey !== '' && lightrag.apiKey !== '***'
      ? '***'
      : lightrag.apiKey || undefined,
  };
  return { ...rest, lightrag: redactedLightrag };
}

export function createMemoryRouter({ projectRoot }) {
  // Auto-create the default vault and git-init if needed — idempotent.
  memoryStore.ensureVaultExists();

  const router = Router();

  // GET /memory/status
  router.get('/memory/status', wrap(async (_req, res) => {
    const { loadConfig, resolveVault, listNotes } = memoryStore;
    const { isGitInstalled, status: gitStatus } = memoryGit;

    const { config, exists } = loadConfig(projectRoot);
    if (!exists) {
      res.json({ initialized: false, mode: null, projectId: null, vaultRoot: null, projectVaultRoot: null });
      return;
    }

    // v6.x — vaultRoot is now the GENERAL vault root (e.g. ~/.bizar_memory).
    // projectVaultRoot is the project-specific subdirectory for note storage.
    const { vaultRoot, projectVaultRoot, mode, projectId, branch } = resolveVault(projectRoot);
    const notes = existsSync(projectVaultRoot) ? listNotes(projectRoot) : [];

    let gitClean = null;
    let gitBranch = null;
    if ((mode === 'managed' || mode === 'linked') && existsSync(projectVaultRoot) && isGitInstalled()) {
      const gs = gitStatus(projectVaultRoot);
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
      } catch (err) {
        logWarn('swallowed in memory reindex marker read', { module: 'memory', err: err.message });
      }
    }

    res.json({
      initialized: true,
      mode,
      projectId,
      vaultRoot, // v6.x — general vault root (e.g. ~/.bizar_memory)
      projectVaultRoot, // v6.x — project-specific subdirectory for managed/linked mode
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

  // POST /memory/link — clone or copy a remote/local path into the vault.
  // v6.0.0 — wraps `cli/commands/memory.mjs:link` so the dash can offer
  // the same "link an existing repo" UX as the CLI without going through
  // the bashrc patcher. Body: { url, target?, force? }
  router.post('/memory/link', wrap(async (req, res) => {
    const { url, target, force } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }
    // Shell out to the CLI runner so we reuse the exact same code path.
    const { runMemory } = await import('../../../cli/memory.mjs').catch(() => ({ runMemory: null }));
    if (!runMemory) {
      return res.status(500).json({ ok: false, error: 'memory CLI module not available' });
    }
    try {
      const args = [];
      if (target) args.push('--target', target);
      if (force) args.push('--force');
      args.push(url);
      // Capture stdout/stderr by intercepting process writes.
      const chunks = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      const origErrWrite = process.stderr.write.bind(process.stderr);
      process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
      process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
      let exitCode = 0;
      try {
        await runMemory('link', args, { wantJson: false });
      } catch (err) {
        exitCode = err && err.message && err.message.startsWith('__exit__:')
          ? parseInt(err.message.split(':')[1], 10)
          : 1;
      } finally {
        process.stdout.write = origWrite;
        process.stderr.write = origErrWrite;
      }
      res.json({ ok: exitCode === 0, output: chunks.join(''), exitCode });
    } catch (err) {
      res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }));

  // GET /memory/config
  router.get('/memory/config', wrap(async (_req, res) => {
    const { loadConfig } = memoryStore;
    const { config, exists } = loadConfig(projectRoot);
    res.json({ exists, config: redactLightRAGConfig(config) });
  }));

  // POST /memory/config
  router.post('/memory/config', wrap(async (req, res) => {
    const { loadConfig, saveConfig } = memoryStore;

    // ── Patch mode: merge only the lightrag block ──────────────────────────
    if (req.body && req.body.patch === true) {
      const { writeLightRAGConfig } = await getMemoryLightrag();
      const { lightrag, patch: _patch, ...restPatch } = req.body;

      // Validate no unexpected top-level fields in patch
      if (Object.keys(restPatch).length > 0) {
        res.status(400).json({ error: 'bad_request', message: 'patch mode only accepts a "lightrag" field' });
        return;
      }
      if (!lightrag || typeof lightrag !== 'object') {
        res.status(400).json({ error: 'bad_request', message: 'patch mode requires a "lightrag" object' });
        return;
      }

      const result = writeLightRAGConfig(projectRoot, lightrag);
      if (!result.ok) {
        res.status(400).json({ error: 'validation_error', message: result.error });
        return;
      }

      // Return full config with redacted lightrag block
      const { config: full } = loadConfig(projectRoot);
      const redacted = redactLightRAGConfig(full);
      res.json({ ok: true, config: redacted });
      return;
    }

    // ── Full replace mode (existing behaviour) ───────────────────────────────
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
    const redacted = redactLightRAGConfig(merged);
    res.json({ ok: true, config: redacted });
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
      // v5.x — auto-reindex the written note in the background (fire-and-forget).
      getMemoryLightrag().then((m) => {
        void m.reindexSingleNote(projectRoot, relPath).catch(() => {});
      });
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
    const { projectVaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.json({ ok: true, mode: 'local-only' });
      return;
    }

    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const gs = gitStatus(projectVaultRoot);
    res.json({ ok: true, mode, ...gs });
  }));

  // POST /memory/git/pull
  // v5.5.2 — Returns 200 with { ok: false } for operational failures
  // (vault missing, git missing, pull errors). Only returns 503 for truly
  // catastrophic failures. This allows the UI to show a clear message rather
  // than treating a failed pull as a server-internal error.
  router.post('/memory/git/pull', wrap(async (_req, res) => {
    const { resolveVault } = memoryStore;
    const { pull, isGitInstalled } = memoryGit;
    const { projectVaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.json({ ok: false, error: 'local_only_mode', message: 'pull is not available in local-only mode' });
      return;
    }

    if (!existsSync(projectVaultRoot)) {
      res.json({
        ok: false,
        error: 'vault_not_found',
        message: `Vault directory not found at ${projectVaultRoot}. Run \`bizar memory init\` to create it.`,
      });
      return;
    }

    if (!isGitInstalled()) {
      res.json({
        ok: false,
        error: 'git_not_installed',
        message: 'git is not installed or not found on PATH. Install git to enable sync.',
      });
      return;
    }

    const result = pull(projectVaultRoot);
    if (!result.ok) {
      res.json({ ok: false, error: 'pull_failed', message: result.error });
      return;
    }
    res.json({ ok: true, output: result.output });
  }));

  // POST /memory/git/commit — body { message? }
  router.post('/memory/git/commit', wrap(async (req, res) => {
    const { resolveVault } = memoryStore;
    const { commit: gitCommit, addAll, isGitInstalled } = memoryGit;
    const { projectVaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const addResult = addAll(projectVaultRoot);
    if (!addResult.ok) {
      res.status(500).json({ error: 'git_add_failed', message: addResult.error });
      return;
    }

    const message = req.body?.message || `[memory-sync] ${new Date().toISOString().replace(/T.*/, '')} vault sync`;
    const result = gitCommit(projectVaultRoot, message);
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
    const { projectVaultRoot, mode, branch } = resolveVault(projectRoot);
    const { config } = loadConfig(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const result = gitPush(projectVaultRoot, { remote: config.gitRemote || 'origin', branch });
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
    const { projectVaultRoot, mode, branch } = resolveVault(projectRoot);
    const { config } = memoryStore.loadConfig(projectRoot);

    if (mode === 'local-only') {
      res.status(400).json({ error: 'local_only_mode' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    const lock = acquireLock(projectVaultRoot);
    if (lock.error) {
      res.status(423).json({ error: 'locked', message: 'vault is locked by another process' });
      return;
    }

    let pushRequested = req.body?.push === true;

    try {
      // Pull
      const pullResult = pull(projectVaultRoot);
      if (!pullResult.ok) {
        // Non-fatal — may be up to date or have no remote
      }

      // Check status
      const gs = gitStatus(projectVaultRoot);
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
      const addResult = addAll(projectVaultRoot);
      if (!addResult.ok) {
        res.status(500).json({ error: 'git_add_failed' });
        return;
      }

      // Commit
      const date = new Date().toISOString().replace(/T.*/, '');
      const summary = allNotes[0]?.relPath?.slice(0, 60) || 'vault sync';
      const message = `[memory-sync] ${date} ${summary}`;
      const commitResult = gitCommit(projectVaultRoot, message);
      if (!commitResult.ok) {
        res.status(500).json({ error: 'commit_failed', message: commitResult.error });
        return;
      }

      // Push if requested
      if (pushRequested && config.gitRemote) {
        const pushResult = gitPush(projectVaultRoot, { remote: config.gitRemote, branch });
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
    const { projectVaultRoot } = memoryStore.resolveVault(projectRoot);
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
        const filePath = join(projectVaultRoot, note.relPath);
        const content = rf(filePath, 'utf8');
        if (/^<{7}\s|^={7}\s|>{7}\s/.test(content)) {
          conflicts.push({ relPath: note.relPath, reason: 'git conflict markers' });
        }
      }
    } catch (err) {
      logWarn('swallowed in memory conflict scan', { module: 'memory', err: err.message });
    }

    res.json({ conflicts });
  }));

  // POST /memory/reindex — v4.1.0 real LightRAG population
  router.post('/memory/reindex', wrap(async (_req, res) => {
    const { reindexVault } = memoryStore;
    const result = await reindexVault(projectRoot, {});
    if (!result.ok && result.inserted === 0) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  }));

  // GET /memory/query?q=...&topK=10 — merged lexical + semantic search
  router.get('/memory/query', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.status(400).json({ error: 'q required' });
      return;
    }
    const topK = Math.min(parseInt(req.query.topK, 10) || 10, 50);
    const { searchVault, queryLightRAG } = memoryStore;
    const lexical = searchVault(projectRoot, q, { limit: topK });
    let semantic = null;
    const startedAt = Date.now();
    try {
      semantic = await queryLightRAG(projectRoot, q, { topK });
    } catch (err) {
      semantic = { ok: false, error: err.message };
    }
    // Record the query duration for the LightRAG stats panel. Best-effort.
    try {
      const { recordQuery } = await getMemoryLightrag();
      recordQuery(projectRoot, Date.now() - startedAt);
    } catch (err) {
      logWarn('swallowed in memory recordQuery', { module: 'memory', err: err.message });
    }
    res.json({ ok: true, q, lexical, semantic });
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

  // GET /memory/lightrag/status
  router.get('/memory/lightrag/status', wrap(async (_req, res) => {
    const { resolveLightRAGConfig, isRunning } = await getMemoryLightrag();
    const cfg = resolveLightRAGConfig(projectRoot);
    const pidFile = join(cfg.workingDir, 'lightrag.pid');

    // Inline readPidAlive logic
    let pid = null;
    let alive = false;
    if (existsSync(pidFile)) {
      try {
        pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            alive = true;
          } catch {
            alive = false;
          }
        } else {
          pid = null;
        }
      } catch {
        pid = null;
      }
    }

    const running = alive && (await isRunning(cfg));
    const logFile = join(cfg.workingDir, 'lightrag.log');
    const logTail = [];

    if (existsSync(logFile)) {
      try {
        const content = readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        logTail.push(...lines.slice(-30));
      } catch (err) {
        logWarn('swallowed in memory log tail', { module: 'memory', err: err.message });
      }
    }

    let lastError = null;
    if (!running && pid !== null) {
      lastError = 'process not responding to health checks';
    }

    res.json({
      running,
      pid: running ? pid : null,
      host: cfg.host,
      port: cfg.port,
      llmBinding: cfg.llmBinding,
      embeddingBinding: cfg.embeddingBinding,
      llmModel: cfg.llmModel,
      embeddingModel: cfg.embeddingModel,
      lastError,
      logTail,
    });
  }));

  // POST /memory/lightrag/start
  router.post('/memory/lightrag/start', wrap(async (_req, res) => {
    const { resolveLightRAGConfig, startServer } = await getMemoryLightrag();
    const cfg = resolveLightRAGConfig(projectRoot);
    const result = await startServer(cfg, {});
    res.json(result);
  }));

  // POST /memory/lightrag/stop
  router.post('/memory/lightrag/stop', wrap(async (_req, res) => {
    const { resolveLightRAGConfig, stopServer } = await getMemoryLightrag();
    const cfg = resolveLightRAGConfig(projectRoot);
    const result = await stopServer(cfg, {});
    res.json(result);
  }));

  // GET /memory/lightrag/log
  router.get('/memory/lightrag/log', wrap(async (_req, res) => {
    const { resolveLightRAGConfig } = await getMemoryLightrag();
    const cfg = resolveLightRAGConfig(projectRoot);
    const logFile = join(cfg.workingDir, 'lightrag.log');
    if (!existsSync(logFile)) {
      res.json({ lines: [] });
      return;
    }
    try {
      const content = readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      res.json({ lines: lines.slice(-200) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // ── v4.6.0 Global memory-config surface ─────────────────────────────────
  //
  // A second config file at `~/.config/bizar/memory-config.json` holds
  // operator-facing settings that aren't tied to a single project —
  // e.g. the global default LightRAG URL, the global obsidian vault
  // path, and git push defaults. The Settings view (handled by the
  // sibling thor-settings agent) reads + writes this file via these
  // endpoints.
  //
  // Distinct from the per-project `.bizar/memory.json` (the existing
  // /memory/config surfaces that). We use a separate path to keep the
  // two systems cleanly separated.

  const GLOBAL_MEMORY_CONFIG_PATH = join(
    process.env.HOME || '/tmp',
    '.config',
    'bizar',
    'memory-config.json',
  );

  function loadGlobalMemoryConfig() {
    try {
      if (!existsSync(GLOBAL_MEMORY_CONFIG_PATH)) {
        return {
          exists: false,
          config: {
            lightrag: { enabled: false, url: 'http://127.0.0.1:9621', llm: '', embedding: '' },
            obsidian: { vaultPath: '', syncInterval: 300 },
            git: { repoPath: '', remoteUrl: '', branch: 'main', autoSync: false },
          },
        };
      }
      const raw = JSON.parse(readFileSync(GLOBAL_MEMORY_CONFIG_PATH, 'utf8'));
      return { exists: true, config: raw };
    } catch {
      return {
        exists: false,
        error: 'corrupt_json',
        config: {
          lightrag: { enabled: false, url: 'http://127.0.0.1:9621', llm: '', embedding: '' },
          obsidian: { vaultPath: '', syncInterval: 300 },
          git: { repoPath: '', remoteUrl: '', branch: 'main', autoSync: false },
        },
      };
    }
  }

  function saveGlobalMemoryConfig(config) {
    const dir = dirname(GLOBAL_MEMORY_CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    atomicWriteJson(GLOBAL_MEMORY_CONFIG_PATH, config);
  }

  // GET /memory/config/global — grouped shape (lightrag/obsidian/git).
  router.get('/memory/config/global', wrap(async (_req, res) => {
    const { exists, config, error } = loadGlobalMemoryConfig();
    res.json({
      exists,
      path: GLOBAL_MEMORY_CONFIG_PATH,
      config,
      ...(error ? { error } : {}),
    });
  }));

  // PUT /memory/config/global — partial update. Validates each block
  // and merges on top of the existing config.
  router.put('/memory/config/global', wrap(async (req, res) => {
    const body = req.body || {};
    const { exists, config: existing } = loadGlobalMemoryConfig();

    // Light validation — no zod import (keep surface small). Each
    // block is shallow-merged; if a block is present, we shallow-merge
    // its top-level fields, rejecting unknown top-level keys.
    const next = JSON.parse(JSON.stringify(existing));

    const VALID_TOP_KEYS = new Set(['lightrag', 'obsidian', 'git']);
    const EXTRA_KEYS = Object.keys(body).filter((k) => !VALID_TOP_KEYS.has(k));
    if (EXTRA_KEYS.length > 0) {
      res.status(400).json({
        error: 'bad_request',
        message: `unknown top-level keys: ${EXTRA_KEYS.join(', ')}`,
      });
      return;
    }

    if (body.lightrag !== undefined) {
      if (typeof body.lightrag !== 'object' || body.lightrag === null || Array.isArray(body.lightrag)) {
        res.status(400).json({ error: 'bad_request', message: 'lightrag must be an object' });
        return;
      }
      const l = body.lightrag;
      if ('enabled' in l && typeof l.enabled !== 'boolean') {
        res.status(400).json({ error: 'bad_request', message: 'lightrag.enabled must be boolean' });
        return;
      }
      if ('url' in l && typeof l.url !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'lightrag.url must be a string' });
        return;
      }
      if ('llm' in l && typeof l.llm !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'lightrag.llm must be a string' });
        return;
      }
      if ('embedding' in l && typeof l.embedding !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'lightrag.embedding must be a string' });
        return;
      }
      next.lightrag = { ...next.lightrag, ...l };
    }

    if (body.obsidian !== undefined) {
      if (typeof body.obsidian !== 'object' || body.obsidian === null || Array.isArray(body.obsidian)) {
        res.status(400).json({ error: 'bad_request', message: 'obsidian must be an object' });
        return;
      }
      const o = body.obsidian;
      if ('vaultPath' in o && typeof o.vaultPath !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'obsidian.vaultPath must be a string' });
        return;
      }
      if ('syncInterval' in o) {
        const n = Number(o.syncInterval);
        if (!Number.isFinite(n) || n < 0 || n > 86400 * 30) {
          res.status(400).json({ error: 'bad_request', message: 'obsidian.syncInterval must be 0..2592000 seconds' });
          return;
        }
        next.obsidian.syncInterval = n;
      }
      if ('vaultPath' in o) next.obsidian.vaultPath = o.vaultPath;
    }

    if (body.git !== undefined) {
      if (typeof body.git !== 'object' || body.git === null || Array.isArray(body.git)) {
        res.status(400).json({ error: 'bad_request', message: 'git must be an object' });
        return;
      }
      const g = body.git;
      if ('repoPath' in g && typeof g.repoPath !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'git.repoPath must be a string' });
        return;
      }
      if ('remoteUrl' in g && typeof g.remoteUrl !== 'string') {
        res.status(400).json({ error: 'bad_request', message: 'git.remoteUrl must be a string' });
        return;
      }
      if ('branch' in g) {
        if (typeof g.branch !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(g.branch)) {
          res.status(400).json({ error: 'bad_request', message: 'git.branch must be a valid git ref name' });
          return;
        }
        next.git.branch = g.branch;
      }
      if ('autoSync' in g && typeof g.autoSync !== 'boolean') {
        res.status(400).json({ error: 'bad_request', message: 'git.autoSync must be boolean' });
        return;
      }
      if ('repoPath' in g) next.git.repoPath = g.repoPath;
      if ('remoteUrl' in g) next.git.remoteUrl = g.remoteUrl;
      if ('autoSync' in g) next.git.autoSync = g.autoSync;
    }

    try {
      saveGlobalMemoryConfig(next);
    } catch (err) {
      res.status(500).json({ error: 'write_failed', message: err.message });
      return;
    }
    res.json({ ok: true, exists: true, path: GLOBAL_MEMORY_CONFIG_PATH, config: next });
  }));

  // POST /memory/config/vault — v6.x — update the vault root path.
  // Accepts { vaultRoot: string }
  // Persists to ~/.config/bizar/memory-config.json so it survives restarts,
  // and sets process.env.BIZAR_MEMORY_VAULT for the current process.
  router.post('/memory/config/vault', wrap(async (req, res) => {
    const { vaultRoot: newVaultRoot } = req.body || {};
    const trimmed = typeof newVaultRoot === 'string' ? newVaultRoot.trim() : '';
    if (!trimmed || typeof newVaultRoot !== 'string') {
      res.status(400).json({ error: 'vaultRoot required' });
      return;
    }

    // Expand ~ to home directory
    const expanded = trimmed.startsWith('~')
      ? join(homedir(), trimmed.slice(1))
      : trimmed;
    const resolved = pathResolve(expanded);

    // Validate: try to create the directory if it doesn't exist
    try {
      mkdirSync(resolved, { recursive: true, mode: 0o700 });
    } catch (err) {
      res.status(400).json({ error: `Cannot create vault at ${resolved}: ${err.message}` });
      return;
    }

    // Persist to the global memory config so it survives restarts.
    // Also update process.env so the change takes effect immediately.
    process.env.BIZAR_MEMORY_VAULT = resolved;
    const { config: existing } = loadGlobalMemoryConfig();
    const next = JSON.parse(JSON.stringify(existing));
    next.git = next.git || {};
    next.git.repoPath = resolved; // v6.x — also set git.repoPath to the vault root
    try {
      saveGlobalMemoryConfig(next);
    } catch (err) {
      res.status(500).json({ error: 'write_failed', message: err.message });
      return;
    }

    res.json({ ok: true, vaultRoot: resolved });
  }));

  // POST /memory/test-git — test the configured git repo. Returns:
  //   { ok: bool, checks: [...], message?: string }
  // Steps performed:
  //   1. Path exists?
  //   2. Is a directory?
  //   3. Is a valid git repo (has .git/)?
  //   4. (Optional) Has a configured remote?
  //   5. (Optional) Can we push (skipped unless ?push=1)?
  // v6.x — falls back to the general vault root (BIZAR_MEMORY_VAULT or ~/.bizar_memory)
  // when git.repoPath is not explicitly configured.
  router.post('/memory/test-git', wrap(async (req, res) => {
    const { config } = loadGlobalMemoryConfig();
    // v6.x: fall back to the general vault root when not explicitly set
    const configuredPath = config?.git?.repoPath || '';
    const repoPath = configuredPath || memoryStore.currentVault();
    const remoteUrl = config?.git?.remoteUrl || '';
    const wantPush = req.query.push === '1' || req.body?.push === true;

    const checks = [];
    // Only fail if the fallback path also doesn't exist
    if (!configuredPath && !existsSync(repoPath)) {
      checks.push({ name: 'repo_path_set', pass: false, detail: `git.repoPath not set — vault at ${repoPath} does not exist yet` });
      res.json({ ok: false, checks, message: 'repo path not configured' });
      return;
    }

    checks.push({
      name: 'repo_path_exists',
      pass: existsSync(repoPath),
      detail: existsSync(repoPath) ? repoPath : `${repoPath} does not exist`,
    });

    let isGit = false;
    let isDir = false;
    try {
      const s = statSync(repoPath);
      isDir = s.isDirectory();
      checks.push({ name: 'repo_is_directory', pass: isDir, detail: isDir ? 'yes' : 'not a directory' });
    } catch (err) {
      checks.push({ name: 'repo_is_directory', pass: false, detail: err.message });
    }

    if (isDir) {
      isGit = existsSync(join(repoPath, '.git'));
      checks.push({ name: 'is_git_repo', pass: isGit, detail: isGit ? 'yes' : 'no .git/ directory' });
    } else {
      checks.push({ name: 'is_git_repo', pass: false, detail: 'skipped (not a directory)' });
    }

    if (remoteUrl) {
      checks.push({ name: 'remote_url_set', pass: true, detail: remoteUrl });
    } else {
      checks.push({ name: 'remote_url_set', pass: false, detail: 'no remote configured' });
    }

    if (wantPush && isGit && remoteUrl) {
      try {
        const out = execFileSync('git', ['ls-remote', '--heads', remoteUrl], { timeout: 5000 }).toString();
        checks.push({ name: 'remote_reachable', pass: true, detail: `${out.split('\n').filter(Boolean).length} heads` });
      } catch (err) {
        checks.push({ name: 'remote_reachable', pass: false, detail: err.message });
      }
    }

    const ok = checks.every((c) => c.pass);
    res.json({
      ok,
      checks,
      message: ok ? 'git config looks healthy' : 'one or more checks failed',
    });
  }));

  // ── v4.7.0 — Memory tab endpoints ─────────────────────────────────────────
  //
  // These endpoints are the canonical surface for the dedicated Memory
  // tab. They sit alongside the per-resource endpoints above and return
  // the shapes the React panels expect (always objects, never arrays).

  // GET /memory/health — composite health score (0..100) + breakdown.
  // Components:
  //   - vaultExists      (vault dir on disk)
  //   - vaultWritable    (can write a temp file and unlink it)
  //   - gitClean         (mode is managed/linked AND `git status` is clean)
  //   - lightragRunning  (server up + health check ok)
  //   - schemaValid      (no validation errors across the vault)
  //   - secretsClean     (no HIGH-severity secret findings)
  router.get('/memory/health', wrap(async (_req, res) => {
    const { resolveVault, loadConfig, listNotes, validateAll, scanForSecrets } = memoryStore;
    const { isGitInstalled, status: gitStatus } = memoryGit;

    const checks = [];
    let score = 0;

    const { exists, config } = loadConfig(projectRoot);
    if (!exists) {
      res.json({
        score: 0,
        status: 'unconfigured',
        checks: [{ name: 'config', pass: false, detail: 'memory not initialised' }],
        message: 'memory not initialised — run `bizar memory init`',
      });
      return;
    }

    const { vaultRoot, projectVaultRoot, mode } = resolveVault(projectRoot);
    // v5.5.2 — Check the GENERAL vault root (vaultRoot), not the project
    // subdirectory (projectVaultRoot). The general vault exists at
    // ~/.bizar_memory if the user has ever run `bizar memory init` or if
    // auto-migration ran. The project subdirectory
    // (~/.bizar_memory/projects/<projectId>/) is only created lazily on
    // first write.
    const generalVaultExists = existsSync(vaultRoot);
    const projectVaultExists = existsSync(projectVaultRoot);
    checks.push({
      name: 'vault_exists',
      pass: generalVaultExists,
      detail: generalVaultExists
        ? projectVaultExists
          ? vaultRoot
          : `${vaultRoot} (project subdirectory not yet created — click Initialize)`
        : `vault directory missing — run \`bizar memory init\` to create it`,
    });
    if (generalVaultExists) score += 20;

    // Writable?
    // v5.5.2 — Write to vaultRoot (the general vault), not projectVaultRoot,
    // since the project subdirectory may not exist yet.
    let writable = false;
    if (generalVaultExists) {
      try {
        const probe = join(vaultRoot, '.health-probe.tmp');
        writeFileSync(probe, 'ok', 'utf8');
        try {
          const { unlinkSync } = await import('node:fs');
          unlinkSync(probe);
        } catch { /* best effort */ }
        writable = true;
      } catch {
        writable = false;
      }
    }
    checks.push({
      name: 'vault_writable',
      pass: writable,
      detail: writable ? 'yes' : generalVaultExists ? 'vault root not writable' : 'vault directory missing',
    });
    if (writable) score += 10;

    // Git clean?
    // v5.5.2 — In managed/linked mode, the git repo lives at vaultRoot, not
    // projectVaultRoot. Use vaultRoot for git status; projectVaultRoot is only
    // a subdirectory of the repo.
    let gitClean = null;
    if ((mode === 'managed' || mode === 'linked') && generalVaultExists && isGitInstalled()) {
      const gs = gitStatus(vaultRoot);
      gitClean = gs.clean;
      checks.push({
        name: 'git_clean',
        pass: gs.clean,
        detail: gs.clean ? 'working tree clean' : `${(gs.modified?.length || 0) + (gs.untracked?.length || 0)} pending`,
      });
      if (gs.clean) score += 20;
    } else if (mode === 'local-only') {
      checks.push({ name: 'git_clean', pass: true, detail: 'local-only mode (no git)' });
      // local-only mode shouldn't penalise — count as clean
      score += 20;
    } else {
      checks.push({ name: 'git_clean', pass: false, detail: 'git not installed or vault missing' });
    }

    // LightRAG running?
    let lightragRunning = false;
    try {
      const { resolveLightRAGConfig, isRunning } = await getMemoryLightrag();
      const cfg = resolveLightRAGConfig(projectRoot);
      lightragRunning = await isRunning(cfg);
    } catch {
      lightragRunning = false;
    }
    checks.push({
      name: 'lightrag_running',
      pass: lightragRunning,
      detail: lightragRunning ? 'yes' : 'stopped or disabled',
    });
    if (lightragRunning) score += 20;

    // Schema valid?
    let invalidCount = 0;
    if (generalVaultExists) {
      const validationResults = validateAll(projectRoot);
      invalidCount = validationResults.length;
    }
    checks.push({
      name: 'schema_valid',
      pass: invalidCount === 0,
      detail: invalidCount === 0 ? 'all notes valid' : `${invalidCount} invalid`,
    });
    if (invalidCount === 0 && generalVaultExists) score += 15;

    // Secrets clean?
    let highFindings = 0;
    if (generalVaultExists) {
      for (const n of listNotes(projectRoot)) {
        const r = scanForSecrets(projectRoot, n.relPath);
        if (!r.safe) {
          for (const f of r.findings) {
            if (f.severity === 'HIGH') highFindings++;
          }
        }
      }
    }
    checks.push({
      name: 'secrets_clean',
      pass: highFindings === 0,
      detail: highFindings === 0 ? 'no HIGH-severity secrets' : `${highFindings} HIGH finding(s)`,
    });
    if (highFindings === 0) score += 15;

    const status = score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy';
    res.json({
      score,
      status,
      checks,
      message:
        status === 'healthy' ? 'memory system healthy' :
        status === 'degraded' ? 'one or more subsystems need attention' :
        'multiple subsystems failing',
    });
  }));

  // GET /memory/storage — disk-usage summary for the Memory tab.
  // Walks the vault + .bizar/memory-cache + lightrag working dir.
  router.get('/memory/storage', wrap(async (_req, res) => {
    const { resolveVault } = memoryStore;
    const { vaultRoot, projectVaultRoot, mode } = resolveVault(projectRoot);

    const targets = [];
    // Use projectVaultRoot for the actual note storage path
    if (existsSync(projectVaultRoot)) targets.push({ name: 'vault', path: projectVaultRoot });
    const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
    if (existsSync(cacheDir)) targets.push({ name: 'memory-cache', path: cacheDir });
    const lightragDir = join(projectRoot, '.bizar', 'lightrag');
    if (existsSync(lightragDir)) targets.push({ name: 'lightrag', path: lightragDir });

    let total = 0;
    const breakdown = targets.map((t) => {
      const size = dirSize(t.path);
      total += size;
      return { name: t.name, path: t.path, size };
    });

    res.json({
      total,
      breakdown,
      mode,
      vaultRoot, // general vault root for display
      message: total === 0 ? 'no memory data on disk yet' : `${formatBytes(total)} on disk`,
    });
  }));

  // GET /memory/git/diff — textual diff of the working tree (last commit vs HEAD).
  // Returns { hasDiff, lines, files } — `lines` is a flat unified-diff-ish view.
  router.get('/memory/git/diff', wrap(async (_req, res) => {
    const { resolveVault } = memoryStore;
    const { isGitInstalled } = memoryGit;
    const { projectVaultRoot, mode } = resolveVault(projectRoot);

    if (mode === 'local-only') {
      res.json({ hasDiff: false, lines: [], files: [], mode: 'local-only' });
      return;
    }
    if (!isGitInstalled()) {
      res.status(503).json({ error: 'git_not_installed' });
      return;
    }

    let raw = '';
    try {
      raw = execFileSync('git', ['diff', '--no-color', '--no-ext-diff'], {
        cwd: projectVaultRoot,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (err) {
      res.status(500).json({ error: 'diff_failed', message: err.message });
      return;
    }

    // Also include untracked file names.
    let untracked = [];
    try {
      const statusRaw = execFileSync('git', ['status', '--porcelain'], {
        cwd: projectVaultRoot,
        encoding: 'utf8',
      });
      for (const line of statusRaw.split('\n')) {
        if (line.startsWith('??')) untracked.push(line.slice(3).trim());
      }
    } catch {
      /* ignore */
    }

    const lines = raw.split('\n');
    const files = [];
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (m) files.push(m[2]);
      }
    }
    for (const u of untracked) {
      if (!files.includes(u)) files.push(u);
    }

    res.json({
      hasDiff: lines.length > 1 || untracked.length > 0,
      lines,
      files,
      mode,
    });
  }));

  // GET /memory/lightrag/stats — aggregate stats for the LightRAG panel.
  router.get('/memory/lightrag/stats', wrap(async (_req, res) => {
    try {
      const { stats } = await getMemoryLightrag();
      const data = await stats(projectRoot);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'stats_failed', message: err.message });
    }
  }));

  // GET /memory/graph — combined knowledge graph (LightRAG entities + Obsidian wikilinks).
  // Query params: ?root=<noteId>&depth=2&limit=200
  router.get('/memory/graph', wrap(async (req, res) => {
    const root = req.query.root ? String(req.query.root) : null;
    const depth = Math.min(parseInt(req.query.depth, 10) || 2, 3);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

    try {
      const lightrag = await getMemoryLightrag();
      const [lrGraph, obsidianGraph] = await Promise.all([
        lightrag.getLightRAGGraph({ projectRoot, root, depth, limit }),
        (async () => {
          try {
            const { getObsidianLinkGraph } = memoryStore;
            return getObsidianLinkGraph({ projectRoot, limit });
          } catch {
            return { nodes: [], edges: [] };
          }
        })(),
      ]);

      // Dedupe nodes by id; prefer the lightrag node (has richer type/size).
      const nodeMap = new Map();
      for (const n of obsidianGraph.nodes) nodeMap.set(n.id, n);
      for (const n of lrGraph.nodes) {
        if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
      }
      const nodes = [...nodeMap.values()].slice(0, limit);

      // Merge edges from both sources; deduplicate by source+target.
      const edgeSet = new Set();
      const edges = [];
      for (const e of [...obsidianGraph.edges, ...lrGraph.edges]) {
        const key = `${e.source}|${e.target}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push(e);
        }
      }

      res.json({ nodes, edges, totalNodes: nodes.length, totalEdges: edges.length });
    } catch (err) {
      res.status(500).json({ error: 'graph_failed', message: err.message });
    }
  }));

  // POST /memory/lightrag/reindex — alias of /memory/reindex (the canonical
  // path lives there for backwards compat). Both return the same shape.
  router.post('/memory/lightrag/reindex', wrap(async (_req, res) => {
    const { reindexVault } = memoryStore;
    const result = await reindexVault(projectRoot, {});
    res.json(result);
  }));

  // POST /memory/lightrag/rebuild-graph — nuke the working dir + reindex.
  router.post('/memory/lightrag/rebuild-graph', wrap(async (_req, res) => {
    try {
      const { rebuildGraph } = await getMemoryLightrag();
      const result = await rebuildGraph(projectRoot, {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'rebuild_failed', message: err.message });
    }
  }));

  // GET /memory/obsidian/tree — recursive folder tree for the Memory browser.
  router.get('/memory/obsidian/tree', wrap(async (_req, res) => {
    try {
      const obsidian = await import(`${SERVER_ROOT}/memory-obsidian.mjs`);
      const node = obsidian.tree(projectRoot);
      res.json({ tree: node });
    } catch (err) {
      res.status(500).json({ error: 'tree_failed', message: err.message });
    }
  }));

  // GET /memory/obsidian/backlinks?note=path/to/note.md
  router.get('/memory/obsidian/backlinks', wrap(async (req, res) => {
    const note = String(req.query.note || '').trim();
    if (!note) {
      res.status(400).json({ error: 'bad_request', message: 'note query param required' });
      return;
    }
    try {
      const obsidian = await import(`${SERVER_ROOT}/memory-obsidian.mjs`);
      const links = obsidian.listBacklinks(projectRoot, note);
      res.json({ note, backlinks: links });
    } catch (err) {
      res.status(500).json({ error: 'backlinks_failed', message: err.message });
    }
  }));

  // GET /memory/obsidian/notes?path=...&limit=...
  // Query-string variant of the canonical /memory/notes endpoint. Used by
  // the ObsidianPanel folder browser which knows the parent path.
  router.get('/memory/obsidian/notes', wrap(async (req, res) => {
    const { listNotes } = memoryStore;
    const all = listNotes(projectRoot);
    const path = String(req.query.path || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    let notes = all;
    if (path) {
      notes = all.filter((n) => n.relPath.startsWith(path));
    }
    notes = notes.slice(0, limit);
    res.json({ path: path || null, count: notes.length, notes });
  }));

  // PUT /memory/notes/* — update an existing note (or create).
  router.put('/memory/notes/*', wrap(async (req, res) => {
    const { writeNote } = memoryStore;
    const relPath = req.params[0];
    const { frontmatter, body } = req.body || {};
    if (!relPath) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    if (!relPath.endsWith('.md')) {
      res.status(400).json({ error: 'bad_request', message: 'path must end in .md' });
      return;
    }
    try {
      const note = writeNote(projectRoot, relPath, { frontmatter: frontmatter || {}, body: body || '' });
      res.json(note);
      // v5.x — auto-reindex the updated note in the background (fire-and-forget).
      getMemoryLightrag().then((m) => {
        void m.reindexSingleNote(projectRoot, relPath).catch(() => {});
      });
    } catch (err) {
      if (err.code === 'SCHEMA_VALIDATION_FAILED' || err.code === 'SECRET_DETECTED') {
        res.status(400).json({ error: err.code, message: err.message, findings: err.findings });
      } else {
        res.status(400).json({ error: 'bad_request', message: err.message });
      }
    }
  }));

  // POST /memory/semantic-search — cross-source search.
  // Body: { query: string, limit?: number, sources?: Array<'lightrag'|'obsidian'> }
  router.post('/memory/semantic-search', wrap(async (req, res) => {
    const body = req.body || {};
    const query = String(body.query || '').trim();
    if (!query) {
      res.status(400).json({ error: 'bad_request', message: 'query is required' });
      return;
    }
    const limit = Math.min(parseInt(body.limit, 10) || 10, 50);
    const requestedSources = Array.isArray(body.sources) && body.sources.length > 0
      ? new Set(body.sources.map((s) => String(s).toLowerCase()))
      : new Set(['lightrag', 'obsidian']);

    const results = [];
    if (requestedSources.has('obsidian')) {
      const { searchVault } = memoryStore;
      const lex = searchVault(projectRoot, query, { limit });
      for (const r of lex) {
        results.push({
          source: 'obsidian',
          relPath: r.relPath,
          snippet: r.snippet,
          score: r.score,
          mtime: r.mtime,
        });
      }
    }
    if (requestedSources.has('lightrag')) {
      try {
        const { resolveLightRAGConfig, query: lightragQuery } = await getMemoryLightrag();
        const cfg = resolveLightRAGConfig(projectRoot);
        const r = await lightragQuery(cfg, query, { topK: limit });
        if (r.ok && r.response) {
          // LightRAG's response shape varies by mode; coerce to a snippet.
          const text = typeof r.response === 'string'
            ? r.response
            : (r.response?.response || r.response?.answer || JSON.stringify(r.response));
          results.push({
            source: 'lightrag',
            relPath: null,
            snippet: String(text).slice(0, 500),
            score: 1,
            mtime: null,
            raw: r.response,
          });
        }
      } catch (err) {
        results.push({ source: 'lightrag', error: err.message });
      }
    }

    // Dedupe by (source, relPath), keep highest score.
    const seen = new Map();
    for (const r of results) {
      const key = `${r.source}|${r.relPath || '_query_'}`;
      const prev = seen.get(key);
      if (!prev || (r.score || 0) > (prev.score || 0)) {
        seen.set(key, r);
      }
    }
    const deduped = [...seen.values()].sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json({ query, count: deduped.length, results: deduped });
  }));

  return router;
}

/**
 * Recursively sum file sizes under `dir`. Returns 0 if dir doesn't exist.
 */
function dirSize(dir) {
  let total = 0;
  function walk(d) {
    let st;
    try { st = statSync(d); } catch { return; }
    if (st.isFile()) { total += st.size; return; }
    if (!st.isDirectory()) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      walk(join(d, e.name));
    }
  }
  walk(dir);
  return total;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
