/**
 * cli/install/detect.test.mjs
 *
 * Tests for cli/install/detect.mjs and the `resolveDesktopConfigLibrary`
 * helper added to cli/config-paths.mjs.
 *
 * Coverage targets ≥90% on detect.mjs. Tests use `node:test` to match
 * the project-wide convention (scripts/run-node-tests.mjs runs every
 * `*.test.mjs` under `cli/` through `node --test`).
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
  commandOnPath,
  detectInstalledAgents,
  findActiveDesktopConfigPath,
  readActiveDesktopConfig,
  readClaudeCodeSettingsPath,
} from './detect.mjs';
import { resolveDesktopConfigLibrary } from '../config-paths.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal in-memory filesystem surface for the detect layer.
 * Returns an object with `existsSync`, `readFileSync`, `addFile`, and
 * `addDir`. Missing files yield the same ENOENT semantics as Node's fs
 * (existsSync → false, readFileSync → throw with `code = 'ENOENT'`).
 *
 * The detect layer only ever calls `existsSync` and `readFileSync`, so
 * no real directory I/O is simulated — just path-presence tracking.
 */
function makeMemFs() {
  const files = new Map();
  const dirs = new Set();
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
  function addFile(p, contents) {
    files.set(p, contents);
    // Auto-track parent directories so `existsSync(<parent>)` is true
    // even when only nested files were written.
    let parent = p;
    while (true) {
      const idx = parent.lastIndexOf(sep);
      if (idx <= 0) break;
      parent = parent.slice(0, idx);
      dirs.add(parent);
    }
  }
  function addDir(p) {
    dirs.add(p);
  }
  return { existsSync, readFileSync, addFile, addDir };
}

// ─── commandOnPath ───────────────────────────────────────────────────────────

describe('commandOnPath()', () => {
  test('returns null when the underlying spawn fails', () => {
    // command `-v definitely-not-a-binary-xyz123` exits non-zero.
    const result = commandOnPath('definitely-not-a-binary-xyz123');
    assert.equal(result, null);
  });

  test('returns the resolved path when the command exists (covers Buffer stdout branch)', () => {
    // `node` is guaranteed on PATH for the test runner; this exercises
    // the Buffer-to-string branch in commandOnPath.
    const result = commandOnPath('node');
    assert.ok(typeof result === 'string' && result.length > 0, `expected path, got ${result}`);
    assert.match(result, /node/);
  });

  test('returns null when spawnSync returns status 0 with empty stdout', () => {
    // Covers the `trimmed.length > 0 === false` branch.
    const fakeSpawn = () => ({ status: 0, stdout: Buffer.from('') });
    assert.equal(commandOnPath('whatever', { spawnSync: fakeSpawn }), null);
  });

  test('handles spawnSync returning a string stdout', () => {
    // Covers the `typeof result.stdout === 'string'` true branch.
    const fakeSpawn = () => ({ status: 0, stdout: '/usr/local/bin/whatever' });
    assert.equal(commandOnPath('whatever', { spawnSync: fakeSpawn }), '/usr/local/bin/whatever');
  });

  test('handles spawnSync returning null stdout with status 0', () => {
    // Covers the `result.stdout ? ... : ''` false branch.
    const fakeSpawn = () => ({ status: 0, stdout: null });
    assert.equal(commandOnPath('whatever', { spawnSync: fakeSpawn }), null);
  });
});

// ─── readClaudeCodeSettingsPath ──────────────────────────────────────────────

describe('readClaudeCodeSettingsPath()', () => {
  test('honors CLAUDE_CONFIG_DIR override', () => {
    assert.equal(
      readClaudeCodeSettingsPath({ env: { CLAUDE_CONFIG_DIR: '/opt/cc', HOME: '/home/x' } }),
      join('/opt/cc', 'settings.json'),
    );
  });

  test('falls back to $HOME/.claude/settings.json', () => {
    assert.equal(
      readClaudeCodeSettingsPath({ env: { HOME: '/home/x' } }),
      '/home/x/.claude/settings.json',
    );
  });
});

