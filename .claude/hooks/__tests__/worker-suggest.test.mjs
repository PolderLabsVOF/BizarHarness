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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.ok(obj.hookSpecificOutput.additionalContext.indexOf('Mandatory Bizar routing policy') !== -1,
    'routing policy missing from additionalContext');
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
