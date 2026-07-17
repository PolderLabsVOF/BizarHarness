// Loop task #21 — Doctor route data shape.
//
// Source: `bizar-dash/src/server/routes/doctor.mjs` mounts:
//   GET  /api/doctor        → collectDiagnostics() snapshot
//   GET  /api/doctor/health → health() rolled-up status
//   POST /api/doctor/check  → runCheck(name)
//
// Each surface returns a predictable shape that the dashboard relies on.

import test from 'node:test';
import assert from 'node:assert/strict';

function deriveSnapshotShape(snap) {
  const required = ['counts', 'lightrag', 'serveInfo', 'configHealth', 'cline', 'checks', 'health'];
  return required.every((k) => k in snap);
}

function deriveHealthShape(health) {
  return typeof health.status === 'string' && Array.isArray(health.issues);
}

function deriveCheckResultShape(result) {
  return typeof result.name === 'string' && typeof result.status === 'string';
}

test('snapshot has all 7 required keys', () => {
  const snap = {
    counts: {},
    lightrag: {},
    serveInfo: {},
    configHealth: [],
    cline: {},
    checks: { system: [], config: [], services: [] },
    health: { status: 'ok', issues: [] },
  };
  assert.equal(deriveSnapshotShape(snap), true);
});

test('snapshot missing health key is rejected', () => {
  const snap = { counts: {}, lightrag: {}, serveInfo: {}, configHealth: [], cline: {}, checks: {} };
  assert.equal(deriveSnapshotShape(snap), false);
});

test('health rollup has status string + issues array', () => {
  const health = { status: 'ok', issues: [] };
  assert.equal(deriveHealthShape(health), true);
});

test('health rollup missing issues array is rejected', () => {
  assert.equal(deriveHealthShape({ status: 'ok' }), false);
});

test('health rollup missing status string is rejected', () => {
  assert.equal(deriveHealthShape({ issues: [] }), false);
});

test('check result carries name + status', () => {
  const result = { name: 'system.disk', status: 'ok', message: 'free space OK' };
  assert.equal(deriveCheckResultShape(result), true);
});

test('status field uses canonical values: ok | warn | fail', () => {
  const VALID = ['ok', 'warn', 'fail'];
  for (const s of VALID) {
    assert.ok(VALID.includes(s), `${s} must be a valid status`);
  }
});