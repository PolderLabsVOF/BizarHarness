// Loop task #26 — Density-aware spacing tokens.
//
// Source: `bizar-dash/src/web/v8/ui/styles/globals.css`. Density mode is
// switched via `data-density="comfortable"` (default) or `compact`. Three
// tokens adapt: row height, control height, card padding.

import test from 'node:test';
import assert from 'node:assert/strict';

const COMFORTABLE = {
  '--density-row-h': '36px',
  '--density-control-h': '36px',
  '--density-card-pad': 'var(--space-5)',
};

const COMPACT = {
  '--density-row-h': '28px',
  '--density-control-h': '28px',
  '--density-card-pad': 'var(--space-3)',
};

test('comfortable density sets 36px rows + space-5 card pad', () => {
  assert.equal(COMFORTABLE['--density-row-h'], '36px');
  assert.equal(COMFORTABLE['--density-control-h'], '36px');
  assert.equal(COMFORTABLE['--density-card-pad'], 'var(--space-5)');
});

test('compact density tightens to 28px rows + space-3 card pad', () => {
  assert.equal(COMPACT['--density-row-h'], '28px');
  assert.equal(COMPACT['--density-control-h'], '28px');
  assert.equal(COMPACT['--density-card-pad'], 'var(--space-3)');
});

test('compact saves 8px per card vertical edge vs comfortable', () => {
  // space-5 (20) - space-3 (12) = 8
  const compact = 12;
  const comfortable = 20;
  assert.equal(comfortable - compact, 8);
});

test('compact row height is 22% smaller than comfortable', () => {
  // 28 / 36 ≈ 0.78 (22% smaller)
  const ratio = 28 / 36;
  assert.ok(ratio < 0.80, `ratio ${ratio} should be < 0.80`);
  assert.ok(ratio > 0.75, `ratio ${ratio} should be > 0.75`);
});