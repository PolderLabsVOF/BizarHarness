import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';
import {
  CODING_TOOLS,
  detectProviderConfiguration,
  isValidProviderUrl,
  parseToolSelectionKey,
  providerSettingsPath,
  runInteractiveSetup,
  runToolSelection,
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
    assert.equal(env.BIZAR_MODEL_ROUTER_URL, 'https://gateway.example/v1');
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

  test('prompted values reach the global provisioned settings file', () => {
    const home = mkdtempSync(join(tmpdir(), 'bizar-interactive-persist-'));
    const repo = resolve(import.meta.dirname, '../..');
    const childEnv = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      BIZAR_HOME: join(home, '.config', 'bizar'),
    };
    for (const key of ['ANTHROPIC_BASE_URL', 'BIZAR_MODEL_ROUTER_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
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
      assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://gateway.example/v1');
      assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'test-provider-token');
      assert.doesNotMatch(child.stdout, /test-provider-token/);
      assert.doesNotMatch(child.stderr, /test-provider-token/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('parseToolSelectionKey()', () => {
  test('maps Enter and LF to confirm', () => {
    assert.deepEqual(parseToolSelectionKey('\r'), { type: 'confirm' });
    assert.deepEqual(parseToolSelectionKey('\n'), { type: 'confirm' });
  });

  test('maps Space to toggle', () => {
    assert.deepEqual(parseToolSelectionKey(' '), { type: 'toggle' });
  });

  test('maps j/k and arrow keys to +/- cursor moves', () => {
    assert.deepEqual(parseToolSelectionKey('j'), { type: 'move', delta: +1 });
    assert.deepEqual(parseToolSelectionKey('k'), { type: 'move', delta: -1 });
    assert.deepEqual(parseToolSelectionKey('[B'), { type: 'move', delta: +1 });
    assert.deepEqual(parseToolSelectionKey('[A'), { type: 'move', delta: -1 });
  });

  test('rejects unrelated keys with null', () => {
    assert.equal(parseToolSelectionKey('a'), null);
    assert.equal(parseToolSelectionKey('z'), null);
    assert.equal(parseToolSelectionKey('?'), null);
  });
});

describe('CODING_TOOLS catalog', () => {
  test('exposes the two supported tools with stable ids', () => {
    const ids = CODING_TOOLS.map((t) => t.id);
    assert.deepEqual(ids, ['claude', 'codex']);
  });

  test('every entry has a non-empty label and description', () => {
    for (const t of CODING_TOOLS) {
      assert.ok(typeof t.label === 'string' && t.label.length > 0, `label missing for ${t.id}`);
      assert.ok(typeof t.description === 'string' && t.description.length > 0, `description missing for ${t.id}`);
    }
  });
});

describe('runToolSelection()', () => {
  function captureOutput() {
    const chunks = [];
    return {
      chunks,
      output: {
        isTTY: true,
        write(c) { chunks.push(String(c)); return true; },
      },
    };
  }

  /**
   * Build a Readable that emits the given keys as individual `data` events
   * one tick after subscription. We use `Readable.from` with a small async
   * generator so timing is deterministic across Node versions (PassThrough
   * occasionally swallows data when the consumer attaches `data` listeners
   * synchronously after the producer calls `write()`).
   */
  function scriptedInput(keys) {
    return Readable.from((async function* () {
      for (const k of keys) {
        await new Promise((r) => setImmediate(r));
        yield k;
      }
    })());
  }

  test('returns defaults (claude only) when not enabled', async () => {
    const result = await runToolSelection({ enabled: false, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude']);
    assert.equal(result.interactive, false);
  });

  test('returns defaults when input is not a TTY', async () => {
    const input = scriptedInput([]);
    const result = await runToolSelection({ enabled: true, input, output: captureOutput().output, isTTY: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude']);
    assert.equal(result.interactive, false);
  });

  test('Enter with no toggling confirms both default tools', async () => {
    const input = scriptedInput(['\r']);
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude', 'codex']);
    assert.equal(result.interactive, true);
  });

  test('Space toggles the focused row off; Enter confirms the remaining picks', async () => {
    const input = scriptedInput([' ', '\r']);
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['codex']);
  });

  test('Toggling every row off still yields at least Claude (defensive default)', async () => {
    const input = scriptedInput([' ', 'j', ' ', '\r']);
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude']);
  });

  test('Arrow keys move the cursor (smoke)', async () => {
    const input = scriptedInput(['[B', ' ', '\r']); // down to Codex, toggle off, confirm
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude']);
  });

  test('Unrelated keys are ignored; Enter still confirms the defaults', async () => {
    const input = scriptedInput(['a', '?', 'z', '\r']);
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude', 'codex']);
  });

  test('EOF on the input stream accepts defaults and is not a hard error', async () => {
    const input = scriptedInput([]);
    const { output } = captureOutput();
    const result = await runToolSelection({ enabled: true, input, output, isTTY: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ['claude']);
    assert.equal(result.cancelled, true);
  });
});
