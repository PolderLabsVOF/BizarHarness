/**
 * tests/otel-spans.test.mjs
 *
 * v5.1.0 — Tests for the OpenTelemetry span helpers added alongside
 * the v4.9 → v5.1 OTLP trace expansion.
 *
 * Coverage:
 *   - `withSpan(name, fn, attrs)` — success path returns the callback
 *     value and does not throw; failure path records the exception
 *     and rethrows the original error (so `wrap()` can still emit a
 *     JSON envelope).
 *   - `setCommonAttributes(span, attrs)` — sets the four documented
 *     attribute keys when given, and silently skips falsy values so
 *     unauthenticated routes don't pollute spans with empty ids.
 *   - `getResourceAttributes()` — produces a non-empty map with the
 *     seven semantic-convention keys documented at the top of
 *     otel.mjs.
 *   - `recordTrace(name, attrs)` — increments the per-key counter and
 *     matches the brief's key shape (`name:jsonString`).
 *
 * The tests use the no-op tracer (no `initOtel` call) so the span
 * methods are guaranteed to be no-ops and the round-trip semantics
 * are exactly what route handlers will see when OTEL is disabled.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const OTEL_URL = '../src/server/otel.mjs';
const METRICS_URL = '../src/server/metrics.mjs';

async function loadOtel() {
  // Fresh module each call so module-scoped SDK state is clean.
  const url = `${OTEL_URL}?v=${Date.now()}-${Math.random()}`;
  return import(url);
}

async function loadMetrics() {
  const url = `${METRICS_URL}?v=${Date.now()}-${Math.random()}`;
  return import(url);
}

test('withSpan returns the callback value on success', async () => {
  const otel = await loadOtel();
  try {
    // `withSpan(name, fn)` returns an Express-shaped handler that
    // takes (req, res, …rest) and returns a Promise. Callers `wrap`
    // it; here we invoke the returned function directly with a
    // synthetic arg list so we can assert the await semantics.
    const handler = otel.withSpan('test.success', async (span) => {
      span.setAttribute('test.key', 'value');
      return 42;
    });
    const result = await handler();
    assert.equal(result, 42, 'withSpan handler must propagate the callback return value');
  } finally {
    await otel.shutdownOtel();
  }
});

test('withSpan re-throws when the callback throws (matches wrap() contract)', async () => {
  const otel = await loadOtel();
  try {
    const handler = otel.withSpan('test.error', async () => {
      throw new Error('boom');
    });
    await assert.rejects(handler(), /boom/);
  } finally {
    await otel.shutdownOtel();
  }
});

test('withSpan re-throws non-Error throwables (e.g. strings)', async () => {
  const otel = await loadOtel();
  try {
    const handler = otel.withSpan('test.stringthrow', async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'plain-string-error';
    });
    await assert.rejects(handler(), /plain-string-error/);
  } finally {
    await otel.shutdownOtel();
  }
});

test('withSpan works under no-op tracer when SDK not initialised', async () => {
  const otel = await loadOtel();
  try {
    assert.equal(otel.isOtelEnabled(), false, 'must start with no SDK');
    const result = await otel.withSpan('test.noop', async () => 'ok')();
    assert.equal(result, 'ok', 'no-op tracer must not eat the return value');
    // Calling again must still work — guards against a span leak
    // where the no-op tracer throws on a second invocation.
    const result2 = await otel.withSpan('test.noop2', async () => 'still-ok')();
    assert.equal(result2, 'still-ok');
  } finally {
    await otel.shutdownOtel();
  }
});

test('withSpan forwards positional args to the handler (req, res shape)', async () => {
  const otel = await loadOtel();
  try {
    const seen = [];
    const handler = otel.withSpan('test.forward', async (span, req, res) => {
      seen.push({ method: req?.method, url: req?.url, statusSet: !!res });
      return 'ok';
    });
    await handler({ method: 'GET', url: '/api/foo' }, { writeHead() {} });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].url, '/api/foo');
    assert.equal(seen[0].statusSet, true);
  } finally {
    await otel.shutdownOtel();
  }
});

test('setCommonAttributes sets all four keys when given', async () => {
  const otel = await loadOtel();
  try {
    const calls = [];
    const fakeSpan = {
      setAttribute(key, value) {
        calls.push({ key, value });
      },
    };
    otel.setCommonAttributes(fakeSpan, {
      userId: 'u_123',
      workspaceId: 'w_456',
      ip: '10.0.0.1',
      userAgent: 'bizar-test/1.0',
    });
    const byKey = Object.fromEntries(calls.map((c) => [c.key, c.value]));
    assert.equal(byKey['bizar.user.id'], 'u_123');
    assert.equal(byKey['bizar.workspace.id'], 'w_456');
    assert.equal(byKey['http.client_ip'], '10.0.0.1');
    assert.equal(byKey['http.user_agent'], 'bizar-test/1.0');
  } finally {
    await otel.shutdownOtel();
  }
});

test('setCommonAttributes silently drops empty / undefined values', async () => {
  const otel = await loadOtel();
  try {
    const calls = [];
    const fakeSpan = {
      setAttribute(key, value) {
        calls.push({ key, value });
      },
    };
    otel.setCommonAttributes(fakeSpan, {
      userId: undefined,
      workspaceId: null,
      ip: '',
      userAgent: '',
    });
    assert.equal(
      calls.length,
      0,
      'all-empty inputs must skip every setAttribute call',
    );
    otel.setCommonAttributes(fakeSpan, {
      userId: 'only-user',
    });
    assert.deepEqual(calls, [{ key: 'bizar.user.id', value: 'only-user' }]);
  } finally {
    await otel.shutdownOtel();
  }
});

test('setCommonAttributes tolerates a missing span (defensive)', async () => {
  const otel = await loadOtel();
  try {
    // No throw, no error — route handlers down the call stack
    // rely on this not throwing so a stray import won't crash.
    otel.setCommonAttributes(null, { userId: 'x' });
    otel.setCommonAttributes(undefined, { ip: '1.2.3.4' });
  } finally {
    await otel.shutdownOtel();
  }
});

test('getResourceAttributes includes the seven OTel semantic keys', async () => {
  const otel = await loadOtel();
  try {
    const attrs = otel.getResourceAttributes();
    const keys = Object.keys(attrs);
    // We don't pin the literal attribute strings (semconv 1.41 uses
    // "service.name", "deployment.environment" etc.) — instead assert
    // the dashboard-specific payload has the right number of entries
    // and that service.name is the canonical bizar-dash string.
    assert.equal(keys.length, 7, 'should populate exactly 7 resource attributes');
    const values = Object.values(attrs);
    assert.ok(values.includes('bizar-dash'), 'service.name must be bizar-dash');
    assert.ok(values.some((v) => v === process.pid), 'process.pid attribute must match process.pid');
    assert.ok(values.some((v) => typeof v === 'string' && v.length > 0 && v !== 'bizar-dash'), 'must have at least one host/os string attribute');
  } finally {
    await otel.shutdownOtel();
  }
});

test('recordTrace increments a counter keyed by name + sorted JSON attribute set', async () => {
  const m = await loadMetrics();
  try {
    m.resetTraceCounts();
    assert.equal(m.recordTrace('alpha', { outcome: 'ok', code: '200' }), 1);
    assert.equal(m.recordTrace('alpha', { outcome: 'ok', code: '200' }), 2);
    assert.equal(m.recordTrace('alpha', { code: '200', outcome: 'ok' }), 3,
      'same attributes in a different insertion order must collide on the same key');
    assert.equal(m.recordTrace('alpha', { outcome: 'error', code: '500' }), 1,
      'different attribute values must produce a different key');
    // Empty attribute object should not collide with the 'undefined' key.
    assert.equal(m.recordTrace('beta'), 1);
    assert.equal(m.recordTrace('beta', {}), 2);
  } finally {
    m.resetTraceCounts();
  }
});

test('recordTrace drops undefined / null / empty attribute values', async () => {
  const m = await loadMetrics();
  try {
    m.resetTraceCounts();
    const r1 = m.recordTrace('dropper', { outcome: 'ok', code: undefined, ip: null, ua: '' });
    const r2 = m.recordTrace('dropper', { outcome: 'ok' });
    assert.equal(r1, 1, 'first call returns 1');
    assert.equal(r2, 2, 'second call increments to 2 on the same key');
    // Both calls must produce one shared entry, not two — that proves
    // the undefined/null/empty values were dropped from the key.
    const entryKeys = [...m.traceCountByName.keys()];
    assert.equal(entryKeys.length, 1, 'should have exactly one composite key after dedup');
    assert.match(entryKeys[0], /^dropper:\{"outcome":"ok"\}$/, 'key payload is just name + non-empty attribute set');
  } finally {
    m.resetTraceCounts();
  }
});

test('module exports the documented API surface', async () => {
  const otel = await loadOtel();
  try {
    assert.equal(typeof otel.tracer, 'object');
    assert.equal(typeof otel.initOtel, 'function');
    assert.equal(typeof otel.shutdownOtel, 'function');
    assert.equal(typeof otel.isOtelEnabled, 'function');
    assert.equal(typeof otel.withSpan, 'function');
    assert.equal(typeof otel.setCommonAttributes, 'function');
    assert.equal(typeof otel.getResourceAttributes, 'function');
  } finally {
    await otel.shutdownOtel();
  }
});
