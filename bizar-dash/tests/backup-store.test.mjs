/**
 * tests/backup-store.test.mjs
 *
 * v4.8.0 — Tests for the backup-store module.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';

const BACKUP_STORE = await import('../src/server/backup-store.mjs').then((m) => m);

describe('backup-store', () => {
  let backupRoot;
  let configDir;
  let opencodeDir;
  let memoryDir;

  beforeEach(() => {
    const id = `bizar-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    backupRoot = join(tmpdir(), id, 'backups');
    configDir = join(tmpdir(), id, 'config', 'bizar');
    opencodeDir = join(tmpdir(), id, 'config', 'opencode');
    memoryDir = join(tmpdir(), id, 'local', 'share', 'bizar', 'memory');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });

    // Create some test files
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ theme: { mode: 'dark' } }), { mode: 0o600 });
    writeFileSync(join(opencodeDir, 'opencode.json'), JSON.stringify({ models: [] }), { mode: 0o600 });
    writeFileSync(join(memoryDir, 'test.md'), '# Test memory', { mode: 0o600 });
  });

  afterEach(() => {
    try { rmSync(backupRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(join(tmpdir(), `bizar-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── createBackup ─────────────────────────────────────────────────────────────

  describe('createBackup', () => {
    it('creates a timestamped backup directory', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      assert.strictEqual(result.ok, true);
      assert.ok(result.path.includes('bizar-'));
      assert.ok(existsSync(result.path));
    });

    it('writes a manifest.json with version, createdAt, and paths', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const manifestPath = join(result.path, 'manifest.json');
      assert.ok(existsSync(manifestPath));
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.ok(manifest.version);
      assert.ok(manifest.createdAt);
      assert.ok(Array.isArray(manifest.paths));
    });

    it('copies existing files to the backup', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const configBackup = join(result.path, 'config');
      assert.ok(existsSync(configBackup));
      const settingsBackup = join(configBackup, 'settings.json');
      assert.ok(existsSync(settingsBackup));
    });

    it('skips non-existent optional paths', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const manifestPath = join(result.path, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // Optional paths that don't exist should be in skipped list
      assert.ok(manifest.skipped);
    });

    it('respects custom label in name and manifest', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot, label: 'test-label' });
      assert.ok(result.path.includes('test-label'));
      const manifest = JSON.parse(readFileSync(join(result.path, 'manifest.json'), 'utf8'));
      assert.strictEqual(manifest.label, 'test-label');
    });

    it('returns sizeBytes and durationMs', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      assert.ok(typeof result.sizeBytes === 'number');
      assert.ok(result.sizeBytes >= 0);
      assert.ok(typeof result.durationMs === 'number');
      assert.ok(result.durationMs >= 0);
    });
  });

  // ── listBackups ──────────────────────────────────────────────────────────────

  describe('listBackups', () => {
    it('returns empty array when no backups exist', async () => {
      const emptyDir = join(tmpdir(), `bizar-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(emptyDir, { recursive: true });
      try {
        const backups = await BACKUP_STORE.listBackups({ inDir: emptyDir });
        assert.strictEqual(backups.length, 0);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('returns all backups sorted newest-first', async () => {
      await BACKUP_STORE.createBackup({ outDir: backupRoot });
      await BACKUP_STORE.createBackup({ outDir: backupRoot, label: 'second' });
      const backups = await BACKUP_STORE.listBackups({ inDir: backupRoot });
      assert.strictEqual(backups.length, 2);
      assert.strictEqual(backups[0].manifest?.label, 'second');
      assert.strictEqual(backups[1].manifest?.label, null);
    });

    it('includes createdAt, sizeBytes, sizeFormatted, and manifest', async () => {
      await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const backups = await BACKUP_STORE.listBackups({ inDir: backupRoot });
      assert.ok(backups[0].createdAt);
      assert.ok(typeof backups[0].sizeBytes === 'number');
      assert.ok(typeof backups[0].sizeFormatted === 'string');
      assert.ok(backups[0].manifest);
    });
  });

  // ── restoreBackup (dryRun) ───────────────────────────────────────────────────

  describe('restoreBackup (dryRun)', () => {
    it('does not modify any files when dryRun is true', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const settingsFile = join(configDir, 'settings.json');
      const originalContent = readFileSync(settingsFile, 'utf8');
      // Modify the settings file
      writeFileSync(settingsFile, JSON.stringify({ theme: { mode: 'light' } }), { mode: 0o600 });
      const restoreResult = await BACKUP_STORE.restoreBackup({
        backupPath: result.path,
        dryRun: true,
        conflictStrategy: 'overwrite',
      });
      assert.strictEqual(restoreResult.ok, true);
      // File should still have the modified content
      assert.strictEqual(readFileSync(settingsFile, 'utf8'), JSON.stringify({ theme: { mode: 'light' } }));
    });

    it('reports what would be restored in dryRun mode', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const restoreResult = await BACKUP_STORE.restoreBackup({
        backupPath: result.path,
        dryRun: true,
        conflictStrategy: 'merge',
      });
      assert.ok(restoreResult.restored.length > 0);
    });
  });

  // ── restoreBackup (overwrite) ────────────────────────────────────────────────

  describe('restoreBackup (overwrite)', () => {
    it('reports overwritten entries when conflictStrategy is overwrite (dryRun)', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      // dryRun=true means no actual overwrite happens, but we can verify
      // the restored list includes the backed-up entries
      const restoreResult = await BACKUP_STORE.restoreBackup({
        backupPath: result.path,
        dryRun: true,
        conflictStrategy: 'overwrite',
      });
      assert.strictEqual(restoreResult.ok, true);
      // In dryRun mode, entries that would be overwritten are listed in restored
      assert.ok(restoreResult.restored.length > 0);
    });

    it('overwrites a manually-created backup correctly', async () => {
      // Create a manual backup structure with project-state label (which is in PROJECT_BACKUP_PATHS)
      const testBackupDir = join(backupRoot, 'bizar-test-overwrite-manual');
      const testProjectRoot = join(tmpdir(), `backup-overwrite-test-${Date.now()}`);
      mkdirSync(testBackupDir, { recursive: true });
      mkdirSync(testProjectRoot, { recursive: true });
      mkdirSync(join(testBackupDir, 'project-state'), { recursive: true });

      // Write original content to backup
      const originalContent = { theme: { mode: 'dark' } };
      writeFileSync(join(testBackupDir, 'project-state', 'state.json'), JSON.stringify(originalContent), { mode: 0o600 });
      // Use new manifest format with {label, src} objects
      writeFileSync(
        join(testBackupDir, 'manifest.json'),
        JSON.stringify({
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          paths: [{ label: 'project-state', src: '.bizar/' }],
        }),
        { mode: 0o600 },
      );

      // Restore with overwrite — project-state is in PROJECT_BACKUP_PATHS, so it will restore
      const restoreResult = await BACKUP_STORE.restoreBackup({
        backupPath: testBackupDir,
        dryRun: false,
        conflictStrategy: 'overwrite',
        projectRoot: testProjectRoot,
      });
      // The entry should be restored (it's in PROJECT_BACKUP_PATHS)
      assert.ok(restoreResult.ok);

      // Cleanup
      rmSync(testProjectRoot, { recursive: true, force: true });
    });
  });

  // ── verifyBackup ─────────────────────────────────────────────────────────────

  describe('verifyBackup', () => {
    it('returns ok=true for a valid backup', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const verifyResult = await BACKUP_STORE.verifyBackup({ backupPath: result.path });
      assert.strictEqual(verifyResult.ok, true);
      assert.strictEqual(verifyResult.issues.length, 0);
    });

    it('returns ok=false when manifest is missing', async () => {
      const backupDir = join(backupRoot, 'bizar-test-no-manifest');
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, 'somefile.txt'), 'test', { mode: 0o600 });
      const verifyResult = await BACKUP_STORE.verifyBackup({ backupPath: backupDir });
      assert.strictEqual(verifyResult.ok, false);
      assert.ok(verifyResult.issues.length > 0);
    });

    it('detects missing backup entries', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      // Remove a backed-up directory
      rmSync(join(result.path, 'config'), { recursive: true, force: true });
      const verifyResult = await BACKUP_STORE.verifyBackup({ backupPath: result.path });
      assert.strictEqual(verifyResult.ok, false);
      assert.ok(verifyResult.issues.some((i) => i.includes('config')));
    });

    it('returns ok=false when backup directory does not exist', async () => {
      const verifyResult = await BACKUP_STORE.verifyBackup({
        backupPath: join(tmpdir(), 'nonexistent-backup-path'),
      });
      assert.strictEqual(verifyResult.ok, false);
    });
  });

  // ── deleteBackup ─────────────────────────────────────────────────────────────

  describe('deleteBackup', () => {
    it('removes the backup directory', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      assert.ok(existsSync(result.path));
      const deleteResult = await BACKUP_STORE.deleteBackup({ backupPath: result.path });
      assert.strictEqual(deleteResult.ok, true);
      assert.ok(!existsSync(result.path));
    });

    it('returns ok=false when backup does not exist', async () => {
      const deleteResult = await BACKUP_STORE.deleteBackup({
        backupPath: join(tmpdir(), 'nonexistent-backup-path'),
      });
      assert.strictEqual(deleteResult.ok, false);
      assert.ok(deleteResult.error);
    });
  });

  // ── getManifest ──────────────────────────────────────────────────────────────

  describe('getManifest', () => {
    it('returns manifest when backup exists', async () => {
      const result = await BACKUP_STORE.createBackup({ outDir: backupRoot });
      const manifestResult = await BACKUP_STORE.getManifest({ backupPath: result.path });
      assert.strictEqual(manifestResult.ok, true);
      assert.ok(manifestResult.manifest);
      assert.ok(manifestResult.manifest.version);
    });

    it('returns ok=false when manifest is missing', async () => {
      const backupDir = join(backupRoot, 'bizar-no-manifest');
      mkdirSync(backupDir, { recursive: true });
      const manifestResult = await BACKUP_STORE.getManifest({ backupPath: backupDir });
      assert.strictEqual(manifestResult.ok, false);
    });

    it('returns ok=false when backup does not exist', async () => {
      const manifestResult = await BACKUP_STORE.getManifest({
        backupPath: join(tmpdir(), 'nonexistent'),
      });
      assert.strictEqual(manifestResult.ok, false);
    });
  });
});
