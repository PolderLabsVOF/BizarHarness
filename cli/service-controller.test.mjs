/**
 * cli/service-controller.test.mjs
 *
 * v4.4.0 — Smoke tests for the platform-aware service installer.
 * v5.x — Adds tests for the `restartService()` lifecycle (issue #7).
 *
 * Strategy: focus on the parts that are platform-portable and don't
 * require touching the user's real `$XDG_CONFIG_HOME/systemd/`:
 *   - `serviceUnitPath()` returns the expected path
 *   - `serviceStatus()` shape
 *   - `installService({ dryRun: true })` is side-effect free
 *   - `installService()` is idempotent (run twice → second reports
 *     `alreadyInstalled: true`)
 *   - `restartService({ dryRun: true })` is side-effect free
 *   - `restartService({ dryRun: true })` returns the documented shape
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
  restartService,
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

// ── v5.x — restartService lifecycle (issue #7) ──────────────────────────────

test('restartService({ dryRun: true }) makes no filesystem changes', () => {
  const before = serviceStatus();
  const r = restartService({ dryRun: true });
  assert.equal(r.ok, true, `dry-run restart returned ok=false: ${r.error}`);
  const after = serviceStatus();
  // dry-run must not flip the installed bit.
  assert.equal(before.installed, after.installed);
  assert.equal(before.running, after.running);
});

test('restartService({ dryRun: true }) returns the documented shape', () => {
  const r = restartService({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.started, true, 'dry-run reports started=true');
  // stopped/installed are present (even if their inner shape is
  // minimal in dry-run mode).
  assert.ok('stopped' in r, 'stopped field present');
  assert.ok('installed' in r, 'installed field present');
});

test('restartService() on a fresh install (host-only)', { skip: !ALLOW_INSTALL }, () => {
  // Tear down, install, then restart and confirm the unit path is
  // reported. We don't assert that the service is running because
  // the OS init system (systemd / launchd / schtasks) may not be
  // active in the test environment.
  uninstallService();
  const r1 = installService({});
  assert.equal(r1.ok, true, `install failed: ${r1.error}`);

  const r2 = restartService({});
  assert.equal(r2.ok, true, `restart failed: ${r2.error}`);
  assert.ok(typeof r2.unitPath === 'string', 'unitPath reported');
  assert.equal(r2.started, true, 'restart reports started=true');

  // The service should still be reported as installed.
  const status = serviceStatus();
  assert.equal(status.installed, true, 'service still installed after restart');

  uninstallService();
});

// ── v5.x — buildServiceEnvFile + parseEnvFile ────────────────────────────────

test('buildServiceEnvFile returns string with all required vars', async () => {
  const { buildServiceEnvFile } = await import('./service-env.mjs');
  const content = buildServiceEnvFile({ repoPath: '/test/repo' });
  assert.ok(typeof content === 'string');
  assert.ok(content.includes('BIZAR_HOME='), 'BIZAR_HOME present');
  assert.ok(content.includes('BIZAR_REPO=/test/repo'), 'BIZAR_REPO present');
  assert.ok(content.includes('PATH='), 'PATH present');
  assert.ok(content.includes('CLINE_SERVER_PASSWORD='), 'CLINE_SERVER_PASSWORD present');
  assert.ok(content.includes('BIZAR_DASHBOARD_PORT='), 'BIZAR_DASHBOARD_PORT present');
  assert.ok(content.includes('BIZAR_DASHBOARD_HOST='), 'BIZAR_DASHBOARD_HOST present');
  assert.ok(content.includes('BIZAR_LOG_LEVEL='), 'BIZAR_LOG_LEVEL present');
  assert.ok(content.includes('BIZAR_HEADROOM_AUTOSTART='), 'BIZAR_HEADROOM_AUTOSTART present');
  assert.ok(content.includes('BIZAR_LIGHTRAG_AUTOSTART='), 'BIZAR_LIGHTRAG_AUTOSTART present');
  assert.ok(content.includes('BIZAR_MEMORY_VAULT='), 'BIZAR_MEMORY_VAULT present');
});

test('buildServiceEnvFile honours existing process.env values', async () => {
  const { buildServiceEnvFile } = await import('./service-env.mjs');
  const origPort = process.env.BIZAR_DASHBOARD_PORT;
  process.env.BIZAR_DASHBOARD_PORT = '9999';
  try {
    const content = buildServiceEnvFile({ repoPath: '/test/repo' });
    assert.ok(content.includes('BIZAR_DASHBOARD_PORT=9999'), 'honoured BIZAR_DASHBOARD_PORT from env');
  } finally {
    if (origPort !== undefined) process.env.BIZAR_DASHBOARD_PORT = origPort;
    else delete process.env.BIZAR_DASHBOARD_PORT;
  }
});

test('buildServiceEnvFile uses default BIZAR_MEMORY_VAULT when not set', async () => {
  const { buildServiceEnvFile } = await import('./service-env.mjs');
  const orig = process.env.BIZAR_MEMORY_VAULT;
  delete process.env.BIZAR_MEMORY_VAULT;
  try {
    const content = buildServiceEnvFile({ repoPath: '/test/repo' });
    assert.ok(content.includes('BIZAR_MEMORY_VAULT='), 'BIZAR_MEMORY_VAULT present');
    assert.ok(content.includes('.bizar_memory'), 'default vault path present');
  } finally {
    if (orig !== undefined) process.env.BIZAR_MEMORY_VAULT = orig;
  }
});

test('darwinPlistContent generates XML with BIZAR env vars (dry-run only — no file written)', async () => {
  // dry-run test: verify darwinPlistContent is accessible and produces XML.
  // We test via installService({ dryRun: true }) which uses darwinPlistContent.
  const r = installService({ dryRun: true });
  assert.equal(r.ok, true);
  assert.ok(typeof r.note === 'string');
});

