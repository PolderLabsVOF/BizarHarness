import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestGateArgs } from '../commands/util.mjs';

test('npm test arguments receive exactly one npm forwarding separator', () => {
  const suite = { command: 'npm', baseArgs: ['test'] };
  assert.deepEqual(buildTestGateArgs(suite, ['--runInBand']), ['test', '--', '--runInBand']);
  assert.deepEqual(buildTestGateArgs(suite, ['--', '--runInBand']), ['test', '--', '--runInBand']);
  assert.deepEqual(buildTestGateArgs(suite, []), ['test']);
});

test('non-npm test runners receive arguments directly', () => {
  assert.deepEqual(buildTestGateArgs({ command: 'pytest', baseArgs: [] }, ['--', '-q']), ['-q']);
  assert.deepEqual(buildTestGateArgs({ command: 'cargo', baseArgs: ['test'] }, ['filter']), ['test', 'filter']);
});
