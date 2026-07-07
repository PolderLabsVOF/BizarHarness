/**
 * tests/routes-doctor.test.mjs
 *
 * v6.0.0 — Tests for the Doctor REST surface:
 *
 *   GET  /api/doctor         — full snapshot
 *   GET  /api/doctor/health  — rolled-up status + groups
 *   POST /api/doctor/check   — single-check dispatch
 *
 * We stand up a minimal express server backed by the real
 * `routes/doctor.mjs` factory. The store reads `~/.config/bizar/`
 * on the host, so the tests must not require a pristine install —
 * any I/O failure path is handled by the store (returns [] / 'warn')
 * and the test assertions stay loose enough to pass on dev machines
 * AND on CI with no bizar installed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const DOCTOR_ROUTES = await import('../src/server/routes/doctor.mjs');

let server;
let baseUrl;

before(async () => {
  const router = DOCTOR_ROUTES.createDoctorRouter();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/doctor', router);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  try { server?.close?.(); } catch { /* ignore */ }
});

// ── GET /api/doctor ────────────────────────────────────────────────────────

describe('GET /api/doctor', () => {
  it('returns 200 + a snapshot with the documented top-level keys', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    for (const key of [
      'timestamp', 'bizarVersion', 'nodeVersion', 'platform', 'arch',
      'uptime', 'memory', 'disk', 'services', 'counts',
      'recentErrors', 'configHealth', 'cline', 'checks', 'health',
    ]) {
      assert.ok(key in body, `expected ${key} in snapshot`);
    }
    assert.strictEqual(body.nodeVersion, process.version);
    assert.ok(['ok', 'warn', 'fail'].includes(body.health.status));
  });

  it('counts include all expected numeric fields', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/`);
    const body = await r.json();
    for (const key of [
      'tasks', 'schedules', 'mods', 'providers', 'mcps', 'agents',
      'projects', 'workspaces', 'voiceNotes', 'evalRuns', 'backups',
    ]) {
      assert.strictEqual(typeof body.counts[key], 'number', `counts.${key}`);
    }
  });

  it('health.issues is an array', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/`);
    const body = await r.json();
    assert.ok(Array.isArray(body.health.issues));
  });
});

// ── GET /api/doctor/health ─────────────────────────────────────────────────

describe('GET /api/doctor/health', () => {
  it('returns 200 + rolled-up health with groups', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/health`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(typeof body.ts, 'string');
    assert.ok(['ok', 'warn', 'fail'].includes(body.status));
    assert.ok(Array.isArray(body.issues));
    assert.ok(body.groups);
    assert.ok(Array.isArray(body.groups.system));
    assert.ok(Array.isArray(body.groups.config));
    assert.ok(Array.isArray(body.groups.services));
  });

  it('derives status from issues', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/health`);
    const body = await r.json();
    const has = (s) => body.issues.some((i) => i.status === s);
    if (has('fail')) assert.strictEqual(body.status, 'fail');
    else if (has('warn')) assert.strictEqual(body.status, 'warn');
    else assert.strictEqual(body.status, 'ok');
  });
});

// ── POST /api/doctor/check ─────────────────────────────────────────────────

describe('POST /api/doctor/check', () => {
  it('returns 200 + the check for a known name', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkName: 'node' }),
    });
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.name, 'node');
    assert.ok(['ok', 'warn', 'fail'].includes(body.status));
    assert.strictEqual(typeof body.message, 'string');
  });

  it('returns 404 for an unknown check name', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkName: 'definitely-not-a-real-check' }),
    });
    assert.strictEqual(r.status, 404);
    const body = await r.json();
    assert.strictEqual(body.status, 'fail');
    assert.strictEqual(body.message, 'unknown check');
    assert.match(body.error, /Available: /);
  });

  it('returns 400 when checkName is missing', async () => {
    const r = await fetch(`${baseUrl}/api/doctor/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.status, 'fail');
    assert.match(body.message, /checkName required/);
  });

  it('accepts multiple known check names', async () => {
    for (const checkName of ['memory', 'cline-config', 'dashboard']) {
      const r = await fetch(`${baseUrl}/api/doctor/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkName }),
      });
      assert.strictEqual(r.status, 200);
      const body = await r.json();
      assert.strictEqual(body.name, checkName);
    }
  });
});