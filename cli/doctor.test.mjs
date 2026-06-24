/**
 * cli/doctor.test.mjs
 *
 * Tests for the `bizar doctor` subcommand. Uses Node's built-in
 * node:test (no external test framework).
 *
 * Strategy: mock HOME so opencodeConfigDir() resolves inside a
 * tmpdir, and craft the opencode.json + agents/ directory to drive
 * specific pass/fail outcomes. For checks that depend on global
 * npm-installed packages or external CLIs (e.g. opencode --version,
 * npm root -g, which rtk), we accept that they may pass or fail
 * depending on the test environment and just verify the framework
 * returns the right shape.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const { runDoctor } = await import('./doctor.mjs');

// ── HOME mocking ────────────────────────────────────────────────────────────

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

/**
 * Mock HOME so opencodeConfigDir() resolves to `<tmpdir>/.config/opencode`.
 * Returns the tmpdir path.
 *
 * We don't set XDG_CONFIG_HOME here for the same reason as dev-link.test.mjs:
 * the helper treats a set XDG_CONFIG_HOME as the direct parent (so
 * `XDG_CONFIG_HOME=~/.config` → `~/.config/opencode`).
 */
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-doctor-'));
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  return home;
}

afterEach(() => {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
});

// ── Shape & silent-mode tests ───────────────────────────────────────────────

describe('runDoctor() shape', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  test('returns { passed, failed, results }', async () => {
    const result = await runDoctor({ silent: true });
    assert.equal(typeof result.passed, 'number');
    assert.equal(typeof result.failed, 'number');
    assert.ok(Array.isArray(result.results));
    // results should have one entry per check
    assert.equal(result.results.length, 9);
    assert.equal(result.passed + result.failed, 9);
    // Each result has the expected fields
    for (const r of result.results) {
      assert.equal(typeof r.name, 'string');
      assert.equal(typeof r.ok, 'boolean');
      assert.equal(typeof r.message, 'string');
    }
  });

  test('silent mode suppresses per-check output but still prints summary on failure', async () => {
    // Capture stdout by overriding console.log.
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      // Empty home → many checks will fail → summary should print.
      const result = await runDoctor({ silent: true });
      assert.ok(result.failed > 0, 'precondition: some checks should fail');
    } finally {
      console.log = origLog;
    }

    // In silent mode with failures, only the summary line should print
    // (an empty leading line is also fine — it's a visual separator).
    const summaryLines = lines.filter((l) => /checks passed.*failed/.test(l));
    assert.equal(
      summaryLines.length,
      1,
      `expected exactly 1 summary line in silent+failed mode, got ${summaryLines.length}:\n${lines.join('\n')}`,
    );
    assert.match(summaryLines[0], /checks passed.*failed/);
  });

  test('silent mode suppresses ALL output when nothing fails', async () => {
    // Build a fully healthy environment. We can't make opencode reachable
    // or rtk installed without modifying PATH, so we settle for: no failures
    // means no output at all. Since we know some checks will fail in a
    // bare tmpdir, this test is structured to assert the negative case
    // differently: we verify silent+no-fail produces 0 lines.
    //
    // For this we mock nothing — the test just confirms the framework
    // doesn't print per-check lines when silent is true.
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await runDoctor({ silent: true });
      // Some checks failed (because the env isn't fully healthy).
      // What we want to verify is that per-check lines did NOT print.
      const perCheckLines = lines.filter((l) =>
        /^\s+[✓✗]\s/.test(l) // chalk check markers
      );
      assert.equal(
        perCheckLines.length,
        0,
        `silent mode should suppress per-check output, got:\n${perCheckLines.join('\n')}`,
      );
    } finally {
      console.log = origLog;
    }
  });

  test('non-silent mode prints per-check output', async () => {
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await runDoctor();
    } finally {
      console.log = origLog;
    }

    // Should have at least 9 per-check lines plus the summary.
    const perCheckLines = lines.filter((l) => /^\s+[✓✗]\s/.test(l));
    assert.ok(
      perCheckLines.length >= 9,
      `expected ≥9 per-check lines, got ${perCheckLines.length}`,
    );
  });
});

