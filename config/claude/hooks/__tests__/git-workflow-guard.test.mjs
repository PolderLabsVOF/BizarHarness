#!/usr/bin/env node
// Test suite for .claude/hooks/git-workflow-guard.mjs
//
// F-200 tightening: this hook is the single hard guard against
// secrets reaching git. Tests use real `git init` tmp dirs so the
// staged-diff and outbound-diff scans run against actual git plumbing.
//
// Run:  node --test .claude/hooks/__tests__/git-workflow-guard.test.mjs

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HOOK = join(__dirname, '..', 'git-workflow-guard.mjs');

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-git-guard-'));
  roots.push(root);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
  spawnSync('git', ['config', 'init.defaultBranch', 'main'], { cwd: root });
  // Seed initial commit so HEAD exists.
  writeFileSync(join(root, 'README.md'), '# test\n');
  spawnSync('git', ['add', 'README.md'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'chore: initial'], { cwd: root });
  return root;
}

function runHook(cwd, command) {
  const payload = JSON.stringify({
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
  const result = spawnSync('node', [HOOK], {
    input: payload,
    encoding: 'utf8',
    cwd,
    env: { ...process.env, BIZAR_TASK_DB: '' },
  });
  if (result.status !== 0) {
    throw new Error(`hook exited ${result.status}\nstderr: ${result.stderr}`);
  }
  const out = result.stdout.trim();
  if (!out || out === '{}') return { decision: null, reason: null };
  const parsed = JSON.parse(out);
  return {
    decision: parsed.hookSpecificOutput?.permissionDecision ?? null,
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? null,
  };
}

// ─── F-200: secret-add guard ───────────────────────────────────────

test('git add .env → deny', () => {
  const root = initRepo();
  const r = runHook(root, 'git add .env');
  assert.equal(r.decision, 'deny');
});

test('git add .env.local → deny', () => {
  const root = initRepo();
  const r = runHook(root, 'git add .env.local');
  assert.equal(r.decision, 'deny');
});

test('git add .env.production → deny', () => {
  const root = initRepo();
  const r = runHook(root, 'git add .env.production');
  assert.equal(r.decision, 'deny');
});

test('git add .envrc → deny', () => {
  const root = initRepo();
  const r = runHook(root, 'git add .envrc');
  assert.equal(r.decision, 'deny');
});

test('git add subdir/.env → deny', () => {
  const root = initRepo();
  mkdirSync(join(root, 'subdir'), { recursive: true });
  const r = runHook(root, 'git add subdir/.env');
  assert.equal(r.decision, 'deny');
});

test('git add secrets/api.key → deny', () => {
  const root = initRepo();
  mkdirSync(join(root, 'secrets'), { recursive: true });
  const r = runHook(root, 'git add secrets/api.key');
  assert.equal(r.decision, 'deny');
});

test('git add credentials/foo.json → deny', () => {
  const root = initRepo();
  mkdirSync(join(root, 'credentials'), { recursive: true });
  const r = runHook(root, 'git add credentials/foo.json');
  assert.equal(r.decision, 'deny');
});

test('git add server.pem → deny', () => {
  const root = initRepo();
  const r = runHook(root, 'git add server.pem');
  assert.equal(r.decision, 'deny');
});

test('git add path/to/server.key → deny', () => {
  const root = initRepo();
  mkdirSync(join(root, 'path', 'to'), { recursive: true });
  const r = runHook(root, 'git add path/to/server.key');
  assert.equal(r.decision, 'deny');
});

test('git add .env.example → allow (doc-style env file)', () => {
  const root = initRepo();
  // .env.example is intentionally NOT blocked — it's docs.
  // But the hook will treat this as a normal `git add` (no other
  // action matches), so it'll fall through and produce no decision.
  const r = runHook(root, 'git add .env.example');
  assert.equal(r.decision, null);
});

test('git add . (whole tree) → no secret decision (staged-diff scan handles)', () => {
  const root = initRepo();
  // `git add .` doesn't enumerate — it could pick up secrets. The hook
  // intentionally lets it through so the commit-time staged-diff scan
  // catches the secret before any push.
  const r = runHook(root, 'git add .');
  assert.equal(r.decision, null);
});

test('git add -A → no secret decision (sweep, defer to staged-diff)', () => {
  const root = initRepo();
  const r = runHook(root, 'git add -A');
  assert.equal(r.decision, null);
});

test('git add --all → no secret decision', () => {
  const root = initRepo();
  const r = runHook(root, 'git add --all');
  assert.equal(r.decision, null);
});

// ─── F-200: commit-time secret guard ───────────────────────────────

test('git commit with secret in staged content → deny', () => {
  const root = initRepo();
  writeFileSync(join(root, 'config.ts'), 'export const API_KEY = "AKIAIOSFODNN7EXAMPLE";\n');
  spawnSync('git', ['add', 'config.ts'], { cwd: root });
  const r = runHook(root, 'git commit -m "feat: add config"');
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /secret/i);
});

test('git commit with normal staged file → ask (existing behaviour)', () => {
  const root = initRepo();
  writeFileSync(join(root, 'index.ts'), 'export const x = 1;\n');
  spawnSync('git', ['add', 'index.ts'], { cwd: root });
  const r = runHook(root, 'git commit -m "feat: add index"');
  assert.equal(r.decision, 'ask');
});

test('git commit with PRIVATE KEY block in staged content → deny', () => {
  const root = initRepo();
  writeFileSync(
    join(root, 'creds.pem'),
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
  );
  spawnSync('git', ['add', 'creds.pem'], { cwd: root });
  const r = runHook(root, 'git commit -m "feat: add creds"');
  assert.equal(r.decision, 'deny');
});

test('git commit with GitHub PAT (ghp_*) in staged content → deny', () => {
  const root = initRepo();
  writeFileSync(join(root, 'token.txt'), 'ghp_1234567890abcdefghijklmnopqrstuvwxyzAB\n');
  spawnSync('git', ['add', 'token.txt'], { cwd: root });
  const r = runHook(root, 'git commit -m "feat: token"');
  assert.equal(r.decision, 'deny');
});

test('git commit with AWS access key (AKIA*) in staged content → deny', () => {
  const root = initRepo();
  writeFileSync(join(root, 'aws.txt'), 'AKIAIOSFODNN7EXAMPLE\n');
  spawnSync('git', ['add', 'aws.txt'], { cwd: root });
  const r = runHook(root, 'git commit -m "chore: aws config"');
  assert.equal(r.decision, 'deny');
});

test('git commit with skeleton secret wording without match → ask', () => {
  const root = initRepo();
  writeFileSync(join(root, 'README.md'), 'This file mentions API_KEY but no value follows.\n');
  spawnSync('git', ['add', 'README.md'], { cwd: root });
  const r = runHook(root, 'git commit -m "docs: update readme"');
  // "api_key=..." needs a 16+ char value. Plain prose → not a match → ask.
  assert.equal(r.decision, 'ask');
});

// ─── F-200: pre-push outbound secret scan ─────────────────────────

test('git push with secret commit in outbound → deny', () => {
  const root = initRepo();
  const bare = mkdtempSync(join(tmpdir(), 'bizar-bare-'));
  spawnSync('git', ['init', '-q', '--bare', bare]);
  spawnSync('git', ['remote', 'add', 'origin', bare], { cwd: root });
  spawnSync('git', ['push', '-q', 'origin', 'main:main'], { cwd: root });
  spawnSync('git', ['branch', '--set-upstream-to=origin/main', 'main'], { cwd: root });
  // Now add a new commit with a secret in the file content.
  writeFileSync(join(root, 'config.ts'), 'export const API_KEY = "AKIAIOSFODNN7EXAMPLEKEY1234";\n');
  spawnSync('git', ['add', 'config.ts'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'feat: add config'], { cwd: root });
  // Roll the remote-tracking ref back so the new commit is outbound.
  spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main~1'], { cwd: root });
  const r = runHook(root, 'git push origin main');
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /secret/i);
  rmSync(bare, { recursive: true, force: true });
});

