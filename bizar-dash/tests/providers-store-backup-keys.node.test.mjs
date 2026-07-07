/**
 * providers-store-backup-keys.node.test.mjs — regression tests for the
 * v3.20.10 backup-keys feature.
 *
 * The dashboard's Providers card + the API provider config now support
 * a second `backupApiKey` slot per provider. Operators can:
 *   - Set primary in cline.json (`apiKey`)
 *   - Set backup in cline.json (`backupApiKey`)
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

async function writeClineJson(obj) {
  const { mkdirSync } = await import('node:fs');
  const cfgDir = join(SANDBOX_HOME, '.config', 'cline');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'cline.json'), JSON.stringify(obj, null, 2));
}

async function resetClineJson() {
  const { mkdirSync } = await import('node:fs');
  const cfgDir = join(SANDBOX_HOME, '.config', 'cline');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'cline.json'), '{}');
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
      await resetClineJson();
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
      writeClineJson({
        provider: {
          minimax: {
            apiKey: '',
            backupApiKey: 'sk-cp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
        },
      });
      process.env.MINIMAX_API_KEY = 'sk-cp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
      writeClineJson({
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
      process.env.MINIMAX_API_KEY_BACKUP = 'sk-cp-iiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';

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
      await resetClineJson();
    });
    it('persists backupApiKey in cline.json', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        apiKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        backupApiKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      // Re-read from disk to confirm persistence.
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/cline/cline.json'), 'utf8'));
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
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/cline/cline.json'), 'utf8'));
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
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/cline/cline.json'), 'utf8'));
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
      const raw = JSON.parse(readFileSync(join(SANDBOX_HOME, '.config/cline/cline.json'), 'utf8'));
      assert.equal(raw.provider.minimax.backupApiKey, '');
    });
  });

  describe('listAll — backup key surfaced', () => {
    it('reports backupApiKey (masked) and source', async () => {
      writeClineJson({
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

  // ── v4.6.0 keys[] array rotation / cooldown tests ────────────────────
  //
  // These cover the new top-level exports from providers-store.mjs:
  //   - getActiveKey(providerId)
  //   - markKeyError(providerId, envVar, error)
  //   - markKeySuccess(providerId, envVar)
  //   - rotateKey(providerId)
  //   - addBackupKey(providerId, envVar, label)
  //   - removeBackupKey(providerId, envVar)
  //   - setKeyStatus(providerId, envVar, status)
  //   - withKeyRotation(providerId, fn, opts)
  //   - isRetryableError(err)
  //
  // All of these work against the v4.6.0 keys[] array shape and the
  // legacy apiKey/backupApiKey fields are kept in sync via
  // syncLegacyKeys() on writes.

  describe('v4.6.0 — keys[] array migration from legacy', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('legacy apiKey is exposed as a keys[] entry on list()', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        apiKey: 'sk-cp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.ok(Array.isArray(minimax.keys));
      assert.equal(minimax.keys.length, 1);
      assert.equal(minimax.keys[0].label, 'Primary');
      assert.equal(minimax.keys[0].status, 'active');
    });

    it('legacy apiKey + backupApiKey becomes a 2-entry keys[]', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        apiKey: 'sk-cp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        backupApiKey: 'sk-cp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.equal(minimax.keys.length, 2);
      assert.equal(minimax.keys[0].label, 'Primary');
      assert.equal(minimax.keys[0].status, 'active');
      assert.equal(minimax.keys[1].label, 'Backup');
      assert.equal(minimax.keys[1].status, 'standby');
    });

    it('caller-provided keys[] is preserved verbatim', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Work laptop', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Home', status: 'standby' },
        ],
      });
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.equal(minimax.keys.length, 2);
      assert.equal(minimax.keys[0].envVar, 'BIZAR_MINIMAX_KEY');
      assert.equal(minimax.keys[0].status, 'active');
      assert.equal(minimax.keys[1].envVar, 'BIZAR_MINIMAX_BACKUP');
      assert.equal(minimax.keys[1].status, 'standby');
    });
  });

  describe('v4.6.0 — getActiveKey', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('returns null when the provider does not exist', async () => {
      const store = await loadStore();
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=getActive-1');
      assert.equal(mod.getActiveKey('nonexistent'), null);
    });

    it('returns null when the provider has no keys', async () => {
      const store = await loadStore();
      await store.add({ id: 'minimax', name: 'MiniMax' });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=getActive-2');
      assert.equal(mod.getActiveKey('minimax'), null);
    });

    it('returns the active key with the env value resolved', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_KEY = 'sk-cp-active-value';
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup-value';

      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=getActive-3');
      const active = mod.getActiveKey('minimax');
      assert.ok(active);
      assert.equal(active.envVar, 'BIZAR_MINIMAX_KEY');
      assert.equal(active.label, 'Primary');
      assert.equal(active.status, 'active');
      assert.equal(active.key, 'sk-cp-active-value');
      delete process.env.BIZAR_MINIMAX_KEY;
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });

    it('falls back to standby when active is missing', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup-only';
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=getActive-4');
      const active = mod.getActiveKey('minimax');
      assert.equal(active.envVar, 'BIZAR_MINIMAX_BACKUP');
      assert.equal(active.status, 'standby');
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });
  });

  describe('v4.6.0 — markKeyError', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('records errorCount + lastError on the named envVar', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
        ],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=markErr-1');
      mod.markKeyError('minimax', 'BIZAR_MINIMAX_KEY', new Error('http_429 too many requests'));
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.equal(minimax.keys[0].errorCount, 1);
      assert.match(minimax.keys[0].lastError, /http_429/);
      assert.equal(minimax.keys[0].status, 'active'); // below threshold
    });

    it('demotes to cooldown after ERROR_COOLDOWN_THRESHOLD errors', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
        ],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=markErr-2');
      // Threshold is 3
      mod.markKeyError('minimax', 'BIZAR_MINIMAX_KEY', 'err1');
      mod.markKeyError('minimax', 'BIZAR_MINIMAX_KEY', 'err2');
      const afterTwo = store.list().find((p) => p.id === 'minimax').keys[0];
      assert.equal(afterTwo.errorCount, 2);
      assert.equal(afterTwo.status, 'active'); // still below
      mod.markKeyError('minimax', 'BIZAR_MINIMAX_KEY', 'err3');
      const afterThree = store.list().find((p) => p.id === 'minimax').keys[0];
      assert.equal(afterThree.errorCount, 3);
      assert.equal(afterThree.status, 'cooldown');
    });

    it('is a no-op for unknown envVars', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [{ envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' }],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=markErr-3');
      const result = mod.markKeyError('minimax', 'NONEXISTENT_ENV', 'err');
      assert.equal(result, null);
      const list = store.list();
      assert.equal(list.find((p) => p.id === 'minimax').keys[0].errorCount, 0);
    });
  });

  describe('v4.6.0 — rotateKey', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('promotes the next standby key', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rotate-1');
      const rotated = mod.rotateKey('minimax');
      assert.ok(rotated);
      assert.equal(rotated.envVar, 'BIZAR_MINIMAX_BACKUP');
      const list = store.list();
      const minimax = list.find((p) => p.id === 'minimax');
      assert.equal(minimax.keys[0].status, 'disabled');
      assert.equal(minimax.keys[1].status, 'active');
    });

    it('returns null when no rotation target exists', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [{ envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' }],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rotate-2');
      const rotated = mod.rotateKey('minimax');
      assert.equal(rotated, null);
    });
  });

  describe('v4.6.0 — addBackupKey / removeBackupKey', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('addBackupKey appends a new standby key', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [{ envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' }],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=addRm-1');
      const inserted = mod.addBackupKey('minimax', 'BIZAR_MINIMAX_BACKUP', 'Personal');
      assert.equal(inserted.envVar, 'BIZAR_MINIMAX_BACKUP');
      assert.equal(inserted.status, 'standby');
      assert.equal(inserted.label, 'Personal');
      const list = store.list().find((p) => p.id === 'minimax');
      assert.equal(list.keys.length, 2);
    });

    it('addBackupKey rejects duplicate envVar', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [{ envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' }],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=addRm-2');
      assert.throws(() => mod.addBackupKey('minimax', 'BIZAR_MINIMAX_KEY', 'dup'), /already exists/);
    });

    it('removeBackupKey refuses to remove the last key', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [{ envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' }],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=addRm-3');
      assert.throws(() => mod.removeBackupKey('minimax', 'BIZAR_MINIMAX_KEY'), /last key/);
    });

    it('removeBackupKey removes a non-last key', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=addRm-4');
      const ok = mod.removeBackupKey('minimax', 'BIZAR_MINIMAX_BACKUP');
      assert.equal(ok, true);
      const list = store.list().find((p) => p.id === 'minimax');
      assert.equal(list.keys.length, 1);
      assert.equal(list.keys[0].envVar, 'BIZAR_MINIMAX_KEY');
    });
  });

  describe('v4.6.0 — withKeyRotation', () => {
    beforeEach(async () => {
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY_BACKUP;
      await resetClineJson();
    });

    it('returns the fn result on first success', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_KEY = 'sk-cp-primary';
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup';

      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rot-fn-1');
      const result = await mod.withKeyRotation('minimax', async (key, envVar) => {
        assert.equal(key, 'sk-cp-primary');
        assert.equal(envVar, 'BIZAR_MINIMAX_KEY');
        return 'ok';
      });
      assert.equal(result, 'ok');

      delete process.env.BIZAR_MINIMAX_KEY;
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });

    it('retries on retryable errors (429) and rotates to backup', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_KEY = 'sk-cp-primary';
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup';

      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rot-fn-2');
      let callCount = 0;
      const result = await mod.withKeyRotation('minimax', async (key, envVar) => {
        callCount++;
        if (callCount === 1) {
          // Primary key gets 429
          const e = new Error('rate limit');
          e.status = 429;
          throw e;
        }
        assert.equal(key, 'sk-cp-backup');
        assert.equal(envVar, 'BIZAR_MINIMAX_BACKUP');
        return 'rotated';
      });
      assert.equal(result, 'rotated');
      assert.equal(callCount, 2);

      // Verify the primary was errored and rotated
      const list = store.list().find((p) => p.id === 'minimax');
      const primary = list.keys.find((k) => k.envVar === 'BIZAR_MINIMAX_KEY');
      assert.ok(primary);
      assert.ok(primary.errorCount >= 1);
      assert.equal(primary.status, 'disabled'); // rotated away

      delete process.env.BIZAR_MINIMAX_KEY;
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });

    it('does NOT rotate on non-retryable errors', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_KEY = 'sk-cp-primary';
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup';

      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rot-fn-3');
      await assert.rejects(async () => {
        await mod.withKeyRotation('minimax', async () => {
          const e = new Error('ECONNRESET fetch failed');
          throw e;
        });
      }, /ECONNRESET/);

      // No rotation should have happened
      const list = store.list().find((p) => p.id === 'minimax');
      const primary = list.keys.find((k) => k.envVar === 'BIZAR_MINIMAX_KEY');
      assert.equal(primary.status, 'active');

      delete process.env.BIZAR_MINIMAX_KEY;
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });

    it('throws rotation_exhausted when all keys fail', async () => {
      const store = await loadStore();
      await store.add({
        id: 'minimax',
        name: 'MiniMax',
        keys: [
          { envVar: 'BIZAR_MINIMAX_KEY', label: 'Primary', status: 'active' },
          { envVar: 'BIZAR_MINIMAX_BACKUP', label: 'Backup', status: 'standby' },
        ],
      });
      process.env.BIZAR_MINIMAX_KEY = 'sk-cp-primary';
      process.env.BIZAR_MINIMAX_BACKUP = 'sk-cp-backup';

      const mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=rot-fn-4');
      await assert.rejects(async () => {
        await mod.withKeyRotation('minimax', async () => {
          const e = new Error('http_429 too many');
          e.status = 429;
          throw e;
        });
      }, (err) => {
        assert.equal(err.code, 'rotation_exhausted');
        assert.equal(err.attempts, 2);
        return true;
      });

      delete process.env.BIZAR_MINIMAX_KEY;
      delete process.env.BIZAR_MINIMAX_BACKUP;
    });
  });

  describe('v4.6.0 — isRetryableError', () => {
    let mod;
    before(async () => {
      mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + '?cb=retry-1');
    });

    it('treats HTTP 401/403 as retryable', () => {
      assert.equal(mod.isRetryableError({ status: 401 }), true);
      assert.equal(mod.isRetryableError({ status: 403 }), true);
    });
    it('treats HTTP 429 as retryable', () => {
      assert.equal(mod.isRetryableError({ status: 429 }), true);
    });
    it('treats 5xx as retryable', () => {
      assert.equal(mod.isRetryableError({ status: 500 }), true);
      assert.equal(mod.isRetryableError({ status: 502 }), true);
      assert.equal(mod.isRetryableError({ status: 503 }), true);
      assert.equal(mod.isRetryableError({ status: 599 }), true);
    });
    it('treats minimax-style http_NNN error code as retryable', () => {
      assert.equal(mod.isRetryableError({ error: 'http_429', status: 429 }), true);
      assert.equal(mod.isRetryableError({ error: 'http_503' }), true);
    });
    it('does NOT treat network errors as retryable', () => {
      assert.equal(mod.isRetryableError(new Error('ECONNRESET')), false);
      assert.equal(mod.isRetryableError(new Error('fetch failed')), false);
      assert.equal(mod.isRetryableError(new Error('AbortError')), false);
    });
    it('does NOT treat 4xx-other (400/404/422) as retryable', () => {
      assert.equal(mod.isRetryableError({ status: 400 }), false);
      assert.equal(mod.isRetryableError({ status: 404 }), false);
      assert.equal(mod.isRetryableError({ status: 422 }), false);
    });
    it('handles quota/rate-limit messages', () => {
      assert.equal(mod.isRetryableError(new Error('rate limit exceeded')), true);
      assert.equal(mod.isRetryableError(new Error('insufficient credits')), true);
    });
  });
});
