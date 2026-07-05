/**
 * update-run.test.mjs — tests for /api/updates/apply progress streaming.
 *
 * Run with: node --test bizar-dash/tests/update-run.test.mjs
 *
 * Strategy: stub `node:child_process` so `spawn` returns a controllable
 * fake process that emits scripted stdout/stderr lines and a chosen
 * exit code. Capture the broadcast channel's emitted messages and
 * assert they fire in the documented order.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

// ─── Spawn fake ────────────────────────────────────────────────────────────
// We monkey-patch the module loader's view of `node:child_process` so
// that update.mjs's `import { spawn } from 'node:child_process'` resolves
// to our fake.

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  // Helpers for tests
  emitStdout(line) { this.stdout.push(line + '\n'); }
  emitStderr(line) { this.stderr.push(line + '\n'); }
  finish(code = 0) {
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('close', code);
  }
  failWith(err) {
    this.emit('error', err);
  }
}

let fakeProc = null;
function makeFakeSpawn() {
  return (_cmd, _args, _opts) => {
    fakeProc = new FakeChildProcess();
    return fakeProc;
  };
}

// Install the fake by intercepting `node:child_process`. We do this by
// rewriting `Module._resolveFilename` for one test at a time.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let originalLoad;
let patched = false;
function installFakeSpawn() {
  if (patched) return;
  // Override via global require cache: pre-populate the require cache
  // for `node:child_process` with a stub module.
  const realChild = require('node:child_process');
  const stub = { ...realChild, spawn: makeFakeSpawn() };
  require.cache[require.resolve('node:child_process')] = {
    id: 'node:child_process',
    filename: 'node:child_process',
    loaded: true,
    exports: stub,
  };
  patched = true;
}

// Load update.mjs once after we've patched child_process. We do this
// dynamically so the import picks up the stubbed `spawn` from the
// require cache that ESM bridges through.
//
// NOTE: ESM `import` does NOT use the require cache, so the patch above
// only works for CommonJS callers of `child_process`. The route imports
// `spawn` from `node:child_process` directly via ESM. To make this test
// work, we patch the actual child_process module's `spawn` property at
// runtime instead.
function patchSpawnDirectly() {
  const cp = require('node:child_process');
  cp.__originalSpawn = cp.__originalSpawn || cp.spawn;
  cp.spawn = makeFakeSpawn();
}

function unpatchSpawn() {
  const cp = require('node:child_process');
  if (cp.__originalSpawn) {
    cp.spawn = cp.__originalSpawn;
  }
  fakeProc = null;
}

// Now we need the route to use the patched spawn. update.mjs does:
//   import { spawn, execFileSync } from 'node:child_process';
// In Node.js, ESM imports for built-in modules go through the loader,
// which uses a private internal cache separate from the CommonJS
// require cache. So patching require.cache alone won't redirect ESM.
//
// The reliable approach is to use a loader hook. For simplicity in
// this test, we instead use module-aliasing via a wrapper: we use a
// small middleware-only test that monkey-patches spawn on the imported
// module instance directly. Since the same module instance is shared
// across imports within a process, this works after first import.

async function importUpdateModuleFresh() {
  // Use a query string to force re-import. ESM treats query strings as
  // distinct specifiers, so this gives us a fresh module instance.
  const url = `${REPO}/bizar-dash/src/server/routes/update.mjs?case=${Date.now()}-${Math.random()}`;
  return import(url);
}

// ─── App setup ─────────────────────────────────────────────────────────────

function setupApp(broadcast) {
  const app = express();
  app.use(express.json());
  return importUpdateModuleFresh().then((mod) => {
    app.use('/api', mod.createUpdateRouter({ broadcast }));
    return { app, mod };
  });
}

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

// ─── Wait helper ───────────────────────────────────────────────────────────

function waitFor(predicate, { timeoutMs = 4000, intervalMs = 10 } = {}) {
  return new Promise((resolveP, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolveP();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('update.mjs — apply run broadcasts events in order', () => {
  let broadcast;
  beforeEach(() => {
    patchSpawnDirectly();
    broadcast = [];
  });

  it('emits starting → log → done → complete for a successful install', async () => {
    const { app } = await setupApp((msg) => broadcast.push(msg));
    const res = await request(app, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body.started, ['bizar']);

    // The first event should be a `starting` progress for `bizar`
    await waitFor(() => broadcast.length >= 1);
    assert.equal(broadcast[0].type, 'update:progress');
    assert.equal(broadcast[0].pkg, 'bizar');
    assert.equal(broadcast[0].status, 'starting');

    // Now drive the fake spawn to emit log lines + finish
    assert.ok(fakeProc, 'fakeProc should exist after request');
    fakeProc.emitStdout('npm WARN deprecated foo');
    fakeProc.emitStdout('added 1 package in 2s');
    fakeProc.finish(0);

    // Wait for the complete event
    await waitFor(() => broadcast.some((m) => m.type === 'update:complete'), { timeoutMs: 5000 });

    // Verify ordering and types
    const types = broadcast.map((m) => `${m.type}${m.pkg ? `:${m.pkg}` : ''}:${m.status ?? ''}`);
    assert.ok(types.includes('update:progress:bizar:starting'), 'should have starting progress');
    assert.ok(types.includes('update:log:bizar:'), 'should have at least one log');
    assert.ok(types.includes('update:progress:bizar:done'), 'should have done progress');
    assert.ok(types.at(-1) === 'update:complete:', 'last event should be update:complete');

    // Done event should carry newVersion
    const doneEvent = broadcast.find((m) => m.type === 'update:progress' && m.status === 'done');
    assert.ok(doneEvent, 'done event should exist');
    assert.ok('newVersion' in doneEvent, 'done event should carry newVersion field');

    unpatchSpawn();
  });

  it('emits error progress + complete when npm exits non-zero', async () => {
    const { app } = await setupApp((msg) => broadcast.push(msg));
    const res = await request(app, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.equal(res.status, 202);

    await waitFor(() => broadcast.length >= 1);
    assert.ok(fakeProc, 'fakeProc should exist');
    fakeProc.emitStderr('npm ERR! code EACCES');
    fakeProc.finish(1);

    await waitFor(() => broadcast.some((m) => m.type === 'update:complete'));

    const errorEvent = broadcast.find((m) => m.type === 'update:progress' && m.status === 'error');
    assert.ok(errorEvent, 'should have error progress event');
    assert.ok(errorEvent.error, 'error event should have error message');
    assert.match(errorEvent.error, /exited with code 1/);

    const lastEvent = broadcast.at(-1);
    assert.equal(lastEvent.type, 'update:complete');

    unpatchSpawn();
  });

  it('returns 409 when an apply is already running', async () => {
    const { app } = await setupApp(() => {});
    // First call — kicks off the run but the fake proc never closes,
    // so the run is "active" for the duration of the test.
    const first = await request(app, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.equal(first.status, 202);

    // Second call — should hit the concurrency guard
    const second = await request(app, 'POST', '/api/updates/apply', { packages: ['bizar'] });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'already_running');

    // Cleanup: close the fake proc so the run's finally clears the guard
    if (fakeProc) fakeProc.finish(0);
    // Give the async run a moment to clear
    await new Promise((r) => setTimeout(r, 50));
    unpatchSpawn();
  });
});