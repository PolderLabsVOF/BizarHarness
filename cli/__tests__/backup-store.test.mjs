import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { createBackup, deleteBackup, restoreBackup, verifyBackup } from '../core/backup-store.mjs';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

test('backup labels and deletion cannot escape the configured backup root', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bizar-backup-safety-'));
  roots.push(fixture);
  const outDir = join(fixture, 'backups');
  await assert.rejects(createBackup({ outDir, label: '../escape' }), /Backup label/);
  const victim = join(fixture, 'victim');
  mkdirSync(victim, { recursive: true });
  const result = await deleteBackup({ backupPath: victim, backupRoot: outDir });
  assert.equal(result.ok, false);
  assert.equal(existsSync(victim), true);
});

test('restore ignores crafted manifest destinations and verification detects tampering', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bizar-backup-manifest-'));
  roots.push(fixture);
  const project = join(fixture, 'project');
  const outDir = join(fixture, 'backups');
  mkdirSync(join(project, '.bizar'), { recursive: true });
  writeFileSync(join(project, '.bizar', 'state.json'), 'safe');
  const bizarHome = join(fixture, 'global-config');
  const backup = await createBackup({ outDir, projectRoot: project, label: 'safe', bizarHome });
  const manifestPath = join(backup.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.paths.find((entry) => entry.label === 'project-state').src = '../../victim';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(backup.path, 'project-state', 'state.json'), 'tampered');
  const verified = await verifyBackup({ backupPath: backup.path });
  assert.equal(verified.ok, false);
  assert.match(verified.issues.join('\n'), /Integrity mismatch/);
  const restored = await restoreBackup({ backupPath: backup.path, projectRoot: project, conflictStrategy: 'overwrite', bizarHome });
  assert.equal(restored.ok, false);
  assert.match(restored.errors.join('\n'), /Integrity check failed/);
  assert.equal(readFileSync(join(project, '.bizar', 'state.json'), 'utf8'), 'safe');
  assert.equal(existsSync(join(fixture, 'victim')), false);
});

test('verification rejects files added after a v2 backup is created', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bizar-backup-extra-'));
  roots.push(fixture);
  const outDir = join(fixture, 'backups');
  const backup = await createBackup({ outDir, label: 'extra', bizarHome: join(fixture, 'global-config') });
  mkdirSync(join(backup.path, 'config'), { recursive: true });
  writeFileSync(join(backup.path, 'config', 'injected.json'), '{}');
  const verified = await verifyBackup({ backupPath: backup.path });
  assert.equal(verified.ok, false);
  assert.match(verified.issues.join('\n'), /Unexpected integrity file/);
});

test('backup retains project state without removed subsystem payloads', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bizar-backup-'));
  roots.push(fixture);
  const project = join(fixture, 'project');
  const outDir = join(fixture, 'backups');
  mkdirSync(join(project, '.bizar'), { recursive: true });
  writeFileSync(join(project, '.bizar', 'state.json'), '{"status":"active"}');

  const bizarHome = join(fixture, 'global-config');
  const result = await createBackup({ outDir, projectRoot: project, label: 'core', bizarHome });
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
    bizarHome,
  });
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.equal(readFileSync(join(project, '.bizar', 'state.json'), 'utf8'), '{"status":"active"}');
});
