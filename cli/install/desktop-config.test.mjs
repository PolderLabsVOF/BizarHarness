/**
 * cli/install/desktop-config.test.mjs
 *
 * Tests for cli/install/desktop-config.mjs (commit 4 of the installer
 * redesign). Coverage target ≥90%.
 *
 * Style matches cli/install/detect.test.mjs: `node:test`, in-memory
 * filesystem helper, `withPlatform` stub for `process.platform`, and
 * a small real-filesystem integration smoke at the bottom.
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  backupActiveDesktopConfig,
  detectManagedOverride,
  mergeGatewayIntoDesktopConfig,
  readActiveDesktopConfig,
  writeDesktopConfigWithBackup,
} from './desktop-config.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal in-memory filesystem surface. The desktop-config module only
 * touches `existsSync`, `readFileSync`, and `writeFileSync`, so the
 * helper tracks files + directories and mirrors ENOENT semantics.
 *
 * `writeFileSync` records each write into a `writes` array so tests
 * can assert ordering (e.g. backup-before-write, rollback semantics).
 */
function makeMemFs() {
  const files = new Map();
  const dirs = new Set();
  const writes = [];
  function existsSync(p) {
    return files.has(p) || dirs.has(p);
  }
  function readFileSync(p, encoding) {
    if (!files.has(p)) {
      const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
      err.code = 'ENOENT';
      throw err;
    }
    const value = files.get(p);
    if (encoding === 'utf8') return typeof value === 'string' ? value : value.toString('utf8');
    return value;
  }
  function writeFileSync(p, contents, encoding) {
    writes.push({ path: p, contents, encoding });
    if (encoding === 'utf8' && typeof contents !== 'string') {
      files.set(p, contents.toString('utf8'));
    } else {
      files.set(p, contents);
    }
    let parent = p;
    while (true) {
      const idx = parent.lastIndexOf(sep);
      if (idx <= 0) break;
      parent = parent.slice(0, idx);
      dirs.add(parent);
    }
  }
  function addFile(p, contents) {
    files.set(p, contents);
    let parent = p;
    while (true) {
      const idx = parent.lastIndexOf(sep);
      if (idx <= 0) break;
      parent = parent.slice(0, idx);
      dirs.add(parent);
    }
  }
  function addDir(p) { dirs.add(p); }
  function getWrite(p) {
    return writes.filter((w) => w.path === p);
  }
  function lastWrite(p) {
    const ws = getWrite(p);
    return ws.length ? ws[ws.length - 1] : null;
  }
  return { existsSync, readFileSync, writeFileSync, addFile, addDir, writes, getWrite, lastWrite };
}

/**
 * Stub `process.platform` for the duration of `fn`. The spec mandates
 * `process.platform` as the OS source for `detectManagedOverride`, so
 * the only test surface that touches process globals is here.
 */
function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(process, 'platform', original);
    else delete process.platform;
  }
}

// ─── mergeGatewayIntoDesktopConfig ───────────────────────────────────────────

