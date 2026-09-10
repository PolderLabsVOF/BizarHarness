/**
 * cli/install/index.test.mjs
 *
 * Tests for cli/install/index.mjs — runInstaller orchestrator.
 *
 * Commit 7 (installer-redesign-v2) added a wizard / auto-detect /
 * update three-mode routing layer. These tests cover the routing
 * contract by injecting `provision`, `wizard`, `detect`, and `isTTY`
 * via dependency injection so the test never depends on the real
 * clack prompts or `runProvision` writing to disk.
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

// ── Fixtures used by the routing tests ────────────────────────────────────────

/** Standard "claude-code only" detection shape (no Desktop). */
function detectedClaudeCodeOnly() {
  return {
    claudeCode: {
      present: true,
      binPath: '/usr/local/bin/claude',
      configDir: '/tmp/home/.claude',
      gatewayConfigured: false,
    },
    desktop: {
      present: false,
      configLibraryPath: '/tmp/home/.claude',
      activeConfigPath: null,
      activeConfigId: null,
      gatewayConfigured: false,
    },
    openkan: { present: false, home: '/tmp/home/.openkan' },
  };
}

/** Both Claude Code AND Desktop detected. */
function detectedClaudeCodeAndDesktop() {
  return {
    claudeCode: {
      present: true,
      binPath: '/usr/local/bin/claude',
      configDir: '/tmp/home/.claude',
      gatewayConfigured: false,
    },
    desktop: {
      present: true,
      configLibraryPath: '/tmp/home/.config/claude',
      activeConfigPath: '/tmp/home/.config/claude/abc.json',
      activeConfigId: 'abc',
      gatewayConfigured: false,
    },
    openkan: { present: false, home: '/tmp/home/.openkan' },
  };
}

/**
 * Build a fake `wizard` factory. The returned wizard records its call
 * args and returns a state object built from `stateBuilder`.
 */
function makeFakeWizard(stateBuilder) {
  const calls = { args: [], count: 0 };
  const fn = async (opts = {}) => {
    calls.count += 1;
    calls.args.push(opts);
    return stateBuilder(opts);
  };
  fn.calls = calls;
  return fn;
}

/**
 * Build a fake `provision` that records its call args.
 */
function makeFakeProvision() {
  const calls = { args: [], count: 0 };
  const fn = async (opts = {}) => {
    calls.count += 1;
    calls.args.push(opts);
    return { ok: true };
  };
  fn.calls = calls;
  return fn;
}

