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
  // Prevent an operator's shell environment from leaking into test isolation.
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
];

function runProductionWriter({ existing, force = false, env = {}, router } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bizar-settings-merge-'));
  const claudeDir = join(home, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  mkdirSync(claudeDir, { recursive: true });
  if (existing) writeFileSync(settingsPath, `${JSON.stringify(existing)}\n`);
  // Router lives under CLAUDE_CONFIG_DIR (~/.claude/model-router.json) — the single
  // canonical location that both the CLI and Claude Code hooks agree on.
  if (router) {
    const routerPath = join(claudeDir, 'model-router.json');
    writeFileSync(routerPath, `${JSON.stringify(router)}\n`);
  }

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
  it('production writer is provider-agnostic and omits gateway keys when no env is set', () => {
    const settings = runProductionWriter();
    assert.equal(settings.env.BIZAR_HOME.endsWith('/.config/bizar'), true);
    // Bizar ships no default provider. The writer MUST NOT auto-inject
    // ANTHROPIC_BASE_URL, BIZAR_MODEL_ROUTER_URL, or ANTHROPIC_AUTH_TOKEN.
    // Operators configure those via their shell environment if they want
    // a non-default gateway.
    assert.equal(
      settings.env.ANTHROPIC_BASE_URL,
      undefined,
      'no default gateway URL — operators MUST configure ANTHROPIC_BASE_URL',
    );
    assert.equal(
      settings.env.BIZAR_MODEL_ROUTER_URL,
      undefined,
      'no default router URL — operators MUST configure BIZAR_MODEL_ROUTER_URL',
    );
    assert.equal(
      settings.env.ANTHROPIC_AUTH_TOKEN,
      undefined,
      'no default auth token — operators MUST configure ANTHROPIC_AUTH_TOKEN',
    );
    // Gateway discovery stays absent when no gateway or custom configured
    // models exist. The writer enables it only for that concrete setup.
    assert.equal(
      settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
      undefined,
      'gateway discovery must stay absent without a configured gateway',
    );
    assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  });

  it('selected model metadata configures Claude Code context-window enforcement', () => {
    const settings = runProductionWriter({
      router: {
        disabledProviders: [],
        userSelected: {
          models: ['provider/long-context'],
          profiles: { 'provider/long-context': { limits: { contextTokens: 1048576 } } },
        },
        tiers: {},
      },
    });
    assert.equal(settings.model, 'provider/long-context');
    assert.equal(settings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '1048576');
  });

  it('normal updates preserve user values and omit gateway keys that were never set', () => {
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
    // When the operator has configured a gateway URL via ANTHROPIC_BASE_URL,
    // the writer mirrors it to BIZAR_MODEL_ROUTER_URL so downstream routers
    // see a consistent gateway. The writer does NOT auto-inject either key
    // when no operator URL is configured — see the
    // "provider-agnostic and omits gateway keys" test above.
    assert.equal(
      settings.env.BIZAR_MODEL_ROUTER_URL,
      'https://gateway.example/v1',
      'router URL mirrors ANTHROPIC_BASE_URL when the operator has configured a gateway',
    );
    // ANTHROPIC_AUTH_TOKEN was never set in `existing.env` so the writer
    // MUST NOT auto-inject one.
    assert.equal(
      settings.env.ANTHROPIC_AUTH_TOKEN,
      undefined,
      'no default auth token leaked into the writer output',
    );
    assert.equal(
      settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
      undefined,
      'production writer must not auto-add the gateway discovery env',
    );
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
        },
      },
    });
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://gateway.example/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://models.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'user-token');
  });

  it('fresh installs use explicit gateway environment and align both URLs', () => {
    const settings = runProductionWriter({
      env: {
        ANTHROPIC_BASE_URL: 'https://router.example/v1',
        ANTHROPIC_AUTH_TOKEN: 'ambient-token',
      },
    });
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://router.example/v1');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://router.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'ambient-token');
    // Operator env var is preserved when explicitly passed via process.env.
    assert.equal(
      settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
      undefined,
      'gateway discovery env is operator-controlled and not auto-emitted',
    );
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