describe('mergeGatewayIntoDesktopConfig()', () => {
  test('empty existing + new gateway values: only the four gateway keys are set', () => {
    const out = mergeGatewayIntoDesktopConfig({
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-test',
      authScheme: 'bearer',
    });
    assert.equal(out.inferenceProvider, 'gateway');
    assert.equal(out.inferenceGatewayBaseUrl, 'https://gw.example/v1');
    assert.equal(out.inferenceGatewayApiKey, 'sk-test');
    assert.equal(out.inferenceGatewayAuthScheme, 'bearer');
    // No spurious keys.
    assert.deepEqual(Object.keys(out).sort(), [
      'inferenceGatewayApiKey',
      'inferenceGatewayAuthScheme',
      'inferenceGatewayBaseUrl',
      'inferenceProvider',
    ]);
  });

  test('preserves inferenceModels, coworkEgressAllowedHosts, toolSearchEnabled and NEVER injects anthropicFamilyTier', () => {
    const existing = {
      inferenceModels: [{ name: 'claude/combo/extra' }],
      coworkEgressAllowedHosts: ['*'],
      toolSearchEnabled: true,
      telemetryDisabled: false,
      someRandomKey: 'kept',
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: 'https://gw/v1',
      apiKey: 'k',
    });

    // Existing fields preserved verbatim.
    assert.deepEqual(out.inferenceModels, [{ name: 'claude/combo/extra' }]);
    assert.deepEqual(out.coworkEgressAllowedHosts, ['*']);
    assert.equal(out.toolSearchEnabled, true);
    assert.equal(out.telemetryDisabled, false);
    assert.equal(out.someRandomKey, 'kept');

    // Critically: anthropicFamilyTier is NEVER injected anywhere,
    // neither at the top level nor inside any inferenceModels entry.
    assert.equal('anthropicFamilyTier' in out, false);
    for (const m of out.inferenceModels) {
      assert.equal('anthropicFamilyTier' in m, false);
    }

    // Gateway keys set.
    assert.equal(out.inferenceProvider, 'gateway');
    assert.equal(out.inferenceGatewayBaseUrl, 'https://gw/v1');
    assert.equal(out.inferenceGatewayApiKey, 'k');
    assert.equal(out.inferenceGatewayAuthScheme, 'bearer');
  });

  test('preserves existing gateway keys verbatim when wizard did not collect new ones (F4)', () => {
    const existing = {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://old.example/v1',
      inferenceGatewayApiKey: 'sk-old',
      inferenceGatewayAuthScheme: 'x-api-key',
      inferenceModels: [{ name: 'm1' }],
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: undefined,
      apiKey: undefined,
      authScheme: undefined,
    });
    assert.equal(out.inferenceProvider, 'gateway');
    assert.equal(out.inferenceGatewayBaseUrl, 'https://old.example/v1');
    assert.equal(out.inferenceGatewayApiKey, 'sk-old');
    assert.equal(out.inferenceGatewayAuthScheme, 'x-api-key');
    assert.deepEqual(out.inferenceModels, [{ name: 'm1' }]);
  });

  test('explicit wizard values overwrite existing gateway keys', () => {
    const existing = {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://old.example/v1',
      inferenceGatewayApiKey: 'sk-old',
      inferenceGatewayAuthScheme: 'x-api-key',
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: 'https://new.example/v1',
      apiKey: 'sk-new',
      authScheme: 'bearer',
    });
    assert.equal(out.inferenceGatewayBaseUrl, 'https://new.example/v1');
    assert.equal(out.inferenceGatewayApiKey, 'sk-new');
    assert.equal(out.inferenceGatewayAuthScheme, 'bearer');
    assert.equal(out.inferenceProvider, 'gateway');
  });

  test('preserves inferenceModels array verbatim with varied entries (no anthropicFamilyTier injected)', () => {
    const existing = {
      inferenceModels: [
        { name: 'claude-sonnet-5' },
        { name: 'MiniMax-M3' },
        { name: 'haiku-4' },
      ],
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: 'https://gw/v1',
      apiKey: 'k',
    });
    // Byte-for-byte preservation of the array.
    assert.deepEqual(out.inferenceModels, existing.inferenceModels);
    // Strict reference equality proves no copy/mutation.
    assert.equal(out.inferenceModels, existing.inferenceModels);
    // No anthropicFamilyTier anywhere.
    for (const m of out.inferenceModels) {
      assert.equal('anthropicFamilyTier' in m, false);
    }
  });

  test('explicit authScheme from wizard overwrites existing x-api-key', () => {
    const out = mergeGatewayIntoDesktopConfig({
      existing: { inferenceGatewayAuthScheme: 'x-api-key' },
      baseUrl: 'https://gw/v1',
      apiKey: 'k',
      authScheme: 'bearer',
    });
    assert.equal(out.inferenceGatewayAuthScheme, 'bearer');
  });

  test('default authScheme is bearer when existing config has none', () => {
    const out = mergeGatewayIntoDesktopConfig({
      existing: {},
      baseUrl: 'https://gw/v1',
      apiKey: 'k',
    });
    assert.equal(out.inferenceGatewayAuthScheme, 'bearer');
  });

  test('non-gateway fields are preserved even when gateway keys are being set', () => {
    const existing = {
      modelPrefer1mContext: true,
      // telemetry-shaped keys
      telemetryDisabled: false,
      someTelemetryKey: 'kept',
      // user data
      userOverrides: { theme: 'dark' },
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: 'https://gw/v1',
      apiKey: 'k',
    });
    assert.equal(out.modelPrefer1mContext, true);
    assert.equal(out.telemetryDisabled, false);
    assert.equal(out.someTelemetryKey, 'kept');
    assert.deepEqual(out.userOverrides, { theme: 'dark' });
  });

  test('returns a new object (does not mutate existing)', () => {
    const existing = {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://old.example/v1',
      inferenceGatewayApiKey: 'sk-old',
    };
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      baseUrl: 'https://new.example/v1',
      apiKey: 'sk-new',
    });
    assert.notEqual(out, existing);
    assert.equal(existing.inferenceGatewayBaseUrl, 'https://old.example/v1');
    assert.equal(existing.inferenceGatewayApiKey, 'sk-old');
    assert.equal(out.inferenceGatewayBaseUrl, 'https://new.example/v1');
    assert.equal(out.inferenceGatewayApiKey, 'sk-new');
  });

  test('partial wizard input preserves the unspecified gateway keys', () => {
    const existing = {
      inferenceGatewayBaseUrl: 'https://old.example/v1',
      inferenceGatewayApiKey: 'sk-old',
      inferenceGatewayAuthScheme: 'x-api-key',
    };
    // Only apiKey is being changed.
    const out = mergeGatewayIntoDesktopConfig({
      existing,
      apiKey: 'sk-new',
    });
    assert.equal(out.inferenceGatewayBaseUrl, 'https://old.example/v1');
    assert.equal(out.inferenceGatewayApiKey, 'sk-new');
    assert.equal(out.inferenceGatewayAuthScheme, 'x-api-key');
  });
});

