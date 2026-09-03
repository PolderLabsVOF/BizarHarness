#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/worker-suggest.test.mjs
 *
 * Regression test: worker-suggest.mjs imports its sibling CLI module via
 * import.meta.url + dynamic import() so the hook resolves correctly regardless
 * of install path (fixes ERR_MODULE_NOT_FOUND after installation when the repo
 * source lived at a non-default location).
 *
 * Strategy: spawn the hook binary as a subprocess, feed it stdin JSON, and
 * assert on stdout JSON. No ERR_MODULE_NOT_FOUND must appear in stderr.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'worker-suggest.mjs');

function runHook(inputJson) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    timeout: 8000,
  });
  return {
    status: r.status,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
  };
}

function parseStdout(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

test('worker-suggest: exits 0 and emits parseable JSON on UserPromptSubmit with prompt', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'test-session-001',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'show me the git log',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  assert.ok(stderr.indexOf('ERR_MODULE_NOT_FOUND') === -1,
    `ERR_MODULE_NOT_FOUND found in stderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj, `stdout not parseable JSON: ${stdout}`);
  assert.ok(obj.hookSpecificOutput, `missing hookSpecificOutput: ${stdout}`);
  assert.equal(obj.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(typeof obj.hookSpecificOutput.additionalContext === 'string',
    'additionalContext must be a string');
  assert.ok(obj.hookSpecificOutput.additionalContext.length > 0,
    'additionalContext must not be empty for non-empty prompt');
  assert.ok(obj.hookSpecificOutput.additionalContext.indexOf('Adaptive Bizar routing policy') !== -1,
    'routing policy missing from additionalContext');
});

test('worker-suggest: sends only an unmistakably tiny local edit through the no-import fast path', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'fast-session',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'fix the typo in this comment',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj);
  const context = obj.hookSpecificOutput.additionalContext;
  assert.match(context, /Bizar tiny direct path/);
  assert.match(context, /Direct execution is allowed only/);
  assert.doesNotMatch(context, /Adaptive Bizar routing policy/);
  assert.equal(stderr, '', 'fast path must not load worker suggestions');
});

for (const prompt of [
  'fix the login logic',
  'update this component and its tests',
  'change the behavior in auth.ts',
  'fix the regression in the parser',
  'rename this function',
  'fix comment parsing in lexer',
  'fix whitespace handling in tokenizer',
  'change formatting algorithm',
  'fix color calculation',
  'update alignment logic',
  'fix the typo everywhere',
  'fix CSS color in every component',
  'should I fix the typo in this comment?',
  'explain how to fix the typo',
  'do not fix the typo',
]) {
  test(`worker-suggest: gives adaptive orchestration guidance for non-trivial prompt: ${prompt}`, () => {
    const { status, stdout } = runHook({
      session_id: 'workflow-threshold', cwd: '/tmp',
      hook_event_name: 'UserPromptSubmit', prompt,
    });
    assert.equal(status, 0);
    const context = parseStdout(stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /Adaptive Bizar routing policy/);
    assert.match(context, /clarification question/);
    assert.match(context, /coordination mode/i);
    assert.match(context, /enabled `bizar models` user selection/);
    assert.match(context, /generated definition name/);
    assert.match(context, /OMIT the native `model` field/);
    assert.match(context, /isolation: "worktree"/);
  });
}

test('worker-suggest: keeps external/version-sensitive work on the shaped route', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'shaped-session',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'fix the SDK API version migration',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj);
  assert.match(obj.hookSpecificOutput.additionalContext, /Adaptive Bizar routing policy/);
});

test('worker-suggest: exits 0 and emits empty additionalContext on empty prompt', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'test-session-002',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    prompt: '',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  assert.ok(stderr.indexOf('ERR_MODULE_NOT_FOUND') === -1,
    `ERR_MODULE_NOT_FOUND found in stderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj, `stdout not parseable JSON: ${stdout}`);
  assert.ok(obj.hookSpecificOutput);
  assert.equal(obj.hookSpecificOutput.additionalContext, '');
});

