/**
 * scripts/git-hooks/__tests__/commit-msg.test.mjs
 *
 * Tests the commit-msg hook that strips Claude/agent co-author trailers.
 * Runs the bash hook against synthetic commit messages and asserts the
 * post-rewrite contents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', 'commit-msg');

function runHook(input) {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-hook-'));
  const msgFile = join(dir, 'msg');
  writeFileSync(msgFile, input);
  execFileSync('bash', [HOOK, msgFile], { stdio: 'pipe' });
  return readFileSync(msgFile, 'utf8');
}

test('strips Claude Co-Authored-By trailer', () => {
  const out = runHook('feat: test\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  assert.doesNotMatch(out, /Claude <noreply@anthropic\.com>/);
  assert.match(out, /feat: test/);
});

test('strips lowercase co-authored-by trailer (case-insensitive header)', () => {
  const out = runHook('feat: test\n\nco-authored-by: claude <noreply@anthropic.com>\n');
  assert.doesNotMatch(out, /claude <noreply@anthropic\.com>/);
});

test('strips agent-themed polderlabs.dev trailers', () => {
  const out = runHook('feat: test\n\nCo-authored-by: Odin <noreply@polderlabs.dev>\nCo-authored-by: Thor <noreply@polderlabs.dev>\n');
  assert.doesNotMatch(out, /Odin <noreply@polderlabs\.dev>/);
  assert.doesNotMatch(out, /Thor <noreply@polderlabs\.dev>/);
});

test('preserves human co-author trailers', () => {
  const out = runHook('feat: test\n\nCo-Authored-By: Real Human <real@example.com>\n');
  assert.match(out, /Real Human <real@example\.com>/);
});

test('preserves embedded Claude mentions in commit body', () => {
  const out = runHook('feat: test\n\nDiscussed Claude <noreply@anthropic.com> inline.\n\nSigned-off-by: Berk <berk@berkderooij.nl>\n');
  assert.match(out, /Discussed Claude <noreply@anthropic\.com> inline\./);
  assert.match(out, /Signed-off-by: Berk <berk@berkderooij\.nl>/);
});

test('collapses blank lines left by trailer removal', () => {
  const input = 'feat: x\n\nbody line\n\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n';
  const out = runHook(input);
  // No triple-newlines, no trailing Claude line
  assert.doesNotMatch(out, /\n\n\n/);
  assert.doesNotMatch(out, /Claude/);
});
