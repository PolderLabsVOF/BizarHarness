/**
 * bizar-dash/tests/cli-tailscale.test.mjs
 *
 * v5.2 — CLI Tailscale integration tests.
 *
 * Tests the tailscale CLI command module (cli/commands/tailscale.mjs).
 * Verifies module structure and run() doesn't throw for help/invalid subcommands.
 * Full integration testing requires a real or mocked tailscale binary.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_COMMANDS = resolve(__dirname, '..', '..', 'cli', 'commands');

// ── Tests ───────────────────────────────────────────────────────────────────

describe('cli/commands/tailscale.mjs exports', () => {
  test('exports run() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.run, 'function');
  });

  test('exports ensureTailscaleAuth() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.ensureTailscaleAuth, 'function');
  });

  test('exports setupTailscaleServe() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.setupTailscaleServe, 'function');
  });

  test('exports unsetupTailscaleServe() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.unsetupTailscaleServe, 'function');
  });

  test('exports getServeUrl() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.getServeUrl, 'function');
  });

  test('exports showTailscaleStatus() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.showTailscaleStatus, 'function');
  });

  test('exports showTailscaleHelp() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.showTailscaleHelp, 'function');
  });

  test('exports isTailscaleInstalled() function', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    assert.equal(typeof mod.isTailscaleInstalled, 'function');
  });
});

describe('run() — CLI subcommand dispatcher', () => {
  test('run() with no args does not throw (prints help)', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    // Should not throw - it will print help and return
    await mod.run('tailscale', [], false);
  });

  test('run() with --help flag does not throw', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    await mod.run('tailscale', ['--help'], false);
  });

  test('run() with "help" subcommand does not throw', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    await mod.run('tailscale', ['help'], false);
  });

  test('run() with unknown subcommand does not throw (prints error + help)', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    // Should not throw - it will print an error and help
    await mod.run('tailscale', ['unknown-subcommand'], false);
  });
});

describe('showTailscaleHelp()', () => {
  test('prints help text including env var documentation', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    let stdout = '';
    const orig = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    process.stdout.write = (s) => { stdout += String(s); return true; };
    try {
      mod.showTailscaleHelp();
      assert.ok(stdout.includes('bizar tailscale'));
      assert.ok(stdout.includes('TAILSCALE_AUTHKEY'));
      assert.ok(stdout.includes('bizar tailscale status'));
      assert.ok(stdout.includes('bizar tailscale serve'));
      assert.ok(stdout.includes('bizar tailscale unserve'));
    } finally {
      process.stdout.write = orig;
    }
  });
});

describe('getServeUrl()', () => {
  test('returns null when serve config does not exist', async () => {
    const mod = await import(`${CLI_COMMANDS}/tailscale.mjs`);
    const url = mod.getServeUrl();
    // Returns null when no config file exists (test environment)
    assert.equal(url, null);
  });
});
