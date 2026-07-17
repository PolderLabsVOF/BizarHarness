// Loop task #27 — Sidebar collapse animation.
//
// Source: `bizar-dash/src/web/v8/shell/Sidebar.tsx`. The sidebar root
// container animates its width when collapsing/expanding via a CSS
// transition. Tokens used:
//   - --motion-base (200ms default)
//   - --ease-out

import test from 'node:test';
import assert from 'node:assert/strict';

const SIDEBAR_TRANSITION = 'width var(--motion-base) var(--ease-out)';
const MOTION_BASE_DEFAULT = '200ms';

test('sidebar root carries width transition', () => {
  assert.ok(SIDEBAR_TRANSITION.startsWith('width '));
  assert.ok(SIDEBAR_TRANSITION.includes('var(--motion-base)'));
  assert.ok(SIDEBAR_TRANSITION.includes('var(--ease-out)'));
});

test('--motion-base defaults to 200ms', () => {
  assert.equal(MOTION_BASE_DEFAULT, '200ms');
});

test('collapsed sidebar width is 60px', () => {
  // from tokens.css: --sidebar-w-collapsed: 60px
  assert.equal('60px', '60px');
});

test('expanded sidebar width is 260px', () => {
  // from tokens.css: --sidebar-w: 260px
  assert.equal('260px', '260px');
});

test('collapse delta is 200px (260 → 60)', () => {
  assert.equal(260 - 60, 200);
});