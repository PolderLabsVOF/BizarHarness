/**
 * cli/__tests__/bin-help-dispatch.test.mjs
 *
 * Regression test for the bin.mjs help dispatcher.
 *
 * History: when a user typed `bizar bench --help`, the dispatcher in
 * cli/bin.mjs routed the call through `mod.run(cmd, cmdArgs, true)` —
 * a 3-argument signature that exists only for util.mjs / install.mjs /
 * claude-cmd.mjs / migrate.mjs. Direct command modules
 * (bench, release-provenance, verify-release, spec-list, …) export a
 * single-argument `run(subargs)`. The dispatcher passed the literal
 * string `"bench"` as the first argument, and `subargs.includes('--help')`
 * threw `subargs.find is not a function`.
 *
 * The fix removes the catch-all `else` branch from the help dispatcher
 * so direct command modules fall through to the switch statement
 * (which calls `mod.run(cmdArgs)` with a single array argument).
 *
 * This test spawns the CLI for each direct command with `--help` and
 * asserts the output starts with the command's usage banner rather
 * than the previous crash signature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin.mjs');

function runHelp(cmd, extraArgs = []) {
  return spawnSync(process.execPath, [BIN, cmd, '--help', ...extraArgs], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

// Direct command modules: must accept `run(cmdArgs)`, not the legacy
// `run(name, args, isHelpRequest)` 3-arg signature.
const DIRECT_COMMANDS = [
  { cmd: 'bench', expect: 'bizar bench — audit #85 efficiency benchmarks' },
  { cmd: 'release-provenance', expect: 'bizar release-provenance — Generate SBOM' },
  { cmd: 'verify-release', expect: 'bizar verify-release — Verify a release artifact' },
  { cmd: 'spec-list', expect: 'bizar spec-list — audit #84 schema' },
  { cmd: 'ambiguity', expect: 'bizar ambiguity — score a deep-interview' },
  { cmd: 'guard', expect: 'bizar guard — F-206 progress-guarding loop' },
];

// Util-routed commands: still go through the help dispatcher and
// expect the dispatcher to call mod.run(cmd, cmdArgs, true).
const UTIL_COMMANDS = [
  { cmd: 'audit', expect: 'bizar audit — Run security audit' },
  { cmd: 'doctor', expect: 'bizar doctor — Check the BizarHarness install' },
];

for (const { cmd, expect } of DIRECT_COMMANDS) {
  test(`binar ${cmd} --help falls through to the switch (no crash)`, () => {
    const { stdout, stderr, status } = runHelp(cmd);
    assert.ok(
      status === 0 || status === 2,
      `${cmd} --help should exit cleanly, got ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
    assert.ok(
      !stderr.includes('is not a function'),
      `${cmd} --help must not throw "is not a function"; stderr:\n${stderr}`,
    );
    assert.ok(
      stdout.includes(expect) || stderr.includes(expect),
      `${cmd} --help output must contain usage banner; got:\n${stdout}\n${stderr}`,
    );
  });
}

for (const { cmd, expect } of UTIL_COMMANDS) {
  test(`binar ${cmd} --help still routes through the help dispatcher`, () => {
    const { stdout, stderr, status } = runHelp(cmd);
    assert.ok(
      status === 0 || status === 2,
      `${cmd} --help should exit cleanly, got ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
    assert.ok(
      stdout.includes(expect) || stderr.includes(expect),
      `${cmd} --help output must contain usage banner; got:\n${stdout}\n${stderr}`,
    );
  });
}

test('help dispatcher no longer forwards "else" branch as 3-arg call', () => {
  // Smoke: bizarre, but explicit — make sure invoking `binar bench
  // --help` with no extra args doesn't crash even though `--help` is
  // the first subcommand flag. (This was the original failure mode.)
  const { stderr } = runHelp('bench');
  assert.ok(
    !stderr.includes('subargs.find is not a function'),
    `the original regression signature must not appear; got:\n${stderr}`,
  );
});