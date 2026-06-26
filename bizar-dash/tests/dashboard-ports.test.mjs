/**
 * bizar-dash/tests/dashboard-ports.test.mjs
 *
 * Regression tests for the "stale PID file → false positive
 * `Another Bizar dashboard is already running`" trap.
 *
 * History (v3.20.14):
 *   - The dashboard lifecycle used to:
 *     1. Scan `ps` for any process whose argv contained "bizar dash"
 *        or "@polderlabs/bizar-dash/src/cli.mjs".
 *     2. Trust that ps-scan result + `process.kill(pid, 0)` returned
 *        true to mean "this is a dashboard".
 *     3. Refuse to start, refuse to cleanup, refuse to stop.
 *   - On a busy machine, Linux recycles PIDs in milliseconds. A
 *     chrome-headless-shell renderer that happened to land on the
 *     recycled PID number would match the regex AND pass kill(0),
 *     and the dashboard would refuse to start forever.
 *   - The cmdline was stale, but `ps` re-reads /proc each call so
 *     we never noticed.
 *
 * Fix: `cmdlineLooksLikeDashboard(cmdline)` rejects anything that
 * doesn't structurally look like a Bizar dashboard launch. Re-applied
 * at probe time via `verifyCmdlineAtProbeTime(pid)` to catch the
 * recycled-PID race.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmdlineLooksLikeDashboard,
  verifyCmdlineAtProbeTime,
} from '../src/cli/dashboard-ports.mjs';

// ── cmdlineLooksLikeDashboard ─────────────────────────────────────────

test('cmdlineLooksLikeDashboard: accepts node + cli.mjs direct invocation', () => {
  assert.equal(
    cmdlineLooksLikeDashboard('node /usr/local/lib/node_modules/@polderlabs/bizar-dash/src/cli.mjs start'),
    true,
  );
  assert.equal(
    cmdlineLooksLikeDashboard('node /home/me/.local/share/npm/_npx/hash/node_modules/@polderlabs/bizar-dash/src/cli.mjs start --bg --port=4321'),
    true,
  );
});

test('cmdlineLooksLikeDashboard: accepts bizar-bin invocation', () => {
  assert.equal(
    cmdlineLooksLikeDashboard('/usr/local/bin/bizar dash start'),
    true,
  );
  assert.equal(
    cmdlineLooksLikeDashboard('/home/me/.local/npm/bin/bizar dash start --bg --port=4322'),
    true,
  );
  assert.equal(
    cmdlineLooksLikeDashboard('node /usr/local/bin/bizar dash tui'),
    true,
  );
});

test('cmdlineLooksLikeDashboard: rejects chrome-headless-shell renderer (recycled PID)', () => {
  // This is what a recycled PID looks like: chrome-headless-shell
  // happened to land on PID 938619, and its cmdline contains the
  // substring "bizar" nowhere — so it should NOT be flagged as a
  // dashboard.
  assert.equal(
    cmdlineLooksLikeDashboard('/home/me/.cache/puppeteer/chrome-headless-shell-linux64/chrome-headless-shell --type=renderer --headless=old --no-sandbox'),
    false,
  );
});

test('cmdlineLooksLikeDashboard: rejects stale shell command containing the words "bizar dash"', () => {
  // A bash command whose body mentions `bizar dash` in a comment
  // would match the old loose regex. The structural check rejects it
  // because there's no `bizar` bin followed by `dash <subcommand>`.
  assert.equal(
    cmdlineLooksLikeDashboard('bash -c "echo I want to run bizar dash start"'),
    false,
  );
  assert.equal(
    cmdlineLooksLikeDashboard('man bizar-dash-config'),
    false,
  );
});

test('cmdlineLooksLikeDashboard: rejects ssh / tailscale sessions with "bizar" in env', () => {
  // An ssh session whose env has "bizar" in some variable but whose
  // argv doesn't actually invoke the dashboard CLI.
  assert.equal(
    cmdlineLooksLikeDashboard('/usr/sbin/tailscaled be-child ssh --login-shell=/usr/bin/fish'),
    false,
  );
});

test('cmdlineLooksLikeDashboard: rejects empty / null input', () => {
  assert.equal(cmdlineLooksLikeDashboard(''), false);
  assert.equal(cmdlineLooksLikeDashboard(null), false);
  assert.equal(cmdlineLooksLikeDashboard(undefined), false);
  assert.equal(cmdlineLooksLikeDashboard(42), false);
});

// ── verifyCmdlineAtProbeTime ───────────────────────────────────────────

test('verifyCmdlineAtProbeTime: dead PID returns null', () => {
  // Use a PID that's almost certainly dead.
  const result = verifyCmdlineAtProbeTime(999999999);
  assert.equal(result, null);
});

test('verifyCmdlineAtProbeTime: current PID with non-dashboard cmdline returns null', () => {
  // The test runner itself is a node process but its cmdline won't
  // look like a Bizar dashboard launch.
  const result = verifyCmdlineAtProbeTime(process.pid);
  assert.equal(result, null);
});

test('verifyCmdlineAtProbeTime: missing PID returns null', () => {
  assert.equal(verifyCmdlineAtProbeTime(null), null);
  assert.equal(verifyCmdlineAtProbeTime(0), null);
  assert.equal(verifyCmdlineAtProbeTime(undefined), null);
});

// ── Real-world cmdline strings that have caused false positives ───────

test('cmdlineLooksLikeDashboard: rejects the v3.20.13 false-positive case', () => {
  // The exact scenario from the v3.20.13 bug report: ps-scan found
  // PID 938619 with cmdline "node /home/drb0rk/.local/npm/bin/bizar
  // dash start --bg --port=4322" — except PID 938619 was recycled
  // to a chrome renderer between ps-scan and pidAlive. The structural
  // check on the current /proc/<pid>/cmdline returns null, so the
  // dashboard is correctly classified as dead.
  //
  // We simulate this by checking that chrome's cmdline (what the
  // recycled PID actually contains now) doesn't match.
  const chromeCmdline = '/home/drb0rk/.cache/puppeteer/chrome-headless-shell-linux64/chrome-headless-shell --type=renderer --headless=old --no-sandbox --remote-debugging-port=9222';
  assert.equal(cmdlineLooksLikeDashboard(chromeCmdline), false);
});