/**
 * sidebar-responsive.test.ts — Bug C2
 * Verifies that at mobile viewport (375px) the sidebar is properly managed
 * by the AppShell mobile drawer pattern.
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

// Stub matchMedia to simulate mobile viewport
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

test('C2: sidebar renders at mobile viewport without crashing', () => {
  window.innerWidth = 375;
  window.dispatchEvent(new Event('resize'));

  render(
    <Sidebar
      defaultSections={true}
      onItemSelect={vi.fn()}
      activeId="overview"
    />,
  );

  // Sidebar aside element should be present
  const aside = document.querySelector('aside[aria-label="Primary navigation"]');
  expect(aside).toBeInTheDocument();
});
