/**
 * tests/headroom-settings.test.mjs
 *
 * Tests for DEFAULT_SETTINGS.headroom and mergeSettings() headroom merging.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// We need to import the actual module — we test the _shared.mjs exports

test('DEFAULT_SETTINGS has headroom key', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');
  assert.ok('headroom' in DEFAULT_SETTINGS, 'headroom key exists in DEFAULT_SETTINGS');
});

test('DEFAULT_SETTINGS.headroom has all required fields', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');
  const h = DEFAULT_SETTINGS.headroom;

  assert.strictEqual(typeof h.enabled, 'boolean', 'enabled is boolean');
  assert.strictEqual(typeof h.autoInstall, 'boolean', 'autoInstall is boolean');
  assert.strictEqual(typeof h.port, 'number', 'port is number');
  assert.strictEqual(typeof h.host, 'string', 'host is string');
  assert.strictEqual(typeof h.outputShaper, 'boolean', 'outputShaper is boolean');
  assert.strictEqual(typeof h.telemetry, 'boolean', 'telemetry is boolean');
  assert.strictEqual(typeof h.budget, 'number', 'budget is number');
  assert.strictEqual(typeof h.backend, 'string', 'backend is string');
  assert.strictEqual(typeof h.autoStart, 'boolean', 'autoStart is boolean');
  assert.strictEqual(typeof h.autoWrap, 'boolean', 'autoWrap is boolean');
  assert.strictEqual(typeof h.routeAllProviders, 'boolean', 'routeAllProviders is boolean');
});

test('DEFAULT_SETTINGS.headroom has correct defaults', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');
  const h = DEFAULT_SETTINGS.headroom;

  assert.strictEqual(h.enabled, true, 'enabled defaults to true');
  assert.strictEqual(h.autoInstall, true, 'autoInstall defaults to true');
  assert.strictEqual(h.port, 8787, 'port defaults to 8787');
  assert.strictEqual(h.host, '127.0.0.1', 'host defaults to 127.0.0.1');
  assert.strictEqual(h.outputShaper, false, 'outputShaper defaults to false');
  assert.strictEqual(h.telemetry, false, 'telemetry defaults to false');
  assert.strictEqual(h.budget, 0, 'budget defaults to 0 (unlimited)');
  assert.strictEqual(h.backend, 'anthropic', 'backend defaults to anthropic');
  assert.strictEqual(h.autoStart, true, 'autoStart defaults to true');
  assert.strictEqual(h.autoWrap, true, 'autoWrap defaults to true');
  assert.strictEqual(h.routeAllProviders, true, 'routeAllProviders defaults to true');
});

test('mergeSettings preserves headroom sub-object', async () => {
  const { mergeSettings, DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');

  const existing = {
    theme: { mode: 'light' },
    headroom: { port: 9999, enabled: false },
  };

  const merged = mergeSettings(existing);

  assert.ok('headroom' in merged, 'headroom preserved in merged');
  assert.strictEqual(merged.headroom.port, 9999, 'headroom.port is overridden');
  assert.strictEqual(merged.headroom.enabled, false, 'headroom.enabled is overridden');
  // Non-overridden fields should fall back to defaults
  assert.strictEqual(merged.headroom.host, DEFAULT_SETTINGS.headroom.host, 'headroom.host falls back to default');
  assert.strictEqual(merged.headroom.autoInstall, DEFAULT_SETTINGS.headroom.autoInstall, 'headroom.autoInstall falls back to default');
});

test('mergeSettings handles missing headroom in existing', async () => {
  const { mergeSettings, DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');

  const existing = { theme: { mode: 'light' } };
  const merged = mergeSettings(existing);

  assert.ok('headroom' in merged, 'headroom present in merged');
  assert.deepStrictEqual(merged.headroom, DEFAULT_SETTINGS.headroom, 'headroom matches default when not in existing');
});

test('mergeSettings handles null existing', async () => {
  const { mergeSettings, DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');

  const merged = mergeSettings(null);

  assert.ok('headroom' in merged, 'headroom present in merged');
  assert.deepStrictEqual(merged.headroom, DEFAULT_SETTINGS.headroom, 'headroom matches default when existing is null');
});

test('mergeSettings handles undefined existing', async () => {
  const { mergeSettings, DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');

  const merged = mergeSettings(undefined);

  assert.ok('headroom' in merged, 'headroom present in merged');
  assert.deepStrictEqual(merged.headroom, DEFAULT_SETTINGS.headroom, 'headroom matches default when existing is undefined');
});

// ── HeadroomSettings TypeScript type validation ────────────────────────────────
// This is validated by `tsc --noEmit`. We just verify the JS shape here.

test('HeadroomSettings type shape matches DEFAULT_SETTINGS.headroom', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/server/routes/_shared.mjs');
  const h = DEFAULT_SETTINGS.headroom;

  // All fields must be present
  const requiredKeys = [
    'enabled', 'autoInstall', 'port', 'host', 'outputShaper',
    'telemetry', 'budget', 'backend', 'autoStart', 'autoWrap', 'routeAllProviders',
  ];

  for (const key of requiredKeys) {
    assert.ok(key in h, `headroom.${key} is present`);
  }

  // All values must be the correct type
  assert.strictEqual(typeof h.enabled, 'boolean');
  assert.strictEqual(typeof h.autoInstall, 'boolean');
  assert.strictEqual(typeof h.port, 'number');
  assert.strictEqual(typeof h.host, 'string');
  assert.strictEqual(typeof h.outputShaper, 'boolean');
  assert.strictEqual(typeof h.telemetry, 'boolean');
  assert.strictEqual(typeof h.budget, 'number');
  assert.strictEqual(typeof h.backend, 'string');
  assert.strictEqual(typeof h.autoStart, 'boolean');
  assert.strictEqual(typeof h.autoWrap, 'boolean');
  assert.strictEqual(typeof h.routeAllProviders, 'boolean');
});
