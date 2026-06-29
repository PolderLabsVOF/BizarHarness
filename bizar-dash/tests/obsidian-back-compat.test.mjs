/**
 * tests/obsidian-back-compat.test.mjs
 *
 * Tests for the backward-compatible obsidian.mjs rewrite.
 * Verifies that the new router returns the same JSON shapes as the original.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import express from 'express';

const SR = '../src/server'; // from tests/ → bizarre-dash/src/server

async function get(url, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path: url, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { data = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function post(url, port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      { hostname: 'localhost', port, path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { data = JSON.parse(data); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, body: data });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('obsidian-back-compat', () => {
  let projectRoot;
  let server;
  let port;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `obc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
  });

  afterEach(async () => {
    if (server) {
      await new Promise((r) => server.close(r));
      server = null;
    }
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── With memory.json (memory service mode) ─────────────────────────────────

  describe('memory service mode (memory.json exists)', () => {
    it('GET /obsidian returns vaultStats shape', async () => {
      const ms = await import(`${SR}/memory-store.mjs`);
      ms.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'test',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/test', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(test): {summary}' },
      });
      ms.initVault(projectRoot);
      ms.writeNote(projectRoot, 'test-note.md', {
        frontmatter: { memory_id: 't1', type: 'session_summary', project_id: 'test', status: 'active', confidence: 'verified', created: new Date().toISOString(), updated: new Date().toISOString(), tags: [] },
        body: 'Test body',
      });

      const app = express();
      app.use(express.json());
      const { createObsidianRouter } = await import(`${SR}/routes/obsidian.mjs`);
      app.use(await createObsidianRouter({ projectRoot }));
      server = app.listen(0);
      port = server.address().port;

      const { status, body } = await get('/obsidian', port);
      assert.strictEqual(status, 200);
      assert.strictEqual(typeof body.exists, 'boolean');
      assert.strictEqual(typeof body.vaultDir, 'string');
      assert.strictEqual(typeof body.noteCount, 'number');
      assert.strictEqual(typeof body.totalSize, 'number');
    });

    it('GET /obsidian/notes returns legacy shape { notes: [{ path, relPath, mtime, size }]}', async () => {
      const ms = await import(`${SR}/memory-store.mjs`);
      ms.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'test',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/test', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(test): {summary}' },
      });
      ms.initVault(projectRoot);
      ms.writeNote(projectRoot, 'lnt.md', {
        frontmatter: { memory_id: 'lnt1', type: 'session_summary', project_id: 'test', status: 'active', confidence: 'verified', created: new Date().toISOString(), updated: new Date().toISOString(), tags: [] },
        body: 'body',
      });

      const app = express();
      app.use(express.json());
      const { createObsidianRouter } = await import(`${SR}/routes/obsidian.mjs`);
      app.use(await createObsidianRouter({ projectRoot }));
      server = app.listen(0);
      port = server.address().port;

      const { status, body } = await get('/obsidian/notes', port);
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(body.notes));
      assert.ok(body.notes.length > 0);
      const note = body.notes[0];
      assert.strictEqual(typeof note.path, 'string');
      assert.strictEqual(typeof note.relPath, 'string');
      assert.strictEqual(typeof note.mtime, 'number');
      assert.strictEqual(typeof note.size, 'number');
      assert.strictEqual(note.frontmatter, undefined); // NOT rich shape
    });

    it('POST /obsidian/notes returns 201 with FULL note shape', async () => {
      const ms = await import(`${SR}/memory-store.mjs`);
      ms.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'test',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/test', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(test): {summary}' },
      });
      ms.initVault(projectRoot);

      const app = express();
      app.use(express.json());
      const { createObsidianRouter } = await import(`${SR}/routes/obsidian.mjs`);
      app.use(await createObsidianRouter({ projectRoot }));
      server = app.listen(0);
      port = server.address().port;

      const { status, body } = await post('/obsidian/notes', port, {
        path: 'post-test.md',
        frontmatter: { memory_id: 'pt1', type: 'session_summary', project_id: 'test', status: 'active', confidence: 'verified', created: new Date().toISOString(), updated: new Date().toISOString(), tags: [] },
        body: 'Posted body content',
      });

      assert.strictEqual(status, 201);
      assert.strictEqual(typeof body.relPath, 'string');
      assert.strictEqual(typeof body.frontmatter, 'object');
      assert.strictEqual(typeof body.body, 'string');
      assert.strictEqual(typeof body.raw, 'string');
      assert.strictEqual(typeof body.mtime, 'number');
      assert.strictEqual(typeof body.size, 'number');
      assert.strictEqual(body.relPath, 'post-test.md');
    });
  });

  // ── Without memory.json (legacy mode) ───────────────────────────────────────

  describe('legacy mode (no memory.json)', () => {
    it('GET /obsidian returns legacy vaultStats shape', async () => {
      const os = await import(`${SR}/obsidian-store.mjs`);
      os.initObsidianVault(projectRoot);
      os.writeVaultNote(projectRoot, 'legacy.md', {
        frontmatter: { title: 'Legacy Note' },
        body: 'Legacy body',
      });

      const app = express();
      app.use(express.json());
      const { createObsidianRouter } = await import(`${SR}/routes/obsidian.mjs`);
      app.use(await createObsidianRouter({ projectRoot }));
      server = app.listen(0);
      port = server.address().port;

      const { status, body } = await get('/obsidian', port);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.exists, true);
      assert.strictEqual(typeof body.vaultDir, 'string');
      assert.strictEqual(typeof body.noteCount, 'number');
    });
  });
});
