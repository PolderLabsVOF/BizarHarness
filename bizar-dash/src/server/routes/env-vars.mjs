/**
 * src/server/routes/env-vars.mjs
 *
 * v1 — Bizar env vars stored in ~/.config/bizar/env.json (mode 0600).
 *
 * Endpoints:
 *   GET    /api/env-vars           — list all (masked values)
 *   POST   /api/env-vars           — create {name, value}
 *   PUT    /api/env-vars/:name     — update {value}
 *   DELETE /api/env-vars/:name     — remove + delete from process.env
 *   POST   /api/env-vars/:name/test — {referenced, inProcessEnv}
 *
 * Name must match /^BIZAR_[A-Z0-9_]+$/.
 * On startup, loadEnvJson() sets process.env[name] = value for every entry.
 */
import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';

const HOME = homedir();
const BIZAR_DIR = join(HOME, '.config', 'bizar');
const ENV_FILE = join(BIZAR_DIR, 'env.json');

// Lazy-load store
let _store = null;

function readStore() {
  if (_store !== null) return _store;
  if (!existsSync(ENV_FILE)) {
    _store = {};
    return _store;
  }
  try {
    _store = JSON.parse(readFileSync(ENV_FILE, 'utf8')) || {};
  } catch {
    _store = {};
  }
  return _store;
}

function writeStore(store) {
  mkdirSync(BIZAR_DIR, { recursive: true });
  const tmp = `${ENV_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, ENV_FILE);
  _store = store;
}

/**
 * Load env.json into process.env at startup.
 * Called once from server.mjs after createApiRouter().
 */
export function loadEnvJson() {
  const store = readStore();
  for (const [name, entry] of Object.entries(store)) {
    if (name.startsWith('BIZAR_')) {
      process.env[name] = entry.value;
    }
  }
}

/** Reset in-memory store — used by tests to ensure isolation between test cases. */
export function resetStore() {
  _store = null;
}

/** Mask a value — return last 4 chars, prefixed with ***. */
function mask(value) {
  if (!value || value.length <= 4) return '****';
  return '*'.repeat(Math.max(0, value.length - 4)) + value.slice(-4);
}

const NAME_RE = /^BIZAR_[A-Z0-9_]+$/;

export function createEnvVarsRouter() {
  const router = Router();

  // GET /api/env-vars — list all (masked)
  router.get('/env-vars', wrap(async (_req, res) => {
    const store = readStore();
    const list = Object.entries(store).map(([name, entry]) => ({
      name,
      value: mask(entry.value),
      createdAt: entry.createdAt,
      source: entry.source,
    }));
    res.json(list);
  }));

  // POST /api/env-vars — create
  router.post('/env-vars', wrap(async (req, res) => {
    const { name, value } = req.body || {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name_required', message: 'name is required' });
      return;
    }
    if (!NAME_RE.test(name)) {
      res.status(400).json({
        error: 'invalid_name',
        message: 'name must match /^BIZAR_[A-Z0-9_]+$/',
      });
      return;
    }
    if (!value || typeof value !== 'string') {
      res.status(400).json({ error: 'value_required', message: 'value is required' });
      return;
    }
    const store = readStore();
    if (store[name]) {
      res.status(409).json({ error: 'already_exists', message: `${name} already exists` });
      return;
    }
    const entry = { value, createdAt: new Date().toISOString(), source: 'dashboard' };
    store[name] = entry;
    writeStore(store);
    process.env[name] = value;
    res.status(201).json({ name, value: mask(value), createdAt: entry.createdAt, source: entry.source });
  }));

  // PUT /api/env-vars/:name — update
  router.put('/env-vars/:name', wrap(async (req, res) => {
    const { name } = req.params;
    const { value } = req.body || {};
    if (!value || typeof value !== 'string') {
      res.status(400).json({ error: 'value_required', message: 'value is required' });
      return;
    }
    const store = readStore();
    if (!store[name]) {
      res.status(404).json({ error: 'not_found', message: `${name} not found` });
      return;
    }
    store[name] = { ...store[name], value };
    writeStore(store);
    process.env[name] = value;
    res.json({ name, value: mask(value), createdAt: store[name].createdAt, source: store[name].source });
  }));

  // DELETE /api/env-vars/:name — remove
  router.delete('/env-vars/:name', wrap(async (req, res) => {
    const { name } = req.params;
    const store = readStore();
    if (!store[name]) {
      res.status(404).json({ error: 'not_found', message: `${name} not found` });
      return;
    }
    delete store[name];
    writeStore(store);
    delete process.env[name];
    res.json({ ok: true });
  }));

  // POST /api/env-vars/:name/test — check if referenced
  router.post('/env-vars/:name/test', wrap(async (req, res) => {
    const { name } = req.params;
    const store = readStore();
    const inProcessEnv = name in process.env;
    // Conservative: we don't statically analyze code, so referenced = inProcessEnv for now
    res.json({ referenced: inProcessEnv, inProcessEnv });
  }));

  return router;
}
