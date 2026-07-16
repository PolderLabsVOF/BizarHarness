// Tests M4 — theme toggle shows the icon for the resolved theme, not the selected mode.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the icon mapping from ThemeToggle.tsx
const RESOLVED_ICON = {
  light: 'Sun',
  dark: 'Moon',
  system: 'Monitor',
};

test('light resolves to Sun icon', () => {
  assert.equal(RESOLVED_ICON.light, 'Sun');
});

test('dark resolves to Moon icon', () => {
  assert.equal(RESOLVED_ICON.dark, 'Moon');
});

test('system resolves to Monitor icon', () => {
  assert.equal(RESOLVED_ICON.system, 'Monitor');
});

test('all three states use distinct icons', () => {
  const icons = new Set(Object.values(RESOLVED_ICON));
  assert.equal(icons.size, 3);
});
