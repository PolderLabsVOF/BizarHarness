import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLearningContext, listLearning, learningPaths, remember } from '../commands/learn.mjs';
import { initializeProjectLearningStore } from '../init.mjs';

test('global preferences cross cwd while project lessons stay local and bounded', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-learn-'));
  try {
    const env = { BIZAR_HOME: join(root, 'global') };
    const a = join(root, 'a'); const b = join(root, 'b');
    remember({ scope: 'user', key: 'output.style', value: 'Use concise scannable sections.', cwd: a, env });
    remember({ scope: 'project', key: 'debug.cache', value: 'Clear fixture cache before retrying tests.', cwd: a, env });
    assert.equal(listLearning({ cwd: b, env }).user.length, 1);
    assert.equal(listLearning({ cwd: b, env }).project.length, 0);
    assert.equal(listLearning({ cwd: a, env }).project.length, 1);
    assert.ok(buildLearningContext({ cwd: a, env }).length <= 1200);
    assert.equal(statSync(join(root, 'global', 'learning')).mode & 0o777, 0o700);
    assert.equal(statSync(learningPaths({ cwd: a, env }).user).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('learning rejects secret-like and oversized values', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-learn-private-'));
  try {
    const env = { BIZAR_HOME: join(root, 'global') };
    assert.throws(() => remember({ scope: 'user', key: 'api_token', value: 'abc', cwd: root, env }), /sensitive/);
    assert.throws(() => remember({ scope: 'user', key: 'editor', value: 'token=secret-value', cwd: root, env }), /credentials/);
    assert.throws(() => remember({ scope: 'project', key: 'long', value: 'x'.repeat(241), cwd: root, env }), /1-240/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bizar init creates the canonical project learning schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-init-learning-'));
  try {
    const result = initializeProjectLearningStore(join(root, '.bizar'));
    assert.equal(result.created, true);
    const store = JSON.parse(readFileSync(result.path, 'utf8'));
    assert.deepEqual(store, { schema: 'bizar.learning.v1', scope: 'project', items: [], updatedAt: null });
    assert.deepEqual(listLearning({ cwd: root, env: { BIZAR_HOME: join(root, 'global') } }).project, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
