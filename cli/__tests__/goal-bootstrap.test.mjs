import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = new URL('../bin.mjs', import.meta.url).pathname;
const roots = [];
test.afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-goals-alias-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin', 'ok.mjs'), `const args = process.argv.slice(2); console.log(JSON.stringify({ args }));`);
  chmodSync(join(home, 'bin', 'ok.mjs'), 0o755);
  return { root, home };
}

function run(root, home, args) {
  return spawnSync(process.execPath, [bin, 'goal-bootstrap', ...args], {
    cwd: root, encoding: 'utf8', timeout: 8000,
    env: { ...process.env, BIZAR_SKIP_BUILD: '1', BIZAR_OPENKAN_HOME: home },
  });
}

test('goal-bootstrap is a documented OpenKan PRD compatibility alias', () => {
  const { root, home } = fixture();
  const result = run(root, home, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compatibility alias for OpenKan prd/);
  assert.match(result.stdout, /ok prd/);
});

test('goal-bootstrap forwards non-help arguments to OpenKan PRDs', () => {
  const { root, home } = fixture();
  const result = run(root, home, ['list']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['prd', 'list'] });
});
