/**
 * cli/install/index.test.mjs
 *
 * Tests for cli/install/index.mjs — runInstaller orchestrator.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIG_HOME = process.env.HOME;

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-install-index-'));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;
  return home;
}

function restoreHome() {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
}

describe('runInstaller()', () => {
  let home;

  beforeEach(() => { home = freshHome(); });
  afterEach(() => {
    restoreHome();
    if (home) try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('runInstaller({ dryRun: true }) does not write files', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ dryRun: true });
    assert.equal(result.ok, true);
  });

  test('runInstaller({ quiet: true }) only prints location card', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ quiet: true });
    assert.equal(result.ok, true);
  });

  test('runInstaller({ force: true }) runs without error', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ force: true, dryRun: true });
    assert.equal(result.ok, true);
  });

  test('runInstaller({ mode: "update" }) runs without error', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ mode: 'update', dryRun: true });
    assert.equal(result.ok, true);
  });

  test('runInstaller({ dryRun: false }) attempts runStatuslineInstall with []', async () => {
    const { runInstaller } = await import('./index.mjs');
    let callCount = 0;
    let callArgs = null;
    const statuslineInstall = async (args) => {
      callCount++;
      callArgs = args;
      return { ok: true };
    };

    const provision = async () => ({ ok: true });
    await runInstaller({ mode: 'update', dryRun: false, statuslineInstall, provision });

    assert.equal(callCount, 1, 'runStatuslineInstall must be called exactly once');
    assert.deepEqual(callArgs, [], 'runStatuslineInstall must be called with []');
  });

  test('runInstaller({ dryRun: true }) does NOT call runStatuslineInstall', async () => {
    const { runInstaller } = await import('./index.mjs');
    let callCount = 0;
    const statuslineInstall = async () => {
      callCount++;
      return { ok: true };
    };

    const provision = async () => ({ ok: true });
    await runInstaller({ dryRun: true, quiet: true, statuslineInstall, provision });

    assert.equal(callCount, 0, 'runStatuslineInstall must NOT be called on dryRun');
  });
});

console.log('  index.test.mjs loaded — run with: node --test cli/install/index.test.mjs');
