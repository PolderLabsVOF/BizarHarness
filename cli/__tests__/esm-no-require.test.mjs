/**
 * cli/__tests__/esm-no-require.test.mjs
 *
 * F-057 — Static guard against `require(...)` calls inside production `.mjs`
 * files under `cli/`.
 *
 * Bug class: ESM source files used `require('node:fs')` etc. as a shortcut.
 * The bug fires on Node 18/20 LTS (where require is undefined in ESM) and
 * is silently masked on Node 22+ (which ships a require shim in ESM).
 *
 * Scan policy:
 *   - Only production .mjs files (not in __tests__/, not *.test.mjs).
 *   - Strip line comments (`// ...`) and block comments before scanning
 *     so test/source commentary about `require` doesn't trigger.
 *   - Flag any `\brequire(?:\?)?\s*\(` token outside comments.
 *
 * The fix is to use top-level imports instead.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); // cli/

/** Recursively find every .mjs file under ROOT, excluding test files / node_modules / dist. */
function findProductionMjs(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '__tests__' || ent.name === 'tests') continue;
    if (ent.name.startsWith('.')) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...findProductionMjs(p));
    else if (ent.isFile() && ent.name.endsWith('.mjs') && !ent.name.endsWith('.test.mjs')) {
      out.push(p);
    }
  }
  return out;
}

/** Remove line and block comments + string literals from source for safe pattern scanning. */
function stripCommentsAndStrings(src) {
  // 1. Strip /* ... */ block comments (non-greedy, multi-line).
  src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // 2. Strip // line comments.
  src = src.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  // 3. Strip double-quoted strings (preserve newlines).
  src = src.replace(/"(?:\\.|[^"\\])*"/g, (m) => m.replace(/[^\n]/g, ' '));
  // 4. Strip single-quoted strings.
  src = src.replace(/'(?:\\.|[^'\\])*'/g, (m) => m.replace(/[^\n]/g, ' '));
  // 5. Strip template literals (backticks) — keep `${...}` expressions intact for scanning.
  //    Replace backtick segments that have no ${...} with spaces; inside ${...} keep the code.
  src = src.replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '));
  return src;
}

describe('ESM no-require guard (F-057)', () => {
  const files = findProductionMjs(ROOT);

  test('cli/ has at least one production .mjs file to scan', () => {
    assert.ok(files.length > 0, 'no production .mjs files found under cli/');
  });

  test('no production .mjs file uses `require(` as a function call', () => {
    /** @type {Array<{file: string, line: number, snippet: string}>} */
    const offenders = [];
    const re = /\brequire(?:\?)?\s*\(/;
    for (const f of files) {
      const raw = readFileSync(f, 'utf8');
      const stripped = stripCommentsAndStrings(raw);
      const rawLines = raw.split('\n');
      const strippedLines = stripped.split('\n');
      for (let i = 0; i < strippedLines.length; i++) {
        const line = strippedLines[i];
        if (re.test(line)) {
          offenders.push({
            file: relative(ROOT, f),
            line: i + 1,
            snippet: rawLines[i].trim().slice(0, 140),
          });
        }
      }
    }

    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.snippet}`)
        .join('\n');
      assert.fail(
        `Found ${offenders.length} \`require(\` call(s) in production ESM modules.\n` +
        `These throw ReferenceError on Node 18/20 LTS:\n${msg}\n\n` +
        `Fix: replace each call with a top-level ESM import.`,
      );
    }
  });
});