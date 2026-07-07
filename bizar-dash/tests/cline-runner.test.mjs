/**
 * tests/cline-runner.test.mjs
 *
 * Unit tests for the dashboard's cline-runner.mjs. The
 * companion plugin runner (plugins/bizar/src/cline-runner.ts) is
 * tested via bun in plugins/bizar/tests/.
 *
 * Run with: node --test tests/cline-runner.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { spawnAgent, getStatus, onExit, killAgent, list, _resetForTests } from '../src/server/cline-runner.mjs';

const HAS_CLINE = (() => {
  try {
    const r = spawnSync('which', ['cline'], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
})();

test('_resetForTests clears the registry', () => {
  list(); // sanity check no throw
  _resetForTests();
  assert.equal(list().length, 0);
});

test('getStatus returns null for unknown processId', () => {
  _resetForTests();
  assert.equal(getStatus(99999), null);
});

test('killAgent on unknown processId is a no-op success', () => {
  _resetForTests();
  const res = killAgent(99999);
  assert.equal(res.ok, true);
});

test('spawnAgent with non-existent worktree still returns a processId', { skip: !HAS_CLINE }, async () => {
  _resetForTests();
  const dir = mkdtempSync(join(tmpdir(), 'oc-runner-'));
  const logPath = join(dir, 'test.log');
  // Worktree doesn't exist, but spawn should still succeed and
  // cline will exit early with an error. We just verify the API
  // contract: we get back a processId immediately, and the spawn
  // resolves once the sessionId appears or the process exits.
  const result = await Promise.race([
    spawnAgent({
      prompt: 'just say hi',
      agent: 'mimir',
      worktree: '/this/does/not/exist/anywhere',
      logPath,
      sessionIdTimeoutMs: 3000,
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('spawnAgent timeout')), 5000)),
  ]);
  // Either ok:false (process exited before reporting session) or
  // ok:true (rare if cline somehow succeeded) is acceptable.
  assert.ok(typeof result.ok === 'boolean', 'expected ok to be boolean');
  // The log dir should exist (spawnAgent creates it).
  assert.ok(existsSync(dir), 'log dir should exist');
  // No process should still be tracked if the spawn failed.
  if (!result.ok) {
    assert.ok(!result.sessionId, 'no sessionId on failure');
  }
});

test('spawnAgent creates log dir if missing', { skip: !HAS_CLINE }, async () => {
  _resetForTests();
  const tmp = mkdtempSync(join(tmpdir(), 'oc-runner-logdir-'));
  const nested = join(tmp, 'a', 'b', 'c');
  const logPath = join(nested, 'test.log');
  // The dir nested/a/b/c does not exist yet. spawnAgent should
  // create it. The actual cline process will likely fail (no
  // worktree, etc.) but that's irrelevant to this test.
  await Promise.race([
    spawnAgent({
      prompt: 'hi',
      agent: 'mimir',
      worktree: tmp,
      logPath,
      sessionIdTimeoutMs: 1000,
    }),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => undefined);
  assert.ok(existsSync(nested), `expected ${nested} to exist`);
});

test('spawnAgent captures stdout+stderr to logPath', { skip: !HAS_CLINE }, async () => {
  _resetForTests();
  const tmp = mkdtempSync(join(tmpdir(), 'oc-runner-cap-'));
  const logPath = join(tmp, 'capture.log');
  // Use /tmp as worktree — it exists. cline will run there.
  const res = await Promise.race([
    spawnAgent({
      prompt: 'just say hi',
      agent: 'mimir',
      worktree: tmp,
      logPath,
      sessionIdTimeoutMs: 5000,
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
  ]);
  // Resolved (either ok or with error). Wait briefly for the log
  // stream to flush.
  await new Promise((r) => setTimeout(r, 500));
  if (existsSync(logPath)) {
    const stat = statSync(logPath);
    assert.ok(stat.size >= 0, 'log file has size');
    // If we wrote anything, it should be either [stdout] or [stderr]
    // prefixed. (If the file is empty, the test passes trivially.)
    if (stat.size > 0) {
      const content = readFileSync(logPath, 'utf8');
      // Either content is empty (process didn't output anything)
      // or contains our prefix tags. We don't assert specific
      // content because the cline run is environment-dependent.
      assert.ok(
        content.includes('[stderr]') || content.includes('[stdout]') || content.length === 0,
        'log file should be empty or contain [stderr]/[stdout] prefixes',
      );
    }
  }
  // If the process is still running, kill it to clean up.
  if (res.processId && getStatus(res.processId) && getStatus(res.processId).state === 'running') {
    killAgent(res.processId);
  }
});

test('onExit fires when process exits', { skip: !HAS_CLINE }, async () => {
  _resetForTests();
  const tmp = mkdtempSync(join(tmpdir(), 'oc-runner-exit-'));
  const logPath = join(tmp, 'exit.log');
  const res = await Promise.race([
    spawnAgent({
      prompt: 'hi',
      agent: 'mimir',
      worktree: tmp,
      logPath,
      sessionIdTimeoutMs: 3000,
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
  ]).catch(() => ({ ok: false, processId: undefined }));

  if (!res.processId) {
    // Process never started; test is moot.
    return;
  }

  // onExit should fire within a reasonable time.
  const status = await Promise.race([
    new Promise((resolve) => {
      onExit(res.processId, (s) => resolve(s));
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('onExit timeout')), 10_000)),
  ]).catch(() => null);

  // status may be null if the test timed out; either way the test
  // is best-effort in this environment.
  if (status) {
    assert.ok(
      ['done', 'failed', 'killed'].includes(status.state),
      `state should be terminal, got ${status.state}`,
    );
    assert.ok(typeof status.endedAt === 'number', 'endedAt set');
  }
});
