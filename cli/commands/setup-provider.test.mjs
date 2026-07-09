/**
 * cli/commands/setup-provider.test.mjs
 *
 * v6.2.2 — Unit tests for the setup-provider subcommand.
 *
 * Exercises the pure helpers (`buildProviderBlock`, `parseFlags`)
 * and the filesystem mutations (`applyProviderBlock`, `removeProvider`)
 * with a mocked CLINE_DIR.
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
} = await import('./setup-provider.mjs');

const ORIG_CLINE_DIR = process.env.CLINE_DIR;
let workDir;

function freshWorkDir() {
  workDir = mkdtempSync(join(tmpdir(), 'bizar-setup-provider-'));
  process.env.CLINE_DIR = workDir;
  return workDir;
}

function makeFakeClineJson(root, body = {}) {
  const cfg = {
    $schema: 'https://docs.cline.bot/config.json',
    plugin: [],
    default_agent: 'odin',
    permission: 'allow',
    snapshot: false,
    ...body,
  };
  writeFileSync(join(root, 'cline.json'), JSON.stringify(cfg, null, 2));
}

beforeEach(() => {
  workDir = freshWorkDir();
});

afterEach(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  if (ORIG_CLINE_DIR === undefined) delete process.env.CLINE_DIR;
  else process.env.CLINE_DIR = ORIG_CLINE_DIR;
});

describe('buildProviderBlock()', () => {
  test('emits a baseUrl, apiKey, and bare modelIds', () => {
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      models: ['minimax/MiniMax-M3', 'minimax/MiniMax-M2.7'],
    });
    assert.ok(block['9router']);
    assert.equal(block['9router'].baseUrl, 'http://localhost:20128/v1');
    assert.equal(block['9router'].apiKey, 'sk-test');
    assert.deepEqual(Object.keys(block['9router'].models), ['minimax/MiniMax-M3', 'minimax/MiniMax-M2.7']);
  });

  test('wraps env-var-style keys in ${env:...}', () => {
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'NINEROUTER_KEY',
      models: ['minimax/MiniMax-M3'],
    });
    assert.equal(block['9router'].apiKey, '${env:NINEROUTER_KEY}');
  });

  test('keeps literal keys as-is when not env-var shaped', () => {
    const block = buildProviderBlock({
      name: 'custom',
      gateway: 'https://x.example/v1',
      apiKey: 'sk-abc-123',
      models: ['m1'],
    });
    assert.equal(block['custom'].apiKey, 'sk-abc-123');
  });
});

describe('applyProviderBlock()', () => {
  test('writes a new provider to ~/.cline/cline.json', () => {
    makeFakeClineJson(workDir);
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      models: ['minimax/MiniMax-M3'],
    });
    const r = applyProviderBlock(block);
    assert.equal(r.name, '9router');
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    assert.ok(cfg.provider['9router']);
    assert.equal(cfg.provider['9router'].baseUrl, 'http://localhost:20128/v1');
  });

  test('preserves other provider entries when adding a new one', () => {
    makeFakeClineJson(workDir, {
      provider: { existing: { baseUrl: 'https://a', apiKey: 'k', models: { m: {} } } },
    });
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      models: ['minimax/MiniMax-M3'],
    });
    applyProviderBlock(block);
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    assert.ok(cfg.provider.existing, 'existing provider preserved');
    assert.ok(cfg.provider['9router'], 'new provider added');
  });

  test('overwrites an existing provider with the same name', () => {
    makeFakeClineJson(workDir, {
      provider: { '9router': { baseUrl: 'https://old', apiKey: 'old', models: {} } },
    });
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'new',
      models: ['minimax/MiniMax-M3'],
    });
    applyProviderBlock(block);
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    assert.equal(cfg.provider['9router'].baseUrl, 'http://localhost:20128/v1');
    assert.equal(cfg.provider['9router'].apiKey, 'new');
    assert.ok(cfg.provider['9router'].models['minimax/MiniMax-M3']);
  });

  test('throws when cline.json is missing', () => {
    // No makeFakeClineJson call
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      models: ['minimax/MiniMax-M3'],
    });
    assert.throws(() => applyProviderBlock(block), /not found/);
  });

  test('creates a backup file', () => {
    makeFakeClineJson(workDir, {
      plugin: [['./plugins/bizar', {}]],
    });
    const block = buildProviderBlock({
      name: '9router',
      gateway: 'http://localhost:20128/v1',
      apiKey: 'sk-test',
      models: ['minimax/MiniMax-M3'],
    });
    const r = applyProviderBlock(block);
    assert.ok(existsSync(r.backup), 'backup file created');
    const backup = JSON.parse(readFileSync(r.backup, 'utf8'));
    assert.deepEqual(backup.plugin, [['./plugins/bizar', {}]]);
  });
});

describe('removeProvider()', () => {
  test('removes a named provider', () => {
    makeFakeClineJson(workDir, {
      provider: {
        a: { baseUrl: 'https://a', apiKey: 'k', models: {} },
        b: { baseUrl: 'https://b', apiKey: 'k', models: {} },
      },
    });
    const r = removeProvider('a');
    assert.equal(r.removed, true);
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    assert.equal(cfg.provider.a, undefined);
    assert.ok(cfg.provider.b, 'untouched provider preserved');
  });

  test('returns removed=false for a missing provider', () => {
    makeFakeClineJson(workDir);
    const r = removeProvider('nonexistent');
    assert.equal(r.removed, false);
    assert.equal(r.reason, 'not present');
  });
});

describe('parseFlags()', () => {
  test('parses --gateway, --key, --provider with space separator', () => {
    const f = parseFlags(['--gateway', 'http://x', '--key', 'sk-x', '--provider', 'foo']);
    assert.equal(f.gateway, 'http://x');
    assert.equal(f.key, 'sk-x');
    assert.equal(f.provider, 'foo');
  });

  test('parses --gateway=, --key=, --provider= equals form', () => {
    const f = parseFlags(['--gateway=http://x', '--key=sk-x', '--provider=foo']);
    assert.equal(f.gateway, 'http://x');
    assert.equal(f.key, 'sk-x');
    assert.equal(f.provider, 'foo');
  });

  test('parses --list and --remove', () => {
    const f = parseFlags(['--list']);
    assert.equal(f.list, true);
    const g = parseFlags(['--remove', 'myprov']);
    assert.equal(g.remove, 'myprov');
  });
});
