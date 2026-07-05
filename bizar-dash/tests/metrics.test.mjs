/**
 * tests/metrics.test.mjs
 *
 * Tests for src/server/metrics.mjs — verifies counter/gauge/histogram
 * accumulators, label handling, and Prometheus text exposition output.
 *
 * Each test resets the registry in finally so order doesn't matter
 * and tests are independent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const METRICS_URL = '../src/server/metrics.mjs';

async function loadMetrics() {
  // Bump the URL per-test-call to force fresh module load (the
  // registry state lives at module scope, so a fresh import = a fresh
  // empty registry). Tests reset() in finally too as belt-and-braces.
  const url = `${METRICS_URL}?v=${Date.now()}-${Math.random()}`;
  return import(url);
}

test('counter increments without labels', async () => {
  const m = await loadMetrics();
  try {
    const c = m.counter('hits_total', 'Total hits');
    c.inc();
    c.inc();
    c.inc();
    const out = m.render();
    assert.match(out, /^# HELP hits_total Total hits/m);
    assert.match(out, /^# TYPE hits_total counter/m);
    assert.match(out, /^hits_total 3$/m);
  } finally {
    m.reset();
  }
});

test('counter increments are partitioned by labels', async () => {
  const m = await loadMetrics();
  try {
    const c = m.counter('http_requests_total', 'HTTP requests');
    c.inc({ method: 'GET', status: '200' });
    c.inc({ method: 'GET', status: '200' });
    c.inc({ method: 'POST', status: '200' });
    c.inc({ method: 'GET', status: '500' });
    const out = m.render();
    // Two GET 200 → value 2.
    assert.match(out, /^http_requests_total\{method="GET",status="200"\} 2$/m);
    // One of each for the other combinations.
    assert.match(out, /^http_requests_total\{method="POST",status="200"\} 1$/m);
    assert.match(out, /^http_requests_total\{method="GET",status="500"\} 1$/m);
  } finally {
    m.reset();
  }
});

test('gauge stores last value per label set', async () => {
  const m = await loadMetrics();
  try {
    const g = m.gauge('ws_clients', 'Active WS clients');
    g.set(3);
    g.set(7); // overwrites the 3
    g.set(12, { shard: 'a' });
    g.set(5, { shard: 'b' });
    const out = m.render();
    assert.match(out, /^# TYPE ws_clients gauge/m);
    assert.match(out, /^ws_clients 7$/m);
    assert.match(out, /^ws_clients\{shard="a"\} 12$/m);
    assert.match(out, /^ws_clients\{shard="b"\} 5$/m);
  } finally {
    m.reset();
  }
});

test('histogram tracks count/sum + bucket counts', async () => {
  const m = await loadMetrics();
  try {
    const h = m.histogram('latency_seconds', 'Request latency', {
      buckets: [0.1, 0.5, 1, 5],
    });
    h.observe(0.05); // bucket le=0.1
    h.observe(0.2);  // bucket le=0.5
    h.observe(0.2);  // bucket le=0.5
    h.observe(2);    // bucket le=5
    h.observe(10);   // +Inf
    const out = m.render();
    assert.match(out, /^# TYPE latency_seconds histogram/m);
    // Bucket counts: cumulative per Prometheus convention.
    assert.match(out, /^latency_seconds_bucket\{le="0\.1"\} 1$/m);
    assert.match(out, /^latency_seconds_bucket\{le="0\.5"\} 3$/m);
    assert.match(out, /^latency_seconds_bucket\{le="1"\} 3$/m);
    assert.match(out, /^latency_seconds_bucket\{le="5"\} 4$/m);
    assert.match(out, /^latency_seconds_bucket\{le="\+Inf"\} 5$/m);
    // Count + sum.
    assert.match(out, /^latency_seconds_count 5$/m);
    assert.match(out, /^latency_seconds_sum 12\.45$/m);
  } finally {
    m.reset();
  }
});

test('histogram uses default buckets when none provided', async () => {
  const m = await loadMetrics();
  try {
    const h = m.histogram('req_dur', 'Request duration');
    h.observe(0.001); // fits in default 0.005 bucket
    const out = m.render();
    // We don't assert specific default values — just that the
    // standard bucket boundaries appear in the output.
    assert.match(out, /le="0\.005"/);
    assert.match(out, /le="\+Inf"/);
    assert.match(out, /^req_dur_count 1$/m);
  } finally {
    m.reset();
  }
});

test('render returns empty string when no metrics registered', async () => {
  const m = await loadMetrics();
  try {
    assert.equal(m.render(), '');
  } finally {
    m.reset();
  }
});

test('render combines counters, gauges, histograms in order', async () => {
  const m = await loadMetrics();
  try {
    m.counter('first_total', 'first').inc();
    m.gauge('second', 'second').set(42);
    m.histogram('third', 'third').observe(1);
    const out = m.render();
    const i1 = out.indexOf('# TYPE first_total');
    const i2 = out.indexOf('# TYPE second');
    const i3 = out.indexOf('# TYPE third');
    assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, 'metrics must render in registration order');
  } finally {
    m.reset();
  }
});

test('label values are escaped', async () => {
  const m = await loadMetrics();
  try {
    const c = m.counter('events_total', 'Events');
    c.inc({ name: 'has "quote"' });
    const out = m.render();
    assert.match(out, /events_total\{name="has \\"quote\\""\} 1/);
  } finally {
    m.reset();
  }
});

test('reset clears all metric types', async () => {
  const m = await loadMetrics();
  m.counter('c', 'c').inc();
  m.gauge('g', 'g').set(1);
  m.histogram('h', 'h').observe(1);
  assert.notEqual(m.render(), '');
  m.reset();
  assert.equal(m.render(), '');
});

test('labels with same content but different key order collapse to one bucket', async () => {
  // Prometheus convention is that label sets are unordered, so
  // {a:'1',b:'2'} and {b:'2',a:'1'} must be the same series. Our
  // implementation sorts keys before stringifying so this holds.
  const m = await loadMetrics();
  try {
    const c = m.counter('mixed_total', 'mixed');
    c.inc({ a: '1', b: '2' });
    c.inc({ b: '2', a: '1' });
    const out = m.render();
    // Only one series line — both inc calls collapsed.
    const matches = out.match(/^mixed_total\{/gm) || [];
    assert.equal(matches.length, 1);
    assert.match(out, /^mixed_total\{a="1",b="2"\} 2$/m);
  } finally {
    m.reset();
  }
});