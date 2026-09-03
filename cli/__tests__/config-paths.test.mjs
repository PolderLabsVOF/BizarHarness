import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveBizarHome, resolveGlobalModelRouter } from '../config-paths.mjs';

test('model router lives under CLAUDE_CONFIG_DIR, not BIZAR_HOME', () => {
  assert.equal(
    resolveGlobalModelRouter({ cwd: '/tmp/project-b', env: { BIZAR_HOME: '/tmp/shared', HOME: '/home/user' } }),
    '/home/user/.claude/model-router.json',
  );
  assert.equal(
    resolveGlobalModelRouter({ cwd: '/tmp/project-b', env: { CLAUDE_CONFIG_DIR: '/custom/claude', HOME: '/home/user' } }),
    '/custom/claude/model-router.json',
  );
});

test('XDG and HOME fallbacks never use the project directory', () => {
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { XDG_CONFIG_HOME: '/tmp/xdg' } }), '/tmp/xdg/bizar');
  assert.equal(resolveBizarHome({ cwd: '/tmp/project', env: { HOME: '/tmp/home' } }), '/tmp/home/.config/bizar');
});
