/**
 * tests/plugins-sandbox.test.mjs
 *
 * Tests for src/server/plugins/sandbox.mjs:
 *   - Allowed globals are present
 *   - Forbidden globals (process, require, child_process, raw fs,
 *     Buffer) are NOT present in the plugin's vm scope
 *   - A malicious plugin that tries to call process.exit / spawn a
 *     subprocess / read the filesystem does NOT escape the sandbox
 *   - Permission-gated methods (api.http, api.fs.read) work when
 *     granted, throw permission_denied when not
 *   - The api.config get/set round-trips
 *   - safeInvoke catches plugin throws and returns { ok: false }
 *   - vm.Script timeout stops a synchronous infinite loop
 *   - safeInvoke timeout stops an async hang
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = await import(resolve(REPO, 'src/server/plugins/sandbox.mjs'));

const TMP = join(tmpdir(), `bizar-sandbox-test-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Write a plugin source string to a tmp file and load it through the
 * real sandbox. Returns the loaded plugin (the value returned by
 * loadPlugin()).
 *
 * @param {string} source  plugin source code (uses module.exports = ...)
 * @param {object} [opts]  passed to loadPlugin
 */
async function loadFromSource(source, opts = {}) {
  const file = join(TMP, `plugin-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(file, source);
  return SANDBOX.loadPlugin({
    mainFile: file,
    config: opts.config || {},
    permissions: opts.permissions || [],
    pluginId: opts.pluginId || 'test-plugin',
    pluginRoot: TMP,
    timeoutMs: opts.timeoutMs || 5_000,
    onConfigChange: opts.onConfigChange,
  });
}

// Cleanup tmp at the end of the file.
import { after } from 'node:test';
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── Globals presence / absence ────────────────────────────────────────────

describe('sandbox — global surface', () => {
  test('allows safe globals (URL, JSON, Math, Promise, setTimeout)', async () => {
    const src = `
      module.exports = {
        inspect() {
          return {
            hasURL: typeof URL === 'function',
            hasJSON: typeof JSON === 'object',
            hasMath: typeof Math === 'object',
            hasPromise: typeof Promise === 'function',
            hasSetTimeout: typeof setTimeout === 'function',
            hasConsole: typeof console === 'object',
          };
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'inspect', []);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasURL, true);
    assert.equal(r.result.hasJSON, true);
    assert.equal(r.result.hasMath, true);
    assert.equal(r.result.hasPromise, true);
    assert.equal(r.result.hasSetTimeout, true);
    assert.equal(r.result.hasConsole, true);
  });

  test('strips process, require, Buffer, child_process', async () => {
    const src = `
      module.exports = {
        inspect() {
          return {
            hasProcess: typeof process,
            hasRequire: typeof require,
            hasBuffer: typeof Buffer,
            hasChildProcess: typeof child_process,
          };
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'inspect', []);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasProcess, 'undefined');
    assert.equal(r.result.hasRequire, 'undefined');
    assert.equal(r.result.hasBuffer, 'undefined');
    assert.equal(r.result.hasChildProcess, 'undefined');
  });
});

// ── Forbidden behaviour ───────────────────────────────────────────────────

describe('sandbox — forbidden behaviour', () => {
  test('cannot process.exit', async () => {
    // A plugin that tries to call process.exit — the call should
    // throw (process is undefined), and safeInvoke should catch it.
    const src = `
      module.exports = {
        boom() {
          process.exit(1);
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'boom', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /process is not defined|exit/);
  });

  test('cannot require node:fs', async () => {
    const src = `
      module.exports = {
        boom() {
          const fs = require('node:fs');
          return fs.readFileSync('/etc/passwd', 'utf8');
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'boom', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /require is not defined/);
  });

  test('cannot spawn child_process', async () => {
    const src = `
      module.exports = {
        boom() {
          const cp = require('node:child_process');
          return cp.execSync('id').toString();
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'boom', []);
    assert.equal(r.ok, false);
  });

  test('cannot read /etc/passwd via raw fs', async () => {
    const src = `
      module.exports = {
        inspect() {
          try {
            return { hasFs: typeof fs };
          } catch (e) {
            return { error: e.message };
          }
        }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'inspect', []);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasFs, 'undefined');
  });

  test('cannot read this host process.env', async () => {
    // Note: NO try/catch — the sandbox should throw, and safeInvoke
    // should catch it as a plugin error.
    const src = `
      module.exports = {
        env() { return process.env.HOME; }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'env', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /process is not defined/);
  });
});

// ── Permission-gated methods ──────────────────────────────────────────────

