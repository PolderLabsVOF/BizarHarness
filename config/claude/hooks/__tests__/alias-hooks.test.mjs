/**
 * config/claude/hooks/__tests__/alias-hooks.test.mjs
 *
 * Contract fence: no surviving hook in the hooks directory reads
 * model-router state, references `bizar models`, or constructs
 * `args.routing`. The only legitimate router references explain what
 * the hook does NOT do.
 *
 * Run with `node --test config/claude/hooks/__tests__/alias-hooks.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = join(__dirname, '..');

function listMjs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const allHookSources = listMjs(HOOKS_DIR);

test('hooks: no surviving hook constructs args.routing', () => {
  // Hook text may legitimately mention args.routing when forbidding it.
  // The forbidden pattern is code that constructs or reads it.
  const constructPattern = /[^a-zA-Z]args\.routing\s*[:=({]/;
  for (const path of allHookSources) {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      !constructPattern.test(src),
      `${path} must not construct or read args.routing`,
    );
  }
});

test('hooks: no surviving hook reads model-router state files', () => {
  const bannedPatterns = [
    /BIZAR_MODEL_ROUTER_URL/,
    /model-router\.json/,
    /userSelected/,
    /disabledProviders/,
  ];
  for (const path of allHookSources) {
    const src = readFileSync(path, 'utf8');
    for (const pattern of bannedPatterns) {
      assert.ok(
        !pattern.test(src),
        `${path} must not match ${pattern}`,
      );
    }
  }
});

test('hooks: no surviving hook invokes the bizarre models picker', () => {
  for (const path of allHookSources) {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      !/bizar\s+models\b/.test(src),
      `${path} must not invoke the bizarre models picker`,
    );
  }
});

test('hooks: worker-suggest.mjs is present and references the alias policy', () => {
  const path = join(HOOKS_DIR, 'worker-suggest.mjs');
  const src = readFileSync(path, 'utf8');
  assert.match(src, /ROUTE_POLICY/);
  assert.match(src, /four native aliases/);
});
