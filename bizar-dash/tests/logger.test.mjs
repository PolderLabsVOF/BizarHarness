/**
 * tests/logger.test.mjs
 *
 * Tests for src/server/logger.mjs — verifies level filtering, JSON
 * output shape, context merge behaviour, and the child() factory.
 *
 * The module reads BIZAR_LOG_LEVEL at import time, so each test that
 * needs a different level uses Node's --import flag… except that's
 * hard to do mid-test. Instead we set the env BEFORE the first
 * dynamic import by using a top-level await and reset modules via
 * `node:test`'s `mock`.
 *
 * Simpler: we always force level='debug' at the top of each test
 * with a child module that re-exports the logger functions but
 * respects a per-test override. That mirrors what real callers do
 * anyway — they call the functions, not the level constant.
 *
 * Strategy: capture stdout/stderr by replacing console.{log,warn,error}
 * in-place for the duration of the test, then assert on the captured
 * lines. Restore the originals in finally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

function captureConsole() {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const lines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk).replace(/\n$/, ''));
      cb();
    },
  });
  // Replace console.* with writes to our sink. The logger calls
  // console.log/warn/error, so we route each stream independently to
  // its own bucket so we can verify the level → stream mapping.
  const buckets = { log: [], warn: [], error: [] };
  console.log = (...args) => {
    buckets.log.push(args.map(String).join(' '));
    sink.write(args.map(String).join(' ') + '\n');
  };
  console.warn = (...args) => {
    buckets.warn.push(args.map(String).join(' '));
    sink.write(args.map(String).join(' ') + '\n');
  };
  console.error = (...args) => {
    buckets.error.push(args.map(String).join(' '));
    sink.write(args.map(String).join(' ') + '\n');
  };
  return {
    buckets,
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

/**
 * Force BIZAR_LOG_LEVEL to the given value BEFORE importing the
 * logger module. We delete the cached module from require.cache so
 * the level constant re-evaluates, then dynamic-import it fresh.
 */
async function loadLogger(level) {
  // For ESM the import cache lives on the loader, not require.cache.
  // Use a unique query string per level to force a fresh module
  // evaluation (Node treats different specifiers as different modules).
  const url = `../src/server/logger.mjs?level=${level}`;
  process.env.BIZAR_LOG_LEVEL = level;
  return import(url);
}

test('logger emits JSON with ts/level/msg shape', async () => {
  process.env.BIZAR_LOG_LEVEL = 'debug';
  const cap = captureConsole();
  try {
    const { info } = await loadLogger('debug');
    info('server started', { port: 4317 });
    assert.equal(cap.buckets.log.length, 1);
    const parsed = JSON.parse(cap.buckets.log[0]);
    assert.equal(parsed.msg, 'server started');
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.port, 4317);
    assert.ok(typeof parsed.ts === 'string');
    // ts must look like an ISO timestamp.
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    cap.restore();
  }
});

test('level filtering — debug suppressed at default level', async () => {
  process.env.BIZAR_LOG_LEVEL = 'info';
  const cap = captureConsole();
  try {
    const { debug, info } = await loadLogger('info');
    debug('should not appear');
    info('should appear');
    assert.equal(cap.buckets.log.length, 1);
    const parsed = JSON.parse(cap.buckets.log[0]);
    assert.equal(parsed.msg, 'should appear');
    assert.equal(parsed.level, 'info');
  } finally {
    cap.restore();
  }
});

test('level filtering — warn goes to console.warn, error to console.error', async () => {
  process.env.BIZAR_LOG_LEVEL = 'debug';
  const cap = captureConsole();
  try {
    const { warn, error } = await loadLogger('debug');
    warn('a warning', { module: 'test' });
    error('a failure', { module: 'test', code: 'E_BANG' });
    assert.equal(cap.buckets.warn.length, 1);
    assert.equal(cap.buckets.error.length, 1);
    assert.equal(cap.buckets.log.length, 0);
    const w = JSON.parse(cap.buckets.warn[0]);
    assert.equal(w.level, 'warn');
    assert.equal(w.module, 'test');
    const e = JSON.parse(cap.buckets.error[0]);
    assert.equal(e.level, 'error');
    assert.equal(e.code, 'E_BANG');
  } finally {
    cap.restore();
  }
});

test('level filtering — error suppressed above error level (none higher exists)', async () => {
  // There's no level above error, so this is a sanity test: errors
  // always print. Make sure we didn't accidentally silence them.
  process.env.BIZAR_LOG_LEVEL = 'error';
  const cap = captureConsole();
  try {
    const { info, warn, error } = await loadLogger('error');
    info('hidden');
    warn('hidden');
    error('visible');
    assert.equal(cap.buckets.error.length, 1);
    assert.equal(cap.buckets.log.length, 0);
    assert.equal(cap.buckets.warn.length, 0);
    assert.equal(JSON.parse(cap.buckets.error[0]).msg, 'visible');
  } finally {
    cap.restore();
  }
});

test('child logger binds context to every call', async () => {
  process.env.BIZAR_LOG_LEVEL = 'debug';
  const cap = captureConsole();
  try {
    const { child } = await loadLogger('debug');
    const log = child({ module: 'overview', session: 'abc' });
    log.info('snapshot built', { size: 42 });
    log.warn('cache miss');
    // Both calls should carry the bound module + session.
    const i = JSON.parse(cap.buckets.log[0]);
    assert.equal(i.msg, 'snapshot built');
    assert.equal(i.module, 'overview');
    assert.equal(i.session, 'abc');
    assert.equal(i.size, 42);
    const w = JSON.parse(cap.buckets.warn[0]);
    assert.equal(w.msg, 'cache miss');
    assert.equal(w.module, 'overview');
    assert.equal(w.session, 'abc');
  } finally {
    cap.restore();
  }
});

test('child per-call context overrides bound context', async () => {
  process.env.BIZAR_LOG_LEVEL = 'debug';
  const cap = captureConsole();
  try {
    const { child } = await loadLogger('debug');
    const log = child({ module: 'overview', session: 'abc' });
    log.info('snapshot', { session: 'override' });
    const parsed = JSON.parse(cap.buckets.log[0]);
    // Per-call context wins over the bound context for shared keys.
    assert.equal(parsed.session, 'override');
    assert.equal(parsed.module, 'overview');
  } finally {
    cap.restore();
  }
});

test('undefined ctx is ignored without throwing', async () => {
  process.env.BIZAR_LOG_LEVEL = 'debug';
  const cap = captureConsole();
  try {
    const { info } = await loadLogger('debug');
    assert.doesNotThrow(() => info('hello'));
    assert.doesNotThrow(() => info('hello', null));
    assert.doesNotThrow(() => info('hello', undefined));
    const parsed = JSON.parse(cap.buckets.log[0]);
    assert.equal(parsed.msg, 'hello');
  } finally {
    cap.restore();
  }
});