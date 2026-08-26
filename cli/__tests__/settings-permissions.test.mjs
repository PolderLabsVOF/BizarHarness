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

// F-176: full permissions by default. deny and ask are both empty.
// Everything that USED to be a hard-deny or ask lives in the hook
// chain as an advisory reminder injected via additionalContext.

test('F-176: permissions.deny is empty (full permissions by default)', () => {
  const deny = loadSettings().permissions?.deny || [];
  assert.deepEqual(deny, [], `expected deny to be []; got ${JSON.stringify(deny)}`);
});

test('F-176: permissions.ask is empty (no HITL prompts on subagents)', () => {
  const ask = loadSettings().permissions?.ask || [];
  assert.deepEqual(ask, [], `expected ask to be []; got ${JSON.stringify(ask)}`);
});

test('F-176: permissions.defaultMode is bypassPermissions', () => {
  const mode = loadSettings().permissions?.defaultMode;
  assert.equal(mode, 'bypassPermissions');
});