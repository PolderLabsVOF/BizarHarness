import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSandboxRequest, loadSandboxEnv, writeSandboxEnv } from './sandbox.mjs';

let work;
afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true });
  work = undefined;
});

test('sandbox request keeps untrusted code as data', () => {
  const request = buildSandboxRequest('python', 'print("x"); __import__("os")', { CUBE_TEMPLATE_ID: 'tpl-1' });
  assert.equal(request.code, 'print("x"); __import__("os")');
  assert.equal(request.template, 'tpl-1');
});

test('rejects unsupported languages and missing templates', () => {
  assert.throws(() => buildSandboxRequest('cobol', 'DISPLAY 1', { CUBE_TEMPLATE_ID: 'tpl' }), /unsupported/);
  assert.throws(() => buildSandboxRequest('python', 'print(1)', {}), /CUBE_TEMPLATE_ID/);
});

test('sandbox config round-trips without shell syntax', () => {
  work = mkdtempSync(join(tmpdir(), 'bizar-sandbox-'));
  const path = join(work, 'nested', 'cubesandbox.env');
  writeSandboxEnv({ E2B_API_URL: 'http://127.0.0.1:3000', E2B_API_KEY: 'secret', CUBE_TEMPLATE_ID: 'tpl-1' }, path);
  assert.deepEqual(loadSandboxEnv(path), {
    E2B_API_URL: 'http://127.0.0.1:3000',
    E2B_API_KEY: 'secret',
    CUBE_TEMPLATE_ID: 'tpl-1',
  });
  assert.doesNotMatch(readFileSync(path, 'utf8'), /export |eval /);
});