// ─── readActiveDesktopConfig ─────────────────────────────────────────────────

describe('readActiveDesktopConfig()', () => {
  test('valid _meta.json + valid <id>.json: returns { activePath, config, exists: true }', () => {
    const root = join(sep, 'mem', 'rd-happy');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-abc',
      entries: [{ id: 'cfg-abc' }, { id: 'cfg-def' }],
    }));
    mem.addFile(join(lib, 'cfg-abc.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://gw.example/v1',
      inferenceGatewayApiKey: 'k',
    }));

    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.equal(result.exists, true);
    assert.equal(result.activePath, join(lib, 'cfg-abc.json'));
    assert.equal(result.config.inferenceProvider, 'gateway');
    assert.equal(result.config.inferenceGatewayBaseUrl, 'https://gw.example/v1');
  });

  test('missing _meta.json: returns { exists: false } (no throw)', () => {
    const root = join(sep, 'mem', 'rd-no-meta');
    const mem = makeMemFs();
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('malformed _meta.json: returns { exists: false } (no throw)', () => {
    const root = join(sep, 'mem', 'rd-bad-meta');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), '{this is not valid json');
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('_meta.json valid but appliedId not in entries[]: returns { exists: false }', () => {
    const root = join(sep, 'mem', 'rd-bad-pointer');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-missing',
      entries: [{ id: 'cfg-abc' }, { id: 'cfg-def' }],
    }));
    mem.addFile(join(lib, 'cfg-abc.json'), JSON.stringify({ inferenceProvider: 'gateway' }));
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('active <id>.json missing: returns { exists: false }', () => {
    const root = join(sep, 'mem', 'rd-active-missing');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-abc',
      entries: [{ id: 'cfg-abc' }],
    }));
    // Note: no cfg-abc.json added.
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('active config malformed JSON: returns { exists: false }', () => {
    const root = join(sep, 'mem', 'rd-active-bad');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-abc',
      entries: [{ id: 'cfg-abc' }],
    }));
    mem.addFile(join(lib, 'cfg-abc.json'), '{ not json');
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('active config is an array (not object): returns { exists: false }', () => {
    const root = join(sep, 'mem', 'rd-active-array');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-abc',
      entries: [{ id: 'cfg-abc' }],
    }));
    mem.addFile(join(lib, 'cfg-abc.json'), JSON.stringify([1, 2, 3]));
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });

  test('_meta.json missing appliedId: returns { exists: false }', () => {
    const root = join(sep, 'mem', 'rd-meta-no-applied');
    const lib = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({ entries: [{ id: 'cfg-abc' }] }));
    mem.addFile(join(lib, 'cfg-abc.json'), JSON.stringify({ x: 1 }));
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, { exists: false });
  });
});

