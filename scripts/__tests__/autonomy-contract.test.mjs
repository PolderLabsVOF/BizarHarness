import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS_PATH = join(REPO_ROOT, 'config', 'claude', 'settings.json');
const CONTRACT_PATH = join(REPO_ROOT, 'docs', 'decisions', 'AUTONOMY_CONTRACT.md');
const PERM_REQUEST_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'permission-request.mjs');
const PRETOOLUSE_BASH_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'pretooluse-bash.mjs');
const PRETOOLUSE_EDIT_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'pretooluse-editwrite.mjs');
const GIT_WORKFLOW_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'git-workflow-guard.mjs');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('AUTONOMY_CONTRACT.md exists and is non-empty', () => {
  assert.equal(existsSync(CONTRACT_PATH), true, `${CONTRACT_PATH} must exist`);
  const body = readFileSync(CONTRACT_PATH, 'utf8');
  assert.ok(body.length > 200, 'AUTONOMY_CONTRACT.md must have substantive content');
  assert.match(body, /^# AUTONOMY_CONTRACT/m, 'must start with the H1 title');
  assert.match(body, /\*\*Status:\*\*\s*Accepted/, 'must declare its status');
  for (const tier of ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']) {
    assert.match(body, new RegExp(tier), `must enumerate ${tier}`);
  }
});

test('settings.json satisfies the contract (allow=[], deny=[], ask=[], bypassPermissions)', () => {
  // F-176 (10.17.4): the SHIPPED template carries EMPTY `allow`, `deny`,
  // and `ask` arrays. The destructive floor (push/rebase/force/destructive
  // filesystem ops) is enforced by `permission-request.mjs` returning
  // `behavior: 'deny'` for Tier-4 shapes; everything else is gated by
  // the advisory hook chain (pretooluse-bash, pretooluse-editwrite,
  // git-workflow-guard) via `additionalContext`. Operators opt into
  // specific `allow` patterns by adding them to their live
  // `~/.claude/settings.json`; the union-merge in
  // `cli/provision.mjs:writeClaudeSettings` preserves them across
  // re-installs.
  const settings = readJSON(SETTINGS_PATH);
  const perms = settings.permissions || {};
  assert.deepEqual(perms.allow ?? null, [], 'permissions.allow must be [] (F-176)');
  assert.deepEqual(perms.deny ?? [], [], 'permissions.deny must be []');
  assert.deepEqual(perms.ask ?? [], [], 'permissions.ask must be []');
  assert.equal(perms.defaultMode, 'bypassPermissions', 'defaultMode must be bypassPermissions');
});

test('settings.json permissions.allow ships empty + dangerous patterns absent', () => {
  const settings = readJSON(SETTINGS_PATH);
  const allow = settings.permissions?.allow ?? [];
  assert.deepEqual(allow, [], 'shipped template must carry empty allow (F-176)');
  // F-176: the dangerous 8-pattern family and `mcp__*` wildcard must
  // NOT ship. The explicit `mcp__bizar__*` / `mcp__semble__*` /
  // `mcp__agent-browser__*` per-tool allowlist is enforced by hook
  // output (`additionalContext`) at run-time, not by static allow rules.
  for (const pattern of [
    'mcp__*',
    'Bash(git -C * commit *)',
    'Bash(git -C * commit)',
    'Bash(git --git-dir=* commit *)',
    'Bash(git --git-dir=* commit)',
    'Bash(git -C * commit --amend *)',
    'Bash(git -C * commit --amend)',
    'Bash(git --git-dir=* commit --amend *)',
    'Bash(git --git-dir=* commit --amend)',
  ]) {
    assert.ok(
      !allow.includes(pattern),
      `permissions.allow must NOT include ${pattern} (F-176)`,
    );
  }
});

test('permission-request.mjs hard-denies the Tier-4 destructive floor', () => {
  // PermissionRequest is the ONLY hook that still returns `deny` (the
  // Claude Code Prompt-flow fall-back). PreToolUse hooks are advisory
  // per F-176; this PermissionRequest hook IS the hard floor.
  const source = readFileSync(PERM_REQUEST_PATH, 'utf8');
  // The hook stores the regex as a string-literal source token, so the
  // literal text we assert is the raw `\b` escapes, not the regex
  // word-boundary semantics those escapes have at runtime.
  for (const token of [
    'git\\s+push',
    '--force',
    'git\\s+rebase',
    'rm\\s+-',
    'mkfs|shutdown|halt|poweroff|reboot',
  ]) {
    assert.ok(
      source.includes(token),
      `permission-request.mjs must enforce ${token}`,
    );
  }
  assert.match(source, /behavior:\s*['"]deny['"]/, 'permission-request must still return deny');
});

test('pretooluse-bash.mjs enumerates the Tier-3/4 dangerous patterns as advisories', () => {
  // Under F-176 every PreToolUse pattern is advisory (`allow` +
  // `additionalContext`). The contract guarantees the scanner still
  // names each dangerous shape so the agent sees the reminder.
  const source = readFileSync(PRETOOLUSE_BASH_PATH, 'utf8');
  for (const name of ['rm-rf-root', 'rm-rf-system', 'mkfs', 'sudo', 'dd-of-dev']) {
    assert.match(source, new RegExp(`name:\\s*['"]${name}['"]`), `pretooluse-bash must list ${name}`);
  }
  assert.match(source, /permissionDecision:\s*['"]allow['"]/, 'pretooluse-bash must return allow (F-176)');
});

test('pretooluse-editwrite.mjs advisories cover package-manager and env templates', () => {
  // Under F-176 the per-write secret guard moved to git-workflow-guard.mjs
  // (staged-diff scanner at commit time). Pre-edit only flags package-
  // manager directories; allow-list covers .env.example/sample/template
  // and lockfiles.
  const source = readFileSync(PRETOOLUSE_EDIT_PATH, 'utf8');
  assert.match(source, /node_modules/, 'pretooluse-editwrite must advisory-flag node_modules/');
  assert.match(source, /\.env\.(example|sample|template|dist)/i, 'pretooluse-editwrite must allow .env templates');
  assert.match(source, /permissionDecision:\s*['"]allow['"]/, 'pretooluse-editwrite must return allow (F-176)');
});

test('git-workflow-guard.mjs enumerates the Tier-3 HITL categories as advisories', () => {
  // Source-level guarantee: every category the contract names is watched,
  // even if every output is `allow + additionalContext` per F-176. The
  // hook builds its regexes via `hasGhCommand(command, 'pr', …)` and
  // `hasGhCommand(command, 'release', …)` so we check the literal tokens
  // the dispatch sites pass to those helpers.
  const source = readFileSync(GIT_WORKFLOW_PATH, 'utf8');
  assert.match(source, /hasGhCommand\(command, ['"]pr['"]/, 'git-workflow-guard must dispatch gh pr advisories');
  assert.match(source, /hasGhCommand\(command, ['"]release['"]/, 'git-workflow-guard must dispatch gh release advisories');
  assert.match(source, /\b(?:npm|bun|pnpm)\b[\s\S]*\bpublish\b/, 'git-workflow-guard must scan npm|bun|pnpm publish');
  assert.match(source, /\bvercel\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan vercel deploy');
  assert.match(source, /\bwrangler\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan wrangler deploy');
  assert.match(source, /\bflyctl\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan flyctl deploy');
  assert.match(source, /--force/, 'git-workflow-guard must scan --force');
  assert.match(source, /['"]-f['"]/, 'git-workflow-guard must scan -f');
  assert.match(source, /findGitCommand\(command, ['"]rebase['"]/, 'git-workflow-guard must scan rebase');
  assert.match(source, /findGitCommand\(command, ['"]push['"]/, 'git-workflow-guard must scan push');
});

test('git-workflow-guard.mjs blocks secret paths at commit/push time', () => {
  // The Tier-4 secret guard moved here from pretooluse-editwrite.mjs after
  // F-200 — it scans `git add <secret>` and staged diffs for env/secrets/.
  const source = readFileSync(GIT_WORKFLOW_PATH, 'utf8');
  for (const secret of ['.env', '.envrc', 'secrets/', 'credentials/', '.pem', '.key']) {
    assert.ok(
      source.includes(secret),
      `git-workflow-guard must guard ${secret}`,
    );
  }
});

test('AUTONOMY_CONTRACT.md cross-references every enforcement surface', () => {
  const body = readFileSync(CONTRACT_PATH, 'utf8');
  for (const ref of [
    'permission-request.mjs',
    'git-workflow-guard.mjs',
    'pretooluse-bash.mjs',
    'pretooluse-editwrite.mjs',
    'simplify-guard.mjs',
    'content-style-guard.mjs',
    'agent-model-guard.mjs',
    'AGENTS.md',
    'scripts/__tests__/autonomy-contract.test.mjs',
  ]) {
    assert.ok(body.includes(ref), `AUTONOMY_CONTRACT.md must reference ${ref}`);
  }
});
