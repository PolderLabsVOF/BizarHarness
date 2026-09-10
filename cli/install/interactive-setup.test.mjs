import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as shim from './interactive-setup.mjs';
import * as provider from './provider.mjs';

/**
 * Asserts the shim contract per plan §7 T2:
 *   `cli/install/interactive-setup.mjs` re-exports the provider-config
 *   helpers from `cli/install/provider.mjs` so existing imports keep
 *   resolving. After the clack wizard lands this shim will be retired
 *   in favour of a wizard re-export, but the helper bindings must
 *   remain identical until then.
 */
describe('cli/install/interactive-setup.mjs shim contract', () => {
  const expectedHelpers = [
    'providerSettingsPath',
    'readProviderSettings',
    'detectProviderConfiguration',
    'detectAdvancedConfiguration',
    'isValidProviderUrl',
    'isValidOpenKanHome',
    'askLine',
    'askSecret',
    'runInteractiveSetup',
  ];

  for (const name of expectedHelpers) {
    it(`re-exports ${name} as the same function reference`, () => {
      assert.equal(typeof shim[name], typeof provider[name]);
      assert.equal(shim[name], provider[name], `${name} must be the same reference as provider.mjs`);
    });
  }
});

describe('providerSettingsPath (env variations)', () => {
  it('prefers CLAUDE_CONFIG_DIR over HOME', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/claude', HOME: '/home/alice' };
    assert.equal(provider.providerSettingsPath(env), join('/custom/claude', 'settings.json'));
  });

  it('falls back to HOME/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    const env = { HOME: '/home/alice' };
    assert.equal(provider.providerSettingsPath(env), join('/home/alice', '.claude', 'settings.json'));
  });

  it('trims whitespace around CLAUDE_CONFIG_DIR and HOME', () => {
    const env = { CLAUDE_CONFIG_DIR: '  /custom/claude  ', HOME: '  /home/alice  ' };
    assert.equal(provider.providerSettingsPath(env), join('/custom/claude', 'settings.json'));
  });

  it('falls back to os.homedir() when both CLAUDE_CONFIG_DIR and HOME are unset', () => {
    const env = {};
    const path = provider.providerSettingsPath(env);
    // Must end with .claude/settings.json; the parent must be os.homedir().
    assert.ok(path.endsWith(join('.claude', 'settings.json')), `got ${path}`);
    assert.ok(path.startsWith(homedir()), `expected path to start with homedir(), got ${path}`);
  });
});

describe('readProviderSettings', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bizar-provider-settings-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty object when the file does not exist', () => {
    const missing = join(dir, 'settings.json');
    assert.deepEqual(provider.readProviderSettings(missing), {});
  });

  it('parses the file when it exists with valid JSON', () => {
    const path = join(dir, 'settings.json');
    const payload = { env: { ANTHROPIC_BASE_URL: 'https://gateway.example/v1' } };
    writeFileSync(path, JSON.stringify(payload));
    assert.deepEqual(provider.readProviderSettings(path), payload);
  });

  it('throws with a clear message when the file contains invalid JSON', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{not json');
    assert.throws(
      () => provider.readProviderSettings(path),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /JSON|SyntaxError|Unexpected/i);
        return true;
      },
    );
  });
});

