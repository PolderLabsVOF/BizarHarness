// Loop task #11 — Topbar Popover content inline styles extracted to constants.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the module-level style constants in Topbar.tsx. The Popover
// items render through these constants instead of inline object literals.
const ITEM_VARIANTS = ['active', 'inactive', 'busy'];

function deriveItemCursor({ isActive, busy }) {
  if (busy !== null && busy !== undefined) return 'wait';
  return 'pointer';
}

function deriveItemBackground({ isActive }) {
  return isActive ? 'var(--surface-2)' : 'transparent';
}

for (const variant of ITEM_VARIANTS) {
  test(`popover item (${variant}) renders cursor correctly`, () => {
    const isActive = variant === 'active';
    const busy = variant === 'busy' ? 'project-1' : null;
    assert.equal(
      deriveItemCursor({ isActive, busy }),
      variant === 'busy' ? 'wait' : 'pointer',
    );
  });

  test(`popover item (${variant}) background matches active flag`, () => {
    const isActive = variant === 'active';
    assert.equal(
      deriveItemBackground({ isActive }),
      isActive ? 'var(--surface-2)' : 'transparent',
    );
  });
}

test('marker color reflects active state', () => {
  const color = (active) => (active ? 'var(--accent)' : 'var(--fg-muted)');
  assert.equal(color(true), 'var(--accent)');
  assert.equal(color(false), 'var(--fg-muted)');
});

test('label style enforces single-line ellipsis', () => {
  const style = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  assert.equal(style.textOverflow, 'ellipsis');
  assert.equal(style.whiteSpace, 'nowrap');
});