// ─── findActiveDesktopConfigPath ─────────────────────────────────────────────

describe('findActiveDesktopConfigPath()', () => {
  test('returns the resolved <appliedId>.json pointer', () => {
    const root = join(sep, 'mem', 'desktop-happy');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-abc',
      entries: [{ id: 'cfg-abc', origin: 'user' }, { id: 'cfg-def', origin: 'org' }],
    }));
    mem.addFile(join(configLibrary, 'cfg-abc.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://gw.example/v1',
      inferenceGatewayApiKey: 'sk-test',
    }));

    const active = findActiveDesktopConfigPath({
      env: { HOME: root },
      fs: mem,
    });
    assert.equal(active, join(configLibrary, 'cfg-abc.json'));
  });

  test('returns null when the configLibrary directory is missing', () => {
    const root = join(sep, 'mem', 'desktop-no-library');
    const mem = makeMemFs();
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when _meta.json is missing', () => {
    const root = join(sep, 'mem', 'desktop-no-meta');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    // create a stray file so the directory exists, but skip _meta.json
    mem.addFile(join(configLibrary, 'some-old-config.json'), '{}');
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when _meta.json is malformed JSON', () => {
    const root = join(sep, 'mem', 'desktop-bad-meta');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), '{ this is not json }');
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when appliedId is missing from entries[]', () => {
    const root = join(sep, 'mem', 'desktop-stale-pointer');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-does-not-exist',
      entries: [{ id: 'cfg-1' }, { id: 'cfg-2' }],
    }));
    mem.addFile(join(configLibrary, 'cfg-1.json'), '{}');
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when the active <appliedId>.json file is missing', () => {
    const root = join(sep, 'mem', 'desktop-missing-active');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-ghost',
      entries: [{ id: 'cfg-ghost' }],
    }));
    // no cfg-ghost.json written
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when _meta.json has no appliedId key', () => {
    const root = join(sep, 'mem', 'desktop-no-applied');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      entries: [{ id: 'cfg-1' }],
    }));
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });

  test('returns null when entries[] is not an array', () => {
    const root = join(sep, 'mem', 'desktop-entries-not-array');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-1',
      entries: { id: 'cfg-1' },
    }));
    const active = findActiveDesktopConfigPath({ env: { HOME: root }, fs: mem });
    assert.equal(active, null);
  });
});

// ─── readActiveDesktopConfig ────────────────────────────────────────────────

describe('readActiveDesktopConfig()', () => {
  test('returns parsed object on happy path', () => {
    const root = join(sep, 'mem', 'desktop-read-happy');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-1',
      entries: [{ id: 'cfg-1' }],
    }));
    mem.addFile(join(configLibrary, 'cfg-1.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://gw',
      inferenceGatewayApiKey: 'k',
    }));
    const result = readActiveDesktopConfig({ env: { HOME: root }, fs: mem });
    assert.deepEqual(result, {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://gw',
      inferenceGatewayApiKey: 'k',
    });
  });

  test('returns null when active config JSON is malformed', () => {
    const root = join(sep, 'mem', 'desktop-read-bad');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-1',
      entries: [{ id: 'cfg-1' }],
    }));
    mem.addFile(join(configLibrary, 'cfg-1.json'), '{ broken');
    assert.equal(readActiveDesktopConfig({ env: { HOME: root }, fs: mem }), null);
  });

  test('returns null when active config is a JSON array', () => {
    const root = join(sep, 'mem', 'desktop-read-array');
    const configLibrary = join(root, '.config', 'Claude-3p', 'configLibrary');
    const mem = makeMemFs();
    mem.addFile(join(configLibrary, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-1',
      entries: [{ id: 'cfg-1' }],
    }));
    mem.addFile(join(configLibrary, 'cfg-1.json'), '[]');
    assert.equal(readActiveDesktopConfig({ env: { HOME: root }, fs: mem }), null);
  });
});

// ─── detectInstalledAgents: Claude Code CLI branch ───────────────────────────

