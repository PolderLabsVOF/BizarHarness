import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const path = new URL('./test-in-container.sh', import.meta.url);
const source = readFileSync(path, 'utf8');

test('container verifier is valid shell and runs the current strict gates', () => {
  const syntax = spawnSync('bash', ['-n', path.pathname], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  for (const command of [
    'make check',
    'make test',
    'make e2e',
    'make check-arch',
    'make verify-repo-structure',
  ]) {
    assert.match(source, new RegExp(command.replaceAll(' ', '\\s+')));
  }
});

test('container verifier contains no deleted tests or lenient failure masking', () => {
  assert.doesNotMatch(source, /cli\/install\.test\.mjs/);
  assert.doesNotMatch(source, /continuing to next stage/i);
  assert.doesNotMatch(source, /\|\|\s*echo\s+["'].*(?:failed|warnings|non-zero)/i);
});

test('container verifier creates its isolated workspace before entering it', () => {
  assert.doesNotMatch(source, /--workdir\s+\/workspace/);

  const createWorkspace = source.indexOf('mkdir -p /workspace');
  const enterWorkspace = source.indexOf('cd /workspace');
  assert.notEqual(createWorkspace, -1);
  assert.notEqual(enterWorkspace, -1);
  assert.ok(createWorkspace < enterWorkspace);
});
