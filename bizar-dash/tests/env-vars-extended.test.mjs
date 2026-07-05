/**
 * env-vars-extended.test.mjs — tests for bulk-import, export, grouped endpoints.
 *
 * Run with: node --test bizar-dash/tests/env-vars-extended.test.mjs
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = join(import.meta.dirname, '..', '..');

let SANDBOX_HOME;
let ORIGINAL_HOME;
let ENV_FILE;

before(() => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-env-vars-ext-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = SANDBOX_HOME;
  const BIZAR_DIR = join(SANDBOX_HOME, '.config', 'bizar');
  ENV_FILE = join(BIZAR_DIR, 'env.json');
});

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('BIZAR_EXT_')) delete process.env[k];
  }
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function request(app, method, path, body) {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const bodyStr = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: '127.0.0.1', port, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(data), raw: data, headers: res.headers }); }
          catch { resolve({ status: res.statusCode, body: data, raw: data, headers: res.headers }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// Track which keys this test file uses so we can clean them up
const TEST_KEYS = new Set();

describe('env-vars extended endpoints', () => {
  let app;

  beforeEach(async () => {
    // Delete env file to start fresh
    try { rmSync(ENV_FILE); } catch { /* ignore */ }
    // Import fresh module
    const express = (await import('express')).default;
    const { createEnvVarsRouter } = await import(`${REPO}/bizar-dash/src/server/routes/env-vars.mjs`);
    // Force store re-init
    const { resetStore } = await import(`${REPO}/bizar-dash/src/server/routes/env-vars.mjs`);
    resetStore();
    app = express();
    app.use(express.json());
    app.use('/api', createEnvVarsRouter());
    // Clear test keys from process.env
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BIZAR_EXT_')) delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('BIZAR_EXT_')) delete process.env[k];
    }
  });

  // ─── POST /api/env-vars/bulk-import ───────────────────────────────────────

  it('bulk-import parses KEY=value lines', async () => {
    const res = await request(app, 'POST', '/api/env-vars/bulk-import', {
      envContent: 'BIZAR_EXT_A=value1\nBIZAR_EXT_B=value2',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.skipped, 0);
    assert.deepEqual(res.body.errors, []);
  });

  it('bulk-import skips existing keys', async () => {
    // Pre-create one
    const create = await request(app, 'POST', '/api/env-vars', {
      name: 'BIZAR_EXT_EXISTING', value: 'original',
    });
    assert.equal(create.status, 201);

    const bulk = await request(app, 'POST', '/api/env-vars/bulk-import', {
      envContent: 'BIZAR_EXT_EXISTING=ignored\nBIZAR_EXT_NEWBULK=fresh',
    });
    assert.equal(bulk.body.imported, 1, 'should import only the new key');
    assert.equal(bulk.body.skipped, 1, 'should skip the existing key');
    assert.ok(bulk.body.errors.some((e) => e.includes('Already exists')));
  });

  it('bulk-import reports invalid lines in errors', async () => {
    const res = await request(app, 'POST', '/api/env-vars/bulk-import', {
      envContent: 'BIZAR_ext_invalid=value\nBIZAR_EXT_VALID=good\nBIZAR_EXT_NOEquals\nBOGUS_PREFIX=bad',
    });
    assert.equal(res.body.imported, 1, 'only valid entries are imported');
    assert.ok(res.body.errors.length >= 2, 'should have errors for invalid lines');
  });

  it('bulk-import skips blank lines and comments', async () => {
    const res = await request(app, 'POST', '/api/env-vars/bulk-import', {
      envContent: '# comment\n\n  \nBIZAR_EXT_TRIMMED=value',
    });
    assert.equal(res.body.imported, 1);
    assert.equal(res.body.skipped, 3, 'comment and two blank/whitespace lines are skipped');
  });

  it('bulk-import requires envContent string', async () => {
    const res = await request(app, 'POST', '/api/env-vars/bulk-import', {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'envContent_required');
  });

  // ─── GET /api/env-vars/export ─────────────────────────────────────────────

  it('export produces valid .env format', async () => {
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_EXT_EXPORT1', value: 'val-one' });
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_EXT_EXPORT2', value: 'val-two' });

    const res = await request(app, 'GET', '/api/env-vars/export');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/plain'), 'should be text/plain');
    assert.ok(res.headers['content-disposition']?.includes('.env'), 'should have .env content-disposition');
    const lines = res.raw.split('\n').filter(Boolean);
    assert.ok(lines.some((l) => l === 'BIZAR_EXT_EXPORT1=val-one'));
    assert.ok(lines.some((l) => l === 'BIZAR_EXT_EXPORT2=val-two'));
  });

  it('export returns empty string when no vars', async () => {
    const res = await request(app, 'GET', '/api/env-vars/export');
    assert.equal(res.status, 200);
    assert.equal(res.raw.trim(), '');
  });

  // ─── GET /api/env-vars/grouped ───────────────────────────────────────────

  it('grouping splits vars by prefix', async () => {
    // All vars must start with BIZAR_ per NAME_RE
    // Grouping is by the "prefix" after BIZAR_ (e.g. EXT_, PROVIDER_, MODEL_)
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_EXT_A', value: 'v1' });
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_EXT_B', value: 'v2' });
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_PROVIDER_KEY', value: 'pv' });
    await request(app, 'POST', '/api/env-vars', { name: 'BIZAR_MODEL_SETTING', value: 'ms' });

    const res = await request(app, 'GET', '/api/env-vars/grouped');
    assert.equal(res.status, 200);
    const groups = res.body;
    const groupKeys = Object.keys(groups).sort();
    // BIZAR_EXT_* -> EXT_ prefix, BIZAR_PROVIDER_* -> PROVIDER_, BIZAR_MODEL_* -> MODEL_
    assert.ok(groupKeys.includes('EXT_'), `should have EXT_ group, got: ${groupKeys.join(',')}`);
    assert.ok(groupKeys.includes('PROVIDER_'), `should have PROVIDER_ group, got: ${groupKeys.join(',')}`);
    assert.ok(groupKeys.includes('MODEL_'), `should have MODEL_ group, got: ${groupKeys.join(',')}`);
    assert.equal(groups['EXT_'].length, 2, 'BIZAR_EXT_* vars');
    assert.equal(groups['PROVIDER_'].length, 1);
    assert.equal(groups['MODEL_'].length, 1);
    assert.ok(groups['EXT_'][0].value.includes('*'), 'values should be masked');
  });

  it('grouped returns empty object when no vars', async () => {
    const res = await request(app, 'GET', '/api/env-vars/grouped');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {});
  });
});