describe('detectInstalledAgents() — Claude Code CLI', () => {
  test('marks present + records binPath when commandOnPath finds claude', () => {
    const home = join(sep, 'mem', 'cc-cli-present');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => '/usr/local/bin/claude',
    });
    assert.equal(result.claudeCode.present, true);
    assert.equal(result.claudeCode.binPath, '/usr/local/bin/claude');
  });

  test('falls back to settings.json presence when CLI is not on PATH', () => {
    const home = join(sep, 'mem', 'cc-cli-missing');
    const mem = makeMemFs();
    mem.addFile(join(home, '.claude', 'settings.json'), '{}');
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.present, true);
    assert.equal(result.claudeCode.binPath, null);
  });

  test('marks absent when neither CLI nor settings.json exists', () => {
    const home = join(sep, 'mem', 'cc-cli-absent');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.present, false);
    assert.equal(result.claudeCode.binPath, null);
  });
});

// ─── detectInstalledAgents: Claude Code gateway configured ───────────────────

describe('detectInstalledAgents() — Claude Code gatewayConfigured', () => {
  test('reports true when settings.json sets ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN', () => {
    const home = join(sep, 'mem', 'cc-gw-on');
    const mem = makeMemFs();
    mem.addFile(join(home, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://gw.example/v1',
        ANTHROPIC_AUTH_TOKEN: 'sk-test',
      },
    }));
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.gatewayConfigured, true);
  });

  test('reports true when env vars alone supply url + key', () => {
    const home = join(sep, 'mem', 'cc-gw-env');
    const mem = makeMemFs();
    mem.addFile(join(home, '.claude', 'settings.json'), '{}');
    const result = detectInstalledAgents({
      env: {
        HOME: home,
        ANTHROPIC_BASE_URL: 'https://gw.example/v1',
        ANTHROPIC_AUTH_TOKEN: 'sk-env',
      },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.gatewayConfigured, true);
  });

  test('reports false when settings.json is missing', () => {
    const home = join(sep, 'mem', 'cc-gw-no-settings');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.gatewayConfigured, false);
  });

  test('reports false when settings.json is malformed', () => {
    const home = join(sep, 'mem', 'cc-gw-bad-settings');
    const mem = makeMemFs();
    mem.addFile(join(home, '.claude', 'settings.json'), '{');
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.gatewayConfigured, false);
    assert.equal(result.claudeCode.present, true);
  });

  test('reports false when only url is set (no key)', () => {
    const home = join(sep, 'mem', 'cc-gw-url-only');
    const mem = makeMemFs();
    mem.addFile(join(home, '.claude', 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://gw.example/v1' },
    }));
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.claudeCode.gatewayConfigured, false);
  });
});

// ─── detectInstalledAgents: Claude Desktop branch ────────────────────────────

