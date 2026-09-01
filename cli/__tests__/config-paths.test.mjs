import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveBizarHome, resolveGlobalModelRouter } from '../config-paths.mjs';

test('BIZAR_HOME is global and relative values resolve once against cwd', () => {
  assert.equal(
    resolveBizarHome({ cwd: '/tmp/project-a', env: { BIZAR_HOME: '../shared' } }),
    '/tmp/shared',
  );
  assert.equal(
    resolveGlobalModelRouter({ cwd: '/tmp/project-b', env: { BIZAR_HOME: '/tmp/shared' } }),
    join('/tmp/shared', 'config', 'claude', 'model-router.json'),
  );
});

test('XDG and HOME fallbacks never use the project directory', () => {
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { XDG_CONFIG_HOME: '/tmp/xdg' } }), '/tmp/xdg/bizar');
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { HOME: '/tmp/home' } }), '/tmp/home/.config/bizar');
});