// ─── backupActiveDesktopConfig ───────────────────────────────────────────────

describe('backupActiveDesktopConfig()', () => {
  test('existing file: backup file written with same content; path matches <id>.json.bak-<now>', () => {
    const mem = makeMemFs();
    const path = join(sep, 'mem', 'bak', 'live.json');
    mem.addFile(path, JSON.stringify({ hello: 'world' }));
    const now = 1700000000000;

    const backupPath = backupActiveDesktopConfig({ path, fs: mem, now });
    assert.equal(backupPath, `${path}.bak-${now}`);
    // The write was recorded; the contents match the original.
    const w = mem.lastWrite(backupPath);
    assert.ok(w, 'expected a write to the backup path');
    assert.equal(w.contents, JSON.stringify({ hello: 'world' }));
  });

  test('missing source file: throws a clear error', () => {
    const mem = makeMemFs();
    const path = join(sep, 'mem', 'bak-missing', 'live.json');
    assert.throws(
      () => backupActiveDesktopConfig({ path, fs: mem, now: 1 }),
      /ENOENT/,
    );
  });

  test('empty path string: throws path is required', () => {
    assert.throws(
      () => backupActiveDesktopConfig({ path: '', fs: makeMemFs(), now: 1 }),
      /path is required/,
    );
    assert.throws(
      () => backupActiveDesktopConfig({ fs: makeMemFs(), now: 1 }),
      /path is required/,
    );
  });

  test('uses Date.now() default when `now` is omitted', () => {
    const mem = makeMemFs();
    const path = join(sep, 'mem', 'bak-default-now', 'live.json');
    mem.addFile(path, '{}');
    const before = Date.now();
    const backupPath = backupActiveDesktopConfig({ path, fs: mem });
    const after = Date.now();
    assert.match(backupPath, /\.bak-\d+$/);
    const ts = Number(backupPath.split('.bak-').pop());
    assert.ok(ts >= before && ts <= after, `expected timestamp in [${before}, ${after}], got ${ts}`);
  });
});

// ─── detectManagedOverride ───────────────────────────────────────────────────

