import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('.claude-plugin/plugin.json stays deleted (commit cf09bf6)', () => {
  assert.equal(
    existsSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json')),
    false,
    '.claude-plugin/plugin.json was deliberately dropped in cf09bf6 — it must not be re-introduced',
  );
});

test('verify-repo-structure.mjs no longer references .claude-plugin/plugin.json', () => {
  const scriptPath = join(REPO_ROOT, 'scripts', 'verify-repo-structure.mjs');
  const source = readFileSync(scriptPath, 'utf8');
  assert.equal(
    source.includes('.claude-plugin/plugin.json'),
    false,
    'verify-repo-structure.mjs still references the deleted manifest',
  );
  assert.equal(
    source.includes("'.claude-plugin'"),
    false,
    'verify-repo-structure.mjs still allows the .claude-plugin package root',
  );
});

test('verify-repo-structure.test.mjs no longer references .claude-plugin/plugin.json', () => {
  const testPath = join(REPO_ROOT, 'scripts', 'verify-repo-structure.test.mjs');
  const source = readFileSync(testPath, 'utf8');
  assert.equal(
    source.includes('.claude-plugin/plugin.json'),
    false,
    'verify-repo-structure.test.mjs still references the deleted manifest',
  );
});

test('workflow-plugin-surfaces.test.mjs no longer references .claude-plugin/plugin.json', () => {
  const testPath = join(REPO_ROOT, 'scripts', 'workflow-plugin-surfaces.test.mjs');
  const source = readFileSync(testPath, 'utf8');
  assert.equal(
    source.includes('.claude-plugin/plugin.json'),
    false,
    'workflow-plugin-surfaces.test.mjs still references the deleted manifest',
  );
});

test('package.json no longer ships .claude-plugin/plugin.json', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  assert.equal(
    files.includes('.claude-plugin/plugin.json'),
    false,
    'package.json "files" array still ships the deleted manifest',
  );
});

test('simplify-guard.mjs no longer treats .claude-plugin/plugin.json as a trivial path', () => {
  const hookPath = join(
    REPO_ROOT,
    'config',
    'claude',
    'hooks',
    'simplify-guard.mjs',
  );
  const source = readFileSync(hookPath, 'utf8');
  assert.equal(
    source.includes('.claude-plugin/plugin.json'),
    false,
    'simplify-guard.mjs still treats the deleted manifest as a trivial diff path',
  );
});
