/**
 * providers-store-backup-keys.node.test.mjs — regression tests for the
 * v3.20.10 backup-keys feature.
 *
 * The dashboard's Providers card + the API provider config now support
 * a second `backupApiKey` slot per provider. Operators can:
 *   - Set primary in opencode.json (`apiKey`)
 *   - Set backup in opencode.json (`backupApiKey`)
 *   - Set primary via env (`MINIMAX_API_KEY`, etc.)
 *   - Set backup via env (`MINIMAX_API_KEY_BACKUP`, etc.)
 *   - Have a backup without a primary (rare; valid)
 *
 * Detection order (highest priority first):
 *   1. config.provider.<id>.apiKey
 *   2. config.provider.<id>.backupApiKey
 *   3. process.env[envKey]        (primary)
 *   4. process.env[backupEnvKey]  (backup)
 *
 * Run with: node --test tests/providers-store-backup-keys.node.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');

let SANDBOX_HOME;
let ORIGINAL_HOME;
let ORIGINAL_ENV_KEYS;

before(() => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-providers-test-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  ORIGINAL_ENV_KEYS = {
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    MINIMAX_API_KEY_BACKUP: process.env.MINIMAX_API_KEY_BACKUP,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_API_KEY_BACKUP: process.env.OPENAI_API_KEY_BACKUP,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  process.env.HOME = SANDBOX_HOME;
  // Wipe known env vars so tests are deterministic.
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_API_KEY_BACKUP;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY_BACKUP;
  delete process.env.ANTHROPIC_API_KEY;
});

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  for (const [k, v] of Object.entries(ORIGINAL_ENV_KEYS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function writeOpencodeJson(obj) {
  const { mkdirSync } = await import('node:fs');
  const cfgDir = join(SANDBOX_HOME, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify(obj, null, 2));
}

async function resetOpencodeJson() {
  const { mkdirSync } = await import('node:fs');
  const cfgDir = join(SANDBOX_HOME, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'opencode.json'), '{}');
}

describe('providers-store — backup keys (v3.20.10)', () => {
  // We re-import the module under each test so HOME/env changes take
  // effect. node:import-cache can bite us otherwise.
  async function loadStore() {
    // Bust the import cache so the module re-evaluates homedir().
    const cacheBust = '?cb=' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + cacheBust);
    return mod.providersStore;
  }

  describe('KNOWN_PROVIDERS — backupEnvKeys', () => {
    it('declares backupEnvKeys for every known provider', async () => {
      const store = await loadStore();
      assert.ok(Array.isArray(store.KNOWN_PROVIDERS));
      assert.ok(store.KNOWN_PROVIDERS.length >= 9, 'expected at least 9 known providers');
      for (const spec of store.KNOWN_PROVIDERS) {
        assert.ok(Array.isArray(spec.envKeys), `${spec.id} missing envKeys`);
        assert.ok(spec.envKeys.length >= 1, `${spec.id} has empty envKeys`);
        assert.ok(Array.isArray(spec.backupEnvKeys), `${spec.id} missing backupEnvKeys`);
        assert.ok(spec.backupEnvKeys.length >= 1, `${spec.id} has empty backupEnvKeys`);
        // Backup envKeys must NOT overlap with primary envKeys.
        const overlap = spec.envKeys.filter((k) => spec.backupEnvKeys.includes(k));
        assert.equal(overlap.length, 0, `${spec.id} backup envKey overlaps primary: ${overlap.join(',')}`);
        // All backup envKeys should follow one of the two naming
        // conventions:
        //   - `<NAME>_API_KEY_BACKUP` (api-key-then-backup)
        //   - `<NAME>_BACKUP_API_KEY` (backup-then-api-key)
        // We accept either; both are conventional. We reject anything
        // else to catch typos like `MINIMAX_BACKUP` (missing `_API_KEY`).
        for (const bk of spec.backupEnvKeys) {
          const ok = /_(?:API_KEY_BACKUP|BACKUP_API_KEY)$/.test(bk);
          assert.ok(ok, `${spec.id} backup envKey ${bk} doesn't end with _API_KEY_BACKUP or _BACKUP_API_KEY`);
        }
      }
    });

    it('MiniMax has 3 backup envKeys including Anthropic fallback', async () => {
      const store = await loadStore();
      const minimax = store.KNOWN_PROVIDERS.find((p) => p.id === 'minimax');
      assert.ok(minimax);
      assert.deepEqual(minimax.envKeys, ['MINIMAX_API_KEY', 'ANTHROPIC_API_KEY']);
      assert.ok(minimax.backupEnvKeys.includes('MINIMAX_API_KEY_BACKUP'));
      assert.ok(minimax.backupEnvKeys.includes('MINIMAX_BACKUP_API_KEY'));
      assert.ok(minimax.backupEnvKeys.includes('ANTHROPIC_API_KEY_BACKUP'));
    });
  });

  describe('autoDetect — backup key discovery', () => {
    beforeEach(async () => {
      // Reset env + on-disk config between tests so they're independent.
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY_BACKUP;
      delete process.env.ANTHROPIC_API_KEY;
      await resetOpencodeJson();
    });

    it('reports no backup when no env keys and no config', async () => {
      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const minimax = results.find((p) => p.id === 'minimax');
      assert.ok(minimax);
      assert.equal(minimax.status, 'no-key');
      assert.equal(minimax.hasKey, false);
      assert.equal(minimax.backup.status, 'no-key');
      assert.equal(minimax.backup.hasKey, false);
      assert.equal(minimax.backup.source, '');
    });

    it('detects primary from env and backup from config', async () => {
      writeOpencodeJson({
        provider: {
          minimax: {
            apiKey: '',
            backupApiKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      });
      process.env.MINIMAX_API_KEY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const minimax = results.find((p) => p.id === 'minimax');
      assert.equal(minimax.hasKey, true);
      assert.equal(minimax.status, 'configured');
      assert.match(minimax.keySource, /^env:MINIMAX_API_KEY$/);
      assert.equal(minimax.backup.hasKey, true);
      assert.equal(minimax.backup.status, 'configured');
      assert.equal(minimax.backup.source, 'config');
    });

    it('detects backup from *_BACKUP_API_KEY env var', async () => {
      process.env.MINIMAX_API_KEY = 'cccccccccccccccccccccccccccccccccccccc';
      process.env.MINIMAX_API_KEY_BACKUP = 'dddddddddddddddddddddddddddddddddddd';

      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const minimax = results.find((p) => p.id === 'minimax');
      assert.equal(minimax.hasKey, true);
      assert.equal(minimax.backup.hasKey, true);
      assert.equal(minimax.backup.source, 'env:MINIMAX_API_KEY_BACKUP');
    });

    it('prefers config over env for both primary and backup', async () => {
      writeOpencodeJson({
        provider: {
          minimax: {
            apiKey: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            backupApiKey: 'ffffffffffffffffffffffffffffffffffffffffff',
          },
        },
      });
      // Env should be ignored when config has values.
      process.env.MINIMAX_API_KEY = 'gggggggggggggggggggggggggggggggggggggg';
      process.env.MINIMAX_API_KEY_BACKUP = 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh';

      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const minimax = results.find((p) => p.id === 'minimax');
      assert.equal(minimax.keySource, 'config');
      assert.equal(minimax.backup.source, 'config');
    });

    it('allows backup without primary (rotation in progress)', async () => {
      // No primary key — only backup env var.
      process.env.MINIMAX_API_KEY_BACKUP = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';

      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const minimax = results.find((p) => p.id === 'minimax');
      assert.equal(minimax.status, 'no-key');
      assert.equal(minimax.backup.status, 'configured');
      assert.equal(minimax.backup.hasKey, true);
    });

    it('reports backup status as unknown when format does not match', async () => {
      // OpenAI primary: must start with `sk-` for the configured status.
      process.env.OPENAI_API_KEY = 'sk-jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj';
      // Backup is intentionally invalid format (no `sk-` prefix) — must
      // downgrade to `unknown` so the UI shows the operator a warning.
      process.env.OPENAI_API_KEY_BACKUP = 'notvalidformat';

      const store = await loadStore();
      const results = await store.autoDetect({ probe: false });
      const openai = results.find((p) => p.id === 'openai');
      assert.equal(openai.status, 'configured');
      assert.equal(openai.backup.status, 'unknown');
    });
  });

  describe('add / update — backup key persistence', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY_BACKUP;
      delete process.env.ANTHROPIC_API_KEY;
      await resetOpencodeJson();
    });
    it('persists backupApiKey in opencode.json', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        apiKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        backupApiKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      // Re-read from disk to confirm persistence.
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/opencode/opencode.json'), 'utf8'));
      assert.equal(raw.provider.minimax.apiKey, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      assert.equal(raw.provider.minimax.backupApiKey, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    });

    it('list() masks both apiKey and backupApiKey', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        apiKey: 'ccccccccccccccccccccccccccccccccccccccccc',
        backupApiKey: 'dddddddddddddddddddddddddddddddddddddd',
      });
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.match(minimax.apiKey, /^cc\.\.\.cc$/); // masked
      assert.match(minimax.backupApiKey, /^dd\.\.\.dd$/);
      assert.notEqual(minimax.apiKey, 'ccccccccccccccccccccccccccccccccccccccccc');
      assert.notEqual(minimax.backupApiKey, 'dddddddddddddddddddddddddddddddddddddd');
    });

    it('update() preserves stored backupApiKey when form submits masked placeholder', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        apiKey: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        backupApiKey: 'ffffffffffffffffffffffffffffffffffffffffff',
      });
      // Operator re-submits the form without touching the keys (the
      // masked placeholders come back from list()).
      const updated = await store.update('minimax', {
        name: 'MiniMax (renamed)',
        apiKey: '***short***',
        backupApiKey: '***short***',
      });
      assert.equal(updated.name, 'MiniMax (renamed)');
      // Stored values must be preserved — mask-keep semantics.
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/opencode/opencode.json'), 'utf8'));
      assert.equal(raw.provider.minimax.apiKey, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      assert.equal(raw.provider.minimax.backupApiKey, 'ffffffffffffffffffffffffffffffffffffffffff');
    });

    it('update() replaces backupApiKey when a new value is supplied', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        apiKey: 'gggggggggggggggggggggggggggggggggggggg',
        backupApiKey: 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
      });
      await store.update('minimax', {
        backupApiKey: 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
      });
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/opencode/opencode.json'), 'utf8'));
      assert.equal(raw.provider.minimax.backupApiKey, 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii');
      assert.equal(raw.provider.minimax.apiKey, 'gggggggggggggggggggggggggggggggggggggg');
    });

    it('update() supports clearing backupApiKey with empty string', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        apiKey: 'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj',
        backupApiKey: 'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
      });
      // Operator clears the backup field.
      await store.update('minimax', { backupApiKey: '' });
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/opencode/opencode.json'), 'utf8'));
      assert.equal(raw.provider.minimax.backupApiKey, '');
    });
  });

  describe('listAll — backup key surfaced', () => {
    it('reports backupApiKey (masked) and source', async () => {
      writeOpencodeJson({
        provider: {
          minimax: {
            apiKey: 'llllllllllllllllllllllllllllllllllllllll',
            backupApiKey: 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm',
          },
        },
      });
      const store = await loadStore();
      const all = await store.listAll();
      const minimax = all.find((p) => p.id === 'minimax');
      assert.ok(minimax);
      assert.match(minimax.apiKey, /^ll\.\.\.ll$/);
      assert.match(minimax.backupApiKey, /^mm\.\.\.mm$/);
    });
  });
});