describe('detectInstalledAgents() — Claude Desktop', () => {
  test('reports present + activeConfigId + gatewayConfigured when gateway trio present', () => {
    const home = join(sep, 'mem', 'dt-present-gw');
    const mem = makeMemFs();
    const lib = join(home, '.config', 'Claude-3p', 'configLibrary');
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-active',
      entries: [{ id: 'cfg-active' }],
    }));
    mem.addFile(join(lib, 'cfg-active.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://dt-gw.example/v1',
      inferenceGatewayApiKey: 'dt-key',
    }));

    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.present, true);
    assert.equal(result.desktop.activeConfigId, 'cfg-active');
    assert.equal(result.desktop.activeConfigPath, join(lib, 'cfg-active.json'));
    assert.equal(result.desktop.gatewayConfigured, true);
  });

  test('reports gatewayConfigured=false when provider is not gateway', () => {
    const home = join(sep, 'mem', 'dt-anthropic-direct');
    const mem = makeMemFs();
    const lib = join(home, '.config', 'Claude-3p', 'configLibrary');
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-active',
      entries: [{ id: 'cfg-active' }],
    }));
    mem.addFile(join(lib, 'cfg-active.json'), JSON.stringify({
      inferenceProvider: 'anthropic',
    }));
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.present, true);
    assert.equal(result.desktop.gatewayConfigured, false);
  });

  test('reports gatewayConfigured=false when baseUrl is empty string', () => {
    const home = join(sep, 'mem', 'dt-empty-baseurl');
    const mem = makeMemFs();
    const lib = join(home, '.config', 'Claude-3p', 'configLibrary');
    mem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-active',
      entries: [{ id: 'cfg-active' }],
    }));
    mem.addFile(join(lib, 'cfg-active.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: '   ',
      inferenceGatewayApiKey: 'k',
    }));
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.present, true);
    assert.equal(result.desktop.gatewayConfigured, false);
  });

  test('reports present=false when configLibrary is missing entirely', () => {
    const home = join(sep, 'mem', 'dt-missing-library');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.present, false);
    assert.equal(result.desktop.activeConfigId, null);
    assert.equal(result.desktop.activeConfigPath, null);
  });

  test('exposes the resolved configLibraryPath for the current platform', () => {
    const home = join(sep, 'mem', 'dt-configlibrary-path');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.configLibraryPath, resolveDesktopConfigLibrary({ env: { HOME: home } }));
  });

  test('falls back to activeConfigId=null when _meta.json re-read throws', () => {
    const home = join(sep, 'mem', 'dt-meta-reread-fail');
    const lib = join(home, '.config', 'Claude-3p', 'configLibrary');
    const baseMem = makeMemFs();
    baseMem.addFile(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'cfg-active',
      entries: [{ id: 'cfg-active' }],
    }));
    baseMem.addFile(join(lib, 'cfg-active.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://x',
      inferenceGatewayApiKey: 'k',
    }));
    let metaReads = 0;
    const faultyFs = {
      existsSync: baseMem.existsSync,
      readFileSync: (p, enc) => {
        if (p.endsWith('_meta.json')) {
          metaReads += 1;
          // first read (inside findActiveDesktopConfigPath) succeeds;
          // second read (inside detectInstalledAgents) throws.
          if (metaReads === 1) return baseMem.readFileSync(p, enc);
          const err = new Error(`EACCES: permission denied, open '${p}'`);
          err.code = 'EACCES';
          throw err;
        }
        return baseMem.readFileSync(p, enc);
      },
    };
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: faultyFs,
      commandOnPath: () => null,
    });
    assert.equal(result.desktop.present, true);
    assert.equal(result.desktop.activeConfigId, null);
  });
});

// ─── detectInstalledAgents: OpenKan branch ───────────────────────────────────

describe('detectInstalledAgents() — OpenKan', () => {
  test('marks present when the resolved OpenKan home exists', () => {
    const home = join(sep, 'mem', 'openkan-present');
    const openkanHome = join(home, '.config', 'bizar', 'openkan');
    const mem = makeMemFs();
    mem.addFile(join(openkanHome, '.keep'), '');
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.openkan.present, true);
    assert.equal(result.openkan.home, openkanHome);
  });

  test('marks absent when the resolved OpenKan home is missing', () => {
    const home = join(sep, 'mem', 'openkan-absent');
    const mem = makeMemFs();
    const result = detectInstalledAgents({
      env: { HOME: home },
      fs: mem,
      commandOnPath: () => null,
    });
    assert.equal(result.openkan.present, false);
  });
});

// ─── resolveDesktopConfigLibrary: platform branches ────────────────────────

