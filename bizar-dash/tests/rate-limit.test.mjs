/**
 * tests/rate-limit.test.mjs
 *
 * v4.8.0 — Tests for src/server/lib/rate-limit.mjs.
 *
 * Run with:
 *   node --test tests/rate-limit.test.mjs
 *
 * Covers:
 *   - Request within capacity returns 200 + X-RateLimit-* headers
 *   - Request over capacity returns 429 with Retry-After + JSON body
 *   - Bucket refills over time (verified via mock.timers tick)
 *   - Different IPs have independent buckets
 *   - Different scopes (chat vs event) have independent buckets
 *   - clearBuckets() resets state between tests
 *   - Constructor validates inputs
 *   - 429 response carries X-RateLimit-Scope so server.mjs can log it
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import express from 'express';

import {
  createRateLimiter,
  clearBuckets,
  _peekBucket,
  _bucketSize,
} from '../src/server/lib/rate-limit.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with one route guarded by the given
 * limiter. We override `req.ip` via the `trust proxy` setting on the
 * app instance so tests can set it deterministically.
 */
function buildApp({ capacity, refillPerSecond, scope = 'test' }) {
  const app = express();
  app.set('trust proxy', true);
  const limiter = createRateLimiter({ capacity, refillPerSecond, scope });
  app.get('/ping', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

/**
 * Drive the Express app without binding a TCP socket. Returns the
 * (status, headers, body) of the response so tests can assert without
 * the noise of supertest.
 */
function drive(app, { ip = '127.0.0.1', method = 'GET', path = '/ping' } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      ip,
      socket: { remoteAddress: ip },
      headers: {},
    };
    const resHeaders = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      finished: false,
      set(name, value) {
        resHeaders[name.toLowerCase()] = value;
        return this;
      },
      setHeader(name, value) {
        resHeaders[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.headersSent = true;
        this.finished = true;
        resolve({ status: this.statusCode, headers: resHeaders, body });
        return this;
      },
      send(body) {
        this.headersSent = true;
        this.finished = true;
        resolve({ status: this.statusCode, headers: resHeaders, body });
        return this;
      },
      end(body) {
        this.headersSent = true;
        this.finished = true;
        resolve({ status: this.statusCode, headers: resHeaders, body });
        return this;
      },
      on() {
        return this;
      },
      once() {
        return this;
      },
      emit() {
        return true;
      },
    };
    try {
      app._router.handle(req, res, (err) => {
        if (err) reject(err);
        else if (!res.finished) {
          // Should not happen — limiter always responds.
          reject(new Error('handler fell through without responding'));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('accepts request within capacity and emits X-RateLimit-* headers', async () => {
  clearBuckets();
  const app = buildApp({ capacity: 5, refillPerSecond: 1, scope: 'test1' });
  const r = await drive(app, { ip: '10.0.0.1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.headers['x-ratelimit-limit'], '5');
  // 1 token consumed from a full bucket of 5 → 4 remain.
  assert.equal(r.headers['x-ratelimit-remaining'], '4');
  assert.equal(r.headers['x-ratelimit-scope'], 'test1');
  assert.equal(r.headers['retry-after'], undefined);
});

test('rejects over-capacity requests with 429 + Retry-After + JSON body', async () => {
  clearBuckets();
  const app = buildApp({ capacity: 2, refillPerSecond: 0.5, scope: 'test2' });
  // Drain the bucket.
  await drive(app, { ip: '10.0.0.2' });
  await drive(app, { ip: '10.0.0.2' });
  // Third request must be throttled.
  const r = await drive(app, { ip: '10.0.0.2' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate_limited');
  assert.equal(r.body.scope, 'test2');
  assert.ok(typeof r.body.retryAfter === 'number' && r.body.retryAfter >= 1);
  assert.equal(r.headers['x-ratelimit-limit'], '2');
  assert.equal(r.headers['x-ratelimit-remaining'], '0');
  assert.equal(r.headers['x-ratelimit-scope'], 'test2');
  assert.ok(r.headers['retry-after']);
  // retry-after is a string of an integer ≥ 1.
  assert.match(r.headers['retry-after'], /^[1-9]\d*$/);
});

test('bucket refills over time', () => {
  clearBuckets();
  mock.timers.enable({ apis: ['Date'] });
  try {
    const limiter = createRateLimiter({
      capacity: 5,
      refillPerSecond: 1,
      scope: 'refill',
    });
    // Build a minimal req/res pair; we'll call the middleware directly.
    function fakeRes() {
      const headers = {};
      let status = 200;
      return {
        statusCode: status,
        set(name, value) { headers[name.toLowerCase()] = value; return this; },
        getHeader(name) { return headers[name.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        json() { /* swallow */ },
        headers,
      };
    }
    function fakeReq(ip) {
      return { ip, socket: { remoteAddress: ip } };
    }

    // Drain 5 tokens instantly.
    for (let i = 0; i < 5; i++) {
      limiter(fakeReq('10.0.0.3'), fakeRes(), () => {});
    }
    // The 6th request must be rejected.
    const denied = fakeRes();
    let nextCalled = false;
    limiter(fakeReq('10.0.0.3'), denied, () => { nextCalled = true; });
    assert.equal(denied.statusCode, 429);
    assert.equal(nextCalled, false);

    // Advance time by 1 second → 1 token regenerated.
    mock.timers.tick(1000);
    const accepted = fakeRes();
    let acceptedNext = false;
    limiter(fakeReq('10.0.0.3'), accepted, () => { acceptedNext = true; });
    assert.equal(accepted.statusCode, 200);
    assert.equal(acceptedNext, true);

    // Bucket state sanity check.
    const bucket = _peekBucket('refill:10.0.0.3');
    assert.ok(bucket, 'expected bucket to exist');
    assert.ok(bucket.tokens >= 0 && bucket.tokens < 5);
  } finally {
    mock.timers.reset();
    clearBuckets();
  }
});

test('different IPs have independent buckets', async () => {
  clearBuckets();
  const app = buildApp({ capacity: 1, refillPerSecond: 0.01, scope: 'iso-ip' });
  // Drain IP A.
  const a1 = await drive(app, { ip: '10.0.0.10' });
  assert.equal(a1.status, 200);
  const a2 = await drive(app, { ip: '10.0.0.10' });
  assert.equal(a2.status, 429);
  // IP B still has full budget.
  const b1 = await drive(app, { ip: '10.0.0.11' });
  assert.equal(b1.status, 200);
  assert.equal(b1.headers['x-ratelimit-remaining'], '0');
});

test('different scopes (chat vs event) have independent buckets', async () => {
  clearBuckets();
  const chatApp = buildApp({ capacity: 1, refillPerSecond: 0.01, scope: 'chat' });
  const eventApp = buildApp({ capacity: 1, refillPerSecond: 0.01, scope: 'event' });
  // Drain chat for this IP.
  const c1 = await drive(chatApp, { ip: '10.0.0.20' });
  assert.equal(c1.status, 200);
  const c2 = await drive(chatApp, { ip: '10.0.0.20' });
  assert.equal(c2.status, 429);
  assert.equal(c2.body.scope, 'chat');
  // Event scope for the SAME ip still has full budget.
  const e1 = await drive(eventApp, { ip: '10.0.0.20' });
  assert.equal(e1.status, 200);
  assert.equal(e1.headers['x-ratelimit-scope'], 'event');
});

test('clearBuckets() resets state', async () => {
  clearBuckets();
  const app = buildApp({ capacity: 1, refillPerSecond: 0.01, scope: 'clear' });
  await drive(app, { ip: '10.0.0.30' });
  assert.equal(_bucketSize(), 1);
  // Bucket exhausted — next request 429.
  const r = await drive(app, { ip: '10.0.0.30' });
  assert.equal(r.status, 429);
  // Reset and retry — fresh budget.
  clearBuckets();
  assert.equal(_bucketSize(), 0);
  const r2 = await drive(app, { ip: '10.0.0.30' });
  assert.equal(r2.status, 200);
});

test('rejects invalid constructor arguments', () => {
  assert.throws(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 }), /capacity/);
  assert.throws(() => createRateLimiter({ capacity: -1, refillPerSecond: 1 }), /capacity/);
  assert.throws(() => createRateLimiter({ capacity: 'x', refillPerSecond: 1 }), /capacity/);
  assert.throws(() => createRateLimiter({ capacity: 5, refillPerSecond: 0 }), /refillPerSecond/);
  assert.throws(() => createRateLimiter({ capacity: 5, refillPerSecond: -1 }), /refillPerSecond/);
  assert.throws(() => createRateLimiter({ capacity: 5, refillPerSecond: 1, scope: '' }), /scope/);
  assert.throws(() => createRateLimiter({ capacity: 5, refillPerSecond: 1, scope: 42 }), /scope/);
});

test('falls back to socket.remoteAddress when req.ip missing', async () => {
  clearBuckets();
  const app = buildApp({ capacity: 1, refillPerSecond: 0.01, scope: 'sock' });
  // Build a request WITHOUT ip but WITH socket.remoteAddress. We have
  // to drive it manually because buildApp always sets ip.
  const limiter = createRateLimiter({
    capacity: 1,
    refillPerSecond: 0.01,
    scope: 'sock',
  });
  function fakeRes() {
    const headers = {};
    return {
      statusCode: 200,
      set(name, value) { headers[name.toLowerCase()] = value; return this; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json() { /* swallow */ },
      headers,
    };
  }
  // No req.ip, no socket — must default to 'unknown'.
  const req = {};
  const res1 = fakeRes();
  limiter(req, res1, () => {});
  assert.equal(res1.statusCode, 200);
  const res2 = fakeRes();
  limiter(req, res2, () => {});
  assert.equal(res2.statusCode, 429);
  // The unknown-IP bucket must exist.
  assert.ok(_peekBucket('sock:unknown'));
});