/**
 * env-vars-store.test.mjs — tests for the env-vars route and loadEnvJson.
 *
 * Run with: node --test bizar-dash/tests/env-vars-store.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');

// Sandbox process.env for isolation
let SANDBOX_HOME;
let ORIGINAL_HOME;
let BIZAR_DIR;
let ENV_FILE;

before(() => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-env-vars-test-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = SANDBOX_HOME;
  BIZAR_DIR = join(SANDBOX_HOME, '.config', 'bizar');
  ENV_FILE = join(BIZAR_DIR, 'env.json');
});

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  // Clean up any lingering BIZAR_* test vars
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('BIZAR_TEST_')) delete process.env[k];
  }
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Helper to create a supertest-like request helper via native http
async function request(app, method, path, body) {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const bodyStr = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, body: parsed, raw: data });
          } catch {
            resolve({ status: res.statusCode, body: data, raw: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

describe('env-vars.mjs', () => {
  // Build a minimal express app with just the env-vars router
  let app;
  beforeEach(async () => {
    // Reset module state between tests by deleting the env file
    try { rmSync(ENV_FILE); } catch { /* ignore */ }
    // Force-reload the module for fresh state
    const express = (await import('express')).default;
    const { createEnvVarsRouter, loadEnvJson, resetStore } = await import(`${REPO}/bizar-dash/src/server/routes/env-vars.mjs`);
    resetStore();
    app = express();
    app.use(express.json());
    app.use('/api', createEnvVarsRouter());
    // Clear any BIZAR_TEST_ vars left from previous tests
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BIZAR_TEST_')) delete process.env[k];
    }
    app.use(createEnvVarsRouter());
  });

  it('GET /api/env-vars returns empty list when file does not exist', async () => {
    const res = await request(app, 'GET', '/api/env-vars');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'response should be an array');
    assert.equal(res.body.length, 0);
  });

  it('POST creates entry, GET lists it with masked value', async () => {
    const create = await request(app, 'POST', '/api/env-vars', {
      name: 'BIZAR_TEST_KEY',
      value: 'super-secret-value-123',
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.name, 'BIZAR_TEST_KEY');
    assert.ok(create.body.value.includes('*'), 'value should be masked');
    assert.ok(create.body.value.endsWith('-123'), 'masked value should include last 4 chars');
    assert.ok(create.body.createdAt, 'should have createdAt');

    const list = await request(app, 'GET', '/api/env-vars');
    assert.equal(list.status, 200);
    const entry = list.body.find((e) => e.name === 'BIZAR_TEST_KEY');
    assert.ok(entry, 'entry should be in list');
    assert.equal(entry.value, create.body.value, 'value should be masked on list');
  });

  it('PUT updates entry, DELETE removes it', async () => {
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_PUT', value: 'original' });
    const update = await request(app, 'PUT', '/api/env-vars/BIZAR_TEST_PUT', { value: 'updated-value' });
    assert.equal(update.status, 200);
    assert.ok(update.body.value.endsWith('lue'), 'updated value should be masked');

    // Verify in list
    const list = await request(app, 'GET', '/api/env-vars');
    const entry = list.body.find((e) => e.name === 'BIZAR_TEST_PUT');
    assert.ok(entry);

    // Delete
    const del = await request(app, 'DELETE', '/api/env-vars/BIZAR_TEST_PUT');
    assert.equal(del.status, 200);
    assert.ok(del.body.ok);

    // Verify gone
    const listAfter = await request(app, 'GET', '/api/env-vars');
    const gone = listAfter.body.find((e) => e.name === 'BIZAR_TEST_PUT');
    assert.equal(gone, undefined, 'entry should be deleted');
  });

  it('rejects invalid name (must match /^BIZAR_[A-Z0-9_]+$/)', async () => {
    const r1 = await request(app, 'POST', '/api/env-vars', { name: 'INVALID', value: 'x' });
    assert.equal(r1.status, 400);
    assert.ok(r1.body.error === 'invalid_name');

    const r2 = await request(app, 'POST', '/api/env-vars', { name: 'bizar_lowercase', value: 'x' });
    assert.equal(r2.status, 400);

    const r3 = await request(app, 'POST', '/api/env-vars', { name: 'BIZAR HAS_SPACE', value: 'x' });
    assert.equal(r3.status, 400);
  });

  it('creates env.json with mode 0600', async () => {
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_PERM', value: 'perm-check' });
    const mode = statSync(ENV_FILE).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0o600, got ${octal(mode)}`);
  });

  it('loadEnvJson sets process.env', async () => {
    // Create an env var
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_LOADENV', value: 'env-loaded-value' });

    // Delete from process.env to simulate fresh start
    delete process.env.BIZAR_TEST_LOADENV;

    // Call loadEnvJson
    const { loadEnvJson } = await import(`${REPO}/bizar-dash/src/server/routes/env-vars.mjs`);
    loadEnvJson();

    assert.equal(process.env.BIZAR_TEST_LOADENV, 'env-loaded-value',
      'process.env should be set after loadEnvJson');
  });

  it('DELETE removes from process.env', async () => {
    // Create
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_DELPROCESS', value: 'to-be-deleted' });
    assert.equal(process.env.BIZAR_TEST_DELPROCESS, 'to-be-deleted');

    // Delete via API
    await request(app, 'DELETE', '/api/env-vars/BIZAR_TEST_DELPROCESS');

    assert.equal(process.env.BIZAR_TEST_DELPROCESS, undefined,
      'process.env should be cleared after DELETE');
  });

  it('POST /api/env-vars/:name/test returns referenced and inProcessEnv', async () => {
    // Not in process.env yet
    const r1 = await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_REFS', value: 'refs-val' });
    assert.equal(r1.status, 201);

    const test = await request(app, 'POST', '/api/env-vars/BIZAR_TEST_REFS/test');
    assert.equal(test.status, 200);
    assert.ok(typeof test.body.referenced === 'boolean');
    assert.ok(typeof test.body.inProcessEnv === 'boolean');
    assert.equal(test.body.inProcessEnv, true, 'should be in process.env after creation');
  });

  it('409 on duplicate POST', async () => {
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_DUP', value: 'first' });
    const r = await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_TEST_DUP', value: 'second' });
    assert.equal(r.status, 409);
    assert.ok(r.body.error === 'already_exists');
  });

  it('404 on PUT/DELETE non-existent var', async () => {
    const put = await request(app, 'PUT', '/api/env-vars/BIZAR_NONEXISTENT', { value: 'x' });
    assert.equal(put.status, 404);

    const del = await request(app, 'DELETE', '/api/env-vars/BIZAR_NONEXISTENT');
    assert.equal(del.status, 404);
  });
});

function octal(n) {
  return '0o' + n.toString(8);
}