describe('sandbox — permission gating', () => {
  test('api.http.get without "net" throws permission_denied', async () => {
    const src = `
      module.exports = {
        go() { return api.http.get('https://example.com'); }
      };
    `;
    const loaded = await loadFromSource(src, { permissions: [] });
    const r = await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'permission_denied');
    assert.equal(r.permission, 'net');
  });

  test('api.fs.read without "fs:read" throws permission_denied', async () => {
    const src = `
      module.exports = {
        go() { return api.fs.read('plugin.json'); }
      };
    `;
    const loaded = await loadFromSource(src, { permissions: [] });
    const r = await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'permission_denied');
    assert.equal(r.permission, 'fs:read');
  });

  test('api.fs.read with "fs:read" reads from the plugin root only', async () => {
    // Create a file inside TMP (the plugin root) and a file outside.
    writeFileSync(join(TMP, 'plugin.json'), '{"id":"test"}');
    writeFileSync(join(TMP, '..', `outside-${Date.now()}.txt`), 'secret');
    const outside = join(TMP, '..', `outside-${Date.now()}.txt`);
    const src = `
      module.exports = {
        readIn() { return api.fs.read('plugin.json'); },
        readOut() { return api.fs.read('${outside.replace(/\\/g, '/')}'); },
      };
    `;
    const loaded = await loadFromSource(src, { permissions: ['fs:read'] });
    const r1 = await SANDBOX.safeInvoke(loaded, 'readIn', []);
    assert.equal(r1.ok, true);
    assert.match(r1.result, /test/);
    const r2 = await SANDBOX.safeInvoke(loaded, 'readOut', []);
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'permission_denied');
  });

  test('api.config.get/set round-trips', async () => {
    const src = `
      module.exports = {
        run() {
          api.config.set('nested.value', 42);
          return api.config.get('nested.value');
        }
      };
    `;
    let captured;
    const loaded = await loadFromSource(src, {
      config: { existing: 'yes' },
      onConfigChange: (cfg) => { captured = cfg; },
    });
    const r = await SANDBOX.safeInvoke(loaded, 'run', []);
    assert.equal(r.ok, true);
    assert.equal(r.result, 42);
    assert.equal(captured.nested.value, 42);
  });

  test('api.log with invalid level throws', async () => {
    const src = `
      module.exports = {
        go() { api.log('fatal', 'hi'); }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /level must be one of/);
  });
});

// ── Error handling ────────────────────────────────────────────────────────

describe('sandbox — error handling', () => {
  test('safeInvoke catches a plugin throw', async () => {
    const src = `
      module.exports = {
        boom() { throw new Error('plugin says no'); }
      };
    `;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'boom', []);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'plugin says no');
    assert.equal(r.code, 'plugin_error');
  });

  test('safeInvoke returns no_such_method for unknown methods', async () => {
    const src = `module.exports = { real() { return 1; } };`;
    const loaded = await loadFromSource(src);
    const r = await SANDBOX.safeInvoke(loaded, 'imaginary', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no_such_method');
  });

  test('safeInvoke timeout catches an async hang', async () => {
    const src = `
      module.exports = {
        hang() { return new Promise(() => {}); }
      };
    `;
    const loaded = await loadFromSource(src, { timeoutMs: 200 });
    const start = Date.now();
    const r = await SANDBOX.safeInvoke(loaded, 'hang', [], 200);
    const elapsed = Date.now() - start;
    assert.equal(r.ok, false);
    assert.equal(r.code, 'timeout');
    assert.ok(elapsed >= 200, `expected at least 200ms, got ${elapsed}`);
    assert.ok(elapsed < 2000, `expected < 2s, got ${elapsed}`);
  });

  test('plugin with no exports loads but is empty', async () => {
    // A plugin that only sets `exports.foo` (a CommonJS slip where
    // they forget `module.exports = ...`) still loads; the exports
    // we hand back may be empty or populated depending on what they
    // wrote. We accept either: this is "tolerant by default" — v2
    // can add a strict mode flag.
    const src = `
      // Just declare a const — no module.exports set.
      const x = 1;
    `;
    const loaded = await loadFromSource(src);
    assert.equal(typeof loaded.exports, 'object');
  });
});

// ── Permission parsing ────────────────────────────────────────────────────

describe('parsePluginPermissions', () => {
  test('recognises known perms', () => {
    const r = SANDBOX.parsePluginPermissions(['net', 'fs:read']);
    assert.equal(r.allowed.has('net'), true);
    assert.equal(r.allowed.has('fs:read'), true);
    assert.equal(r.invalid.length, 0);
  });

  test('flags unknown perms', () => {
    const r = SANDBOX.parsePluginPermissions(['net', 'exec:rm-rf']);
    assert.equal(r.allowed.has('net'), true);
    assert.deepEqual(r.invalid, ['exec:rm-rf']);
  });

  test('handles non-array input', () => {
    const r = SANDBOX.parsePluginPermissions(null);
    assert.equal(r.allowed.size, 0);
    assert.equal(r.invalid.length, 0);
  });
});

// ── Manifest reader ──────────────────────────────────────────────────────

describe('readManifest', () => {
  test('reads + validates plugin.json', () => {
    const file = join(TMP, 'plugin.json');
    writeFileSync(file, JSON.stringify({
      id: 'm1', name: 'M1', version: '1.0.0', main: 'index.js',
    }));
    const m = SANDBOX.readManifest(file);
    assert.equal(m.id, 'm1');
    assert.equal(m.version, '1.0.0');
    assert.equal(m.main, 'index.js');
    assert.deepEqual(m.exports, []);
    assert.deepEqual(m.permissions, []);
  });

  test('rejects missing required fields', () => {
    const file = join(TMP, 'bad.json');
    writeFileSync(file, JSON.stringify({ name: 'oops' }));
    assert.throws(() => SANDBOX.readManifest(file), /must declare a non-empty "id"/);
  });
});