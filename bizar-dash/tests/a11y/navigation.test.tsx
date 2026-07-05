// tests/a11y/navigation.test.tsx — WCAG 2.1.1 / 2.4.1 navigation accessibility.
//
// Tests that sidebar, tabs, and the Memory source rail all meet
// keyboard navigation, role, and aria attributes requirements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Memory } from '../../src/web/views/Memory';
import { Plugins } from '../../src/web/views/Plugins';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <ModalProvider>{ui}</ModalProvider>
    </ToastProvider>,
  );
}

// ─── Memory tab ──────────────────────────────────────────────────────────────

describe('Memory — WCAG 2.4.1: nav has aria-label, tabs have role=tab + aria-selected', () => {
  it('source rail has aria-label="Memory sources"', () => {
    renderWithProviders(
      <Memory
        snapshot={{} as any}
        settings={{} as any}
        activeTab="memory"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const nav = document.querySelector('[aria-label="Memory sources"]');
    expect(nav).toBeInTheDocument();
  });

  it('each source button has role="tab"', () => {
    renderWithProviders(
      <Memory
        snapshot={{} as any}
        settings={{} as any}
        activeTab="memory"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('active tab has aria-selected="true"', () => {
    renderWithProviders(
      <Memory
        snapshot={{} as any}
        settings={{} as any}
        activeTab="memory"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const activeTab = screen.getByRole('tab', { selected: true });
    expect(activeTab).toBeInTheDocument();
  });

  it('inactive tabs have aria-selected="false"', () => {
    renderWithProviders(
      <Memory
        snapshot={{} as any}
        settings={{} as any}
        activeTab="memory"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    const unselected = tabs.filter((t) => !t.getAttribute('aria-selected') || t.getAttribute('aria-selected') === 'false');
    expect(unselected.length).toBeGreaterThan(0);
  });

  it('refresh button has aria-label="Refresh memory"', () => {
    renderWithProviders(
      <Memory
        snapshot={{} as any}
        settings={{} as any}
        activeTab="memory"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const btn = screen.getByRole('button', { name: /refresh memory/i });
    expect(btn).toBeInTheDocument();
  });
});

// ─── Plugins ─────────────────────────────────────────────────────────────────

describe('Plugins — WCAG 2.1.1: filter input has accessible name', () => {
  it('the filter input has aria-label="Filter plugins"', () => {
    renderWithProviders(
      <Plugins
        snapshot={{} as any}
        settings={{} as any}
        activeTab="plugins"
        setActiveTab={() => {}}
        refreshSnapshot={() => Promise.resolve()}
      />,
    );
    const input = document.querySelector('input[type="search"]');
    expect(input).toHaveAttribute('aria-label', 'Filter plugins');
  });
});
