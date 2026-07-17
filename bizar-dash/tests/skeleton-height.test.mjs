// Loop task #20 — Skeleton height prop pass-through.
//
// Source: `ui/feedback/Skeleton.tsx`. The `height` prop accepts a
// number (interpreted as px) or string (passed as-is). Default = 16.

import test from 'node:test';
import assert from 'node:assert/strict';

function deriveHeightStyle({ height = 16 }) {
  return typeof height === 'number' ? `${height}px` : height;
}

function deriveRadiusStyle({ radius = 'sm' }) {
  return radius === 'sm'
    ? 'var(--radius-sm)'
    : radius === 'pill'
      ? 'var(--radius-pill)'
      : 'var(--radius)';
}

test('number height gets px suffix', () => {
  assert.equal(deriveHeightStyle({ height: 24 }), '24px');
});

test('string height passes through unchanged', () => {
  assert.equal(deriveHeightStyle({ height: '40%' }), '40%');
});

test('default height is 16px', () => {
  assert.equal(deriveHeightStyle({}), '16px');
});

test('radius sm maps to --radius-sm', () => {
  assert.equal(deriveRadiusStyle({ radius: 'sm' }), 'var(--radius-sm)');
});

test('radius pill maps to --radius-pill', () => {
  assert.equal(deriveRadiusStyle({ radius: 'pill' }), 'var(--radius-pill)');
});

test('radius md maps to --radius', () => {
  assert.equal(deriveRadiusStyle({ radius: 'md' }), 'var(--radius)');
});

test('default radius is sm', () => {
  assert.equal(deriveRadiusStyle({}), 'var(--radius-sm)');
});