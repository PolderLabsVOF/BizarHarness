#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/control-inbox.test.mjs
 *
 * Regression test: control-inbox.mjs imports its sibling CLI module via
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
const HOOK_PATH = join(__dirname, '..', 'control-inbox.mjs');

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

test('control-inbox: exits 0 and emits parseable JSON on UserPromptSubmit', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'test-session-001',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  assert.ok(stderr.indexOf('ERR_MODULE_NOT_FOUND') === -1,
    `ERR_MODULE_NOT_FOUND found in stderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj, `stdout not parseable JSON: ${stdout}`);
  assert.equal(obj.continue, true, `expected continue:true, got: ${stdout}`);
});

test('control-inbox: exits 0 and emits parseable JSON on SessionStart', () => {
  const { status, stdout, stderr } = runHook({
    session_id: 'test-session-002',
    cwd: '/tmp',
    hook_event_name: 'SessionStart',
  });
  assert.equal(status, 0, `expected exit 0, got ${status}\nstderr: ${stderr}`);
  assert.ok(stderr.indexOf('ERR_MODULE_NOT_FOUND') === -1,
    `ERR_MODULE_NOT_FOUND found in stderr: ${stderr}`);
  const obj = parseStdout(stdout);
  assert.ok(obj, `stdout not parseable JSON: ${stdout}`);
  assert.equal(obj.continue, true, `expected continue:true, got: ${stdout}`);
});

test('control-inbox: invalid JSON on stdin exits 0 with continue:true', () => {
  const r = spawnSync('node', [HOOK_PATH], {
    input: '{not valid json',
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}`);
  const obj = parseStdout(r.stdout.trim());
  assert.ok(obj, `stdout not parseable JSON: ${r.stdout}`);
  assert.equal(obj.continue, true);
});
