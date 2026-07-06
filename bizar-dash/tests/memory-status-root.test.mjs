/**
 * tests/memory-status-root.test.mjs
 *
 * v6.x — Tests that GET /memory/status returns the GENERAL vault root
 * (e.g. ~/.bizar_memory) in managed/linked mode, not the project-specific
 * subdirectory (e.g. ~/.bizar_memory/projects/<projectId>).
 *
 * Before the fix, /memory/status returned vaultRoot = project-specific path
 * which caused the Config panel to display the wrong path.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const httpGet = (port, path) =>
  new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    });
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
  const root = join(tmpdir(), `bizar-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.bizar'), { recursive: true });
  return root;
}

describe('GET /api/memory/status — vault root (v6.x)', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns vaultRoot=null when not initialised', async () => {
    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.initialized, false);
      assert.strictEqual(res.body.vaultRoot, null);
      assert.strictEqual(res.body.projectVaultRoot, null);
    });
  });

  test('returns the general vault root (not project-specific) for managed mode', async () => {
    // Set up managed mode with a known vault path
    const vaultRoot = join(tmpdir(), `bizar-managed-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(vaultRoot, { recursive: true });
    mkdirSync(join(vaultRoot, 'projects'), { recursive: true });

    // Write config with managed mode pointing to our vault root
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      mode: 'managed',
      projectId: 'test-project',
      memoryRepo: { mode: 'managed', path: vaultRoot },
    }));

    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.initialized, true);
      // vaultRoot must be the GENERAL vault root, not the project subdirectory
      assert.strictEqual(res.body.vaultRoot, vaultRoot);
      // projectVaultRoot is the project-specific subdirectory
      assert.strictEqual(res.body.projectVaultRoot, join(vaultRoot, 'projects', 'test-project'));
    });

    rmSync(vaultRoot, { recursive: true, force: true });
  });

  test('projectVaultRoot differs from vaultRoot in managed mode', async () => {
    const vaultRoot = join(tmpdir(), `bizar-managed-vault2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(vaultRoot, { recursive: true });
    mkdirSync(join(vaultRoot, 'projects'), { recursive: true });

    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      mode: 'managed',
      projectId: 'my-project',
      memoryRepo: { mode: 'managed', path: vaultRoot },
    }));

    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/status');
      assert.strictEqual(res.body.vaultRoot, vaultRoot);
      assert.notStrictEqual(res.body.vaultRoot, res.body.projectVaultRoot);
      assert.strictEqual(res.body.projectVaultRoot, join(vaultRoot, 'projects', 'my-project'));
    });

    rmSync(vaultRoot, { recursive: true, force: true });
  });

  test('returns local-only vaultRoot for local-only mode', async () => {
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      mode: 'local-only',
      projectId: 'test-local',
    }));

    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.initialized, true);
      assert.strictEqual(res.body.mode, 'local-only');
      // local-only vaultRoot is <projectRoot>/.obsidian
      assert.strictEqual(res.body.vaultRoot, join(root, '.obsidian'));
      // projectVaultRoot equals vaultRoot in local-only mode
      assert.strictEqual(res.body.projectVaultRoot, join(root, '.obsidian'));
    });
  });
});
