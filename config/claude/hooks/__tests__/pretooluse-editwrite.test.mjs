#!/usr/bin/env node
// Test suite for .claude/hooks/pretooluse-editwrite.mjs
//
// Invokes the hook with a synthetic Claude Code PreToolUse payload over
// stdin, captures stdout, and asserts on `permissionDecision`.
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
  if (!out || out === '{}') return { decision: null, context: null };
  const parsed = JSON.parse(out);
  return {
    decision: parsed.hookSpecificOutput?.permissionDecision ?? null,
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? null,
    context: parsed.hookSpecificOutput?.additionalContext ?? null,
  };
}

test('Write .env → deny', () => {
  const r = runHook('Write', '/repo/.env');
  assert.equal(r.decision, 'deny');
});

test('Write .env.local → deny', () => {
  const r = runHook('Write', '/repo/.env.local');
  assert.equal(r.decision, 'deny');
});

test('Write .env.production → deny', () => {
  const r = runHook('Write', '/repo/.env.production');
  assert.equal(r.decision, 'deny');
});

test('Write .envrc → deny', () => {
  const r = runHook('Write', '/repo/.envrc');
  assert.equal(r.decision, 'deny');
});

test('Write .env.example → allow (docs)', () => {
  const r = runHook('Write', '/repo/research/gstack/.env.example');
  assert.notEqual(r.decision, 'deny');
  // F-145: hook no longer emits an additionalContext note for the
  // common path. Confirm it stays silent on legitimate writes.
  assert.equal(r.context, null);
});

test('Write .env.sample → allow (docs)', () => {
  const r = runHook('Write', '/repo/templates/.env.sample');
  assert.notEqual(r.decision, 'deny');
});

test('Write .env.template → allow (docs)', () => {
  const r = runHook('Write', '/repo/templates/deploy/docker/.env.template');
  assert.notEqual(r.decision, 'deny');
});

test('Write secrets/api.json → deny', () => {
  const r = runHook('Write', '/repo/secrets/api.json');
  assert.equal(r.decision, 'deny');
});

test('Write credentials/x.json → deny', () => {
  const r = runHook('Write', '/repo/credentials/x.json');
  assert.equal(r.decision, 'deny');
});

test('Write node_modules/x.js → deny', () => {
  const r = runHook('Write', '/repo/node_modules/x.js');
  assert.equal(r.decision, 'deny');
});

test('Write bun.lock → allow (package-manager output)', () => {
  const r = runHook('Write', '/repo/bun.lock');
  assert.notEqual(r.decision, 'deny');
});

test('Write bun.lockb → allow (binary lock variant)', () => {
  const r = runHook('Write', '/repo/bun.lockb');
  assert.notEqual(r.decision, 'deny');
});

test('Write package-lock.json → allow (package-manager output)', () => {
  const r = runHook('Write', '/repo/package-lock.json');
  assert.notEqual(r.decision, 'deny');
});

test('Write yarn.lock → allow', () => {
  const r = runHook('Write', '/repo/yarn.lock');
  assert.notEqual(r.decision, 'deny');
});

test('Write pnpm-lock.yaml → allow', () => {
  const r = runHook('Write', '/repo/pnpm-lock.yaml');
  assert.notEqual(r.decision, 'deny');
});

test('Write src/index.ts → allow + neutral context', () => {
  const r = runHook('Write', '/repo/src/index.ts');
  assert.notEqual(r.decision, 'deny');
  // F-145: the always-on context line was noise. Hook stays silent
  // on legitimate writes.
  assert.equal(r.context, null);
});

test('Edit .env → deny (same rule applies to Edit)', () => {
  const r = runHook('Edit', '/repo/.env');
  assert.equal(r.decision, 'deny');
});

test('MultiEdit .env.example → allow (docs)', () => {
  const r = runHook('MultiEdit', '/repo/.env.example');
  assert.notEqual(r.decision, 'deny');
});

test('Unknown tool → no decision (silent pass)', () => {
  const r = runHook('Bash', '/repo/.env');
  // PreToolUse:Bash is handled by a separate hook — this one is a no-op.
  assert.equal(r.decision, null);
});
