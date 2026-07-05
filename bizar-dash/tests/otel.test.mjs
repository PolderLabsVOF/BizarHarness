/**
 * tests/otel.test.mjs — v4.9.0
 *
 * Tests for src/server/otel.mjs. The OpenTelemetry SDK and helpers
 * must:
 *   - export a `tracer` that has `startActiveSpan` (works even before
 *     `initOtel()` is called, because the no-op global tracer covers
 *     the uninitialised case)
 *   - return an SDK instance from `initOtel()` and only initialise
 *     once across repeated calls
 *   - shut down cleanly via `shutdownOtel()`, even when the OTLP
 *     endpoint is unreachable
 *   - tolerate a malformed endpoint / thrown init error without
 *     crashing the importing module
 *
 * Each test loads the module via a fresh URL to defeat Node's ESM
 * module cache; `otel.mjs` uses module-scoped state (the `sdk` and
 * `shuttingDown` lets) and we want each test to see its own clean
 * registry the same way `metrics.test.mjs` does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const OTEL_URL = '../src/server/otel.mjs';

async function loadOtel() {
  const url = `${OTEL_URL}?v=${Date.now()}-${Math.random()}`;
  return import(url);
}

test('tracer is exported and has startActiveSpan', async () => {
  const otel = await loadOtel();
  try {
    assert.equal(typeof otel.tracer, 'object');
    assert.equal(typeof otel.tracer.startActiveSpan, 'function');
  } finally {
    await otel.shutdownOtel();
  }
});

test('initOtel() returns an SDK instance and is idempotent', async () => {
  const otel = await loadOtel();
  try {
    // Before init: isOtelEnabled() is false (fresh module load).
    assert.equal(otel.isOtelEnabled(), false);
    const sdk1 = otel.initOtel({
      // Use an endpoint that won't connect; the test only cares
      // that the SDK object is returned, not that spans export.
      endpoint: 'http://127.0.0.1:1/v1/traces',
    });
    assert.ok(sdk1, 'initOtel should return a non-null SDK instance');
    assert.equal(otel.isOtelEnabled(), true);

    const sdk2 = otel.initOtel({ endpoint: 'http://127.0.0.1:1/v1/traces' });
    assert.equal(
      sdk1,
      sdk2,
      'a second initOtel() call must return the cached SDK instance',
    );
  } finally {
    await otel.shutdownOtel();
  }
});

test('shutdownOtel() is callable and resets the SDK cache', async () => {
  const otel = await loadOtel();
  try {
    otel.initOtel({ endpoint: 'http://127.0.0.1:1/v1/traces' });
    assert.equal(otel.isOtelEnabled(), true);
    await otel.shutdownOtel();
    assert.equal(otel.isOtelEnabled(), false);

    // Calling shutdownOtel again must be a no-op (does not throw).
    await otel.shutdownOtel();
    assert.equal(otel.isOtelEnabled(), false);
  } finally {
    await otel.shutdownOtel();
  }
});

test('graceful degradation when OTLP endpoint is unreachable', async () => {
  // Port 1 on loopback never accepts connections — the exporter will
  // log batch-send errors internally but must not crash the module.
  const otel = await loadOtel();
  try {
    const sdk = otel.initOtel({
      endpoint: 'http://127.0.0.1:1/v1/traces',
    });
    assert.ok(sdk, 'initOtel must succeed even with an unreachable endpoint');
    assert.equal(otel.isOtelEnabled(), true);

    // Spans created on the live tracer must complete without errors.
    await new Promise((resolve, reject) => {
      otel.tracer.startActiveSpan('test.unreachable_endpoint', async (span) => {
        try {
          span.setAttribute('test.attr', 1);
          span.setStatus({ code: 1 /* OK */ });
          await Promise.resolve();
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          span.end();
        }
      });
    });

    await otel.shutdownOtel();
  } finally {
    await otel.shutdownOtel();
  }
});

test('spans can be created and ended without errors (no SDK initialised)', async () => {
  // No initOtel call — exercises the no-op tracer path. Route
  // handlers rely on this when OTEL is disabled (the default).
  const otel = await loadOtel();
  assert.equal(otel.isOtelEnabled(), false);

  const result = await new Promise((resolve, reject) => {
    otel.tracer.startActiveSpan('test.noop', (span) => {
      try {
        // Sanity-check that the no-op span still answers every
        // method without throwing — that's the contract route
        // handlers rely on.
        span.setAttribute('a', 1);
        span.setAttribute('b', 'hello');
        span.addEvent('event-1');
        span.setStatus({ code: 1 });
        resolve('ok');
      } catch (err) {
        reject(err);
      } finally {
        span.end();
      }
    });
  });
  assert.equal(result, 'ok');

  await otel.shutdownOtel();
});

test('tracer.startActiveSpan callback can be async (returns a Promise)', async () => {
  // The OpenTelemetry spec lets the callback return a Promise;
  // the tracer awaits it. Make sure the no-op implementation
  // (used when the SDK is disabled) honors this.
  const otel = await loadOtel();
  try {
    let observed = null;
    await otel.tracer.startActiveSpan('test.async', async (span) => {
      try {
        observed = await Promise.resolve('inside-span');
      } finally {
        span.end();
      }
    });
    assert.equal(observed, 'inside-span');
  } finally {
    await otel.shutdownOtel();
  }
});

test('initOtel accepts custom serviceName override', async () => {
  const otel = await loadOtel();
  try {
    const sdk = otel.initOtel({
      serviceName: 'bizar-dash-test',
      endpoint: 'http://127.0.0.1:1/v1/traces',
    });
    assert.ok(sdk, 'initOtel with a custom serviceName should succeed');
    await otel.shutdownOtel();
  } finally {
    await otel.shutdownOtel();
  }
});

test('module does not crash when imported (no init, no shutdown)', async () => {
  // Defensive sanity check — every other test file in this repo
  // transitively imports dozens of modules. If a syntax/import
  // error sneaks into otel.mjs, this test catches it before the
  // larger suite blows up somewhere unrelated.
  const otel = await loadOtel();
  assert.equal(typeof otel.initOtel, 'function');
  assert.equal(typeof otel.shutdownOtel, 'function');
  assert.equal(typeof otel.tracer, 'object');
  await otel.shutdownOtel();
});
