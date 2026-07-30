import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { createBackup, restoreBackup } from '../core/backup-store.mjs';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

test('backup retains project state without removed subsystem payloads', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bizar-backup-'));
  roots.push(fixture);
  const project = join(fixture, 'project');
  const outDir = join(fixture, 'backups');
  mkdirSync(join(project, '.bizar'), { recursive: true });
  writeFileSync(join(project, '.bizar', 'state.json'), '{"status":"active"}');

  const result = await createBackup({ outDir, projectRoot: project, label: 'core' });
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(result.path, 'project-state', 'state.json')), true);
  const labels = result.manifest.paths.map((item) => item.label);
  assert.equal(labels.includes('project-state'), true);
  assert.equal(labels.every((label) => ['config', 'project-state'].includes(label)), true);
  assert.doesNotMatch(JSON.stringify(result.manifest), /dashboard|memory|lightrag|obsidian/i);

  writeFileSync(join(project, '.bizar', 'state.json'), '{"status":"changed"}');
  const restored = await restoreBackup({
    backupPath: result.path,
    projectRoot: project,
    conflictStrategy: 'overwrite',
  });
  assert.equal(restored.ok, true);
  assert.equal(readFileSync(join(project, '.bizar', 'state.json'), 'utf8'), '{"status":"active"}');
});
