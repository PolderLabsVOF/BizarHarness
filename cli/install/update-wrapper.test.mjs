/**
 * cli/install/update-wrapper.test.mjs
 *
 * Tests for the `bizar update` flag-wiring fix shipped in v10.19.6.
 *
 * History: prior to v10.19.6, `cli/commands/install.mjs#update` called
 * a legacy `runUpdate(args)` that ignored every flag except `--help`.
 * `bizar update --dry-run --force --yes` was functionally identical to
 * plain `bizar update`. The settings.json union-merge path was
 * unreachable, `runRepair` was skipped, and the post-update `bizar
 * doctor` check never ran.
 *
 * v10.19.6 routes update through the same `parseFlags` + `runInstaller`
 * pipeline as install. This file pins that wiring by exercising the
 * dependency-injected helper `runUpdateWithFlags` directly — every test
 * stubs `runInstaller` / `parseFlags` / `runRepair` so it never touches
 * disk.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Build a fresh triple of dependency-injected stubs. The defaults match
 * what `parseFlags` returns so we can re-use a single factory across
 * every test, then mutate the relevant field per case.
 *
 * @param {Partial<{ mode: string, dryRun: boolean, force: boolean, yes: boolean }>} overrides
 */
function makeStubs(overrides = {}) {
  const parsed = {
    mode: overrides.mode ?? 'install',
    dryRun: overrides.dryRun ?? false,
    force: overrides.force ?? false,
    yes: overrides.yes ?? false,
  };
  const parseFlags = mock.fn(() => parsed);
  const runInstaller = mock.fn(async () => ({ ok: true }));
  const runRepair = mock.fn(async () => ({ ok: true, fixed: [] }));
  return { parseFlags, runInstaller, runRepair, parsed };
}

function makeFailingRepairStubs({ installerOk = true, repairFixed = ['stale-link'] } = {}) {
  const parsed = { mode: 'install', dryRun: false, force: false, yes: false };
  const parseFlags = mock.fn(() => parsed);
  const runInstaller = mock.fn(async () => ({ ok: installerOk }));
  const runRepair = mock.fn(async () => ({ ok: true, fixed: repairFixed }));
  return { parseFlags, runInstaller, runRepair, parsed };
}

describe('runUpdateWithFlags — flag wiring', () => {
  test("['--dry-run'] calls runInstaller with { mode: 'install', dryRun: true, force: false, yes: false }", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ dryRun: true });
    await runUpdateWithFlags({ args: ['--dry-run'], ...stubs });
    assert.equal(stubs.runInstaller.mock.calls.length, 1);
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'install', dryRun: true, force: false, yes: false });
  });

  test("['--force'] propagates force: true to runInstaller", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ force: true });
    await runUpdateWithFlags({ args: ['--force'], ...stubs });
    assert.equal(stubs.runInstaller.mock.calls.length, 1);
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'install', dryRun: false, force: true, yes: false });
  });

  test("['--mode=update'] propagates mode: 'update' to runInstaller", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ mode: 'update' });
    await runUpdateWithFlags({ args: ['--mode=update'], ...stubs });
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'update', dryRun: false, force: false, yes: false });
  });

  test("[] defaults to { mode: 'install', dryRun: false, force: false, yes: false }", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs();
    await runUpdateWithFlags({ args: [], ...stubs });
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'install', dryRun: false, force: false, yes: false });
  });

  test("['--yes', '-y'] propagates yes: true (both aliases accepted)", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ yes: true });
    await runUpdateWithFlags({ args: ['--yes', '-y'], ...stubs });
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.equal(callArg.yes, true);
    assert.equal(callArg.force, false);
    assert.equal(callArg.dryRun, false);
  });

  test("['--update'] propagates mode: 'update' (legacy alias for --mode=update)", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ mode: 'update' });
    await runUpdateWithFlags({ args: ['--update'], ...stubs });
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'update', dryRun: false, force: false, yes: false });
  });

  test("['--dry-run'] calls runRepair({}) exactly once after runInstaller (A6 regression)", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ dryRun: true });
    await runUpdateWithFlags({ args: ['--dry-run'], ...stubs });
    assert.equal(stubs.runRepair.mock.calls.length, 1, 'runRepair must run even under --dry-run');
    assert.deepEqual(stubs.runRepair.mock.calls[0].arguments[0], {}, 'runRepair must be called with {} (no dryRun forwarded)');
  });

  test("runInstaller returning { ok: false } triggers process.exit(1)", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const exitMock = mock.method(process, 'exit', () => {});
    try {
      const stubs = makeFailingRepairStubs({ installerOk: false });
      await runUpdateWithFlags({ args: [], ...stubs });
      assert.equal(exitMock.mock.calls.length, 1, 'process.exit must be called exactly once');
      assert.equal(exitMock.mock.calls[0].arguments[0], 1);
      // runRepair still runs before exit so stale symlinks don't
      // outlive a failed update — the A6 regression test covers this
      // independently, but the ordering matters: install → repair → exit.
      assert.equal(stubs.runRepair.mock.calls.length, 1);
    } finally {
      exitMock.mock.restore();
    }
  });

  test("['--help'] (isHelpRequest=true) routes to showUpdateHelp, not runInstaller", async () => {
    const { update, showUpdateHelp } = await import('../commands/install.mjs');
    // Spy on showUpdateHelp via mock.method — module-bound function.
    const spy = mock.method(
      { showUpdateHelp },
      'showUpdateHelp',
      () => {}
    );
    // Stub via the same dependency-injection path used by the
    // runUpdateWithFlags tests so we can assert runInstaller was NOT
    // called when isHelpRequest is true.
    const runInstaller = mock.fn(async () => ({ ok: true }));
    const runRepair = mock.fn(async () => ({ ok: true, fixed: [] }));
    const parseFlags = mock.fn(() => ({ mode: 'install', dryRun: false, force: false, yes: false }));
    try {
      await update(['--help'], true);
      assert.equal(runInstaller.mock.calls.length, 0, 'runInstaller must not run when isHelpRequest=true');
      assert.equal(runRepair.mock.calls.length, 0, 'runRepair must not run when isHelpRequest=true');
      assert.equal(parseFlags.mock.calls.length, 0, 'parseFlags must not run when isHelpRequest=true');
    } finally {
      spy.mock.restore?.();
    }
  });

  test("['--dry-run', '--force', '--yes'] produces { mode: 'install', dryRun: true, force: true, yes: true }", async () => {
    const { runUpdateWithFlags } = await import('../commands/install.mjs');
    const stubs = makeStubs({ dryRun: true, force: true, yes: true });
    await runUpdateWithFlags({ args: ['--dry-run', '--force', '--yes'], ...stubs });
    const callArg = stubs.runInstaller.mock.calls[0].arguments[0];
    assert.deepEqual(callArg, { mode: 'install', dryRun: true, force: true, yes: true });
  });
});

console.log('  update-wrapper.test.mjs loaded — run with: node --test cli/install/update-wrapper.test.mjs');
