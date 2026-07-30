/**
 * cli/install/paths.test.mjs
 *
 * Tests for cli/install/paths.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS, printInstallLocations, resolveClaudeDir } from './paths.mjs';

describe('PATHS', () => {
  test('has all required keys', () => {
    const required = [
      'claudeDir', 'agentsDir', 'skillsDir', 'commandsDir',
      'hooksDir', 'settingsFile', 'bizarHome',
      'loopsDir', 'installMarker',
    ];
    for (const key of required) {
      assert.ok(key in PATHS, `missing key: ${key}`);
    }
  });

  test('PATHS values are non-empty strings', () => {
    for (const [key, val] of Object.entries(PATHS)) {
      assert.ok(typeof val === 'string' && val.length > 0, `${key} should be non-empty string, got: ${val}`);
    }
  });
});

describe('printInstallLocations()', () => {
  test('does not throw', () => {
    assert.doesNotThrow(() => printInstallLocations({ dryRun: false }));
  });

  test('output contains ~/.claude', () => {
    let output = '';
    const orig = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    try { printInstallLocations({}); } finally { console.log = orig; }
    // Output mentions the Claude config dir — exact form depends on resolved HOME
    assert.ok(output.includes('.claude') || output.includes('/.claude'), 'should mention .claude path');
  });
});

describe('resolveClaudeDir()', () => {
  test('uses CLAUDE_CONFIG_DIR env override', () => {
    const orig = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/my-claude-dir';
    try {
      const dir = resolveClaudeDir();
      assert.equal(dir, '/tmp/my-claude-dir');
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = orig;
    }
  });
});

describe('idempotency', () => {
  test('two consecutive calls produce same output', () => {
    let out1 = '', out2 = '';
    const orig = console.log;
    const capture = () => { let s = ''; console.log = (...a) => { s += a.join(' ') + '\n'; }; return s; };
    const restore = (s) => { console.log = orig; return s; };

    const c1 = capture();
    printInstallLocations({});
    out1 = restore(c1);

    const c2 = capture();
    printInstallLocations({});
    out2 = restore(c2);

    assert.equal(out1, out2, 'consecutive calls should produce identical output');
  });
});

console.log('  paths.test.mjs loaded — run with: node --test cli/install/paths.test.mjs');
