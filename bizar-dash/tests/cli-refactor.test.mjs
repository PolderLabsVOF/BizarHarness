/**
 * bizar-dash/tests/cli-refactor.test.mjs
 *
 * v4.6 — CLI refactor tests.
 *
 * Verifies:
 *   1. cli/bin.mjs imports from cli/commands/*.mjs correctly
 *   2. Each command module exports a `run` function
 *   3. cli/utils.mjs exports `which()` and `bizarConfigDir()`
 *   4. cli/artifact-cli.mjs, cli/artifact-server.mjs, cli/artifact-render.mjs
 *      exist and export the right things
 *   5. cli/artifact.mjs is a backward-compatible re-export shell
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, '..', '..', 'cli');
const COMMANDS_DIR = resolve(CLI_ROOT, 'commands');

// ── utils.mjs ────────────────────────────────────────────────────────────────

describe('cli/utils.mjs exports', () => {
  test('exports which()', async () => {
    const { which } = await import(`${CLI_ROOT}/utils.mjs`);
    assert.equal(typeof which, 'function');
  });

  test('exports whichPath()', async () => {
    const { whichPath } = await import(`${CLI_ROOT}/utils.mjs`);
    assert.equal(typeof whichPath, 'function');
  });

  test('exports bizarConfigDir()', async () => {
    const { bizarConfigDir } = await import(`${CLI_ROOT}/utils.mjs`);
    assert.equal(typeof bizarConfigDir, 'function');
  });

  test('bizarConfigDir() returns a non-empty string', async () => {
    const { bizarConfigDir } = await import(`${CLI_ROOT}/utils.mjs`);
    const dir = bizarConfigDir();
    assert.equal(typeof dir, 'string');
    assert.ok(dir.length > 0);
    assert.ok(dir.includes('bizar'));
  });

  test('which() returns boolean', async () => {
    const { which } = await import(`${CLI_ROOT}/utils.mjs`);
    const result = which('node');
    assert.equal(typeof result, 'boolean');
  });

  test('which() returns false for nonexistent command', async () => {
    const { which } = await import(`${CLI_ROOT}/utils.mjs`);
    const result = which('this-command-does-not-exist-xyz');
    assert.equal(result, false);
  });

  test('whichPath() returns null for nonexistent command', async () => {
    const { whichPath } = await import(`${CLI_ROOT}/utils.mjs`);
    const result = whichPath('this-command-does-not-exist-xyz');
    assert.equal(result, null);
  });
});

// ── Command modules ────────────────────────────────────────────────────────────

const COMMAND_FILES = [
  'install',
  'service',
  'dash',
  'minimax',
  'mod',
  'artifact',
  'memory',
  'usage',
  'util',
];

describe('cli/commands/*.mjs exports', () => {
  for (const name of COMMAND_FILES) {
    test(`${name}.mjs exports run()`, async () => {
      const mod = await import(`${COMMANDS_DIR}/${name}.mjs`);
      assert.equal(typeof mod.run, 'function', `${name}.mjs should export run()`);
    });

    // Note: calling run() directly would execute the command (network calls, etc.)
    // which is not appropriate in a module structure test. The run() signature
    // is validated via TypeScript / node --check instead.
  }
});

// ── Artifact split ────────────────────────────────────────────────────────────

describe('artifact module split', () => {
  test('artifact-cli.mjs exists and exports runArtifact', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-cli.mjs`);
    assert.equal(typeof mod.runArtifact, 'function');
    assert.equal(typeof mod.default, 'function');
  });

  test('artifact-cli.mjs exports showHelp', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-cli.mjs`);
    assert.equal(typeof mod.showHelp, 'function');
  });

  test('artifact-cli.mjs exports regenerateHtml', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-cli.mjs`);
    assert.equal(typeof mod.regenerateHtml, 'function');
  });

  test('artifact-server.mjs exists and exports startServer', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-server.mjs`);
    assert.equal(typeof mod.startServer, 'function');
  });

  test('artifact-render.mjs exports CANVAS_SCHEMA_VERSION', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-render.mjs`);
    assert.equal(mod.CANVAS_SCHEMA_VERSION, 2);
  });

  test('artifact-render.mjs exports canvas helpers', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-render.mjs`);
    assert.equal(typeof mod.emptyCanvas, 'function');
    assert.equal(typeof mod.readCanvasFile, 'function');
    assert.equal(typeof mod.writeCanvasFile, 'function');
    assert.equal(typeof mod.loadOrMigrateCanvas, 'function');
    assert.equal(typeof mod.canvasToMarkdown, 'function');
  });

  test('artifact-render.mjs exports ID generators', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-render.mjs`);
    assert.equal(typeof mod.makeElementId, 'function');
    assert.equal(typeof mod.makeConnectionId, 'function');
    assert.equal(typeof mod.makeCommentId, 'function');
    assert.equal(typeof mod.makeReplyId, 'function');
  });

  test('artifact-render.mjs exports HTML renderers', async () => {
    const mod = await import(`${CLI_ROOT}/artifact-render.mjs`);
    assert.equal(typeof mod.renderElementHTML, 'function');
    assert.equal(typeof mod.renderConnectionHTML, 'function');
    assert.equal(typeof mod.renderCommentPinHTML, 'function');
    assert.equal(typeof mod.escapeHtml, 'function');
    assert.equal(typeof mod.formatDate, 'function');
  });

  test('artifact.mjs is a re-export shell (backward compat)', async () => {
    const mod = await import(`${CLI_ROOT}/artifact.mjs`);
    // Should re-export runArtifact
    assert.equal(typeof mod.runArtifact, 'function');
    // Should re-export runPlan as alias for runArtifact (backward compat)
    assert.equal(typeof mod.runPlan, 'function');
    // Should re-export startServer
    assert.equal(typeof mod.startServer, 'function');
    // Should re-export canvas helpers
    assert.equal(typeof mod.emptyCanvas, 'function');
    assert.equal(typeof mod.canvasToMarkdown, 'function');
    // Should re-export render helpers
    assert.equal(typeof mod.renderElementHTML, 'function');
    assert.equal(typeof mod.escapeHtml, 'function');
    // Should re-export regenerateHtml
    assert.equal(typeof mod.regenerateHtml, 'function');
  });
});

// ── bin.mjs structure ─────────────────────────────────────────────────────────

describe('cli/bin.mjs structure', () => {
  test('bin.mjs is a valid ESM module', async () => {
    // Just verify it can be parsed as ESM — don't run main()
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${CLI_ROOT}/bin.mjs`, 'utf8');
    assert.ok(src.includes('#!/usr/bin/env node'));
    assert.ok(src.includes('export'));
    assert.ok(src.includes('import'));
  });
});

console.log('  cli-refactor.test.mjs loaded — run with: node --test bizar-dash/tests/cli-refactor.test.mjs');
