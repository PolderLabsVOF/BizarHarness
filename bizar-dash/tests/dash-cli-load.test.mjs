/**
 * tests/dash-cli-load.test.mjs
 *
 * Regression test for the "is not iterable" bug in loadDashCli (v4.2.4).
 * The async IIFE was being spread into an array literal before resolving,
 * producing: TypeError: (intermediate value) is not iterable.
 *
 * Run with:
 *   node --test tests/dash-cli-load.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../../cli/bin.mjs');

test('bizar dash status does not throw "is not iterable" (regression for v4.2.4)', () => {
  const result = spawnSync('node', [CLI, 'dash', 'status'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const combined = (result.stdout || '') + (result.stderr || '');
  assert.ok(
    !combined.includes('is not iterable'),
    `Expected no "is not iterable" error, got: ${combined.slice(0, 300)}`,
  );
});

test('bizar dash status exits cleanly (0) or with a non-iterable error', () => {
  const result = spawnSync('node', [CLI, 'dash', 'status'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  // Exit code 0 = dashboard status resolved successfully.
  // Non-zero = dashboard not running (acceptable), but must not be the
  // "is not iterable" TypeError from the broken spread operator.
  const acceptableExit = result.status === 0 || result.status === 1;
  const noIterableError = !((result.stdout || '') + (result.stderr || '')).includes('is not iterable');
  assert.ok(acceptableExit && noIterableError,
    `Unexpected result: exit=${result.status}, output=${((result.stdout || '') + (result.stderr || '')).slice(0, 200)}`);
});