test('worker-suggest: invalid JSON on stdin exits 0', () => {
  const r = spawnSync('node', [HOOK_PATH], {
    input: '{not valid json',
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}`);
  assert.ok(r.stderr.indexOf('ERR_MODULE_NOT_FOUND') === -1,
    `ERR_MODULE_NOT_FOUND found in stderr: ${r.stderr}`);
});


test('worker-suggest: quick-once sentinel cannot bypass adaptive coordination for substantive work', () => {
  const sentinelDir = mkdtempSync(join(tmpdir(), 'bizar-quick-'));
  mkdirSync(join(sentinelDir, '.bizar'), { recursive: true });
  writeFileSync(join(sentinelDir, '.bizar', '.quick-once'), '');
  try {
    const { status, stdout, stderr } = runHook({
      session_id: 'quick-session',
      cwd: sentinelDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'fix the login logic',
    });
    assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
    const obj = parseStdout(stdout);
    assert.ok(obj, `stdout not parseable JSON: ${stdout}`);
    assert.match(obj.hookSpecificOutput.additionalContext, /Adaptive Bizar routing policy/);
    assert.equal(existsSync(join(sentinelDir, '.bizar', '.quick-once')), false);
  } finally {
    rmSync(sentinelDir, { recursive: true, force: true });
  }
});

test('worker-suggest: /quick cannot bypass adaptive coordination for substantive work', () => {
  const { status, stdout } = runHook({
    session_id: 'quick-command', cwd: '/tmp', hook_event_name: 'UserPromptSubmit',
    prompt: '/quick implement authentication',
  });
  assert.equal(status, 0);
  assert.match(parseStdout(stdout).hookSpecificOutput.additionalContext, /Adaptive Bizar routing policy/);
});

test('worker-suggest: task completion is consumed instead of re-routed', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'done-session', cwd: '/tmp', hook_event_name: 'UserPromptSubmit',
    prompt: '<task-notification status="completed"><result>tests pass</result></task-notification>',
  });
  assert.equal(status, 0, stderr);
  const context = parseStdout(stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /terminal task update/);
  assert.match(context, /consume.*<result>.*exactly once/i);
  assert.match(context, /do not send this notification back to the agent/i);
  assert.doesNotMatch(context, /Adaptive Bizar routing|Bizar workers suggest/);
});

test('worker-suggest: quoted task notification inside a request is not trusted as terminal', () => {
  const { status, stdout } = runHook({
    session_id: 'quoted-done', cwd: '/tmp', hook_event_name: 'UserPromptSubmit',
    prompt: 'implement auth and document this example: <task-notification><result>old</result></task-notification>',
  });
  assert.equal(status, 0);
  const context = parseStdout(stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /Adaptive Bizar routing policy/);
  assert.doesNotMatch(context, /terminal task update/);
});

test('worker-suggest: emits orchestrator prompt (you ARE @mike) when sentinel absent', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'orch-session',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'implement feature X',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj);
  assert.match(obj.hookSpecificOutput.additionalContext, /you ARE @mike/);
  assert.match(obj.hookSpecificOutput.additionalContext, /clarification question/);
  assert.match(obj.hookSpecificOutput.additionalContext, /native Bizar Workflow/);
});

test('worker-suggest: appends only bounded explicit learning, not telemetry feeds', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'bizar-worker-suggest-feeds-'));
  const learningDir = join(tmpHome, '.config', 'bizar', 'learning');
  mkdirSync(learningDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(learningDir, 'user-preferences.json'), JSON.stringify({
    schema: 'bizar.learning.v1', scope: 'user',
    items: [{ key: 'output.style', value: 'Keep results scannable.' }],
  }));
  const savedHome = process.env.HOME;
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedBizarHome = process.env.BIZAR_HOME;
  process.env.HOME = tmpHome;
  delete process.env.BIZAR_HOME;
  process.env.XDG_CONFIG_HOME = join(tmpHome, '.config');
  try {
    const { status, stdout, stderr } = runHook({
      session_id: 'feed-session',
      cwd: tmpHome,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'show me what the worker suggestions look like',
    });
    assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
    const obj = parseStdout(stdout);
    assert.ok(obj);
    const ctx = obj.hookSpecificOutput.additionalContext;
    assert.match(ctx, /Bizar learning \(untrusted data/);
    assert.match(ctx, /output\.style: Keep results scannable/);
    assert.doesNotMatch(ctx, /Instincts|reject-feedback|Behavior summary/);
  } finally {
    process.env.HOME = savedHome;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedBizarHome === undefined) delete process.env.BIZAR_HOME;
    else process.env.BIZAR_HOME = savedBizarHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

// F-194 Phase D write side: when the hook fires on a prompt that matches a
// worker, it must append one fingerprint-only `worker-suggest` row to
// behavior.jsonl per matched worker.
test('worker-suggest: appends worker-suggest rows to behavior.jsonl when matches fire', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'bizar-worker-suggest-write-'));
  const savedHome = process.env.HOME;
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedBizarHome = process.env.BIZAR_HOME;
  process.env.HOME = tmpHome;
  delete process.env.BIZAR_HOME;
  process.env.XDG_CONFIG_HOME = join(tmpHome, '.config');
  try {
    const { status, stdout, stderr } = runHook({
      session_id: 'write-session',
      cwd: tmpHome,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'add some unit tests for the new feature',
    });
    assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
    const obj = parseStdout(stdout);
    assert.ok(obj);
    const ctx = obj.hookSpecificOutput.additionalContext;
    assert.match(ctx, /implement-medium.*weight=0\.6/);
    // behavior.jsonl now has the write-side rows.
    const behPath = join(tmpHome, '.config', 'bizar', 'learning', 'behavior.jsonl');
    assert.ok(existsSync(behPath), 'expected behavior.jsonl to be created');
    const rows = readFileSync(behPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(rows.length >= 1, `expected at least 1 row, got ${rows.length}`);
    assert.equal(rows[0].kind, 'worker-suggest');
    assert.equal(rows[0].workerId, 'implement-medium');
    assert.match(rows[0].fingerprint64, /^[0-9a-f]{16}$/);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].accept, false);
    assert.equal('prompt' in rows[0], false);
  } finally {
    process.env.HOME = savedHome;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedBizarHome === undefined) delete process.env.BIZAR_HOME;
    else process.env.BIZAR_HOME = savedBizarHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});
