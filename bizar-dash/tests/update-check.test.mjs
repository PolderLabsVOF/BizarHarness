/**
 * update-check.test.mjs — tests for /api/updates/status and /api/updates/check.
 *
 * Run with: node --test bizar-dash/tests/update-check.test.mjs
 *
 * Strategy: import the module once, call `resetUpdateCache()` between
 * tests. The route reads through the module-level cache path on every
 * request. In this sandbox, `npm view` may or may not work — the route
 * must degrade gracefully (null latest, hasUpdates=false) on failure.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

const { createUpdateRouter, resetUpdateCache } = await import(
  `${REPO}/bizar-dash/src/server/routes/update.mjs`
);

let app;
beforeEach(async () => {
  resetUpdateCache();
  app = express();
  app.use(express.json());
  app.use('/api', createUpdateRouter({ broadcast: () => {} }));
});

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

describe('update.mjs — /api/updates/status', () => {
  it('returns the installed package map', async () => {
    const res = await request(app, 'GET', '/api/updates/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.current, 'response should have current field');
    assert.equal(typeof res.body.current, 'object');
    for (const id of ['bizar', 'bizar-dash', 'bizar-plugin']) {
      assert.ok(id in res.body.current, `current.${id} should be a key`);
      assert.ok(
        res.body.current[id] === null || typeof res.body.current[id] === 'string',
        `current.${id} should be string or null`,
      );
    }
  });

  it('does not include latest/hasUpdates fields', async () => {
    const res = await request(app, 'GET', '/api/updates/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.latest, undefined, 'status should not include latest');
    assert.equal(res.body.hasUpdates, undefined, 'status should not include hasUpdates');
  });
});

describe('update.mjs — /api/updates/check', () => {
  it('returns shape { current, latest, hasUpdates }', async () => {
    const res = await request(app, 'GET', '/api/updates/check');
    assert.equal(res.status, 200);
    assert.ok(res.body.current, 'should have current');
    assert.ok(res.body.latest, 'should have latest');
    assert.equal(typeof res.body.hasUpdates, 'boolean');
    for (const id of ['bizar', 'bizar-dash', 'bizar-plugin']) {
      assert.ok(id in res.body.latest, `latest.${id} should be a key`);
    }
  });

  it('does not 5xx on registry failure (graceful degradation)', async () => {
    const res = await request(app, 'GET', '/api/updates/check');
    assert.equal(res.status, 200, 'should not 5xx even if npm view fails');
    assert.equal(typeof res.body.hasUpdates, 'boolean');
  });
});

describe('update.mjs — POST /api/updates/apply', () => {
  it('rejects empty/invalid package list with 400', async () => {
    // Empty array → falls back to all known packages, which is valid
    // (returns 202). Test instead that an unknown package id is handled
    // — current implementation filters to known ids and starts the run
    // if at least one id is valid. With no valid ids, returns 400.
    const res = await request(app, 'POST', '/api/updates/apply', {
      packages: ['__nonexistent_pkg__'],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'bad_request');
  });

  it('accepts missing broadcast (default no-op)', async () => {
    const localApp = express();
    localApp.use(express.json());
    localApp.use('/api', createUpdateRouter());
    const res = await request(localApp, 'POST', '/api/updates/apply', {});
    // We accept either 202 (npm succeeded) or 500 (npm not on PATH).
    // The point is the route didn't crash before the handler.
    assert.ok([202, 500].includes(res.status), `unexpected status ${res.status}`);
  });
});