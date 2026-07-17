// Loop task #16 — Hardcoded px padding → space tokens.
//
// `padding: '4px 8px'` should map to `padding: 'var(--space-1) var(--space-2)'`.
// The mapping is fixed by the design-token scale (4-step: 4/8/12/16/20/24).

import test from 'node:test';
import assert from 'node:assert/strict';

const SPACING_MAP = {
  4: 'var(--space-1)',
  8: 'var(--space-2)',
  12: 'var(--space-3)',
  16: 'var(--space-4)',
  20: 'var(--space-5)',
  24: 'var(--space-6)',
};

function mapSpacing(px) {
  return SPACING_MAP[px] ?? null;
}

for (const [px, token] of Object.entries(SPACING_MAP)) {
  test(`px ${px} maps to ${token}`, () => {
    assert.equal(mapSpacing(Number(px)), token);
  });
}

test('chip padding 4px 8px maps to canonical token shorthand', () => {
  const canonical = `${mapSpacing(4)} ${mapSpacing(8)}`;
  assert.equal(canonical, 'var(--space-1) var(--space-2)');
});

test('unmapped values return null (require explicit decision)', () => {
  assert.equal(mapSpacing(10), null);
  assert.equal(mapSpacing(14), null);
});