test('git push of normal commits with upstream → ask', () => {
  const root = initRepo();
  const bare = mkdtempSync(join(tmpdir(), 'bizar-bare-'));
  spawnSync('git', ['init', '-q', '--bare', bare]);
  spawnSync('git', ['remote', 'add', 'origin', bare], { cwd: root });
  writeFileSync(join(root, 'src.ts'), 'export const x = 1;\n');
  spawnSync('git', ['add', 'src.ts'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'feat: add src'], { cwd: root });
  spawnSync('git', ['push', '-q', 'origin', 'main:main'], { cwd: root });
  spawnSync('git', ['branch', '--set-upstream-to=origin/main', 'main'], { cwd: root });
  spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main~1'], { cwd: root });
  const r = runHook(root, 'git push origin main');
  assert.equal(r.decision, 'ask');
  rmSync(bare, { recursive: true, force: true });
});

test('git push --force origin main → deny (history rewriting)', () => {
  const root = initRepo();
  const r = runHook(root, 'git push --force origin main');
  assert.equal(r.decision, 'deny');
});

test('git rebase main → deny (history rewriting)', () => {
  const root = initRepo();
  const r = runHook(root, 'git rebase main');
  assert.equal(r.decision, 'deny');
});

test('git reset --hard → silent pass (handled by pretooluse-bash.mjs)', () => {
  const root = initRepo();
  // git-workflow-guard does not enforce `git reset --hard` — that is
  // covered by the dangerous-pattern scanner in pretooluse-bash.mjs.
  // This hook returns no decision for it (the bash hook fires first
  // in the chain and returns `ask`).
  const r = runHook(root, 'git reset --hard');
  assert.equal(r.decision, null);
});

// ─── Existing behaviour preserved ──────────────────────────────────

test('git status → no decision (silent pass)', () => {
  const root = initRepo();
  const r = runHook(root, 'git status');
  assert.equal(r.decision, null);
});

test('git log → no decision (silent pass)', () => {
  const root = initRepo();
  const r = runHook(root, 'git log --oneline -5');
  assert.equal(r.decision, null);
});

test('gh pr create → ask', () => {
  const root = initRepo();
  const r = runHook(root, 'gh pr create --title "feat: foo"');
  assert.equal(r.decision, 'ask');
});

test('gh pr merge → ask', () => {
  const root = initRepo();
  const r = runHook(root, 'gh pr merge 123');
  assert.equal(r.decision, 'ask');
});

test('npm publish → ask', () => {
  const root = initRepo();
  const r = runHook(root, 'npm publish --dry-run');
  assert.equal(r.decision, 'ask');
});