describe('detectProviderConfiguration', () => {
  it('returns url + key from the live environment when both are set', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
      ANTHROPIC_AUTH_TOKEN: 'env-token',
    };
    assert.deepEqual(provider.detectProviderConfiguration({ env }), {
      url: 'https://gateway.example/v1',
      key: 'env-token',
      missing: [],
    });
  });

  it('falls back to ANTHROPIC_API_KEY when ANTHROPIC_AUTH_TOKEN is unset', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
      ANTHROPIC_API_KEY: 'fallback-token',
    };
    assert.deepEqual(provider.detectProviderConfiguration({ env }), {
      url: 'https://gateway.example/v1',
      key: 'fallback-token',
      missing: [],
    });
  });

  it('reads url + key from settings.env when the live environment is empty', () => {
    const settings = {
      env: {
        ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
        ANTHROPIC_AUTH_TOKEN: 'settings-token',
      },
    };
    assert.deepEqual(provider.detectProviderConfiguration({ env: {}, settings }), {
      url: 'https://gateway.example/v1',
      key: 'settings-token',
      missing: [],
    });
  });

  it('reports both url and key as missing when neither is configured', () => {
    assert.deepEqual(provider.detectProviderConfiguration({ env: {}, settings: {} }), {
      url: '',
      key: '',
      missing: ['url', 'key'],
    });
  });

  it('reports only key as missing when url is set in settings', () => {
    const settings = { env: { ANTHROPIC_BASE_URL: 'https://gateway.example/v1' } };
    assert.deepEqual(provider.detectProviderConfiguration({ env: {}, settings }), {
      url: 'https://gateway.example/v1',
      key: '',
      missing: ['key'],
    });
  });

  it('reports only url as missing when key is set in env', () => {
    const env = { ANTHROPIC_AUTH_TOKEN: 'env-token' };
    assert.deepEqual(provider.detectProviderConfiguration({ env }), {
      url: '',
      key: 'env-token',
      missing: ['url'],
    });
  });

  it('treats a non-object settings.env as no env entries', () => {
    assert.deepEqual(provider.detectProviderConfiguration({ env: {}, settings: { env: 'not-an-object' } }), {
      url: '',
      key: '',
      missing: ['url', 'key'],
    });
  });

  it('trims whitespace around url and key values', () => {
    const env = {
      ANTHROPIC_BASE_URL: '  https://gateway.example/v1  ',
      ANTHROPIC_AUTH_TOKEN: '  spaced-token  ',
    };
    const result = provider.detectProviderConfiguration({ env });
    assert.equal(result.url, 'https://gateway.example/v1');
    assert.equal(result.key, 'spaced-token');
  });
});

describe('detectAdvancedConfiguration', () => {
  it('returns empty strings when neither env nor settings expose the keys', () => {
    assert.deepEqual(provider.detectAdvancedConfiguration({ env: {}, settings: {} }), {
      model: '',
      teams: '',
    });
  });

  it('reads the model from env.ANTHROPIC_MODEL when set', () => {
    assert.deepEqual(
      provider.detectAdvancedConfiguration({ env: { ANTHROPIC_MODEL: 'haiku' }, settings: {} }),
      { model: 'haiku', teams: '' },
    );
  });

  it('reads the teams flag from settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', () => {
    const settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } };
    assert.deepEqual(
      provider.detectAdvancedConfiguration({ env: {}, settings }),
      { model: '', teams: '1' },
    );
  });

  it('trims whitespace on the model and teams values', () => {
    const env = { ANTHROPIC_MODEL: '  sonnet  ', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '  1  ' };
    assert.deepEqual(provider.detectAdvancedConfiguration({ env, settings: {} }), {
      model: 'sonnet',
      teams: '1',
    });
  });
});

describe('isValidProviderUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(provider.isValidProviderUrl('https://gateway.example/v1'), true);
    assert.equal(provider.isValidProviderUrl('http://localhost:8080/v1'), true);
  });

  it('rejects non-http(s) schemes', () => {
    assert.equal(provider.isValidProviderUrl('ftp://gateway.example'), false);
    assert.equal(provider.isValidProviderUrl('file:///etc/passwd'), false);
  });

  it('rejects unparseable input', () => {
    assert.equal(provider.isValidProviderUrl('not a url'), false);
    assert.equal(provider.isValidProviderUrl(''), false);
  });
});

describe('isValidOpenKanHome', () => {
  it('rejects empty strings', () => {
    assert.equal(provider.isValidOpenKanHome(''), false);
  });

  it('rejects paths that contain NUL bytes', () => {
    assert.equal(provider.isValidOpenKanHome('/home/alice/.config/openkan\0bogus'), false);
  });

  it('accepts ordinary paths', () => {
    assert.equal(provider.isValidOpenKanHome('/home/alice/.config/openkan'), true);
  });
});
