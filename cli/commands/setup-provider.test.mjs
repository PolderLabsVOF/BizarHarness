import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProviderArgs,
  redact,
  runSetupProvider,
  updateProviderSettings,
} from './setup-provider.mjs';

const originalDir = process.env.CLAUDE_CONFIG_DIR;
let work;

afterEach(() => {
  if (originalDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalDir;
  if (work) rmSync(work, { recursive: true, force: true });
  work = undefined;
});

test('parses provider flags', () => {
  assert.deepEqual(parseProviderArgs(['--gateway', 'http://local/v1', '--model', 'model-a', '--remove-key']), {
    help: false,
    list: false,
    removeKey: true,
    gateway: 'http://local/v1',
    key: undefined,
    model: 'model-a',
  });
});

test('updates provider env without replacing unrelated settings', () => {
  const current = { permissions: { defaultMode: 'acceptEdits' }, env: { KEEP: 'yes' } };
  const next = updateProviderSettings(current, { gateway: 'http://local/v1', model: 'model-a', key: 'secret' });
  assert.equal(next.permissions.defaultMode, 'acceptEdits');
  assert.equal(next.env.KEEP, 'yes');
  assert.equal(next.env.ANTHROPIC_BASE_URL, 'http://local/v1');
  assert.equal(next.env.ANTHROPIC_MODEL, 'model-a');
  // Legacy BIZAR_MODEL_ROUTER_URL mirror is dropped on update — there is
  // no separate picker-routing URL anymore.
  assert.equal(next.env.BIZAR_MODEL_ROUTER_URL, undefined);
  assert.equal(next.env.ANTHROPIC_AUTH_TOKEN, 'secret');
});

test('redacts provider keys', () => {
  assert.equal(redact('sk-ant-1234567890'), 'sk-a…7890');
  assert.doesNotMatch(redact('sk-ant-1234567890'), /123456/);
});

test('provider listing falls back to Anthropic default when no URL is configured', async () => {
  work = mkdtempSync(join(tmpdir(), 'bizar-provider-'));
  process.env.CLAUDE_CONFIG_DIR = work;
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'settings.json'), JSON.stringify({ env: { BIZAR_MODEL_ROUTER_URL: 'https://router-only.example/v1' } }));
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => writes.push(args.join(' '));
  try {
    const result = await runSetupProvider(['--list']);
    assert.equal(result.ok, true);
  } finally {
    console.log = originalLog;
  }
  // After the picker removal, the legacy BIZAR_MODEL_ROUTER_URL is no
  // longer consulted as a gateway URL.
  assert.match(writes.join('\n'), /Anthropic default/);
});

test('writes Claude settings and preserves existing hooks', async () => {
  work = mkdtempSync(join(tmpdir(), 'bizar-provider-'));
  process.env.CLAUDE_CONFIG_DIR = work;
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }));

  const result = await runSetupProvider(['--gateway', 'http://localhost:20128/v1', '--model', 'cx/test']);
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(work, 'settings.json')));
  const settings = JSON.parse(readFileSync(join(work, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.hooks, { SessionStart: [] });
  assert.equal(settings.env.ANTHROPIC_MODEL, 'cx/test');
});

test('rejects invalid existing JSON without overwriting it', async () => {
  work = mkdtempSync(join(tmpdir(), 'bizar-provider-'));
  process.env.CLAUDE_CONFIG_DIR = work;
  writeFileSync(join(work, 'settings.json'), '{broken');
  const result = await runSetupProvider(['--model', 'cx/test']);
  assert.equal(result.ok, false);
  assert.equal(readFileSync(join(work, 'settings.json'), 'utf8'), '{broken');
});
