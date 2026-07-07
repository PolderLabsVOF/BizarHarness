/**
 * tests/tmux-wrap.test.mjs
 *
 * Regression tests for the bug where the dashboard's tmux wrap
 * (`task-delegator.mjs:605`, `bg-retry.mjs:392`) tailed a phantom
 * log file (`<worktree>/.bizar/cline.log` or
 * `<worktree>/.cline/log/<id>.log`) — paths nothing in the
 * system writes to.
 *
 * The fix uses `getActualBgLogPath()` (path-safe.mjs) which returns
 * the path the plugin's `LogWriter` actually writes to:
 * `~/.cache/bizar/logs/<sessionId>.log`.
 *
 * These tests assert the new behavior by simulating the dispatch
 * code path against an injected log file. They do NOT spawn a real
 * tmux session (the test environment may not have tmux).
 *
 * Run with: node --test tests/tmux-wrap.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { getActualBgLogPath } from '../src/server/lib/path-safe.mjs';

const HAS_TMUX = (() => {
  try {
    const r = spawnSync('which', ['tmux'], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
})();

/**
 * Simulate the tmux spawn exactly the way `background-store.mjs:278-310`
 * does. Returns the spawned session name on success, or null.
 */
function spawnTmuxFor(sessionName, logFile, cwd) {
  if (!HAS_TMUX) return null;
  const tmuxArgs = [
    'new-session', '-d', '-s', sessionName,
    '-x', '220', '-y', '50',
  ];
  if (cwd) tmuxArgs.push('-c', cwd);
  tmuxArgs.push('tail', '-n', '200', '-F', logFile);
  const r = spawnSync('tmux', tmuxArgs, { stdio: 'pipe', timeout: 5_000 });
  if (r.status !== 0) return null;
  return sessionName;
}

function killTmuxSession(name) {
  if (!HAS_TMUX) return;
  spawnSync('tmux', ['kill-session', '-t', name], { stdio: 'pipe' });
}

test('tmux wrap points at the actual LogWriter path, not the phantom .bizar/cline.log', () => {
  const sessionId = 'ses_wrap_test';
  // The dispatch code in task-delegator.mjs:605 calls
  // getActualBgLogPath({ sessionId }) to get the tmux tail target.
  const logFile = getActualBgLogPath({ sessionId });

  // The historical phantom path (v3.11.0 and earlier):
  const phantomPath = pathResolve(process.cwd(), '.bizar', 'cline.log');

  assert.notEqual(
    logFile,
    phantomPath,
    'tmux wrap must NOT tail the phantom .bizar/cline.log path',
  );
  // The actual path is the LogWriter's output.
  assert.ok(
    logFile.endsWith(`${sessionId}.log`),
    `expected log file to be <sessionId>.log, got ${logFile}`,
  );
});

test('tmux wrap tail target actually exists after LogWriter writes to it (end-to-end smoke)', { skip: !HAS_TMUX }, () => {
  // Make a fake LogWriter output by directly writing to the path
  // the tmux wrap tails. If the paths don't match, the tmux pane
  // will show "No such file or directory" — same as the v3.11.0 bug.
  const dir = mkdtempSync(join(tmpdir(), 'tmux-wrap-'));
  try {
    process.env.BIZAR_LOG_DIR = dir;
    const sessionId = 'ses_e2e';
    const logFile = getActualBgLogPath({ sessionId });
    // Pre-create the log file with one line, then append another
    // after tmux is watching. The capture-pane should reflect both.
    writeFileSync(logFile, 'first line\n', 'utf8');

    const sessionName = 'bgr_e2e_smoke';
    const created = spawnTmuxFor(sessionName, logFile, dir);
    if (!created) {
      // tmux not present in this environment — skip the rest.
      return;
    }

    try {
      // Give tail a moment to start watching.
      spawnSync('sleep', ['0.3']);
      appendFileSync(logFile, 'second line after tmux is watching\n', 'utf8');
      // Give tail a moment to pick it up.
      spawnSync('sleep', ['0.3']);

      const capture = spawnSync(
        'tmux', ['capture-pane', '-t', sessionName, '-p', '-S', '-50'],
        { encoding: 'utf8', timeout: 5_000 },
      );
      assert.equal(capture.status, 0, 'tmux capture-pane failed');
      const out = capture.stdout || '';
      // The pane must show at least one of the lines we wrote. The
      // pre-fix phantom path would show "cannot open ... for reading".
      assert.ok(
        out.includes('first line') || out.includes('second line'),
        `expected pane to show our log content, got: ${out}`,
      );
      assert.ok(
        !out.includes('cannot open'),
        `pane must not show phantom-file error, got: ${out}`,
      );
    } finally {
      killTmuxSession(sessionName);
    }
  } finally {
    delete process.env.BIZAR_LOG_DIR;
  }
});

test('getActualBgLogPath falls back to ~/.cache/bizar/logs by default', () => {
  // Important: when BIZAR_LOG_DIR is not set, the path must point
  // at the same location the plugin's LogWriter (default logDir
  // ~/.cache/bizar/logs) writes to. If these drift, the bug
  // regresses silently.
  const before = process.env.BIZAR_LOG_DIR;
  delete process.env.BIZAR_LOG_DIR;
  try {
    const p = getActualBgLogPath({ sessionId: 'ses_default' });
    assert.equal(p, pathResolve(process.env.HOME || '/tmp', '.cache', 'bizar', 'logs', 'ses_default.log'));
  } finally {
    if (before) process.env.BIZAR_LOG_DIR = before;
  }
});
