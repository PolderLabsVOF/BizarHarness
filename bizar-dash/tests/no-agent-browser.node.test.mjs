/**
 * no-agent-browser.node.test.mjs — regression test for the v3.20.7 cleanup.
 *
 * The `agent-browser` MCP tool was the previous browser-automation path.
 * v3.20.7 replaced it with `browser-harness` (the Python tool from
 * https://github.com/browser-use/browser-harness). This test ensures
 * no agent-browser references leak back into the shipped config or
 * the install/bootstrap scripts.
 *
 * Allowed exceptions:
 *   - .bizar/AGENTS_SELF_IMPROVEMENT.md (historical rule entry documenting
 *     the v3.20.7 migration)
 *   - CHANGELOG.md (historical release notes)
 *
 * Run with: node --test tests/no-agent-browser.node.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

const SCAN_DIRS = [
  'config',
  'cli',
  'bizar-dash/src',
  'install.sh',
];
const SCAN_EXTENSIONS = ['.mjs', '.ts', '.tsx', '.json', '.sh', '.md', '.mdx', '.md.template'];
const ALLOW_FILES = new Set([
  '.bizar/AGENTS_SELF_IMPROVEMENT.md', // historical rule entry
  'CHANGELOG.md',                       // historical release notes
]);
const PATTERNS = [
  /agent[-_]?browser/i,                 // agent-browser, agent_browser, agentBrowser
  /agent_browser_/i,                    // agent_browser_open etc.
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
  // Skip noise
  if (root.includes('node_modules')) return;
  if (root.includes('.git')) return;
  for (const entry of readdirSync(root)) {
    yield* walkFiles(join(root, entry));
  }
}

describe('no agent-browser references in shipped code', () => {
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

  it('reports zero violations', () => {
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}: matched "${v.match}"`)
        .join('\n');
      assert.fail(`agent-browser references found in shipped code:\n${msg}`);
    }
  });

  it('documents the explicit allow-list', () => {
    // Sanity: the allow-list itself shouldn't be empty (we have real
    // historical references that should be preserved).
    assert.ok(ALLOW_FILES.size >= 2,
      'expected ALLOW_FILES to include at least AGENTS_SELF_IMPROVEMENT.md + CHANGELOG.md');
  });
});
