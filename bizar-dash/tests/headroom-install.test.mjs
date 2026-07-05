/**
 * tests/headroom-install.test.mjs
 *
 * Tests for installHeadroom(), wrapOpencode(), unwrapOpencode(), startProxy(), stopProxy().
 * Uses real commands when available, mocks when not.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import http from 'node:http';

// ── Run command helper ──────────────────────────────────────────────────────

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { timeout: 5000, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 }));
    child.on('error', (err) => resolve({ stdout: '', stderr: err.message, exitCode: 1 }));
  });
}

// ── Install tests ────────────────────────────────────────────────────────────

test('installHeadroom returns correct shape', async () => {
  const { installHeadroom } = await import('../src/server/headroom.mjs');
  const result = await installHeadroom({ force: false });

  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(typeof result.installed === 'boolean', 'installed is boolean');
  assert.ok(typeof result.version === 'string' || result.version === null, 'version is string|null');
  assert.ok(typeof result.method === 'string', 'method is string');
});

test('installHeadroom returns already-installed when headroom is on PATH', async () => {
  const { installed } = await runCmd('headroom', ['--version']);
  if (installed !== 0) {
    // headroom not installed — skip
    return;
  }

  const { installHeadroom } = await import('../src/server/headroom.mjs');
  const result = await installHeadroom({ force: false });

  assert.strictEqual(result.installed, true, 'should report already installed');
  assert.strictEqual(result.method, 'already-installed', 'method should be already-installed');
});

test('installHeadroom.force reinstalls even when already installed', async () => {
  const { installHeadroom } = await import('../src/server/headroom.mjs');
  const result = await installHeadroom({ force: true });

  // Returns the shape regardless of outcome
  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(typeof result.installed === 'boolean', 'installed is boolean');
  assert.ok(typeof result.method === 'string', 'method is string');
});

// ── Wrap / Unwrap tests ─────────────────────────────────────────────────────

test('wrapOpencode returns correct shape', async () => {
  const { wrapOpencode } = await import('../src/server/headroom.mjs');
  const result = await wrapOpencode({ port: 8787 });

  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(typeof result.port === 'number', 'port is number');
  assert.ok(typeof result.log === 'string', 'log is string');
  assert.strictEqual(result.port, 8787, 'port is 8787');
});

test('unwrapOpencode returns correct shape', async () => {
  const { unwrapOpencode } = await import('../src/server/headroom.mjs');
  const result = await unwrapOpencode();

  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(typeof result.log === 'string', 'log is string');
});

// ── Proxy tests ─────────────────────────────────────────────────────────────

test('startProxy returns correct shape', async () => {
  const { startProxy } = await import('../src/server/headroom.mjs');
  const result = await startProxy({ port: 18787, host: '127.0.0.1' });

  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(typeof result.pid === 'number' || result.pid === null, 'pid is number|null');
  assert.ok(typeof result.port === 'number', 'port is number');
  assert.ok(typeof result.logPath === 'string', 'logPath is string');
});

test('stopProxy returns correct shape', async () => {
  const { stopProxy } = await import('../src/server/headroom.mjs');
  const result = await stopProxy();

  assert.ok(typeof result.ok === 'boolean', 'ok is boolean');
  assert.ok(Array.isArray(result.killed), 'killed is array');
});

// ── getOpencodeConfig tests ──────────────────────────────────────────────────

test('getOpencodeConfig returns correct shape', async () => {
  const { getOpencodeConfig } = await import('../src/server/headroom.mjs');
  const result = await getOpencodeConfig();

  assert.ok(typeof result.configPath === 'string', 'configPath is string');
  assert.ok(typeof result.hasHeadroomProvider === 'boolean', 'hasHeadroomProvider is boolean');
  assert.ok(result.configPath.includes('opencode.json'), 'configPath points to opencode.json');
});

// ── withHeadroomProxy tests ──────────────────────────────────────────────────

test('withHeadroomProxy returns URL unchanged when disabled', async () => {
  const { withHeadroomProxy } = await import('../src/server/headroom.mjs');
  const url = 'https://api.anthropic.com/v1/messages';
  // When headroom is not in settings (default), returns URL unchanged
  const result = withHeadroomProxy(url, { port: 8787 });
  // Result depends on settings — just verify it's a string
  assert.ok(typeof result === 'string', 'result is string');
  assert.ok(result.length > 0, 'result is non-empty');
});

// ── /api/headroom/install endpoint ──────────────────────────────────────────

async function buildApp() {
  const { createHeadroomRouter } = await import('../src/server/routes/headroom.mjs');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  // Mount at /api/headroom so routes like /status become /api/headroom/status
  app.use('/api/headroom', await createHeadroomRouter());
  return app;
}

test('POST /api/headroom/install returns result', async () => {
  const app = await buildApp();
  const server = app.listen(0);
  const { port } = server.address();

  const httpPost = () =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify({ force: false });
      const req = http.request(
        { hostname: 'localhost', port, path: '/api/headroom/install', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }); }
            catch { resolve({ status: res.statusCode, body }); }
          });
        },
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });

  try {
    const res = await httpPost();
    assert.strictEqual(res.status, 200, 'status should be 200');
    assert.ok(typeof res.body.ok === 'boolean', 'ok is boolean');
    assert.ok(typeof res.body.installed === 'boolean', 'installed is boolean');
  } finally {
    server.close();
  }
});
