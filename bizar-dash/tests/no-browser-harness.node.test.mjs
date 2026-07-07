/**
 * no-browser-harness.node.test.mjs — regression test for the v6.0.0 migration.
 *
 * v6.0.0 replaces the v5.x `browser-harness` (Python tool from
 * https://github.com/browser-use/browser-harness) with `agent-browser`
 * (native Rust CLI from vercel-labs, ~38K★ — https://github.com/vercel-labs/agent-browser).
 *
 * This test ensures no `browser-harness` references leak back into the
 * shipped config, the install/bootstrap scripts, or the dashboard code.
 *
 * Allowed exceptions:
 *   - .bizar/AGENTS_SELF_IMPROVEMENT.md (historical rule entry)
 *   - CHANGELOG.md (historical release notes)
 *   - docs/migration-guide.md (documents the v5.x → v6.0.0 migration)
 *
 * Run with: node --test tests/no-browser-harness.node.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

const SCAN_DIRS = [
  'config',
  'cli',
  'plugins',
  'bizar-dash/src',
  'install.sh',
];
const SCAN_EXTENSIONS = ['.mjs', '.ts', '.tsx', '.json', '.sh', '.md', '.mdx', '.md.template'];
const ALLOW_FILES = new Set([
  '.bizar/AGENTS_SELF_IMPROVEMENT.md', // historical rule entry
  'CHANGELOG.md',                       // historical release notes
  'docs/migration-guide.md',            // documents the migration rationale
  'MILESTONES.md',                      // strategic roadmap (references legacy)
  'IMPLEMENTATION_PLAN.md',             // tactical plan (references legacy)
]);
const PATTERNS = [
  /browser[-_]?harness/i,               // browser-harness, browser_harness, browserHarness
  /browser_harness_/i,                  // browser_harness_open etc.
];

function isAllowed(relPath) {
  if (ALLOW_FILES.has(relPath)) return true;
  return false;
}

function* walkFiles(root) {
  const stat = statSync(root);
  if (stat.isFile()) {
    if (SCAN_EXTENSIONS.some((ext) => root.endsWith(ext))) yield root;
    return;
  }
  if (!stat.isDirectory()) return;
  if (root.includes('node_modules')) return;
  if (root.includes('.git')) return;
  for (const entry of readdirSync(root)) {
    yield* walkFiles(join(root, entry));
  }
}

describe('no browser-harness references in shipped code (v6.0.0+ uses agent-browser)', () => {
  const violations = [];

  for (const target of SCAN_DIRS) {
    const full = join(REPO, target);
    let exists = true;
    try { statSync(full); } catch { exists = false; }
    if (!exists) continue;
    for (const file of walkFiles(full)) {
      const rel = file.slice(REPO.length + 1);
      if (isAllowed(rel)) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      for (const pat of PATTERNS) {
        const m = text.match(pat);
        if (m) {
          violations.push({ file: rel, match: m[0] });
          break; // one violation per file is enough
        }
      }
    }
  }

  if (violations.length > 0) {
    const lines = violations.map((v) => `  - ${v.file}: matched "${v.match}"`);
    assert.fail(
      `Found ${violations.length} browser-harness reference(s) in shipped code:\n${lines.join('\n')}\n` +
      `Use agent-browser instead. See docs/migration-guide.md.`
    );
  }

  it('has no browser-harness references in shipped config / code / install scripts', () => {
    assert.equal(violations.length, 0);
  });
});
