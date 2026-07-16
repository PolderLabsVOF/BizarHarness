/**
 * cli/migrate.test.mjs — tests for `bizar migrate`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { detectLegacyInstall, isAlreadyMigrated, markMigrated, migrateLegacy } from './migrate.mjs';

test('detect — finds both legacy dirs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bizar-migrate-test-'));
  try {
    const fakeHome = join(tmp, 'home');
    mkdirSync(join(fakeHome, '.config', 'cline'), { recursive: true });
    mkdirSync(join(fakeHome, '.config', 'bizar'), { recursive: true });

    const result = detectLegacyInstall(fakeHome);
    if (!result.hasLegacyClaude) throw new Error('expected hasLegacyClaude=true');
    if (!result.hasLegacyBizar) throw new Error('expected hasLegacyBizar=true');
    if (result.paths.length !== 2) throw new Error(`expected 2 paths, got ${result.paths.length}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('migrate — moves files to ~/.claude/ and writes stamp', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bizar-migrate-test-'));
  try {
    const fakeHome = join(tmp, 'home');

    // Set up legacy dirs with content
    mkdirSync(join(fakeHome, '.config', 'cline'), { recursive: true });
    writeFileSync(join(fakeHome, '.config', 'cline', 'settings.json'), '{"tabSize":2}');
    mkdirSync(join(fakeHome, '.config', 'bizar'), { recursive: true });
    writeFileSync(join(fakeHome, '.config', 'bizar', 'state.json'), '{"v":"6.2.0"}');

    const result = await migrateLegacy({ dryRun: false, force: true, home: fakeHome });

    if (!result.ok) throw new Error(`migrateLegacy failed: ${result.message}`);
    if (!result.message.includes('Migration complete')) throw new Error(`unexpected message: ${result.message}`);

    // Verify cline content landed in ~/.claude/
    const migratedSettings = join(fakeHome, '.claude', 'settings.json');
    if (!existsSync(migratedSettings)) throw new Error('settings.json not migrated');
    const data = JSON.parse(readFileSync(migratedSettings, 'utf8'));
    if (data.tabSize !== 2) throw new Error('settings.json content wrong');

    // Verify bizar content landed in ~/.claude/bizar/
    const migratedState = join(fakeHome, '.claude', 'bizar', 'state.json');
    if (!existsSync(migratedState)) throw new Error('state.json not migrated');

    // Verify stamp written
    const stamp = join(fakeHome, '.claude', 'bizar', '.migration-stamp');
    if (!existsSync(stamp)) throw new Error('migration stamp not written');

    // Verify originals gone
    if (existsSync(join(fakeHome, '.config', 'cline'))) throw new Error('cline not removed');
    if (existsSync(join(fakeHome, '.config', 'bizar'))) throw new Error('bizar not removed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('idempotent — second run returns "already migrated" without touching anything', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bizar-migrate-test-'));
  try {
    const fakeHome = join(tmp, 'home');
    mkdirSync(join(fakeHome, '.config', 'cline'), { recursive: true });
    mkdirSync(join(fakeHome, '.claude', 'bizar'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'bizar', '.migration-stamp'), 'migrated=10.3.0\n');

    const result = await migrateLegacy({ dryRun: false, force: false, home: fakeHome });
    if (!result.message.includes('Already migrated')) {
      throw new Error(`Expected "Already migrated" message, got: ${result.message}`);
    }

    // Verify original still exists (not touched)
    if (!existsSync(join(fakeHome, '.config', 'cline'))) {
      throw new Error('Original cline dir was removed despite already-migrated state');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
