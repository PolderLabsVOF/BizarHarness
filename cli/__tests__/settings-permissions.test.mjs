import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS = join(REPO_ROOT, 'config', 'claude', 'settings.json');

// F-176: the SHIPPED template carries NO `allow` rules. The floor is
// enforced by the `permission-request.mjs` hook, not by Claude Code prompts.
// `cli/provision.mjs:writeClaudeSettings` union-merges the operator's
// existing `allow`/`ask`/`deny` onto whatever the template ships so a
// user's deliberate configuration survives a force re-install.
const DROPPED_DANGEROUS_PATTERNS = [
  'Bash(git -C * commit *)',
  'Bash(git -C * commit)',
  'Bash(git --git-dir=* commit *)',
  'Bash(git --git-dir=* commit)',
  'Bash(git -C * commit --amend *)',
  'Bash(git -C * commit --amend)',
  'Bash(git --git-dir=* commit --amend *)',
  'Bash(git --git-dir=* commit --amend)',
];

function loadSettings() {
  return JSON.parse(readFileSync(SETTINGS, 'utf8'));
}

test('F-176: shipped permissions.allow is empty (template carries no rules)', () => {
  const allow = loadSettings().permissions?.allow ?? null;
  assert.deepEqual(allow, [], `expected shipped allow to be []; got ${JSON.stringify(allow)}`);
});

test('F-176: shipped permissions.deny is empty (full permissions by default)', () => {
  const deny = loadSettings().permissions?.deny || [];
  assert.deepEqual(deny, [], `expected deny to be []; got ${JSON.stringify(deny)}`);
});

test('F-176: shipped permissions.ask is empty (no HITL prompts on subagents)', () => {
  const ask = loadSettings().permissions?.ask || [];
  assert.deepEqual(ask, [], `expected ask to be []; got ${JSON.stringify(ask)}`);
});

test('F-176: permissions.defaultMode is bypassPermissions', () => {
  const mode = loadSettings().permissions?.defaultMode;
  assert.equal(mode, 'bypassPermissions');
});

test('F-176: shipped template does NOT carry the dangerous 8-pattern git family', () => {
  const allow = loadSettings().permissions?.allow || [];
  for (const pattern of DROPPED_DANGEROUS_PATTERNS) {
    assert.ok(
      !allow.includes(pattern),
      `dangerous pattern still in shipped allow: ${pattern}`,
    );
  }
});

test('F-176: shipped template does NOT carry the mcp__* wildcard', () => {
  const allow = loadSettings().permissions?.allow || [];
  assert.ok(
    !allow.includes('mcp__*'),
    'mcp__* wildcard still in shipped allow; tool authorization is enforced by the hook policy',
  );
});
