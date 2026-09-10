/**
 * cli/install/install-claude-cli-default.test.mjs
 *
 * Verifies the F-7 opt-in gate on `runProvision.installClaudeCli`
 * (commit 6 of the installer redesign: surgical behavior flip).
 *
 * The opt-in defaults to OFF. When `installClaudeCli` is not passed
 * (or falsy), `runProvision` must NOT invoke `installClaudeCli`, so
 * the installer never auto-installs Claude Code by default. When the
 * caller passes `installClaudeCli: true` (wizard opt-in or the
 * `--install-claude-cli` flag), `runProvision` must invoke it.
 *
 * Layered coverage map (one logical operation per commit):
 *   1. wizard opt-in (TTY)        -> cli/install/wizard.test.mjs
 *   2. wizard no opt-in (TTY)     -> cli/install/wizard.test.mjs
 *   3. --install-claude-cli flag  -> cli/commands/install.test.mjs (commit 7)
 *   4. --yes / default            -> cli/commands/install.test.mjs (commit 7)
 *
 * This file owns the provisioner gate itself: it verifies that
 * `runProvision` honors (and defaults) the new `installClaudeCli`
 * option. It does NOT re-test the wizard or the CLI parser; those
 * layers live in their own files. When commit 7 lands, the
 * `cli/commands/install.test.mjs` tests will assert the
 * parser→runProvision wiring.
 *
 * Style matches cli/install/wizard.test.mjs: `node:test`,
 * `assert/strict`, with `console.log` capture to detect the side
 * effect of `installClaudeCli` (it logs `Installing Claude Code CLI`
 * via `section()` before doing anything else).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;
const ORIG_CLAUDE = process.env.CLAUDE_CONFIG_DIR;
const ORIG_BIZAR_HOME = process.env.BIZAR_HOME;
const ORIG_BIZAR_SKIP_OPENKAN = process.env.BIZAR_SKIP_OPENKAN_INSTALL;

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-cli-install-'));
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  // Make sure runProvision never tries to call out to a real Claude
  // install even if our gate is wrong. With dryRun + skip, the openkan
  // step returns ok without touching the network.
  process.env.BIZAR_SKIP_OPENKAN_INSTALL = '1';
  return home;
}

function restoreHome() {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  if (ORIG_CLAUDE === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIG_CLAUDE;
  if (ORIG_BIZAR_HOME === undefined) delete process.env.BIZAR_HOME;
  else process.env.BIZAR_HOME = ORIG_BIZAR_HOME;
  if (ORIG_BIZAR_SKIP_OPENKAN === undefined) delete process.env.BIZAR_SKIP_OPENKAN_INSTALL;
  else process.env.BIZAR_SKIP_OPENKAN_INSTALL = ORIG_BIZAR_SKIP_OPENKAN;
}

/**
 * Capture `console.log` output while running `fn`.
 * `installClaudeCli` calls `section('Installing Claude Code CLI')`
 * which `console.log`s a chalk-styled header; the literal substring
 * `Installing Claude Code CLI` appears in that line. The test relies
 * on this observable side effect to assert the gate.
 *
 * Returns the concatenated stdout (one call per line, joined with
 * newlines so multi-line chalk output stays grep-able).
 */
async function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.join('\n');
}

/**
 * Read the source file and verify the gate is wired correctly. This
 * static check is in addition to the behavioral tests so that any
 * future refactor that accidentally reverts the gate (e.g. moves the
 * `if` guard back to the old unconditional call) fails loudly.
 */
function readSource() {
  // import.meta.dirname is the cli/install directory; the provisioner
  // lives one level up.
  return import('node:fs').then(({ readFileSync, realpathSync }) => {
    const here = realpathSync(new URL('.', import.meta.url).pathname);
    return readFileSync(join(here, '..', 'provision.mjs'), 'utf8');
  });
}

describe('runProvision: installClaudeCli opt-in gate (commit 6, F-7 flip)', () => {
  let home;
  beforeEach(() => { home = freshHome(); });
  afterEach(() => {
    restoreHome();
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  test('default OFF: installClaudeCli is NOT invoked when option is absent', async () => {
    const { runProvision } = await import('../provision.mjs');
    const output = await captureStdout(() =>
      runProvision({ mode: 'install', dryRun: true }),
    );
    assert.doesNotMatch(
      output,
      /Installing Claude Code CLI/,
      'runProvision must NOT invoke installClaudeCli when the option is absent (default OFF)',
    );
  });

  test('explicit OFF: installClaudeCli is NOT invoked when installClaudeCli: false', async () => {
    const { runProvision } = await import('../provision.mjs');
    const output = await captureStdout(() =>
      runProvision({ mode: 'install', dryRun: true, installClaudeCli: false }),
    );
    assert.doesNotMatch(
      output,
      /Installing Claude Code CLI/,
      'runProvision must NOT invoke installClaudeCli when installClaudeCli: false',
    );
  });

  test('opt-in ON: installClaudeCli IS invoked when installClaudeCli: true', async () => {
    const { runProvision } = await import('../provision.mjs');
    const output = await captureStdout(() =>
      runProvision({ mode: 'install', dryRun: true, installClaudeCli: true }),
    );
    assert.match(
      output,
      /Installing Claude Code CLI/,
      'runProvision MUST invoke installClaudeCli when installClaudeCli: true',
    );
  });

  test('opt-in ON (update mode): installClaudeCli IS invoked when installClaudeCli: true', async () => {
    const { runProvision } = await import('../provision.mjs');
    const output = await captureStdout(() =>
      runProvision({ mode: 'update', dryRun: true, installClaudeCli: true }),
    );
    assert.match(
      output,
      /Installing Claude Code CLI/,
      'gate must apply to update mode too',
    );
  });
});

describe('runProvision: installClaudeCli gate static structure', () => {
  test('source documents F-7 opt-in default OFF', async () => {
    const source = await readSource();
    // The JSDoc must reference the F-7 marker so future readers know
    // why the gate is there. We assert on the F-7 ID since the
    // project uses it across the harness (DECISIONS.md, .ok/,
    // commit bodies). Searching the whole file is intentional: the
    // JSDoc above runProvision is where the gate is documented.
    assert.match(
      source,
      /F-7[\s\S]{0,200}default OFF/,
      'provision.mjs must document the F-7 opt-in default OFF',
    );
  });

  test('installClaudeCli() call is guarded by opts.installClaudeCli', async () => {
    const source = await readSource();
    // The call site must be wrapped in an `if (opts.installClaudeCli)`
    // guard so the default OFF is enforced unconditionally.
    assert.match(
      source,
      /if\s*\(\s*opts\.installClaudeCli\s*\)\s*installClaudeCli\s*\(/,
      'installClaudeCli() call must be guarded by `if (opts.installClaudeCli)`',
    );
  });

  test('runProvision opts destructure does NOT bind installClaudeCli (avoid name shadowing)', async () => {
    const source = await readSource();
    // The opts destructure must NOT bind `installClaudeCli` because
    // doing so would shadow the module-level `installClaudeCli`
    // function called later. Extract the destructure block from the
    // runProvision signature and assert the name is absent.
    const destructureMatch = source.match(
      /export async function runProvision[\s\S]{0,400}?\}\s*=\s*opts;/,
    );
    assert.ok(destructureMatch, 'runProvision must destructure opts');
    assert.doesNotMatch(
      destructureMatch[0],
      /\binstallClaudeCli\b/,
      'runProvision opts destructure must NOT bind installClaudeCli (would shadow the function on the next line)',
    );
  });
});
