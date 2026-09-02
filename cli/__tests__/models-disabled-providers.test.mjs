/**
 * cli/__tests__/models-disabled-providers.test.mjs
 *
 * 10.22.0 / Phase 4 — `disabledProviders` filter contract.
 *
 *   - `filterCandidatesByDisabledProviders`: case-sensitive prefix filter
 *     against the (already-lowercase) disabled list. Empty list is a no-op.
 *   - `readDisabledProviders`: reads only the Bizar global router. Whitespace
 *     + lowercase normalization happens at read time.
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

test('readDisabledProviders: reads the supplied global router only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-disabled-providers-'));
  const bizarDir = join(dir, 'bizar', 'config', 'claude');
  mkdirSync(bizarDir, { recursive: true });
  const bizarPath = join(bizarDir, 'model-router.json');
  try {
    writeFileSync(bizarPath, JSON.stringify({ disabledProviders: ['minimax'] }));
    const out = readDisabledProviders({ routerPath: bizarPath });
    assert.deepEqual(out, ['minimax']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDisabledProviders: honors an explicit empty global policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-disabled-providers-'));
  const bizarDir = join(dir, 'bizar', 'config', 'claude');
  mkdirSync(bizarDir, { recursive: true });
  const bizarPath = join(bizarDir, 'model-router.json');
  try {
    writeFileSync(bizarPath, JSON.stringify({ disabledProviders: [] }));
    const out = readDisabledProviders({ routerPath: bizarPath });
    assert.deepEqual(out, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