/**
 * The spec mandates `process.platform` as the OS source, so we save &
 * restore the actual value via defineProperty. This is the only test in
 * the suite that touches process globals, and it cleans up in finally.
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

describe('resolveDesktopConfigLibrary()', () => {
  test('darwin: $HOME/Library/Application Support/Claude-3p/configLibrary', () => {
    withPlatform('darwin', () => {
      const p = resolveDesktopConfigLibrary({ env: { HOME: '/Users/alice' }, cwd: '/Users/alice/proj' });
      assert.equal(p, join('/Users/alice', 'Library', 'Application Support', 'Claude-3p', 'configLibrary'));
    });
  });

  test('win32: %LOCALAPPDATA%\\Claude-3p\\configLibrary', () => {
    withPlatform('win32', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: 'C:/Users/alice', LOCALAPPDATA: 'C:/Users/alice/AppData/Local' },
        cwd: 'C:/Users/alice/proj',
      });
      assert.equal(p, join('C:/Users/alice/AppData/Local', 'Claude-3p', 'configLibrary'));
    });
  });

  test('win32: falls back to $HOME/AppData/Local when LOCALAPPDATA is empty', () => {
    withPlatform('win32', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: 'C:/Users/alice', LOCALAPPDATA: '   ' },
        cwd: 'C:/Users/alice/proj',
      });
      assert.equal(p, join('C:/Users/alice', 'AppData', 'Local', 'Claude-3p', 'configLibrary'));
    });
  });

  test('linux: $XDG_CONFIG_HOME when absolute', () => {
    withPlatform('linux', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: '/home/alice', XDG_CONFIG_HOME: '/srv/cfg' },
        cwd: '/home/alice/proj',
      });
      assert.equal(p, join('/srv/cfg', 'Claude-3p', 'configLibrary'));
    });
  });

  test('linux: $XDG_CONFIG_HOME resolved against cwd when relative', () => {
    withPlatform('linux', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: '/home/alice', XDG_CONFIG_HOME: 'relcfg' },
        cwd: '/home/alice/proj',
      });
      assert.equal(p, join('/home/alice/proj', 'relcfg', 'Claude-3p', 'configLibrary'));
    });
  });

  test('linux: default to $HOME/.config when XDG_CONFIG_HOME is unset', () => {
    withPlatform('linux', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: '/home/alice' },
        cwd: '/home/alice/proj',
      });
      assert.equal(p, join('/home/alice', '.config', 'Claude-3p', 'configLibrary'));
    });
  });

  test('linux: ignores whitespace-only XDG_CONFIG_HOME', () => {
    withPlatform('linux', () => {
      const p = resolveDesktopConfigLibrary({
        env: { HOME: '/home/alice', XDG_CONFIG_HOME: '   ' },
        cwd: '/home/alice/proj',
      });
      assert.equal(p, join('/home/alice', '.config', 'Claude-3p', 'configLibrary'));
    });
  });

  test('unknown platforms fall through to the linux branch', () => {
    withPlatform('freebsd', () => {
      const p = resolveDesktopConfigLibrary({ env: { HOME: '/home/alice' }, cwd: '/home/alice/proj' });
      assert.equal(p, join('/home/alice', '.config', 'Claude-3p', 'configLibrary'));
    });
  });
});

// ─── real-filesystem integration smoke (uses tmp dir) ────────────────────────

describe('detectInstalledAgents() — real filesystem smoke', () => {
  let scratch;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bizar-detect-'));
  });
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('end-to-end: empty home reports zero agents present', () => {
    const result = detectInstalledAgents({ env: { HOME: scratch }, commandOnPath: () => null });
    assert.equal(result.claudeCode.present, false);
    assert.equal(result.desktop.present, false);
    // openkan present is determined by resolveOpenKanHome which depends on
    // real BIZAR config — assert shape, not exact value
    assert.equal(typeof result.openkan.present, 'boolean');
    assert.equal(typeof result.openkan.home, 'string');
  });

  test('end-to-end: writes a Desktop configLibrary and reads it back', () => {
    const lib = join(scratch, '.config', 'Claude-3p', 'configLibrary');
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(lib, '_meta.json'), JSON.stringify({
      appliedId: 'live',
      entries: [{ id: 'live' }],
    }));
    writeFileSync(join(lib, 'live.json'), JSON.stringify({
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://live.example/v1',
      inferenceGatewayApiKey: 'live-key',
    }));

    const result = detectInstalledAgents({ env: { HOME: scratch }, commandOnPath: () => null });
    assert.equal(result.desktop.present, true);
    assert.equal(result.desktop.activeConfigId, 'live');
    assert.equal(result.desktop.gatewayConfigured, true);
  });
});

console.log('  detect.test.mjs loaded');
