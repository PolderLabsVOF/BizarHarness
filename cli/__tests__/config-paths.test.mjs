import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBizarHome } from '../config-paths.mjs';

test('XDG and HOME fallbacks never use the project directory', () => {
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { XDG_CONFIG_HOME: '/tmp/xdg' } }), '/tmp/xdg/bizar');
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { HOME: '/tmp/home' } }), '/tmp/home/.config/bizar');
});

test('config-paths does not export resolveGlobalModelRouter (picker removed)', async () => {
  const exports = Object.keys(await import('../config-paths.mjs'));
  assert.equal(exports.includes('resolveGlobalModelRouter'), false,
    'cli/config-paths.mjs must not export resolveGlobalModelRouter; the picker is gone');
});
