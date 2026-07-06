/**
 * tests/memory-auto-reindex.test.mjs
 *
 * v5.x — Tests for the auto-reindex-on-write feature.
 *
 * POST /memory/notes and PUT /memory/notes/* must return the note response
 * promptly WITHOUT waiting for reindexSingleNote to complete (fire-and-forget).
 *
 * These tests verify:
 *   1. POST /memory/notes returns 201 and the note is persisted immediately
 *   2. PUT /memory/notes/* returns 200 and the note is updated immediately
 *   3. Both handlers are non-blocking (reindex is async, fire-and-forget)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';

const httpPost = (port, path, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(respBody || '{}') }); }
          catch { resolve({ status: res.statusCode, body: respBody }); }
        });
      },
    );
    req.write(data);
    req.end();
  });

const httpPut = (port, path, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port, path, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(respBody || '{}') }); }
          catch { resolve({ status: res.statusCode, body: respBody }); }
        });
      },
    );
    req.write(data);
    req.end();
  });

async function buildApp(projectRoot) {
  const { createMemoryRouter } = await import('../src/server/routes/memory.mjs');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', createMemoryRouter({ projectRoot }));
  return app;
}

async function withApp(projectRoot, fn) {
  const app = await buildApp(projectRoot);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

function makeTmp() {
  const root = join(tmpdir(), `bizar-auto-reindex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.bizar'), { recursive: true });
  // Write a minimal memory.json so the router doesn't fail on init.
  writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
    version: 1,
    backend: 'bizar-local',
    projectId: 'reindex-test',
    memoryRepo: { mode: 'local-only', path: join(root, '.obsidian') },
    namespaces: { project: 'projects/reindex-test', global: 'global/bizar', user: 'users/tester' },
    lightrag: { enabled: false },
    git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false },
  }));
  return root;
}

let tmpRoot;

beforeEach(() => {
  tmpRoot = makeTmp();
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('POST /memory/notes — auto-reindex', () => {
  test('returns 201 and the written note immediately', async () => {
    const result = await withApp(tmpRoot, async (port) => {
      const start = Date.now();
      const r = await httpPost(port, '/api/memory/notes', {
        path: 'sessions/test-post.md',
        frontmatter: {
          memory_id: 'test-mid-001',
          type: 'session_summary',
          project_id: 'reindex-test',
          status: 'active',
          confidence: 'verified',
          created: '2026-07-06T00:00:00Z',
          updated: '2026-07-06T00:00:00Z',
          tags: ['auto-generated'],
        },
        body: '# Test note\n\nContent here.',
      });
      const elapsed = Date.now() - start;
      return { r, elapsed };
    });

    assert.equal(result.r.status, 201, `expected 201, got ${result.r.status}: ${JSON.stringify(result.r.body)}`);
    assert.equal(result.r.body.relPath, 'sessions/test-post.md');
    // Response must be fast — reindex is fire-and-forget (no lightrag-server in tests).
    assert.ok(result.elapsed < 2000, `expected <2s response, got ${result.elapsed}ms`);
    // Note must be persisted on disk.
    const notePath = join(tmpRoot, '.obsidian', 'sessions', 'test-post.md');
    assert.ok(existsSync(notePath), 'note should be written to disk immediately');
    const content = readFileSync(notePath, 'utf8');
    assert.ok(content.includes('Test note'));
  });

  test('rejects notes not ending in .md', async () => {
    const result = await withApp(tmpRoot, async (port) =>
      httpPost(port, '/api/memory/notes', {
        path: 'sessions/test.txt',
        frontmatter: {
          memory_id: 'test-mid-002',
          type: 'task_summary',
          project_id: 'reindex-test',
          status: 'active',
          confidence: 'verified',
          created: '2026-07-06T00:00:00Z',
          updated: '2026-07-06T00:00:00Z',
          tags: [],
        },
        body: 'content',
      }),
    );
    assert.equal(result.status, 400);
  });
});

describe('PUT /memory/notes/* — auto-reindex', () => {
  test('returns 200 and the updated note immediately', async () => {
    // Pre-create the note with valid frontmatter.
    mkdirSync(join(tmpRoot, '.obsidian', 'sessions'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.obsidian', 'sessions', 'test-put.md'),
      '---\nmemory_id: test-mid-put\ntype: session_summary\nproject_id: reindex-test\nstatus: active\nconfidence: verified\ncreated: "2026-07-06T00:00:00Z"\nupdated: "2026-07-06T00:00:00Z"\ntags: []\n---\n\nOriginal content.',
    );

    const result = await withApp(tmpRoot, async (port) => {
      const start = Date.now();
      const r = await httpPut(port, '/api/memory/notes/sessions/test-put.md', {
        frontmatter: {
          memory_id: 'test-mid-put',
          type: 'session_summary',
          project_id: 'reindex-test',
          status: 'active',
          confidence: 'verified',
          created: '2026-07-06T00:00:00Z',
          updated: '2026-07-06T00:00:00Z',
          tags: ['auto-generated'],
        },
        body: '# Updated note\n\nNew content.',
      });
      const elapsed = Date.now() - start;
      return { r, elapsed };
    });

    assert.equal(result.r.status, 200, `expected 200, got ${result.r.status}: ${JSON.stringify(result.r.body)}`);
    assert.equal(result.r.body.relPath, 'sessions/test-put.md');
    assert.ok(result.elapsed < 2000, `expected <2s response, got ${result.elapsed}ms`);
    // Note must be updated on disk.
    const notePath = join(tmpRoot, '.obsidian', 'sessions', 'test-put.md');
    const content = readFileSync(notePath, 'utf8');
    assert.ok(content.includes('Updated note'));
    assert.ok(!content.includes('Original content'));
  });
});
