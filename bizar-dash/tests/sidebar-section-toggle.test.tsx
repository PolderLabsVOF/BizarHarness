/**
 * sidebar-section-toggle.test.ts — Bug C4
 * Verifies that section-toggle buttons have aria-expanded, nav buttons don't,
 * and the active nav button has aria-current="page".
 */
import { test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Sidebar } from '../src/web/v8/shell/Sidebar.js';

// Mock localStorage
Object.assign(globalThis, {
  localStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  },
});

test('C4: section-toggle buttons have aria-expanded, nav items do not', () => {
  render(
    <Sidebar
      defaultSections={true}
      onItemSelect={vi.fn()}
      activeId="overview"
    />,
  );

  // Find all section-toggle buttons (they have data-section-toggle)
  const sectionToggles = document.querySelectorAll('[data-section-toggle]');
  expect(sectionToggles.length).toBeGreaterThan(0);

  for (const toggle of sectionToggles) {
    expect(toggle).toHaveAttribute('aria-expanded');
  }

  // Find all nav-item buttons (they have data-nav-item)
  const navItems = document.querySelectorAll('[data-nav-item]');
  expect(navItems.length).toBeGreaterThan(0);

  // Nav items should NOT have aria-expanded
  for (const nav of navItems) {
    expect(nav).not.toHaveAttribute('aria-expanded');
  }
});

test('C4: active nav button has aria-current="page"', () => {
  render(
    <Sidebar
      defaultSections={true}
      onItemSelect={vi.fn()}
      activeId="tasks"
    />,
  );

  // Find the active nav item (data-nav-item="tasks")
  const activeNav = document.querySelector('[data-nav-item="tasks"]');
  expect(activeNav).toBeTruthy();
  expect(activeNav).toHaveAttribute('aria-current', 'page');

  // Inactive nav item should NOT have aria-current="page"
  const inactiveNav = document.querySelector('[data-nav-item="overview"]');
  expect(inactiveNav).toBeTruthy();
  expect(inactiveNav).not.toHaveAttribute('aria-current', 'page');
});
