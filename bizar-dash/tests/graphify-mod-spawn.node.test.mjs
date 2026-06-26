/**
 * graphify-mod-spawn.node.test.mjs — regression test for the SIGPIPE crash.
 *
 * The graphify mod's route.mjs used to spawn the `graphify` CLI with
 * `spawnSync` + `stdio: 'inherit'`. That worked in a terminal, but the
 * dashboard is a background daemon with stdin=/dev/null and
 * stdout/stderr redirected to a log file. With `stdio: 'inherit'`, the
 * child inherits those descriptors; if anything closes or rotates them
 * mid-build, the kernel delivers SIGPIPE to the dashboard — silently
 * killing it. The user reported "building the graph crashed the dash".
 *
 * This test verifies the source file no longer contains the dangerous
 * pattern. We parse the file as text (the route.mjs is loaded by the
 * dashboard's vm sandbox, not directly importable here).
 *
 * Run with: node --test tests/graphify-mod-spawn.node.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Test lives at bizar-dash/tests/, source is at the repo root.
const REPO = resolve(import.meta.dirname, '..', '..');
const SOURCE = join(REPO, 'mods-examples/graphify/route.mjs');

describe('graphify mod — SIGPIPE-safe spawn', () => {
  it('source file exists at the expected path', () => {
    const text = readFileSync(SOURCE, 'utf8');
    assert.ok(text.length > 100, 'source file should be substantial');
  });

  it('does NOT import spawnSync (causes blocking + stdio inheritance)', () => {
    const text = readFileSync(SOURCE, 'utf8');
    assert.ok(
      !/\bspawnSync\b/.test(text),
      'route.mjs must not import or call spawnSync — use async spawn instead',
    );
  });

  it('does NOT use stdio: \'inherit\' (the SIGPIPE crash vector)', () => {
    const text = readFileSync(SOURCE, 'utf8');
    // Strip block comments and line comments before checking — we don't
    // want the bug description itself to trip the test.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/`stdio:\s*'inherit'`/g, '');
    // Look for the literal string in any quoting style.
    const patterns = [
      /stdio:\s*['"]inherit['"]/,
      /stdio:\s*\[\s*['"]inherit['"]/,
    ];
    for (const pat of patterns) {
      assert.ok(
        !pat.test(stripped),
        `route.mjs must not use stdio: 'inherit' — it propagates SIGPIPE to the dashboard`,
      );
    }
  });

  it('isolates the spawned child stdio with [\'ignore\', \'pipe\', \'pipe\']', () => {
    const text = readFileSync(SOURCE, 'utf8');
    assert.ok(
      /stdio:\s*\[\s*['"]ignore['"]\s*,\s*['"]pipe['"]\s*,\s*['"]pipe['"]\s*\]/.test(text),
      'spawn options should set stdio to [ignore, pipe, pipe] for SIGPIPE isolation',
    );
  });

  it('runs graphify as an async spawn (not blocking)', () => {
    const text = readFileSync(SOURCE, 'utf8');
    // runGraphify should be declared `async function` and return a Promise.
    assert.ok(
      /async\s+function\s+runGraphify\s*\(/.test(text),
      'runGraphify should be declared async so the dashboard event loop is not blocked',
    );
    assert.ok(
      /return\s+new\s+Promise\s*\(/.test(text),
      'runGraphify should return a Promise (async spawn lifecycle)',
    );
  });

  it('forwards child stdout/stderr to the broadcast callback (no streaming lost)', () => {
    const text = readFileSync(SOURCE, 'utf8');
    assert.ok(
      /broadcast\(\s*\{\s*type:\s*['"]graphify:build:log['"]/.test(text),
      'runGraphify should call broadcast with graphify:build:log events so the dashboard UI keeps streaming',
    );
  });
});
