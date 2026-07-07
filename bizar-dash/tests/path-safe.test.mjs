/**
 * tests/path-safe.test.mjs
 *
 * Unit tests for the bg-log path helpers. Run with:
 *   node --test tests/path-safe.test.mjs
 *
 * Covers:
 *   - getActualBgLogPath returns the path the plugin's LogWriter
 *     actually writes to (per plugins/bizar/src/options.ts:88 default
 *     logDir of ~/.cache/bizar/logs).
 *   - BIZAR_LOG_DIR env override is honored.
 *   - Path sanitizer strips unsafe characters from the session id.
 *   - The old phantom path (`<worktree>/.bizar/cline.log`) is NOT
 *     returned — regression guard for the bug fixed in v3.11.1.
 *   - deriveAbsoluteBgLogPath still returns the historical worktree-
 *     based path (so we don't accidentally break callers depending on
 *     the old field).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve as pathResolve, sep } from 'node:path';
import { homedir } from 'node:os';

import {
  getBgLogDir,
  getActualBgLogPath,
  deriveAbsoluteBgLogPath,
} from '../src/server/lib/path-safe.mjs';

const HOME = homedir();
const FALLBACK = pathResolve(HOME, '.cache', 'bizar', 'logs');

test('getBgLogDir returns the fallback when no env override', () => {
  const dir = getBgLogDir({ env: {} });
  assert.equal(dir, FALLBACK);
});

test('getBgLogDir honors BIZAR_LOG_DIR env override', () => {
  const dir = getBgLogDir({ env: { BIZAR_LOG_DIR: '/tmp/bizar-test' } });
  assert.equal(dir, pathResolve('/tmp/bizar-test'));
});

test('getActualBgLogPath returns path the LogWriter writes to', () => {
  const p = getActualBgLogPath({ sessionId: 'ses_abc123' });
  // The plugin's default logDir is ~/.cache/bizar/logs; the file is
  // named <sessionId>.log. This must match the LogWriter's actual
  // output path (plugins/bizar/src/report.ts:147).
  assert.equal(p, pathResolve(FALLBACK, 'ses_abc123.log'));
});

test('getActualBgLogPath sanitizes unsafe characters in sessionId', () => {
  const p = getActualBgLogPath({ sessionId: '../../etc/passwd' });
  // The `..` and `/` get replaced with `_`. The result must be a
  // path under the log dir, never escape it via path traversal.
  // Note: literal `..` can appear inside a single filename segment
  // (e.g. `.._.._etc_passwd.log`) without escaping — only the
  // directory boundaries matter. We assert the resolved path stays
  // inside FALLBACK_LOG_DIR.
  assert.ok(p.startsWith(FALLBACK + sep), `expected path to start with ${FALLBACK}, got ${p}`);
  const rel = p.slice(FALLBACK.length + 1);
  // The single filename segment must not itself contain `/` (which
  // would mean an attempt to escape via the basename).
  assert.ok(!rel.includes('/'), `expected no '/' in basename, got ${rel}`);
  assert.ok(p.endsWith('.log'));
});

test('getActualBgLogPath uses BIZAR_LOG_DIR env override', () => {
  const p = getActualBgLogPath({
    sessionId: 'ses_xyz',
    env: { BIZAR_LOG_DIR: '/tmp/bizar-test' },
  });
  assert.equal(p, pathResolve('/tmp/bizar-test', 'ses_xyz.log'));
});

test('getActualBgLogPath does NOT return the phantom .bizar/cline.log path (regression guard)', () => {
  // The old code at task-delegator.mjs:605 tailed
  // `<worktree>/.bizar/cline.log` — a path nothing writes to.
  // The new function must NOT return anything under `.bizar/` or
  // `.cline/log/`.
  const p = getActualBgLogPath({ sessionId: 'ses_regression' });
  assert.ok(!p.includes('/.bizar/'), `phantom '.bizar/' path leaked: ${p}`);
  assert.ok(!p.includes('/.cline/log/'), `phantom '.cline/log/' path leaked: ${p}`);
});

test('deriveAbsoluteBgLogPath still returns the historical worktree-based path', () => {
  // The bg-retry loop still uses this to repair stale logPath fields.
  // Make sure the behavior didn't change as part of the v3.11.1 fix.
  const p = deriveAbsoluteBgLogPath('/tmp/worktree', 'bgr_abc');
  assert.equal(p, pathResolve('/tmp/worktree', '.cline', 'log', 'bgr_abc.log'));
});

test('deriveAbsoluteBgLogPath falls back to FALLBACK_LOG_DIR when worktree missing', () => {
  const p = deriveAbsoluteBgLogPath('', 'bgr_xyz');
  assert.equal(p, pathResolve(FALLBACK, '.cline', 'log', 'bgr_xyz.log'));
});

test('getActualBgLogPath is preferred over deriveAbsoluteBgLogPath for operator-facing tail targets', () => {
  // Document the contract: when you want to show the operator a real
  // log, use getActualBgLogPath. The historical worktree-based path
  // exists only for repairing stale state files.
  const sessionId = 'ses_operator_view';
  const realPath = getActualBgLogPath({ sessionId });
  const worktreePath = deriveAbsoluteBgLogPath('/tmp/proj', 'bg_' + sessionId.slice(3, 19));
  assert.notEqual(realPath, worktreePath);
  // Real path is in the LogWriter's directory; worktree path is not.
  assert.ok(realPath.startsWith(FALLBACK));
  assert.ok(worktreePath.startsWith('/tmp/proj'));
});
