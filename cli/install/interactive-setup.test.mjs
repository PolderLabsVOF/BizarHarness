import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  detectAdvancedConfiguration,
  detectProviderConfiguration,
  isValidOpenKanHome,
  isValidProviderUrl,
  providerSettingsPath,
  runInteractiveSetup,
} from './interactive-setup.mjs';

function terminal() {
  let text = '';
  return {
    input: { isTTY: true },
    output: { isTTY: true, write(chunk) { text += String(chunk); } },
    read: () => text,
  };
}

describe('interactive installer provider setup', () => {
  test('detects URL and key across environment and global settings', () => {
    assert.deepEqual(detectProviderConfiguration({
      env: { ANTHROPIC_BASE_URL: 'https://env.example/v1' },
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'settings-secret' } },
    }), {
      url: 'https://env.example/v1',
      key: 'settings-secret',
      missing: [],
    });
  });

  test('uses HOME for the global settings path', () => {
    assert.equal(providerSettingsPath({ HOME: '/tmp/operator' }), '/tmp/operator/.claude/settings.json');
    assert.equal(providerSettingsPath({ HOME: '/tmp/operator', CLAUDE_CONFIG_DIR: '/tmp/claude' }), '/tmp/claude/settings.json');
  });

  test('validates provider URLs', () => {
    assert.equal(isValidProviderUrl('https://gateway.example/v1'), true);
    assert.equal(isValidProviderUrl('http://localhost:3000/v1'), true);
    assert.equal(isValidProviderUrl('gateway.example/v1'), false);
    assert.equal(isValidProviderUrl('file:///tmp/provider'), false);
  });

  test('detects optional model and agent-team settings without exposing secrets', () => {
    assert.deepEqual(detectAdvancedConfiguration({
      env: { ANTHROPIC_MODEL: 'claude-sonnet', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
      settings: {},
    }), { model: 'claude-sonnet', teams: '1' });
  });

  test('collects fresh-install defaults for model, teams, OpenKan home, and project init', async () => {
    const io = terminal();
    const home = mkdtempSync(join(tmpdir(), 'bizar-interactive-openkan-'));
    const cwd = join(home, 'project');
    const env = { HOME: home };
    const textAnswers = [
      'yes',
      'https://gateway.example/v1',
      'claude-sonnet',
      'no',
      '~/.local/share/bizar-openkan',
      'yes',
    ];
    try {
      const result = await runInteractiveSetup({
        env,
        cwd,
        input: io.input,
        output: io.output,
        readSettings: () => ({}),
        askText: async () => textAnswers.shift(),
        askHidden: async () => 'top-secret-value',
      });
      assert.equal(result.ok, true);
      assert.equal(result.model, 'claude-sonnet');
      assert.equal(result.agentTeams, false);
      assert.equal(result.openkanHome, join(home, '.local/share/bizar-openkan'));
      assert.equal(result.initializeOpenKanProject, true);
      assert.equal(env.ANTHROPIC_MODEL, 'claude-sonnet');
      assert.equal(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '0');
      assert.equal(env.BIZAR_OPENKAN_HOME, result.openkanHome);
      assert.equal(isValidOpenKanHome(result.openkanHome), true);
      assert.doesNotMatch(io.read(), /top-secret-value/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('prompts only for missing values and never prints the key', async () => {
    const io = terminal();
    const env = { HOME: '/tmp/operator' };
    const textAnswers = ['yes', 'not-a-url', 'https://gateway.example/v1/'];
    let hiddenCalls = 0;
    const result = await runInteractiveSetup({
      env,
      input: io.input,
      output: io.output,
      readSettings: () => ({}),
      askText: async () => textAnswers.shift(),
      askHidden: async () => { hiddenCalls += 1; return 'top-secret-value'; },
    });

    assert.equal(result.ok, true);
    assert.equal(result.configured, true);
    assert.equal(hiddenCalls, 1);
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://gateway.example/v1');
    // The legacy BIZAR_MODEL_ROUTER_URL mirror is no longer projected
    // into the install environment.
    assert.equal(env.BIZAR_MODEL_ROUTER_URL, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'top-secret-value');
    assert.match(io.read(), /valid http:\/\/ or https:\/\/ URL/);
    assert.doesNotMatch(io.read(), /top-secret-value/);
  });

  test('does not prompt when provider values are already detected', async () => {
    const io = terminal();
    let textCalls = 0;
    let hiddenCalls = 0;
    const env = { ANTHROPIC_BASE_URL: 'https://gateway.example/v1', ANTHROPIC_AUTH_TOKEN: 'secret' };
    const result = await runInteractiveSetup({
      env,
      input: io.input,
      output: io.output,
      readSettings: () => ({}),
      askText: async () => { textCalls += 1; return 'yes'; },
      askHidden: async () => { hiddenCalls += 1; return 'unused'; },
    });

    assert.equal(result.configured, true);
    assert.equal(textCalls, 1, 'only the install confirmation is asked');
    assert.equal(hiddenCalls, 0);
    assert.match(io.read(), /Provider URL detected/);
    assert.match(io.read(), /Provider key detected \(hidden\)/);
    assert.doesNotMatch(io.read(), /secret/);
  });

  test('cancel exits before provider prompts or environment mutation', async () => {
    const io = terminal();
    const env = {};
    let hiddenCalls = 0;
    const result = await runInteractiveSetup({
      env,
      input: io.input,
      output: io.output,
      readSettings: () => ({}),
      askText: async () => 'no',
      askHidden: async () => { hiddenCalls += 1; return 'unused'; },
    });
    assert.equal(result.cancelled, true);
    assert.equal(hiddenCalls, 0);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  });

  test('non-interactive mode never prompts and explains missing configuration', async () => {
    const io = terminal();
    let calls = 0;
    const result = await runInteractiveSetup({
      env: {},
      input: io.input,
      output: io.output,
      enabled: false,
      readSettings: () => ({}),
      askText: async () => { calls += 1; return 'yes'; },
      askHidden: async () => { calls += 1; return 'secret'; },
    });
    assert.equal(result.interactive, false);
    assert.deepEqual(result.missing, ['url', 'key']);
    assert.equal(calls, 0);
    assert.match(io.read(), /bizar setup-provider/);
  });

  test('non-interactive mode emits a grep-friendly provider-config warning', async () => {
    const io = terminal();
    await runInteractiveSetup({
      env: {},
      input: io.input,
      output: io.output,
      enabled: false,
      readSettings: () => ({}),
      askText: async () => '',
      askHidden: async () => '',
    });
    const text = io.read();
    assert.match(text, /\[BIZAR_PROVIDER_CONFIG_MISSING\]/);
    assert.match(text, /Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN/);
  });

  test('prompted values reach the global provisioned settings file', () => {
    const home = mkdtempSync(join(tmpdir(), 'bizar-interactive-persist-'));
    const repo = resolve(import.meta.dirname, '../..');
    const childEnv = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      BIZAR_HOME: join(home, '.config', 'bizar'),
    };
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
      delete childEnv[key];
    }
    const script = `
      import { runInteractiveSetup } from './cli/install/interactive-setup.mjs';
      const input = { isTTY: true };
      const output = { isTTY: true, write() {} };
      const answers = ['yes', 'https://gateway.example/v1'];
      const result = await runInteractiveSetup({
        input,
        output,
        readSettings: () => ({}),
        askText: async () => answers.shift(),
        askHidden: async () => 'test-provider-token',
      });
      if (!result.ok) process.exit(2);
      const { writeClaudeSettings } = await import('./cli/provision.mjs');
      const write = writeClaudeSettings({ force: true });
      if (!write.ok) process.exit(3);
    `;
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: repo,
        env: childEnv,
        encoding: 'utf8',
      });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
      assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://gateway.example/v1');
      // Legacy BIZAR_MODEL_ROUTER_URL is no longer mirrored into settings.
      assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, undefined);
      assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'test-provider-token');
      assert.doesNotMatch(child.stdout, /test-provider-token/);
      assert.doesNotMatch(child.stderr, /test-provider-token/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
