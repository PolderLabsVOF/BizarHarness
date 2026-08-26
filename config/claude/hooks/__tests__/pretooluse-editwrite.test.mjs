#!/usr/bin/env node
// Test suite for .claude/hooks/pretooluse-editwrite.mjs
//
// Invokes the hook with a synthetic Claude Code PreToolUse payload over
// stdin, captures stdout, and asserts on `permissionDecision`.
//
// F-176 (full permissions + advisory hooks):
//   Every input returns `permissionDecision: "allow"`. Writes to
//   package-manager output (`node_modules/`) inject a `[advisory]`
//   reminder via `additionalContext`. Doc-style env templates and
//   lockfiles stay silent.
//
// Run:  node --test .claude/hooks/__tests__/pretooluse-editwrite.test.mjs

'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '..', 'pretooluse-editwrite.mjs');

function runHook(toolName, filePath) {
  const payload = JSON.stringify({
    session_id: 'test-session',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolName === 'Write'
      ? { file_path: filePath, content: '' }
      : toolName === 'Edit'
        ? { file_path: filePath, new_string: '' }
        : { file_path: filePath, edits: [] },
  });
  const result = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`hook exited ${result.status}\nstderr: ${result.stderr}`);
  }
  const out = result.stdout.trim();
  if (!out || out === '{}') return { decision: null, reason: null, context: null };
  const parsed = JSON.parse(out);
  return {
    decision: parsed.hookSpecificOutput?.permissionDecision ?? null,
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? null,
    context: parsed.hookSpecificOutput?.additionalContext ?? null,
  };
}

function assertAdvisoryAllow(r) {
  assert.equal(r.decision, 'allow', `expected allow, got ${r.decision}`);
  assert.ok(r.context, 'expected additionalContext to be set');
  assert.match(r.context, /Heads up/, 'advisory context should start with Heads up');
}

// F-200 + F-176: the .env / .envrc / secrets / credentials block-list
// was removed. Agents can read/edit these locally — only pushing them
// to git triggers the secret-pattern guard (see git-workflow-guard.mjs).
// The hook now only injects an advisory for project-managed dependency
// dirs (`node_modules/`).

test('Write /tmp/foo → no decision (outside-project paths are wide open)', () => {
  const r = runHook('Write', '/tmp/scratch/foo.txt');
  assert.equal(r.decision, null);
});

test('Write /repo/.env → no decision (F-200 — local edits allowed)', () => {
  const r = runHook('Write', '/repo/.env');
  assert.equal(r.decision, null);
});

test('Write /repo/.env.local → no decision (F-200)', () => {
  const r = runHook('Write', '/repo/.env.local');
  assert.equal(r.decision, null);
});

test('Write /repo/.env.production → no decision (F-200)', () => {
  const r = runHook('Write', '/repo/.env.production');
  assert.equal(r.decision, null);
});

test('Write /repo/.envrc → no decision (F-200)', () => {
  const r = runHook('Write', '/repo/.envrc');
  assert.equal(r.decision, null);
});

test('Write /repo/secrets/api.key → no decision (F-200 — local edit OK)', () => {
  const r = runHook('Write', '/repo/secrets/api.key');
  assert.equal(r.decision, null);
});

test('Write /repo/credentials/x.json → no decision (F-200)', () => {
  const r = runHook('Write', '/repo/credentials/x.json');
  assert.equal(r.decision, null);
});

test('Write .env.example → no decision (docs)', () => {
  const r = runHook('Write', '/repo/research/gstack/.env.example');
  assert.equal(r.decision, null);
});

test('Write .env.sample → no decision (docs)', () => {
  const r = runHook('Write', '/repo/templates/.env.sample');
  assert.equal(r.decision, null);
});

test('Write .env.template → no decision (docs)', () => {
  const r = runHook('Write', '/repo/templates/deploy/docker/.env.template');
  assert.equal(r.decision, null);
});

test('Write node_modules/x.js → allow + warn advisory', () => {
  const r = runHook('Write', '/repo/node_modules/x.js');
  assertAdvisoryAllow(r);
  assert.match(r.context, /package-manager/);
});

test('Write deep node_modules path → allow + warn advisory', () => {
  const r = runHook('Write', '/repo/node_modules/@scope/pkg/dist/index.js');
  assertAdvisoryAllow(r);
  assert.match(r.context, /package-manager/);
});

test('Write bun.lock → no decision (package-manager output)', () => {
  const r = runHook('Write', '/repo/bun.lock');
  assert.equal(r.decision, null);
});

test('Write bun.lockb → no decision (binary lock variant)', () => {
  const r = runHook('Write', '/repo/bun.lockb');
  assert.equal(r.decision, null);
});

test('Write package-lock.json → no decision (package-manager output)', () => {
  const r = runHook('Write', '/repo/package-lock.json');
  assert.equal(r.decision, null);
});

test('Write yarn.lock → no decision', () => {
  const r = runHook('Write', '/repo/yarn.lock');
  assert.equal(r.decision, null);
});

test('Write pnpm-lock.yaml → no decision', () => {
  const r = runHook('Write', '/repo/pnpm-lock.yaml');
  assert.equal(r.decision, null);
});

test('Write src/index.ts → no decision + neutral context', () => {
  const r = runHook('Write', '/repo/src/index.ts');
  assert.equal(r.decision, null);
  // F-145: the always-on context line was noise. Hook stays silent
  // on legitimate writes.
  assert.equal(r.context, null);
});

test('Edit .env → no decision (F-200 — Edit same as Write)', () => {
  const r = runHook('Edit', '/repo/.env');
  assert.equal(r.decision, null);
});

test('MultiEdit .env.example → no decision (docs)', () => {
  const r = runHook('MultiEdit', '/repo/.env.example');
  assert.equal(r.decision, null);
});

test('Unknown tool → no decision (silent pass)', () => {
  const r = runHook('Bash', '/repo/.env');
  // PreToolUse:Bash is handled by a separate hook — this one is a no-op.
  assert.equal(r.decision, null);
});