describe('detectManagedOverride()', () => {
  test('linux: returns true when managed-settings.json exists with valid JSON', () => {
    withPlatform('linux', () => {
      // We can't actually write to /etc/claude-desktop/, so we stub
      // fs.existsSync + readFileSync for the specific path.
      const stubs = (p) => p === '/etc/claude-desktop/managed-settings.json';
      const mem = {
        existsSync: (p) => stubs(p) || false,
        readFileSync: (p) => {
          if (!stubs(p)) {
            const err = new Error(`ENOENT`);
            err.code = 'ENOENT';
            throw err;
          }
          return JSON.stringify({ policy: 'managed' });
        },
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), true);
    });
  });

  test('linux: returns false when file is missing', () => {
    withPlatform('linux', () => {
      const mem = { existsSync: () => false, readFileSync: () => '' };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
    });
  });

  test('linux: returns false when file is empty', () => {
    withPlatform('linux', () => {
      const mem = {
        existsSync: () => true,
        readFileSync: () => '',
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
    });
  });

  test('linux: returns false when file is whitespace-only', () => {
    withPlatform('linux', () => {
      const mem = {
        existsSync: () => true,
        readFileSync: () => '   \n  \t  ',
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
    });
  });

  test('linux: returns false when file is malformed JSON', () => {
    withPlatform('linux', () => {
      const mem = {
        existsSync: () => true,
        readFileSync: () => '{ broken',
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
    });
  });

  test('linux: returns false when existsSync reports true but readFileSync throws (race / EACCES)', () => {
    withPlatform('linux', () => {
      const mem = {
        existsSync: () => true,
        readFileSync: () => {
          const err = new Error(`EACCES: permission denied`);
          err.code = 'EACCES';
          throw err;
        },
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
    });
  });

  test('darwin: probes /Library/Application Support/Claude-3p/managed-settings.json', () => {
    withPlatform('darwin', () => {
      const expected = '/Library/Application Support/Claude-3p/managed-settings.json';
      let probed = null;
      const mem = {
        existsSync: (p) => { probed = p; return true; },
        readFileSync: (p) => {
          if (p !== expected) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return '{}';
        },
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), true);
      assert.equal(probed, expected);
    });
  });

  test('win32: probes %PROGRAMDATA%/Claude-3p/managed-settings.json', () => {
    withPlatform('win32', () => {
      const env = { PROGRAMDATA: 'C:/ProgramData' };
      const expected = 'C:/ProgramData/Claude-3p/managed-settings.json';
      let probed = null;
      const mem = {
        existsSync: (p) => { probed = p; return true; },
        readFileSync: (p) => {
          if (p !== expected) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return '{}';
        },
      };
      assert.equal(detectManagedOverride({ env, fs: mem }), true);
      assert.equal(probed, expected);
    });
  });

  test('win32: falls back to $HOME/AppData/Local when PROGRAMDATA is unset', () => {
    withPlatform('win32', () => {
      const env = { HOME: 'C:/Users/alice', PROGRAMDATA: '   ' };
      const expected = 'C:/Users/alice/AppData/Local/Claude-3p/managed-settings.json';
      let probed = null;
      const mem = {
        existsSync: (p) => { probed = p; return true; },
        readFileSync: (p) => {
          if (p !== expected) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return '{}';
        },
      };
      assert.equal(detectManagedOverride({ env, fs: mem }), true);
      assert.equal(probed, expected);
    });
  });

  test('unknown platforms fall through to linux path', () => {
    withPlatform('freebsd', () => {
      const expected = '/etc/claude-desktop/managed-settings.json';
      let probed = null;
      const mem = {
        existsSync: (p) => { probed = p; return false; },
        readFileSync: () => '',
      };
      assert.equal(detectManagedOverride({ env: {}, fs: mem }), false);
      assert.equal(probed, expected);
    });
  });
});

// ─── writeDesktopConfigWithBackup ────────────────────────────────────────────

describe('writeDesktopConfigWithBackup()', () => {
  const path = join(sep, 'mem', 'wrb', 'live.json');

  test('happy path: writes new config, verifies roundtrip, returns backup path', () => {
    const mem = makeMemFs();
    mem.addFile(path, JSON.stringify({ oldKey: 'oldValue' }));
    const next = {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://gw/v1',
      inferenceGatewayApiKey: 'k-new',
    };

    const result = writeDesktopConfigWithBackup({ path, next, fs: mem, now: 1700000000000 });
    assert.equal(result.ok, true);
    assert.equal(result.backupPath, `${path}.bak-1700000000000`);

    // Backup written FIRST, then the new file.
    const writes = mem.writes.filter((w) => w.path === path || w.path === result.backupPath);
    assert.ok(writes.length >= 2, 'expected at least two writes (backup + main)');
    assert.equal(writes[0].path, result.backupPath, 'backup must be written first');

    // New file contents match `next`.
    const mainWrite = writes.filter((w) => w.path === path).pop();
    assert.deepEqual(JSON.parse(mainWrite.contents), next);

    // Backup contents match the original.
    const backupWrite = writes.filter((w) => w.path === result.backupPath)[0];
    assert.equal(backupWrite.contents, JSON.stringify({ oldKey: 'oldValue' }));
  });

  test('happy path: existing never-touch keys round-trip through the backup and survive in the new file', () => {
    const mem = makeMemFs();
    const original = {
      inferenceModels: [{ name: 'claude/combo/extra' }],
      coworkEgressAllowedHosts: ['*'],
      toolSearchEnabled: true,
      telemetryDisabled: false,
      inferenceGatewayBaseUrl: 'https://old/v1',
      inferenceGatewayApiKey: 'sk-old',
      inferenceGatewayAuthScheme: 'x-api-key',
    };
    mem.addFile(path, JSON.stringify(original));
    const next = mergeGatewayIntoDesktopConfig({
      existing: original,
      baseUrl: 'https://new/v1',
      apiKey: 'sk-new',
      authScheme: 'bearer',
    });

    const result = writeDesktopConfigWithBackup({ path, next, fs: mem, now: 42 });
    assert.equal(result.ok, true);

    const mainWrite = mem.lastWrite(path);
    const written = JSON.parse(mainWrite.contents);
    assert.equal(written.inferenceGatewayBaseUrl, 'https://new/v1');
    assert.equal(written.inferenceGatewayApiKey, 'sk-new');
    assert.equal(written.inferenceGatewayAuthScheme, 'bearer');
    // Never-touch keys preserved.
    assert.deepEqual(written.inferenceModels, [{ name: 'claude/combo/extra' }]);
    assert.deepEqual(written.coworkEgressAllowedHosts, ['*']);
    assert.equal(written.toolSearchEnabled, true);
    assert.equal(written.telemetryDisabled, false);
  });

  test('write produces truncated/corrupt JSON: helper throws AND rolls back from backup', () => {
    const mem = makeMemFs();
    mem.addFile(path, JSON.stringify({ original: 'yes' }));

    // Override writeFileSync: the FIRST call (writing the new config)
    // records the broken bytes; everything else is a deep-copy of the
    // existing memfs surface so the rollback succeeds.
    const realWrite = mem.writeFileSync;
    let writeCount = 0;
    mem.writeFileSync = (p, contents, encoding) => {
      writeCount += 1;
      if (writeCount === 1) {
        // First write = write to backup (fine).
        return realWrite(p, contents, encoding);
      }
      if (writeCount === 2) {
        // Second write = write to the main path. Record broken bytes.
        mem.__brokenMain = true;
        return realWrite(p, '{ this is truncated', encoding);
      }
      // Subsequent writes (rollback): use the real deep-copy semantics.
      return realWrite(p, contents, encoding);
    };
    // The verification readFileSync must return the truncated bytes so
    // JSON.parse throws.
    const realRead = mem.readFileSync;
    mem.readFileSync = (p, enc) => {
      if (mem.__brokenMain && p === path) {
        return '{ this is truncated';
      }
      return realRead(p, enc);
    };

    assert.throws(
      () => writeDesktopConfigWithBackup({
        path,
        next: { inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw/v1', inferenceGatewayApiKey: 'k' },
        fs: mem,
        now: 99,
      }),
      /rolled back from .*\.bak-99/,
    );

    // Rollback should have written the original content back.
    const finalWrite = mem.lastWrite(path);
    assert.equal(finalWrite.contents, JSON.stringify({ original: 'yes' }));
  });

  test('backup read fails: helper throws a chained error mentioning both write and rollback', () => {
    const mem = makeMemFs();
    mem.addFile(path, JSON.stringify({ x: 1 }));

    const realWrite = mem.writeFileSync;
    const realRead = mem.readFileSync;
    mem.readFileSync = (p, enc) => {
      // Reading the backup fails (simulate ENOENT on the backup file
      // AFTER it was supposed to be written).
      if (typeof p === 'string' && p.endsWith('.bak-7')) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return realRead(p, enc);
    };
    // Force the post-write verify path to also fail, so the helper
    // enters its catch and tries to read the backup (which throws).
    mem.writeFileSync = (p, contents, encoding) => {
      if (p === path) {
        // Write the new content, but make the verify read throw.
        realWrite(p, contents, encoding);
        mem.__forceVerifyFail = true;
        return;
      }
      return realWrite(p, contents, encoding);
    };
    // First writeFileSync on path succeeded; override readFileSync so
    // verify throws. Then rollback tries to read the backup.
    mem.readFileSync = (p, enc) => {
      if (mem.__forceVerifyFail && p === path) {
        mem.__forceVerifyFail = false;
        const err = new Error('simulated verify failure');
        throw err;
      }
      if (typeof p === 'string' && p.endsWith('.bak-7')) {
        const err = new Error(`ENOENT: backup gone`);
        err.code = 'ENOENT';
        throw err;
      }
      return realRead(p, enc);
    };

    assert.throws(
      () => writeDesktopConfigWithBackup({
        path,
        next: { inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw/v1', inferenceGatewayApiKey: 'k' },
        fs: mem,
        now: 7,
      }),
      /write failed AND rollback failed.*simulated verify failure.*rollback: ENOENT: backup gone/s,
    );
  });

  test('roundtrip mismatch: write succeeds but spot-check fails (helper throws + rollback)', () => {
    const mem = makeMemFs();
    const originalSerialized = JSON.stringify({ original: 'yes' });
    mem.addFile(path, originalSerialized);

    // writeFileSync writes the new bytes; readFileSync then returns a
    // mutated copy that omits the new gateway keys. We override the
    // main-path read ONLY for the verify step (after the backup has
    // already been written), so the rollback restores the true
    // original bytes.
    const realWrite = mem.writeFileSync;
    const realRead = mem.readFileSync;
    mem.writeFileSync = (p, c, e) => realWrite(p, c, e);

    let verifyStarted = false;
    mem.readFileSync = (p, enc) => {
      const raw = realRead(p, enc);
      if (p === path && verifyStarted) {
        // Pretend an external process overwrote the file between
        // writeFileSync and the verify readFileSync.
        return JSON.stringify({ original: 'yes', stale: true });
      }
      if (p === path && !verifyStarted) {
        // Mark the verify phase as starting AFTER we've returned the
        // original for the backup-copy read. The helper's
        // backupActiveDesktopConfig reads the main path once.
        verifyStarted = true;
      }
      return raw;
    };

    assert.throws(
      () => writeDesktopConfigWithBackup({
        path,
        next: { inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw/v1', inferenceGatewayApiKey: 'k' },
        fs: mem,
        now: 12345,
      }),
      /rolled back from .*\.bak-12345.*roundtrip mismatch/s,
    );

    // Original content is back in place (the rollback wrote the
    // backup's bytes -- which were copied BEFORE the mock started
    // returning stale data).
    const finalWrite = mem.lastWrite(path);
    assert.equal(finalWrite.contents, originalSerialized);
  });

  test('missing path: throws path is required', () => {
    assert.throws(
      () => writeDesktopConfigWithBackup({ path: '', next: {}, fs: makeMemFs(), now: 1 }),
      /path is required/,
    );
    assert.throws(
      () => writeDesktopConfigWithBackup({ next: {}, fs: makeMemFs(), now: 1 }),
      /path is required/,
    );
  });

  test('non-object next: throws', () => {
    const mem = makeMemFs();
    assert.throws(
      () => writeDesktopConfigWithBackup({ path, next: 'string', fs: mem, now: 1 }),
      /next must be a plain object/,
    );
    assert.throws(
      () => writeDesktopConfigWithBackup({ path, next: [1, 2, 3], fs: mem, now: 1 }),
      /next must be a plain object/,
    );
  });
});

// ─── real-filesystem integration smoke ───────────────────────────────────────

describe('desktop-config: real filesystem integration', () => {
  let scratch;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bizar-desktop-config-'));
  });
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('end-to-end: read -> merge -> write with backup -> read-back', () => {
    const lib = join(scratch, '.config', 'Claude-3p', 'configLibrary');
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'live',
      entries: [{ id: 'live' }],
    }));
    const original = {
      inferenceModels: [{ name: 'MiniMax-M3' }],
      inferenceGatewayBaseUrl: 'https://old/v1',
      inferenceGatewayApiKey: 'sk-old',
      inferenceGatewayAuthScheme: 'x-api-key',
    };
    writeFileSync(join(lib, 'live.json'), JSON.stringify(original));

    // Read.
    const read = readActiveDesktopConfig({ env: { HOME: scratch } });
    assert.equal(read.exists, true);
    assert.equal(read.config.inferenceGatewayApiKey, 'sk-old');

    // Merge.
    const next = mergeGatewayIntoDesktopConfig({
      existing: read.config,
      baseUrl: 'https://new/v1',
      apiKey: 'sk-new',
      authScheme: 'bearer',
    });

    // Write + backup.
    const result = writeDesktopConfigWithBackup({ path: read.activePath, next, now: 555 });
    assert.equal(result.ok, true);

    // Backup file is on disk next to the original.
    const backupPath = `${read.activePath}.bak-555`;
    // The write happened via real fs; re-read through readActiveDesktopConfig
    // and the roundtrip is verified.
    const reread = readActiveDesktopConfig({ env: { HOME: scratch } });
    assert.equal(reread.config.inferenceGatewayBaseUrl, 'https://new/v1');
    assert.equal(reread.config.inferenceGatewayApiKey, 'sk-new');
    assert.equal(reread.config.inferenceGatewayAuthScheme, 'bearer');
    assert.deepEqual(reread.config.inferenceModels, [{ name: 'MiniMax-M3' }]);
    // Backup path string should be consistent with the helper.
    assert.equal(backupPath, result.backupPath);
  });
});

console.log('  desktop-config.test.mjs loaded');
