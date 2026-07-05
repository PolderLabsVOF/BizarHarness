/**
 * tests/plugin.test.js
 *
 * Smoke tests for the Echo plugin template.
 *
 * These run with `node --test tests/plugin.test.js` from the
 * template folder. They exercise the plugin by loading it directly
 * through the host's `sandbox.mjs` (so the same code path that runs
 * in production is exercised here), not by re-implementing the
 * loading logic.
 *
 * If you copy this template for your own plugin, replace the
 * expectations with real ones for your plugin's behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(HERE, '..');

test('plugin.json is valid JSON with required fields', () => {
  const raw = readFileSync(resolve(TEMPLATE_ROOT, 'plugin.json'), 'utf8');
  const m = JSON.parse(raw);
  assert.equal(typeof m.id, 'string');
  assert.ok(m.id, 'id must be non-empty');
  assert.equal(typeof m.version, 'string');
  assert.ok(m.version, 'version must be non-empty');
  assert.equal(typeof m.main, 'string');
  assert.ok(m.main, 'main must be non-empty');
  assert.ok(Array.isArray(m.exports), 'exports must be an array');
  assert.ok(Array.isArray(m.permissions), 'permissions must be an array');
});

test('index.js exists and is non-empty', () => {
  const src = readFileSync(resolve(TEMPLATE_ROOT, 'index.js'), 'utf8');
  assert.ok(src.length > 100, 'index.js should be a real file');
  assert.match(src, /module\.exports\s*=/, 'must use module.exports');
});

test('plugin exports echo, shout, and init', async () => {
  // We exercise the actual sandbox so this test fails if the plugin
  // ever drifts from the host's API surface.
  const sandboxUrl = new URL('../../../bizar-dash/src/server/plugins/sandbox.mjs',
    import.meta.url);
  const { loadPlugin, safeInvoke } = await import(sandboxUrl);
  const loaded = await loadPlugin({
    mainFile: resolve(TEMPLATE_ROOT, 'index.js'),
    config: { greeting: 'test' },
    permissions: [],
    pluginId: 'echo',
    pluginRoot: TEMPLATE_ROOT,
  });
  assert.equal(typeof loaded.exports.echo, 'function');
  assert.equal(typeof loaded.exports.shout, 'function');
  assert.equal(typeof loaded.exports.init, 'function');

  const r1 = await safeInvoke(loaded, 'echo', ['hello']);
  assert.equal(r1.ok, true);
  assert.equal(r1.result, 'test: hello');

  const r2 = await safeInvoke(loaded, 'shout', ['hi']);
  assert.equal(r2.ok, true);
  assert.equal(r2.result, 'SHOUT: HI');
});

test('echo validates its argument', async () => {
  const sandboxUrl = new URL('../../../bizar-dash/src/server/plugins/sandbox.mjs',
    import.meta.url);
  const { loadPlugin, safeInvoke } = await import(sandboxUrl);
  const loaded = await loadPlugin({
    mainFile: resolve(TEMPLATE_ROOT, 'index.js'),
    config: {},
    permissions: [],
    pluginId: 'echo',
    pluginRoot: TEMPLATE_ROOT,
  });
  const r = await safeInvoke(loaded, 'echo', [42]);
  assert.equal(r.ok, false);
  assert.match(r.error, /expected string/);
});