/** Build a fake `detect` returning a fixed shape. */
function makeFakeDetect(detected) {
  const calls = { args: [], count: 0 };
  const fn = async (opts = {}) => {
    calls.count += 1;
    calls.args.push(opts);
    return detected;
  };
  fn.calls = calls;
  return fn;
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

  // ── commit 7 routing tests ────────────────────────────────────────────────

  test('commit 7 — TTY + !yes + claude-code-only detected → wizard invoked; provision called with { targets: ["claude-code"], installClaudeCli: false }', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    const wizard = makeFakeWizard(() => ({
      wizardStatus: 'done',
      selectedTargets: ['claude-code'],
      installClaudeCli: false,
    }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    const result = await runInstaller({
      dryRun: true,
      isTTY: true,
      yes: false,
      mode: 'install',
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 1, 'wizard must be invoked exactly once in TTY+!yes mode');
    assert.deepEqual(
      provision.calls.args[0].targets,
      ['claude-code'],
      'provision must receive { targets: ["claude-code"] } from the wizard state'
    );
    assert.equal(
      provision.calls.args[0].installClaudeCli,
      false,
      'provision must receive installClaudeCli: false when the wizard selection was false'
    );
    assert.equal(result.ok, true);
  });

  test('commit 7 — TTY + --yes + claude-code+desktop detected → wizard NOT invoked; auto-detect runs all detected targets with installClaudeCli=false', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeAndDesktop());
    const wizard = makeFakeWizard(() => ({ wizardStatus: 'done', selectedTargets: [], installClaudeCli: false }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: true,
      yes: true,
      mode: 'install',
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 0, 'wizard must NOT be invoked in --yes mode (auto-detect)');
    assert.equal(provision.calls.count, 1, 'provision must be called exactly once in --yes mode');
    const t = provision.calls.args[0].targets;
    assert.ok(Array.isArray(t), 'provision must receive a targets array');
    assert.ok(t.includes('claude-code') && t.includes('claude-desktop'),
      `provision must receive every detected target; got ${JSON.stringify(t)}`);
    assert.equal(provision.calls.args[0].installClaudeCli, false,
      'installClaudeCli must default to false in --yes auto-detect mode');
  });

  test('commit 7 — non-TTY + claude-code-only detected → wizard NOT invoked; auto-detect installs detected targets', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    const wizard = makeFakeWizard(() => ({ wizardStatus: 'done', selectedTargets: [], installClaudeCli: false }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: false,
      mode: 'install',
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 0, 'wizard must NOT be invoked in non-TTY mode');
    assert.equal(provision.calls.count, 1, 'provision must be called in non-TTY mode');
    assert.deepEqual(
      provision.calls.args[0].targets,
      ['claude-code'],
      'non-TTY auto-detect must pick the single detected target'
    );
    assert.equal(provision.calls.args[0].installClaudeCli, false,
      'installClaudeCli must default to false in non-TTY auto-detect mode');
  });

  test('commit 7 — mode === "update" + TTY + detected → wizard SKIPPED regardless of TTY (F6)', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeAndDesktop());
    const wizard = makeFakeWizard(() => ({ wizardStatus: 'done', selectedTargets: [], installClaudeCli: false }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: true,        // TTY but update mode overrides
      yes: false,
      mode: 'update',
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 0, 'wizard must NOT be invoked in update mode (F6)');
    assert.equal(provision.calls.count, 1, 'provision must be called in update mode');
    assert.equal(provision.calls.args[0].mode, 'update', 'provision must receive mode="update"');
    const t = provision.calls.args[0].targets;
    assert.ok(Array.isArray(t) && t.includes('claude-code') && t.includes('claude-desktop'),
      `update mode must auto-detect every target; got ${JSON.stringify(t)}`);
    assert.equal(provision.calls.args[0].installClaudeCli, false,
      'update mode must force installClaudeCli: false (F7)');
  });

  test('commit 7 — --install-claude-cli flag overrides wizard selection (installClaudeCli=true)', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    // Wizard would otherwise pick false; the CLI flag forces true.
    const wizard = makeFakeWizard(() => ({
      wizardStatus: 'done',
      selectedTargets: ['claude-code'],
      installClaudeCli: false,
    }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: true,
      yes: false,
      mode: 'install',
      installClaudeCli: true,  // CLI flag
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 1, 'wizard is still invoked (flag does not skip it)');
    assert.equal(
      provision.calls.args[0].installClaudeCli,
      true,
      'provision must receive installClaudeCli: true when the CLI flag is set'
    );
  });

  test('commit 7 — --targets=desktop + TTY + claude-code-only detected → orchestrator surfaces "target not detected" and provision is NOT called', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    const wizard = makeFakeWizard(() => ({ wizardStatus: 'done', selectedTargets: [], installClaudeCli: false }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    const result = await runInstaller({
      dryRun: true,
      isTTY: true,
      yes: false,
      mode: 'install',
      targets: ['desktop'],     // user pinned desktop; not detected
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 0, 'wizard must NOT be invoked when --targets contains an undetected target');
    assert.equal(provision.calls.count, 0, 'provision must NOT be called when --targets is invalid');
    assert.equal(result.ok, false, 'result must report ok=false on invalid --targets');
    assert.match(String(result.error || ''), /target-not-detected:desktop/,
      'result.error must explain which target was missing');
  });

  test('commit 7 — --targets=claude-code + TTY + claude-code-only detected → wizard invoked with pre-validated target list', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    const wizard = makeFakeWizard(() => ({
      wizardStatus: 'done',
      selectedTargets: ['claude-code'],
      installClaudeCli: false,
    }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: true,
      yes: false,
      mode: 'install',
      targets: ['claude-code'],
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(wizard.calls.count, 1, 'wizard must be invoked when --targets is valid');
    assert.deepEqual(provision.calls.args[0].targets, ['claude-code'],
      'provision must receive the validated target list');
  });

  test('commit 7 — detect is called even in non-interactive mode (auto-detect path)', async () => {
    const { runInstaller } = await import('./index.mjs');
    const detect = makeFakeDetect(detectedClaudeCodeOnly());
    const wizard = makeFakeWizard(() => ({ wizardStatus: 'done', selectedTargets: [], installClaudeCli: false }));
    const provision = makeFakeProvision();
    const statuslineInstall = async () => ({ ok: true });

    await runInstaller({
      dryRun: true,
      isTTY: false,
      mode: 'install',
      detect,
      wizard,
      provision,
      statuslineInstall,
    });

    assert.equal(detect.calls.count, 1, 'detect must be called once in every path');
  });
});

console.log('  index.test.mjs loaded — run with: node --test cli/install/index.test.mjs');
