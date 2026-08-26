import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS = join(REPO_ROOT, 'config', 'claude', 'settings.json');

const REQUIRED_COMMIT_PATTERNS = [
  'Bash(git commit *)',
  'Bash(git commit)',
  'Bash(git -C * commit *)',
  'Bash(git -C * commit)',
  'Bash(git --git-dir=* commit *)',
  'Bash(git --git-dir=* commit)',
  'Bash(git commit --amend *)',
  'Bash(git commit --amend)',
  'Bash(git -C * commit --amend *)',
  'Bash(git -C * commit --amend)',
  'Bash(git --git-dir=* commit --amend *)',
  'Bash(git --git-dir=* commit --amend)',
];

function loadSettings() {
  return JSON.parse(readFileSync(SETTINGS, 'utf8'));
}

test('local git commit family is in permissions.allow (not ask, not deny)', () => {
  const perms = loadSettings().permissions || {};
  const allow = new Set(perms.allow || []);
  const deny = new Set(perms.deny || []);
  const ask = new Set(perms.ask || []);
  for (const pattern of REQUIRED_COMMIT_PATTERNS) {
    assert.ok(allow.has(pattern), `missing allow entry: ${pattern}`);
    assert.ok(!deny.has(pattern), `commit pattern leaked into deny: ${pattern}`);
    assert.ok(!ask.has(pattern), `commit pattern leaked into ask: ${pattern}`);
  }
});

test('push --force and rebase stay in permissions.deny', () => {
  const deny = new Set(loadSettings().permissions?.deny || []);
  for (const pattern of ['Bash(git push --force *)', 'Bash(git rebase *)']) {
    assert.ok(deny.has(pattern), `expected deny entry: ${pattern}`);
  }
});
