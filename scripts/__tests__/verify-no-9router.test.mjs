/**
 * scripts/__tests__/verify-no-9router.test.mjs
 *
 * Phase A.5 drift-guard regression. Exercises the actual
 * `scripts/verify-no-9router.mjs` exit-code contract by spawning it in
 * a clean subprocess against the real repo, then by injecting a fake
 * 9router reference and confirming the guard flips to exit 1 with the
 * expected label.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts', 'verify-no-9router.mjs');

function runGuard() {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('verify-no-9router drift guard', () => {
  it('passes on the current repo surface', () => {
    const r = runGuard();
    assert.equal(r.status, 0, `guard should pass; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /provider-agnostic invariant/);
  });

  it('fails when a 9router reference is reintroduced into a scanned file', () => {
    const target = join(REPO_ROOT, 'cli', '__tests__', 'no-9router-leak-canary.md');
    writeFileSync(target, 'leaked: 9router reference\n');
    try {
      const r = runGuard();
      assert.equal(r.status, 1, 'guard should fail when a 9router reference is reintroduced');
      assert.match(r.stderr, /9router: cli[\\/]__tests__[\\/]no-9router-leak-canary\.md/);
    } finally {
      rmSync(target, { force: true });
    }
  });

  it('still passes after the canary is removed', () => {
    // Sanity check the cleanup: no residual 9router ref left on disk.
    assert.equal(
      existsSync(join(REPO_ROOT, 'cli', '__tests__', 'no-9router-leak-canary.md')),
      false,
      'canary must be removed before the test exits',
    );
    const r = runGuard();
    assert.equal(r.status, 0);
  });

  it('skips files matching the *.test.* exclusion rule', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /\\\.test\\\.\[cm\]\?\[jt\]sx\?\$/, 'guard must skip *.test.* files');
  });
});