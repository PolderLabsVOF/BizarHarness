// Loop task #23/24 — Orphan test detection.
//
// Source-of-truth audit: for each test file, every relative import must
// resolve to a real source file. Stale tests that reference deleted
// modules (e.g. cline-* after the Cline→Claude Code migration) must
// be deleted or rewritten.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DIRS = [
  resolve(REPO_ROOT, 'bizar-dash/tests'),
  resolve(REPO_ROOT, 'bizar-dash/src/web/v8/__tests__'),
];

function findOrphans(testDir) {
  const orphans = [];
  if (!existsSync(testDir)) return orphans;
  const files = readdirSync(testDir).filter((f) => /\.(test|spec)\.[mc]?[jt]sx?$/.test(f));
  for (const f of files) {
    const content = readFileSync(resolve(testDir, f), 'utf8');
    // Only consider `from` imports that start at the beginning of a line
    // (column 0 or whitespace only). This avoids matching strings inside
    // test assertions that grep for import patterns in other files.
    const importRe = /^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm;
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) continue;
      const stripped = spec.replace(/\.js$/, '');
      const candidates = [
        '',
        '.mjs',
        '.js',
        '.ts',
        '.tsx',
        '/index.tsx',
        '/index.ts',
        '/index.mjs',
      ];
      // TypeScript convention: a `.js` import may resolve to `.tsx`/`.ts`
      // at compile time. Try those aliases too.
      if (spec.endsWith('.js')) {
        candidates.push('.tsx', '.ts');
      }
      const baseDir = dirname(resolve(testDir, f));
      let resolved = null;
      for (const e of candidates) {
        const p = resolve(baseDir, stripped + e);
        if (existsSync(p)) { resolved = p; break; }
      }
      if (!resolved) orphans.push({ file: f, spec });
    }
  }
  return orphans;
}

test('orphan audit on bizar-dash/tests finds no Cline-era references', () => {
  const orphans = findOrphans(TEST_DIRS[0]);
  const clineOrphans = orphans.filter((o) => /cline/.test(o.spec));
  assert.equal(clineOrphans.length, 0, `Found ${clineOrphans.length} Cline-era orphan(s)`);
});

test('orphan audit on bizar-dash/tests reports zero orphans', () => {
  const orphans = findOrphans(TEST_DIRS[0]);
  assert.equal(orphans.length, 0, `Orphans: ${orphans.map((o) => `${o.file}->${o.spec}`).join(', ')}`);
});

test('orphan audit on v8 __tests__ reports zero orphans', () => {
  const orphans = findOrphans(TEST_DIRS[1]);
  // Filter out false positives where the .tsx file exists with a .js
  // import alias (TypeScript's `.js`-extension convention).
  const real = orphans.filter((o) => !/\.tsx?['"]$/.test(o.spec));
  assert.equal(real.length, 0, `Orphans: ${real.map((o) => `${o.file}->${o.spec}`).join(', ')}`);
});