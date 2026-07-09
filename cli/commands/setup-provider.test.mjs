/**
 * cli/commands/setup-provider.test.mjs
 *
 * v6.2.3 — Unit tests for the setup-provider subcommand.
 *
 * v6.2.3 changed the storage backend from `~/.cline/cline.json` to
 * `~/.cline/data/settings/providers.json` (the file the Cline CLI
 * and kanban mode actually read). The default providerId changed
 * from `9router` to `litellm` (a real entry in Cline's catalog).
 *
 * Exercises the pure helpers (`buildProviderBlock`, `parseFlags`,
 * `OPENAI_COMPATIBLE_PROVIDERS`) and the filesystem mutations
 * (`applyProviderBlock`, `removeProvider`) with a mocked CLINE_DIR.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  buildProviderBlock,
  applyProviderBlock,
  removeProvider,
  listGatewayModels,
  parseFlags,
  OPENAI_COMPATIBLE_PROVIDERS,
} = await import('./setup-provider.mjs');

const ORIG_CLINE_DIR = process.env.CLINE_DIR;
const ORIG_DATA_DIR = process.env.CLINE_DATA_DIR;
const ORIG_PROVIDER_PATH = process.env.CLINE_PROVIDER_SETTINGS_PATH;
let workDir;

function freshWorkDir() {
  workDir = mkdtempSync(join(tmpdir(), 'bizar-setup-provider-'));
  // CLINE_DIR is the *base* dir (e.g. ~/.cline). The settings file
  // lives at `${CLINE_DIR}/data/settings/providers.json`. Mocking
  // CLINE_DIR is the easiest way to redirect the whole tree.
  process.env.CLINE_DIR = workDir;
  // Clear overrides that could change the resolution path.
  delete process.env.CLINE_DATA_DIR;
  delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
  return workDir;
}

function settingsFile() {
  return join(workDir, 'data', 'settings', 'providers.json');
}

function makeFakeSettings(root, body = {}) {
  const cfg = {
    version: 1,
    providers: {},
    lastUsedProvider: 'litellm',
    ...body,
  };
  const file = join(root, 'data', 'settings', 'providers.json');
  mkdirSync(join(root, 'data', 'settings'), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

beforeEach(() => {
  workDir = freshWorkDir();
});

afterEach(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  if (ORIG_CLINE_DIR === undefined) delete process.env.CLINE_DIR;
  else process.env.CLINE_DIR = ORIG_CLINE_DIR;
  if (ORIG_DATA_DIR === undefined) delete process.env.CLINE_DATA_DIR;
  else process.env.CLINE_DATA_DIR = ORIG_DATA_DIR;
  if (ORIG_PROVIDER_PATH === undefined) delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
  else process.env.CLINE_PROVIDER_SETTINGS_PATH = ORIG_PROVIDER_PATH;
});

describe('OPENAI_COMPATIBLE_PROVIDERS', () => {
  test('includes litellm (the new v6.2.3 default)', () => {
    assert.ok(OPENAI_COMPATIBLE_PROVIDERS.includes('litellm'),
      'litellm must be the canonical openai-compatible providerId');
  });
  test('does NOT include the fake "openai-compatible" or "9router" IDs', () => {
    assert.equal(OPENAI_COMPATIBLE_PROVIDERS.includes('openai-compatible'), false,
      'openai-compatible is a family, not a valid providerId');
    assert.equal(OPENAI_COMPATIBLE_PROVIDERS.includes('9router'), false,
      '9router is not a built-in Cline providerId (would fail in kanban)');
  });
});

describe('buildProviderBlock()', () => {
  test('emits a Cline-settings-shaped block (version 1 + settings + updatedAt)', () => {
    const block = buildProviderBlock({
      name: 'litellm',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      model: 'minimaxcustom/MiniMax-M3',
    });
    assert.ok(block.settings);
    assert.equal(block.settings.provider, 'litellm');
    assert.equal(block.settings.model, 'minimaxcustom/MiniMax-M3');
    assert.equal(block.settings.apiKey, 'sk-test');
    assert.equal(block.settings.baseUrl, 'http://localhost:20128/v1');
    assert.ok(block.settings.reasoning);
    assert.equal(block.settings.reasoning.enabled, false);
    assert.ok(block.updatedAt);
    assert.match(block.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(block.tokenSource, 'manual');
  });

  test('wraps env-var-style keys in ${env:...}', () => {
    const block = buildProviderBlock({
      name: 'litellm',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'NINEROUTER_KEY',
      model: 'm1',
    });
    assert.equal(block.settings.apiKey, '${env:NINEROUTER_KEY}');
  });

  test('sets reasoning.enabled=true when reason=true', () => {
    const block = buildProviderBlock({
      name: 'litellm', gateway: 'http://x', apiKey: 'k', model: 'm', reason: true,
    });
    assert.equal(block.settings.reasoning.enabled, true);
  });
});

describe('applyProviderBlock()', () => {
  test('writes to ${CLINE_DIR}/data/settings/providers.json (NOT ~/.cline/cline.json)', () => {
    const body = buildProviderBlock({
      name: 'litellm', gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test', model: 'minimaxcustom/MiniMax-M3',
    });
    const r = applyProviderBlock('litellm', body);
    const expected = settingsFile();
    assert.equal(r.path, expected, 'must write to the Cline settings file');
    assert.ok(existsSync(expected));
  });

  test('bootstraps the settings file when it does not exist', () => {
    // No makeFakeSettings call.
    const body = buildProviderBlock({
      name: 'litellm', gateway: 'http://x', apiKey: 'k', model: 'm',
    });
    const r = applyProviderBlock('litellm', body);
    assert.ok(existsSync(r.path));
    const cfg = JSON.parse(readFileSync(r.path, 'utf8'));
    assert.equal(cfg.version, 1);
    assert.equal(cfg.lastUsedProvider, 'litellm');
    assert.ok(cfg.providers.litellm);
  });

  test('preserves other provider entries when adding a new one', () => {
    makeFakeSettings(workDir, {
      providers: { ollama: { settings: { provider: 'ollama', model: 'llama3' } } },
    });
    const body = buildProviderBlock({
      name: 'litellm', gateway: 'http://x', apiKey: 'k', model: 'm',
    });
    applyProviderBlock('litellm', body);
    const cfg = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    assert.ok(cfg.providers.ollama, 'existing provider preserved');
    assert.ok(cfg.providers.litellm, 'new provider added');
  });

  test('overwrites an existing provider with the same name', () => {
    makeFakeSettings(workDir, {
      providers: { litellm: { settings: { provider: 'litellm', baseUrl: 'https://old', model: 'old' } } },
    });
    const body = buildProviderBlock({
      name: 'litellm', gateway: 'http://new', apiKey: 'new', model: 'new',
    });
    applyProviderBlock('litellm', body);
    const cfg = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    assert.equal(cfg.providers.litellm.settings.baseUrl, 'http://new');
    assert.equal(cfg.providers.litellm.settings.model, 'new');
  });

  test('creates a backup file', () => {
    makeFakeSettings(workDir, {
      providers: { x: { settings: { provider: 'x' } } },
    });
    const body = buildProviderBlock({
      name: 'litellm', gateway: 'http://x', apiKey: 'k', model: 'm',
    });
    const r = applyProviderBlock('litellm', body);
    assert.ok(existsSync(r.backup), 'backup file created');
    const backup = JSON.parse(readFileSync(r.backup, 'utf8'));
    assert.ok(backup.providers.x, 'backup contains original entry');
  });
});

describe('migrateLegacyOpenaiCompatible()', async () => {
  const { migrateLegacyOpenaiCompatible } = await import('./setup-provider.mjs');

  test('renames an openai-compatible entry to litellm (preserving baseUrl/apiKey/model)', () => {
    makeFakeSettings(workDir, {
      providers: {
        'openai-compatible': {
          settings: {
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:20128/v1',
            apiKey: 'sk-test',
            model: 'minimaxcustom/MiniMax-M3',
            reasoning: { enabled: false, effort: 'medium' },
          },
          updatedAt: '2026-07-09T21:20:00.000Z',
          tokenSource: 'manual',
        },
      },
      lastUsedProvider: 'openai-compatible',
    });
    const r = migrateLegacyOpenaiCompatible('litellm');
    assert.equal(r.migrated, true);
    assert.equal(r.from, 'openai-compatible');
    assert.equal(r.to, 'litellm');
    const cfg = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    assert.equal(cfg.providers['openai-compatible'], undefined, 'old key removed');
    assert.ok(cfg.providers.litellm, 'new key added');
    assert.equal(cfg.providers.litellm.settings.baseUrl, 'http://localhost:20128/v1', 'baseUrl preserved');
    assert.equal(cfg.providers.litellm.settings.apiKey, 'sk-test', 'apiKey preserved');
    assert.equal(cfg.providers.litellm.settings.model, 'minimaxcustom/MiniMax-M3', 'model preserved');
    assert.equal(cfg.lastUsedProvider, 'litellm', 'active provider switched');
  });

  test('no-op when no legacy entry exists', () => {
    makeFakeSettings(workDir, {
      providers: { litellm: { settings: { provider: 'litellm' } } },
    });
    const r = migrateLegacyOpenaiCompatible('litellm');
    assert.equal(r.migrated, false);
    assert.equal(r.reason, 'no legacy entry');
  });

  test('no-op when settings file missing', () => {
    // No makeFakeSettings call
    const r = migrateLegacyOpenaiCompatible('litellm');
    assert.equal(r.migrated, false);
    assert.equal(r.reason, 'no settings file');
  });

  test('preserves lastUsedProvider when it pointed at a different entry', () => {
    makeFakeSettings(workDir, {
      providers: {
        'openai-compatible': { settings: { provider: 'openai-compatible', baseUrl: 'http://a' } },
        ollama: { settings: { provider: 'ollama' } },
      },
      lastUsedProvider: 'ollama',
    });
    migrateLegacyOpenaiCompatible('litellm');
    const cfg = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    // Should NOT clobber the active provider if it wasn't the broken one
    assert.equal(cfg.lastUsedProvider, 'ollama', 'active ollama preserved');
  });
});

describe('removeProvider()', () => {
  test('removes a named provider', () => {
    makeFakeSettings(workDir, {
      providers: {
        a: { settings: { provider: 'a' } },
        b: { settings: { provider: 'b' } },
      },
    });
    const r = removeProvider('a');
    assert.equal(r.removed, true);
    const cfg = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    assert.equal(cfg.providers.a, undefined);
    assert.ok(cfg.providers.b, 'untouched provider preserved');
  });

  test('returns removed=false when settings file is missing', () => {
    const r = removeProvider('nope');
    assert.equal(r.removed, false);
    assert.equal(r.reason, 'no settings file');
  });

  test('returns removed=false for a missing provider', () => {
    makeFakeSettings(workDir);
    const r = removeProvider('nonexistent');
    assert.equal(r.removed, false);
    assert.equal(r.reason, 'not present');
  });
});

describe('parseFlags()', () => {
  test('parses --gateway, --key, --provider, --model with space separator', () => {
    const f = parseFlags(['--gateway', 'http://x', '--key', 'sk-x', '--provider', 'litellm', '--model', 'm1']);
    assert.equal(f.gateway, 'http://x');
    assert.equal(f.key, 'sk-x');
    assert.equal(f.provider, 'litellm');
    assert.equal(f.model, 'm1');
  });

  test('parses equals form', () => {
    const f = parseFlags(['--gateway=http://x', '--key=sk-x', '--provider=litellm', '--model=m1']);
    assert.equal(f.gateway, 'http://x');
    assert.equal(f.key, 'sk-x');
    assert.equal(f.provider, 'litellm');
    assert.equal(f.model, 'm1');
  });

  test('parses --list, --discover, --remove', () => {
    const f = parseFlags(['--list', '--discover']);
    assert.equal(f.list, true);
    assert.equal(f.discover, true);
    const g = parseFlags(['--remove', 'myprov']);
    assert.equal(g.remove, 'myprov');
  });
});
