/**
 * tests/memory-vault-config-endpoint.test.mjs
 *
 * v6.x — Tests for POST /memory/config/vault endpoint which updates the
 * vault root path persistently in ~/.config/bizar/memory-config.json
 * and sets process.env.BIZAR_MEMORY_VAULT.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';

const httpPost = (port, path, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(respBody || '{}') }));
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
  const root = join(tmpdir(), `bizar-vault-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.bizar'), { recursive: true });
  return root;
}

describe('POST /api/memory/config/vault', () => {
  let root;
  const capturedEnv = [];

  beforeEach(() => {
    root = makeTmp();
    // Capture process.env changes so we can restore them
    capturedEnv.push(process.env.BIZAR_MEMORY_VAULT);
  });

  afterEach(() => {
    // Restore env
    if (capturedEnv.length > 0) {
      const prev = capturedEnv.pop();
      if (prev === undefined) delete process.env.BIZAR_MEMORY_VAULT;
      else process.env.BIZAR_MEMORY_VAULT = prev;
    }
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns 400 when vaultRoot is missing', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', {});
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'vaultRoot required');
    });
  });

  test('returns 400 when vaultRoot is not a string', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: 123 });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'vaultRoot required');
    });
  });

  test('returns 400 when vaultRoot is an empty string', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: '  ' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'vaultRoot required');
    });
  });

  test('creates the vault directory if it does not exist', async () => {
    const targetVault = join(tmpdir(), `bizar-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    assert.strictEqual(existsSync(targetVault), false);

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: targetVault });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.vaultRoot, targetVault);
    });

    assert.strictEqual(existsSync(targetVault), true);
    rmSync(targetVault, { recursive: true, force: true });
  });

  test('persists the vault root to ~/.config/bizar/memory-config.json', async () => {
    const targetVault = join(tmpdir(), `bizar-vault-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configPath = join(homedir(), '.config', 'bizar', 'memory-config.json');

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: targetVault });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });

    // Verify config was written
    assert.strictEqual(existsSync(configPath), true);
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.strictEqual(cfg.git?.repoPath, targetVault);

    rmSync(targetVault, { recursive: true, force: true });
  });

  test('sets process.env.BIZAR_MEMORY_VAULT', async () => {
    const targetVault = join(tmpdir(), `bizar-vault-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    assert.strictEqual(process.env.BIZAR_MEMORY_VAULT, capturedEnv[capturedEnv.length - 1] || undefined);

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: targetVault });
      assert.strictEqual(res.status, 200);
    });

    assert.strictEqual(process.env.BIZAR_MEMORY_VAULT, targetVault);
    rmSync(targetVault, { recursive: true, force: true });
  });

  test('expands ~ to home directory', async () => {
    const targetVault = `~/bizar-test-vault-${Date.now()}`;
    const expectedVault = join(homedir(), `bizar-test-vault-${Date.now()}`);

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: targetVault });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.vaultRoot, expectedVault);
    });

    rmSync(expectedVault, { recursive: true, force: true });
  });

  test('returns the resolved vault root in the response', async () => {
    const targetVault = join(tmpdir(), `bizar-vault-resolved-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config/vault', { vaultRoot: targetVault });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.vaultRoot, targetVault);
    });

    rmSync(targetVault, { recursive: true, force: true });
  });
});