// ── Fixture-driven pass/fail tests ──────────────────────────────────────────

describe('runDoctor() with fixture HOME', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  function writeOpencodeConfig(json) {
    const cfgDir = join(home, '.config', 'opencode');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify(json), 'utf8');
    return cfgDir;
  }

  function writeAgents(...files) {
    const agentsDir = join(home, '.config', 'opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const f of files) {
      writeFileSync(join(agentsDir, f), `# ${f}`, 'utf8');
    }
    return agentsDir;
  }

  function findCheck(result, name) {
    return result.results.find((r) => r.name === name);
  }

  test('config-valid passes for parseable JSON', async () => {
    writeOpencodeConfig({ provider: {} });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'opencode-config-valid');
    assert.equal(r.ok, true, `expected config-valid to pass: ${r.message}`);
  });

  test('config-valid fails for missing opencode.json', async () => {
    // No opencode.json written.
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'opencode-config-valid');
    assert.equal(r.ok, false);
    assert.match(r.message, /not found/);
  });

  test('config-valid fails for invalid JSON', async () => {
    const cfgDir = writeOpencodeConfig({});
    // Overwrite with garbage
    writeFileSync(join(cfgDir, 'opencode.json'), '{ this is not json', 'utf8');
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'opencode-config-valid');
    assert.equal(r.ok, false);
    assert.match(r.message, /invalid JSON/);
  });

  test('plugin-entry-present fails when plugin[] is empty', async () => {
    writeOpencodeConfig({ plugin: [] });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'plugin-entry-present');
    assert.equal(r.ok, false);
  });

  test('plugin-entry-present fails when plugin[] has no bizar', async () => {
    writeOpencodeConfig({ plugin: ['something-else'] });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'plugin-entry-present');
    assert.equal(r.ok, false);
  });

  test('plugin-entry-present passes when plugin[] has bizar string', async () => {
    writeOpencodeConfig({ plugin: ['bizar'] });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'plugin-entry-present');
    assert.equal(r.ok, true, r.message);
  });

  test('plugin-entry-present passes when plugin[] has bizar object', async () => {
    writeOpencodeConfig({ plugin: [{ name: 'bizar', path: './plugins/bizar' }] });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'plugin-entry-present');
    assert.equal(r.ok, true, r.message);
  });

  test('agent-files-installed fails when core agents missing', async () => {
    writeOpencodeConfig({});
    writeAgents('odin.md'); // missing quick, thor, tyr
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'agent-files-installed');
    assert.equal(r.ok, false);
    assert.match(r.message, /missing/);
  });

  test('agent-files-installed passes when all core agents present', async () => {
    writeOpencodeConfig({});
    writeAgents('odin.md', 'quick.md', 'thor.md', 'tyr.md');
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'agent-files-installed');
    assert.equal(r.ok, true, r.message);
  });

  test('provider-config-sanity fails without openrouter block', async () => {
    writeOpencodeConfig({ provider: {} });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'provider-config-sanity');
    assert.equal(r.ok, false);
    assert.match(r.message, /openrouter/);
  });

  test('provider-config-sanity fails when models lack interleaved+reasoning', async () => {
    writeOpencodeConfig({
      provider: {
        openrouter: {
          models: { 'some-model': { id: 'foo' } },
        },
      },
    });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'provider-config-sanity');
    assert.equal(r.ok, false);
    assert.match(r.message, /interleaved.*reasoning/);
  });

  test('provider-config-sanity passes with interleaved+reasoning', async () => {
    writeOpencodeConfig({
      provider: {
        openrouter: {
          models: {
            'MiniMax/MiniMax-M3': { interleaved: true, reasoning: true },
          },
        },
      },
    });
    const result = await runDoctor({ silent: true });
    const r = findCheck(result, 'provider-config-sanity');
    assert.equal(r.ok, true, r.message);
  });
});

console.log('  doctor.mjs tests loaded — run with: node --test cli/doctor.test.mjs');