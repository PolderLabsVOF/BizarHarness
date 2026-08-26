import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const GATEWAY_KEYS = [
  'ANTHROPIC_BASE_URL',
  'BIZAR_MODEL_ROUTER_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
];

function runProductionWriter({ existing, force = false, env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bizar-settings-merge-'));
  const claudeDir = join(home, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  mkdirSync(claudeDir, { recursive: true });
  if (existing) writeFileSync(settingsPath, `${JSON.stringify(existing)}\n`);

  const childEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: claudeDir,
    BIZAR_HOME: join(home, '.config', 'bizar'),
  };
  for (const key of GATEWAY_KEYS) delete childEnv[key];
  Object.assign(childEnv, env);

  try {
    const script = `
      import { writeClaudeSettings } from './cli/provision.mjs';
      const result = writeClaudeSettings({ force: ${JSON.stringify(force)} });
      if (!result.ok) throw new Error(result.message);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(readFileSync(settingsPath, 'utf8'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('writeClaudeSettings gateway environment', () => {
  it('production writer emits the complete project gateway contract', () => {
    const settings = runProductionWriter();
    assert.equal(settings.env.BIZAR_HOME.endsWith('/.config/bizar'), true);
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://localhost:20129/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'http://localhost:20129/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router');
    assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  });

  it('normal updates preserve user values and align missing gateway keys', () => {
    const existing = {
      env: {
        MY_CUSTOM_VAR: 'kept',
        BIZAR_HOME: '/custom/bizar',
        ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/custom-opus',
      },
      permissions: { defaultMode: 'ask', allow: ['Bash(ls)'] },
      mcpServers: { custom: { type: 'stdio', command: 'custom-mcp' } },
    };
    const settings = runProductionWriter({ existing });
    assert.equal(settings.env.MY_CUSTOM_VAR, 'kept');
    assert.equal(settings.env.BIZAR_HOME, '/custom/bizar');
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://gateway.example/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://gateway.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router');
    assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'anthropic/custom-opus');
    assert.equal(settings.permissions.defaultMode, 'ask');
    assert.equal(settings.mcpServers.custom.command, 'custom-mcp');
  });

  it('normal updates retain explicitly configured gateway values', () => {
    const settings = runProductionWriter({
      existing: {
        env: {
          ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
          BIZAR_MODEL_ROUTER_URL: 'https://models.example/v1',
          ANTHROPIC_AUTH_TOKEN: 'user-token',
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '0',
        },
      },
    });
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://gateway.example/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://models.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'user-token');
    assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '0');
  });

  it('fresh installs use explicit gateway environment and keep URLs aligned', () => {
    const settings = runProductionWriter({
      env: {
        ANTHROPIC_BASE_URL: 'https://router.example/v1',
        ANTHROPIC_AUTH_TOKEN: 'ambient-token',
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: 'enabled',
      },
    });
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://router.example/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://router.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'ambient-token');
    assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, 'enabled');
  });

  it('force refreshes managed keys without deleting unrelated user env', () => {
    const settings = runProductionWriter({
      force: true,
      existing: { env: { MY_CUSTOM_VAR: 'kept', ANTHROPIC_AUTH_TOKEN: 'old-token' } },
      env: { ANTHROPIC_AUTH_TOKEN: 'replacement-token' },
    });
    assert.equal(settings.env.MY_CUSTOM_VAR, 'kept');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'replacement-token');
  });
});
