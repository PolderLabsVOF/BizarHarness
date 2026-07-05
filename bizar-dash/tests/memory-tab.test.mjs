/**
 * tests/memory-tab.test.mjs
 *
 * v4.7.0 — Tests for the dedicated Memory tab endpoints.
 *
 * Covers the new REST surface:
 *   GET  /api/memory/health
 *   GET  /api/memory/storage
 *   GET  /api/memory/lightrag/stats
 *   GET  /api/memory/obsidian/tree
 *   GET  /api/memory/obsidian/backlinks
 *   POST /api/memory/semantic-search
 *   GET  /api/memory/git/diff
 *
 * Plus the canonical CRUD endpoints and existing memory status surface, to
 * verify nothing regressed when we added the new shape. Uses an isolated
 * tmp projectRoot per test so the existing repo memory config is untouched.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';

const { createMemoryRouter } = await import('../src/server/routes/memory.mjs');
const memoryStore = await import('../src/server/memory-store.mjs');

let server;
let baseUrl;
let tmpRoot;

function get(path) {
  return fetch(`${baseUrl}${path}`);
}

function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function put(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function del(path) {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

before(async () => {
  tmpRoot = join(tmpdir(), `bizar-memtab-${Date.now()}`);
  mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });

  // Initialise memory in local-only mode for tests.
  memoryStore.saveConfig(tmpRoot, {
    version: 1,
    backend: 'bizar-local',
    projectId: 'memtab-test',
    memoryRepo: {
      mode: 'local-only',
      path: join(tmpRoot, '.obsidian'),
      remote: null,
      branch: 'main',
      namespace: 'projects/memtab-test',
    },
    namespaces: {
      project: 'projects/memtab-test',
      global: 'global/bizar',
      user: 'users/local',
    },
    lightrag: { enabled: false, host: '127.0.0.1', port: 9621 },
    git: {
      autoPullOnSessionStart: false,
      autoCommitOnMemoryWrite: false,
      autoPushOnSessionEnd: false,
      commitAuthor: 'Test <test@local>',
      commitMessageTemplate: 'memory(test): {summary}',
    },
  });
  memoryStore.initVault(tmpRoot);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(createMemoryRouter({ projectRoot: tmpRoot }));
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server?.close(r));
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('GET /api/memory/health', () => {
  test('returns score + checks + status', async () => {
    const r = await get('/memory/health');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(typeof body.score, 'number');
    assert.ok(['healthy', 'degraded', 'unhealthy', 'unconfigured'].includes(body.status));
    assert.ok(Array.isArray(body.checks));
    assert.equal(typeof body.message, 'string');
  });

  test('checks include vault_exists + vault_writable + git_clean', async () => {
    const r = await get('/memory/health');
    const body = await r.json();
    const names = body.checks.map((c) => c.name);
    assert.ok(names.includes('vault_exists'));
    assert.ok(names.includes('vault_writable'));
    // local-only mode marks git_clean as pass with detail "local-only mode"
    const git = body.checks.find((c) => c.name === 'git_clean');
    assert.ok(git);
    assert.match(git.detail, /local-only/);
  });
});

describe('GET /api/memory/storage', () => {
  test('returns total + breakdown', async () => {
    const r = await get('/memory/storage');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(typeof body.total, 'number');
    assert.ok(Array.isArray(body.breakdown));
    assert.equal(typeof body.mode, 'string');
  });
});

describe('GET /api/memory/lightrag/stats', () => {
  test('returns aggregate stats shape', async () => {
    const r = await get('/memory/lightrag/stats');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(typeof body.running, 'boolean');
    assert.equal(typeof body.host, 'string');
    assert.equal(typeof body.port, 'number');
    assert.equal(typeof body.indexedApprox, 'number');
    assert.equal(typeof body.queryCountLast24h, 'number');
    // lastReindexAt may be null in a fresh project
    assert.ok('lastReindexAt' in body);
  });
});

describe('GET /api/memory/obsidian/tree', () => {
  test('returns a tree node (or null for empty vault)', async () => {
    const r = await get('/memory/obsidian/tree');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('tree' in body);
  });
});

describe('CRUD: POST/PUT/GET/DELETE /api/memory/notes/*', () => {
  const notePath = 'daily/2026-07-05.md';
  let createdBody;

  const fullFrontmatter = {
    memory_id: 'mem-test-2026-07-05',
    project_id: 'memtab-test',
    type: 'session_summary',
    status: 'draft',
    confidence: 'inferred',
    created: '2026-07-05',
    updated: '2026-07-05',
    tags: ['test'],
  };

  test('POST creates a note', async () => {
    const r = await post('/memory/notes', {
      path: notePath,
      frontmatter: { ...fullFrontmatter, title: 'Test note' },
      body: 'This note links to [[2026-07-04]] and [[notes/other]].',
    });
    assert.equal(r.status, 201);
    createdBody = await r.json();
    assert.equal(createdBody.relPath, notePath);
    assert.equal(createdBody.frontmatter.title, 'Test note');
  });

  test('GET /memory/notes/:path returns the note', async () => {
    const r = await get(`/memory/notes/${encodeURI(notePath)}`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.frontmatter.title, 'Test note');
  });

  test('PUT updates the note', async () => {
    const r = await put(`/memory/notes/${encodeURI(notePath)}`, {
      frontmatter: { ...fullFrontmatter, title: 'Updated test note', tags: ['test', 'updated'] },
      body: 'Updated body. References [[2026-07-04]] again.',
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.frontmatter.title, 'Updated test note');
    assert.deepEqual(body.frontmatter.tags, ['test', 'updated']);
  });

  test('DELETE removes the note', async () => {
    const r = await del(`/memory/notes/${encodeURI(notePath)}`);
    assert.equal(r.status, 204);
    const r2 = await get(`/memory/notes/${encodeURI(notePath)}`);
    assert.equal(r2.status, 404);
  });
});

describe('GET /api/memory/obsidian/backlinks', () => {
  const fullFrontmatter = {
    memory_id: 'mem-test-backlinks',
    project_id: 'memtab-test',
    type: 'session_summary',
    status: 'draft',
    confidence: 'inferred',
    created: '2026-07-04',
    updated: '2026-07-04',
    tags: ['test'],
  };

  test('returns empty backlinks for an unknown note', async () => {
    const r = await get('/memory/obsidian/backlinks?note=does-not-exist.md');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.note, 'does-not-exist.md');
    assert.deepEqual(body.backlinks, []);
  });

  test('finds a backlink to a known target', async () => {
    // Create the target note first.
    await post('/memory/notes', {
      path: 'daily/2026-07-04.md',
      frontmatter: { ...fullFrontmatter, title: 'Yesterday' },
      body: 'yesterday content',
    });
    // Create a note that links to it.
    await post('/memory/notes', {
      path: 'daily/2026-07-05-linker.md',
      frontmatter: { ...fullFrontmatter, title: 'Today', memory_id: 'mem-test-linker' },
      body: 'See [[2026-07-04]] for context.',
    });
    const r = await get('/memory/obsidian/backlinks?note=' + encodeURIComponent('daily/2026-07-04.md'));
    const body = await r.json();
    assert.ok(body.backlinks.length >= 1, 'expected at least one backlink');
    const backlink = body.backlinks.find((b) => b.fromRelPath === 'daily/2026-07-05-linker.md');
    assert.ok(backlink, 'expected backlink from 2026-07-05-linker.md');
    assert.match(backlink.snippet, /\[\[2026-07-04\]\]/);
  });

  test('rejects missing note param', async () => {
    const r = await get('/memory/obsidian/backlinks');
    assert.equal(r.status, 400);
  });
});

describe('POST /api/memory/semantic-search', () => {
  test('returns merged lexical + lightrag results', async () => {
    const r = await post('/memory/semantic-search', {
      query: 'today',
      limit: 5,
      sources: ['obsidian'],
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.query, 'today');
    assert.ok(Array.isArray(body.results));
    // lightrag is disabled by default → source should only contain obsidian
    for (const result of body.results) {
      assert.equal(result.source, 'obsidian');
    }
  });

  test('deduplicates by (source, relPath)', async () => {
    const r = await post('/memory/semantic-search', {
      query: 'today',
      limit: 5,
    });
    const body = await r.json();
    const seen = new Set();
    for (const result of body.results) {
      const k = `${result.source}|${result.relPath || '_query_'}`;
      assert.ok(!seen.has(k), `duplicate key ${k}`);
      seen.add(k);
    }
  });

  test('rejects empty query', async () => {
    const r = await post('/memory/semantic-search', { query: '' });
    assert.equal(r.status, 400);
  });
});

describe('GET /api/memory/git/diff', () => {
  test('returns hasDiff=false in local-only mode', async () => {
    const r = await get('/memory/git/diff');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.mode, 'local-only');
    assert.equal(body.hasDiff, false);
    assert.ok(Array.isArray(body.lines));
    assert.ok(Array.isArray(body.files));
  });
});

describe('GET /api/memory/status', () => {
  test('returns initialized=true', async () => {
    const r = await get('/memory/status');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.initialized, true);
    assert.equal(body.mode, 'local-only');
    assert.ok(typeof body.noteCount === 'number');
  });
});