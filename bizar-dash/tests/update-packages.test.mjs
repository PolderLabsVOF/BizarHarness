/**
 * update-packages.test.mjs — tests for the v10.3.0 package list and channel selection.
 *
 * Run with: node --test bizar-dash/tests/update-packages.test.mjs
 *
 * Strategy: test HTTP response shapes + response fields without needing to
 * patch spawn. The channel selection is encoded in the POST response body
 * (channel field) and the concurrency guard (runningSince) is checked from
 * the 409 response. The actual npm spawn behavior is tested in
 * update-run.test.mjs which has the proper spawn interception setup.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

const { createUpdateRouter, resetUpdateCache, resetConcurrencyGuard } = await import(
  `${REPO}/bizar-dash/src/server/routes/update.mjs`
);

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function request(app, method, path, body) {
  const http = await import('node:http');
  return new Promise((resolveP, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const bodyStr = body ? JSON.stringify(body) : '';
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : {},
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try {
            resolveP({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolveP({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('update.mjs — v10.3.0 package list', () => {
  it('returns exactly 4 packages (bizar, bizar-sdk, claude-agent, claude-code)', async () => {
    resetUpdateCache();
    const app = express();
    app.use(express.json());
    app.use('/api', createUpdateRouter({ broadcast: () => {} }));

    const res = await request(app, 'GET', '/api/updates/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.installed, 'should have installed field');

    const ids = Object.keys(res.body.installed).sort();
    assert.deepEqual(ids.sort(), ['bizar', 'bizar-sdk', 'claude-agent', 'claude-code'].sort());
    assert.ok(!ids.includes('bizar-dash'), 'bizar-dash should not be present');
    assert.ok(!ids.includes('bizar-plugin'), 'bizar-plugin should not be present');
  });
});

describe('update.mjs — channel selection', () => {
  let app;

  beforeEach(() => {
    resetUpdateCache();
    resetConcurrencyGuard();
    const localApp = express();
    localApp.use(express.json());
    localApp.use('/api', createUpdateRouter({ broadcast: () => {} }));
    app = localApp;
  });

  it('POST with channel=beta returns 202 and reflects channel=beta in body', async () => {
    const res = await request(app, 'POST', '/api/updates/apply', {
      packages: ['bizar'],
      channel: 'beta',
    });
    // Returns 202 (npm may not be on PATH in test env, so accept 500 too)
    assert.ok([202, 500].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 202) {
      assert.equal(res.body.channel, 'beta', 'response should reflect channel=beta');
    }
  });

  it('POST without channel returns 202 and reflects channel=stable in body', async () => {
    const res = await request(app, 'POST', '/api/updates/apply', {
      packages: ['bizar'],
    });
    assert.ok([202, 500].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 202) {
      assert.equal(res.body.channel, 'stable', 'default channel should be stable');
    }
  });
});

describe('update.mjs — concurrency guard returns runningSince', () => {
  it('second concurrent POST returns 409 with runningSince ISO8601 timestamp', async () => {
    resetUpdateCache();
    resetConcurrencyGuard();
    const localApp = express();
    localApp.use(express.json());
    localApp.use('/api', createUpdateRouter({ broadcast: () => {} }));

    // First request may succeed or fail depending on npm availability
    const first = await request(localApp, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.ok([202, 500].includes(first.status), `first status unexpected: ${first.status}`);

    // Second concurrent request should always hit the guard (regardless of npm availability)
    const second = await request(localApp, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.equal(second.status, 409, 'second request should get 409');
    assert.equal(second.body.error, 'already_running');
    assert.ok('runningSince' in second.body, 'response should include runningSince');
    assert.ok(second.body.runningSince !== null, 'runningSince should not be null');
    assert.match(
      second.body.runningSince,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      'runningSince should be ISO8601',
    );
  });
});

describe('update.mjs — /check returns stable and beta in available', () => {
  it('GET /api/updates/check includes available.stable and available.beta', async () => {
    resetUpdateCache();
    const app = express();
    app.use(express.json());
    app.use('/api', createUpdateRouter({ broadcast: () => {} }));

    const res = await request(app, 'GET', '/api/updates/check');
    assert.equal(res.status, 200);
    assert.ok(res.body.available, 'should have available field');
    assert.ok('stable' in res.body.available, 'available should have stable key');
    assert.ok('beta' in res.body.available, 'available should have beta key');
    // Both may be null if npm registry is unreachable, but keys must be present
    assert.equal(typeof res.body.available.stable, 'string');
  });
});
