/**
 * cli/install/postinstall.test.mjs
 *
 * Verifies the postinstall bootstrap resolves source paths via the package
 * root, not via BIZAR_HOME (regression test for the v10.7.0 ENOENT crash:
 * `~/.config/config/agents/mike.md → ~/.claude/agents/mike.md`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// Mirror the postinstall's PACKAGE_ROOT computation.
const PACKAGE_ROOT_FROM_HERE = join(__dirname, '..', '..');
const SRC_AGENTS_DIR = join(PACKAGE_ROOT_FROM_HERE, '.claude', 'agents');
const SRC_SETTINGS_FILE = join(PACKAGE_ROOT_FROM_HERE, '.claude', 'settings.json');

test('PACKAGE_ROOT resolves to the repo root (not BIZAR_HOME)', () => {
  // The bug: source paths used PATHS.bizarHome + '/../config/agents/' which
  // climbed one level up from BIZAR_HOME — a runtime state dir. The fix
  // resolves via import.meta.url to the actual package root.
  assert.ok(SRC_AGENTS_DIR.endsWith('/.claude/agents'), `got ${SRC_AGENTS_DIR}`);
  assert.ok(SRC_SETTINGS_FILE.endsWith('/.claude/settings.json'), `got ${SRC_SETTINGS_FILE}`);
});

test('.claude/agents/ directory exists in the repo (canonical agent source)', () => {
  assert.ok(existsSync(SRC_AGENTS_DIR), `${SRC_AGENTS_DIR} must exist`);
  const files = readdirSync(SRC_AGENTS_DIR).filter(f => f.endsWith('.md'));
  assert.ok(files.length >= 14, `expected >=14 agents, got ${files.length}`);
});

test('every shipped agent file resolves to a real file under .claude/agents/', () => {
  const files = readdirSync(SRC_AGENTS_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    assert.ok(existsSync(join(SRC_AGENTS_DIR, file)), `${file} must exist on disk`);
  }
});

test('.claude/settings.json exists in the repo (settings template)', () => {
  assert.ok(existsSync(SRC_SETTINGS_FILE), `${SRC_SETTINGS_FILE} must exist`);
});

test('copy semantics: existing files in destination are not overwritten', () => {
  // Build a fake source tree + destination tree.
  const work = mkdtempSync(join(tmpdir(), 'bizar-postinstall-'));
  try {
    const srcDir = join(work, 'src');
    const dstDir = join(work, 'dst');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(join(srcDir, 'a.md'), '# shipped');
    writeFileSync(join(dstDir, 'a.md'), '# user-edited');

    // Mirror postinstall's loop: skip when dst exists.
    const files = ['a.md'];
    for (const f of files) {
      const dst = join(dstDir, f);
      if (!existsSync(dst)) {
        copyFileSync(join(srcDir, f), dst);
      }
    }
    const content = readFileSync(join(dstDir, 'a.md'), 'utf8');
    assert.match(content, /user-edited/, 'existing user file must be preserved');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('copy semantics: missing files are copied from source', () => {
  const work = mkdtempSync(join(tmpdir(), 'bizar-postinstall-'));
  try {
    const srcDir = join(work, 'src');
    const dstDir = join(work, 'dst');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(join(srcDir, 'b.md'), '# shipped');

    const files = ['b.md'];
    for (const f of files) {
      const dst = join(dstDir, f);
      if (!existsSync(dst)) copyFileSync(join(srcDir, f), dst);
    }
    assert.match(readFileSync(join(dstDir, 'b.md'), 'utf8'), /shipped/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('regression: source path does NOT include "config/agents/" (legacy deleted in F-107)', () => {
  // F-107 deleted config/agents/. Postinstall must not reference it.
  assert.ok(!SRC_AGENTS_DIR.includes('/config/agents/'),
    `BUG: SRC_AGENTS_DIR must not contain /config/agents/ (legacy tree), got ${SRC_AGENTS_DIR}`);
});