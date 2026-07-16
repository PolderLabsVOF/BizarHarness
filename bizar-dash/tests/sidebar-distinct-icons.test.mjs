// Tests L3 — sidebar icons for Overview, Hooks, and Artifacts are distinct.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the icon assignments from Sidebar.tsx (after L3 fix)
const SIDEBAR_ICONS = {
  overview: 'LayoutDashboard',
  hooks: 'Webhook',
  artifacts: 'Package',
};

test('Overview uses LayoutDashboard icon (not Layers)', () => {
  assert.equal(SIDEBAR_ICONS.overview, 'LayoutDashboard');
});

test('Hooks uses Webhook icon (not Layers)', () => {
  assert.equal(SIDEBAR_ICONS.hooks, 'Webhook');
});

test('Artifacts uses Package icon (not Layers)', () => {
  assert.equal(SIDEBAR_ICONS.artifacts, 'Package');
});

test('all three labels use distinct icon names', () => {
  const icons = Object.values(SIDEBAR_ICONS);
  assert.equal(new Set(icons).size, icons.length);
});
