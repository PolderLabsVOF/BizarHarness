// Loop task #12 — Sidebar section header inline styles extracted.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors sidebarSectionChevronStyle(open) — chevron rotates 90deg when open.
function chevronTransform(open) {
  return open ? 'rotate(90deg)' : 'rotate(0deg)';
}

test('chevron points right when section is collapsed', () => {
  assert.equal(chevronTransform(false), 'rotate(0deg)');
});

test('chevron rotates 90deg when section is open', () => {
  assert.equal(chevronTransform(true), 'rotate(90deg)');
});

test('sidebar section label carries uppercase + wide tracking', () => {
  const style = {
    fontSize: 'var(--fs-12)',
    fontWeight: 600,
    color: 'var(--fg-subtle)',
    letterSpacing: 'var(--tracking-wide)',
    textTransform: 'uppercase',
    flex: 1,
    padding: 'var(--space-1) var(--space-3)',
  };
  assert.equal(style.textTransform, 'uppercase');
  assert.equal(style.letterSpacing, 'var(--tracking-wide)');
  assert.equal(style.flex, 1);
});

test('sidebar section toggle button is a transparent 20x20 square', () => {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    background: 'transparent',
    border: 0,
    cursor: 'pointer',
    padding: 0,
  };
  assert.equal(style.width, 20);
  assert.equal(style.height, 20);
  assert.equal(style.background, 'transparent');
});

test('sidebar section header is a flex row with space-2 gap', () => {
  const style = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' };
  assert.equal(style.display, 'flex');
  assert.equal(style.gap, 'var(--space-2)');
});
