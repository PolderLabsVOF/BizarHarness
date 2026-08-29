/**
 * cli/worker-dispatcher.test.mjs
 *
 * Prompt suggestion router — unit tests for the trigger-pattern dispatcher.
 * Uses Node's built-in `node:test`. No external test framework.
 *
 * Strategy:
 *   - Use the real `config/trigger-patterns.json` (already on disk).
 *   - Call `dispatch()` and `listWorkers()` exported from
 *     `cli/worker-dispatcher.mjs`.
 *   - 5 sample prompts → expected worker ids (the canonical F-034 dry run).
 *   - Edge cases: empty prompt, case-insensitive matches, maxSuggestions
 *     clipping, no-match prompt, listWorkers completeness.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dispatcherModule = await import('./worker-dispatcher.mjs');
const { dispatch, listWorkers, resetCache, loadPatterns } = dispatcherModule;

// ── Fixture: optional override path (not used by the canonical suite) ──────
const ORIG_BIZAR = process.env.BIZAR_TRIGGER_PATTERNS;

after(() => {
  if (ORIG_BIZAR === undefined) delete process.env.BIZAR_TRIGGER_PATTERNS;
  else process.env.BIZAR_TRIGGER_PATTERNS = ORIG_BIZAR;
});

// ── Canonical F-034 dry-run: 5 sample prompts → expected worker ids ─────────

describe('dispatch() — canonical 5-prompt dry run', () => {
  // Make sure cache is fresh for each run.
  before(() => { resetCache(); });

  test('"missing tests" → suggests testgaps', () => {
    const out = dispatch('missing tests in the auth module');
    const ids = out.map((s) => s.workerId);
    assert.ok(ids.includes('testgaps'), `expected testgaps, got ${JSON.stringify(ids)}`);
    assert.equal(out.find((s) => s.workerId === 'testgaps').matchedPattern, 'missing tests?');
  });

  test('"deep dive into fn()" → suggests deepdive', () => {
    const out = dispatch('deep dive into fn()');
    const ids = out.map((s) => s.workerId);
    assert.ok(ids.includes('deepdive'), `expected deepdive, got ${JSON.stringify(ids)}`);
  });

  test('"refactor this module" → suggests refactor', () => {
    const out = dispatch('refactor this module');
    const ids = out.map((s) => s.workerId);
    assert.ok(ids.includes('refactor'), `expected refactor, got ${JSON.stringify(ids)}`);
  });

  test('"security scan the API" → suggests audit', () => {
    const out = dispatch('security scan the API');
    const ids = out.map((s) => s.workerId);
    assert.ok(ids.includes('audit'), `expected audit, got ${JSON.stringify(ids)}`);
  });

  test('"optimize the build for size" → suggests optimize', () => {
    const out = dispatch('optimize the build for size');
    const ids = out.map((s) => s.workerId);
    assert.ok(ids.includes('optimize'), `expected optimize, got ${JSON.stringify(ids)}`);
  });
});

// ── Empty / no-match paths ──────────────────────────────────────────────────

describe('dispatch() — edge cases', () => {
  before(() => { resetCache(); });

  test('empty prompt returns []', () => {
    assert.deepEqual(dispatch(''), []);
    assert.deepEqual(dispatch('   '), []);
  });

  test('no-match prompt returns []', () => {
    assert.deepEqual(dispatch('hello world, no actionable words here'), []);
  });

  test('case-insensitive match', () => {
    const a = dispatch('Refactor this MODULE');
    const b = dispatch('refactor this module');
    const aIds = a.map((s) => s.workerId).sort();
    const bIds = b.map((s) => s.workerId).sort();
    assert.ok(aIds.includes('refactor'), 'refactor must match even in ALLCAPS');
    assert.deepEqual(aIds, bIds);
  });

  test('maxSuggestions: 1 clips to a single suggestion', () => {
    // Construct a prompt that hits MANY workers (refactor + optimize +
    // document + audit + testgaps). With maxSuggestions=1 we get exactly 1.
    const out = dispatch(
      'refactor this module; optimize the build for size; write docs; security scan; missing tests',
      { maxSuggestions: 1 },
    );
    assert.equal(out.length, 1, 'should clip to maxSuggestions=1');
  });

  test('maxSuggestions: 0 returns []', () => {
    const out = dispatch('missing tests', { maxSuggestions: 0 });
    assert.deepEqual(out, []);
  });

  test('default maxSuggestions clips at 3', () => {
    // Same long prompt as above — default should clamp at 3.
    const out = dispatch(
      'refactor this module; optimize the build for size; write docs; security scan; missing tests',
    );
    assert.equal(out.length, 3, 'default maxSuggestions must be 3');
  });

  test('output is sorted by weight desc (then workerId)', () => {
    const out = dispatch(
      'refactor this module; security scan; missing tests; write docs',
    );
    // Find weights and assert strictly non-increasing.
    for (let i = 1; i < out.length; i++) {
      assert.ok(
        out[i - 1].weight >= out[i].weight,
        `weights must be non-increasing (${out[i - 1].workerId}=${out[i - 1].weight} < ${out[i].workerId}=${out[i].weight})`,
      );
    }
  });

  test('every suggestion exposes skill + agent + matchedPattern', () => {
    const out = dispatch('missing tests');
    for (const s of out) {
      assert.equal(typeof s.workerId, 'string');
      assert.equal(typeof s.weight, 'number');
      assert.ok(s.skill === null || typeof s.skill === 'string');
      assert.ok(s.agent === null || typeof s.agent === 'string');
      assert.equal(typeof s.matchedPattern, 'string');
      assert.ok(s.matchedPattern.length > 0);
    }
  });
});

// ── listWorkers / loadPatterns ───────────────────────────────────────────────

describe('listWorkers()', () => {
  before(() => { resetCache(); });

  test('returns the full worker set', () => {
    const ids = listWorkers();
    const expected = [
      'testgaps', 'audit', 'deepdive', 'refactor', 'document', 'optimize',
      'ultralearn', 'predict', 'map', 'preload', 'benchmark',
      'design-system', 'ui-review', 'browser-e2e', 'qa-review',
      'implement-complex', 'implement-medium', 'implement-trivial',
      'git-operations', 'research-deep', 'explain-code', 'find-code',
      'plan-task', 'clarify-request', 'simplify-diff', 'improve-self',
      'release',
    ];
    for (const id of expected) {
      assert.ok(ids.includes(id), `expected worker ${id} in ${JSON.stringify(ids)}`);
    }
    assert.equal(ids.length, expected.length, `worker count must be exactly ${expected.length}`);
  });
});

describe('loadPatterns()', () => {
  before(() => { resetCache(); });

  test('caches on second call (same instance)', () => {
    const a = loadPatterns();
    const b = loadPatterns();
    assert.equal(a, b, 'second call must return cached array');
  });

  test('resetCache() forces a fresh load', () => {
    const a = loadPatterns();
    resetCache();
    const b = loadPatterns();
    assert.notEqual(a, b, 'after resetCache the new array must be a fresh object');
  });

  test('missing configPath yields empty dispatcher (no throw)', () => {
    resetCache();
    const tmp = mkdtempSync(join(tmpdir(), 'bizar-workers-'));
    const phantom = join(tmp, 'does-not-exist.json');
    const out = dispatch('missing tests', { configPath: phantom });
    assert.deepEqual(out, []);
    // Restore default config by clearing the override.
    delete process.env.BIZAR_TRIGGER_PATTERNS;
    resetCache();
    // Sanity: the real config still works.
    assert.ok(dispatch('missing tests').length > 0);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('malformed JSON yields empty dispatcher (no throw)', () => {
    resetCache();
    const tmp = mkdtempSync(join(tmpdir(), 'bizar-workers-'));
    const broken = join(tmp, 'broken.json');
    writeFileSync(broken, '{not valid json');
    const out = dispatch('missing tests', { configPath: broken });
    assert.deepEqual(out, []);
    resetCache();
    rmSync(tmp, { recursive: true, force: true });
  });
});
