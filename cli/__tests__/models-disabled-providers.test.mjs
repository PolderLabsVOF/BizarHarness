/**
 * cli/__tests__/models-disabled-providers.test.mjs
 *
 * 10.22.0 / Phase 4 — `disabledProviders` filter contract.
 *
 *   - `filterCandidatesByDisabledProviders`: case-sensitive prefix filter
 *     against the (already-lowercase) disabled list. Empty list is a no-op.
 *   - `readDisabledProviders`: dual-path read (Bizar path wins; legacy
 *     mirror is fallback). Whitespace + lowercase normalization at read
 *     time. An explicit `[]` on the Bizar path beats a non-empty legacy
 *     mirror.
 *   - The case-sensitivity pin test: `Anthropic/claude-X` (capital A) is
 *     intentionally NOT stripped when `disabledProviders` is
 *     `["anthropic"]`.
 *
 * No filesystem fixtures — every reader uses an explicit path so the
 * operator's real `~/.config/bizar/` is never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  filterCandidatesByDisabledProviders,
  readDisabledProviders,
} from '../commands/models.mjs';

test('filterCandidatesByDisabledProviders: empty disabled list is a no-op', () => {
  const candidates = ['anthropic/claude-X', 'minimax/M3', 'cx/a1'];
  const out = filterCandidatesByDisabledProviders(candidates, []);
  assert.deepEqual(out.kept, candidates);
  assert.deepEqual(out.stripped, []);
});

test('filterCandidatesByDisabledProviders: case-sensitive prefix strips lowercase prefix only', () => {
  // The pin test: "Anthropic/claude-X" (capital A) is intentionally NOT
  // stripped. Operators who want to block mixed-case ids should write the
  // lowercase form in `disabledProviders`.
  const candidates = [
    'anthropic/claude-X',       // matches: lowercase prefix
    'Anthropic/claude-X',       // does NOT match: case-sensitive
    'anthropic/claude-Y',
    'minimax/M3',                // does NOT match: different family
  ];
  const out = filterCandidatesByDisabledProviders(candidates, ['anthropic']);
  assert.deepEqual(out.kept, ['Anthropic/claude-X', 'minimax/M3']);
  assert.deepEqual(out.stripped, ['anthropic/claude-X', 'anthropic/claude-Y']);
});

test('readDisabledProviders: dual-path Bizar path wins over legacy', () => {
  // Both files exist with different disabled lists. Bizar path's value
  // wins — including the explicit `[]` case.
  const dir = mkdtempSync(join(tmpdir(), 'bizar-disabled-providers-'));
  const bizarDir = join(dir, 'bizar', 'config', 'claude');
  const legacyDir = join(dir, 'legacy');
  mkdirSync(bizarDir, { recursive: true });
  mkdirSync(legacyDir, { recursive: true });
  const bizarPath = join(bizarDir, 'model-router.json');
  const legacyPath = join(legacyDir, 'model-router.json');
  try {
    writeFileSync(bizarPath, JSON.stringify({ disabledProviders: ['minimax'] }));
    writeFileSync(legacyPath, JSON.stringify({ disabledProviders: ['anthropic'] }));
    const out = readDisabledProviders({ routerPath: bizarPath, legacyPath });
    assert.deepEqual(out, ['minimax']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDisabledProviders: explicit [] on Bizar path beats non-empty legacy', () => {
  // The pin test: the operator may pin "no providers disabled" without
  // deleting the legacy mirror. Empty Bizar wins.
  const dir = mkdtempSync(join(tmpdir(), 'bizar-disabled-providers-'));
  const bizarDir = join(dir, 'bizar', 'config', 'claude');
  const legacyDir = join(dir, 'legacy');
  mkdirSync(bizarDir, { recursive: true });
  mkdirSync(legacyDir, { recursive: true });
  const bizarPath = join(bizarDir, 'model-router.json');
  const legacyPath = join(legacyDir, 'model-router.json');
  try {
    writeFileSync(bizarPath, JSON.stringify({ disabledProviders: [] }));
    writeFileSync(legacyPath, JSON.stringify({ disabledProviders: ['anthropic', 'minimax'] }));
    const out = readDisabledProviders({ routerPath: bizarPath, legacyPath });
    assert.deepEqual(out, [], 'explicit empty Bizar list must beat non-empty legacy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
