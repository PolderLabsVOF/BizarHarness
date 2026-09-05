import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = resolve(import.meta.dirname, '..', 'bin.mjs');
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-task-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin', 'ok.mjs'), `#!/usr/bin/env node\nconst args=process.argv.slice(2); console.log(JSON.stringify({args}));\n`);
  chmodSync(join(home, 'bin', 'ok.mjs'), 0o755);
  return { root, home };
}
function run(args, cwd, home) {
  return spawnSync(process.execPath, [BIN, 'task', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, BIZAR_SKIP_BUILD: '1', BIZAR_OPENKAN_HOME: home },
  });
}

test('task CLI forwards the complete task lifecycle to OpenKan', () => {
  const { root, home } = fixture();
  const result = run(['claim', 'tsk-123', '--owner', 'todd', '--lease-ms', '60000', '--json'], root, home);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, ['task', 'claim', 'tsk-123', '--owner', 'todd', '--lease-ms', '60000', '--json']);
});

test('task CLI exposes OpenKan lifecycle help and does not advertise SQLite integration queues', () => {
  const { root, home } = fixture();
  const result = run(['--help'], root, home);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /OpenKan-backed task lifecycle/);
  assert.doesNotMatch(result.stdout, /integration queue/i);
});
