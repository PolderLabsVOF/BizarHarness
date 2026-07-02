/**
 * cli/service-controller.test.mjs
 *
 * v4.4.0 — Smoke tests for the platform-aware service installer.
 *
 * Strategy: focus on the parts that are platform-portable and don't
 * require touching the user's real `$XDG_CONFIG_HOME/systemd/`:
 *   - `serviceUnitPath()` returns the expected path
 *   - `serviceStatus()` shape
 *   - `installService({ dryRun: true })` is side-effect free
 *   - `installService()` is idempotent (run twice → second reports
 *     `alreadyInstalled: true`)
 *
 * Tests that actually install / uninstall on the host machine are
 * skipped by default — opt in by setting `BIZAR_TEST_INSTALL=1`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

import {
  installService,
  uninstallService,
  serviceStatus,
  serviceUnitPath,
} from './service-controller.mjs';

const HOST = platform();
const ALLOW_INSTALL = process.env.BIZAR_TEST_INSTALL === '1';

test('serviceUnitPath() returns a non-empty string or null', () => {
  const p = serviceUnitPath();
  if (HOST === 'linux' || HOST === 'darwin' || HOST === 'win32') {
    assert.ok(typeof p === 'string' && p.length > 0, `expected path, got ${p}`);
  } else {
    assert.equal(p, null);
  }
});

test('serviceStatus() returns the documented shape', () => {
  const s = serviceStatus();
  assert.ok(typeof s === 'object' && s !== null);
  for (const key of ['installed', 'running', 'unitPath']) {
    assert.ok(key in s, `${key} missing from status`);
  }
  assert.equal(typeof s.installed, 'boolean');
  assert.equal(typeof s.running, 'boolean');
});

test('installService({ dryRun: true }) makes no filesystem changes', () => {
  const before = serviceStatus();
  const r = installService({ dryRun: true });
  assert.equal(r.ok, true);
  const after = serviceStatus();
  // Both should agree on installed-ness — dry-run must not flip any bit.
  assert.equal(before.installed, after.installed);
  // The unit path was returned for reference.
  if (HOST === 'linux' || HOST === 'darwin' || HOST === 'win32') {
    assert.ok(typeof r.unitPath === 'string', 'dry-run should report unitPath');
  }
});

test('idempotency: install twice → second call reports alreadyInstalled (host-only)', { skip: !ALLOW_INSTALL }, () => {
  // Tear down whatever the host already has so we start clean.
  uninstallService();

  const first = installService({});
  assert.equal(first.ok, true, `first install failed: ${first.error}`);
  assert.equal(first.alreadyInstalled, undefined);

  const second = installService({});
  assert.equal(second.ok, true, `second install failed: ${second.error}`);
  assert.equal(second.alreadyInstalled, true, 'second call should be a no-op');

  // Clean up so we don't leave the host service running after tests.
  uninstallService();
});

test('file permissions on the env file are 0600 (Linux/macOS only)', { skip: HOST === 'win32' || !ALLOW_INSTALL }, () => {
  installService({});
  const unit = serviceUnitPath();
  if (unit && unit.endsWith('bizar.service')) {
    const envPath = join(process.env.HOME || '/tmp', '.config', 'bizar', 'service.env');
    if (existsSync(envPath)) {
      const mode = statSync(envPath).mode & 0o777;
      assert.equal(mode, 0o600, `env file mode is ${mode.toString(8)}, want 0600`);
    }
  }
  uninstallService();
});
